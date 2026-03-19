import type * as cheerio from "cheerio";
import type { cheerioLoad, cheerioSortResults } from "../../core/cheerio.ts";
import type { fetchStatus, providerFetch, providerFetchResponse, providerHandleResponse } from "../../core/xhr.ts";
import type { puppeteerLoad } from "../../core/puppeteer.ts";
import { DebugLogger } from "../../utils/logger.ts";

/**
 * Provider context passed to provider handlers, containing media information and utilities
 * This will be passed to all provider index entry for scraping
 * Note: This context is created in the GrabitManager and shared across all providers, allowing them to utilize the same utilities and maintain consistency in how media information is accessed and processed during scraping.
 * The context includes:
 * - `cheerio`: The Cheerio library for parsing HTML, which providers can use to manipulate and extract data from HTML content when scraping.
 * - `xhr`: The XHR utility for making HTTP requests, which provides methods for fetching data from provider endpoints, handling responses, and implementing retry and timeout mechanisms.
 * - `puppeteer`:(Node Server ONLY) The Puppeteer library for headless browser automation, which is optional and may not be available in all environments (e.g., client-side). Providers can use this utility for scraping content that requires JavaScript execution or dynamic rendering.
 * - `log`: A debug logger for logging messages during provider execution, which can be used to output informational messages, warnings, and errors to the console for debugging purposes.
 */
export type ProviderContext = {
	/**
	 * Cheerio library for parsing HTML
	 * Used to manipulate and extract data from HTML content
	 */
	cheerio: {
		/**
		 * Direct access to `cheerio.load` for parsing raw HTML strings into a Cheerio instance.
		 * Useful when you already have HTML content and don't need to fetch it.
		 *
		 * - Example usage:
		 * ```ts
		 * const $ = ctx.cheerio.$load("<div>Hello</div>");
		 * console.log($("div").text()); // "Hello"
		 * ```
		 */
		$load: typeof cheerio.load;
		/**
		 * Loads a webpage using Cheerio, mimicking a browser request with appropriate headers and optional proxy support.
		 * @param page - The URL of the page to load
		 * @param request - The requester information, including media details, user agent, proxy agent, and any extra headers
		 * @see {@link cheerioLoad} for the implementation of this utility function, which handles fetching the page content and loading it into Cheerio for DOM manipulation.
		 *
		 * - Example usage:
		 * ```ts
		 * const { $, response } = await cheerioLoad(new URL("https://example.com"), {
		 *   media: { type: "movie", title: "Example Movie", releaseYear: 2023 },
		 *   targetLanguageISO: "en",
		 *   userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
		 * });
		 * ```
		 */ load: typeof cheerioLoad;
		/**
		 * Sorts search results based on their similarity to the requester's media information, using a scoring algorithm that considers title, year, date, and duration matches.
		 * @param $page - The Cheerio instance containing the loaded page content
		 * @param selector - The selectors for extracting relevant information from each search result entry
		 * - requester - The requester's media information used for calculating similarity scores
		 * @returns An array of search results sorted by their similarity score, with each result containing the original Cheerio element and its calculated score
		 *
		 *	 `Score ranges:`
		 * - `For movies/series`: [0 <-> 170]
		 * - `For channels`: [0 <-> 100]
		 *
		 * Scoring breakdown:
		 * - `Title` similarity (`up to 100 points`): Based on cosine similarity of the media title and target title, scaled to 100.
		 * - `Year` match (`50 points`): If the media's release year matches the target year, add 50 points.
		 * - `Duration` similarity (`up to 20 points`): Based on how close the media's duration is to the target duration, with a maximum of 20 points for an exact match and decreasing as the difference increases.
		 * @see {@link cheerioSortResults} for the scoring algorithm that considers title, year, date, and duration matches to determine the similarity of search results to the requester's media information.
		 */
		sortResults: typeof cheerioSortResults;
	};
	/**
	 * XHR utility for making HTTP requests
	 * Supports various request methods and configurations
	 */
	xhr: {
		/** Provider fetch function
		 * - Wrapper around appFetch that adds support for user agent and proxy from the requester
		 * - Determines the type of request (normal, retry, timeout) based on the options provided and calls the appropriate fetch function
		 * @see {@link providerFetch} for the implementation of this utility function, which handles making HTTP requests with support for retries and timeouts based on the provided options.
		 */
		fetch: typeof providerFetch;

		/** Provider fetch response handler
		 * Wrapper around handleResponse that can be used to handle responses for provider fetches
		 * Can be extended in the future to add additional logging or error handling specific to provider requests
		 * @see {@link providerFetchResponse} for the implementation of this utility function, which processes HTTP responses and handles errors in a standardized way for provider requests.
		 */
		fetchResponse: typeof providerFetchResponse;

		/** Provider fetch response handler
		 * - Wrapper around handleResponse that can be used to handle responses for provider fetches
		 * - Can be extended in the future to add additional logging or error handling specific to provider requests
		 * @see {@link providerHandleResponse} for the implementation of this utility function, which processes HTTP responses and handles errors in a standardized way for provider requests.
		 */
		handleResponse: typeof providerHandleResponse;

		/** Provider fetch status checker
		 * - Wrapper around providerFetch that returns a simplified status object indicating whether the fetch was successful and the HTTP status code
		 * - Can be extended in the future to add additional logging or error handling specific to provider requests
		 * @see {@link fetchStatus} for the implementation of this utility function, which checks the status of HTTP requests made to provider endpoints and returns a standardized status object.
		 */
		status: typeof fetchStatus;
	};

	/**
	 * Puppeteer library for headless browser automation
	 * Optional: May not be available in all environments (e.g., client-side)
	 */
	puppeteer: {
		/** Acquires a browser session from the shared manager pool and opens a page/tab.
		 * @see {@link puppeteerLoad} for the implementation of this utility function, which handles launching or reusing a Puppeteer browser instance and navigating to a specified URL, with support for user agent and proxy configurations based on the requester's information.
		 */
		launch: typeof puppeteerLoad;
	};

	/** Debug logger for logging messages during provider execution */
	log: DebugLogger;
};
