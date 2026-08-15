import type { HttpsProxyAgent } from "https-proxy-agent";
import type { SocksProxyAgent } from "socks-proxy-agent";
import type { HttpProxyAgent } from "http-proxy-agent";

/** Agent-based proxy: route the request through an http/https/socks proxy agent. */
export type ProxyAgentConfig = {
	/** Proxy agent used as the request's dispatcher. */
	agent: HttpsProxyAgent<string> | SocksProxyAgent | HttpProxyAgent<string>;
	/** Optional `Proxy-Authorization` header for header-authenticating proxies
	 *  (URL-embedded `user:pass@` creds work through the agent itself). */
	auth?: string;
};

/** Request info handed to a proxy resolver so it can build the endpoint URL. */
export type ProxyResolverRequest = {
	method: string;
	headers: Record<string, string>;
	body?: BodyInit | null;
};

/** Resolver-based proxy: rewrite each request to a proxy endpoint that fetches
 *  the target for you (e.g. a web proxy that takes the target as `?url=`). */
export type ProxyResolverConfig = {
	/** Builds the proxy endpoint URL from the target url and its request options. */
	resolver: (url: globalThis.RequestInfo | URL, request: ProxyResolverRequest) => string | URL;
	/** Optional headers attached to every proxied request (e.g. an API key). */
	headers?: Record<string, string>;
};

/** Proxy configuration: either a proxy agent or a URL resolver. */
export type ProxyConfig = ProxyAgentConfig | ProxyResolverConfig;

/** True when the proxy routes by rewriting the URL to a proxy endpoint. */
export function isResolverProxy(proxy?: ProxyConfig): proxy is ProxyResolverConfig {
	return typeof (proxy as ProxyResolverConfig | undefined)?.resolver === "function";
}

/** The proxy agent when agent-based, else undefined (resolver proxies have no agent). */
export function proxyAgentOf(proxy?: ProxyConfig): ProxyAgentConfig["agent"] | undefined {
	return proxy && !isResolverProxy(proxy) ? proxy.agent : undefined;
}
