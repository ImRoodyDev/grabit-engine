// Uses native fetch when available (browser, React Native, Node 18+).
// Falls back to node-fetch via dynamic import for older Node.js environments,
// avoiding bundling issues in environments that don't need it.
/**
 *
 * IMPIT (by Apify):
 * ─────────────────
 * Impit is a Rust-based HTTP client compiled to a native addon for Node.js.
 * It uses BoringSSL (not OpenSSL!) and can impersonate real browser TLS
 * fingerprints (JA3/JA4/HTTP2 AKAMAI fingerprint). This means it should
 * produce a TLS handshake indistinguishable from Chrome/Firefox/Safari,
 * bypassing Cloudflare's bot detection without needing a real browser.
 *
 * Key difference from Node.js fetch:
 *   - Node.js fetch → undici → OpenSSL → known bot fingerprint → BLOCKED
 *   - Impit         → Rust  → BoringSSL → browser fingerprint → ✅ PASSES
 */
import type { RequestInit } from "impit";
import { Crypto } from "./crypto.ts";
import { CACHE } from "./cache.ts";
import { delay, isBrowser, isNode, normalizeHeaders } from "../utils/standard.ts";
import { HttpError } from "../types/HttpError.ts";
import { ProcessError } from "../types/ProcessError.ts";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

// declare module "node-fetch" {
declare module "impit" {
	// Extend the existing RequestInit interface to include custom properties
	interface RequestInit {
		/** Clean request with no defualt headers options attached
		 * default headers inclue "Content-Type": "application/json" and "Accept": "application/json"
		 * - When set to true, the fetch request will not include the default headers and will only use the headers provided in the options
		 * - Useful for making requests that require custom headers or no headers at all, without being overridden by default values
		 */
		clean?: boolean;
		/** Proxy agent to use for the request */
		agent?: HttpProxyAgent<any> | HttpsProxyAgent<any> | SocksProxyAgent;
		/** Custom cache key for caching responses */
		customCacheKey?: string;
		/** Number of milliseconds to cache the response */
		cacheTTL?: number;
	}
}

let _resolvedFetch: UniversalFetch | null = null;
let _resolvedImpitClass: any = null;

/** Resolves the best available fetch implementation for the current environment.
 * - Native `globalThis.fetch`: used in browsers, React Native, and Node 18+
 * - `node-fetch`: dynamically imported as a fallback for older Node.js environments
 */
async function resolveImpitClass() {
	if (_resolvedImpitClass) return _resolvedImpitClass;

	try {
		const mod = await import("impit");
		// Handle CJS/ESM interop: named export may not be synthesized for CJS modules
		const ImpitClass = mod.Impit ?? (mod.default as any)?.Impit;

		if (!ImpitClass) {
			throw new Error(
				`Impit class not found in module exports. Available keys: [${Object.keys(mod).join(", ")}]` +
					(mod.default ? `, default keys: [${Object.keys(mod.default).join(", ")}]` : "")
			);
		}

		_resolvedImpitClass = ImpitClass;
		return ImpitClass;
	} catch (error) {
		throw new ProcessError({
			code: "IMPIT_IMPORT_FAILED",
			message: error instanceof Error ? `Failed to import impit: ${error.message}` : "Failed to import impit native module",
			expose: false
		});
	}
}
async function resolveFetch(agent: RequestInit["agent"]): Promise<UniversalFetch> {
	const useBareFetch = !isNode() || isBrowser();
	// If fetch is already resolved and either we're in a browser environment
	//  until an agent is specified (which requires new Impit instance), return the cached fetch
	if (_resolvedFetch && (useBareFetch || agent == undefined)) return _resolvedFetch;

	// Use normal fetch if aba
	if (typeof globalThis.fetch === "function" && useBareFetch) {
		// Native fetch available — bind to globalThis to preserve context
		_resolvedFetch = globalThis.fetch.bind(globalThis) as unknown as UniversalFetch;
	} else {
		// For Node.js use Impit (Rust-based HTTP client with browser TLS fingerprinting)
		try {
			const Impit = await resolveImpitClass();
			const proxyUrl = extractProxyUrl(agent);
			const BrowserClient = new Impit({ browser: "firefox", proxyUrl });
			_resolvedFetch = BrowserClient.fetch.bind(BrowserClient) as unknown as UniversalFetch;
		} catch (error) {
			// Re-throw ProcessErrors from resolveImpitClass directly
			if (error instanceof ProcessError) throw error;
			throw new ProcessError({
				code: "FETCH_NOT_AVAILABLE",
				message:
					error instanceof Error
						? `No fetch implementation found: ${error.message}`
						: "No fetch implementation found. Use an environment with native fetch support or install impit.",
				expose: false
			});
		}
	}

	return _resolvedFetch;
}
function createRequestCacheKey(request: RequestInfo | URL, method: string = "GET"): string {
	const urlString = typeof request === "string" ? request : request.toString();
	return Crypto.createHash("md5").update(`${method.toUpperCase()}:${urlString}`).digest("hex");
}

/** Clone a Response into a plain serializable object for caching */
async function serializeResponse(response: Response): Promise<CachedResponse> {
	const cloned = response.clone?.() ?? response; // Clone if possible to avoid consuming the body
	const body = await cloned.text();
	const headers: [string, string][] = [];
	cloned.headers.forEach((value, key) => {
		headers.push([key, value]);
	});
	return { body, status: cloned.status, statusText: cloned.statusText, headers };
}

/** Reconstruct a standard Response from a cached entry */
function reconstructResponse(cached: CachedResponse): Response {
	return new Response(cached.body, {
		status: cached.status,
		statusText: cached.statusText,
		headers: new Headers(cached.headers)
	});
}

/** Extracts the proxy URL string from an http-proxy-agent / https-proxy-agent / socks-proxy-agent.
 * All three have a `.proxy` property (URL object).
 */
function extractProxyUrl(agent?: RequestInit["agent"]): string | undefined {
	if (!agent) return undefined;

	const proxy = (agent as any).proxy;

	// HttpProxyAgent / HttpsProxyAgent → proxy is a URL object
	if (proxy instanceof URL) return proxy.href;
	if (typeof proxy === "string") return proxy;
	if (proxy?.href) return proxy.href;

	// SocksProxyAgent → proxy is { host, port, type, userId?, password? }
	if (proxy && typeof proxy === "object" && "host" in proxy && "type" in proxy) {
		const socksType: Record<number, string> = { 4: "socks4", 5: "socks5" };
		const protocol = socksType[proxy.type] ?? "socks5";
		const auth = proxy.userId
			? proxy.password
				? `${encodeURIComponent(proxy.userId)}:${encodeURIComponent(proxy.password)}@`
				: `${encodeURIComponent(proxy.userId)}@`
			: "";
		const port = proxy.port ? `:${proxy.port}` : "";
		return `${protocol}://${auth}${proxy.host}${port}`;
	}

	return undefined;
}

/** Handle HTTPS request requestResponse */
export async function handleResponse<GeneticResponse = any, GeneticError = any>(requestResponse: Response) {
	// Get the content type from the requestResponse headers
	const contentType = requestResponse.headers.get("content-type");

	// Check if the requestResponse status indicates success
	if (requestResponse.ok) {
		// If the requestResponse is OK, parse based on content type
		if (contentType?.includes("application/json")) {
			try {
				// Return the parsed JSON requestResponse
				return (await requestResponse.json()) as Promise<GeneticResponse>;
			} catch (error: any) {
				throw new HttpError({
					code: "FETCH_JSON_PARSE_ERROR",
					message: error instanceof Error ? `Error parsing JSON: ${error.message}` : "Error parsing JSON",
					statusCode: 500,
					expose: false
				});
			}
		} else {
			// Handle non-JSON requestResponse types
			return (await requestResponse.text()) as unknown as Promise<GeneticResponse>;
		}
	}

	// If the requestResponse indicates an error, create an ProcessError
	let fetchError: GeneticError | string;

	// Read the body once as text, then attempt JSON parse.
	// Avoids consuming the body twice (clone() may not be available, e.g. Impit responses).
	const errorBody = await requestResponse.text();
	try {
		fetchError = JSON.parse(errorBody) as GeneticError;
	} catch {
		fetchError = errorBody;
	}

	// Throw an ProcessError with details from the failed requestResponse
	throw new HttpError({
		code: "FETCH_REQUEST_ERROR",
		statusCode: requestResponse.status,
		message: `Fetch request failed with status ${requestResponse.status}: ${requestResponse.statusText}`,
		details: fetchError,
		expose: false
	});
}

/** Make an application fetch request */
export async function appFetch(request: RequestInfo | URL, options: RequestInit = {}) {
	const { cacheTTL, customCacheKey, ...fetchableOptions } = options;

	// Resolve cache key (includes HTTP method to prevent collisions between GET/POST for the same URL)
	const method = (options.method ?? "GET").toUpperCase();
	const cacheEnabled = cacheTTL != null && cacheTTL > 0;
	const cacheKey = cacheEnabled ? (customCacheKey ?? createRequestCacheKey(request, method)) : undefined;

	// ── Cache read ──────────────────────────────────────────────────────────
	if (cacheKey) {
		const cached = CACHE.get<CachedResponse>(cacheKey);
		if (cached) return reconstructResponse(cached);
	}

	const fetch = await resolveFetch(fetchableOptions.agent);

	// Set default options for proper cookie handling
	const defaultOptions: RequestInit = {
		method: "GET",
		// credentials: 'include', // Include cookies in the request
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json"
		}
	};

	// Merge with user options
	const mergedOptions: RequestInit = {
		...defaultOptions,
		...fetchableOptions,
		headers: normalizeHeaders(
			fetchableOptions.clean
				? ((fetchableOptions.headers as Record<string, string>) ?? {})
				: {
						...(defaultOptions.headers as Record<string, string>),
						...((fetchableOptions.headers as Record<string, string>) || {})
					}
		)
	};

	// Handle API request method
	const response = await fetch(request, mergedOptions);

	// ── Cache write (only successful responses) ─────────────────────────────
	if (cacheKey && cacheTTL && response.ok) {
		// Serialize in the background — doesn't block the caller
		serializeResponse(response).then((serialized) => {
			CACHE.set(cacheKey, serialized, cacheTTL);
		});
	}

	return response;
}

/** Fetch with timeout
 * @see {@link appFetch} for fetch behavior
 * @default timeout 1000ms
 * - Aborts the request if it takes longer than the specified timeout
 * - Useful for preventing hanging requests and improving responsiveness
 * - If the request is aborted due to timeout, it throws an AbortError which can be caught and handled by the caller
 */
export async function fetchWithTimeout(request: RequestInfo | URL, options: RequestTimeoutInit) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), options.timeout || 1000);

	try {
		const response = await appFetch(request, { signal: controller.signal, ...options });
		clearTimeout(timeoutId);
		return response;
	} catch (error) {
		clearTimeout(timeoutId);
		throw error;
	}
}

export async function fetchWithRetry(request: RequestInfo | URL, options: RequestRetryInit) {
	const { maxAttempts = 0, retryTimeout = 800, ...fetchOptions } = options;
	let attempt = 0;
	let fetched = false;
	let requestResponse: Response | null = null;
	while (attempt <= maxAttempts && !fetched) {
		try {
			requestResponse = await appFetch(request, fetchOptions);
			fetched = true; // Mark as fetched if successful
		} catch (error) {
			if (attempt === maxAttempts) {
				throw error; // Rethrow the error if max retries reached
			}
			await delay(retryTimeout); // Wait before retrying
			attempt++;
		}
	}

	if (requestResponse === null) {
		throw new ProcessError({
			code: "FETCH_RETRY_FAILED",
			message: "Failed to retrieve the requestResponse after maximum retries",
			expose: false
		});
	}
	return requestResponse;
}

/** Fetch and handle HTTPS request requestResponse
 * - Makes a fetch request using appFetch and processes the response with handleResponse
 * - Returns the parsed response if successful, or throws an error if the request fails
 * - Useful for making API requests and automatically handling response parsing and error handling in a consistent way across the application
 * @see {@link appFetch} for fetch behavior
 * @see {@link handleResponse} for response handling behavior
 */
export async function fetchResponse<GeneticResponse = any, GeneticError = any>(request: RequestInfo | URL, options?: RequestInit) {
	// Make the API fetch request
	const requestResponse = await appFetch(request, options);

	// Handle the requestResponse
	return handleResponse<GeneticResponse, GeneticError>(requestResponse);
}

/** Fetch with retry mechanism
 * @see {@link fetchResponse} for fetch behavior
 * @default "{maxAttempts : 1}" 1 retries
 * @default "{retryTimeout : 800}" 800ms between retries
 * - Retries the request a specified number of times with delay
 * - If the request fails after all retries, it throws the last encountered error
 * - Useful for handling transient network issues or temporary server unavailability
 */
export async function fetchResponseWithRetry<GeneticResponse = any, GeneticError = any>(
	request: RequestInfo | URL,
	options: RequestRetryInit
): Promise<GeneticResponse> {
	const { maxAttempts = 0, retryTimeout = 800, ...fetchOptions } = options;
	let attempt = 0;
	let fetched = false;
	let requestResponse: GeneticResponse | null = null;

	while (attempt <= maxAttempts && !fetched) {
		try {
			requestResponse = await fetchResponse<GeneticResponse, GeneticError>(request, fetchOptions);
			fetched = true; // Mark as fetched if successful
		} catch (error) {
			if (attempt === maxAttempts) {
				throw error; // Rethrow the error if max retries reached
			}
			await delay(retryTimeout); // Wait before retrying
			attempt++;
		}
	}

	if (requestResponse === null) {
		throw new ProcessError({
			code: "FETCH_RETRY_FAILED",
			message: "Failed to retreive the requestResponse after maximum retries",
			expose: false
		});
	}
	return requestResponse;
}

/** Fetch and handle HTTPS request requestResponse with timeout
 * @see {@link fetchWithTimeout} for timeout behavior
 * @see {@link handleResponse} for response handling behavior
 * - Executes request with timeout and handles response parsing
 * - Combines the functionality of fetchWithTimeout and handleResponse to provide a convenient way to make requests with timeout and automatic response handling
 * - If the request is successful within the timeout, it returns the parsed response
 * - If the request fails or times out, it throws the corresponding error which can be caught and handled by the caller
 */
export async function fetchResponseWithTimeout<GeneticResponse = any, GeneticError = any>(request: RequestInfo | URL, options: RequestTimeoutInit) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), options.timeout);

	try {
		const response = await fetchResponse<GeneticResponse, GeneticError>(request, {
			...options,
			signal: controller.signal
		});
		clearTimeout(timeoutId);
		// Handle the requestResponse
		return response;
	} catch (error) {
		clearTimeout(timeoutId);
		throw error;
	}
}

/** Serializable representation of an HTTP response for cross-env caching */
type CachedResponse = {
	body: string;
	status: number;
	statusText: string;
	headers: [string, string][];
};
/** Universal fetch type compatible with both native fetch and node-fetch */
type UniversalFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type RequestRetryInit = RequestInit & {
	maxAttempts?: number;
	retryTimeout?: number;
};
export type RequestTimeoutInit = Omit<RequestInit, "signal"> & {
	timeout?: number;
};
export type RequestInfo = globalThis.RequestInfo;
export type Response = globalThis.Response;
export { RequestInit };
