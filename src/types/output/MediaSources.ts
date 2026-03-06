/**
 * Represents the result of fetching subtitle streams, including the stream itself and the online providers that offer it.
 * - `stream`: The subtitle stream, which can be of various formats (e.g., srt, vtt) or null if not available.
 * - `onlineProviders`: An array of online providers that offer the subtitle stream, each with its provider name, language, and format.
 * 	*/
export interface SourceProvider<T = string> {
	scheme: string;
	providerName: string;
	language: string;
	format: T;
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
	fileName: string;
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
export type SubtitleSource = Omit<SourceProvider<"srt" | "vtt">, "language"> & {
	fileName: string;
	language: string;
	languageName: string;
	url: string;
};

export type InternalMediaSource = Omit<MediaSource, "providerName" | "scheme" | "format"> & Partial<Pick<MediaSource, "format">>;
export type InternalSubtitleSource = Omit<SubtitleSource, "providerName" | "scheme">;
