import type { ConnectResult, Options } from "puppeteer-real-browser";
import type { ScrapeRequester } from "../input/Requester.ts";

type PuppeteerLifeCycleEvent = "domcontentloaded" | "load" | "networkidle0" | "networkidle2";

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

		/** Whether to close the browser instance after loading the page
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
