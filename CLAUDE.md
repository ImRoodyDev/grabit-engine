# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`grabit-engine` is a plugin-based engine for scraping media streams and subtitles. Consumers create a `GrabitManager`, point it at a **source** of provider plugins (GitHub / local files / in-code registry), and call `getStreams` / `getSubtitles`. It runs in Node.js, browsers, React, and React Native — the tricky part of the codebase is that a single source tree ships three different entry points for these environments.

## Commands

```bash
npm run build          # tsc (ESM) -> esbuild (CJS) -> postbuild markers. Full dist build.
npm run watch          # tsc -w (ESM only, for incremental type-checking during dev)
npm test               # jest (all tests)
npx jest tests/models/manager/ --verbose   # one directory
npx jest tests/utils/similarity.test.ts    # one file
npx jest --coverage
npm run build:local    # build + npm pack (produce a local tarball to install elsewhere)
```

There is **no lint step** and no separate typecheck script — `npm run build` is the typecheck (tsc with `strict: true`). Run it before considering a change done.

### Provider-author CLIs (dev tools, not part of the runtime bundle)

```bash
npm run create-provider -- my-provider --lang en,fr   # scaffold providers/<scheme>/
npm run bundle                                          # bundle all providers to standalone index.js
npm run bundle -- <scheme>                              # bundle one (e.g. english/vidsrc)
npm run bundle:clean                                    # remove generated bundles
npm run test-provider -- --scheme my-provider --type movie --tmdb 27205
```

These map to `scripts/create-provider.js`, `scripts/bundle-provider.js`, `scripts/test-provider.js` and are exposed as the `create-provider` / `bundle-provider` / `test-provider` bin entries. See [TESTING.md](TESTING.md) and [BUNDLING.md](BUNDLING.md) for the full flag reference.

## Build system & multi-environment entry points

This is the highest-leverage thing to understand before editing exports or imports.

- **Three entry points**, all re-exporting the same controllers/models but differing in what they pull in:
  - `src/index.ts` — default/browser barrel. **Deliberately does NOT re-export `services/crypto.ts`** (it imports Node's built-in `crypto`, which browser bundlers don't polyfill).
  - `src/index.node.ts` — Node/CJS barrel. Adds `services/crypto.ts`; **omits the React hook runtime** (`useSources`, `useManager`, `acquireManager`) so importing the package never forces `require("react")`.
  - `src/index.native.ts` — React Native barrel. Uses the RN-safe types barrel `types/index.native.ts`.
- The React hooks are a **separate subpath export** (`grabit-engine/react` → `src/hooks/useSources.ts`), and are also re-exported from the browser/native barrels (never the node barrel). See `package.json` `exports`.
- **Manager lifecycle primitives are public** (`src/hooks/useManager.ts`): `useManager` (the singleton-lifecycle hook `useSources` builds on), plus `acquireManager` / `releaseManager` — a reference-counted pair over the `GrabitManager` singleton. `acquireManager(config)` is exported so apps can **pre-warm** the manager at startup (join the same in-flight `create()` the hooks reuse); each `acquireManager` must be balanced by a `releaseManager`, or the singleton lives for the process lifetime (the intended behavior for an app-start pre-warm).
- **Source imports use explicit `.ts` extensions** (e.g. `import ... from "../utils/standard.ts"`). This is intentional: `tsconfig.json` sets `rewriteRelativeImportExtensions: true` so the ESM output rewrites them to `.js`, letting dist files load in Node ESM with no bundler. Keep the `.ts` extension on relative imports.
- **`build-cjs.js` nuance**: ESM-only deps (`parse-duration`, `p-limit`, `yocto-queue`, `node-fetch`) are **inlined** into the CJS bundle; everything else stays external. The CJS hook bundle re-points its imports of the engine back to the main CJS bundle (external) rather than inlining — otherwise `grabit-engine` and `grabit-engine/react` would each get their own `GrabitManager` singleton and browser pool.
- `postbuild.js` drops `{"type":"module"}` / `{"type":"commonjs"}` markers into `dist/esm` and `dist/cjs`.

## Runtime architecture

**Manager layering** (`src/controllers/`):
- `module.ts` — abstract `ModuleManager`: loading providers from a source, module/metrics caching, remote auto-update, and **health tracking with auto-disable** (a provider whose error rate exceeds `errorThresholdRate` after `minOperationsForEvaluation` ops gets `meta.active = false`). Note: a provider that returns an **empty array is scored as a failure**, not a success — a silent selector break should trip auto-disable.
- `manager.ts` — `GrabitManager extends ModuleManager`: the public API and the scrape execution engine. It is a **process singleton** created via `GrabitManager.create()` (concurrent `create()` calls join one in-flight promise — matters under React StrictMode double-mount). `createOperation()` is the concurrency/quorum/timeout core (uses `p-limit`, per-operation `AbortController`, `successQuorum` early-exit). `scrapeProviders()` is the shared pipeline every public method delegates to: it resolves the requester, enriches media via TMDB, filters+sorts providers by language, and fans out.
- `provider.ts` — `defineProviderModule()` wraps a provider's `getStreams`/`getLazyStreams`/`getSubtitles` to inject metadata (fileName, providerName, scheme, User-Agent header) via the shared `augmentMediaSource` helper, sort by target language, optionally validate source URLs, and normalize error logging. Provider modules pass through here whether loaded from GitHub, local, or registry. It also wires `resolveLazy` for **lazy sources**: `MediaSource = ResolvedMediaSource | LazyMediaSource`, where a lazy handle returns `{ lazy: { id } }` with no `playlist` and is resolved on play via `manager.resolveLazySource(scheme, id, requester)`. A provider lists lazy handles from `getLazyStreams` (validation skips them); the manager calls `getLazyStreams` (falling back to `getStreams`) when created with `lazy: true` or via `manager.getLazyStreams()`. Discriminate with `source.lazy`. Playback hints are `xhr.flags: SourceFlag[]` (replaced the old `haveCorsPolicy` boolean).

**Sources** (`src/services/`): `github.ts`, `registry.ts`, `require.ts` (local) each implement `initializeProviders(source)` returning `{ meta, providers, validations }`. Only GitHub is `isRemote` and supports auto-update/refresh.

**Native cold-start performance** (all opt-in, all default to today's behavior):
- **`source.filter: ProviderFilter`** (`{ schemes?, languages? }`) drops manifest entries *before* any fetch/eval via `filterManifestProviders` (`utils/standard.ts`). Applied by all three services; languages match on the primary subtag.
- **`source.concurrency`** overrides the shared `PROVIDER_FETCH_CONCURRENCY` (6) on GitHub/local loads and on `refreshModules` — lower it to cap memory on low-end devices.
- **GitHub `source.persistentStore: PersistentStore`** (AsyncStorage/MMKV shape) persists fetched bundle *source* (not the resolved module — it holds closures) keyed by `scheme@version`, plus the manifest + its ETag. `services/providerStore.ts` owns the keys and is fully try/catch-guarded (a broken store degrades to a network fetch). Warm start: conditional `If-None-Match` manifest fetch (304 → reuse), per-provider source reused on version match, and the persisted manifest is the offline fallback when the network is unreachable. This is separate from the in-memory `CACHE`, which never survives a process/app restart.
- **GitHub `source.yieldOnEval`** (default `!isNode()`) awaits `scheduleYield()` before each synchronous bundle compile so the JS/UI thread paints between providers.
- **`config.autoUpdateOnNative`** (default `false`) — the background auto-update interval is skipped off-Node unless set, since periodic re-fetch + re-eval janks the UI.

**Provider context** (`ProviderContext`, passed to every worker as `ctx`): `xhr` (`core/xhr.ts` over `services/fetcher.ts`), `cheerio` (`core/cheerio.ts`), `puppeteer` (`core/puppeteer.ts`), `log`.

- **xhr / fetcher**: per-host concurrency (`maxHostConcurrency`, default 10), 429 rate-limit back-off (`honorRateLimit`), and request coalescing (`coalesce`) are resolved from the provider `config.xhr` and default on. They are NOT per-fetch options (`ProviderFetchOptions` omits them). Provider-settable fetch options include `cookieJar`, `cacheTTL`, and `redirect`.
- **Proxy** is host-owned, never a provider option. A single `requester.proxy` (falling back to `config.proxy`) is either a proxy agent `{ agent, auth? }` or a URL resolver `{ resolver, headers? }`. It is applied in `appFetch`: an agent sets the dispatcher plus `Proxy-Authorization`, a resolver rewrites only the dispatched URL (so cache key / cookie jar / rate-limit stay bound to the logical target host) and the wire request carries only the resolver's own headers.
- **Puppeteer pool** lives in `controllers/puppeteerPool.ts`; only the navigation flow stays in `core/puppeteer.ts` (both `puppeteerLoad` and the solver lease from the same pool). It is **process-global and reference-counted**: `retainPuppeteerPool()`/`releasePuppeteerPool()` gate config and shutdown, so only the first manager sizes it and only the last one destroyed closes browsers. Providers lease a *tab*, and `browser.close()` is intercepted to release the tab back to the pool rather than kill the process; forgotten leases auto-release after `maxBrowserSessionTTL`. Only agent proxies map to a browser proxy (resolver proxies are HTTP only).

**Provider model** (`src/models/provider.ts`): `Provider.create(config)` builds resource URLs from `config.entries` endpoint templates and query-key mappings; handles multi-language configs and localized-title selection.

**Cache** (`src/services/cache.ts`): one module-level LRU `CACHE` singleton shared across all manager lifecycles — entries deliberately outlive a manager so the next `create()` can skip refetching. Do not stop its sweeper on `destroy()`.

## TMDB enrichment

Requests only require minimal media (e.g. `{ type: "movie", tmdbId }`). `services/tmdb.ts` (`TMDB.createRequesterMedia`) fills missing fields (title, year, duration, imdbId, localized titles). Caller-provided fields are never overwritten. `tmdbApiKeys` is an array; a random key is chosen per request to spread load. `channel` media type bypasses TMDB entirely.

## Conventions

- **Errors**: throw the custom `ProcessError` / `HttpError` classes (`src/types/`), with a stable `code` string. Use the `isProcessError` / `isCustomError` type guards. `strict: true` config makes provider validation errors throw instead of skip.
- **Logging**: `DebugLogger` (`src/utils/logger.ts`), gated on `config.debug` (defaults to `isDevelopment()`). A few warnings (e.g. leaked Puppeteer tab) print regardless of debug mode.
- **Language codes**: normalized to the primary subtag lowercased (`en-US` → `en`) at the requester boundary. Provider `language` can be a string or string[]; matching the requester's `targetLanguageISO` raises sort priority.
- Tests are Jest + Babel (`babel.config.js` uses `@babel/preset-env` + `preset-typescript`), located under `tests/` mirroring `src/`. `dist/` is ignored by Jest.
