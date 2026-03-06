import {
	RequestInfo,
	Response,
	fetchResponseWithTimeout,
	fetchResponseWithRetry,
	fetchResponse,
	fetchWithTimeout,
	appFetch,
	fetchWithRetry,
	handleResponse
} from "../services/fetcher.ts";
import { ScrapeRequester, ProviderContext, ProviderFetchOptions, isHttpError } from "../types/index.ts";

/**
 * Provider fetch function
 * - Wrapper around appFetch that adds support for user agent and proxy from the requester
 * - Determines the type of request (normal, retry, timeout) based on the options provided and calls the appropriate fetch function
 * - Can be extended in the future to add additional logging or error handling specific to provider requests
 * @param request - The input to fetch, can be a URL string or a Request object
 * @param fetchOptions - Options for the fetch request, can include timeout or retry options
 * @param requester - The ScrapeRequester object containing user agent and proxy information
 * @returns A Promise that resolves to the Response object from the fetch call
 *
 *
 * @see {@link ProviderFetchOptions}  for the options that can be passed to this function, including timeout and retry options
 * @defaults - `attachUserAgent`: true, `attachProxy`: true
 */
export async function providerFetch(request: RequestInfo | URL, fetchOptions: ProviderFetchOptions, requester: ScrapeRequester) {
	const { attachUserAgent = true, attachProxy = true, ...options } = fetchOptions;

	const _option = {
		...options,
		headers: {
			...options.headers,
			...(attachUserAgent && requester.userAgent && { "User-Agent": requester.userAgent })
		},
		agent: attachProxy ? requester.proxyAgent : undefined
	};

	// Determine what type of request init is send e.g timeout, retry or normal fetch and call the appropriate function
	if ("timeout" in _option) {
		return fetchWithTimeout(request, _option);
	} else if ("maxAttempts" in _option) {
		return fetchWithRetry(request, _option);
	} else {
		return appFetch(request, _option);
	}
}

/** Provider fetch reponse handler
 * - Wrapper around handleResponse that can be used to handle responses for provider fetches
 * - Can be extended in the future to add additional logging or error handling specific to provider requests
 */
export async function providerFetchResponse<TResponse = unknown, TError = unknown>(
	request: RequestInfo | URL,
	fetchOptions: ProviderFetchOptions,
	requester: ScrapeRequester
) {
	const { attachUserAgent = true, attachProxy = true, ...options } = fetchOptions;
	const _option = {
		...options,
		headers: {
			...options.headers,
			...(attachUserAgent && requester.userAgent && { "User-Agent": requester.userAgent })
		},
		agent: attachProxy ? requester.proxyAgent : undefined
	};

	// Determine what type of request init is send e.g timeout, retry or normal fetch and call the appropriate function
	if ("timeout" in options) {
		return fetchResponseWithTimeout<TResponse, TError>(request, _option);
	} else if ("maxAttempts" in options) {
		return fetchResponseWithRetry<TResponse, TError>(request, _option);
	} else {
		return fetchResponse<TResponse, TError>(request, _option);
	}
}

/** Provider fetch response handler
 * - Wrapper around handleResponse that can be used to handle responses for provider fetches
 * - Can be extended in the future to add additional logging or error handling specific to provider requests
 */
export async function providerHandleResponse<TResponse = unknown, TError = unknown>(requestResponse: Response) {
	return handleResponse<TResponse, TError>(requestResponse);
}

/** Provider fetch status checker
 * - Wrapper around providerFetch that returns a simplified status object indicating whether the fetch was successful and the HTTP status code
 * - Can be extended in the future to add additional logging or error handling specific to provider requests
 */
export async function fetchStatus(request: RequestInfo | URL, options: ProviderFetchOptions, requester: ScrapeRequester) {
	try {
		const response = await providerFetch(request, options, requester);
		const data = await providerHandleResponse(response).catch(() => null);
		return {
			ok: response.ok,
			status: response.status,
			data: response.ok && data ? data : null
		};
	} catch (error) {
		return {
			ok: false,
			status: 0,
			error: isHttpError(error)
				? { name: error.name, message: error.message, code: error.code }
				: { name: "UnknownError", message: (error as Error).message || "An unknown error occurred" }
		};
	}
}

const context: ProviderContext["xhr"] = {
	fetch: providerFetch,
	status: fetchStatus,
	fetchResponse: providerFetchResponse,
	handleResponse: providerHandleResponse
};

export default context;
