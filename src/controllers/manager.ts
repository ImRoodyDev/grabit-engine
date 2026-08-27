import cheerioCore from "../core/cheerio.ts";
import puppeteerCore, { disableHeadlessMode } from "../core/puppeteer.ts";
import { configurePuppeteerPool, releasePuppeteerPool, retainPuppeteerPool } from "./puppeteerPool.ts";
import xhrCore from "../core/xhr.ts";
import { solveChallenge } from "../core/solver.ts";
import {
	ScrapeRequester,
	MediaSource,
	SubtitleSource,
	ProviderModule,
	ProviderModuleManifest,
	RawScrapeRequester,
	resolveFetchControls
} from "../types/index.ts";
import { ProviderContext } from "../types/models/Context.ts";
import { ProviderManagerConfig, IProviderManagerWorkers } from "../types/models/Manager.ts";
import { DebugLogger, Logger } from "../utils/logger.ts";
import { excuteWithRetries, isDevelopment, isNode, secondsToMilliseconds } from "../utils/standard.ts";
import { formatTimestamp, sortByTargetLanguage } from "../utils/internal.ts";
import { isSourceCached } from "../services/cache.ts";
import pLimit, { LimitFunction } from "p-limit";
import { ModuleManager, ProviderHealthReport, ProviderMetrics } from "./module.ts";
import { TMDB } from "../services/tmdb.ts";

// Hermes (React Native) has AbortController but not the static AbortSignal.abort();
// p-limit's rejectOnClear path calls it in clearQueue(), crashing with
// "undefined is not a function". Define a spec-equivalent shim when missing.
{
	const AS = AbortSignal as unknown as { abort?: (reason?: unknown) => AbortSignal };
	if (typeof AS !== "undefined" && typeof AS.abort !== "function") {
		AS.abort = (reason?: unknown): AbortSignal => {
			const controller = new AbortController();
			controller.abort(reason);
			return controller.signal;
		};
	}
}

/**
 * GrabitManager is the main class responsible
 * for managing provider modules, including loading, caching, refreshing, and health monitoring.
 */
export class GrabitManager extends ModuleManager implements IProviderManagerWorkers {
	private static logger: DebugLogger;
	private static context: ProviderContext;
	private static instance: GrabitManager;
	/**
	 * In-flight `create()` call. The instance is published synchronously before the
	 * `await` on module loading, so a second concurrent `create()` used to receive a
	 * manager with zero providers while the first was still fetching — easy to hit with
	 * React StrictMode's double-mount or two screens mounting at once. Callers now await
	 * the same promise.
	 */
	private static pending: Promise<GrabitManager> | null = null;
	private limiters: LimitFunction[] = [];
	/** One controller per active operation; aborted by `closeOperations` to cancel in-flight fetches. */
	private operationControllers: AbortController[] = [];

	private constructor(config: ProviderManagerConfig) {
		super(config);
		Logger.enableDebugging(config.debug ?? isDevelopment());
		GrabitManager.logger = new DebugLogger(config.debug ?? isDevelopment(), "GrabitManager");
		// The Puppeteer pool is process-global, so it is reference-counted: only the
		// first manager sizes it, and only the last one to be destroyed shuts it down.
		if (retainPuppeteerPool()) configurePuppeteerPool(config.scrapeConfig?.puppeteer);
		else GrabitManager.logger.debug("Puppeteer pool already held by another manager — keeping its existing configuration");

		GrabitManager.context = GrabitManager.createContext();

		// Initialize the TMDB API with the provided keys and optional cache TTL
		TMDB.init(config.tmdbApiKeys, { cacheTTL: config.cache?.TMDB_TTL });
	}

	/** Creates a new provider manager singleton instance */
	public static async create(config: ProviderManagerConfig): Promise<GrabitManager> {
		if (GrabitManager.instance) {
			GrabitManager.logger?.debug("GrabitManager instance already exists. Returning existing instance.");
			return GrabitManager.instance;
		}
		// A create() is already running — join it instead of racing a second one.
		if (GrabitManager.pending) return GrabitManager.pending;

		GrabitManager.pending = GrabitManager.initialize(config).finally(() => {
			GrabitManager.pending = null;
		});
		return GrabitManager.pending;
	}

	/** Builds the singleton. Always invoked through {@link GrabitManager.create}. */
	private static async initialize(config: ProviderManagerConfig): Promise<GrabitManager> {
		const manager = new GrabitManager(config);
		GrabitManager.instance = manager;

		try {
			// `isSourceCached` only proves an entry existed a moment ago; `loadModules`
			// re-reads it and can still miss (expired between the two calls, or caching
			// disabled). Its result was previously discarded, which left the manager with
			// zero providers and no fetch to recover.
			const loadedFromCache = isSourceCached(config.source) && manager.loadModules();
			if (!loadedFromCache) {
				await manager.initializeModules();
				manager.saveModules();
			}

			// Restore previously persisted health metrics (if available)
			manager.restoreMetrics();

			// One-shot cleanup of expired persisted bundles, so stale storage is cleared
			// even when autoUpdate is off (e.g. native without autoUpdateOnNative).
			// Fire-and-forget: it self-handles errors and must not delay readiness.
			void manager.prunePersistentStore();

			// Start auto-update service
			manager.startAutoUpdateService();
			return manager;
		} catch (error) {
			// Never leave a half-built singleton behind — the next create() would return it
			// instead of retrying. The constructor already claimed a pool holder slot, so
			// give it back or the pool can never shut down.
			releasePuppeteerPool();
			GrabitManager.instance = undefined!;
			throw error;
		}
	}

	/** Disable headless mode in Puppeteer */
	public static disableHeadlessMode(disable: boolean = true): void {
		disableHeadlessMode(disable);
	}

	/** Create provider context based on environment
	 * This method initializes the provider context with necessary utilities such as Cheerio for HTML parsing, fetchers for HTTP requests, and Puppeteer for headless browser automation. It checks if the environment is Node.js to conditionally include Puppeteer, ensuring compatibility across different environments.
	 */
	private static createContext(): ProviderContext {
		// If already created, return the existing context
		if (this.context) {
			this.logger.info("Provider context already created. Returning existing context.");
			return this.context;
		}

		// Check if the environment is Node.js to determine Puppeteer support
		this.logger.info(`Creating provider context. Environment: ${isNode() ? "Node.js" : "Browser"}, Puppeteer support: ${isNode() ? "Enabled" : "Disabled"}`);

		return {
			xhr: xhrCore,
			cheerio: cheerioCore,
			solveChallenge,
			puppeteer: puppeteerCore,
			log: this.logger
		};
	}

	/** Create an operation with concurrency and retry handling */
	private async createOperation<T>(
		modules: ProviderModule[],
		fn: (module: ProviderModule, limiter: LimitFunction, signal: AbortSignal) => Promise<T[]>,
		options?: { ignoreQuorum?: boolean; onPartialResult?: (result: T[]) => void }
	) {
		const {
			successQuorum,
			waitForActiveProvidersAfterQuorum = false,
			maxAttempts = 1,
			concurrentOperations = 5,
			operationTimeout = secondsToMilliseconds(15)
		} = this.config.scrapeConfig || {};
		const { ignoreQuorum = false, onPartialResult } = options ?? {};

		// Create concurrency limiter
		const limit = pLimit({
			concurrency: concurrentOperations,
			rejectOnClear: true
		});
		this.limiters.push(limit); // Keep track of limiters to clear them if needed (e.g., on timeout)

		// One abort controller per operation — its signal reaches provider fetches
		// so `closeOperations()` can cancel work that is already in flight.
		const abortController = new AbortController();
		this.operationControllers.push(abortController);

		// Collect non-empty provider results and track settled tasks
		const collected: T[][] = [];
		let settled = 0;
		let startedCount = 0;
		let providersWithResults = 0;
		let completed = false;
		let quorumReached = false;

		// Wrap the whole operation in a promise that resolves when either:
		// 1) The success quorum is reached
		// 2) All tasks have settled
		// 3) The operation timeout fires
		const operationPromise = new Promise<T[][]>((resolve) => {
			const tryResolve = () => {
				if (completed) return;

				if (!ignoreQuorum && successQuorum !== undefined && providersWithResults >= successQuorum) {
					if (!quorumReached) {
						quorumReached = true;
						// Quorum satisfied — drop queued work immediately. If configured,
						// keep waiting only for providers that already occupied a running slot.
						limit.clearQueue();
					}

					if (!waitForActiveProvidersAfterQuorum || settled >= startedCount) {
						completed = true;
						resolve(collected);
						return;
					}
				}

				// Normal path: all scheduled tasks have settled (no quorum configured)
				if (settled >= modules.length) {
					completed = true;
					resolve(collected);
				}
			};

			// Schedule each provider task inside the concurrency limiter
			for (const module of modules) {
				limit(async () => {
					startedCount++; // Increment synchronously before any await so quorum can distinguish active vs queued work.
					try {
						const result = await excuteWithRetries(() => fn(module, limit, abortController.signal), maxAttempts);
						// A provider that returns nothing is not healthy — a site redesign makes
						// selectors match nothing without throwing, and scoring that as a success
						// meant auto-disable could never trip for it.
						const produced = Array.isArray(result) && result.length > 0;
						this.recordMetrics(module.provider.config.scheme, produced);
						if (produced) {
							collected.push(result);
							providersWithResults++;
							onPartialResult?.(result);
						} else {
							GrabitManager.logger.debug(
								`Provider "${module.provider.config.scheme}" completed without ${Array.isArray(result) ? "results" : "a valid result payload"}.`
							);
						}
					} catch {
						this.recordMetrics(module.provider.config.scheme, false);
					} finally {
						settled++;
						tryResolve();
					}
				}).catch(() => {
					// Swallow pLimit rejection when the queue is cleared (quorum reached)
				});
			}

			// Edge case: no modules at all
			if (modules.length === 0) resolve(collected);
		});

		// Race against the operation timeout
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<T[][]>((resolve) => {
			timeoutId = setTimeout(() => {
				limit.clearQueue(); // drops QUEUED work only
				// Providers already occupying a concurrency slot keep fetching, parsing and
				// holding pooled browsers unless they are aborted here — and the controller is
				// dropped below, so closeOperations() would have no handle on them afterwards.
				abortController.abort();
				GrabitManager.logger.warn(
					`Operation timed out after ${operationTimeout}ms — returning ${providersWithResults} provider result set(s) collected so far`
				);
				resolve(collected);
			}, operationTimeout);
		});

		const results = await Promise.race([operationPromise, timeoutPromise]);
		clearTimeout(timeoutId); // Prevent the timer from firing after the operation completed
		const totalSources = results.reduce((count, providerResults) => count + providerResults.length, 0);
		GrabitManager.logger.info(`Operation completed: ${providersWithResults}/${modules.length} provider(s) returned results (${totalSources} total item(s))`);

		// Remove the current limiter and controller from the manager's lists to prevent memory leaks
		this.limiters = this.limiters.filter((limiter) => limiter !== limit);
		this.operationControllers = this.operationControllers.filter((controller) => controller !== abortController);

		// Join result from all providers into a single array
		return results.flat();
	}

	/** Shared scraping pipeline: resolves the requester, finds matching providers,
	 * handles the language-based media rotation, and runs `createOperation`.
	 *
	 * Every public `getStreams` / `getSubtitles` / progressive variant delegates here.
	 */
	private async scrapeProviders<T extends { language: string }>(
		rawRequester: RawScrapeRequester,
		providerType: ProviderModuleManifest["type"],
		worker: (module: ProviderModule, requester: ScrapeRequester, context: ProviderContext) => Promise<T[]>,
		operationOptions?: { ignoreQuorum?: boolean; onPartialResult?: (result: T[]) => void },
		lazyMode?: boolean
	): Promise<T[]> {
		const requester: ScrapeRequester = {
			...rawRequester,
			targetLanguageISO: rawRequester.targetLanguageISO.split("-")[0].toLowerCase(),
			media: rawRequester.media.type === "channel" ? rawRequester.media : await TMDB.createRequesterMedia(rawRequester),
			// Fall back to the manager's default proxy when the request omits one.
			proxy: rawRequester.proxy ?? this.config.proxy
		};

		const providers = this.getProvidersByRequest(providerType, requester, lazyMode);
		if (providers.length === 0) {
			GrabitManager.logger.warn(`No providers found that support ${providerType} type "${requester.media.type}" for the given request`);
			return [];
		}

		// Mapped media by language for the modules (For CACHE USE ROTATION)
		const mediaByLanguage = new Map<string, ScrapeRequester["media"]>([[requester.targetLanguageISO, requester.media]]);

		const fn = async (module: ProviderModule, _limiter: LimitFunction, signal: AbortSignal) => {
			const moduleLang = Array.isArray(module.meta.language) ? module.meta.language[0] : module.meta.language;

			// Fetch or retrieve cached media for this module's declared language.
			// When the module's language differs from the requester's, TMDB is called with
			// that language so localized titles/metadata are correct for the provider.
			let media = mediaByLanguage.get(moduleLang);
			if (!media) {
				media = rawRequester.media.type === "channel" ? requester.media : await TMDB.createRequesterMedia({ ...rawRequester, targetLanguageISO: moduleLang });
				mediaByLanguage.set(moduleLang, media);
			}

			// Build a per-invocation copy to avoid mutating the shared requester across concurrent operations.
			// Fetch controls come from the provider config (concurrency/rate-limit/coalesce on by default).
			const localRequester: ScrapeRequester = {
				...requester,
				media,
				targetLanguageISO: moduleLang,
				signal,
				fetchControls: resolveFetchControls(module.provider.config.xhr)
			};
			GrabitManager.logger.debug(`[${formatTimestamp()}] Dispatching ${providerType} scrape to provider "${module.provider.config.scheme}"`, {
				targetLanguageISO: localRequester.targetLanguageISO,
				media: localRequester.media
			});
			return await worker(module, localRequester, GrabitManager.context);
		};

		const results = await this.createOperation(providers, fn, operationOptions);
		return sortByTargetLanguage(results, requester.targetLanguageISO);
	}

	// --------------------------------------------------
	// --------------- Public API methods ---------------
	// --------------------------------------------------

	/** Close all active operations: abort in-flight fetches and drop queued work. */
	public closeOperations() {
		// Abort first so provider fetches already running are cancelled, then clear
		// the queues so nothing new starts.
		this.operationControllers.forEach((controller) => controller.abort());
		this.operationControllers = [];
		this.limiters.forEach((limiter) => limiter.clearQueue());
		this.limiters = [];
	}

	/** Tear down the manager: stop auto-updates, cancel queued operations, and release the singleton.
	 *  After calling `destroy()` a new instance can be created via `GrabitManager.create()`.
	 */
	public destroy() {
		this.stopAutoUpdateService();
		this.flushMetrics();
		this.closeOperations();
		// Reference-counted: browsers are only closed once no other manager holds the pool.
		releasePuppeteerPool();
		// CACHE is a module-level singleton shared by every manager lifecycle, and its
		// entries deliberately outlive a manager so the next create() can skip refetching.
		// Stopping its sweeper here permanently disabled expiry cleanup for the rest of the
		// process after the very first destroy — expired entries then lingered until some
		// later get()/has() happened to evict them lazily.
		GrabitManager.instance = undefined!;
		GrabitManager.context = undefined!;
		GrabitManager.logger = undefined!;
	}

	/** Returns a read-only snapshot of the current health metrics for all tracked modules */
	public getMetrics(): ReadonlyMap<string, Readonly<ProviderMetrics>> {
		return this.metrics;
	}

	/** Returns a detailed health report for all loaded modules including computed fields */
	public getMetricsReport(): ProviderHealthReport[] {
		return this.loadedModules.map((mod) => {
			const metrics = this.metrics.get(mod.provider.config.scheme) ?? { errors: 0, successes: 0, lastOperation: new Date() };
			const total = metrics.errors + metrics.successes;
			return {
				moduleName: mod.meta.name,
				errors: metrics.errors,
				successes: metrics.successes,
				totalOperations: total,
				errorRate: total > 0 ? metrics.errors / total : 0,
				active: mod.meta.active,
				lastOperation: metrics.lastOperation
			};
		});
	}

	// --------------------------------------------------
	// --------------- Worker methods ---------------
	// --------------------------------------------------

	/** Get the list of providers by the supported requester.
	 *  `lazyMode` decides which media worker counts as usable (defaults to `config.lazy`):
	 *  in lazy mode a provider needs `getLazyStreams` (or `getStreams` when
	 *  `lazyFallbackToStreams` is on), so an eager-only provider is excluded rather than run
	 *  to an empty result and penalised in its health metrics. */
	public getProvidersByRequest(type: ProviderModuleManifest["type"], requester: ScrapeRequester, lazyMode: boolean = this.config.lazy === true) {
		// Environment never changes at runtime — hoisted out of the predicate so it is
		// resolved once per call instead of once per loaded module.
		const runningOnNode = isNode();

		// Filter providers that support the requested media type and scheme
		const matchingProviders = this.loadedModules.filter((module) => {
			// In node anything is compatible
			// but in native enviroment only the universal providers should be included
			const envCompatible = runningOnNode ? true : module.meta.env === "universal";
			// Filter based on the media type. Media eligibility mirrors mediaWorker so a
			// selected provider always has a worker to run in the current (lazy?) mode.
			const typeCompatible =
				(type === "subtitle" && module.workers.getSubtitles !== undefined) || //..
				(type === "media" && this.hasUsableMediaWorker(module, lazyMode));

			// Revalidate the requester validated media if there are things missing that are required by the provider,
			//  for example if the requester media is missing ids
			const supportsMediaType = module.provider.isMediaSupported(requester.media) && module.meta.supportedMediaTypes.includes(requester.media.type);

			// If in browser environment, only include providers that are compatible with universal env
			return supportsMediaType && module.meta.active && envCompatible && typeCompatible;
		});

		// Sort providers by:
		// 1) Target language is the FIRST index in provider's language list (highest priority)
		// 2) Target language is supported (anywhere in the list)
		// 3) Provider's declared priority (lower value == higher priority)
		matchingProviders.sort((a, b) => {
			const langA = Array.isArray(a.meta.language) ? a.meta.language : [a.meta.language];
			const langB = Array.isArray(b.meta.language) ? b.meta.language : [b.meta.language];

			const getLangTier = (langs: string[]): number => {
				if (langs[0] === requester.targetLanguageISO) return 0; // Primary language match
				if (langs.includes(requester.targetLanguageISO)) return 1; // Secondary language match
				return 2; // No match
			};

			const tierA = getLangTier(langA);
			const tierB = getLangTier(langB);

			// First sort by language tier
			if (tierA !== tierB) return tierA - tierB;

			// Within the same tier, sort by declared priority (lower == higher priority)
			return (a.meta.priority ?? 0) - (b.meta.priority ?? 0);
		});
		return matchingProviders;
	}

	/** Pick the media worker for a module honoring lazy mode.
	 *  In lazy mode: `getLazyStreams` when present, optionally falling back to `getStreams`.
	 *  In normal mode: `getStreams` (a lazy-only provider produces nothing and is skipped). */
	private mediaWorker(module: ProviderModule, lazy: boolean): ((req: ScrapeRequester, ctx: ProviderContext) => Promise<MediaSource[]>) | null {
		if (lazy) return module.workers.getLazyStreams ?? (this.config.lazyFallbackToStreams !== false ? module.workers.getStreams : undefined) ?? null;
		return module.workers.getStreams ?? null;
	}

	/** Whether a module has a media worker to run in the given mode. Mirrors {@link mediaWorker}
	 *  so provider selection and dispatch never drift. */
	private hasUsableMediaWorker(module: ProviderModule, lazy: boolean): boolean {
		return this.mediaWorker(module, lazy) !== null;
	}

	public async getStreams(rawRequester: RawScrapeRequester): Promise<MediaSource[]> {
		const lazy = this.config.lazy === true;
		return this.scrapeProviders(
			rawRequester,
			"media",
			(mod, req, ctx) => {
				const worker = this.mediaWorker(mod, lazy);
				return worker ? worker(req, ctx) : Promise.resolve([]);
			},
			undefined,
			lazy
		);
	}

	/** Force lazy listing regardless of `config.lazy`. Dispatches to `getLazyStreams`
	 *  (or `getStreams` when `lazyFallbackToStreams` is enabled); each returned handle is
	 *  resolved on play via {@link resolveLazySource}. */
	public async getLazyStreams(rawRequester: RawScrapeRequester): Promise<MediaSource[]> {
		return this.scrapeProviders(
			rawRequester,
			"media",
			(mod, req, ctx) => {
				const worker = this.mediaWorker(mod, true);
				return worker ? worker(req, ctx) : Promise.resolve([]);
			},
			undefined,
			true
		);
	}

	public async getSubtitles(rawRequester: RawScrapeRequester): Promise<SubtitleSource[]> {
		return this.scrapeProviders(rawRequester, "subtitle", (mod, req, ctx) => mod.workers.getSubtitles!(req, ctx));
	}

	public async getStreamsProgressive(rawRequester: RawScrapeRequester, onPartialResult: (sources: MediaSource[]) => void): Promise<MediaSource[]> {
		const lazy = this.config.lazy === true;
		return this.scrapeProviders(
			rawRequester,
			"media",
			(mod, req, ctx) => {
				const worker = this.mediaWorker(mod, lazy);
				return worker ? worker(req, ctx) : Promise.resolve([]);
			},
			{ ignoreQuorum: true, onPartialResult },
			lazy
		);
	}

	public async getSubtitlesProgressive(rawRequester: RawScrapeRequester, onPartialResult: (sources: SubtitleSource[]) => void): Promise<SubtitleSource[]> {
		return this.scrapeProviders(rawRequester, "subtitle", (mod, req, ctx) => mod.workers.getSubtitles!(req, ctx), { ignoreQuorum: true, onPartialResult });
	}

	public async getStreamsByScheme(scheme: string, rawRequester: RawScrapeRequester): Promise<MediaSource[]> {
		const module = this.moduleByScheme(scheme);
		if (!module) {
			GrabitManager.logger.warn(`No active provider found for scheme "${scheme}"`);
			return [];
		}
		const lazy = this.config.lazy === true;
		const worker = this.mediaWorker(module, lazy);
		if (!worker) {
			GrabitManager.logger.warn(`Provider "${module.meta.name}" (scheme "${scheme}") does not implement ${lazy ? "getLazyStreams/getStreams" : "getStreams"}`);
			return [];
		}

		const requester: ScrapeRequester = {
			...rawRequester,
			targetLanguageISO: rawRequester.targetLanguageISO.split("-")[0].toLowerCase(),
			media: rawRequester.media.type === "channel" ? rawRequester.media : await TMDB.createRequesterMedia(rawRequester),
			// Fall back to the manager's default proxy when the request omits one.
			proxy: rawRequester.proxy ?? this.config.proxy
		};

		const results = await this.createOperation([module], (_mod, _limiter, signal) => worker({ ...requester, signal }, GrabitManager.context));
		return sortByTargetLanguage(results, requester.targetLanguageISO);
	}

	public async getSubtitlesByScheme(scheme: string, rawRequester: RawScrapeRequester): Promise<SubtitleSource[]> {
		const module = this.moduleByScheme(scheme);
		if (!module) {
			GrabitManager.logger.warn(`No active provider found for scheme "${scheme}"`);
			return [];
		}
		if (!module.workers.getSubtitles) {
			GrabitManager.logger.warn(`Provider "${module.meta.name}" (scheme "${scheme}") does not implement getSubtitles`);
			return [];
		}

		const requester: ScrapeRequester = {
			...rawRequester,
			targetLanguageISO: rawRequester.targetLanguageISO.split("-")[0].toLowerCase(),
			media: rawRequester.media.type === "channel" ? rawRequester.media : await TMDB.createRequesterMedia(rawRequester),
			// Fall back to the manager's default proxy when the request omits one.
			proxy: rawRequester.proxy ?? this.config.proxy
		};

		const results = await this.createOperation([module], (mod, _limiter, signal) => mod.workers.getSubtitles!({ ...requester, signal }, GrabitManager.context));
		return sortByTargetLanguage(results, requester.targetLanguageISO);
	}

	/**
	 * Resolve a lazy source on play. `id` comes from `source.lazy.id`;
	 * returns the fully-resolved source, or null when it can't be resolved.
	 */
	public async resolveLazySource(scheme: string, id: string, rawRequester: RawScrapeRequester): Promise<MediaSource | null> {
		const module = this.moduleByScheme(scheme);
		if (!module?.workers.resolveLazy) {
			GrabitManager.logger.warn(`Provider "${scheme}" does not implement resolveLazy`);
			return null;
		}
		const requester: ScrapeRequester = {
			...rawRequester,
			targetLanguageISO: rawRequester.targetLanguageISO.split("-")[0].toLowerCase(),
			media: rawRequester.media.type === "channel" ? rawRequester.media : await TMDB.createRequesterMedia(rawRequester),
			// Fall back to the manager's default proxy when the request omits one.
			proxy: rawRequester.proxy ?? this.config.proxy
		};
		return module.workers.resolveLazy(id, GrabitManager.context, requester);
	}
}
