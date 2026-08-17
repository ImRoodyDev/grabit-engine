import { PuppeteerLoadRequest, PuppeteerLoadResult, PuppeteerPage } from "../types/models/Puppeteer.ts";
import { ProcessError, ProviderContext, proxyAgentOf } from "../types/index.ts";
import { acquireBrowserSession, getPuppeteerModule, BrowserConnectOptions } from "../controllers/puppeteerPool.ts";
import { Logger } from "../utils/logger.ts";
import { isNode } from "../utils/standard.ts";

// This plugin works best with non-headless mode; it can be disabled for
// environments that don't support headless mode properly.
let HEADLESS = true;
const CLOUDFLARE_DETECTION = /Attention Required|Just a moment|Cloudflare|checking your browser|cf-browser-verification/i;

export async function puppeteerLoad(url: URL, request: PuppeteerLoadRequest): Promise<PuppeteerLoadResult> {
	// Check if running in a Node.js environment
	if (!isNode())
		throw new ProcessError({
			code: "PuppeteerNotSupported",
			status: 400,
			message: `Puppeteer is not supported in the current environment`
		});

	// Fail fast if the optional dependency is missing, before building connect options.
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
		// Only agent proxies map to a browser proxy; resolver proxies are HTTP-only.
		proxy: (() => {
			const agent = proxyAgentOf(requester.proxy);
			return agent && { host: agent.proxy.host as string, port: agent.proxy.port as number, password: agent.proxy.password };
		})(),
		...puppeteerOptions
	};
	// Lease a tab from the shared browser pool.
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

		// Block low-value resources to speed up later page work. Done after navigation
		// so the page (and any Cloudflare challenge) can load its resources first.
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
async function resolveChallenge(page: PuppeteerPage): Promise<void> {
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
async function enablePageOptimizations(page: PuppeteerPage): Promise<void> {
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

export default context;
