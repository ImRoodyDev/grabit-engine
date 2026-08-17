/**
 * This module defines TypeScript types for media sources and subtitle sources, including their properties and CORS policy details.
 * The `MediaSource` type represents a media source with its file name, playlist information, and CORS policy details, while the `SubtitleSource` type represents a subtitle source with its file name, available languages, and CORS policy details.
 * The `SourceProvider` interface defines the structure for both media and subtitle providers, including the scheme, provider name, language, format, and CORS policy details.
 * The `InternalMediaSource` and `InternalSubtitleSource` types are derived from the `MediaSource` and `SubtitleSource` types, respectively, with certain properties omitted or made optional for internal use.
 */
/**
 * Playback/consumption constraints on a resolved source. Replaces the old
 * `haveCorsPolicy` boolean — providers set the flags that apply, host acts on them.
 */
export type SourceFlag =
	| "CORS_BLOCKED" // direct browser fetch blocked by CORS; route via a proxy
	| "IP_LOCKED" // URL bound to the scraper IP; play from the same IP/proxy
	| "GEO_BLOCKED" // region-restricted origin
	| "REFERER_LOCKED" // needs the Referer from `xhr.headers` to play
	| "PROXY_ONLY" // only playable through a proxy
	| "EXTERNAL"; // hand off to an external player/browser

export interface SourceProvider<T = string> {
	scheme: string;
	providerName: string;
	language: string;
	format: T;
	fileName: string;
	xhr: {
		/** Consumption hints for the host (see {@link SourceFlag}). */
		flags: SourceFlag[];
		headers: Record<string, string>;
	};
}

/**
 * Represents a media source, including its file name, playlist information, and CORS policy details.
 * - `fileName`: The name of the media file.
 * - `playlist`: Information about the media playlist, which can be an array of objects containing bandwidth, dimensions, resolution, and source URL, or a string representing the playlist URL.
 * - `xhr`: An object containing details about the CORS policy, including whether it has a CORS policy and any relevant headers.
 * The `format` property in the `SourceProvider` interface can be one of several media formats, such as 'm3u8', 'dash', 'mp4', 'webm', 'mkv', 'flv', 'avi', 'mov' for media sources, and 'srt', 'vtt' for subtitle sources.
 * The `MediaStreamResult` type combines the media stream and its online providers, while the `SourceProvider` interface defines the structure for both media and subtitle providers.
 */
export type MediaSource = SourceProvider<"m3u8" | "dash" | "mp4" | "webm" | "mkv" | "flv" | "avi" | "mov"> & {
	/** Resolved playlist */
	playlist:
		| {
				bandwidth: number;
				dimensions: `${number}x${number}`;
				resolution: `${number}p` | string;
				source: string;
		  }[]
		| string;
	/** When set, the host resolves the playlist on play via the provider's resolveLazy. */
	lazy?: LazySource;
};

/**
 * Represents a subtitle source, including its file name, available languages, and CORS policy details.
 * - `fileName`: The name of the subtitle file.
 * - `sources`: An array of objects representing the available subtitle sources, each containing the language code, language name, and URL for the subtitle file.
 * - `xhr`: An object containing details about the CORS policy, including whether it has a CORS policy and any relevant headers.
 * The `format` property in the `SourceProvider` interface can be one of several media formats, such as 'm3u8', 'dash', 'mp4', 'webm', 'mkv', 'flv', 'avi', 'mov' for media sources, and 'srt', 'vtt' for subtitle sources.
 * The `MediaStreamResult` type combines the media stream and its online providers, while the `SourceProvider` interface defines the structure for both media and subtitle providers.
 */
export type SubtitleSource = SourceProvider<"srt" | "vtt"> & {
	languageName: string;
	url: string;
};

/**
 * Lazy source: return an unresolved handle and let the host resolve the
 * final URL only when the user hits play. `id` is opaque to the host and passed back
 * to the provider's optional `resolveLazy(id, ctx)`.
 */
export type LazySource = { id: string; label?: string };

// Inherits the optional `playlist` and `lazy` from MediaSource: a lazy source omits
// `playlist` and sets `lazy`, a normal source sets `playlist` and omits `lazy`.
export type InternalMediaSource = Omit<MediaSource, "providerName" | "scheme" | "format"> & Partial<Pick<MediaSource, "format">>;
export type InternalSubtitleSource = Omit<SubtitleSource, "providerName" | "scheme">;
