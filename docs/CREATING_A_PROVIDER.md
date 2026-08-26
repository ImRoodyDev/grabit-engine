# 🔧 Creating a Provider Plugin

The fastest way to create a new provider is with the built-in CLI:

```bash
npx create-provider my-cool-provider
```

You can specify the language(s) upfront with `--lang`. Pass a comma-separated list for multiple languages:

```bash
# Single language (default: "en")
npx create-provider my-cool-provider --lang fr

# Multiple languages
npx create-provider my-cool-provider --lang en,fr,es
```

If no scheme is provided, the CLI enters **interactive mode** and prompts you for it:

```bash
npx create-provider
```

> Once your provider is ready, bundle it for distribution with `npx bundle-provider` — see [Bundling Providers](#-bundling-providers) for all available flags (`--src`, `--out`, `--dry-run`, `--clean`).

This creates a ready-to-edit folder:

```
providers/
└── my-cool-provider/
    ├── index.ts      ← entry point (exports the module)
    ├── config.ts     ← provider settings (URL, endpoints, etc.)
    ├── stream.ts     ← stream scraping logic
    └── subtitle.ts   ← subtitle scraping logic (optional)
```

You can also create the files by hand. Here's what each file looks like:

### `config.ts` — Provider Configuration

```typescript
import { ProviderConfig } from "grabit-engine";

export const config: ProviderConfig = {
	scheme: "example-provider",
	name: "ExampleProvider",
	language: "en", // or ["en", "fr"] for multi-language providers
	baseUrl: "https://example-streams.com",
	entries: {
		movie: { endpoint: "/embed/movie?tmdb={id:string}" },
		serie: { endpoint: "/embed/tv?tmdb={id:string}&season={season:1}&episode={episode:1}" }
	},
	mediaIds: ["tmdb", "imdb"]
};
```

### `stream.ts` — Stream Handler

```typescript
import { ScrapeRequester, InternalMediaSource, ProviderContext } from "grabit-engine";
import { Provider } from "grabit-engine/models/provider";
import { config } from "./config";

export async function getStreams(requester: ScrapeRequester, ctx: ProviderContext): Promise<InternalMediaSource[]> {
	const provider = Provider.create(config);
	const url = provider.createResourceURL(requester);

	ctx.log.info(`Fetching streams from ${url.href}`);

	const { $, response } = await ctx.cheerio.load(url, requester, ctx.xhr);
	const src = $("video > source").attr("src");

	if (!src) return [];

	return [
		{
			fileName: "video.mp4",
			format: "mp4",
			language: "en",
			playlist: src,
			xhr: { flags: [], headers: {} }
		}
	];
}
```

If your provider needs a rendered page, use `ctx.puppeteer.launch()` instead. Set `browsingOptions.ignoreError` when the page can still be scraped even if `page.goto(...)` returns a non-OK response or no response object:

```typescript
const { page, browser } = await ctx.puppeteer.launch(url, {
	requester,
	browsingOptions: {
		ignoreError: true
	}
});

try {
	const html = await page.content();
	// ... scrape the page
} finally {
	await browser.close(); // releases the tab back to the pool
}
```

> **Important:** `browser.close()` does **not** kill the browser process — the pool intercepts the call and only releases your tab. The underlying browser stays warm for reuse by the next request. Always call `browser.close()` in a `finally` block to avoid leaking tabs.
>
> If a provider forgets to call `browser.close()`, the pool will automatically release the tab after `maxBrowserSessionTTL` (default 2 minutes) and log a warning that always prints regardless of debug mode.

### `subtitle.ts` — Subtitle Handler

```typescript
import { ScrapeRequester, InternalSubtitleSource, ProviderContext } from "grabit-engine";
import { Provider } from "grabit-engine/models/provider";
import { config } from "./config";

export async function getSubtitles(requester: ScrapeRequester, ctx: ProviderContext): Promise<InternalSubtitleSource[]> {
	const provider = Provider.create(config);
	const url = provider.createResourceURL(requester);

	ctx.log.info(`Fetching subtitles from ${url.href}`);

	const apiUrl = new URL(`/api/subtitles?id=${url.searchParams.get("tmdb")}`, url.origin);
	const response = await ctx.xhr.fetch(apiUrl, {}, requester);
	const data = await response.json();

	return data.map((sub: any) => ({
		fileName: "subtitles.srt",
		format: "srt" as const,
		language: sub.language,
		languageName: sub.languageName,
		url: sub.url,
		xhr: { flags: [], headers: {} }
	}));
}
```

### `index.ts` — Entry Point

```typescript
import { defineProviderModule } from "grabit-engine/controllers/provider";
import { Provider } from "grabit-engine/models/provider";
import { config } from "./config";
import { getStreams } from "./stream";
import { getSubtitles } from "./subtitle";

const provider = Provider.create(config);

export default defineProviderModule(
	provider,
	{
		name: config.name,
		version: "1.0.0",
		active: true,
		env: "universal",
		type: "media",
		supportedMediaTypes: ["movie", "serie"],
		priority: 10,
		dir: "providers"
	},
	{ getStreams, getSubtitles }
);
```

The worker object accepts any combination of `getStreams`, `getSubtitles`, `getLazyStreams`, and
`resolveLazy`. `getLazyStreams` (cheap lazy listing) and `resolveLazy` (resolve one handle on play)
power [Lazy sources](./LAZY_SOURCES.md); keep them in a separate `lazy.ts` and pass them here
alongside `getStreams`.

### Multi-Language Providers

The `language` field on both `ProviderConfig` and `ProviderModuleManifest` accepts a **single string** or an **array of strings**. This lets you declare that a provider serves content in multiple languages.

#### CLI

```bash
# Single language (default)
npx create-provider my-provider --lang en

# Multiple languages
npx create-provider my-provider --lang en,fr,es
```

#### Config

```typescript
// Single language
export const config: ProviderConfig = {
	scheme: "single-lang",
	name: "SingleLang",
	language: "en"
	// ...
};

// Multi-language
export const config: ProviderConfig = {
	scheme: "multi-lang",
	name: "MultiLang",
	language: ["en", "fr", "es"]
	// ...
};
```

#### Manifest (`manifest.json`)

```jsonc
{
	"providers": {
		"my-provider": {
			"name": "MyProvider",
			"version": "1.0.0",
			"active": true,
			"language": ["en", "fr", "es"]
			// ...
		}
	}
}
```

When the manager sorts providers for a request, providers whose `language` field **includes** the requester's `targetLanguageISO` are prioritized higher.

---

<br />

