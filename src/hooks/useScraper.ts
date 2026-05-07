import { useCallback, useEffect, useRef, useState } from "react";
import type { GrabitManager } from "../controllers/manager.ts";
import type { RawScrapeRequester } from "../types/input/Requester.ts";
import type { MediaSource, SubtitleSource } from "../types/output/MediaSources.ts";
import type { ScrapeType } from "../types/hooks/useSources.ts";
import { ProcessError } from "../types/ProcessError.ts";
import type { SourcesError } from "../types/hooks/useSources.ts";

function sourceKey(source: { scheme: string; providerName: string; fileName: string }): string {
	return `${source.scheme}\0${source.providerName}\0${source.fileName}`;
}

function mergeSources<T extends { scheme: string; providerName: string; fileName: string }>(existing: T[], incoming: T[]): T[] {
	const map = new Map<string, T>();
	for (const s of existing) map.set(sourceKey(s), s);
	for (const s of incoming) map.set(sourceKey(s), s);
	return Array.from(map.values());
}

export interface UseScraperOptions {
	manager: GrabitManager | null;
	type: ScrapeType;
	continuous: boolean;
}

/**
 * Internal hook that encapsulates the scraping logic.
 *
 * - Normal mode: `scrape(requester)` fetches all results then sets state.
 * - Continuous mode: `scrape(requester)` ignores `successQuorum` and streams
 *   each provider's results into state as they arrive.
 * - Calling `scrape()` again (or `stopContinuousScraping()`) cancels any
 *   in-flight operations and, for a new scrape, clears previous sources.
 */
export function useScraper(options: UseScraperOptions) {
	const { manager, type, continuous } = options;

	const [mediaSources, setMediaSources] = useState<MediaSource[]>([]);
	const [subtitleSources, setSubtitleSources] = useState<SubtitleSource[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [isContinuousScraping, setIsContinuousScraping] = useState(false);
	const [error, setError] = useState<SourcesError | null>(null);

	const mountedRef = useRef(true);
	const managerRef = useRef(manager);
	/** Monotonically increasing id — used to discard state updates from stale scrapes. */
	const scrapeIdRef = useRef(0);

	useEffect(() => {
		managerRef.current = manager;
	}, [manager]);

	const stopContinuousScraping = useCallback(() => {
		scrapeIdRef.current++;
		setIsContinuousScraping(false);
		setIsLoading(false);
		managerRef.current?.closeOperations();
	}, []);

	const scrape = useCallback(
		async (requester: RawScrapeRequester) => {
			const mgr = managerRef.current;
			if (!mgr) return;

			mgr.closeOperations();
			const currentId = ++scrapeIdRef.current;

			setMediaSources([]);
			setSubtitleSources([]);
			setIsLoading(true);
			setError(null);

			if (continuous) {
				setIsContinuousScraping(true);
			}

			try {
				if (continuous) {
					const promises: Promise<unknown>[] = [];

					if (type === "media" || type === "both") {
						promises.push(
							mgr.getStreamsProgressive(requester, (sources) => {
								if (!mountedRef.current || scrapeIdRef.current !== currentId) return;
								setMediaSources((prev) => mergeSources(prev, sources));
							})
						);
					}

					if (type === "subtitle" || type === "both") {
						promises.push(
							mgr.getSubtitlesProgressive(requester, (sources) => {
								if (!mountedRef.current || scrapeIdRef.current !== currentId) return;
								setSubtitleSources((prev) => mergeSources(prev, sources));
							})
						);
					}

					await Promise.all(promises);
				} else {
					const [mediaResult, subtitleResult] = await Promise.all([
						type === "media" || type === "both" ? mgr.getStreams(requester) : Promise.resolve([] as MediaSource[]),
						type === "subtitle" || type === "both" ? mgr.getSubtitles(requester) : Promise.resolve([] as SubtitleSource[])
					]);

					if (!mountedRef.current || scrapeIdRef.current !== currentId) return;
					setMediaSources(mediaResult);
					setSubtitleSources(subtitleResult);
				}
			} catch (err) {
				if (!mountedRef.current || scrapeIdRef.current !== currentId) return;
				setError(err instanceof ProcessError ? err : new ProcessError({ code: "SCRAPE_ERROR", message: String(err) }));
			} finally {
				if (mountedRef.current && scrapeIdRef.current === currentId) {
					setIsLoading(false);
					setIsContinuousScraping(false);
				}
			}
		},
		[type, continuous]
	);

	/**
	 * Scrape a single provider by its scheme identifier.
	 *
	 * Results are **merged** into existing state without clearing it first,
	 * so this can be called after a full `scrape()` to top-up a specific
	 * provider. Respects the `type` option — only the relevant worker(s) are
	 * invoked. The operation is discarded if a concurrent `scrape()` call
	 * has incremented the scrape ID.
	 */
	const scrapeProvider = useCallback(
		async (requester: RawScrapeRequester, providerScheme: string) => {
			const mgr = managerRef.current;
			if (!mgr) return;

			// Snapshot the current ID — a targeted scrape does not reset shared
			// state or increment the ID; it is cancelled by any subsequent full
			// scrape or stopContinuousScraping() call.
			const currentId = scrapeIdRef.current;

			setIsLoading(true);
			setError(null);

			try {
				const [newMedia, newSubs] = await Promise.all([
					type === "media" || type === "both" ? mgr.getStreamsByScheme(providerScheme, requester) : Promise.resolve([] as MediaSource[]),
					type === "subtitle" || type === "both" ? mgr.getSubtitlesByScheme(providerScheme, requester) : Promise.resolve([] as SubtitleSource[])
				]);

				if (!mountedRef.current || scrapeIdRef.current !== currentId) return;

				if (type === "media" || type === "both") {
					setMediaSources((prev) => mergeSources(prev, newMedia));
				}
				if (type === "subtitle" || type === "both") {
					setSubtitleSources((prev) => mergeSources(prev, newSubs));
				}
			} catch (err) {
				if (!mountedRef.current || scrapeIdRef.current !== currentId) return;
				setError(err instanceof ProcessError ? err : new ProcessError({ code: "SCRAPE_ERROR", message: String(err) }));
			} finally {
				if (mountedRef.current && scrapeIdRef.current === currentId) {
					setIsLoading(false);
				}
			}
		},
		[type]
	);

	const clearSources = useCallback(() => {
		setMediaSources([]);
		setSubtitleSources([]);
	}, []);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			managerRef.current?.closeOperations();
		};
	}, []);

	return {
		mediaSources,
		subtitleSources,
		isLoading,
		isContinuousScraping,
		error,
		scrape,
		scrapeProvider,
		stopContinuousScraping,
		clearSources
	} as const;
}
