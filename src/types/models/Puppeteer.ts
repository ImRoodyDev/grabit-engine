import type { ConnectResult, Options } from "puppeteer-real-browser";
import type { ScrapeRequester } from "../input/Requester.ts";

type PuppeteerLifeCycleEvent = "domcontentloaded" | "load" | "networkidle0" | "networkidle2";

export type PuppeteerPoolConfig = {
	/**
	 * Maximum number of real browser processes the shared pool may keep alive at once.
	 * Requests above this limit reuse existing matching browsers as new tabs when possible,
	 * otherwise they wait until a slot is released.
	 *
	 * @defaultValue `2`
	 */
	maxConcurrentBrowsers?: number;

	/**
	 * Minimum number of idle browser processes to keep warm for each browser configuration
	 * signature that has already been used.
	 *
	 * @defaultValue `0`
	 */
	minWarmBrowsers?: number;

	/**
	 * How long an idle pooled browser may stay alive before it is closed, unless it is still
	 * needed to satisfy `minWarmBrowsers`.
	 *
	 * @defaultValue `60000`
	 */
	idleBrowserTTL?: number;
};

export type PuppeteerLoadRequest = {
	requester: ScrapeRequester;
	browsingOptions?: {
		/**
		 * When to consider waiting succeeds. Given an array of event strings, waiting
		 * is considered to be successful after all events have been fired.
		 * - `domcontentloaded`: resolves once the initial HTML has been parsed.
		 * - `load`: resolves after the full page `load` event, including dependent resources.
		 * - `networkidle0`: resolves when there are no active network connections for a short period.
		 * - `networkidle2`: resolves when at most 2 network connections remain active for a short period.
		 *
		 * @defaultValue `'domcontentloaded'`
		 */
		loadCriteria?: PuppeteerLifeCycleEvent | PuppeteerLifeCycleEvent[];

		/** Whether to close the acquired Puppeteer session after loading the page.
		 * In pooled mode this releases the leased tab and may keep the underlying browser process warm for reuse.
		 * @defaultValue `true`
		 */
		closeOnComplete?: boolean;

		/** Extra headers to set on the page */
		extraHeaders?: { [key: string]: string };

		/** Ignore non-OK or missing responses returned by page.goto and continue with the loaded page.
		 * Useful for providers that can still scrape from pages behind redirects, challenge pages, or transient navigation statuses.
		 * @defaultValue `false`
		 */
		ignoreError?: boolean;
	} & Omit<Options, "headless" | "proxy" | "args">;
};

export type PuppeteerLoadResult = Readonly<{
	page: ConnectResult["page"];
	browser: ConnectResult["browser"];
}>;
