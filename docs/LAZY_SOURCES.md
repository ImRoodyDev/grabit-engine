# Lazy sources (resolve on play)

Return results fast and defer the expensive final-URL resolution until the user actually plays a
source. Useful when a provider lists many servers but resolving each is slow.

## In a provider

Return a source with a `lazy` handle instead of a resolved `playlist`, and export a
`resolveLazy` worker that finishes the job:

```typescript
// getStreams — cheap: list servers without resolving them
export async function getStreams(requester, ctx) {
  return servers.map((s) => ({
    fileName: s.name,
    playlist: "", // unresolved
    language: "en",
    xhr: { flags: [], headers: {} },
    lazy: { id: s.key } // opaque id passed back to resolveLazy
  }));
}

// resolveLazy — heavy: called on play with the id above
export async function resolveLazy(id, ctx, requester) {
  const url = await resolveServer(id, ctx, requester);
  if (!url) return null;
  return { fileName: id, playlist: url, language: "en", xhr: { flags: ["CORS_BLOCKED"], headers: {} } };
}
```

Wire it into the module the same way as the other workers:

```typescript
export default defineProviderModule(PROVIDER, manifest.providers["my-provider"], {
  getStreams,
  resolveLazy
});
```

## On the host

When the user selects a lazy source, resolve it through the manager:

```typescript
const resolved = await manager.resolveLazySource(scheme, source.lazy.id, requester);
// resolved is a fully-shaped MediaSource (or null)
```

The engine builds the TMDB-enriched requester and applies the same source shaping (User-Agent
header, provider name/scheme/format/fileName) as `getStreams`.
