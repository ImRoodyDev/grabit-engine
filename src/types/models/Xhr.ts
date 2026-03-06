import { RequestInit, RequestRetryInit, RequestTimeoutInit } from "../../services/fetcher.ts";

export type ProviderFetchOptions = (RequestInit | RequestRetryInit | RequestTimeoutInit) & {
	/** Attach User-Agent header to the request (default: false) */
	attachUserAgent?: boolean;
	/** Attach proxy settings to the request (default: true) */
	attachProxy?: boolean;
	/** Clean request with no defualt headers options attached
	 * default headers inclue `"Content-Type": "application/json"` and `"Accept": "application/json"`
	 * - When set to true, the fetch request will not include the default headers and will only use the headers provided in the options
	 * - Useful for making requests that require custom headers or no headers at all, without being overridden by default values
	 */
	clean?: boolean;
};
