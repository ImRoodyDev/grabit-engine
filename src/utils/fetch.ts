import type { RequestInit } from "impit";

/**
 * Stateless low-level fetch helpers split out of `services/fetcher.ts`:
 * cache keys, response (de)serialization, proxy-URL extraction, abort bridging.
 */

type RequestInfo = globalThis.RequestInfo;
type Response = globalThis.Response;

/** Serializable representation of an HTTP response for cross-env caching. */
export type CachedResponse = {
	body: string;
	status: number;
	statusText: string;
	headers: [string, string][];
};

/** Universal fetch type compatible with both native fetch and impit. */
export type UniversalFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Largest response body (in characters) eligible for caching — 256 KB. */
export const MAX_CACHEABLE_BODY = 256 * 1024;

/** Cache key for a request (method + URL). */
export function createRequestCacheKey(request: RequestInfo | URL, method: string = "GET"): string {
	const urlString = typeof request === "string" ? request : request.toString();
	return createStableHash(`${method.toUpperCase()}:${urlString}`);
}

/** Fast deterministic non-cryptographic hash used only for cache keys. */
export function createStableHash(input: string): string {
	let hash = 5381;
	for (let i = 0; i < input.length; i++) {
		hash = (hash * 33) ^ input.charCodeAt(i);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Clone a Response into a plain serializable object for caching. */
export async function serializeResponse(response: Response): Promise<CachedResponse> {
	const cloned = response.clone?.() ?? response; // Clone if possible to avoid consuming the body
	const body = await cloned.text();
	const headers: [string, string][] = [];
	cloned.headers.forEach((value, key) => {
		headers.push([key, value]);
	});
	return { body, status: cloned.status, statusText: cloned.statusText, headers };
}

/** Reconstruct a standard Response from a cached entry. */
export function reconstructResponse(cached: CachedResponse): Response {
	return new Response(cached.body, {
		status: cached.status,
		statusText: cached.statusText,
		headers: new Headers(cached.headers)
	});
}

/** Extracts the proxy URL string from an http/https/socks proxy agent. */
export function extractProxyUrl(agent?: RequestInit["agent"]): string | undefined {
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

/** Best-effort host of a request, for cookie / rate-limit / concurrency keys. */
export function safeHost(request: RequestInfo | URL): string | null {
	try {
		const url = typeof request === "string" ? new URL(request) : request instanceof URL ? request : new URL((request as Request).url);
		return url.host;
	} catch {
		return null;
	}
}

/**
 * Bridges an external abort signal onto an internal controller. Hermes has no
 * `AbortSignal.any`, so a timeout controller and a caller's cancel signal are
 * linked by hand: aborting either aborts the request.
 */
export function forwardAbort(controller: AbortController, external?: AbortSignal | null): void {
	if (!external) return;
	if (external.aborted) return controller.abort();
	external.addEventListener("abort", () => controller.abort(), { once: true });
}
