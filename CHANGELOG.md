# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog.

## [1.2.0]

> Not yet published. Consolidates the `1.2.0-alpha.0` – `1.2.0-alpha.5` prereleases, whose entries were never recorded separately.

### Breaking

- Renamed the manager class `ScrapePluginManager` to `GrabitManager`.
- `getStreamsByScheme` / `getSubtitlesByScheme` now take a `RawScrapeRequester` and enrich internally, matching `getStreams` / `getSubtitles`.
- `services/crypto` is reachable only from the Node entry point. It imports the Node built-in `crypto`, which Webpack, Vite and Metro do not polyfill, so browser builds resolving `dist/esm/src/index.js` failed outright. Browser and React Native consumers pass an implementation to `setupGrabitGlobals` instead.
- Dropped `base-64` from `dependencies` — nothing imports it any more. React Native < 0.74 users install it themselves and pass it to `setupGrabitGlobals({ base64 })`; every other runtime has native `atob`/`btoa`.
- Default `scrapeConfig.puppeteer.maxBrowserSessionTTL` lowered from 10 minutes to 2. With a 2-browser pool, a provider that forgets `browser.close()` held half of it for the full TTL.
- Removed `browsingOptions.closeOnComplete`. The page stays open after `puppeteer.launch()`; providers must call `browser.close()` to release the tab.
- `sanitizeMessage`, `retriesCount` and `formatTimestamp` moved to `utils/internal` and are no longer exported.
- Removed `puppeteer-real-browser` from `optionalDependencies`; it stays an optional peer, so it is never installed unless the app asks for it.

### Added

- Native cold-start performance controls for loading providers, all opt-in and non-breaking:
  - `GithubSource.persistentStore` (AsyncStorage/MMKV/localStorage shape) persists fetched bundle source across app restarts, keyed by `scheme@version`, so a warm start reuses the persisted copy instead of re-downloading every provider. The manifest is stored with its ETag and fetched conditionally (`If-None-Match` → 304 reuse), and the persisted manifest is the offline fallback when the network is unreachable. Backed by `services/providerStore.ts`, fully guarded so a broken store degrades to a normal fetch.
  - `source.filter` (`{ schemes?, languages? }`) on every source — drops providers the app will never use *before* paying their fetch + eval cost.
  - `source.concurrency` overrides the fixed 6-at-a-time bundle download on GitHub/local loads and `refreshModules`, to cap memory on low-end devices.
  - `GithubSource.yieldOnEval` (default on off-Node) yields to the event loop before each synchronous bundle compile, so the UI thread paints between providers instead of blocking through the whole set.
  - `config.autoUpdateOnNative` (default off) — the background auto-update interval no longer runs on native/browser unless enabled, avoiding periodic re-fetch + re-eval jank.
- Puppeteer browser pooling, so Node scraping reuses warm processes instead of spawning a browser per request — `maxConcurrentBrowsers`, `minWarmBrowsers`, `idleBrowserTTL`, and `maxBrowserSessionTTL`, which auto-releases leaked tabs and always warns.
- `scrapeConfig.waitForActiveProvidersAfterQuorum` — on quorum, still cancel queued providers but wait for ones already running.
- `scrapeProvider(requester, scheme)` and `getAvailableProviders(type, requester)` hook callbacks, both on `UseSourcesReturn`.
- Exported the manager lifecycle primitives `useManager`, `acquireManager`, and `releaseManager` (from `grabit-engine/react`, and the browser/native barrels). `acquireManager(config)` lets an app pre-warm the `GrabitManager` singleton at startup so the first scraping screen finds providers already loaded instead of paying the load cost on first navigation.
- Guaranteed `meta.scheme` on every loaded `ProviderModule`, injected from the registry key by all three source services.
- A dedicated React Native entry point and RN-safe type barrel.
- `setupGrabitGlobals({ base64 })` to install `atob`/`btoa` where the runtime lacks them.
- `GithubSource.persistentStoreTTL` (default 7 days) plus a single global index key (`grabit:index`) that tracks every persisted bundle and manifest with an expiry. A one-shot prune runs at startup and every autoUpdate tick, deleting entries that have sat unused past their TTL so `persistentStore` no longer grows unbounded as provider versions bump. Because the index is global, a prune also clears leftovers from sources no longer in use (e.g. after switching repo/branch), not just the active source. Reusing a bundle refreshes its expiry. The startup prune runs regardless of autoUpdate, so stale storage is cleared even on native without `autoUpdateOnNative`. Index mutations are serialized so concurrent bundle writes can't clobber tracked entries. Requires the store to implement `removeItem`.
- `setupGrabitGlobals({ env })` exposes host-supplied values to provider bundles as `globalThis.__grabitEnv`. Bundles are eval'd with `new Function` outside the Metro/Babel graph, so `process.env` is never inlined and stays empty at runtime on React Native — providers that need a key (e.g. `wyziesubs`) read it from `__grabitEnv` instead. Keys are merged onto any existing `__grabitEnv`, and the report now includes an `env` boolean.
- A Hermes downlevel pass in `bundle-provider`, applied to the finished bundle so inlined dependencies are lowered too. The plugin set is deliberately narrow — `hermesc` from RN 0.79 rejects only `class` and async arrow functions.
- Timestamped per-dispatch debug logging, which makes concurrent execution legible when `concurrentOperations > 1`.

### Changed

- Provider bundles download 6 at a time instead of serially. Each is a full HTTPS round-trip, so a 12-provider library paid `12 x latency` before the manager was usable, on every cold start. Also applies to `refreshModules` and `RequireService.initializeProviders`.
- GitHub provider fetching moved from the REST API to `raw.githubusercontent.com`. `/contents` allows 60 requests/hour/IP unauthenticated and a library costs one per provider per app start, so a few reloads exhausted the quota and returned an empty `403`. The REST API remains an automatic fallback.
- Empty provider results now count as failures. A provider whose selectors stopped matching returned `[]` without throwing, booked a success every call, and could never reach the auto-disable threshold.
- The Puppeteer pool is reference-counted, so one manager's `destroy()` no longer closes browsers another manager is still using.
- `useManager` reference-counts the manager singleton. With `useSources` mounted per screen, the manager was torn down whenever *any* consumer unmounted, only for the next screen to rebuild it.
- `GrabitManager.create()` joins a single in-flight promise. The instance was published before the `await` on module loading, so a concurrent call — trivial under StrictMode — got a manager with zero providers.
- `ctx.puppeteer.launch()` leases a tab from the pool; `browser.close()` releases the lease, and real processes close on age-out or manager teardown.
- `Cache.get()` touches on read, making eviction genuinely LRU rather than FIFO.
- Health metrics are written at most once per second instead of once per provider per scrape; each write also reset the entry's TTL, so it never expired.
- Optional Node-only dependencies load lazily in a Metro-safe way, and the `bundle-provider` root shim exposes a minimal runtime surface.
- `getProvidersByRequest` resolves `isNode()` once per call rather than once per module.

### Fixed

- `debug: false` not silencing errors. `DebugLogger.error` printed unconditionally, so a consumer that had explicitly opted out still got a console full of routine scraping failures — an unreachable provider host is normal and already handled, with the provider skipped and its metrics recorded. All levels now respect the flag; `alwaysWarn` remains the one that never is, for misconfigured providers and leaked browser leases. Failures stay observable through `getMetricsReport()`, thrown `ProcessError`s, and the `error` returned by the hooks.
- A proxy agent contaminating the process-wide fetch client. One global slot held a client bound to a specific proxy, and the cache guard treated "no agent" as a hit — so after any proxied scrape, every later unproxied request (TMDB, GitHub manifests) was silently routed through that third party. Clients are now keyed by proxy URL.
- `require("grabit-engine/react")` crashing with `ERR_REQUIRE_ESM` on Node < 22 — the `require` condition pointed into `dist/esm`. The hooks entry now builds to CJS, with its engine imports redirected to the main bundle so both share one singleton.
- Duration scoring silently disabled by operator precedence: `ParseDuration(d) ?? 0 / 60000` only ever divided the fallback zero, so the signal scored 0 for every input including exact matches.
- `useSources` dropping sources in continuous mode. Batches merged through a key built from the generated display label, so two mirrors of one file both labelled "Video" collapsed into one — 4 sources scraped, 3 shown. Distinct streams sharing a label are now all kept, while a re-scrape still replaces a provider's stale tokenized URLs. Also affected `scrapeProvider`.
- Operation timeouts abandoning in-flight work rather than cancelling it. `clearQueue()` drops only queued tasks, and the controller was then discarded, so `closeOperations()` could never reach the running ones.
- GitHub provider bundles failing on Hermes with `Cannot read property 'prototype' of undefined`. Runtime-fetched bundles never pass through Metro's Babel preset and meet raw Hermes directly; esbuild cannot lower `class` itself, so `bundle-provider` does it.
- `cache.enabled` and `cache.TTL` documented but never read — only `MODULE_TTL` was consulted, so callers silently got the hardcoded 15-minute default and could not disable module caching.
- `create()` discarding the result of `loadModules()`, leaving a manager with no providers and no fetch to recover; and a failed initialization leaving a half-built singleton that every later `create()` returned.
- `destroy()` stopping the shared cache's auto-cleanup timer, which disabled expiry sweeping process-wide after the first teardown.
- `isDevelopment()` returning `true` in shipped React Native builds, so every `debug`/`info`/`warn` printed in production. It now checks `__DEV__` first.
- Unbounded cache growth: `maxSize` counts entries, not bytes, and whole HTTP bodies were stored. Bodies over 256 KB are no longer cached.
- A temp directory leaked per provider per process start; it is now removed after import, and the file I/O is async.
- Six permanently-red Puppeteer pool tests. The optional import was hidden from Metro behind `new Function`, which hid it from Jest too, so `jest.mock` never intercepted it and the whole pool went untested behind a file that looked like coverage. It now routes through an injectable seam.
- A race in `scrapeProviders` where concurrent dispatches mutated the shared `requester`; each invocation gets its own copy. Language-based lookup also keys on the module's declared language, so localized TMDB metadata is correct per provider.
- Nondeterministic `successQuorum` timing, and a pool reuse crash ("Protocol error: Connection closed") when releasing the only open tab — dead entries are now evicted and acquisition retries.
- Results are always sorted target-language-first, regardless of `validateSources`.
- The query vector was rebuilt once per comparison in `calculateMatchScore`; `levenshteinDistance` now uses rolling rows instead of a full matrix.
- Provider bundles inlining `validator` and the heavyweight types barrel, and a missing `tldts` shim export.
- `create()` warning "instance already exists" on every remount and dereferencing a logger `destroy()` had cleared.

### Removed

- `.npmignore`, fully overridden by the `files` allowlist while appearing to exclude the `src/` tree the React Native entry depends on.

## [1.0.3] - 2026-03-19

### Fixed

- Fixed "Body has already been read" error when TMDB responses were cached. The cache serialization was consuming the response body in a background `.then()`, racing with the caller's `response.json()`. Cache writes are now synchronous and return a reconstructed response.
- Fixed GitHub-sourced provider modules silently failing to load. Fetch and resolver errors per provider are now caught individually and logged, so one broken provider no longer crashes the entire initialization.
- Fixed `bundle-provider` placing bundled files at wrong paths when the manifest key is a leaf scheme name (e.g. `"ip"`) but the source tree uses group folders (e.g. `providers/debug/ip/`). The manifest lookup now tries the leaf name when the full relative path doesn't match, so output lands at the correct `dist/{manifest.dir}/{scheme}/index.js` path.
- Fixed `bundle-provider` externalization strategy: previously ALL bare npm imports were externalized, which left `import cheerio`, `import parse-duration`, etc. in bundles that run in isolated temp directories with no `node_modules`. The plugin now only externalizes Node.js built-ins, inlines everything else, and explicitly detects context-provided packages (`cheerio`, `puppeteer`, `impit`, etc.) with actionable error messages telling providers to use `ProviderContext` instead.
- Fixed `bundle-provider` inlining the entire `grabit-engine` main entry, which transitively pulled in heavy runtime modules (`core/cheerio`, `core/xhr`, `core/puppeteer`, `controllers/manager`, `services/fetcher`) and left external `import cheerio`, `import impit` statements in the output. The bundler now replaces the main `grabit-engine` entry with a lightweight shim that only re-exports provider-safe modules (`controllers/provider`, `models/provider`, `services/crypto`, `utils/*`, etc.), cutting off the transitive dependency chain to heavy packages entirely.
- Fixed `types/models/Xhr.ts` using a value import (`import { ... }`) instead of `import type` for types from `services/fetcher.ts`. This caused esbuild to follow the import into the full fetcher module, pulling in `impit`, proxy agents, cache, and crypto transitively — even though only type information was needed. Changed to `import type` so it is erased at compile time.
- Fixed `bundle-provider` allowing unsafe `grabit-engine/*` subpath imports (e.g. `grabit-engine/core/cheerio`, `grabit-engine/services/fetcher`) to pass through unchecked. These bypassed the main entry shim and re-introduced heavy transitive deps. The plugin now validates subpath imports against the provider-safe module allowlist and blocks unsafe subpaths with a clear error.
- Fixed GitHub-loaded provider bundles for browser / React Native custom resolvers by switching `bundle-provider` output from ESM-only bundles to CommonJS-compatible runtime bundles. This keeps Node temp-file loading working while matching the documented `moduleResolver` pattern based on `new Function("module", "exports", sourceCode)`.
- Fixed `bundle-provider` root `Crypto` imports from `grabit-engine` by routing them through a virtual runtime shim. Provider bundles now resolve `Crypto` from Node's built-in `crypto`, `react-native-quick-crypto`, or a global polyfill such as `globalThis.__grabitCrypto` / `globalThis.crypto` instead of failing at bundle time or leaving a `grabit-engine` package import behind.
- Fixed the local `test-provider` script to load pre-bundled CommonJS provider files through a temp copy, preserving compatibility after the provider bundle format change in a `type: "module"` workspace.
- Fixed provider validation / initialization logging producing empty warning bullets and blank manifest scheme lists. Validation summaries now filter empty issue buckets, count actual messages, log real provider scheme keys from the `Map`, and report validation errors even when strict mode is off.
- Fixed provider worker error logging dumping raw wrapped errors and stacks into the main error line. Scrape failures now emit a concise summary first, with detailed stacks moved to debug logging.
- Fixed `ctx.cheerio.load` wrapping DNS / connectivity failures in an opaque generic message. Cheerio load errors now classify DNS lookup failures, connection failures, and timeouts, and include the target URL / host in the top-level `ProcessError` message.
- Fixed malformed GitHub provider module exports crashing initialization with `Cannot read properties of undefined (reading 'config')`. GitHub-loaded modules are now normalized through nested `default` exports when possible, malformed exports are treated as invalid modules, and validation reports them cleanly instead of aborting initialization.
- Fixed manager quorum accounting treating empty provider result arrays as successful results. `successQuorum` now counts only non-empty provider result sets, so scrape operations no longer resolve early with `sources: []` while other providers are still producing results.
- Fixed scheme validation rejecting provider names that start with a digit and grouped schemes with `/` despite those formats being used elsewhere in the codebase. Schemes such as `9filmyzilla` and `social/twitter` are now accepted.

### Added

- Added detailed diagnostic logging when GitHub provider source fetches fail, now showing the full API URL, `rootDir`, and `manifest.dir` to help pinpoint path mismatches.
- Added post-bundle import validation to `bundle-provider`: after each provider build, the script reports which runtime-injected packages were imported directly, with guidance on the correct `ctx.*` alternative.
- Added a clear `PROVIDER_MISSING_PACKAGE` error in `defaultNodeResolver` when a provider bundle fails to load due to a missing npm package, explaining that providers must use `ProviderContext` instead of direct imports.
- Added tests for `fetchResponse` / `appFetch` proving response bodies remain readable when caching is enabled.
- Added tests for GitHub source with `rootDir`, partial fetch failures, `moduleResolver` crashes, and all-providers-failing gracefully.
- Added optional React Native crypto-polyfill guidance and metadata: provider bundles now document `react-native-quick-crypto` support, and the package advertises it as an optional peer dependency.
- Added manager-side debug logs for the resolved scrape requester and the per-provider dispatch media payload, so debug output now shows the normalized media object after TMDB enrichment / language rotation.
- Added a regression test proving manager initialization accepts digit-prefixed schemes such as `9filmyzilla`.

## [1.0.2] - 2026-03-15

### Added

- Added a live npm version badge under the README title so the displayed package version tracks npm automatically.

## [1.0.1] - 2026-03-15

### Added

- Added repository, homepage, and issue tracker metadata so npm links back to GitHub correctly.
- Added React to the documented list of supported platforms.
- Added the project logo to the README.

### Changed

- Moved `fileName` into `SourceProvider`.
- Clarified `MediaSources` type documentation.
- Refined repository housekeeping with `.gitignore` updates.
- Simplified README copyright attribution.

## [1.0.0] - 2026-03-15

### Added

- Initial public release of `grabit-engine`.
- Plugin-based media scraping engine for streams and subtitles.
- Provider loading from GitHub repositories, local files, and in-memory registries.
- Built-in caching, health tracking, retries, auto-disable logic, auto-updates, concurrency controls, and targeted provider execution.
- Support for Node.js, browsers, React, and React Native.
- CLI utilities for creating, bundling, and testing providers.
- Jest coverage for manager behavior, provider sources, services, and utility helpers.
