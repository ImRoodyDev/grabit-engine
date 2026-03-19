import { GithubService } from "../services/github.ts";
import { RegistryService } from "../services/registry.ts";
import { RequireService } from "../services/require.ts";
import { ProviderModule, ProcessError } from "../types/index.ts";
import { ProviderManagerConfig, ResolvedProviderSource, ProvidersManifest } from "../types/models/Manager.ts";
import { DebugLogger } from "../utils/logger.ts";
import { isCustomError, isDevelopment, minutesToMilliseconds } from "../utils/standard.ts";
import { CACHE, createSourceCacheKey, createHealthCacheKey } from "../services/cache.ts";
import { countValidationMessages, formatValidationIssues } from "../utils/validator.ts";

type CachedModules = {
	meta: ProvidersManifest;
	providers: ProviderModule[];
};

export type ProviderMetrics = {
	errors: number;
	successes: number;
	lastOperation: Date;
};

export type ProviderHealthReport = {
	moduleName: string;
	errors: number;
	successes: number;
	totalOperations: number;
	errorRate: number;
	active: boolean;
	lastOperation: Date;
};

/** Module manager to handle loading, caching, and refreshing of provider modules based on the specified configuration.
 */
export abstract class ModuleManager {
	protected isRemote = false;
	protected meta: ProvidersManifest | null = null;
	protected loadedModules: ProviderModule[] = [];
	protected metrics: Map<string, ProviderMetrics> = new Map();
	protected updateInrterval: NodeJS.Timeout | null = null;
	private logger: DebugLogger;

	protected constructor(protected config: ProviderManagerConfig) {
		CACHE.setMaxSize(config.cache?.maxEntries ?? 10_000); // Set cache max size based on config or default to 10,000 entries
		this.logger = new DebugLogger(config.debug ?? isDevelopment(), "ModuleManager");
	}

	// --------------- Module loading and management ---------------

	/** Start the auto-update mechanism to periodically refresh provider modules */
	protected startAutoUpdateService() {
		// Only start auto-update for remote sources
		if (!this.isRemote) return;
		const { autoUpdateIntervalMinutes = 15 } = this.config;
		const msInterval = minutesToMilliseconds(Math.max(autoUpdateIntervalMinutes, 5)); // Minimum interval of 5 minutes to prevent excessive updates

		// Clear any existing interval before starting a new one
		this.stopAutoUpdateService();

		this.updateInrterval = setInterval(() => {
			this.refreshModules().catch((error) => {
				this.logger.error("Failed to auto-update provider modules", error);
			});
			this.saveModules(); // Save the refreshed modules to cache after each update
		}, msInterval);
	}

	/** Stop the auto-update interval if it is running */
	protected stopAutoUpdateService() {
		if (this.updateInrterval) {
			clearInterval(this.updateInrterval);
			this.updateInrterval = null;
		}
	}

	/** Initialize provider modules based on the configuration source.
	 * This method is responsible for initializing provider modules based on the configuration provided to the ScrapePluginManager. It supports various sources such as GitHub, npm registry, or local file system. The method will utilize the provided module resolver to dynamically import provider modules and store them in the manager for later use when handling media requests.
	 */
	protected async initializeModules() {
		try {
			this.logger.info("Initializing provider modules based on source");
			const { source } = this.config;
			let result: ResolvedProviderSource;

			// Load provider modules based on the specified source
			if (source.type === "github") {
				this.logger.info("Loading provider modules from GitHub repository");
				result = await GithubService.initializeProviders(source);
				this.isRemote = true;
			} else if (source.type === "registry") {
				this.logger.info("Loading provider modules from npm registry");
				result = await RegistryService.initializeProviders(source);
			} else {
				this.logger.info("Loading provider modules from local file system");
				result = await RequireService.initializeProviders(source);
			}

			// Store the loaded provider modules and metadata in the manager
			this.meta = result.meta;
			this.loadedModules = Array.from(result.providers.values());

			// In strict mode, throw an error if there are any validation errors
			if (this.config.strict && result.validations.errors.length > 0) {
				// In strict mode, throw an error if there are any validation errors
				const errorMessages = formatValidationIssues(result.validations.errors);
				throw new ProcessError({
					code: "ProviderValidationError",
					message: `Provider validation failed with the following errors:\n${errorMessages}`,
					details: result.validations.errors
				});
			}

			const manifestName = typeof result.meta.name === "string" && result.meta.name.trim().length > 0 ? result.meta.name : "unknown manifest";
			const manifestAuthor = typeof result.meta.author === "string" && result.meta.author.trim().length > 0 ? result.meta.author : "unknown author";
			const providerSchemes = Array.from(result.providers.keys());
			const validationErrorCount = countValidationMessages(result.validations.errors);
			const validationWarningCount = countValidationMessages(result.validations.warnings);

			this.logger.info(`Loaded provider manifest: ${manifestName} by ${manifestAuthor}`);
			this.logger.info(`Provider schemes found in manifest: ${providerSchemes.length > 0 ? providerSchemes.join(", ") : "(none)"}`);
			this.logger.info(
				`Successfully initialized ${this.loadedModules.length} provider(s) with ${validationErrorCount} error(s) and ${validationWarningCount} warning(s)`
			);

			if (result.validations.errors.length > 0) {
				this.logger.error(`Provider validation completed with errors. Invalid providers were skipped:\n${formatValidationIssues(result.validations.errors)}`);
			}

			// Log any validation warnings for debugging purposes
			if (result.validations.warnings.length > 0 && this.config.debug) {
				const warningMessages = formatValidationIssues(result.validations.warnings);
				this.logger.warn(`Provider validation completed with the following warnings:\n${warningMessages}`);
			}
		} catch (error) {
			if (isCustomError(error)) throw error;
			this.logger.error("Failed to initialize provider modules", error);
			throw new ProcessError({
				code: "ProviderInitializationError",
				message: "An error occurred while initializing provider modules",
				details: isCustomError(error) ? error.details : undefined
			});
		}
	}

	/** Load provider modules from cache if available and not expired */
	protected loadModules(): boolean {
		const key = createSourceCacheKey(this.config.source);
		const cached = CACHE.get<CachedModules>(key);
		if (cached) {
			this.logger.info("Loaded provider modules from cache");
			this.meta = cached.meta;
			this.loadedModules = cached.providers;
			return true;
		}
		return false;
	}

	/** Refresh provider modules if version is changed or cache is expired */
	protected async refreshModules() {
		try {
			if (!this.isRemote || !this.meta) return; // Only refresh for remote sources
			if (this.config.source.type !== "github") return; // Currently only supports refreshing for GitHub sources

			this.logger.info("Refreshing provider modules");

			// New manifest is fetched to compare module versions, if the version is different from the current one, or if caching is enabled and the cache has expired, the modules are refreshed
			const newMeta = await GithubService.getManifest(this.config.source);
			this.meta.name = newMeta.name;
			this.meta.author = newMeta.author;

			// Iterate through the new manifest providers and refresh modules if their version has changed or if they are not currently loaded
			for (const [scheme, mod] of Object.entries(newMeta.providers)) {
				// Check if the module version has changed compared to the currently loaded modules
				// If module dont exist it will be loaded as well
				const updateRequired = !this.meta.providers[scheme] || this.meta.providers[scheme]?.version !== mod.version;

				if (updateRequired) {
					const updatedModuleResult = await GithubService.getModule([scheme, mod], this.config.source);
					if (updatedModuleResult.module) {
						// Update the meta providers manifest
						this.meta.providers[scheme] = mod;

						// Check if module exists in the currently loaded modules
						const existingIndex = this.loadedModules.findIndex((m) => m.meta.name === mod.name);

						// Update the loaded modules with the new version
						if (existingIndex !== -1) {
							// Call cleanup method of the existing module before replacing it with the new version
							this.loadedModules[existingIndex].workers.cleanup?.().catch((error: unknown) => {
								throw new ProcessError({
									code: "ProviderCleanupError",
									message: `An error occurred while cleaning up provider module "${mod.name}" during refresh`,
									details: isCustomError(error) ? error.details : undefined
								});
							});
							this.loadedModules[existingIndex] = updatedModuleResult.module;
						} else this.loadedModules.push(updatedModuleResult.module);
					}
				}
			}
		} catch (error) {
			if (isCustomError(error)) throw error;
			this.logger.error("Failed to refresh provider modules", error);
			throw new ProcessError({
				code: "ProviderRefreshError",
				message: "An error occurred while refreshing provider modules",
				details: isCustomError(error) ? error.details : undefined
			});
		}
	}

	/** Save the currently loaded provider modules to cache with the appropriate TTL */
	protected saveModules() {
		const key = createSourceCacheKey(this.config.source);

		// Cache the loaded modules and its meta
		CACHE.set(
			key,
			{
				meta: this.meta,
				providers: this.loadedModules
			},
			this.config.cache?.MODULE_TTL ?? minutesToMilliseconds(15)
		); // Default module cache TTL is 15 minutes
	}

	/** Resolve a scheme identifier to the corresponding loaded module, or `null` if not found / inactive */
	protected moduleByScheme(scheme: string): ProviderModule | null {
		return this.loadedModules.find((m) => m.provider.config.scheme === scheme && m.meta.active) ?? null;
	}

	// --------------- Metrics and health monitoring ---------------
	/** Evaluate a module's health metrics against the configured error threshold.
	 * Returns `true` when the module should be disabled.
	 */
	protected shouldDisableModule(metrics: ProviderMetrics): boolean {
		const { errorThresholdRate = 0.7, minOperationsForEvaluation = 10 } = this.config.scrapeConfig ?? {};
		if (errorThresholdRate === undefined) return false;

		const total = metrics.errors + metrics.successes;
		if (total < minOperationsForEvaluation) return false; // Not enough data to make a judgment

		const errorRate = metrics.errors / total;
		return errorRate > errorThresholdRate;
	}

	/** Restore persisted provider health metrics from cache and re-evaluate thresholds */
	protected restoreMetrics() {
		const key = createHealthCacheKey(this.config.source);
		const cached = CACHE.get<Map<string, ProviderMetrics>>(key);

		if (cached) {
			this.metrics = cached;
			this.logger.info("Restored provider health metrics from cache");

			// Re-evaluate thresholds — modules may have breached the limit while cached
			for (const [moduleScheme, metrics] of this.metrics.entries()) {
				if (this.shouldDisableModule(metrics)) {
					const module = this.loadedModules.find((m) => m.provider.config.scheme === moduleScheme);
					if (module?.meta.active) {
						module.meta.active = false;
						const total = metrics.errors + metrics.successes;
						this.logger.warn(
							`Module "${moduleScheme}" disabled on startup: error rate ${((metrics.errors / total) * 100).toFixed(1)}% ` +
								`(${metrics.errors} errors / ${total} total operations)`
						);
					}
				}
			}
		}
	}

	/** Persist the current provider health metrics to cache */
	protected saveMetrics() {
		const key = createHealthCacheKey(this.config.source);
		CACHE.set(key, this.metrics, this.config.cache?.MODULE_TTL ?? minutesToMilliseconds(15));
	}

	/** Record one operation outcome for a module and auto-disable it when its
	 * error rate exceeds the configured threshold (after the minimum sample size).
	 */
	protected recordMetrics(moduleScheme: string, success: boolean) {
		const existing = this.metrics.get(moduleScheme) ?? { errors: 0, successes: 0, lastOperation: new Date() };

		const metrics: ProviderMetrics = {
			errors: existing.errors + (success ? 0 : 1),
			successes: existing.successes + (success ? 1 : 0),
			lastOperation: new Date()
		};
		this.metrics.set(moduleScheme, metrics);

		// Check whether the module should be auto-disabled
		if (this.shouldDisableModule(metrics)) {
			const module = this.loadedModules.find((m) => m.provider.config.scheme === moduleScheme);
			if (module?.meta.active) {
				module.meta.active = false;
				const total = metrics.errors + metrics.successes;
				const { errorThresholdRate = 0.7 } = this.config.scrapeConfig ?? {};
				this.logger.warn(
					`Module "${moduleScheme}" auto-disabled: error rate ${((metrics.errors / total) * 100).toFixed(1)}% exceeds threshold ${((errorThresholdRate ?? 0.7) * 100).toFixed(1)}% ` +
						`(${metrics.errors} errors / ${total} total operations)`
				);
			}
		}

		this.saveMetrics();
	}
}
