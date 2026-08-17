# Engine improvements — HTTP hardening, flags, solver, lazy

Changelog for the recent round of changes to **grabit-engine** (plus the matching
migration in **grabit-library**). Grouped by feature; each lists the files touched and why.
All new HTTP behavior is **opt-in**, so existing providers are unaffected.

> Build/coupling: the engine was built locally (`1.2.0-alpha.10`) and its `dist` copied into
> `grabit-library/node_modules/grabit-engine/dist` so the library compiles/runs now. For
> production, `npm publish` the engine and bump the library's dependency.

---

## 1. Source flags (replaces `haveCorsPolicy`)

**Why:** `xhr.haveCorsPolicy: boolean` was too coarse. Replaced with an extensible flag list
so a provider can state exactly how a source must be consumed.

- `src/types/output/MediaSources.ts`
  - New `SourceFlag` type: `CORS_BLOCKED | IP_LOCKED | GEO_BLOCKED | REFERER_LOCKED | PROXY_ONLY | EXTERNAL`.
  - `SourceProvider.xhr.haveCorsPolicy: boolean` → `xhr.flags: SourceFlag[]`.
  - Added `LazySource` type + optional `lazy?: LazySource` on `InternalMediaSource` (see §6).
- **grabit-library** — migrated **all 18** provider/extractor files:
  `haveCorsPolicy: true → flags: ['CORS_BLOCKED']`, `false → flags: []`, dynamic → ternary.

**Provider usage:** `xhr: { flags: ['CORS_BLOCKED','REFERER_LOCKED'], headers }`.

---

## 2. Cookie jar

**Why:** multi-hop scrapes had to capture `Set-Cookie` and forward it by hand.

- `src/services/httpControls.ts` (new) — `CookieJar` class (in-memory, keyed by host):
  `setFromResponse`, `set`, `header`.
- `src/services/fetcher.ts` — `appFetch` attaches `cookieJar.header(host)` on the request and
  captures `Set-Cookie` on the response, when a `cookieJar` is passed.
- Exported `CookieJar` from `src/index.ts` and `src/index.node.ts`.

**Provider usage:** `const jar = new CookieJar(); ctx.xhr.fetch(url, { cookieJar: jar }, requester)`
— cookies carry across hops automatically.

---

## 3. Proxy (host config, not an `xhr` option)

**Why:** proxy is a host concern — it comes from the app, never from providers. A single `proxy`
field takes one of two shapes: a **proxy agent** (`{ agent, auth? }`) or a **URL resolver**
(`{ resolver, headers? }`) that rewrites each request to a proxy endpoint.

- `src/types/input/Proxy.ts` — `ProxyConfig = ProxyAgentConfig | ProxyResolverConfig`, plus the
  `isResolverProxy` / `proxyAgentOf` guards.
- `src/types/models/Manager.ts` — `ProviderManagerConfig.proxy?: ProxyConfig` — a default proxy
  used when a scrape request omits its own.
- `src/types/input/Requester.ts` — `ScrapeRequester.proxy?: ProxyConfig` (replaces the old
  `proxyAgent` / `proxyAuth` pair).
- `src/controllers/manager.ts` — every requester falls back to `config.proxy` when the request
  doesn't supply one.
- `src/core/xhr.ts` — `providerFetch` / `providerFetchResponse` just forward `proxy: requester.proxy`
  as an `appFetch` option (no `agent` / `Proxy-Authorization` handled here). Providers can't opt out;
  it is **not** a provider-facing `ctx.xhr` option.
- `src/services/fetcher.ts` — `appFetch` takes a `proxy?: ProxyConfig` option and applies it all in
  one place: an agent sets the dispatcher (+ `Proxy-Authorization`); a resolver rewrites **only the
  dispatched URL** and attaches its `headers`, so the cache key, cookie jar and rate-limit window
  stay bound to the logical target host (never the proxy endpoint).
- `src/core/puppeteer.ts` — only agent proxies map to a browser proxy (resolver proxies are
  HTTP-only).

---

## 4. Per-host concurrency + rate-limit

**Why:** avoid flooding a host into a ban and respect `429 Retry-After`.

- `src/services/httpControls.ts` — `hostLimiter(host, n)` (per-host `p-limit`),
  `rateLimitedFor`, `noteRateLimit`, `parseRetryAfter` (CACHE-backed 429 state).
- `src/services/fetcher.ts` — `appFetch` gains:
  - `maxHostConcurrency` — caps concurrent requests to the URL's host.
  - `honorRateLimit` — waits out a short 429 window, else throws `HttpError 429`; records the
    back-off from `Retry-After` when a 429 is seen.

---

## 5. Request coalescing

**Why:** dedupe identical concurrent GETs on top of the existing response cache.

- `src/services/fetcher.ts` — `_inflight` map + `coalesce` request option: identical cacheable
  GETs share one fetch (serialized + reconstructed so bodies aren't consumed twice).

---

## 6. Lazy sources (resolve on play)

**Why:** return results fast and defer the expensive final-URL resolution to play time.

- `src/types/output/MediaSources.ts` — `LazySource` + `lazy?` on `InternalMediaSource`.
- `src/types/models/Modules.ts` — optional `resolveLazy(id, ctx, requester)` on both worker
  interfaces.
- `src/controllers/provider.ts` — `createModuleWorkers` wraps `resolveLazy`, shaping the
  resolved source like `getStreams` (User-Agent header, providerName/scheme/format/fileName).
- `src/controllers/manager.ts` — new public `resolveLazySource(scheme, id, rawRequester)`:
  looks up the module, builds the TMDB-enriched requester, calls the provider's `resolveLazy`.

**Provider usage:** return `{ ..., lazy: { id } }` from `getStreams` + export
`resolveLazy(id, ctx, requester)`. Host calls `manager.resolveLazySource(scheme, id, requester)` on play.

---

## 7. Pluggable challenge solver

**Why:** puppeteer can't run on React Native; CF-solving must be portable.

- `src/types/models/Solver.ts` (new) — `ChallengeSolver`, `ChallengeSolveOptions`,
  `ChallengeSolveResult { html, cookies, cookieMap, userAgent }`.
- `src/core/solver.ts` (new) — `solveChallenge(url, requester, opts)` (uses a host solver if
  set, else the Node puppeteer pool; can wait for a named cookie) + `setChallengeSolver(solver)`.
- `src/types/models/Context.ts` — added `solveChallenge` to `ProviderContext`.
- `src/controllers/manager.ts` — `createContext()` now includes `solveChallenge`.
- Exported `setChallengeSolver` from both entry points.

**Provider usage:** `const { cookies, userAgent } = await ctx.solveChallenge(url, requester, { waitForCookie: 'cf_clearance' })`
→ feed `cookies` into a `CookieJar`.
**Host usage:** `setChallengeSolver(mySolver)` — a hidden RN WebView (recommended on-device) or
a server FlareSolverr adapter.

---

## 8. `fetcher.ts` split

**Why:** `fetcher.ts` had grown large.

- `src/utils/fetch.ts` (new) — stateless helpers moved out: `createRequestCacheKey`,
  `createStableHash`, `serializeResponse`, `reconstructResponse`, `extractProxyUrl`, `safeHost`,
  `forwardAbort`, `MAX_CACHEABLE_BODY`, and the `CachedResponse` / `UniversalFetch` types.
- `src/services/fetcher.ts` — imports those from `../utils/fetch.ts`; keeps the stateful pieces
  (impit client cache, `appFetch`, retry/timeout wrappers). ~549 → 471 lines.

---

## New request options (all on `ctx.xhr.fetch(url, opts, requester)`)

| Option | Type | Default | Effect |
|---|---|---|---|
| `cookieJar` | `CookieJar` | off | attach + capture cookies for the host |
| `maxHostConcurrency` | `number` | `10` | cap concurrent requests to the host |
| `honorRateLimit` | `boolean` | `true` | respect 429 `Retry-After` |
| `coalesce` | `boolean` | `true` | dedupe identical in-flight cacheable GETs |

`maxHostConcurrency` / `honorRateLimit` / `coalesce` are resolved from the provider config
(`config.xhr`) and applied to every fetch — on by default, override there or per call (`cacheTTL`
is not defaulted). Proxy + proxy auth are **not** here — they're host-configured on the manager
(`config.proxy`), see §3.

## Verification
- Engine **typechecks + builds** clean.
- Library **bundles 20/20**; **xpass2** smoke test still returns 9 HLS via `ctx.xhr`.
