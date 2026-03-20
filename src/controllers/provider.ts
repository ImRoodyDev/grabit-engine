import { extractExtension } from "../utils/extractor.ts";
import { default as ISO6391 } from "iso-639-1";
import { normalizeHeaders } from "../utils/standard.ts";
import { Provider } from "../models/provider.ts";
import type { ScrapeRequester } from "../types/input/Requester.ts";
import type { MediaSource, SubtitleSource } from "../types/output/MediaSources.ts";
import type { ProviderContext } from "../types/models/Context.ts";
import type { InternalIProviderModuleWorkers, IProviderModuleWorkers, ProviderModule, ProviderModuleManifest } from "../types/models/Modules.ts";
import { isProcessError } from "../types/ProcessError.ts";
import { validateManifestConfiguration } from "../utils/providerValidation.ts";
import { sortByTargetLanguage } from "../utils/internal.ts";

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
			const { ok } = await context.xhr.status(source.url, { attachUserAgent: true, attachProxy: true, headers: source.xhr.headers }, requester);
			return ok ? source : null;
		})
	);
	return results.filter((s): s is SubtitleSource => s !== null);
}
