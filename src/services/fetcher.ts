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
import type { HttpProxyAgent } from "http-proxy-agent";
import type { HttpsProxyAgent } from "https-proxy-agent";
import type { SocksProxyAgent } from "socks-proxy-agent";

import { ProxyConfig, isResolverProxy, proxyAgentOf } from "../types/input/Proxy.ts";
import { CACHE } from "./cache.ts";
import { CookieJar, hostLimiter, rateLimitedFor, noteRateLimit, parseRetryAfter } from "./httpControls.ts";
import {
	CachedResponse,
	UniversalFetch,
	MAX_CACHEABLE_BODY,
	createRequestCacheKey,
	serializeResponse,
	reconstructResponse,
	extractProxyUrl,
	safeHost,
	forwardAbort
} from "../utils/fetch.ts";
import { delay, isBrowser, isNode, normalizeHeaders } from "../utils/standard.ts";
import { HttpError } from "../types/HttpError.ts";
import { ProcessError } from "../types/ProcessError.ts";

// declare module "node-fetch" {
declare module "impit" {
	// Extend the existing RequestInit interface to include custom properties
	interface RequestInit {
		/** Clean request with no defualt headers options attached
		 * default headers include "Content-Type": "application/json" and "Accept": "application/json"
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
		/** Use Impit instead of native fetch */
		useImpit?: boolean;
		/** Cookie jar: attaches the host's cookies and captures Set-Cookie. */
		cookieJar?: CookieJar;
		/** Cap concurrent in-flight requests to this URL's host (provider default 10). */
		maxHostConcurrency?: number;
		/** Honor 429 `Retry-After`: wait briefly, else throw an HttpError 429 (provider default on). */
		honorRateLimit?: boolean;
		/** Dedupe identical in-flight cacheable GETs into one request (provider default on). */
		coalesce?: boolean;
		/** Proxy applied at dispatch: an agent (`{ agent, auth? }`) sets the dispatcher and a
		 *  `Proxy-Authorization` header; a resolver (`{ resolver, headers? }`) rewrites the URL to a
		 *  proxy endpoint and attaches its headers. The rewrite is dispatch-only, so cache key /
		 *  cookie jar / rate-limit stay bound to the logical target host. */
		proxy?: ProxyConfig;
	}
}

/** In-flight cacheable GETs, so identical concurrent requests share one fetch. */
const _inflight = new Map<string, Promise<CachedResponse>>();

/** Native fetch, bound once (browser / React Native / Node without a proxy need). */
let _bareFetch: UniversalFetch | null = null;
let _resolvedImpitClass: any = null;

/** Impit clients keyed by proxy URL ("" = no proxy).
 *  A single shared slot used to hand an unproxied request the client bound to the
 *  last proxy that was configured, silently routing traffic through a third party.
 */
const _impitClients = new Map<string, UniversalFetch>();
/** Cap on distinct proxy clients kept alive — each one is a native Rust addon instance. */
const MAX_IMPIT_CLIENTS = 16;

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
async function ImpitClass() {
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
	// Impit is only used on Node.js
	// Browsers / React Native: native fetch, bound to globalThis to preserve context
	if ((!isNode() || isBrowser()) && typeof globalThis.fetch === "function") {
		return (_bareFetch ??= globalThis.fetch.bind(globalThis) as unknown as UniversalFetch);
	}

	// For Node.js use Impit (Rust-based HTTP client with browser TLS fingerprinting)
	const proxyUrl = extractProxyUrl(agent) ?? "";
	const cached = _impitClients.get(proxyUrl);
	if (cached) return cached;
	else {
		try {
			const Impit = await ImpitClass();
			const BrowserClient = new Impit({
				browser: "firefox",
				proxyUrl: proxyUrl || undefined,
				// Avoid failing on expired ssl
				ignoreTlsErrors: true
			});
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
}

/** Make an application fetch request */
export async function appFetch(request: RequestInfo | URL, options: RequestInit = {}) {
	const { cacheTTL, customCacheKey, useImpit = true, cookieJar, maxHostConcurrency, honorRateLimit, coalesce, proxy, ...fetchableOptions } = options;

	// Resolve the proxy: an agent sets the dispatcher (proxy agent wins over an explicit `agent`),
	// a resolver rewrites the URL at dispatch and both may contribute request headers.
	const resolverProxy = isResolverProxy(proxy) ? proxy : undefined;
	const agentProxy = proxy && !isResolverProxy(proxy) ? proxy : undefined;
	const agent = proxyAgentOf(proxy) ?? fetchableOptions.agent;

	// Resolve cache key (includes HTTP method to prevent collisions between GET/POST for the same URL)
	const method = (options.method ?? "GET").toUpperCase();
	const cacheEnabled = cacheTTL != null && cacheTTL > 0;
	const cacheKey = cacheEnabled ? (customCacheKey ?? createRequestCacheKey(request, method)) : undefined;

	// Cache read if available
	if (cacheKey) {
		const cached = CACHE.get<CachedResponse>(cacheKey);
		if (cached) return reconstructResponse(cached);
	}

	const host = safeHost(request);

	// ── Rate-limit gate: wait out a short 429 window, else throw ─────
	if (honorRateLimit && host) {
		const waitMs = rateLimitedFor(host);
		if (waitMs != null) {
			if (waitMs <= 1500) await delay(waitMs);
			else
				throw new HttpError({
					code: "RATE_LIMITED",
					statusCode: 429,
					message: `Rate limited for ${host} (~${Math.ceil(waitMs / 1000)}s)`,
					expose: false
				});
		}
	}

	// Resolve fetch instance
	const fetch: UniversalFetch = useImpit ? await resolveFetch(agent) : (global.fetch.bind(globalThis) as unknown as UniversalFetch);

	// Set default options for proper cookie handling
	const targetDefaultOptions: RequestInit = {
		method: "GET",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json"
		}
	};
	// Target request headers (UA, provider headers, cookies). An agent proxy adds its
	// Proxy-Authorization here since the request still travels to the target through the tunnel.
	const targetHeaders = normalizeHeaders(
		fetchableOptions.clean
			? { ...((fetchableOptions.headers as Record<string, string>) ?? {}), ...(agentProxy?.auth && { "Proxy-Authorization": agentProxy.auth }) }
			: {
					...(targetDefaultOptions.headers as Record<string, string>),
					...((fetchableOptions.headers as Record<string, string>) || {}),
					...(agentProxy?.auth && { "Proxy-Authorization": agentProxy.auth })
				}
	) as Record<string, string>;

	if (cookieJar && host) {
		const jarCookie = cookieJar.header(host);
		if (jarCookie) targetHeaders.cookie = targetHeaders.cookie ? `${targetHeaders.cookie}; ${jarCookie}` : jarCookie;
	}

	// Resolver proxy: the request goes to the PROXY endpoint, so the wire carries the proxy's OWN
	// headers only. The target headers are handed to the resolver (kept separate) to forward.
	const dispatch = resolverProxy
		? resolverProxy.resolver(request, { method, headers: targetHeaders, body: fetchableOptions.body as unknown as BodyInit | null | undefined })
		: request;
	const headers = resolverProxy ? (normalizeHeaders(resolverProxy.headers ?? {}) as Record<string, string>) : targetHeaders;

	// Resolver proxy: hit the endpoint with a plain GET carrying only the proxy's own headers —
	// the target method/headers/body were handed to the resolver to encode. Keep the abort signal.
	// Otherwise: keep the request's method/body, apply target headers + the resolved proxy agent.
	const mergedOptions: RequestInit = resolverProxy
		? { method: "GET", headers, signal: fetchableOptions.signal }
		: { ...targetDefaultOptions, ...fetchableOptions, headers, agent };

	// cookie capture and 429 back-off recording afterwards.
	const runFetch = async (): Promise<Response> => {
		const doFetch = () => fetch(dispatch, mergedOptions);
		const limiter = maxHostConcurrency && host ? hostLimiter(host, maxHostConcurrency) : null;
		const response = limiter ? await limiter(doFetch) : await doFetch();
		if (cookieJar && host) cookieJar.setFromResponse(host, response.headers);
		if (response.status === 429 && host) noteRateLimit(host, parseRetryAfter(response.headers.get("retry-after")) || 30000);
		return response;
	};

	// Coalesce identical cacheable GETs into one request
	if (coalesce && cacheKey && method === "GET") {
		const existing = _inflight.get(cacheKey);
		if (existing) return reconstructResponse(await existing);
		const p = (async () => {
			const response = await runFetch();
			const serialized = await serializeResponse(response);
			if (cacheTTL && response.ok && serialized.body.length <= MAX_CACHEABLE_BODY) CACHE.set(cacheKey, serialized, cacheTTL);
			return serialized;
		})().finally(() => _inflight.delete(cacheKey));
		_inflight.set(cacheKey, p);
		return reconstructResponse(await p);
	}

	// Fetch without coalescing, but still cache the response if applicable
	const response = await runFetch();

	// Cache write (only successful responses)
	if (cacheKey && cacheTTL && response.ok) {
		// Return a reconstructed Response so the body is never consumed by the caller
		// (Impit's clone() may not produce an independent body stream).
		const serialized = await serializeResponse(response);
		if (serialized.body.length <= MAX_CACHEABLE_BODY) CACHE.set(cacheKey, serialized, cacheTTL);
		return reconstructResponse(serialized);
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

/** Fetch with retry mechanism
 * @see {@link appFetch} for fetch behavior
 * @default "{maxAttempts : 1}" 1 retries
 * @default "{retryTimeout : 800}" 800ms between retries
 * - Retries the request a specified number of times with delay
 * - If the request fails after all retries, it throws the last encountered error
 * - Useful for handling transient network issues or temporary server unavailability
 */
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
