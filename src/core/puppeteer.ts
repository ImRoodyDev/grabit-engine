import type { PageWithCursor } from "puppeteer-real-browser";
import { PuppeteerLoadRequest, PuppeteerLoadResult, PuppeteerPoolConfig } from "../types/models/Puppeteer.ts";
import { ProcessError, ProviderContext } from "../types/index.ts";
import { Logger } from "../utils/logger.ts";
import { isNode } from "../utils/standard.ts";

// Lazy-loaded puppeteer-real-browser module
let puppeteerModule: typeof import("puppeteer-real-browser") | null = null;
// This plugin works best with non-headless mode, but it can be disabled if needed (e.g. for environments that don't support headless mode properly)
let HEADLESS = true;
const CLOUDFLARE_DETECTION = /Attention Required|Just a moment|Cloudflare/i;

const DEFAULT_POOL_CONFIG: Required<PuppeteerPoolConfig> = {
	maxConcurrentBrowsers: 2,
	minWarmBrowsers: 0,
	idleBrowserTTL: 60_000,
	maxBrowserSessionTTL: 600_000
};

type BrowserPoolEntry = {
	id: number;
	key: string;
	browser: PuppeteerLoadResult["browser"];
	initialPage: PageWithCursor | null;
	activeLeases: number;
	closing: boolean;
	idleTimer?: ReturnType<typeof setTimeout>;
};

type BrowserLease = {
	browser: PuppeteerLoadResult["browser"];
	page: PageWithCursor;
	release: () => Promise<void>;
};

type BrowserConnectOptions = {
	headless: boolean;
	proxy?: { host: string; port: number; password?: string };
	[key: string]: unknown;
};

let browserPoolConfig: Required<PuppeteerPoolConfig> = { ...DEFAULT_POOL_CONFIG };
let browserEntryCounter = 0;
let totalBrowserCount = 0;
const browserPool = new Map<string, Set<BrowserPoolEntry>>();
const pendingBrowserWaiters: Array<() => void> = [];

export async function puppeteerLoad(url: URL, request: PuppeteerLoadRequest): Promise<PuppeteerLoadResult> {
	// Check if running in a Node.js environment
	if (!isNode())
		throw new ProcessError({
			code: "PuppeteerNotSupported",
			status: 400,
			message: `Puppeteer is not supported in the current environment`
		});

	// Lazy load puppeteer-real-browser (throws if not installed)
	await getPuppeteerModule();

	// Destructure request parameters with defaults
	const { requester, browsingOptions: browserOptions } = request;
	const { loadCriteria = "domcontentloaded", extraHeaders, ignoreError = false, ...puppeteerOptions } = browserOptions || {};
	const connectOptions: BrowserConnectOptions = {
		args: [],
		customConfig: {},
		turnstile: true,
		connectOption: {},
		disableXvfb: false,
		ignoreAllFlags: false,
		headless: HEADLESS,
		proxy: requester.proxyAgent && {
			host: requester.proxyAgent.proxy.host as string,
			port: requester.proxyAgent.proxy.port as number,
			password: requester.proxyAgent.proxy.password
		},
		...puppeteerOptions
	};
	const { browser, page, release } = await acquireBrowserSession(connectOptions);

	try {
		// Set extra headers/agent if provided
		if (requester.userAgent) await page.setUserAgent(requester.userAgent);
		if (extraHeaders) await page.setExtraHTTPHeaders(extraHeaders);

		// Navigate and wait for initial load
		const navigatedResponse = await page.goto(url.href, { waitUntil: loadCriteria });
		if (!ignoreError && !navigatedResponse?.ok())
			throw new ProcessError({
				code: "PuppeteerNavigationError",
				status: 500,
				message: `Failed to navigate to ${url.href} with Puppeteer. Status: ${navigatedResponse?.status() || "unknown"}`
			});

		// Check if Cloudflare challenge exists
		const hasChallengeDetected = await page.evaluate(
			(cloudflarePatternSource, cloudflarePatternFlags) => {
				const cloudflarePattern = new RegExp(cloudflarePatternSource, cloudflarePatternFlags);
				return !!document.querySelector(".cf-turnstile") || !!document.querySelector(".challenge-error-text") || cloudflarePattern.test(document.title);
			},
			CLOUDFLARE_DETECTION.source,
			CLOUDFLARE_DETECTION.flags
		);

		// Log navigation result and challenge detection
		Logger.debug(`Puppeteer navigation to ${url.href} completed. Cloudflare challenge detected: ${hasChallengeDetected}`);

		// If a challenge is detected, attempt to resolve it
		if (hasChallengeDetected) await resolveChallenge(page);

		// Enable optimizations to speed up page interactions
		// Note: This is done after navigation to ensure the page loads fully before blocking resources
		// Sometimes cloudflare challenges may require loading certain resources, so we wait until after navigation to enable optimizations
		await enablePageOptimizations(page);

		return { page, browser };
	} catch (error) {
		try {
			await release();
		} catch {
			// Ignore release-time failures during error unwinding.
		}
		throw new ProcessError({
			code: "PuppeteerLoadError",
			status: 500,
			message: `Failed to load page with Puppeteer: ${error instanceof Error ? error.message : String(error)}`
		});
	}
}

/** Waits for Cloudflare's interstitial flow to finish before scraping continues. */
async function resolveChallenge(page: PageWithCursor): Promise<void> {
	try {
		// Wait for navigation with timeout to allow Cloudflare challenge to resolve
		await Promise.race([
			page.waitForNavigation({ waitUntil: "networkidle0", timeout: 20000 }),
			new Promise((_, reject) =>
				setTimeout(
					() =>
						reject(
							new ProcessError({
								code: "CloudflareChallengeTimeout",
								status: 408,
								message: `Cloudflare challenge did not resolve within the expected time`
							})
						),
					20000
				)
			)
		]);
	} catch (error) {
		if (!(error instanceof ProcessError) || error.code !== "CloudflareChallengeTimeout") throw error;
		Logger.error("Cloudflare challenge did not resolve in time, proceeding with current page");
		throw new ProcessError({
			code: "CloudflareChallengeTimeout",
			status: 408,
			message: `Cloudflare challenge did not resolve within the expected time`
		});
	}
}

/** Blocks low-value resource types after navigation so later page work is cheaper. */
async function enablePageOptimizations(page: PageWithCursor): Promise<void> {
	// Enable request interception to block unnecessary resources
	await page.setRequestInterception(true);
	page.on("request", (req) => {
		const resourceType = req.resourceType();
		if (["image", "stylesheet", "font"].includes(resourceType)) {
			req.abort();
		} else {
			req.continue();
		}
	});
}

/** Disable headless mode */
export function disableHeadlessMode(disable: boolean = true): void {
	HEADLESS = !disable;
}

const context: ProviderContext["puppeteer"] = {
	launch: puppeteerLoad
};

/** Applies sanitized pool settings and trims any now-invalid idle browsers. */
export function configurePuppeteerPool(config?: PuppeteerPoolConfig): void {
	browserPoolConfig = sanitizePoolConfig(config);
	trimIdleBrowsers();

	if (browserPoolConfig.minWarmBrowsers > 0) {
		Logger.debug(
			`Puppeteer pool configured: minWarmBrowsers=${browserPoolConfig.minWarmBrowsers}. ` +
				`Warm browsers are retained after first use — they are not pre-created at startup.`
		);
	}
}

/** Closes all pooled browsers and wakes any callers waiting for a browser slot. */
export function shutdownPuppeteerPool(): void {
	const entries = Array.from(getAllBrowserEntries());
	browserPool.clear();
	totalBrowserCount = 0;
	while (pendingBrowserWaiters.length > 0) pendingBrowserWaiters.shift()?.();

	for (const entry of entries) {
		if (entry.idleTimer) clearTimeout(entry.idleTimer);
		entry.closing = true;
		void closeBrowserInstance(entry.browser);
	}
	Logger.debug(`Puppeteer browser pool shut down (${entries.length} browser(s) scheduled for closure)`);
}

/** Test helper: clears pool state synchronously and restores defaults. */
export function __resetPuppeteerPoolForTests(): void {
	shutdownPuppeteerPool();
	browserPoolConfig = { ...DEFAULT_POOL_CONFIG };
	puppeteerModule = null;
}

/** Lazily imports the optional Puppeteer dependency only when Node-side scraping needs it. */
async function getPuppeteerModule(): Promise<typeof import("puppeteer-real-browser")> {
	if (puppeteerModule) return puppeteerModule;

	try {
		puppeteerModule = await import("puppeteer-real-browser");
		return puppeteerModule;
	} catch {
		throw new ProcessError({
			code: "PuppeteerNotAvailable",
			status: 400,
			message: `puppeteer-real-browser is not available in this environment. Install it to use Puppeteer features.`
		});
	}
}

/** Acquires a tab lease from a matching pooled browser or waits until capacity becomes available. */
async function acquireBrowserSession(connectOptions: BrowserConnectOptions): Promise<BrowserLease> {
	const key = stableStringify(connectOptions);

	while (true) {
		// Reuse a matching warm browser when possible to avoid spawning a new process.
		const reusableEntry = getReusableBrowserEntry(key);
		if (reusableEntry) {
			try {
				return await createPageLease(reusableEntry);
			} catch {
				// The stale browser was already removed from the pool by createPageLease's
				// error handler, so the next iteration will either pick another entry
				// or fall through to create a fresh browser.
				Logger.debug(`Stale pooled browser #${reusableEntry.id} evicted — retrying browser acquisition`);
				continue;
			}
		}

		// No matching browser exists, so create one if the global process limit still allows it.
		if (totalBrowserCount < browserPoolConfig.maxConcurrentBrowsers) {
			const createdEntry = await createBrowserEntry(key, connectOptions);
			return createPageLease(createdEntry);
		}

		// The global browser cap is full, so wait until a lease is released or a browser closes.
		await waitForBrowserAvailability();
	}
}

/** Launches a real browser process and registers it in the keyed pool. */
async function createBrowserEntry(key: string, connectOptions: BrowserConnectOptions): Promise<BrowserPoolEntry> {
	const { connect: connectToBrowser } = await getPuppeteerModule();
	const { browser, page } = await connectToBrowser(connectOptions);
	const entry: BrowserPoolEntry = {
		id: ++browserEntryCounter,
		key,
		browser,
		initialPage: page,
		activeLeases: 0,
		closing: false
	};

	// Proactively evict the entry if the browser process exits or its WebSocket drops.
	if (typeof browser.on === "function") {
		browser.on("disconnected", () => {
			if (!entry.closing) {
				Logger.debug(`Pooled Puppeteer browser #${entry.id} disconnected unexpectedly — removing from pool`);
				removeBrowserEntry(entry);
			}
		});
	}

	// Pool entries are grouped by launch signature so browsers with different proxy/options stay isolated.
	const poolEntries = browserPool.get(key) ?? new Set<BrowserPoolEntry>();
	poolEntries.add(entry);
	browserPool.set(key, poolEntries);
	totalBrowserCount++;
	wakePendingWaiters();
	Logger.debug(`Created pooled Puppeteer browser #${entry.id}. Active browser count: ${totalBrowserCount}`);
	return entry;
}

/** Opens or reuses a page for one consumer and returns a browser-like release handle. */
async function createPageLease(entry: BrowserPoolEntry): Promise<BrowserLease> {
	clearIdleTimer(entry);
	entry.activeLeases++;

	let page: PageWithCursor;
	try {
		page = entry.initialPage ?? ((await entry.browser.newPage()) as PageWithCursor);
		entry.initialPage = null;
	} catch (error) {
		entry.activeLeases = Math.max(0, entry.activeLeases - 1);
		removeBrowserEntry(entry);
		void closeBrowserInstance(entry.browser);
		throw error;
	}

	const release = createLeaseRelease(entry, page);
	// Providers receive a browser-like handle whose close/disconnect only releases their lease.
	const browserHandle = createProxyBrowserHandle(entry.browser, release);
	// Proxy the page so page.close() routes through the pool release instead of killing the Chrome tab directly.
	const pageHandle = createProxyPageHandle(page, release);
	return { browser: browserHandle, page: pageHandle, release };
}

/** Builds an idempotent release callback that closes the page and returns the lease to the pool. */
function createLeaseRelease(entry: BrowserPoolEntry, page: PageWithCursor): () => Promise<void> {
	let released = false;

	// Safety net: auto-release if the provider never calls browser.close()
	let leaseTimer: ReturnType<typeof setTimeout> | undefined;
	if (browserPoolConfig.maxBrowserSessionTTL > 0) {
		leaseTimer = setTimeout(() => {
			if (released) return;
			Logger.alwaysWarn(
				`Puppeteer lease on browser #${entry.id} was not released within ${browserPoolConfig.maxBrowserSessionTTL}ms — auto-releasing. ` +
					`Make sure your provider calls browser.close() when finished.`
			);
			void release();
		}, browserPoolConfig.maxBrowserSessionTTL);
		if (typeof leaseTimer === "object" && "unref" in leaseTimer) leaseTimer.unref();
	}

	const release = async () => {
		if (released) return;
		released = true;
		if (leaseTimer) clearTimeout(leaseTimer);

		// Decrement first so the idle-count check below sees the true state.
		entry.activeLeases = Math.max(0, entry.activeLeases - 1);

		try {
			// If this browser should stay warm and this is its last active lease,
			// open a fresh keeper page before closing the provider's page.
			// This prevents Chrome from disconnecting when the last tab closes.
			const keepWarm = !entry.closing && entry.activeLeases === 0 && getIdleBrowserCount(entry.key) <= browserPoolConfig.minWarmBrowsers;

			if (keepWarm) {
				try {
					const freshPage = await entry.browser.newPage();
					entry.initialPage = freshPage as PageWithCursor;
				} catch {
					// Browser is likely dead; fall through to close the source page.
				}
			}

			try {
				if (!(typeof page.isClosed === "function" && page.isClosed())) await page.close();
			} catch {
				// Ignore release-time page errors.
			}

			if (keepWarm && entry.initialPage) {
				Logger.debug(
					`Kept browser #${entry.id} warm with a fresh keeper page ` +
						`(${getIdleBrowserCount(entry.key)}/${browserPoolConfig.minWarmBrowsers} warm browser(s))`
				);
			}
		} finally {
			handleReleasedBrowser(entry);
		}
	};

	return release;
}

/** Decides whether a released browser stays warm, closes immediately, or wakes waiting callers. */
function handleReleasedBrowser(entry: BrowserPoolEntry): void {
	if (entry.closing) {
		wakePendingWaiters();
		return;
	}

	if (entry.activeLeases > 0) {
		wakePendingWaiters();
		return;
	}

	const warmIdleCount = getIdleBrowserCount(entry.key);
	if (warmIdleCount <= browserPoolConfig.minWarmBrowsers) {
		Logger.debug(`Browser #${entry.id} retained as warm idle (${warmIdleCount}/${browserPoolConfig.minWarmBrowsers} warm browser(s))`);
		wakePendingWaiters();
		return;
	}

	if (browserPoolConfig.idleBrowserTTL <= 0) {
		removeBrowserEntry(entry);
		void closeBrowserInstance(entry.browser);
		return;
	}

	// Keep the browser warm briefly so nearby requests can reuse it without another launch.
	entry.idleTimer = setTimeout(() => {
		entry.idleTimer = undefined;
		if (entry.activeLeases > 0 || entry.closing) return;

		// Re-check the warm minimum at eviction time because another browser may have disappeared meanwhile.
		const idleCount = getIdleBrowserCount(entry.key);
		if (idleCount <= browserPoolConfig.minWarmBrowsers) return;

		removeBrowserEntry(entry);
		void closeBrowserInstance(entry.browser);
	}, browserPoolConfig.idleBrowserTTL);

	if (typeof entry.idleTimer === "object" && "unref" in entry.idleTimer) entry.idleTimer.unref();
	Logger.debug(`Returned Puppeteer browser #${entry.id} to idle pool`);
	wakePendingWaiters();
}

/** Proxies browser shutdown APIs so providers release only their own lease. */
function createProxyBrowserHandle(browser: PuppeteerLoadResult["browser"], release: () => Promise<void>): PuppeteerLoadResult["browser"] {
	return new Proxy(browser, {
		get(target, property, receiver) {
			// Closing the provider-facing handle returns the tab to the pool instead of killing the shared browser.
			if (property === "close" || property === "disconnect") return async () => release();

			const value = Reflect.get(target, property, receiver);
			if (typeof value === "function") return value.bind(target);
			return value;
		}
	}) as PuppeteerLoadResult["browser"];
}

/** Proxies page.close() so it routes through the pool release instead of killing the Chrome tab directly. */
function createProxyPageHandle(page: PageWithCursor, release: () => Promise<void>): PageWithCursor {
	return new Proxy(page, {
		get(target, property, receiver) {
			if (property === "close") return async () => release();

			const value = Reflect.get(target, property, receiver);
			if (typeof value === "function") return value.bind(target);
			return value;
		}
	}) as PageWithCursor;
}

/** Normalizes pool values into safe bounded integers before the pool uses them. */
function sanitizePoolConfig(config?: PuppeteerPoolConfig): Required<PuppeteerPoolConfig> {
	const maxConcurrentBrowsers = Math.max(1, Math.trunc(config?.maxConcurrentBrowsers ?? DEFAULT_POOL_CONFIG.maxConcurrentBrowsers));
	const minWarmBrowsers = Math.max(0, Math.min(maxConcurrentBrowsers, Math.trunc(config?.minWarmBrowsers ?? DEFAULT_POOL_CONFIG.minWarmBrowsers)));
	const idleBrowserTTL = Math.max(0, Math.trunc(config?.idleBrowserTTL ?? DEFAULT_POOL_CONFIG.idleBrowserTTL));
	const maxBrowserSessionTTL = Math.max(0, Math.trunc(config?.maxBrowserSessionTTL ?? DEFAULT_POOL_CONFIG.maxBrowserSessionTTL));

	return {
		maxConcurrentBrowsers,
		minWarmBrowsers,
		idleBrowserTTL,
		maxBrowserSessionTTL
	};
}

/** Creates a stable deterministic string so browser options can be used as a pool key. */
function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;

	const objectValue = value as Record<string, unknown>;
	const keys = Object.keys(objectValue).sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`).join(",")}}`;
}

/** Removes a browser entry from the pool's bookkeeping and frees a global browser slot. */
function removeBrowserEntry(entry: BrowserPoolEntry): void {
	if (entry.closing) return;
	entry.closing = true;
	clearIdleTimer(entry);

	const poolEntries = browserPool.get(entry.key);
	if (poolEntries) {
		poolEntries.delete(entry);
		if (poolEntries.size === 0) browserPool.delete(entry.key);
	}

	totalBrowserCount = Math.max(0, totalBrowserCount - 1);
	wakePendingWaiters();
}

/** Finds any non-closing browser that can satisfy the requested launch signature. */
function getReusableBrowserEntry(key: string): BrowserPoolEntry | undefined {
	const entries = browserPool.get(key);
	if (!entries || entries.size === 0) return undefined;

	for (const entry of entries) {
		if (!entry.closing) return entry;
	}

	return undefined;
}

/** Counts idle pooled browsers for one launch signature to enforce the warm minimum. */
function getIdleBrowserCount(key: string): number {
	const entries = browserPool.get(key);
	if (!entries) return 0;

	let idleCount = 0;
	for (const entry of entries) {
		if (!entry.closing && entry.activeLeases === 0) idleCount++;
	}
	return idleCount;
}

/** Iterates every pooled browser entry regardless of launch signature. */
function* getAllBrowserEntries(): Iterable<BrowserPoolEntry> {
	for (const entries of browserPool.values()) {
		for (const entry of entries) yield entry;
	}
}

/** Cancels any pending idle-eviction timer for a browser that is becoming active again. */
function clearIdleTimer(entry: BrowserPoolEntry): void {
	if (!entry.idleTimer) return;
	clearTimeout(entry.idleTimer);
	entry.idleTimer = undefined;
}

/** Applies the latest warm-browser policy to the current idle pool. */
function trimIdleBrowsers(): void {
	for (const entry of Array.from(getAllBrowserEntries())) {
		if (entry.activeLeases > 0 || entry.closing) continue;

		const idleCount = getIdleBrowserCount(entry.key);
		if (idleCount <= browserPoolConfig.minWarmBrowsers) continue;

		if (browserPoolConfig.idleBrowserTTL === 0) {
			removeBrowserEntry(entry);
			void closeBrowserInstance(entry.browser);
		}
	}
}

/** Suspends one caller until a browser slot becomes available again. */
function waitForBrowserAvailability(): Promise<void> {
	return new Promise((resolve) => pendingBrowserWaiters.push(resolve));
}

/** Releases all pending callers so they can re-check pool state after a change. */
function wakePendingWaiters(): void {
	if (pendingBrowserWaiters.length === 0) return;
	const waiters = pendingBrowserWaiters.splice(0, pendingBrowserWaiters.length);
	for (const resolve of waiters) resolve();
}

/** Best-effort browser shutdown used during teardown and idle eviction. */
async function closeBrowserInstance(browser: PuppeteerLoadResult["browser"]): Promise<void> {
	try {
		await browser.close();
	} catch {
		// Ignore browser shutdown errors during teardown.
	}
}

export default context;
