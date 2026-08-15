import type { RequestInit, RequestRetryInit, RequestTimeoutInit } from "../../services/fetcher.ts";

/** Omit that distributes over a union, so each member keeps its own distinct keys
 *  (e.g. `timeout` / `maxAttempts` used to route the request). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Engine/host-owned fetch options: `proxy`/`agent` are host-supplied and the fetch controls
 *  (`maxHostConcurrency`/`honorRateLimit`/`coalesce`) are resolved from the provider config —
 *  the engine applies all of these, so providers must not set them via `ctx.xhr`. */
type EngineOwnedFetchKeys = "agent" | "proxy" | "maxHostConcurrency" | "honorRateLimit" | "coalesce";

export type ProviderFetchOptions = DistributiveOmit<RequestInit | RequestRetryInit | RequestTimeoutInit, EngineOwnedFetchKeys> & {
	/** Attach User-Agent header to the request (default: false) */
	attachUserAgent?: boolean;
	/** Clean request with no defualt headers options attached
	 * default headers inclue `"Content-Type": "application/json"` and `"Accept": "application/json"`
	 * - When set to true, the fetch request will not include the default headers and will only use the headers provided in the options
	 * - Useful for making requests that require custom headers or no headers at all, without being overridden by default values
	 */
	clean?: boolean;
};
