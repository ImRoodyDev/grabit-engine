import type { ConnectResult, Options } from "puppeteer-real-browser";
import type { ScrapeRequester } from "../input/Requester.ts";

type PuppeteerLifeCycleEvent = "domcontentloaded" | "load" | "networkidle0" | "networkidle2";

export type PuppeteerLoadRequest = {
	requester: ScrapeRequester;
	browsingOptions?: {
		/**
		 * When to consider waiting succeeds. Given an array of event strings, waiting
		 * is considered to be successful after all events have been fired.
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
	} & Omit<Options, "headless" | "proxy" | "args">;
};

export type PuppeteerLoadResult = Readonly<{
	page: ConnectResult["page"];
	browser: ConnectResult["browser"];
}>;
