# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog.

## [1.2.0] - 2026-03-19

### Fixed

- Fixed a race condition in `scrapeProviders` where the shared `requester` object (`media` and `targetLanguageISO`) was mutated inside the concurrent `fn` closure. Concurrent provider dispatches would stomp on each other's values mid-flight. Each invocation now receives its own `localRequester` shallow copy.
- Fixed language-based media lookup in `scrapeProviders` using `requester.targetLanguageISO` as the cache key instead of the module's declared language. When a provider's primary language differs from the requester's, TMDB is now called with that provider's language so localized titles and metadata are correct for that provider.
- Fixed nondeterministic `successQuorum` timing under scheduler load. Quorum-based operations now resolve immediately once enough providers return results and clear any queued work, instead of sometimes waiting for a slow provider that happened to start in the same concurrency window.

### Added

- Added `formatTimestamp(date?: Date): string` utility to `src/utils/standard.ts` returning a human-readable `HH:MM:SS:mmm` timestamp.
- Added per-dispatch timestamps to the provider debug log using `formatTimestamp()`, making concurrent execution visible when `concurrentOperations > 1`.
- Added manager-level Puppeteer browser pooling with `scrapeConfig.puppeteer.maxConcurrentBrowsers`, `scrapeConfig.puppeteer.minWarmBrowsers`, and `scrapeConfig.puppeteer.idleBrowserTTL` so Node.js scraping can reuse warm browser processes instead of spawning one browser per request.
- Added `scrapeConfig.puppeteer.maxBrowserSessionTTL` (default 10 minutes) to auto-release leaked browser tabs. A warning is always logged regardless of debug mode when a provider forgets to call `browser.close()`.
- Added `scrapeConfig.waitForActiveProvidersAfterQuorum` to make `successQuorum` behavior configurable. When enabled, the manager still cancels queued providers immediately on quorum, but waits for providers that were already running to finish before resolving.

### Changed

- Changed `ctx.puppeteer.launch()` to lease tabs from the manager-owned browser pool. Calling the returned `browser.close()` releases the leased tab; real browser processes are closed when they age out of the pool or when the manager is destroyed.
- Removed `browsingOptions.closeOnComplete` option — the page now always stays open after `puppeteer.launch()` resolves. Providers must call `browser.close()` when done to release the tab back to the pool.
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
