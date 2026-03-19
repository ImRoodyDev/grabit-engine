import * as cheerio from "cheerio";
import { ProcessError, CheerioLoadRequest, CheerioLoadResult, ProviderContext, TProviderSelectors } from "../types/index.ts";
import { RequestInit } from "../services/fetcher.ts";
import { calculateMatchScore } from "../utils/similarity.ts";

/**
 * Mimics a browser request by setting appropriate headers and using Cheerio to load the HTML content of a page.
 */
export const BrowserHeader = {
	Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
	// DNT: "1",
	// Pragma: "no-cache",
	// Priority: "u=0, i",
	// "Cache-Control": "no-store",
	// "Accept-Language": "en-US,en;q=0.9",
	// "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
	// "sec-ch-ua-mobile": "?0",
	// "sec-ch-ua-platform": '"Windows"',
	// "Sec-Fetch-Dest": "document",
	// "Sec-Fetch-Mode": "navigate",
	// "Sec-Fetch-Site": "none",
	// "Sec-Fetch-User": "?1"
} as const;

/**
 * Loads a webpage using Cheerio, mimicking a browser request with appropriate headers and optional proxy support.
 * @param page - The URL of the page to load
 * @param request - The requester information, including media details, user agent, proxy agent, and any extra headers
 * - Example usage:
 * ```ts
 * const { $, response } = await cheerioLoad(new URL("https://example.com"), {
 *   media: { type: "movie", title: "Example Movie", releaseYear: 2023 },
 *   targetLanguageISO: "en",
 *   userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
 * });
 * ```
 */
export async function cheerioLoad(page: URL, request: CheerioLoadRequest, context: ProviderContext["xhr"]): Promise<CheerioLoadResult> {
	try {
		// Prepare request options, including headers and proxy agent if provided by the requester
		const requestOptions: RequestInit = {
			method: "GET",
			headers: {
				...BrowserHeader,
				...(request.userAgent && { "User-Agent": request.userAgent }),
				...(request.extraHeaders || {})
			},
			agent: request.proxyAgent,
			clean: true
		};

		// Fetch the page content using the fetchResponse utility, passing in the appropriate headers and proxy agent if provided
		let response = await context.fetch(page, requestOptions, request);
		// console.log(`Fetched page: ${response.status} ${response.statusText}`);

		// Check if the response needs to be followed for redirection
		if (response.status >= 300 && response.status < 400 && response.headers.has("location") && request.followRedirects) {
			const location = response.headers.get("location")!;
			const redirectUrl = new URL(location, page);
			response = await context.fetch(redirectUrl, requestOptions, request);
		}

		// Load the response text into Cheerio and return the Cheerio instance for DOM manipulation
		const html = await response.text();
		// console.log(`Loaded page: ${html}`);

		return {
			$: cheerio.load(html),
			response
		};
	} catch (error) {
		// If an error occurs during fetching or loading, throw a new error with details
		const details = getErrorText(error);
		throw new ProcessError({
			code: "CheerioLoadError",
			status: 500,
			message: classifyCheerioLoadFailure(page, error),
			details
		});
	}
}

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
 * @see {@link calculateMatchScore} for the scoring algorithm that considers title, year, date, and duration matches to determine the similarity of search results to the requester's media information.
 */
export async function cheerioSortResults($page: cheerio.CheerioAPI, selector: TProviderSelectors, requester: CheerioLoadRequest) {
	const results = $page(selector.$results).toArray();

	// Map with score and sort by score
	const scoredResults = results.map((result) => {
		return {
			element: result,
			score: calculateMatchScore(
				{
					title: $page(result).find(selector.$result_title).text().trim(),
					year: selector.$result_year ? $page(result).find(selector.$result_year).text().trim() : undefined,
					date: selector.$result_date ? $page(result).find(selector.$result_date).text().trim() : undefined,
					duration: selector.$result_duration ? $page(result).find(selector.$result_duration).text().trim() : undefined
				},
				requester.media
			)
		};
	});

	// Sort by score
	scoredResults.sort((a, b) => b.score - a.score);

	return scoredResults;
}

function getErrorText(error: unknown): string {
	if (error instanceof Error) {
		return `${error.message}\n${error.stack ?? ""}`.trim();
	}
	return String(error);
}

function classifyCheerioLoadFailure(page: URL, error: unknown): string {
	const errorText = getErrorText(error);
	const target = page.href;
	const host = page.hostname || target;

	if (/No such host is known|dns error|ENOTFOUND|getaddrinfo/i.test(errorText)) {
		return `DNS lookup failed while loading ${target}. The provider host "${host}" could not be resolved.`;
	}

	if (/ETIMEDOUT|timed out/i.test(errorText)) {
		return `Request timed out while loading ${target}. The provider host "${host}" did not respond in time.`;
	}

	if (/ECONNREFUSED|Failed to connect to the server|ConnectError/i.test(errorText)) {
		return `Connection failed while loading ${target}. The provider host "${host}" could not be reached.`;
	}

	return `Error loading page with Cheerio from ${target}: ${error instanceof Error ? error.message : "Unknown error"}`;
}

const context: ProviderContext["cheerio"] = {
	$load: cheerio.load,
	load: cheerioLoad,
	sortResults: cheerioSortResults
};

export default context;
