import { useCallback } from "react";
import { useManager } from "./useManager.ts";
import { useScraper } from "./useScraper.ts";
import type { UseSourcesConfig, UseSourcesReturn } from "../types/hooks/useSources.ts";
import type { ProviderModuleManifest } from "../types/models/Modules.ts";
import type { RawScrapeRequester, ScrapeRequester } from "../types/input/Requester.ts";
import type { MediaSource } from "../types/output/MediaSources.ts";

export type { UseSourcesConfig, UseSourcesReturn, ScrapeType } from "../types/hooks/useSources.ts";

// Manager lifecycle primitives — exported so applications can drive the singleton
// directly (e.g. pre-warm it on app start via `acquireManager`, or consume it in a
// custom hook via `useManager`) instead of only through `useSources`.
export { useManager, acquireManager, releaseManager } from "./useManager.ts";
// Config type consumers need to call `acquireManager` / `useManager`.
export type { ProviderManagerConfig } from "../types/models/Manager.ts";

/**
 * React hook that wraps `GrabitManager` for declarative
 * media & subtitle scraping inside React / React Native components.
 *
 * @example
 * ```tsx
 * const { mediaSources, subtitleSources, isLoading, scrape, stopContinuousScraping } = useSources({
 *   managerConfig: { source: mySource, tmdbApiKeys: [KEY] },
 *   continuous: true,
 *   type: "both",
 * });
 *
 * // Later, trigger a scrape with a requester:
 * scrape({ media: { type: "movie", tmdbId: "550" }, targetLanguageISO: "en" });
 * ```
 */
export function useSources(config: UseSourcesConfig): UseSourcesReturn {
	const { managerConfig, continuous = false, type = "both" } = config;

	const { manager, isInitializing, initError } = useManager(managerConfig);

	const {
		mediaSources,
		subtitleSources,
		isLoading: isScraping,
		isContinuousScraping,
		error: scrapeError,
		scrape,
		scrapeProvider,
		stopContinuousScraping,
		clearSources
	} = useScraper({ manager, type, continuous });

	/**
	 * Returns the manifests of all active providers that are compatible with
	 * the given `type` and `requester`. Useful for building a provider-picker
	 * UI before or during a scrape. Returns an empty array when the manager
	 * is not yet ready.
	 */
	const getAvailableProviders = useCallback(
		(type: ProviderModuleManifest["type"], requester: ScrapeRequester): ProviderModuleManifest[] => {
			if (!manager) return [];
			return manager.getProvidersByRequest(type, requester).map((m) => m.meta);
		},
		[manager]
	);

	/**
	 * Resolve a lazy source on play. `scheme` + `id` come from the lazy handle
	 * (`source.scheme`, `source.lazy.id`); the requester re-supplies the media context.
	 * Returns the fully-shaped source, or null when it can't be resolved / manager not ready.
	 */
	const resolveLazySource = useCallback(
		async (scheme: string, id: string, requester: RawScrapeRequester): Promise<MediaSource | null> => {
			if (!manager) return null;
			return manager.resolveLazySource(scheme, id, requester);
		},
		[manager]
	);

	return {
		mediaSources,
		subtitleSources,
		isLoading: isInitializing || isScraping,
		isManagerReady: manager !== null,
		isContinuousScraping,
		error: initError ?? scrapeError,
		scrape,
		scrapeProvider,
		stopContinuousScraping,
		clearSources,
		getAvailableProviders,
		resolveLazySource
	};
}

