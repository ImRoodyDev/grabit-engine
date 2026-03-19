import { ScrapeRequester } from "../input/Requester.ts";
import { MediaSource, SubtitleSource } from "../output/MediaSources.ts";
import type { PuppeteerPoolConfig } from "./Puppeteer.ts";
import { ProviderModule, ProviderModuleManifest } from "./Modules.ts";

/**
 * Provider Manager metadata and configuration types
 */
export type ProvidersManifest = {
	/** Library Name */
	name: string;
	/** Author */
	author?: string;
	/** scheme → relative folder path (supports groups, e.g. "social/twitter": "providers/social/twitter") */
	providers: Record<string, ProviderModuleManifest>;
};

/**
 * GitHub source — fetches providers from a GitHub repository.
 * Uses the fetch API so it works in Node 18+, browsers, and React Native.
 *
 * The repo must contain a manifest.json at its root with the shape:
 * { name, version, providers: { "scheme": "relative/folder/path" } }
 * @example React Native
 * ```typescript
 *		const manager = await createProviderManager({
 *			source: {
 *				type: 'github',
 *				url: 'https://github.com/username/providers-repo',
 *				branch: 'main',
 *				moduleResolver: async (_scheme, sourceCode) => {
 *				// Evaluate the fetched JS source into a module
 *				const exports: Record<string, unknown> = {};
 *				const module = { exports };
 *				new Function('module', 'exports', sourceCode)(module, exports);
 *				return (module.exports as any).default ?? module.exports;
 *				},
 *			},
 *			});
 *```
 */
export type GithubSource = {
	/** Source type */
	type: "github";
	/** GitHub repo URL or shorthand "owner/repo" */
	url: string;
	/** Author */
	author?: string;
	/** Branch name (default: "main") */
	branch?: string;
	/** Root directory for the repository (default: "/") e.g `"dist"`*/
	rootDir?: string;
	/** Auth token for private repos */
	token?: string;

	/**
	 * Custom resolver that converts fetched source code into a ProviderModule.
	 * Required in browser/React Native (no dynamic import from strings).
	 * If omitted, falls back to a Node.js resolver (temp file + dynamic import).
	 */
	moduleResolver?: (scheme: string, sourceCode: string) => Promise<ProviderModule>;
};

/**
 * Registry source — providers are passed as pre-imported modules.
 * Works in any JS runtime (React Native, web, Node.js).
 *
 * The `providers` record eliminates duplication: its keys are
 * the scheme identifiers and its values are the imported modules.
 */
export interface RegistrySource {
	type: "registry";
	/** Library name */
	name: string;
	/** Author */
	author?: string;
	/** scheme → pre-imported ProviderModule */
	providers: Record<string, ProviderModule>;
}

/**
 * Local source — auto-imports providers from a manifest using a user-supplied
 * resolve function.  Works in any JS runtime.
 *
 * Instead of importing every provider yourself and passing them to the config,
 * point to a manifest that maps scheme → folder path.  The manager calls
 * `resolve(rootDir + folderPath)` for each entry and populates the registry.
 *
 * @example Node.js
 * ```typescript
 * source: {
 *   type: 'local',
 *   manifest: require('./manifest.json'),
 *   rootDir: './providers',
 *   resolve: (p) => require(p),
 * }
 * ```
 *
 * @example React Native (static map)
 * ```typescript
 * const map: Record<string, ProviderModule> = {
 *   './providers/weather': require('./providers/weather').default,
 *   './providers/social/twitter': require('./providers/social/twitter').default,
 * };
 * source: {
 *   type: 'local',
 *   manifest: require('./manifest.json'),
 *   resolve: (p) => map[p],
 * }
 * ```
 */
export interface LocalSource {
	type: "local";
	/** The manifest object — import or require it yourself */
	manifest: ProvidersManifest;
	/**
	 * Base directory prepended to every provider path in the manifest.
	 * Defaults to `'./'`.  A trailing slash is added automatically if missing.
	 */
	rootDir?: string;
	/**
	 * Module resolver called for each provider with the full path
	 * (`rootDir + folderPath`).  Must return the ProviderModule (or a
	 * module whose `.default` is a ProviderModule).
	 *
	 * This is what makes the source env-agnostic:
	 * - Node.js:       `(p) => require(p)`
	 * - React Native:   Map paths to static requires
	 * - Web / Vite:     `(p) => import(p)`
	 */
	resolve: (modulePath: string) => ProviderModule | Promise<ProviderModule>;
}

/**
 * Provider source configuration
 */
export type ProviderSource = GithubSource | RegistrySource | LocalSource;

/**
 * Configuration option for the `GrabitManager`,
 * which manages provider modules and their interactions.
 */
export type ProviderManagerConfig = {
	/** Provider source configuration */
	source: ProviderSource;

	/** Whether to enable debug mode for the provider manager, which can include additional logging and error information to help with development and troubleshooting. */
	debug?: boolean;

	/** Throw on validation errors instead of warning (default: false) */
	strict?: boolean;

	/** Auto-initialize providers on load */
	autoInit?: boolean;

	/**
	 * Optional interval in minutes for auto-updating providers from remote sources.
	 * When set, the GrabitManager will periodically check for updates to the provider modules and refresh them without requiring a restart.
	 *
	 * This is particularly useful for (remote sources)
	 *
	 * NOTE: (ONLY FOR REMOTE SOURCES)
	 * @default `15` (15 minutes) minimum is 5 minutes
	 */
	autoUpdateIntervalMinutes?: number;

	/**
	 * Optional caching configuration for provider data.
	 * When enabled, provider data will be cached in memory for the specified TTL duration to improve performance and reduce redundant network requests.
	 * This can be particularly beneficial when dealing with providers that have rate limits or slow response times.
	 * @default "{ enabled: false, TTL: 0 }"  (caching enabled by default, TTL of 5 minutes when enabled)
	 */
	cache?: {
		/** Whether to enable caching of provider data */
		enabled: boolean;

		/**
		 * Cache expiration TTL time in milliseconds
		 *
		 * For scraped data from providers
		 * @default "0" (0 minutes)
		 */
		TTL: number;

		/**
		 * Optional TTL for caching provider modules (extension).
		 * Useful for remote sources to avoid fetching and re-initializing modules too frequently,
		 *
		 * while still ensuring they are updated periodically.
		 *
		 * @default "900_000" (15 minutes)
		 *
		 * NOTE: This is separate from the general cache TTL to allow for different caching strategies for module data vs. provider data.
		 */
		MODULE_TTL?: number;

		/** TMDB Response cache TTL in milliseconds */
		TMDB_TTL?: number;

		/** Optional maximum number of entries to store in the cache.
		 * @default 10_000
		 */
		maxEntries?: number;
	};

	/**
	 * Optional scraping configuration for provider handlers.
	 * This can include settings such as concurrency limits, retry attempts, and whether to save failed grab attempts for later analysis.
	 * These settings will help optimize the scraping process and handle potential issues with providers more effectively.
	 * @default  "{ concurrentOperations: 5, maxAttempts: 3, operationTimeout: 15000 }" -
	 */
	scrapeConfig?: {
		/** Maximum number of concurrent provider scraping operations
		 *
		 *  This can help manage resource usage and avoid overwhelming the system when dealing with a large number of providers or media entries.
		 */
		concurrentOperations?: number;
		/** Maximum retry attempts for failed scrapes
		 *
		 *  This can help improve the success rate of scraping by allowing for multiple attempts in case of transient issues with providers.
		 */
		maxAttempts?: number;
		/**
		 * Optional global timeout in milliseconds for the entire operation (all provider tasks combined).
		 *
		 * Acts as a safety net to prevent the operation from hanging indefinitely.
		 * When the timeout elapses, all remaining in-flight tasks are cancelled and
		 * only the results collected so far are returned.
		 *
		 * @default 15_000 (15 seconds)
		 */
		operationTimeout?: number;
		/**
		 * Minimum number of successful provider results required to consider the
		 * operation fulfilled and short-circuit the remaining tasks.
		 *
		 * When set, the operation resolves as soon as `successQuorum` providers
		 * return valid results — the pending tasks are cancelled immediately.
		 * This is useful when you don't need every single provider to respond,
		 * just a sufficient number of successful ones.
		 *
		 * @example 2 — stop after 2 providers succeed, cancel the rest
		 * @default undefined (wait for every provider to settle)
		 */
		successQuorum?: number;
		/**
		 * When `successQuorum` is reached, wait for providers that are already running
		 * in active concurrency slots to finish before resolving.
		 *
		 * Queued providers that have not started yet are still cancelled immediately.
		 * Keep this disabled when lowest possible latency matters more than collecting
		 * extra results from providers that were already in flight.
		 *
		 * @default false
		 */
		waitForActiveProvidersAfterQuorum?: boolean;
		/**
		 * Error rate threshold (0–1) used to automatically disable a provider module.
		 *
		 * Calculated as: `errors / (errors + successes)`.
		 * The check is only performed once the module has accumulated at least
		 * `minOperationsForEvaluation` total operations to avoid penalising
		 * modules for early transient failures.
		 *
		 * Once a module's error rate exceeds this value it is marked as inactive and
		 * will be excluded from future operations until the process restarts or the
		 * cached health metrics expire.
		 *
		 * Set to `undefined` to disable threshold checking entirely.
		 *
		 * @example 0.8 — disable a module after it fails 80 % of the time
		 * @default 0.7
		 */
		errorThresholdRate?: number;
		/**
		 * Minimum number of total operations (successes + errors) a module must
		 * accumulate before its error rate is evaluated against `errorThresholdRate`.
		 *
		 * This prevents a module from being disabled after a single failure.
		 *
		 * @default 10
		 */
		minOperationsForEvaluation?: number;

		/**
		 * Node.js-only browser pooling configuration used by `ctx.puppeteer.launch(...)`.
		 *
		 * Browser instances are reused as warm processes while individual requests lease tabs/pages.
		 * This reduces browser startup churn and caps the number of real browser processes running at once.
		 */
		puppeteer?: PuppeteerPoolConfig;
	};

	tmdbApiKeys: string[];
};

export interface IProviderManagerWorkers {
	/** Grabs streams for a given requester */
	getStreams(requester: ScrapeRequester): Promise<MediaSource[]>;
	/** Grabs subtitles for a given requester */
	getSubtitles(requester: ScrapeRequester): Promise<SubtitleSource[]>;
	/** Grabs streams from a single provider identified by its scheme key */
	getStreamsByScheme(scheme: string, requester: ScrapeRequester): Promise<MediaSource[]>;
	/** Grabs subtitles from a single provider identified by its scheme key */
	getSubtitlesByScheme(scheme: string, requester: ScrapeRequester): Promise<SubtitleSource[]>;
}

export type ResolvedProviderSource = Readonly<{
	meta: ProvidersManifest;
	providers: Map<string, ProviderModule>;
	validations: {
		errors: [string, string[]][];
		warnings: [string, string[]][];
	};
}>;
