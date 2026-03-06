import type { PageWithCursor } from "puppeteer-real-browser";
import { PuppeteerLoadRequest, PuppeteerLoadResult } from "../types/models/Puppeteer.ts";
import { ProcessError, ProviderContext } from "../types/index.ts";
import { Logger } from "../utils/logger.ts";
import { isNode } from "../utils/standard.ts";

// Lazy-loaded puppeteer-real-browser module
let puppeteerModule: typeof import("puppeteer-real-browser") | null = null;
let HEADLESS = true;
const CLOUDFLARE_DETECTION = /Attention Required|Just a moment|Cloudflare/i;

export async function puppeteerLoad(url: URL, request: PuppeteerLoadRequest): Promise<PuppeteerLoadResult> {
	// Check if running in a Node.js environment
	if (!isNode())
		throw new ProcessError({
			code: "PuppeteerNotSupported",
			status: 400,
			message: `Puppeteer is not supported in the current environment`
		});

	// Lazy load puppeteer-real-browser (throws if not installed)
	const { connect: connectToBrowser } = await getPuppeteerModule();

	// Destructure request parameters with defaults
	const { requester, browsingOptions: browserOptions } = request;
	const { loadCriteria = "domcontentloaded", extraHeaders, closeOnComplete = true, ...puppeteerOptions } = browserOptions || {};
	let browser: PuppeteerLoadResult["browser"];

	try {
		// Connect to a real browser
		const { browser: connectedBrowser, page } = await connectToBrowser({
			args: [],
			customConfig: {},
			turnstile: false,
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
		});
		browser = connectedBrowser;

		// Set extra headers/agent if provided
		if (requester.userAgent) await page.setUserAgent(requester.userAgent);
		if (extraHeaders) await page.setExtraHTTPHeaders(extraHeaders);

		// Navigate and wait for initial load
		const navigatedResponse = await page.goto(url.href, { waitUntil: loadCriteria });
		if (!navigatedResponse?.ok())
			throw new ProcessError({
				code: "PuppeteerNavigationError",
				status: 500,
				message: `Failed to navigate to ${url.href} with Puppeteer. Status: ${navigatedResponse?.status() || "unknown"}`
			});

		// Check if Cloudflare challenge exists
		const hasChallengeDetected = await page.evaluate(() => {
			return !!document.querySelector("'.cf-turnstile'") || CLOUDFLARE_DETECTION.test(document.title);
		});

		// Log navigation result and challenge detection
		Logger.debug(`Puppeteer navigation to ${url.href} completed. Cloudflare challenge detected: ${hasChallengeDetected}`);

		// If a challenge is detected, attempt to resolve it
		if (hasChallengeDetected) await resolveChallenge(page);

		// Enable optimizations to speed up page interactions
		// Note: This is done after navigation to ensure the page loads fully before blocking resources
		// Sometimes cloudflare challenges may require loading certain resources, so we wait until after navigation to enable optimizations
		await enablePageOptimizations(page);

		// Close the browser on complete if specified
		if (closeOnComplete) await browser.close();

		return { page, browser };
	} catch (error) {
		throw new ProcessError({
			code: "PuppeteerLoadError",
			status: 500,
			message: `Failed to load page with Puppeteer: ${error instanceof Error ? error.message : String(error)}`
		});
	}
}

/** Disable headless mode */
export function disableHeadlessMode(disable: boolean = true): void {
	HEADLESS = !disable;
}

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

async function resolveChallenge(page: PageWithCursor): Promise<void> {
	try {
		// Wait for navigation with timeout to allow Cloudflare challenge to resolve
		await Promise.race([
			page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
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
					15000
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

const context: ProviderContext["puppeteer"] = {
	launch: puppeteerLoad
};

export default context;
