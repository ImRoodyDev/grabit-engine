import { extractExtension } from "../utils/extractor.ts";
import { default as ISO6391 } from "iso-639-1";
import { normalizeHeaders } from "../utils/standard.ts";
import { Provider } from "../models/provider.ts";
import {
	InternalIProviderModuleWorkers,
	IProviderModuleWorkers,
	ProviderModule,
	ProviderModuleManifest,
	MediaSource,
	InternalMediaSource,
	SubtitleSource,
	ScrapeRequester,
	ProviderContext,
	isProcessError
} from "../types/index.ts";
import { validateManifestConfiguration } from "../utils/validator.ts";
import { sortByTargetLanguage } from "../utils/internal.ts";

function describeProviderWorkerError(workerName: "getStreams" | "getLazyStreams" | "getSubtitles", manifest: ProviderModuleManifest, error: unknown) {
	const base = `Provider ${manifest.name} ${workerName} failed`;

	if (isProcessError(error)) {
		const details = typeof error.details === "string" ? error.details : undefined;
		return {
			summary: `${base} [${error.code}]: ${error.message}`,
			details
		};
	}

	if (error instanceof Error) {
		return {
			summary: `${base}: ${error.message}`,
			details: error.stack
		};
	}

	return {
		summary: `${base}: ${String(error)}`,
		details: undefined
	};
}

/**
 *  Define a provider module ,
 *  This function is used to create provider modules mostly used by extension in index file
 */
export function defineProviderModule(_this: Provider, manifest: ProviderModuleManifest, workers: InternalIProviderModuleWorkers): ProviderModule {
	return {
		meta: manifest,
		provider: _this,
		workers: createModuleWorkers(_this, manifest, workers)
	};
}

/** Augment a provider-returned media source (resolved OR lazy) with the engine-managed
 *  fields: format, display fileName, User-Agent header, scheme and providerName. */
function augmentMediaSource(source: InternalMediaSource, manifest: ProviderModuleManifest, provider: Provider, userAgent?: string): MediaSource {
	const format = source.format ?? ((typeof source.playlist === "string" ? (extractExtension(source.playlist) ?? "m3u8") : "m3u8") as MediaSource["format"]);
	return {
		...source,
		xhr: {
			...source.xhr,
			headers: normalizeHeaders({ ...source.xhr?.headers, "User-Agent": userAgent })
		},
		format,
		fileName: `[${manifest.name}][${format.toUpperCase()}] - ${ISO6391.getName(source.language)} - ${source.fileName ?? "Source"} `,
		providerName: manifest.name,
		scheme: provider.config.scheme
	} as MediaSource;
}

function createModuleWorkers(provider: Provider, manifest: ProviderModuleManifest, workers: InternalIProviderModuleWorkers): IProviderModuleWorkers {
	validateManifestConfiguration(provider, manifest);
	const shouldValidate = provider.config.xhr?.validateSources === true;

	return {
		cleanup: workers.cleanup,
		getStreams: workers.getStreams
			? async (requester, context) => {
					try {
						const sources = await workers.getStreams!(requester, context);
						const withMeta = sources.map((source) => augmentMediaSource(source, manifest, provider, requester.userAgent));
						const sorted = sortByTargetLanguage(withMeta, requester.targetLanguageISO);
						if (!shouldValidate) return sorted;
						return validateMediaSources(sorted, requester, context);
					} catch (error) {
						const logEntry = describeProviderWorkerError("getStreams", manifest, error);
						context.log.error(logEntry.summary);
						if (logEntry.details) {
							context.log.debug(`Provider ${manifest.name} getStreams details`, logEntry.details);
						}
						throw error;
					}
				}
			: undefined,
		// Lazy listing: augment each handle like getStreams but never validate — lazy sources
		// have no URL yet (resolved on play via resolveLazy).
		getLazyStreams: workers.getLazyStreams
			? async (requester, context) => {
					try {
						const sources = await workers.getLazyStreams!(requester, context);
						const withMeta = sources.map((source) => augmentMediaSource(source, manifest, provider, requester.userAgent));
						return sortByTargetLanguage(withMeta, requester.targetLanguageISO);
					} catch (error) {
						const logEntry = describeProviderWorkerError("getLazyStreams", manifest, error);
						context.log.error(logEntry.summary);
						if (logEntry.details) {
							context.log.debug(`Provider ${manifest.name} getLazyStreams details`, logEntry.details);
						}
						throw error;
					}
				}
			: undefined,
		getSubtitles: workers.getSubtitles
			? async (requester, context) => {
					try {
						const sources = await workers.getSubtitles!(requester, context);
						const withMeta = sources.map((source) => ({
							...source,
							xhr: {
								...source.xhr,
								headers: normalizeHeaders({
									...source.xhr?.headers,
									"User-Agent": requester.userAgent
								})
							},
							fileName: `[${manifest.name}][${source.format.toUpperCase()}] - ${source.fileName ?? "Subtitles"} `,
							providerName: manifest.name,
							scheme: provider.config.scheme
						}));
						const sorted = sortByTargetLanguage(withMeta, requester.targetLanguageISO);
						if (!shouldValidate) return sorted;
						return validateSubtitleSources(sorted, requester, context);
					} catch (error) {
						const logEntry = describeProviderWorkerError("getSubtitles", manifest, error);
						context.log.error(logEntry.summary);
						if (logEntry.details) {
							context.log.debug(`Provider ${manifest.name} getSubtitles details`, logEntry.details);
						}
						throw error;
					}
				}
			: undefined,
		// Lazy resolution: shape the single resolved source like getStreams.
		resolveLazy: workers.resolveLazy
			? async (id, context, requester) => {
					const source = await workers.resolveLazy!(id, context, requester);
					if (!source) return null;
					return augmentMediaSource(source, manifest, provider, requester.userAgent);
				}
			: undefined
	};
}

/**
 * Validates each media source by performing a HEAD/GET request against the playlist URL.
 * Sources that do not return a successful response are filtered out.
 */
async function validateMediaSources(sources: MediaSource[], requester: ScrapeRequester, context: ProviderContext): Promise<MediaSource[]> {
	const results = await Promise.all(
		sources.map(async (source) => {
			// Lazy sources have no URL yet; the host resolves them on play, so keep them unvalidated.
			if (source.lazy) return source;
			const url = typeof source.playlist === "string" ? source.playlist : source.playlist?.[0]?.source;
			if (!url) return null;
			const { ok } = await context.xhr.status(url, { attachUserAgent: true, headers: source.xhr.headers }, requester);
			return ok ? source : null;
		})
	);
	return results.filter((s): s is MediaSource => s !== null);
}

/**
 * Validates each subtitle source by performing a HEAD/GET request against the URL.
 * Sources that do not return a successful response are filtered out.
 */
async function validateSubtitleSources(sources: SubtitleSource[], requester: ScrapeRequester, context: ProviderContext): Promise<SubtitleSource[]> {
	const results = await Promise.all(
		sources.map(async (source) => {
			if (!source.url) return null;
			const { ok } = await context.xhr.status(source.url, { attachUserAgent: true, headers: source.xhr.headers }, requester);
			return ok ? source : null;
		})
	);
	return results.filter((s): s is SubtitleSource => s !== null);
}
