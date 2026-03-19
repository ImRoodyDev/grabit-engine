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

| Method                                  | Returns                                | Description                                                                                                                 |
| --------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GrabitManager.create(config)`          | `Promise<GrabitManager>`               | Creates the manager and loads all your provider plugins.                                                                    |
| `getStreams(request)`                   | `Promise<MediaSource[]>`               | Gets streams from **all active providers** for the given media. Returns everything in one list.                             |
| `getSubtitles(request)`                 | `Promise<SubtitleSource[]>`            | Gets subtitles from **all active providers** for the given media.                                                           |
| `getStreamsByScheme(scheme, request)`   | `Promise<MediaSource[]>`               | Gets streams from **one specific provider** by its scheme.                                                                  |
| `getSubtitlesByScheme(scheme, request)` | `Promise<SubtitleSource[]>`            | Gets subtitles from **one specific provider** by its scheme.                                                                |
| `closeOperations()`                     | `Promise<void>`                        | Cancels all in-progress and queued scrape operations. Useful for cleanup when navigating away or aborting.                  |
| `getProvidersByRequest(type, request)`  | `ProviderModule[]`                     | Returns the list of active providers that match the given type (`"media"` or `"subtitle"`) and request, sorted by priority. |
| `getMetrics()`                          | `ReadonlyMap<string, ProviderMetrics>` | Returns health stats for each provider (errors, successes, last activity).                                                  |
| `getMetricsReport()`                    | `ProviderHealthReport[]`               | Returns a full health report for every loaded provider — error rate, status, and more.                                      |

### `ProviderManagerConfig`

The configuration object passed to `GrabitManager.create(config)`.

| Field                                            | Type             | Required | Default     | Description                                                                                                                                                                    |
| ------------------------------------------------ | ---------------- | -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `source`                                         | `ProviderSource` | ✅       | —           | Where to load providers from. See [ProviderSource](#providersource) below.                                                                                                     |
| `tmdbApiKeys`                                    | `string[]`       | ✅       | —           | One or more TMDB API keys used for metadata lookups.                                                                                                                           |
| `debug`                                          | `boolean`        | ❌       | `false`     | Enables extra logging and error information for development.                                                                                                                   |
| `strict`                                         | `boolean`        | ❌       | `false`     | Throw on validation errors instead of warning.                                                                                                                                 |
| `autoInit`                                       | `boolean`        | ❌       | —           | Auto-initialize providers on load.                                                                                                                                             |
| `autoUpdateIntervalMinutes`                      | `number`         | ❌       | `15`        | Interval (in minutes) for auto-updating providers from remote sources. Minimum is 5. **Only applies to remote sources.**                                                       |
| `cache`                                          | `object`         | ❌       | —           | Caching configuration. See below.                                                                                                                                              |
| `cache.enabled`                                  | `boolean`        | ✅       | `false`     | Whether to enable caching of provider data.                                                                                                                                    |
| `cache.TTL`                                      | `number`         | ✅       | `0`         | Cache expiration TTL in milliseconds for scraped data.                                                                                                                         |
| `cache.MODULE_TTL`                               | `number`         | ❌       | `900_000`   | TTL in milliseconds for caching provider modules. Separate from data TTL to allow different strategies.                                                                        |
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
| `scrapeConfig.puppeteer.maxBrowserSessionTTL`    | `number`         | ❌       | `600_000`   | Maximum time (ms) a single page lease may stay open before it is auto-released and a warning is logged. Guards against providers that forget to call `browser.close()`.        |

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
| `manifest` | `ProvidersManifest`                                                 | ✅       | —       | The manifest object — import or require it yourself.                                                                                 |
| `rootDir`  | `string`                                                            | ❌       | `"./"`  | Base directory prepended to every provider path in the manifest. Trailing slash added automatically.                                 |
| `resolve`  | `(modulePath: string) => ProviderModule \| Promise<ProviderModule>` | ✅       | —       | Module resolver called for each provider with the full path. Must return the `ProviderModule` (or a module whose `.default` is one). |

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

| Field               | Type                                                         | Required | Description                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `media`             | `RequesterMovieMedia \| RequesterSerieMedia \| ChannelMedia` | ✅       | The movie, show, or channel you want to scrape. Can be a **partial** object — only `type` + `tmdbId` are required for movies; `type` + `tmdbId` + `season` + `episode` for series. TMDB fills the rest. |
| `targetLanguageISO` | `string`                                                     | ✅       | Language code like `"en"` or `"fr"`. Used to fetch localized titles from TMDB.                                                                                                                          |
| `userAgent`         | `string`                                                     | ❌       | Custom user-agent string for requests.                                                                                                                                                                  |
| `proxyAgent`        | `HttpsProxyAgent \| SocksProxyAgent \| HttpProxyAgent`       | ❌       | Optional proxy for routing requests.                                                                                                                                                                    |
| `userIP`            | `string`                                                     | ❌       | Optional user IP address of the requester.                                                                                                                                                              |

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

Describes a provider's metadata inside a manifest. The provider's unique scheme identifier is **not** stored inside this object — it is the key under which this manifest is registered in the `providers` map (e.g. `{ "my-provider": { name: "...", ... } }`).

| Field                 | Type                    | Required | Description                                                                        |
| --------------------- | ----------------------- | -------- | ---------------------------------------------------------------------------------- |
| `name`                | `string`                | ✅       | Human-readable provider name.                                                      |
| `version`             | `string`                | ✅       | Semver version string (e.g. `"1.0.0"`).                                            |
| `active`              | `boolean`               | ✅       | Whether the provider is enabled.                                                   |
| `language`            | `string \| string[]`    | ✅       | ISO language code(s) — single string (e.g. `"en"`) or array (e.g. `["en", "fr"]`). |
| `type`                | `"media" \| "subtitle"` | ✅       | What the provider returns.                                                         |
| `env`                 | `"node" \| "universal"` | ✅       | Runtime compatibility.                                                             |
| `supportedMediaTypes` | `MediaType[]`           | ✅       | `"movie"`, `"serie"`, `"channel"`.                                                 |
| `priority`            | `number`                | ❌       | Lower = higher priority (default: `0`).                                            |
| `dir`                 | `string`                | ❌       | Directory path for the provider folder.                                            |

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

| Field             | Type      | Required | Default | Description                                                         |
| ----------------- | --------- | -------- | ------- | ------------------------------------------------------------------- |
| `attachUserAgent` | `boolean` | ❌       | `false` | Attach the requester's `User-Agent` header to the request.          |
| `attachProxy`     | `boolean` | ❌       | `true`  | Route the request through the requester's proxy if one is provided. |

> Also accepts all fields from `RequestInit`, `RequestRetryInit`, and `RequestTimeoutInit`.

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

| Field                | Type                     | Required | Description                            |
| -------------------- | ------------------------ | -------- | -------------------------------------- |
| `scheme`             | `string`                 | ✅       | Provider scheme identifier.            |
| `providerName`       | `string`                 | ✅       | Human-readable provider name.          |
| `language`           | `string`                 | ✅       | ISO language code.                     |
| `format`             | `T`                      | ✅       | Media or subtitle format string.       |
| `xhr.haveCorsPolicy` | `boolean`                | ✅       | Whether the source has a CORS policy.  |
| `xhr.headers`        | `Record<string, string>` | ✅       | Required request headers for playback. |

### `MediaSource`

Extends `SourceProvider<"m3u8" | "dash" | "mp4" | "webm" | "mkv" | "flv" | "avi" | "mov">`.

| Field      | Type                        | Required | Description                                                    |
| ---------- | --------------------------- | -------- | -------------------------------------------------------------- |
| `fileName` | `string`                    | ✅       | Display file name.                                             |
| `playlist` | `string \| PlaylistEntry[]` | ✅       | Direct URL or an array of bandwidth/resolution/source entries. |

### `SubtitleSource`

Extends `SourceProvider<"srt" | "vtt">` (without inherited `language`).

| Field          | Type     | Required | Description                                      |
| -------------- | -------- | -------- | ------------------------------------------------ |
| `fileName`     | `string` | ✅       | Display file name.                               |
| `language`     | `string` | ✅       | ISO language code (e.g. `"en"`).                 |
| `languageName` | `string` | ✅       | Human-readable language name (e.g. `"English"`). |
| `url`          | `string` | ✅       | Direct URL to the subtitle file.                 |

### Internal Types

| Name                     | Definition                                         | Description                                                |
| ------------------------ | -------------------------------------------------- | ---------------------------------------------------------- |
| `InternalMediaSource`    | `Omit<MediaSource, "providerName" \| "scheme">`    | Use this in `getStreams()` return value inside a provider. |
| `InternalSubtitleSource` | `Omit<SubtitleSource, "providerName" \| "scheme">` | Use this in `getSubtitles()`.                              |

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

| Method                                             | Returns    | Description                                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Provider.create(config)`                          | `Provider` | Creates a `Provider` instance from a `ProviderConfig`.                                                                                                                                                                                                                            |
| `createResourceURL(requester, useLocalizedTitle?)` | `URL`      | Builds the full scrape URL by substituting endpoint placeholders with media data from the requester. `useLocalizedTitle` (default: `true`) controls whether the localized title is used instead of the original title (only applies when the provider's language is not English). |

---

## Error Classes

Custom error types thrown during scraping operations. Both extend `Error` and can be identified with the `isCustomError()` utility.

### `HttpError`

Thrown when an HTTP request fails.

| Field        | Type     | Required | Description       |
| ------------ | -------- | -------- | ----------------- |
| `statusCode` | `number` | ✅       | HTTP status code. |
| `message`    | `string` | ✅       | Error message.    |

### `ProcessError`

Thrown when a provider's scraping logic encounters a non-HTTP error.

| Field     | Type     | Required | Description    |
| --------- | -------- | -------- | -------------- |
| `message` | `string` | ✅       | Error message. |

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

---

## Services

### Unpacker (`services/unpacker`)

Utilities for handling P.A.C.K.E.R.-obfuscated JavaScript.

| Function       | Signature            | Description                                         |
| -------------- | -------------------- | --------------------------------------------------- |
| `detectPacked` | `(source) → boolean` | Returns `true` if `source` is P.A.C.K.E.R. encoded. |
| `unpackV1`     | `(code) → string`    | Unpacks a P.A.C.K.E.R. v1 encoded JS string.        |

### Crypto (`services/crypto`)

Re-exports Node's built-in `crypto` module as a named export for cross-environment use.

For **React Native**, the native `crypto` module is not available. Install [`react-native-quick-crypto`](https://www.npmjs.com/package/react-native-quick-crypto) as a drop-in polyfill:

```bash
npm install react-native-quick-crypto
```

This module also polyfills `atob` / `btoa` for environments that don't expose them globally (e.g. React Native < 0.74), using the optional peer dependency [`base-64`](https://www.npmjs.com/package/base-64).

GitHub-loaded provider bundles also resolve `Crypto` at runtime from `react-native-quick-crypto`, `crypto`, `globalThis.__grabitCrypto`, or `globalThis.crypto`, so React Native apps should install the polyfill before evaluating remote provider source.

```typescript
import { Crypto } from "grabit-engine";

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
