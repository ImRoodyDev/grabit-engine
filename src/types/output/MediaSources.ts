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

/** Media format tags a resolved source can carry. */
export type MediaFormat = "m3u8" | "dash" | "mp4" | "webm" | "mkv" | "flv" | "avi" | "mov";

/** A resolved playlist: adaptive variants, or a single playlist/file URL. */
export type MediaPlaylist =
	| {
			bandwidth: number;
			dimensions: `${number}x${number}`;
			resolution: `${number}p` | string;
			source: string;
	  }[]
	| string;

/**
 * A fully resolved, playable media source. Has a `playlist` and never a `lazy`.
 */
export type ResolvedMediaSource = SourceProvider<MediaFormat> & {
	/** Adaptive variants, or a single playlist/file URL. */
	playlist: MediaPlaylist;
	lazy?: never;
};

/**
 * A lazy media source: no playlist yet. The host resolves it on play by calling the
 * provider's resolveLazy with `lazy.id`. Has a `lazy` and never a `playlist`.
 */
export type LazyMediaSource = SourceProvider<MediaFormat> & {
	lazy: LazySource;
	playlist?: never;
};

/**
 * A media source is either resolved (playable now) or lazy (resolved on play).
 * Discriminate with `source.lazy`: truthy means lazy, otherwise it has a playlist.
 */
export type MediaSource = ResolvedMediaSource | LazyMediaSource;

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

/** Provider-side fields; the engine augments each with scheme/providerName/format. */
type InternalMediaBase = Omit<SourceProvider<MediaFormat>, "scheme" | "providerName" | "format"> & { format?: MediaFormat };

/** Provider-side resolved source: has a playlist, never a lazy. */
export type InternalResolvedMediaSource = InternalMediaBase & { playlist: MediaPlaylist; lazy?: never };

/** Provider-side lazy handle: sets `lazy`, omits `playlist`. */
export type InternalLazyMediaSource = InternalMediaBase & { lazy: LazySource; playlist?: never };

/** What a provider's getStreams returns per source: resolved or lazy. */
export type InternalMediaSource = InternalResolvedMediaSource | InternalLazyMediaSource;
export type InternalSubtitleSource = Omit<SubtitleSource, "providerName" | "scheme">;
