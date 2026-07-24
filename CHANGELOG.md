# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog.

## [Unreleased]

> Work targeting the **1.2.0** stable release. Not yet published — the latest version on npm is `1.2.0-alpha.4`.

### Added

- Added a Hermes downlevel pass to `bundle-provider`. Each finished bundle is run through a narrow Babel transform (`class-properties`, `private-methods`, `private-property-in-object`, `classes`, `async-to-generator`) so inlined dependencies are lowered too, not just provider source. The plugin set is deliberately minimal — verified against `hermesc` from React Native 0.79, which accepts generators, optional chaining, nullish coalescing, logical assignment, object spread, `for…of` and template literals, and rejects only `class` and async arrow functions.
- Added provider metadata and hook ergonomics introduced across the 1.2.0 alpha cycle, including guaranteed `meta.scheme`, `scrapeProvider(requester, providerScheme)`, and `getAvailableProviders(type, requester)`.
- Added richer manager observability and control features, including timestamped dispatch logging, targeted provider execution, and configurable quorum behavior for active provider operations.

### Changed

- Changed provider bundle downloading to run concurrently (6 at a time) instead of one at a time. Every provider is a full HTTPS round-trip, so a 12-provider library previously cost `12 × latency` of pure serialized waiting before the manager became usable — on every cold start. The same change applies to `ModuleManager.refreshModules` and `RequireService.initializeProviders`; refresh results are still applied serially so the shared module list is never mutated concurrently.
- Changed empty provider results to count as failures in health metrics. `recordMetrics(…, true)` previously ran before the emptiness check, so a provider whose site redesigned — selectors matching nothing, returning `[]` without throwing — booked a success on every call and could never reach the auto-disable threshold. Auto-disable now covers the common scraper failure mode, not just providers that throw.
- Changed the Puppeteer pool to be reference-counted via `retainPuppeteerPool()` / `releasePuppeteerPool()`. The pool is process-global but `destroy()` closed every browser in it, so one manager's teardown killed another's in-flight work — the same class of bug that `CACHE.stopAutoCleanup()` was already removed from teardown for. Only the first holder's pool sizing is applied, and browsers are closed only once the last holder releases.
- **Breaking:** Changed the default `scrapeConfig.puppeteer.maxBrowserSessionTTL` from `600_000` (10 minutes) to `120_000` (2 minutes). With `maxConcurrentBrowsers` defaulting to `2`, a provider that forgets `browser.close()` held half the pool for ten minutes — far beyond the 15 second default `operationTimeout`.
- **Breaking:** Changed `services/crypto` to be reachable only from the Node entry point. It imports the Node built-in `crypto`, which Webpack 5, Vite and Metro do not polyfill, so plain browser consumers resolving `dist/esm/src/index.js` hit `Module "crypto" has been externalized` or an outright resolution failure. `require("grabit-engine")` and Node ESM imports are unaffected; browser and React Native consumers supply crypto through `setupGrabitGlobals` as before.
- **Breaking:** Removed `base-64` from `dependencies`. Nothing in the library imports it any more — the atob/btoa polyfill is installed from whatever codec the caller passes to `setupGrabitGlobals({ base64 })`, and that option is structurally typed (`{ encode, decode }`), so any implementation works. It is not a peer dependency either: a peer would warn on every install for the Node, browser and React Native ≥ 0.74 consumers that have native `atob`/`btoa` and never need it. React Native < 0.74 users install `base-64` themselves and pass it in. `@types/base-64` was dropped from devDependencies for the same reason.
- Changed `Cache.get()` to move the touched key to the end of the insertion order, making eviction genuinely least-recently-used. The constructor documented "LRU-style eviction" but never re-inserted on read, so eviction was strictly FIFO and a hot early entry was dropped before a cold late one.
- Changed provider health metrics to be written at most once per second instead of once per provider per scrape. Every write also reset the cache entry's TTL, so the metrics entry effectively never expired. `destroy()` flushes any pending write.
- Changed GitHub provider fetching from the REST API to `raw.githubusercontent.com`. The `/contents` endpoint permits only 60 requests per hour per IP when unauthenticated, and a provider library costs one request per provider plus one for the manifest on every app start — a few reloads exhaust the quota and GitHub replies `403` with an empty body, which surfaces as providers that mysteriously fail while others succeed. The raw host serves identical bytes from a CDN and is not metered by that quota. The REST API remains as an automatic fallback.
- Changed `useManager` to reference-count the manager singleton. `useSources` is typically mounted per screen, and the manager was previously destroyed whenever *any* consumer unmounted — tearing down the auto-update service, operation limiters and provider context on every navigation, only for the next screen to rebuild them. Teardown now happens once the last consumer unmounts, and a release that overlaps the next mount correctly aborts.
- Changed `GrabitManager.create()` so concurrent callers join a single in-flight promise. The instance was published synchronously before the `await` on module loading, so a second concurrent call — trivially reached via React StrictMode's double-mount or two screens mounting at once — received a manager with zero providers.
- Changed manager and scraping internals for safer concurrent execution, including per-dispatch requester isolation, improved language-aware TMDB enrichment flow, and pooled Puppeteer browser leasing lifecycle.
- Changed provider loading and bundling architecture to keep provider bundles leaner and more environment-safe, while preserving Node.js, browser, and React Native compatibility paths.
- Changed scheme-targeted scraping APIs (`getStreamsByScheme`, `getSubtitlesByScheme`) to accept `RawScrapeRequester` and perform enrichment internally.
- Changed `getProvidersByRequest` to resolve `isNode()` once per call instead of once per loaded module inside the filter predicate.

### Fixed

- Fixed a proxy agent contaminating the process-wide fetch client. There was one `_resolvedFetch` slot but it was written with an Impit client bound to a specific proxy, and the early-return guard treated "no agent" as a cache hit — so once any provider scraped through a proxy, every later unproxied request in the process (TMDB metadata, GitHub manifests) was silently routed through that third party. Two providers with different proxies had the same problem in reverse. Clients are now keyed by proxy URL, with the bare/no-proxy client kept separate; this also stops a new native Impit instance being constructed on every proxied request.
- Fixed `exports["./react"].require` pointing at an ESM file. `dist/esm/` carries a `{"type":"module"}` marker, so `require("grabit-engine/react")` crashed with `ERR_REQUIRE_ESM` on Node < 22 — on a documented public subpath. The build now emits a real CJS artifact for the hooks entry, whose engine imports are redirected to the main CJS bundle rather than inlined, so both entry points share one `GrabitManager` singleton.
- Fixed an operator-precedence bug that disabled duration scoring entirely. `ParseDuration(criteria.duration) ?? 0 / 60000` parses as `ParseDuration(…) ?? (0 / 60000)`, so the millisecond-to-minute conversion only ever divided the fallback zero. A 136-minute film matched against `"136m"` compared `136` to `8_160_000` and scored 0 of the available 20 points — for every input, including exact matches. `calculateMatchScore` can now actually reach its documented `[0..170]` range and search-result ranking regains a whole discriminator.
- Fixed the operation timeout abandoning in-flight provider work instead of cancelling it. `limit.clearQueue()` only discards tasks that have not started; providers already holding a concurrency slot kept fetching, parsing and holding pooled browsers — and because the controller was then dropped from `operationControllers`, a later `closeOperations()` had no handle on them and they became permanently uncancellable. The timeout now aborts before resolving.
- Fixed `defaultNodeResolver` leaking one temp directory per provider, per process start, indefinitely. The directory is now removed once the import resolves, and `mkdtempSync`/`writeFileSync` were replaced with their async counterparts so provider loading no longer blocks the event loop.
- Fixed the `require("base-64")` atob/btoa polyfill in `services/crypto`. `require` is undefined in ESM, so it threw on every load in the ESM build, was swallowed by its own `try`/`catch`, and warned that `base-64` was missing even when it was installed. `setupGrabitGlobals` now accepts a `base64` option and installs the polyfill correctly.
- Fixed six permanently-failing Puppeteer pool tests. The source hides its optional import behind `new Function("return import(id)")` to keep it out of Metro's bundle graph, which also hides it from Jest's module registry — so `jest.mock` never intercepted it and every test failed with `PuppeteerNotAvailable`, leaving leases, warm browsers, eviction and the retry-on-stale loop untested behind a test file that looked like it covered them. The import now goes through a single injectable `__moduleLoader` seam that tests override directly, and Metro still sees only the opaque `new Function`.
- Fixed unbounded memory growth in the response cache. `maxSize` bounds entry count, not bytes, and `appFetch` stores whole serialized bodies — scraped HTML pages routinely run 100 KB–1 MB, so 10,000 entries is a multi-gigabyte working set and an OOM on a mobile device long before eviction triggers. Bodies over 256 KB are no longer cached.
- Fixed the query vector being rebuilt once per comparison in `calculateMatchScore`. `cosineSimilarity` tokenizes both arguments, so the search title was re-tokenized once per localized title, per result — roughly 360 needless vector builds for a 40-result page with 8 localized titles. `levenshteinDistance` also now uses two rolling rows instead of a full `(n+1) × (m+1)` matrix.
- Removed `.npmignore`. `package.json`'s `files` allowlist takes precedence wholesale, so the file did nothing while *appearing* to exclude the `src/` tree that the `react-native` entry point depends on — a trap for the next person to touch packaging.
- Fixed GitHub provider bundles failing to evaluate on React Native with `Cannot read property 'prototype' of undefined`. React Native's Hermes cannot compile `class` syntax at all; application code is unaffected because Metro runs it through `@react-native/babel-preset` (which carries `@babel/plugin-transform-classes` for exactly this reason), but bundles fetched at runtime and evaluated with `new Function` never pass through Babel and meet raw Hermes directly. esbuild cannot lower this itself — it exposes a `hermes0.12` target but reports "Transforming class syntax to the configured target environment is not supported yet" — so the lowering now happens in `bundle-provider`.
- Fixed `cache.enabled` and `cache.TTL` being documented on `ProviderManagerConfig` but never read. Only `MODULE_TTL` was consulted, so a caller passing `{ enabled: true, TTL: 300_000 }` silently received the hardcoded 15 minute default and could not disable module caching at all. Both options are now honored, with `MODULE_TTL` retained as the module-specific override.
- Fixed `GrabitManager.create()` discarding the result of `loadModules()`. `isSourceCached()` only proves an entry existed a moment earlier; the subsequent read can still miss when the entry expired in between or caching is disabled. The miss was ignored, leaving a manager with no providers and no fetch to recover.
- Fixed a failed initialization leaving a half-built singleton behind, which every later `create()` call would return instead of retrying.
- Fixed `destroy()` stopping the shared module-level cache's auto-cleanup timer. Cache entries deliberately outlive any single manager so the next `create()` can skip refetching, but after the first teardown expiry sweeping was disabled for the remainder of the process, leaving expired entries to be evicted only lazily by a later `get()` or `has()`.
- Fixed `isDevelopment()` returning `true` inside shipped React Native builds. React Native polyfills `process` but never sets `process.env.ENV`, so the previous `process.env.ENV !== "production"` check made every `debug`, `info` and `warn` call print in production. The check now consults React Native's `__DEV__` global first — the only reliable signal there, and correctly `false` in release builds — and falls back to `NODE_ENV`/`ENV`, leaving Node.js behavior unchanged.
- Fixed `create()` logging "instance already exists" as a warning on every remount, and dereferencing a logger that `destroy()` had already cleared.
- Fixed multiple provider-bundling regressions (heavy transitive imports, unsafe subpaths, missing shim exports, and ESM/CJS runtime compatibility), producing smaller and more reliable provider artifacts.
- Fixed manager runtime stability issues including quorum accounting edge cases, pooled browser reuse/disconnect failures, and source-language result sorting consistency.
- Fixed platform compatibility pain points across Node.js and React Native by hardening optional dependency behavior and improving runtime diagnostics for missing provider packages and malformed modules.

## [1.2.0-alpha.4] - 2026-07-22

<!-- Published to npm on 2026-07-22. Entries were never recorded — fill in before tagging 1.2.0. -->

## [1.2.0-alpha.3] - 2026-07-21

<!-- Published to npm on 2026-07-21. Entries were never recorded — fill in before tagging 1.2.0. -->

## [1.2.0-alpha.2] - 2026-06-05

### Added

- Added `scheme` field to `ProviderModuleManifest` type. The scheme identifier (previously only stored as the map key in the `providers` record) is now also populated directly on each manifest object. All three source services — `GithubService`, `RegistryService`, and `RequireService` — inject the canonical scheme from the registry map key when modules are loaded, ensuring `meta.scheme` is always available on every loaded `ProviderModule`.
- Added `scrapeProvider(requester, providerScheme)` callback to the `useScraper` hook. Scrapes a single provider by scheme by calling `getStreamsByScheme` and `getSubtitlesByScheme` in parallel, merging results into existing state without clearing it. Respects the `type` option and is cancellable by a subsequent `scrape()` or `stopContinuousScraping()` call.
- Added `getAvailableProviders(type, requester)` callback to the `useSources` hook. Returns the `ProviderModuleManifest[]` of all active providers that match the given type and requester — useful for building a provider-picker UI. Returns an empty array when the manager is not yet ready.
- Both new hook callbacks (`scrapeProvider`, `getAvailableProviders`) are included in the `UseSourcesReturn` type.
- Added a dedicated React Native package entry and RN-safe type barrel so mobile consumers resolve a native-safe surface by default.
- Added `formatTimestamp(date?: Date): string` utility to `src/utils/internal.ts` returning a human-readable `HH:MM:SS:mmm` timestamp.
- Added per-dispatch timestamps to the provider debug log using `formatTimestamp()`, making concurrent execution visible when `concurrentOperations > 1`.
- Added manager-level Puppeteer browser pooling with `scrapeConfig.puppeteer.maxConcurrentBrowsers`, `scrapeConfig.puppeteer.minWarmBrowsers`, and `scrapeConfig.puppeteer.idleBrowserTTL` so Node.js scraping can reuse warm browser processes instead of spawning one browser per request.
- Added `scrapeConfig.puppeteer.maxBrowserSessionTTL` (default 10 minutes) to auto-release leaked browser tabs. A warning is always logged regardless of debug mode when a provider forgets to call `browser.close()`.
- Added `scrapeConfig.waitForActiveProvidersAfterQuorum` to make `successQuorum` behavior configurable. When enabled, the manager still cancels queued providers immediately on quorum, but waits for providers that were already running to finish before resolving.

### Changed

- `getStreamsByScheme` and `getSubtitlesByScheme` now accept `RawScrapeRequester` instead of `ScrapeRequester`, performing TMDB enrichment internally — consistent with `getStreams` / `getSubtitles`. This is a **breaking change** for any direct callers passing a pre-resolved `ScrapeRequester`.
- Changed optional Node-only dependency resolution (`puppeteer-real-browser`, Node crypto paths) to Metro-safe lazy loading patterns so React Native/Expo bundling does not traverse unsupported runtime modules.
- Changed manager class name from `ScrapePluginManager` to `GrabitManager`.
- Changed `ctx.puppeteer.launch()` to lease tabs from the manager-owned browser pool. Calling the returned `browser.close()` releases the leased tab; real browser processes are closed when they age out of the pool or when the manager is destroyed.
- Made `puppeteer-real-browser` truly optional for consumers by removing it from `optionalDependencies`. It remains an optional peer dependency, so it will not be installed unless the app explicitly installs it.
- Tightened the `bundle-provider` root shim surface so `import { ... } from "grabit-engine"` in provider source exposes a minimal runtime API, while keeping safe subpath imports available.
- Moved `sanitizeMessage`, `retriesCount`, and `formatTimestamp` from `utils/standard` (public API) to `utils/internal` (internal only). These functions are no longer exported from the package entry point.

### Removed

- Removed `browsingOptions.closeOnComplete` option — the page now always stays open after `puppeteer.launch()` resolves. Providers must call `browser.close()` when done to release the tab back to the pool.

### Fixed

- Fixed Expo/Metro serializer crashes (`The "to" argument must be of type string. Received undefined`) caused by statically discoverable optional Node-only imports during bundle graph construction.
- Fixed React Native integration requiring app-side shims for Node-only optional dependencies. `grabit-engine` now supports React Native without requiring client-side Metro shims.
- Fixed `bundle-provider` generating unnecessarily large provider bundles by eliminating accidental imports of the heavyweight `src/types/index.ts` barrel from provider-safe runtime modules.
- Fixed provider bundles inlining the `validator` npm package via `validateManifestConfiguration` by moving that check into a new lightweight module.
- Fixed `bundle-provider` shim missing the `tldts` named export, which caused providers importing `{ tldts }` from `grabit-engine` to fail bundling.
- Fixed a race condition in `scrapeProviders` where the shared `requester` object (`media` and `targetLanguageISO`) was mutated inside the concurrent `fn` closure. Concurrent provider dispatches would stomp on each other's values mid-flight. Each invocation now receives its own `localRequester` shallow copy.
- Fixed language-based media lookup in `scrapeProviders` using `requester.targetLanguageISO` as the cache key instead of the module's declared language. When a provider's primary language differs from the requester's, TMDB is now called with that provider's language so localized titles and metadata are correct for that provider.
- Fixed nondeterministic `successQuorum` timing under scheduler load. Quorum-based operations now resolve immediately once enough providers return results and clear any queued work, instead of sometimes waiting for a slow provider that happened to start in the same concurrency window.
- Fixed browser pool reuse crash ("Protocol error: Connection closed") when a provider releases the only open tab, causing Chrome to disconnect. The pool now listens for the browser `disconnected` event and proactively evicts dead entries. The reuse path in `acquireBrowserSession` also retries instead of propagating the error, so the next loop iteration spawns a fresh browser.
- Fixed source language sorting: results are now always sorted with the requester's target language first, regardless of whether `validateSources` is enabled.

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
