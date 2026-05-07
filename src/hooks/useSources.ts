import { useCallback } from "react";
import { useManager } from "./useManager.ts";
import { useScraper } from "./useScraper.ts";
import type { UseSourcesConfig, UseSourcesReturn } from "../types/hooks/useSources.ts";
import type { ProviderModuleManifest } from "../types/models/Modules.ts";
import type { ScrapeRequester } from "../types/input/Requester.ts";

export type { UseSourcesConfig, UseSourcesReturn, ScrapeType } from "../types/hooks/useSources.ts";

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
		getAvailableProviders
	};
}

