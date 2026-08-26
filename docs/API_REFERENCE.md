<div align="center">

# 📖 API Reference

**Grabit Engine — Full API Documentation**

</div>

---

## 📑 Table of Contents

- [GrabitManager](#grabitmanager)
  - [ProviderManagerConfig](#providermanagerconfig)
  - [ProviderSource](#providersource)
  - [ProvidersManifest](#providersmanifest)
- [ScrapeRequester](#scraperequester)
- [ProviderModuleManifest](#providermodulemanifest)
- [ProviderMetrics](#providermetrics)
- [ProviderHealthReport](#providerhealthreport)
- [ProviderContext](#providercontext)
- [PuppeteerLoadRequest](#puppeteerloadrequest)
- [ProviderFetchOptions](#providerfetchoptions)
- [Media Input Types](#media-input-types)
  - [IBaseMedia](#ibasemedia)
  - [MovieMedia](#moviemedia)
  - [SerieMedia](#seriemedia)
  - [ChannelMedia](#channelmedia)
- [Output Types](#output-types)
  - [SourceProvider\<T\>](#sourceprovidert)
  - [MediaSource](#mediasource)
  - [SubtitleSource](#subtitlesource)
- [Provider Configuration](#provider-configuration)
  - [ProviderConfig](#providerconfig)
  - [TProviderEntryPatterns](#tproviderentrypatterns)
  - [EProviderQueryKey](#eproviderquerykey)
  - [TProviderSelectors](#tproviderselectors)
- [Provider Class](#provider-class)
- [Error Classes](#error-classes)
- [Utility Functions](#utility-functions)
  - [Extractor](#extractor-utilsextractor)
  - [Path](#path-utilspath)
  - [Similarity](#similarity-utilssimilarity)
  - [Standard](#standard-utilsstandard)
- [Services](#services)
  - [Unpacker](#unpacker-servicesunpacker)
  - [Crypto](#crypto-servicescrypto)
  - [tldts](#tldts)
  - [ISO 639-1](#iso-639-1)

---

## `GrabitManager`

The main orchestrator — creates, manages, and queries provider plugins.

| Method                                   | Returns                                | Description                                                                                                                                                                                                                              |
| ---------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GrabitManager.create(config)`           | `Promise<GrabitManager>`               | Creates the manager and loads all your provider plugins.                                                                                                                                                                                 |
| `getStreams(request)`                    | `Promise<MediaSource[]>`               | Gets streams from **all active providers** for the given media. Returns everything in one list. Returns **lazy handles** when the manager was created with `lazy: true`.                                                                 |
| `getLazyStreams(request)`                | `Promise<MediaSource[]>`               | Forces lazy listing regardless of `config.lazy`: dispatches to each provider's `getLazyStreams` (falling back to `getStreams` unless `lazyFallbackToStreams` is set to `false`). Handles are resolved on play via `resolveLazySource`. |
| `resolveLazySource(scheme, id, request)` | `Promise<MediaSource \| null>`         | Resolves one lazy handle on play. `id` comes from `source.lazy.id`; the request re-supplies the media context. Returns the fully-shaped source or `null`.                                                                                |
| `getSubtitles(request)`                  | `Promise<SubtitleSource[]>`            | Gets subtitles from **all active providers** for the given media.                                                                                                                                                                        |
| `getStreamsByScheme(scheme, request)`    | `Promise<MediaSource[]>`               | Gets streams from **one specific provider** by its scheme. Accepts a `RawScrapeRequester` — TMDB enrichment is handled internally. Honors `config.lazy`.                                                                                 |
| `getSubtitlesByScheme(scheme, request)`  | `Promise<SubtitleSource[]>`            | Gets subtitles from **one specific provider** by its scheme. Accepts a `RawScrapeRequester` — TMDB enrichment is handled internally.                                                                                                     |
| `closeOperations()`                      | `Promise<void>`                        | Cancels all in-progress and queued scrape operations. Useful for cleanup when navigating away or aborting.                                                                                                                               |
| `getProvidersByRequest(type, request)`   | `ProviderModule[]`                     | Returns the list of active providers that match the given type (`"media"` or `"subtitle"`) and request, sorted by priority.                                                                                                              |
| `getMetrics()`                           | `ReadonlyMap<string, ProviderMetrics>` | Returns health stats for each provider (errors, successes, last activity).                                                                                                                                                               |
| `getMetricsReport()`                     | `ProviderHealthReport[]`               | Returns a full health report for every loaded provider — error rate, status, and more.                                                                                                                                                   |

### `ProviderManagerConfig`

The configuration object passed to `GrabitManager.create(config)`.

| Field                                            | Type             | Required | Default     | Description                                                                                                                                                                    |
| ------------------------------------------------ | ---------------- | -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `source`                                         | `ProviderSource` | ✅       | —           | Where to load providers from. See [ProviderSource](#providersource) below.                                                                                                     |
| `tmdbApiKeys`                                    | `string[]`       | ✅       | —           | One or more TMDB API keys used for metadata lookups.                                                                                                                           |
| `debug`                                          | `boolean`        | ❌       | `false`     | Enables extra logging and error information for development.                                                                                                                   |
| `strict`                                         | `boolean`        | ❌       | `false`     | Throw on validation errors instead of warning.                                                                                                                                 |
| `lazy`                                           | `boolean`        | ❌       | `false`     | Dispatch stream requests to providers' `getLazyStreams` workers and return lazy handles.                                                                                       |
| `lazyFallbackToStreams`                          | `boolean`        | ❌       | `true`      | In lazy mode, use `getStreams` when a provider does not implement `getLazyStreams`. Set `false` for strict lazy mode (only `getLazyStreams` providers participate).            |
| `proxy`                                          | `ProxyConfig`    | ❌       | —           | Default proxy applied to provider requests when a scrape request does not supply its own `proxy`. Host-configured — providers never set this. Same shape as `ScrapeRequester.proxy`. |
| `autoInit`                                       | `boolean`        | ❌       | —           | Auto-initialize providers on load.                                                                                                                                             |
| `autoUpdateIntervalMinutes`                      | `number`         | ❌       | `15`        | Interval (in minutes) for auto-updating providers from remote sources. Minimum is 5. **Only applies to remote sources.**                                                       |
| `autoUpdateOnNative`                             | `boolean`        | ❌       | `false`     | Run the background auto-update interval on native/browser runtimes too. Off there by default (periodic re-fetch + bundle re-eval causes UI jank and battery drain); always runs on Node. |
| `cache`                                          | `object`         | ❌       | —           | Caching configuration. See below.                                                                                                                                              |
| `cache.enabled`                                  | `boolean`        | ✅       | `false`     | Whether to enable caching of provider data.                                                                                                                                    |
| `cache.TTL`                                      | `number`         | ✅       | `0`         | Cache expiration TTL in milliseconds for scraped data.                                                                                                                         |
| `cache.MODULE_TTL`                               | `number`         | ❌       | `900_000`   | **In-memory** TTL (ms) for resolved provider modules — how long loaded modules are reused from RAM before re-initializing. Runtime-only; not the on-disk lifetime (that is `GithubSource.persistentStoreTTL`).                        |
| `cache.TMDB_TTL`                                 | `number`         | ❌       | —           | TMDB response cache TTL in milliseconds.                                                                                                                                       |
| `cache.maxEntries`                               | `number`         | ❌       | `10_000`    | Maximum number of entries to store in the cache.                                                                                                                               |
| `scrapeConfig`                                   | `object`         | ❌       | —           | Scraping behaviour configuration. See below.                                                                                                                                   |
| `scrapeConfig.concurrentOperations`              | `number`         | ❌       | `5`         | Maximum number of concurrent provider scraping operations.                                                                                                                     |
| `scrapeConfig.maxAttempts`                       | `number`         | ❌       | `3`         | Maximum retry attempts for failed scrapes.                                                                                                                                     |
| `scrapeConfig.operationTimeout`                  | `number`         | ❌       | `15_000`    | Global timeout in milliseconds for the entire operation. When elapsed, remaining tasks are cancelled and only collected results are returned.                                  |
| `scrapeConfig.successQuorum`                     | `number`         | ❌       | `undefined` | Minimum successful provider results to short-circuit the operation. Remaining tasks are cancelled once the quorum is met.                                                      |
| `scrapeConfig.waitForActiveProvidersAfterQuorum` | `boolean`        | ❌       | `false`     | After `successQuorum` is reached, wait for providers already running in active concurrency slots to finish before resolving. Queued providers are still cancelled immediately. |
| `scrapeConfig.errorThresholdRate`                | `number`         | ❌       | `0.7`       | Error rate (0–1) above which a provider is automatically disabled. Only evaluated after `minOperationsForEvaluation` operations.                                               |
| `scrapeConfig.minOperationsForEvaluation`        | `number`         | ❌       | `10`        | Minimum total operations before a provider's error rate is evaluated against the threshold.                                                                                    |
| `scrapeConfig.puppeteer.maxConcurrentBrowsers`   | `number`         | ❌       | `2`         | Global cap for real Puppeteer browser processes. Matching requests reuse an existing browser as a new tab when possible.                                                       |
| `scrapeConfig.puppeteer.minWarmBrowsers`         | `number`         | ❌       | `0`         | Minimum number of idle browsers to keep warm for each browser configuration signature that has already been used.                                                              |
| `scrapeConfig.puppeteer.idleBrowserTTL`          | `number`         | ❌       | `60_000`    | How long an idle pooled browser stays alive before it is closed, unless it is still required by `minWarmBrowsers`.                                                             |
| `scrapeConfig.puppeteer.maxBrowserSessionTTL`    | `number`         | ❌       | `120_000`   | Maximum time (ms) a single page lease may stay open before it is auto-released and a warning is logged. Guards against providers that forget to call `browser.close()`.        |

`ctx.puppeteer.launch(...)` leases a tab from a manager-owned browser pool. Calling the returned `browser.close()` releases that leased tab. Call `manager.destroy()` to close the underlying browser processes.

### `ProviderSource`

Union type: `GithubSource | RegistrySource | LocalSource`. Determines where provider modules are loaded from.

#### `GithubSource`

Fetches providers from a GitHub repository. Works in Node 18+, browsers, and React Native.

| Field            | Type                                                              | Required | Default  | Description                                                                                                                      |
| ---------------- | ----------------------------------------------------------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `type`           | `"github"`                                                        | ✅       | —        | Source discriminant.                                                                                                             |
| `url`            | `string`                                                          | ✅       | —        | GitHub repo URL or shorthand `"owner/repo"`.                                                                                     |
| `author`         | `string`                                                          | ❌       | —        | Author name.                                                                                                                     |
| `branch`         | `string`                                                          | ❌       | `"main"` | Branch name.                                                                                                                     |
| `rootDir`        | `string`                                                          | ❌       | `"/"`    | Root directory for the repository (e.g. `"dist"`).                                                                               |
| `token`          | `string`                                                          | ❌       | —        | Auth token for private repos.                                                                                                    |
| `moduleResolver` | `(scheme: string, sourceCode: string) => Promise<ProviderModule>` | ❌       | —        | Custom resolver that converts fetched source into a module. Required in browser/React Native; Node falls back to dynamic import. |
| `persistentStore` | `PersistentStore`                                               | ❌       | —        | Persists fetched bundle source across app restarts (AsyncStorage / MMKV / `localStorage` shape). A warm start reuses the persisted copy instead of re-downloading, and it is the offline fallback when the manifest is unreachable. |
| `persistentStoreTTL` | `number`                                                     | ❌       | `604_800_000` (7 days) | How long a persisted bundle may sit **unused** before it is pruned from storage (ms). A global index (`grabit:index`) tracks every stored bundle/manifest with an expiry; pruning runs once at startup and on each autoUpdate tick, and sweeps leftovers from **all** sources — including ones no longer in use after a repo/branch switch. Reusing a bundle refreshes its expiry, so only superseded versions age out. Needs `store.removeItem` to actually delete. |
| `filter`         | `ProviderFilter`                                                 | ❌       | —        | Load only a subset (`{ schemes?, languages? }`), skipping the fetch + eval cost of the rest. |
| `concurrency`    | `number`                                                         | ❌       | `6`      | How many bundles are fetched at once. Lower it on low-end devices to cap memory. |
| `yieldOnEval`    | `boolean`                                                        | ❌       | `true` off-Node, `false` on Node | Yield to the event loop before each synchronous bundle compile so the UI thread can paint between providers. |

```typescript
// React Native example
const manager = await GrabitManager.create({
	source: {
		type: "github",
		url: "https://github.com/username/providers-repo",
		branch: "main",
		moduleResolver: async (_scheme, sourceCode) => {
			const exports: Record<string, unknown> = {};
			const module = { exports };
			new Function("module", "exports", sourceCode)(module, exports);
			return (module.exports as any).default ?? module.exports;
		}
	},
	tmdbApiKeys: ["your-tmdb-key"]
});
```

#### `RegistrySource`

Providers are passed as pre-imported modules. Works in any JS runtime.

| Field       | Type                             | Required | Description                                   |
| ----------- | -------------------------------- | -------- | --------------------------------------------- |
| `type`      | `"registry"`                     | ✅       | Source discriminant.                          |
| `name`      | `string`                         | ✅       | Library name.                                 |
| `author`    | `string`                         | ❌       | Author name.                                  |
| `providers` | `Record<string, ProviderModule>` | ✅       | Map of scheme → pre-imported provider module. |
| `filter`    | `ProviderFilter`                 | ❌       | Register only a subset (`{ schemes?, languages? }`).   |

```typescript
import myProvider from "./providers/my-provider";

const manager = await GrabitManager.create({
	source: {
		type: "registry",
		name: "my-providers",
		providers: { "my-provider": myProvider }
	},
	tmdbApiKeys: ["your-tmdb-key"]
});
```

#### `LocalSource`

Auto-imports providers from a manifest using a user-supplied resolve function. Works in any JS runtime.

| Field      | Type                                                                | Required | Default | Description                                                                                                                          |
| ---------- | ------------------------------------------------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `type`     | `"local"`                                                           | ✅       | —       | Source discriminant.                                                                                                                 |
| `manifest` | `ExternalProviderManifest`                                          | ✅       | —       | The manifest object — import or require it yourself. Typed as `ExternalProviderManifest` (scheme lives only as the map key); the engine promotes it to `ProvidersManifest` internally. |
| `rootDir`  | `string`                                                            | ❌       | `"./"`  | Base directory prepended to every provider path in the manifest. Trailing slash added automatically.                                 |
| `resolve`  | `(modulePath: string) => ProviderModule \| Promise<ProviderModule>` | ✅       | —       | Module resolver called for each provider with the full path. Must return the `ProviderModule` (or a module whose `.default` is one). |
| `filter`   | `ProviderFilter`                                                    | ❌       | —       | Load only a subset (`{ schemes?, languages? }`) from the manifest.                                                                    |
| `concurrency` | `number`                                                         | ❌       | `6`     | How many providers are resolved at once. Lower it on low-end devices.                                                                 |

```typescript
// Node.js
const manager = await GrabitManager.create({
	source: {
		type: "local",
		manifest: require("./manifest.json"),
		rootDir: "./providers",
		resolve: (p) => require(p)
	},
	tmdbApiKeys: ["your-tmdb-key"]
});
```

#### `ProviderFilter`

Narrows which providers a source loads, so a device skips the fetch + eval cost of providers it will never use. An empty/omitted filter loads all. Accepted by all three sources.

| Field       | Type       | Required | Description                                                                                 |
| ----------- | ---------- | -------- | ------------------------------------------------------------------------------------------- |
| `schemes`   | `string[]` | ❌       | Only load these scheme identifiers.                                                         |
| `languages` | `string[]` | ❌       | Only load providers whose declared language(s) intersect this list (primary subtag, lowercased). |

#### `PersistentStore`

Key/value store (`GithubSource.persistentStore`) that survives app restarts, matching the AsyncStorage / MMKV / `localStorage` shape. Sync or async both work; values are always strings (the engine serializes JSON itself).

| Method                       | Type                                          | Required | Description                       |
| ---------------------------- | --------------------------------------------- | -------- | --------------------------------- |
| `getItem(key)`               | `(string) => string \| null \| Promise<...>`  | ✅       | Read a stored value.              |
| `setItem(key, value)`        | `(string, string) => void \| Promise<void>`   | ✅       | Write a value.                    |
| `removeItem(key)`            | `(string) => void \| Promise<void>`           | ❌       | Delete a value.                   |

### `ProvidersManifest`

The manifest describing a provider library — used by `GithubSource` (loaded from the repo) and `LocalSource` (passed directly).

| Field       | Type                                     | Required | Description                                                                            |
| ----------- | ---------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `name`      | `string`                                 | ✅       | Library name.                                                                          |
| `author`    | `string`                                 | ❌       | Author name.                                                                           |
| `providers` | `Record<string, ProviderModuleManifest>` | ✅       | Map of scheme → provider manifest. The key is the provider's unique scheme identifier. |

---

## `ScrapeRequester`

The request object accepted by the manager's `getStreams()` and `getSubtitles()` methods. You only need to provide the **minimum required fields** for your media type — the TMDB service automatically fills in any missing data (title, year, duration, IMDB ID, localized titles, etc.) before the scrape begins.

> **How it works:** When you call `getStreams(requester)` or `getSubtitles(requester)`, the manager calls `TMDB.createRequesterMedia()` internally. This acts as a **polyfill** — it fetches metadata from TMDB and merges it with whatever you already provided. Fields you supply are **never overwritten** (except `localizedTitles`, which are always enriched from TMDB translations). If you provide a complete media object, TMDB still runs but only fills gaps.

### Minimum Required Fields

| Media Type | Required Fields                       | Example                                                     |
| ---------- | ------------------------------------- | ----------------------------------------------------------- |
| `movie`    | `type`, `tmdbId`                      | `{ type: "movie", tmdbId: "27205" }`                        |
| `serie`    | `type`, `tmdbId`, `season`, `episode` | `{ type: "serie", tmdbId: "1396", season: 1, episode: 1 }`  |
| `channel`  | `type`, `channelId`, `channelName`    | `{ type: "channel", channelId: "cnn", channelName: "CNN" }` |

> **Note:** Channels don't use TMDB — they are passed through as-is.

### Fields

| Field               | Type                                                           | Required | Description                                                                                                                                                                                             |
| ------------------- | -------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `media`             | `RequesterMovieMedia \| RequesterSerieMedia \| ChannelMedia`   | ✅       | The movie, show, or channel you want to scrape. Can be a **partial** object — only `type` + `tmdbId` are required for movies; `type` + `tmdbId` + `season` + `episode` for series. TMDB fills the rest. |
| `targetLanguageISO` | `string`                                                       | ✅       | Language code like `"en"` or `"fr"`. Used to fetch localized titles from TMDB.                                                                                                                          |
| `userAgent`         | `string`                                                       | ❌       | Custom user-agent string for requests.                                                                                                                                                                  |
| `proxy`             | `ProxyConfig` (`{ agent, auth? }` or `{ resolver, headers? }`) | ❌       | Optional proxy — a proxy agent, or a URL resolver that rewrites requests to a proxy endpoint. See [Configuration → Proxy](CONFIGURATION.md#proxy).                                                      |
| `userIP`            | `string`                                                       | ❌       | Optional user IP address of the requester.                                                                                                                                                              |
| `signal`            | `AbortSignal`                                                  | ❌       | Set by the manager per scrape and forwarded to `ctx.xhr`, so cancelling an operation aborts in-flight provider requests. Not something you normally set yourself.                                        |
| `fetchControls`     | `TProviderFetchControls`                                       | ❌       | Per-host concurrency / rate-limit / coalescing defaults, resolved from the provider config and applied to every `ctx.xhr` call. Manager-populated.                                                       |

> **Note:** The public input you pass to `getStreams` / `getSubtitles` is a `RawScrapeRequester` — the same shape but with a partial `media` (only the [minimum required fields](#minimum-required-fields)) and without `signal` / `fetchControls`. The manager enriches it into the full `ScrapeRequester` (shown above) that reaches provider handlers.

### Examples

```typescript
// Minimal movie request — TMDB auto-fills title, year, duration, imdbId, etc.
const streams = await manager.getStreams({
	media: { type: "movie", tmdbId: "27205" },
	targetLanguageISO: "en"
});

// Minimal series request
const serieStreams = await manager.getStreams({
	media: { type: "serie", tmdbId: "1396", season: 1, episode: 1 },
	targetLanguageISO: "en"
});

// Full media object — TMDB only fills gaps (e.g. localizedTitles)
const fullStreams = await manager.getStreams({
	media: {
		type: "movie",
		title: "Inception",
		duration: 148,
		releaseYear: 2010,
		tmdbId: "27205",
		imdbId: "tt1375666"
	},
	targetLanguageISO: "en"
});
```

---

## `ProviderModuleManifest`

Describes a provider's metadata. The `scheme` field is the provider's unique identifier — it matches the key under which this manifest is registered in the `providers` map and is automatically populated by the engine when modules are loaded from any source.

| Field                 | Type                    | Required | Description                                                                                             |
| --------------------- | ----------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `scheme`              | `string`                | ✅       | Provider scheme identifier (e.g. `"opensubtitles"`). Populated automatically from the registry map key. |
| `name`                | `string`                | ✅       | Human-readable provider name.                                                                           |
| `version`             | `string`                | ✅       | Semver version string (e.g. `"1.0.0"`).                                                                 |
| `active`              | `boolean`               | ✅       | Whether the provider is enabled.                                                                        |
| `language`            | `string \| string[]`    | ✅       | ISO language code(s) — single string (e.g. `"en"`) or array (e.g. `["en", "fr"]`).                      |
| `type`                | `"media" \| "subtitle"` | ✅       | What the provider returns.                                                                              |
| `env`                 | `"node" \| "universal"` | ✅       | Runtime compatibility.                                                                                  |
| `supportedMediaTypes` | `MediaType[]`           | ✅       | `"movie"`, `"serie"`, `"channel"`.                                                                      |
| `priority`            | `number`                | ❌       | Lower = higher priority (default: `0`).                                                                 |
| `dir`                 | `string`                | ❌       | Directory path for the provider folder.                                                                 |

---

## `ProviderMetrics`

Runtime health counters tracked per provider.

| Field           | Type     | Required | Description                         |
| --------------- | -------- | -------- | ----------------------------------- |
| `errors`        | `number` | ✅       | Total failed operations.            |
| `successes`     | `number` | ✅       | Total successful operations.        |
| `lastOperation` | `Date`   | ✅       | Timestamp of most recent operation. |

---

## `ProviderHealthReport`

A detailed health snapshot returned by `getMetricsReport()`.

| Field             | Type      | Required | Description                              |
| ----------------- | --------- | -------- | ---------------------------------------- |
| `moduleName`      | `string`  | ✅       | Provider module name.                    |
| `errors`          | `number`  | ✅       | Total errors.                            |
| `successes`       | `number`  | ✅       | Total successes.                         |
| `totalOperations` | `number`  | ✅       | Sum of errors + successes.               |
| `errorRate`       | `number`  | ✅       | Ratio `0.0` – `1.0`.                     |
| `active`          | `boolean` | ✅       | Whether the module is currently enabled. |
| `lastOperation`   | `Date`    | ✅       | Timestamp of most recent operation.      |

---

## `ProviderContext`

The context object passed as the second argument to every `getStreams` / `getSubtitles` handler.

| Property              | Type                                                   | Required | Description                                                                                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `xhr.fetch`           | `(url, options, requester) => Promise<Response>`       | ✅       | Makes an HTTP request, automatically applying the requester's user-agent and proxy. Supports timeout and retry options.                                                                                                                                            |
| `xhr.fetchResponse`   | `(url, options, requester) => Promise<T>`              | ✅       | Like `fetch` but parses and returns the typed response body directly.                                                                                                                                                                                              |
| `xhr.handleResponse`  | `(response) => Promise<T>`                             | ✅       | Parses a raw `Response` object into a typed value, throwing on error status codes.                                                                                                                                                                                 |
| `xhr.status`          | `(url, options, requester) => Promise<{ ok, status }>` | ✅       | Lightweight check — returns whether the request succeeded and its HTTP status code.                                                                                                                                                                                |
| `cheerio.$load`       | `(html: string) => CheerioAPI`                         | ✅       | Direct access to `cheerio.load` for parsing raw HTML strings you already have, without making an HTTP request.                                                                                                                                                     |
| `cheerio.load`        | `(url, requester, xhrCtx) => Promise<{ $, response }>` | ✅       | Fetches a page and loads it into Cheerio for DOM traversal. Mimics a real browser request with appropriate headers.                                                                                                                                                |
| `cheerio.sortResults` | `($page, selectors, requester) => Promise<Result[]>`   | ✅       | Scores and sorts search result elements by similarity to the requester's media (title, year, duration). Score range: 0–170 for movies/series, 0–100 for channels.                                                                                                  |
| `solveChallenge`      | `(url, requester, options?) => Promise<ChallengeSolveResult>` | ✅ | Solves a Cloudflare / anti-bot interstitial. Uses a host-injected solver when set (an RN hidden WebView or FlareSolverr), otherwise the Node puppeteer pool. Returns the earned html + cookies + user-agent; reuse those on the next `xhr` hops. Stays environment-universal, unlike `puppeteer`. |
| `puppeteer.launch`    | `(url, request) => Promise<{ browser, page }>`         | ✅       | **Node.js only.** Acquires a tab from a manager-owned real browser pool backed by `puppeteer-real-browser`. Handles Cloudflare challenges automatically. Use `browsingOptions.ignoreError` to continue when `page.goto(...)` returns a non-OK or missing response. |
| `log`                 | `DebugLogger`                                          | ✅       | Scoped debug logger bound to this provider's scheme. Provides `.info()`, `.warn()`, `.error()`, and `.debug()` methods. Output respects the manager's `debug` flag — always on in the `test-provider` CLI.                                                         |

---

## `PuppeteerLoadRequest`

Request shape accepted by `ctx.puppeteer.launch(url, request)`.

| Field                          | Type                                                                             | Required | Default              | Description                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------- | -------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `requester`                    | `ScrapeRequester`                                                                | ✅       | —                    | The active scrape requester. Its proxy and user-agent settings are forwarded into the browser session.          |
| `browsingOptions.loadCriteria` | `"domcontentloaded" \| "load" \| "networkidle0" \| "networkidle2" \| Array<...>` | ❌       | `"domcontentloaded"` | Puppeteer wait condition passed to `page.goto(...)`.                                                            |
| `browsingOptions.extraHeaders` | `Record<string, string>`                                                         | ❌       | —                    | Extra request headers to attach before navigation.                                                              |
| `browsingOptions.ignoreError`  | `boolean`                                                                        | ❌       | `false`              | Skip the default navigation error thrown when `page.goto(...)` returns a non-OK response or no response object. |

`browsingOptions` also accepts the supported `puppeteer-real-browser` connect options, except `headless`, `proxy`, and `args`, which are managed by the engine.

> **Note:** The `test-provider` CLI disables headless mode automatically for Puppeteer-based providers so you can inspect the browser during local debugging.

---

## `ProviderFetchOptions`

Options accepted by `ctx.xhr.fetch` / `ctx.xhr.fetchResponse` / `ctx.xhr.status`.

| Field             | Type      | Required | Default | Description                                                                                                                                                            |
| ----------------- | --------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attachUserAgent` | `boolean` | ❌       | `false` | Attach the requester's `User-Agent` header to the request.                                                                                                            |
| `clean`           | `boolean` | ❌       | `false` | Send with no default headers. Normally the engine adds `Content-Type: application/json` and `Accept: application/json`; set `clean` to use only the headers you pass. |

> The requester's proxy (if any) is always applied — providers can't opt out. The engine-owned
> keys `agent`, `proxy`, `maxHostConcurrency`, `honorRateLimit`, and `coalesce` are stripped —
> they are resolved from the provider config, not set per call. Otherwise accepts all fields from
> `RequestInit`, `RequestRetryInit`, and `RequestTimeoutInit`.

---

## Media Input Types

### `IBaseMedia`

Base fields shared by `MovieMedia` and `SerieMedia`.

| Field               | Type       | Required | Description                                                       |
| ------------------- | ---------- | -------- | ----------------------------------------------------------------- |
| `original_language` | `string`   | ✅       | Original language of the media (e.g. `"en"`, `"fr"`).             |
| `title`             | `string`   | ✅       | Original title (always in English).                               |
| `localizedTitles`   | `string[]` | ✅       | Localized titles in the requester's language (populated by TMDB). |
| `duration`          | `number`   | ✅       | Duration in minutes.                                              |
| `releaseYear`       | `number`   | ✅       | Release year.                                                     |
| `tmdbId`            | `string`   | ✅       | TMDB ID.                                                          |
| `imdbId`            | `string`   | ❌       | IMDB ID.                                                          |

> **Note:** When using the manager's `getStreams()` / `getSubtitles()`, you only need to provide `type` + `tmdbId` (for movies) or `type` + `tmdbId` + `season` + `episode` (for series). The TMDB service fills in all other fields automatically. See [ScrapeRequester](#scraperequester) for details.

### `MovieMedia`

`IBaseMedia` with `type: "movie"`. No additional fields.

### `SerieMedia`

`IBaseMedia` plus the following fields:

| Field       | Type      | Required | Description                                            |
| ----------- | --------- | -------- | ------------------------------------------------------ |
| `type`      | `"serie"` | ✅       | Discriminant.                                          |
| `season`    | `number`  | ✅       | Season number.                                         |
| `episode`   | `number`  | ✅       | Episode number.                                        |
| `ep_tmdbId` | `string`  | ❌       | Episode TMDB ID (auto-filled by TMDB if not provided). |
| `ep_imdbId` | `string`  | ❌       | Episode IMDB ID (auto-filled by TMDB if not provided). |

### `ChannelMedia`

| Field         | Type        | Required | Description                |
| ------------- | ----------- | -------- | -------------------------- |
| `type`        | `"channel"` | ✅       | Discriminant.              |
| `channelId`   | `string`    | ✅       | Unique channel identifier. |
| `channelName` | `string`    | ✅       | Channel display name.      |

### Type Aliases

| Name          | Definition                                 |
| ------------- | ------------------------------------------ |
| `Media`       | `MovieMedia \| SerieMedia \| ChannelMedia` |
| `MediaType`   | `"movie" \| "serie" \| "channel"`          |
| `MediaIdType` | `"tmdb" \| "imdb"`                         |

---

## Output Types

### `SourceProvider<T>`

Base interface extended by `MediaSource` and `SubtitleSource`.

| Field          | Type                     | Required | Description                                                                       |
| -------------- | ------------------------ | -------- | --------------------------------------------------------------------------------- |
| `scheme`       | `string`                 | ✅       | Provider scheme identifier.                                                       |
| `providerName` | `string`                 | ✅       | Human-readable provider name.                                                     |
| `language`     | `string`                 | ✅       | ISO language code.                                                                |
| `format`       | `T`                      | ✅       | Media or subtitle format string.                                                 |
| `fileName`     | `string`                 | ✅       | Display file name.                                                                |
| `xhr.flags`    | `SourceFlag[]`           | ✅       | Playback/consumption constraints the host acts on. See [`SourceFlag`](#sourceflag). |
| `xhr.headers`  | `Record<string, string>` | ✅       | Required request headers for playback.                                            |

> **Migration:** the old `xhr.haveCorsPolicy: boolean` was replaced by `xhr.flags: SourceFlag[]`. A CORS-blocked source now sets `flags: ["CORS_BLOCKED"]` instead of `haveCorsPolicy: true`.

#### `SourceFlag`

A string union of consumption hints a provider attaches to a resolved source, telling the host how the URL may be played.

| Value             | Meaning                                                          |
| ----------------- | --------------------------------------------------------------- |
| `"CORS_BLOCKED"`  | Direct browser fetch blocked by CORS; route via a proxy.        |
| `"IP_LOCKED"`     | URL bound to the scraper IP; play from the same IP/proxy.       |
| `"GEO_BLOCKED"`   | Region-restricted origin.                                       |
| `"REFERER_LOCKED"`| Needs the `Referer` from `xhr.headers` to play.                 |
| `"PROXY_ONLY"`    | Only playable through a proxy.                                  |
| `"EXTERNAL"`      | Hand off to an external player/browser.                         |

### `MediaSource`

A resolved-or-lazy union: `ResolvedMediaSource | LazyMediaSource`. Both extend `SourceProvider<MediaFormat>` (so they carry `scheme`, `providerName`, `language`, `format`, `fileName`, `xhr`). Discriminate with `source.lazy` — truthy means lazy, otherwise the source has a `playlist`.

`MediaFormat` = `"m3u8" | "dash" | "mp4" | "webm" | "mkv" | "flv" | "avi" | "mov"`.

**`ResolvedMediaSource`** — fully playable now:

| Field      | Type            | Required | Description                                                         |
| ---------- | --------------- | -------- | ------------------------------------------------------------------- |
| `playlist` | `MediaPlaylist` | ✅       | Adaptive variants, or a single playlist/file URL.                  |
| `lazy`     | `never`         | —        | Absent on a resolved source.                                       |

**`LazyMediaSource`** — resolved on play (see [`getLazyStreams` / lazy mode](#grabitmanager)):

| Field      | Type         | Required | Description                                                                    |
| ---------- | ------------ | -------- | ----------------------------------------------------------------------------- |
| `lazy`     | `LazySource` | ✅       | Unresolved handle. The host calls `resolveLazySource(scheme, lazy.id, req)`.  |
| `playlist` | `never`      | —        | Absent until resolved.                                                        |

**`MediaPlaylist`** = `string` (single URL) **or** an array of variant objects:

| Field        | Type                    | Description                                     |
| ------------ | ----------------------- | ----------------------------------------------- |
| `bandwidth`  | `number`                | Variant bandwidth in bits/s.                    |
| `dimensions` | `` `${number}x${number}` `` | Pixel dimensions, e.g. `"1920x1080"`.       |
| `resolution` | `` `${number}p` `` \| `string` | Resolution label, e.g. `"1080p"`.        |
| `source`     | `string`                | Variant URL.                                    |

**`LazySource`**

| Field   | Type     | Required | Description                                                              |
| ------- | -------- | -------- | ----------------------------------------------------------------------- |
| `id`    | `string` | ✅       | Opaque handle passed back to the provider's `resolveLazy(id, ctx)`.     |
| `label` | `string` | ❌       | Optional human-readable label (e.g. a server name) shown before resolve. |

### `SubtitleSource`

Extends `SourceProvider<"srt" | "vtt">` (keeping the inherited `fileName` and `language`) plus:

| Field          | Type     | Required | Description                                      |
| -------------- | -------- | -------- | ------------------------------------------------ |
| `languageName` | `string` | ✅       | Human-readable language name (e.g. `"English"`). |
| `url`          | `string` | ✅       | Direct URL to the subtitle file.                 |

### Internal Types

What a provider's workers return — the engine injects `scheme` / `providerName` / `format` afterwards.

| Name                     | Definition                                                                              | Description                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `InternalMediaSource`    | `InternalResolvedMediaSource \| InternalLazyMediaSource`                                 | Return from `getStreams()` / `getLazyStreams()`. Same resolved-or-lazy union, minus the engine-injected fields; `format` is optional. |
| `InternalResolvedMediaSource` | `Omit<SourceProvider<MediaFormat>, "scheme" \| "providerName" \| "format"> & { format?, playlist, lazy?: never }` | A resolved source shaped by a provider.                                     |
| `InternalLazyMediaSource` | `Omit<SourceProvider<MediaFormat>, "scheme" \| "providerName" \| "format"> & { format?, lazy: LazySource, playlist?: never }` | A lazy handle shaped by a provider.                                            |
| `InternalSubtitleSource` | `Omit<SubtitleSource, "providerName" \| "scheme">`                                        | Return from `getSubtitles()`.                                                                      |

---

## Provider Configuration

### `ProviderConfig`

Configuration object used to define a provider's identity, endpoints, and behaviour.

| Field                                  | Type                     | Required | Description                                                                                                                                    |
| -------------------------------------- | ------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `scheme`                               | `string`                 | ✅       | Unique provider identifier (e.g. `"vidsrc"`).                                                                                                  |
| `name`                                 | `string`                 | ✅       | Human-readable name.                                                                                                                           |
| `language`                             | `string \| string[]`     | ✅       | ISO language code(s) — single string (e.g. `"en"`) or array (e.g. `["en", "fr"]`).                                                             |
| `baseUrl`                              | `string`                 | ✅       | Provider homepage URL.                                                                                                                         |
| `entries`                              | `TProviderEntries`       | ✅       | Media type → endpoint pattern map.                                                                                                             |
| `mediaIds`                             | `MediaIdType[]`          | ❌       | Preferred ID types, ordered by preference. Default: `["tmdb"]`.                                                                                |
| `contentAreCORSProtected`              | `boolean`                | ❌       | Whether content responses have CORS restrictions.                                                                                              |
| `xhr.validateSources`                  | `boolean`                | ❌       | When enabled, fetches each media URL before returning it to verify the source is accessible. Filters dead links at the cost of extra requests. |
| `xhr.headers`                          | `Record<string, string>` | ❌       | Custom headers sent with every request to this provider.                                                                                       |
| `xhr.retries.maxAttempts`              | `number`                 | ❌       | Max retry attempts per request.                                                                                                                |
| `xhr.retries.timeout`                  | `number`                 | ❌       | Per-attempt timeout in ms.                                                                                                                     |
| `xhr.maxHostConcurrency`               | `number`                 | ❌       | Cap concurrent in-flight requests per host. Default `10`.                                                                                       |
| `xhr.honorRateLimit`                   | `boolean`                | ❌       | Honor `429` `Retry-After` back-off. Default `true`.                                                                                             |
| `xhr.coalesce`                         | `boolean`                | ❌       | Dedupe identical in-flight cacheable GETs. Default `true`.                                                                                      |
| `useSearchAlgorithm.enabled`           | `boolean`                | ❌       | Use the search-and-score algorithm to find media.                                                                                              |
| `useSearchAlgorithm.minimumMatchScore` | `number`                 | ❌       | Minimum score (0–170) to accept a match.                                                                                                       |

### `TProviderEntryPatterns`

Defines how a media type maps to provider endpoints.

| Field      | Type                                          | Required | Description                                                                    |
| ---------- | --------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `endpoint` | `string`                                      | ✅       | URL path with placeholders, e.g. `"/embed/movie?tmdb={id:string}"`.            |
| `pattern`  | `string`                                      | ❌       | Extra pattern appended for search/matching, e.g. `"-{season:2}x{episode:2}/"`. |
| `queries`  | `Record<string, string \| number \| boolean>` | ❌       | Additional static query parameters.                                            |

#### Supported Placeholder Formats

| Syntax           | Example            | Result                                   |
| ---------------- | ------------------ | ---------------------------------------- |
| `{key:string}`   | `{id:string}`      | Raw string value.                        |
| `{key:uri}`      | `{title:uri}`      | `encodeURIComponent`.                    |
| `{key:form-uri}` | `{title:form-uri}` | `encodeURIComponent` with spaces as `+`. |
| `{key:N}`        | `{season:2}`       | Zero-padded to N digits.                 |
| `{N}`            | `{0}`              | Indexed arg via `EProviderQueryKey`.     |

### `EProviderQueryKey`

Enum mapping numeric index placeholders (`{0}`, `{1}`, …) to media fields.

| Key       | Index | Resolves To                        |
| --------- | ----- | ---------------------------------- |
| `id`      | 0     | Preferred media ID (TMDB or IMDB). |
| `tmdb`    | 1     | TMDB ID.                           |
| `imdb`    | 2     | IMDB ID.                           |
| `title`   | 3     | Media title.                       |
| `year`    | 4     | Release year.                      |
| `season`  | 5     | Season number.                     |
| `episode` | 6     | Episode number.                    |
| `ep_id`   | 7     | Preferred episode ID.              |
| `ep_tmdb` | 8     | Episode TMDB ID.                   |
| `ep_imdb` | 9     | Episode IMDB ID.                   |

### `TProviderSelectors`

Cheerio selectors used by `cheerio.sortResults`. All values are CSS selector strings.

| Field              | Type     | Required | Description                                        |
| ------------------ | -------- | -------- | -------------------------------------------------- |
| `$results`         | `string` | ✅       | Selector for the results container.                |
| `$result_entry`    | `string` | ✅       | Selector for each result row inside the container. |
| `$result_title`    | `string` | ✅       | Selector for the title element inside a result.    |
| `$result_year`     | `string` | ❌       | Selector for the year element.                     |
| `$result_date`     | `string` | ❌       | Selector for the release date element.             |
| `$result_duration` | `string` | ❌       | Selector for the duration element.                 |

---

## `Provider` Class

The runtime class built from a `ProviderConfig`. Constructed via the static factory method.

```typescript
const provider = Provider.create(config);
```

| Method                                                          | Returns          | Description                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Provider.create(config)`                                       | `Provider`       | Creates a `Provider` instance from a `ProviderConfig`.                                                                                                                                                                                            |
| `config`                                                        | `ProviderConfig` | The config the instance was built from (public property).                                                                                                                                                                                        |
| `createResourceURL(requester, localizedTextIndex?)`             | `URL`            | Builds the full scrape URL by substituting endpoint placeholders with media data. `localizedTextIndex`: `undefined` auto-selects a title by provider language, a `number` picks that `localizedTitles` index (wraps), `null` forces the original title. |
| `createResourceUrls(requester, customURL?)`                     | `URL[]`          | Deduplicated, priority-ordered URLs: the ID-based URL first, then localized-title variants. `customURL` overrides the first entry.                                                                                                                |
| `createPatternString(pattern, media, customPattern?, localizedTextIndex?)` | `string` | Replaces placeholders in `pattern` with media values (plus any `customPattern` extras). Same placeholder syntax as `entries`.                                                                                                            |
| `applyPatternURL(urlOrPath, requester)`                         | `URL`            | Applies the provider's entry pattern to an arbitrary URL/path, substituting media placeholders.                                                                                                                                                   |
| `isMediaSupported(media)`                                       | `boolean`        | Whether this provider has an entry for the media's type.                                                                                                                                                                                          |
| `retrievePreferedIds(media)`                                    | `SupportedId`    | The preferred `{ id }` (and `{ ep_id }` for series) per the config's `mediaIds` order.                                                                                                                                                            |
| `getPrimaryLanguage()`                                          | `string`         | The provider's primary (first) language code.                                                                                                                                                                                                     |
| `useTranslation(media)`                                         | `boolean`        | Whether a localized title should be used (provider language differs from the media's original language).                                                                                                                                          |

---

## Error Classes

Custom error types thrown during scraping operations. Both extend `Error` and can be identified with the `isCustomError()` utility.

Both are constructed from a payload object (`{ code, message, details?, expose?, … }`) and expose it as readonly instance properties.

### `HttpError`

Thrown when an HTTP request fails.

| Field        | Type      | Required | Description                                                                     |
| ------------ | --------- | -------- | ------------------------------------------------------------------------------- |
| `code`       | `string`  | ✅       | Unique error code identifier (e.g. `"NOT_FOUND"`).                              |
| `message`    | `string`  | ✅       | Error message (sanitized, inherited from `Error`).                             |
| `statusCode` | `number`  | ✅       | HTTP status code. Defaults to `500` when the payload omits it.                 |
| `expose`     | `boolean` | ✅       | Whether to expose error details to the client. Defaults to `isDevelopment()`.  |
| `details`    | `unknown` | ❌       | Optional typed extra details (generic `TErrorDetails`).                        |

> Also provides `statusPayload(withDetails = false)`, returning `{ code, message, details? }` for HTTP responses. Identify with `isHttpError(err)`.

### `ProcessError`

Thrown when a provider's scraping logic encounters a non-HTTP error.

| Field     | Type      | Required | Description                                                                    |
| --------- | --------- | -------- | ----------------------------------------------------------------------------- |
| `code`    | `string`  | ✅       | Unique error code identifier (e.g. `"VALIDATION_FAILED"`).                    |
| `message` | `string`  | ✅       | Error message (sanitized, inherited from `Error`).                           |
| `expose`  | `boolean` | ✅       | Whether to expose error details to the client. Defaults to `isDevelopment()`. |
| `status`  | `number`  | ❌       | Optional HTTP status code associated with the error.                         |
| `details` | `unknown` | ❌       | Optional typed extra details (generic `TErrorDetails`).                       |

> Identify with `isProcessError(err)`.

---

## Utility Functions

All utilities below are exported from the package root (`import { ... } from "grabit-engine"`).

### Extractor (`utils/extractor`)

Helpers for extracting data from HTML and JavaScript source strings.

| Function                               | Signature                                 | Description                                                                                            |
| -------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `extractYearFromText`                  | `(text) → number \| null`                 | Extracts the first 4-digit year (1900–2099) from a string.                                             |
| `extractSetCookies`                    | `(headers) → string[]`                    | Normalises `Set-Cookie` headers into a `string[]`, handles `Headers`-like objects.                     |
| `extractEvalCode`                      | `(source) → string \| null`               | Returns the first `eval(…)` call found in source.                                                      |
| `extractVariableByJSONKey`             | `(source, requiredKeys) → object \| null` | Finds a `var/let/const` declaration whose object value contains **all** required keys.                 |
| `extractContructorJSONArguments`       | `(codeString) → object \| null`           | Parses the first function/constructor call's arguments from a JS snippet.                              |
| `extractContructorJSONArgumentsByName` | `(source, functionName) → object \| null` | Same as above but searches for a specific named function in a larger source.                           |
| `extractVariableJSON`                  | `(source, varName) → object \| null`      | Extracts and parses a `var/let/const varName = { … }` object.                                          |
| `extractVariableValue`                 | `(source, varName) → string \| null`      | Extracts a scalar value (string/number/bool/null) from `const x = …` or bare `x.prop = …` assignments. |

### Path (`utils/path`)

URL and path construction utilities.

| Function            | Signature                                   | Description                                                                       |
| ------------------- | ------------------------------------------- | --------------------------------------------------------------------------------- |
| `stringFromPattern` | `(pattern, params) → string`                | Replaces `{key:type}` placeholders in a pattern string with values from `params`. |
| `formatString`      | `(pattern, args) → string`                  | Replaces indexed `{0}`, `{1}` … placeholders with positional args.                |
| `encodeURI`         | `(str, type?) → string`                     | URI-encodes a string; `type: "form-uri"` encodes spaces as `+`.                   |
| `buildRelativePath` | `(entry, params, includePattern?) → string` | Builds a provider relative URL from a `TProviderEntryPatterns` entry.             |
| `pathJoin`          | `(...parts) → string`                       | Joins path segments, deduplicating slashes.                                       |

### Similarity (`utils/similarity`)

String and media similarity scoring.

| Function                     | Signature                         | Description                                                                                                             |
| ---------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `calculateMatchScore`        | `(criteria, media) → number`      | Scores a candidate (title, year, duration) against a `Media` object. Range 0–170 for movies/series, 0–100 for channels. |
| `advanceLevenshteinDistance` | `(itemName, targetName) → number` | Levenshtein distance with bonuses for prefix/word matches (lower = more similar).                                       |
| `levenshteinDistance`        | `(a, b) → number`                 | Standard Levenshtein edit distance.                                                                                     |
| `cosineSimilarity`           | `(a, b) → number`                 | Cosine similarity of word-frequency vectors. Returns 0–1.                                                               |

### Standard (`utils/standard`)

General-purpose runtime helpers.

| Function                | Signature                                        | Description                                                               |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `isDevelopment`         | `() → boolean`                                   | `true` when `process.env.ENV !== "production"`.                           |
| `isNode`                | `() → boolean`                                   | `true` when running in a Node.js environment.                             |
| `isCustomError`         | `(error) → error is HttpError \| ProcessError`   | Type guard for custom error classes.                                      |
| `minutesToMilliseconds` | `(minutes) → number`                             | Converts minutes → ms.                                                    |
| `hoursToMilliseconds`   | `(hours) → number`                               | Converts hours → ms.                                                      |
| `secondsToMilliseconds` | `(seconds) → number`                             | Converts seconds → ms.                                                    |
| `customParseInt`        | `(input) → number`                               | Parses a digit-only string; returns `NaN` for anything else.              |
| `commaSplitter`         | `(input) → string[]`                             | Splits a comma-separated string, trimming each part.                      |
| `delay`                 | `(ms) → Promise<void>`                           | Awaitable sleep.                                                          |
| `excuteWithRetries`     | `(fn, maxAttempts?, backoffDelay?) → Promise<T>` | Runs `fn` up to `maxAttempts` times with optional delay between attempts. |
| `sorter`                | `(items, compareFn) → Promise<T[]>`              | Async merge-sort with an async comparator.                                |
| `createCookiesFromSet`  | `(headers) → string`                             | Converts `Set-Cookie` headers into a single `Cookie` header string.       |
| `joinCookies`           | `(existingCookies, newCookies) → string`         | Merges two cookie strings, deduplicating entries.                         |
| `attachExtension`       | `(extension, urlOrPath) → string`                | Appends or replaces the file extension on a URL or path.                  |
| `shuffleArray`          | `(array) → T[]`                                  | Returns a new array with elements randomly shuffled (Fisher–Yates).       |

### React Native / browser (`utils/native`)

Helpers for loading the `github` source outside Node. Exported from the package root.

| Function             | Signature                                                | Description                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `moduleResolver`     | `(scheme, sourceCode) → Promise<ProviderModule>`         | Default `moduleResolver` for `GithubSource`. Evaluates a fetched bundle with the `Function` constructor (Hermes-safe, unlike `eval`) and re-throws failures with the provider scheme attached. |
| `setupGrabitGlobals` | `(options?: GrabitGlobalsOptions) → GrabitGlobalsReport` | Registers the globals bundled providers read at runtime and reports runtime support. Call once before creating a manager. Never overwrites existing globals.                                   |

**`GrabitGlobalsOptions`**

| Field    | Type                 | Description                                                                                                                                                                                                |
| -------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crypto` | `unknown`            | Crypto implementation, exposed as `globalThis.__grabitCrypto`. In RN: `require("react-native-quick-crypto")`. Optional.                                                                                    |
| `buffer` | `unknown`            | Buffer implementation, exposed as `globalThis.Buffer`. In RN: `require("@craftzdog/react-native-buffer").Buffer`. Optional but required for providers that decode binary data — RN has no global `Buffer`. |
| `base64` | `{ encode, decode }` | base64 codec used to polyfill `globalThis.btoa` / `globalThis.atob` on runtimes that lack them (RN < 0.74). In RN: `require("base-64")`. Ignored when the runtime already provides both.                   |
| `env`    | `Record<string, string \| undefined>` | Env values for provider bundles, exposed as `globalThis.__grabitEnv`. Provider bundles are eval'd outside the Metro graph so `process.env` stays empty — providers that need a key read `__grabitEnv` instead. In RN, source the values from `EXPO_PUBLIC_`-prefixed vars so Metro inlines them. Merged onto any existing `__grabitEnv`. Never put a truly-secret value here — client bundles are readable by users. Optional. |

**`GrabitGlobalsReport`**

| Field                 | Type       | Description                                                             |
| --------------------- | ---------- | ----------------------------------------------------------------------- |
| `crypto`              | `boolean`  | `globalThis.__grabitCrypto` is set.                                     |
| `buffer`              | `boolean`  | `globalThis.Buffer` is set.                                             |
| `env`                 | `boolean`  | `globalThis.__grabitEnv` is set.                                        |
| `atob`                | `boolean`  | `atob` exists globally (RN ≥ 0.74 provides it).                         |
| `functionConstructor` | `boolean`  | The `Function` constructor works — the GitHub-source model requires it. |
| `errors`              | `string[]` | Assignment failures, one per failed global.                             |

```ts
import { GrabitManager, moduleResolver, setupGrabitGlobals } from "grabit-engine";
import QuickCrypto from "react-native-quick-crypto";
import { Buffer } from "@craftzdog/react-native-buffer";
import base64 from "base-64";

setupGrabitGlobals({
	crypto: QuickCrypto,
	buffer: Buffer,
	base64,
	// Exposed as globalThis.__grabitEnv; providers read keys from here, not process.env.
	env: { WYZIE_SUBS_KEYS: process.env.EXPO_PUBLIC_WYZIE_SUBS_KEYS },
});

const manager = await GrabitManager.create({
	source: { type: "github", url: "owner/repo", branch: "main", moduleResolver },
	tmdbApiKeys: [KEY]
});
```

---

## Services

### Unpacker (`services/unpacker`)

Utilities for handling P.A.C.K.E.R.-obfuscated JavaScript.

| Function       | Signature            | Description                                         |
| -------------- | -------------------- | --------------------------------------------------- |
| `detectPacked` | `(source) → boolean` | Returns `true` if `source` is P.A.C.K.E.R. encoded. |
| `unpackV1`     | `(code) → string`    | Unpacks a P.A.C.K.E.R. v1 encoded JS string.        |

### Crypto (`services/crypto`)

Re-exports Node's built-in `crypto` module as a named export.

> **Node.js only.** This export is reachable from the Node entry point (`require("grabit-engine")` or an ESM import resolved through the `node` condition). It is deliberately absent from the browser and React Native entry points: it imports the Node built-in `crypto`, which Webpack, Vite and Metro do not polyfill, so a bundle that included it would fail to build.

For **browsers and React Native**, pass a crypto implementation to [`setupGrabitGlobals`](#react-native--browser-helpers-utilsnative) instead. In React Native install [`react-native-quick-crypto`](https://www.npmjs.com/package/react-native-quick-crypto):

```bash
npm install react-native-quick-crypto
```

`atob` / `btoa` are likewise not polyfilled here. Runtimes that lack them (React Native < 0.74) get them from `setupGrabitGlobals({ base64: require("base-64") })`.

GitHub-loaded provider bundles resolve `Crypto` at runtime from `react-native-quick-crypto`, `crypto`, `globalThis.__grabitCrypto`, or `globalThis.crypto`, so React Native apps should register the global before evaluating remote provider source.

```typescript
import { Crypto } from "grabit-engine"; // Node.js entry point

const hash = Crypto.createHash("md5").update("hello").digest("hex");
```

### tldts

Re-exported [`tldts`](https://www.npmjs.com/package/tldts) for URL hostname parsing, domain extraction, and public suffix lookups.

```typescript
import { tldts } from "grabit-engine";

tldts.parse("https://www.example.co.uk/path");
// → { hostname: 'www.example.co.uk', domain: 'example.co.uk', publicSuffix: 'co.uk', ... }

tldts.getDomain("https://www.example.co.uk"); // → 'example.co.uk'
```

### ISO 639-1

Re-exported [`iso-639-1`](https://www.npmjs.com/package/iso-639-1) for convenience.

```typescript
import { ISO6391 } from "grabit-engine";

ISO6391.getName("fr"); // → "French"
ISO6391.validate("en"); // → true
```
