import cheerioCore from "../core/cheerio.ts";
import puppeteerCore, { disableHeadlessMode } from "../core/puppeteer.ts";
import xhrCore from "../core/xhr.ts";
import { ScrapeRequester, MediaSource, SubtitleSource, ProviderModule, ProviderModuleManifest, RawScrapeRequester } from "../types/index.ts";
import { ProviderContext } from "../types/models/Context.ts";
import { ProviderManagerConfig, IProviderManagerWorkers } from "../types/models/Manager.ts";
import { DebugLogger } from "../utils/logger.ts";
import { excuteWithRetries, formatTimestamp, isDevelopment, isNode, secondsToMilliseconds } from "../utils/standard.ts";
import { isSourceCached, CACHE } from "../services/cache.ts";
import pLimit, { LimitFunction } from "p-limit";
import { ModuleManager, ProviderHealthReport, ProviderMetrics } from "./module.ts";
import { TMDB } from "../services/tmdb.ts";

/**
 * ScrapePluginManager is the main class responsible
 * for managing provider modules, including loading, caching, refreshing, and health monitoring.
 */
export class ScrapePluginManager extends ModuleManager implements IProviderManagerWorkers {
	private static logger: DebugLogger;
	private static context: ProviderContext;
	private static instance: ScrapePluginManager;
	private limiters: LimitFunction[] = [];

	private constructor(config: ProviderManagerConfig) {
		super(config);
		ScrapePluginManager.logger = new DebugLogger(config.debug ?? isDevelopment(), "ScrapePluginManager");
		ScrapePluginManager.context = ScrapePluginManager.createContext();

		// Initialize the TMDB API with the provided keys and optional cache TTL
		TMDB.init(config.tmdbApiKeys, { cacheTTL: config.cache?.TMDB_TTL });
	}

	/** Creates a new provider manager singleton instance */
	public static async create(config: ProviderManagerConfig): Promise<ScrapePluginManager> {
		if (ScrapePluginManager.instance) {
			ScrapePluginManager.logger.warn("ScrapePluginManager instance already exists. Returning existing instance.");
			return ScrapePluginManager.instance;
		}
		const manager = new ScrapePluginManager(config);
		ScrapePluginManager.instance = manager;

		// Check if the source is cached
		const cached = isSourceCached(config.source);
		if (cached) manager.loadModules();
		else {
			// If not cached, initialize modules and save to cache
			await manager.initializeModules();
			manager.saveModules();
		}

		// Restore previously persisted health metrics (if available)
		manager.restoreMetrics();

		// Start auto-update service
		manager.startAutoUpdateService();
		return manager;
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
			puppeteer: puppeteerCore,
			log: this.logger
		};
	}

	/** Create an operation with concurrency and retry handling */
	private async createOperation<T>(
		modules: ProviderModule[],
		fn: (module: ProviderModule, limiter: LimitFunction) => Promise<T[]>,
		options?: { ignoreQuorum?: boolean; onPartialResult?: (result: T[]) => void }
	) {
		const { successQuorum, maxAttempts = 1, concurrentOperations = 5, operationTimeout = secondsToMilliseconds(15) } = this.config.scrapeConfig || {};
		const { ignoreQuorum = false, onPartialResult } = options ?? {};

		// Create concurrency limiter
		const limit = pLimit({
			concurrency: concurrentOperations,
			rejectOnClear: true
		});
		this.limiters.push(limit); // Keep track of limiters to clear them if needed (e.g., on timeout)

		// Collect non-empty provider results and track settled tasks
		const collected: T[][] = [];
		let settled = 0;
		let startedCount = 0;
		let providersWithResults = 0;
		let quorumReached = false;

		// Wrap the whole operation in a promise that resolves when either:
		// 1) The success quorum is reached AND all already-running tasks have finished
		// 2) All tasks have settled
		// 3) The operation timeout fires
		const operationPromise = new Promise<T[][]>((resolve) => {
			const tryResolve = () => {
				if (!ignoreQuorum && successQuorum !== undefined && providersWithResults >= successQuorum && !quorumReached) {
					// Quorum satisfied — drop queued tasks that haven't started yet,
					// but let already-running concurrent slots finish so their results aren't wasted.
					quorumReached = true;
					limit.clearQueue();
				}
				// Resolve once every started task has settled (covers both quorum and all-settled paths)
				if (quorumReached && settled >= startedCount) {
					resolve(collected);
					return;
				}
				// Normal path: all scheduled tasks have settled (no quorum configured)
				if (settled >= modules.length) {
					resolve(collected);
				}
			};

			// Schedule each provider task inside the concurrency limiter
			for (const module of modules) {
				limit(async () => {
					startedCount++; // Increment synchronously before any await so clearQueue() can't race it
					try {
						const result = await excuteWithRetries(() => fn(module, limit), maxAttempts);
						this.recordMetrics(module.provider.config.scheme, true);
						if (Array.isArray(result) && result.length > 0) {
							collected.push(result);
							providersWithResults++;
							onPartialResult?.(result);
						} else {
							ScrapePluginManager.logger.debug(
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
				limit.clearQueue();
				ScrapePluginManager.logger.warn(
					`Operation timed out after ${operationTimeout}ms — returning ${providersWithResults} provider result set(s) collected so far`
				);
				resolve(collected);
			}, operationTimeout);
		});

		const results = await Promise.race([operationPromise, timeoutPromise]);
		clearTimeout(timeoutId); // Prevent the timer from firing after the operation completed
		const totalSources = results.reduce((count, providerResults) => count + providerResults.length, 0);
		ScrapePluginManager.logger.info(
			`Operation completed: ${providersWithResults}/${modules.length} provider(s) returned results (${totalSources} total item(s))`
		);

		// Remove the current limiter from the manager's list to prevent memory leaks
		this.limiters = this.limiters.filter((limiter) => limiter !== limit);

		// Join result from all providers into a single array
		return results.flat();
	}

	/** Shared scraping pipeline: resolves the requester, finds matching providers,
	 * handles the language-based media rotation, and runs `createOperation`.
	 *
	 * Every public `getStreams` / `getSubtitles` / progressive variant delegates here.
	 */
	private async scrapeProviders<T>(
		rawRequester: RawScrapeRequester,
		providerType: ProviderModuleManifest["type"],
		worker: (module: ProviderModule, requester: ScrapeRequester, context: ProviderContext) => Promise<T[]>,
		operationOptions?: { ignoreQuorum?: boolean; onPartialResult?: (result: T[]) => void }
	): Promise<T[]> {
		const requester: ScrapeRequester = {
			...rawRequester,
			targetLanguageISO: rawRequester.targetLanguageISO.split("-")[0].toLowerCase(),
			media: rawRequester.media.type === "channel" ? rawRequester.media : await TMDB.createRequesterMedia(rawRequester)
		};

		const providers = this.getProvidersByRequest(providerType, requester);
		if (providers.length === 0) {
			ScrapePluginManager.logger.warn(`No providers found that support ${providerType} type "${requester.media.type}" for the given request`);
			return [];
		}

		// Mapped media by language for the modules (For CACHE USE ROTATION)
		const mediaByLanguage = new Map<string, ScrapeRequester["media"]>([[requester.targetLanguageISO, requester.media]]);

		const fn = async (module: ProviderModule, _limiter: LimitFunction) => {
			const moduleLang = Array.isArray(module.meta.language) ? module.meta.language[0] : module.meta.language;

			// Fetch or retrieve cached media for this module's declared language.
			// When the module's language differs from the requester's, TMDB is called with
			// that language so localized titles/metadata are correct for the provider.
			let media = mediaByLanguage.get(moduleLang);
			if (!media) {
				media = rawRequester.media.type === "channel" ? requester.media : await TMDB.createRequesterMedia({ ...rawRequester, targetLanguageISO: moduleLang });
				mediaByLanguage.set(moduleLang, media);
			}

			// Build a per-invocation copy to avoid mutating the shared requester across concurrent operations
			const localRequester: ScrapeRequester = { ...requester, media, targetLanguageISO: moduleLang };
			ScrapePluginManager.logger.debug(`[${formatTimestamp()}] Dispatching ${providerType} scrape to provider "${module.provider.config.scheme}"`, {
				targetLanguageISO: localRequester.targetLanguageISO,
				media: localRequester.media
			});
			return await worker(module, localRequester, ScrapePluginManager.context);
		};

		return await this.createOperation(providers, fn, operationOptions);
	}

	// --------------------------------------------------
	// --------------- Public API methods ---------------
	// --------------------------------------------------

	/** Close all active operations and clear limiters */
	public closeOperations() {
		this.limiters.forEach((limiter) => limiter.clearQueue());
		this.limiters = [];
	}

	/** Tear down the manager: stop auto-updates, cancel queued operations, and release the singleton.
	 *  After calling `destroy()` a new instance can be created via `ScrapePluginManager.create()`.
	 */
	public destroy() {
		this.stopAutoUpdateService();
		this.closeOperations();
		CACHE.stopAutoCleanup();
		ScrapePluginManager.instance = undefined!;
		ScrapePluginManager.context = undefined!;
		ScrapePluginManager.logger = undefined!;
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

	/** Get the list of providers by the supported requester */
	public getProvidersByRequest(type: ProviderModuleManifest["type"], requester: ScrapeRequester) {
		// Filter providers that support the requested media type and scheme
		const matchingProviders = this.loadedModules.filter((module) => {
			// In node anything is compatible
			// but in native enviroment only the universal providers should be included
			const envCompatible = isNode() ? true : module.meta.env === "universal";
			// Filter based on the media type
			const typeCompatible =
				(type === "subtitle" && module.workers.getSubtitles !== undefined) || //..
				(type === "media" && module.workers.getStreams !== undefined);

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

	public async getStreams(rawRequester: RawScrapeRequester): Promise<MediaSource[]> {
		return this.scrapeProviders(rawRequester, "media", (mod, req, ctx) => mod.workers.getStreams!(req, ctx));
	}

	public async getSubtitles(rawRequester: RawScrapeRequester): Promise<SubtitleSource[]> {
		return this.scrapeProviders(rawRequester, "subtitle", (mod, req, ctx) => mod.workers.getSubtitles!(req, ctx));
	}

	public async getStreamsProgressive(rawRequester: RawScrapeRequester, onPartialResult: (sources: MediaSource[]) => void): Promise<MediaSource[]> {
		return this.scrapeProviders(rawRequester, "media", (mod, req, ctx) => mod.workers.getStreams!(req, ctx), { ignoreQuorum: true, onPartialResult });
	}

	public async getSubtitlesProgressive(rawRequester: RawScrapeRequester, onPartialResult: (sources: SubtitleSource[]) => void): Promise<SubtitleSource[]> {
		return this.scrapeProviders(rawRequester, "subtitle", (mod, req, ctx) => mod.workers.getSubtitles!(req, ctx), { ignoreQuorum: true, onPartialResult });
	}

	public async getStreamsByScheme(scheme: string, requester: ScrapeRequester): Promise<MediaSource[]> {
		requester.targetLanguageISO = requester.targetLanguageISO.split("-")[0].toLowerCase();

		const module = this.moduleByScheme(scheme);
		if (!module) {
			ScrapePluginManager.logger.warn(`No active provider found for scheme "${scheme}"`);
			return [];
		}
		if (!module.workers.getStreams) {
			ScrapePluginManager.logger.warn(`Provider "${module.meta.name}" (scheme "${scheme}") does not implement getStreams`);
			return [];
		}

		const fn = async (mod: ProviderModule, _limiter: LimitFunction) => {
			return await mod.workers.getStreams!(requester, ScrapePluginManager.context);
		};
		return await this.createOperation([module], fn);
	}

	public async getSubtitlesByScheme(scheme: string, requester: ScrapeRequester): Promise<SubtitleSource[]> {
		requester.targetLanguageISO = requester.targetLanguageISO.split("-")[0].toLowerCase();

		const module = this.moduleByScheme(scheme);
		if (!module) {
			ScrapePluginManager.logger.warn(`No active provider found for scheme "${scheme}"`);
			return [];
		}
		if (!module.workers.getSubtitles) {
			ScrapePluginManager.logger.warn(`Provider "${module.meta.name}" (scheme "${scheme}") does not implement getSubtitles`);
			return [];
		}

		const fn = async (mod: ProviderModule, _limiter: LimitFunction) => {
			return await mod.workers.getSubtitles!(requester, ScrapePluginManager.context);
		};
		return await this.createOperation([module], fn);
	}
}
