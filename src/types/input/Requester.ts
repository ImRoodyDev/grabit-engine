import type { HttpsProxyAgent } from "https-proxy-agent";
import type { SocksProxyAgent } from "socks-proxy-agent";
import type { HttpProxyAgent } from "http-proxy-agent";
import type { Media, MovieMedia, SerieMedia, ChannelMedia } from "./Media.ts";

/** Requester information for a media request
 * - userAgent: The user agent string of the requester
 * - media: The media information being requested
 * - targetLanguageISO: ISO code for the target language (e.g., "en", "fr", "es")
 */
export type ScrapeRequester = {
	/** Media information being requested */
	media: Media;
	/** Language ISO code for the target language (e.g., "en", "fr", "es") */
	targetLanguageISO: string;
	/**
	 * (Optional)User agent string of the requester,
	 * This will be used to pass into the provider context xhr for provider handlers, allowing them to make requests with the same user agent as the requester. This can help with providers that have user agent-based restrictions or optimizations.
	 */
	userAgent?: string;
	/** Optional proxy agent for making requests through a proxy */
	proxyAgent?: HttpsProxyAgent<string> | SocksProxyAgent | HttpProxyAgent<string>;
	/** Optional User IP address of the requester */
	userIP?: string;
};

/** Raw Requester information for a media request `(Non-validated)`
 * - userAgent: The user agent string of the requester
 * - media: The media information being requested
 * - targetLanguageISO: ISO code for the target language (e.g., "en", "fr", "es")
 */
export type RawScrapeRequester = {
	/** Media information being requested */
	media: RequesterMedia;
	/** Language ISO code for the target language (e.g., "en", "fr", "es") */
	targetLanguageISO: string;
	/**
	 * (Optional)User agent string of the requester,
	 * This will be used to pass into the provider context xhr for provider handlers, allowing them to make requests with the same user agent as the requester. This can help with providers that have user agent-based restrictions or optimizations.
	 */
	userAgent?: string;
	/** Optional proxy agent for making requests through a proxy */
	proxyAgent?: HttpsProxyAgent<string> | SocksProxyAgent | HttpProxyAgent<string>;
	/** Optional User IP address of the requester */
	userIP?: string;
};

export type RequesterMovieMedia = Pick<MovieMedia, "type" | "tmdbId"> & Partial<MovieMedia>;
export type RequesterSerieMedia = Pick<SerieMedia, "type" | "tmdbId" | "ep_tmdbId" | "season" | "episode"> & Partial<SerieMedia>;
export type RequesterChannelMedia = ChannelMedia;
export type RequesterMedia = RequesterMovieMedia | RequesterSerieMedia | RequesterChannelMedia;
