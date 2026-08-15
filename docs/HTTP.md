# HTTP hardening (`ctx.xhr`)

Options on `ctx.xhr.fetch(url, options, requester)` for tougher, multi-hop scrapes.

Per-host concurrency, rate limiting and coalescing are **on by default from the provider
config** (`config.xhr`) — you don't set them per fetch. Only `cookieJar` is opt-in per call.

| Option | Type | Default | Effect |
|---|---|---|---|
| `cookieJar` | `CookieJar` | off | attaches the host's cookies and captures `Set-Cookie` |
| `maxHostConcurrency` | `number` | `10` | caps concurrent requests to the URL's host |
| `honorRateLimit` | `boolean` | `true` | respects `429 Retry-After` (waits briefly, else throws) |
| `coalesce` | `boolean` | `true` | dedupes identical in-flight cacheable GETs into one request |

Override any of the three per provider in `config.xhr`, or per call by passing the option to
`ctx.xhr.fetch` (an explicit per-call value wins). `cacheTTL` is **not** defaulted — set it where
you want caching.

```typescript
// config.ts — override the defaults for one provider
xhr: { maxHostConcurrency: 4, coalesce: false }
```

> **Proxy & proxy auth are not `xhr` options.** They're host-configured on the manager (with a
> per-scrape-request override) and applied automatically by the engine — see
> [Configuration → Proxy](CONFIGURATION.md#proxy).

## Cookie jar

Carries cookies across the hops of one scrape — no more manually reading `Set-Cookie` and
forwarding it.

```typescript
import { CookieJar } from "grabit-engine";

export async function getStreams(requester, ctx) {
  const jar = new CookieJar();

  // 1) hit the embed page — its Set-Cookie is captured into the jar
  await ctx.xhr.fetch(embedUrl, { cookieJar: jar }, requester);

  // 2) the signed API call automatically carries the captured cookie
  const res = await ctx.xhr.fetch(dataUrl, { cookieJar: jar, headers: { Referer: embedUrl.href } }, requester);
  // ...
}
```

You can also seed a cookie the jar didn't see (e.g. from a solved challenge):

```typescript
jar.set(new URL(url).host, "cf_clearance", clearanceValue);
```

## Per-host concurrency + rate limiting

On by default (concurrency `10`, rate limiting `true`) to avoid hammering a host into a ban and
to respect its `Retry-After` — no per-fetch flags needed:

```typescript
// already active — override only when a provider needs different limits
await ctx.xhr.fetch(url, { maxHostConcurrency: 2 }, requester);
```

- `maxHostConcurrency` gates requests to the same host through a shared limiter.
- `honorRateLimit`: on a `429`, the back-off window from `Retry-After` is recorded; the next
  request within it waits (if short) or throws an `HttpError` with status `429`.

## Request coalescing

On by default: two providers (or two calls) requesting the same cacheable URL at the same time
share a single network request. It only kicks in for cacheable `GET`s, so set `cacheTTL` to make
the request cacheable:

```typescript
await ctx.xhr.fetch(url, { cacheTTL: 60_000 }, requester);
```

Coalescing layers on top of the existing response cache (`cacheTTL` / `customCacheKey`). Pass
`coalesce: false` to opt a fetch out.
