# Lazy sources (resolve on play)

Return results fast and defer the expensive final-URL resolution until the user actually plays a
source. Useful when a provider lists many servers but resolving each is slow.

A provider exposes lazy support through two workers:

- **`getLazyStreams(requester, ctx)`** — the cheap listing. Returns lazy handles (a `lazy: { id }`
  and no `playlist`).
- **`resolveLazy(id, ctx, requester)`** — resolves one handle to a real source on play.

`getStreams` (eager, fully-resolved) is unaffected. A provider can ship any combination of
`getStreams`, `getLazyStreams`, and `resolveLazy`.

## In a provider

```typescript
// getLazyStreams — cheap: list servers without resolving them. No playlist yet.
export async function getLazyStreams(requester, ctx) {
	return servers.map((s) => ({
		fileName: s.name,
		language: "en",
		xhr: { flags: [], headers: {} },
		lazy: { id: s.key } // opaque, self-contained id passed back to resolveLazy
	}));
}

// resolveLazy — heavy: called on play with the id above
export async function resolveLazy(id, ctx, requester) {
	const url = await resolveServer(id, ctx, requester);
	if (!url) return null;
	return { fileName: id, playlist: url, language: "en", xhr: { flags: ["CORS_BLOCKED"], headers: {} } };
}
```

> The `id` must be **self-contained**: `resolveLazy` runs in a separate call (often a separate HTTP
> request) from `getLazyStreams`, so pack everything it needs into the id. Do not stash state in a
> module-level variable.

Wire the workers into the module:

```typescript
export default defineProviderModule(PROVIDER, manifest.providers["my-provider"], {
	getStreams, // eager (optional)
	getLazyStreams, // lazy listing (optional)
	resolveLazy // lazy resolution (optional)
});
```

## Turning on lazy mode

The manager decides eager vs lazy with the `lazy` config flag:

```typescript
const manager = await GrabitManager.create({
	source: {
		/* ... */
	},
	tmdbApiKeys,
	lazy: true
});
```

- `lazy: false` (default) — `manager.getStreams()` calls each provider's **`getStreams`**.
- `lazy: true` — `manager.getStreams()` / `getStreamsProgressive()` / `getStreamsByScheme()` call each
  provider's **`getLazyStreams`**, falling back to `getStreams` when a provider has no lazy worker
  (because `lazyFallbackToStreams` defaults to `true`). Set `lazyFallbackToStreams: false` for
  **strict lazy mode**, where only providers that implement `getLazyStreams` participate.

`manager.getLazyStreams(requester)` forces lazy listing regardless of the flag. Provider eligibility
follows the same rule: with fallback on (default) a provider is eligible when it implements
`getStreams` **or** `getLazyStreams`; in strict mode only `getLazyStreams` counts, so an eager-only
provider is skipped rather than run to an empty result (which would otherwise dent its health metrics).

## On the host

When the user selects a lazy source, resolve it through the manager:

```typescript
const resolved = await manager.resolveLazySource(scheme, source.lazy.id, requester);
// resolved is a fully-shaped MediaSource (or null)
```

The engine builds the TMDB-enriched requester and applies the same source shaping (User-Agent
header, provider name/scheme/format/fileName) as `getStreams`. The host must resend the media
context (type, tmdbId, season/episode, language) on the resolve call, because the engine rebuilds
the requester from it.

## Behind a server (resolve on tap, proxy client-side)

A common deployment fronts the scrape server (which holds the `GrabitManager`) with a main server
that talks to clients:

```
CLIENT ── /play ──▶ MAIN SERVER ── /sources ──▶ SCRAPE SERVER: manager.getStreams (lazy)
        ◀── lazy MediaSource[] ──────────────────────────────────────────────
user taps a source:
CLIENT ── /resolve?scheme&id ──▶ MAIN SERVER ── /sources/resolve ──▶ manager.resolveLazySource
        ◀── resolved MediaSource JSON (NOT a redirect) ─────────────────────
CLIENT builds the (proxied) URL from source.xhr and plays it
```

The scrape and main servers **return the resolved `MediaSource` as JSON** — they do not redirect.
The client resolves a source only when the user plays it and builds the playback URL itself. Keep
the proxy on the client (a player-side proxy/resolver that reads `xhr.flags` + `xhr.headers`): a
server 302 to a CDN cannot carry `xhr.headers`, and routing every stream through a redirect adds a
hop for every viewer. `REFERER_LOCKED`/`IP_LOCKED` sources keep their headers because the client
proxies them, not the origin server.

## Testing a lazy provider

Use the `test-provider` CLI's lazy mode — it lists the handles, then resolves one through
`resolveLazy`, mirroring the manager's lazy path:

```bash
npx test-provider --scheme <scheme> --type movie --tmdb 27205 --mode lazy
npx test-provider --scheme <scheme> --type movie --tmdb 27205 --mode lazy --resolve-all
```

The **Lazy Handles** section shows each handle (with its `Lazy id`, no playlist yet); the
**Resolved On Play** section shows the handle resolved to a real `Playlist`. `--lazy-index <n>`
picks which handle to resolve; `--resolve-all` resolves every one (a good check that each id is
self-contained). See [Testing providers](../TESTING.md#test-a-lazy-provider---mode-lazy).

## Security: the id is attacker-controllable

`lazy.id` round-trips through the client. If `resolveLazy` builds a fetch URL from it, a tampered id
is an SSRF vector. For public-facing deployments HMAC-sign the id, allowlist the resolved host, or
keep the id opaque and map it server-side. For personal/educational use you can skip this.
