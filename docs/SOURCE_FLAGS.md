# Source flags

Each resolved source declares how the host must consume it via `xhr.flags` (a `SourceFlag[]`).
This replaces the old coarse `haveCorsPolicy: boolean`.

## Values

| Flag | Meaning |
|---|---|
| `CORS_BLOCKED` | direct browser fetch is blocked by CORS → route through a proxy |
| `REFERER_LOCKED` | requires the `Referer` from `xhr.headers` to play |
| `IP_LOCKED` | URL is bound to the scraper's IP → play from the same IP/proxy |
| `GEO_BLOCKED` | region-restricted origin |
| `PROXY_ONLY` | only playable through a proxy |
| `EXTERNAL` | hand off to an external player/browser |

Set only the flags that apply — the list is extensible and additive.

## Usage

```typescript
return [
  {
    fileName: "…",
    playlist: m3u8,
    language: "en",
    format: "m3u8",
    xhr: {
      // a HubCloud/vcloud stream that needs a Referer AND can't be fetched cross-origin:
      flags: ["CORS_BLOCKED", "REFERER_LOCKED"],
      headers: { Referer: base.origin + "/", Origin: base.origin }
    }
  }
];
```

A source with no constraints uses `flags: []`.

## On the host

Read the flags to decide playback: e.g. route `CORS_BLOCKED` / `PROXY_ONLY` / `IP_LOCKED`
through your proxy, apply the `xhr.headers` for `REFERER_LOCKED`, or open `EXTERNAL` sources in
a system player.
