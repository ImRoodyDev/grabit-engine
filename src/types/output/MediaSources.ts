/**
 * This module defines TypeScript types for media sources and subtitle sources, including their properties and CORS policy details.
 * The `MediaSource` type represents a media source with its file name, playlist information, and CORS policy details, while the `SubtitleSource` type represents a subtitle source with its file name, available languages, and CORS policy details.
 * The `SourceProvider` interface defines the structure for both media and subtitle providers, including the scheme, provider name, language, format, and CORS policy details.
 * The `InternalMediaSource` and `InternalSubtitleSource` types are derived from the `MediaSource` and `SubtitleSource` types, respectively, with certain properties omitted or made optional for internal use.
 */
export interface SourceProvider<T = string> {
	scheme: string;
	providerName: string;
	language: string;
	format: T;
	fileName: string;
	xhr: {
		haveCorsPolicy: boolean;
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
	playlist:
		| {
				bandwidth: number;
				dimensions: `${number}x${number}`;
				resolution: `${number}p` | string;
				source: string;
		  }[]
		| string;
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

export type InternalMediaSource = Omit<MediaSource, "providerName" | "scheme" | "format"> & Partial<Pick<MediaSource, "format">>;
export type InternalSubtitleSource = Omit<SubtitleSource, "providerName" | "scheme">;
