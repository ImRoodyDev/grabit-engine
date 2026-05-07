import type { ProviderManagerConfig } from "../models/Manager.ts";
import type { RawScrapeRequester, ScrapeRequester } from "../input/Requester.ts";
import type { MediaSource, SubtitleSource } from "../output/MediaSources.ts";
import type { ProcessError } from "../ProcessError.ts";
import type { HttpError } from "../HttpError.ts";
import type { ProviderModuleManifest } from "../models/Modules.ts";

export type SourcesError = ProcessError | HttpError;

/** Which source types to scrape. */
export type ScrapeType = "media" | "subtitle" | "both";

/**
 * Configuration accepted by the `useSources` hook.
 */
export interface UseSourcesConfig {
	/** Configuration used to create/reuse the `GrabitManager` singleton. */
	managerConfig: ProviderManagerConfig;

	/**
	 * When `true`, calling `scrape()` fetches from **all** providers
	 * (ignoring `scrapeConfig.successQuorum`) and pushes each provider's
	 * results into state as they arrive, so the user sees the list grow
	 * incrementally instead of waiting for everything at once.
	 *
	 * The scrape can be cancelled early via `stopContinuousScraping()`.
	 *
	 * @default false
	 */
	continuous?: boolean;

	/**
	 * Which source category to fetch.
	 *
	 * - `"media"` — only media streams (`MediaSource[]`)
	 * - `"subtitle"` — only subtitle streams (`SubtitleSource[]`)
	 * - `"both"` — fetch both in parallel
	 *
	 * @default "both"
	 */
	type?: ScrapeType;
}

/**
 * Return value of the `useSources` hook.
 */
export interface UseSourcesReturn {
	/** Accumulated media sources (de-duplicated by `scheme + providerName + fileName`). */
	mediaSources: MediaSource[];

	/** Accumulated subtitle sources (de-duplicated by `scheme + providerName + fileName`). */
	subtitleSources: SubtitleSource[];

	/** `true` while the manager is initialising **or** a scrape is in-flight. */
	isLoading: boolean;

	/** `true` when the manager has been created and is ready to scrape. */
	isManagerReady: boolean;

	/** `true` while a continuous scrape is in progress (providers still resolving). */
	isContinuousScraping: boolean;

	/** The last error (manager init **or** scrape), or `null`. */
	error: SourcesError | null;

	/**
	 * Trigger a scrape for the given requester.
	 *
	 * Clears any previously collected sources before starting.
	 * In continuous mode, results stream in per-provider.
	 * In normal mode, results arrive all at once.
	 */
	scrape: (requester: RawScrapeRequester) => Promise<void>;

	/**
	 * Cancel an in-progress continuous scrape.
	 * Already-collected sources are kept. No-op if not scraping.
	 */
	stopContinuousScraping: () => void;

	/** Clear all collected media **and** subtitle sources. */
	clearSources: () => void;

	/**
	 * Returns the manifests of all active providers that are compatible with
	 * the given `type` and `requester`. Useful for building a provider-picker
	 * UI before or during a scrape. Returns an empty array when the manager
	 * is not yet ready.
	 */
	getAvailableProviders: (type: ProviderModuleManifest["type"], requester: ScrapeRequester) => ProviderModuleManifest[];

	/**
	 * Scrape a **single** provider by its scheme identifier.
	 *
	 * Results are merged into `mediaSources` / `subtitleSources` without
	 * clearing them first. Respects the `type` option — only the relevant
	 * worker(s) are invoked. Cancellable by a subsequent `scrape()` call
	 * or `stopContinuousScraping()`.
	 */
	scrapeProvider: (requester: RawScrapeRequester, providerScheme: string) => Promise<void>;
}
