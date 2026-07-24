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
import { CACHE } from "./cache.ts";
import { delay, isBrowser, isNode, normalizeHeaders } from "../utils/standard.ts";
import { HttpError } from "../types/HttpError.ts";
import { ProcessError } from "../types/ProcessError.ts";
import type { RequestInit } from "impit";
import type { HttpProxyAgent } from "http-proxy-agent";
import type { HttpsProxyAgent } from "https-proxy-agent";
import type { SocksProxyAgent } from "socks-proxy-agent";

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

/** Native fetch, bound once (browser / React Native / Node without a proxy need). */
let _bareFetch: UniversalFetch | null = null;
/** Impit clients keyed by proxy URL ("" = no proxy).
 *  A single shared slot used to hand an unproxied request the client bound to the
 *  last proxy that was configured, silently routing traffic through a third party.
 */
const _impitClients = new Map<string, UniversalFetch>();
/** Cap on distinct proxy clients kept alive — each one is a native Rust addon instance. */
const MAX_IMPIT_CLIENTS = 16;
let _resolvedImpitClass: any = null;

/** The single seam through which the optional native Impit module is loaded.
 *
 * `new Function` hides this import() from Metro's static analyzer. A plain
 * `await import("impit")` would cause Metro to add the native Rust addon to the
 * bundle graph, crashing the Expo serializer with "The 'to' argument must be of
 * type string. Received undefined". In React Native, resolveFetch() never reaches
 * this function because the bare-fetch branch always wins (isNode() === false).
 *
 * The same trick hides the import from Jest's module registry, so tests override
 * `load` here rather than using `jest.mock`.
 */
export const __moduleLoader = {
	load: (id: string): Promise<any> => (new Function("i", "return import(i)") as (i: string) => Promise<any>)(id)
};

/** Test helper: drops every cached fetch implementation. */
export function __resetFetchClientsForTests(): void {
	_bareFetch = null;
	_impitClients.clear();
	_resolvedImpitClass = null;
}

/** Resolves the Impit class, loading the optional native module on first use. */
async function resolveImpitClass() {
	if (_resolvedImpitClass) return _resolvedImpitClass;

	try {
		const mod = await __moduleLoader.load("impit");
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
/** Resolves the fetch implementation to use for one request.
 *  Impit clients are cached per proxy URL so a proxied client is never reused for an
 *  unproxied request — or for a different proxy — and so each proxy pays the
 *  (expensive) native client construction only once.
 */
async function resolveFetch(agent?: RequestInit["agent"]): Promise<UniversalFetch> {
	const useBareFetch = (!isNode() || isBrowser()) && typeof globalThis.fetch === "function";

	// Browsers / React Native: native fetch, bound to globalThis to preserve context
	if (useBareFetch) {
		return (_bareFetch ??= globalThis.fetch.bind(globalThis) as unknown as UniversalFetch);
	}

	// For Node.js use Impit (Rust-based HTTP client with browser TLS fingerprinting)
	const proxyUrl = extractProxyUrl(agent) ?? "";
	const cached = _impitClients.get(proxyUrl);
	if (cached) return cached;

	try {
		const Impit = await resolveImpitClass();
		const BrowserClient = new Impit({ browser: "firefox", proxyUrl: proxyUrl || undefined });
		const impitFetch = BrowserClient.fetch.bind(BrowserClient) as unknown as UniversalFetch;

		// Evict the oldest client when callers churn through many distinct proxies
		while (_impitClients.size >= MAX_IMPIT_CLIENTS) {
			const oldestKey = _impitClients.keys().next().value;
			if (oldestKey === undefined) break;
			_impitClients.delete(oldestKey);
		}
		_impitClients.set(proxyUrl, impitFetch);
		return impitFetch;
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
function createRequestCacheKey(request: RequestInfo | URL, method: string = "GET"): string {
	const urlString = typeof request === "string" ? request : request.toString();
	return createStableHash(`${method.toUpperCase()}:${urlString}`);
}

/** Fast deterministic non-cryptographic hash used only for cache keys. */
function createStableHash(input: string): string {
	let hash = 5381;
	for (let i = 0; i < input.length; i++) {
		hash = (hash * 33) ^ input.charCodeAt(i);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
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

/** Largest response body (in characters) eligible for caching — 256 KB. */
const MAX_CACHEABLE_BODY = 256 * 1024;

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
		// Serialize the response synchronously, cache it, and return a reconstructed
		// Response so the original body is never consumed by the caller — this avoids
		// "Body has already been read" errors with runtimes/libraries (e.g. Impit)
		// whose Response.clone() may not produce fully independent body streams.
		const serialized = await serializeResponse(response);
		// The cache is bounded by entry count, not bytes — skip oversized bodies so a
		// few thousand large scraped pages cannot exhaust memory on a mobile device.
		if (serialized.body.length <= MAX_CACHEABLE_BODY) CACHE.set(cacheKey, serialized, cacheTTL);
		return reconstructResponse(serialized);
	}

	return response;
}

/** Bridges an external abort signal onto an internal controller. Hermes has no
 * `AbortSignal.any`, so a timeout controller and a caller's cancel signal are
 * linked by hand: aborting either aborts the request.
 */
function forwardAbort(controller: AbortController, external?: AbortSignal | null): void {
	if (!external) return;
	if (external.aborted) return controller.abort();
	external.addEventListener("abort", () => controller.abort(), { once: true });
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
	forwardAbort(controller, options.signal); // also abort when the caller cancels

	try {
		const response = await appFetch(request, { ...options, signal: controller.signal });
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
			// Don't retry a cancelled request — the caller aborted on purpose.
			if (fetchOptions.signal?.aborted || attempt === maxAttempts) {
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
			// Don't retry a cancelled request — the caller aborted on purpose.
			if (fetchOptions.signal?.aborted || attempt === maxAttempts) {
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
	forwardAbort(controller, options.signal); // also abort when the caller cancels

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
export type RequestTimeoutInit = RequestInit & {
	timeout?: number;
};
export type RequestInfo = globalThis.RequestInfo;
export type Response = globalThis.Response;
export { RequestInit };
