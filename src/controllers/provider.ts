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
	SubtitleSource,
	ScrapeRequester,
	ProviderContext,
	isProcessError
} from "../types/index.ts";
import { validateManifestConfiguration } from "../utils/validator.ts";

function describeProviderWorkerError(workerName: "getStreams" | "getSubtitles", manifest: ProviderModuleManifest, error: unknown) {
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

function createModuleWorkers(provider: Provider, manifest: ProviderModuleManifest, workers: InternalIProviderModuleWorkers): IProviderModuleWorkers {
	validateManifestConfiguration(provider, manifest);
	const shouldValidate = provider.config.xhr?.validateSources === true;

	return {
		cleanup: workers.cleanup,
		getStreams: workers.getStreams
			? async (requester, context) => {
					try {
						const sources = await workers.getStreams!(requester, context);
						const withMeta = sources.map((source) => {
							const format =
								source.format ?? ((typeof source.playlist === "string" ? (extractExtension(source.playlist) ?? "m3u8") : "m3u8") as MediaSource["format"]);
							return {
								...source,
								xhr: {
									...source.xhr,
									headers: normalizeHeaders({
										...source.xhr?.headers,
										"User-Agent": requester.userAgent
									})
								},
								format: format,
								fileName: `[${manifest.name}][${format.toUpperCase()}] - ${ISO6391.getName(source.language)} - ${source.fileName ?? "Source"} `,
								providerName: manifest.name,
								scheme: provider.config.scheme
							};
						});
						if (!shouldValidate) return withMeta;
						return validateMediaSources(withMeta, requester, context);
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
						if (!shouldValidate) return withMeta;
						return validateSubtitleSources(withMeta, requester, context);
					} catch (error) {
						const logEntry = describeProviderWorkerError("getSubtitles", manifest, error);
						context.log.error(logEntry.summary);
						if (logEntry.details) {
							context.log.debug(`Provider ${manifest.name} getSubtitles details`, logEntry.details);
						}
						throw error;
					}
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
			const url = typeof source.playlist === "string" ? source.playlist : source.playlist[0]?.source;
			if (!url) return null;
			const { ok } = await context.xhr.status(url, { attachUserAgent: true, attachProxy: true, headers: source.xhr.headers }, requester);
			return ok ? source : null;
		})
	);
	return (
		results
			.filter((s): s is MediaSource => s !== null)
			// Sort entries to prioritize those matching the requester's target language
			.sort((a, b) => {
				const aMatch = a.language === requester.targetLanguageISO ? 0 : 1;
				const bMatch = b.language === requester.targetLanguageISO ? 0 : 1;
				return aMatch - bMatch;
			})
	);
}

/**
 * Validates each subtitle source by performing a HEAD/GET request against the URL.
 * Sources that do not return a successful response are filtered out.
 */
async function validateSubtitleSources(sources: SubtitleSource[], requester: ScrapeRequester, context: ProviderContext): Promise<SubtitleSource[]> {
	const results = await Promise.all(
		sources.map(async (source) => {
			if (!source.url) return null;
			const { ok } = await context.xhr.status(source.url, { attachUserAgent: true, attachProxy: true, headers: source.xhr.headers }, requester);
			return ok ? source : null;
		})
	);
	return (
		results
			.filter((s): s is SubtitleSource => s !== null)
			// Sort entries to prioritize those matching the requester's target language
			.sort((a, b) => {
				const aMatch = a.language === requester.targetLanguageISO ? 0 : 1;
				const bMatch = b.language === requester.targetLanguageISO ? 0 : 1;
				return aMatch - bMatch;
			})
	);
}
