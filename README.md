<div align="center">

<img src="https://raw.githubusercontent.com/ImRoodyDev/grabit-engine/refs/heads/beta-v1/grabit.svg" width="120" alt="Grabit Engine" />
<h1>Grabit Engine</h1>

<img src="https://img.shields.io/badge/version-1.0.0-blue?style=flat" alt="Version" />
<img src="https://img.shields.io/badge/license-ISC-green?style=flat" alt="License" />
<img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat&logo=node.js" alt="Node.js" />
<img src="https://img.shields.io/badge/typescript-%5E5.0-blue?style=flat&logo=typescript" alt="TypeScript" />
<img src="https://img.shields.io/badge/jest-tested-C21325?style=flat&logo=jest" alt="Jest" />
<img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat" alt="PRs Welcome" />

<br />

**A simple, plugin-based engine for scraping media streams and subtitles.**
Load provider plugins from **GitHub**, **local files**, or **directly in code** — with health tracking, auto-updates, caching, and more built right in. Works in Node.js, browsers, and React Native.

</div>

---

# 📑 Table of Contents

- [Features](#-features)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Provider Sources](#-provider-sources)
- [Creating a Provider Plugin](#-creating-a-provider-plugin)
- [Bundling Providers](#-bundling-providers)
- [Testing Providers](#-testing-providers)
- [API Reference](#-api-reference)
- [Configuration](#-configuration)
- [Metrics & Health Monitoring](#-metrics--health-monitoring)
- [Examples](#-examples)
- [React Hook (`useSources`)](#️-react-hook-usesources)
- [Testing](#-testing)
- [License](#-license)

---

## ✨ Features

### Core

- 🔌 **Plugin system** — add or remove providers anytime
- 🌍 **Runs anywhere** — Node.js, browsers, React Native
- 🎯 **Pick a provider** — scrape from one specific provider by its scheme
- ⚡ **Run in parallel** — scrape from multiple providers at the same time
- 🏁 **Stop early** — quit as soon as enough providers have responded
- ⏱️ **Timeouts** — never wait forever for a slow provider

### Reliability

- 📊 **Health tracking** — see how each provider is doing (errors, successes)
- 🔴 **Auto-disable** — bad providers get turned off on their own
- 🔄 **Auto-update** — remote providers refresh themselves on a timer
- 💾 **Built-in cache** — save results in memory so you don't repeat work
- 🔁 **Retries** — automatically retry failed providers
- ✅ **Validation** — checks that plugins are set up correctly before loading

---

## 📦 Installation

```bash
npm install grabit-engine
```

<details>
<summary><strong>Optional: Puppeteer support (Node.js only)</strong></summary>

```bash
npm install puppeteer-real-browser
```

Puppeteer is an **optional peer dependency** for providers that need headless browser automation.

</details>

<details>
<summary><strong>Optional: base64 polyfill (React Native)</strong></summary>

```bash
npm install base-64
```

React Native versions below 0.74 do not expose `atob` / `btoa` as globals. This library automatically polyfills them when it detects they are missing, using the `base-64` package as an **optional peer dependency**.

If you are targeting React Native, install `base-64` alongside this package. On Node.js and modern browsers the built-in `atob` / `btoa` are used and no extra package is needed.

</details>

<br />

---

## 🚀 Quick Start

```typescript
import { ScrapePluginManager } from "grabit-engine";

// Create the manager with a registry source (simplest approach)
const manager = await ScrapePluginManager.create({
	source: {
		type: "registry",
		name: "my-providers",
		providers: {
			"my-provider": myProviderModule
		}
	},
	tmdbApiKeys: ["your-tmdb-api-key"]
});

// Scrape streams for a movie — minimal: only tmdbId is required!
// TMDB service auto-fills title, year, duration, imdbId, etc.
// Or provide full media data — TMDB only fills what's missing
const streams = await manager.getStreams({
	media: {
		type: "movie",
		tmdbId: "27205"
		// imdbId: "tt1375666"
		// title: "Inception",
		// duration: 148,
		// releaseYear: 2010,
	},
	targetLanguageISO: "en"
});

// Scrape from a specific provider by scheme
const targeted = await manager.getStreamsByScheme("my-provider", request);
```

<br />

---

## 🔗 Provider Sources

The manager can load plugins from **three places**:

<table>
<thead>
<tr>
<th>Source</th>
<th>Runtime</th>
<th>Description</th>
<th>Auto-Update</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>github</code></td>
<td>All</td>
<td>Download providers from a GitHub repo</td>
<td>✅</td>
</tr>
<tr>
<td><code>local</code></td>
<td>All</td>
<td>Load providers from files on your machine</td>
<td>❌</td>
</tr>
<tr>
<td><code>registry</code></td>
<td>All</td>
<td>Pass provider modules directly in code — no file I/O needed</td>
<td>❌</td>
</tr>
</tbody>
</table>

### GitHub Source

```typescript
const manager = await ScrapePluginManager.create({
	source: {
		type: "github",
		url: "https://github.com/your-org/your-providers",
		branch: "main",
		rootDir: "dist", // optional, subdirectory containing manifest.json and providers (default: repo root)
		token: process.env.GITHUB_TOKEN, // optional, for private repos
		// Required in browser / React Native:
		moduleResolver: async (scheme, sourceCode) => {
			const exports = {};
			const module = { exports };
			new Function("module", "exports", sourceCode)(module, exports);
			return (module.exports as any).default ?? module.exports;
		}
	}
});
```

<details>
<summary><strong>Repository structure</strong></summary>

Your GitHub repo must contain a `manifest.json`. By default it's expected at the repo root, but you can set `rootDir` to point to a subdirectory:

```
your-providers/              # rootDir not set (default: repo root)
├── manifest.json
└── providers/
    ├── example-provider/
    │   └── index.js
    └── another-provider/
        └── index.js
```

```
your-providers/              # rootDir: "dist"
├── dist/
│   ├── manifest.json
│   └── providers/
│       ├── example-provider/
│       │   └── index.js
│       └── another-provider/
│           └── index.js
└── src/
    └── ...
```

**manifest.json**

```json
{
	"name": "my-providers",
	"author": "your-name",
	"providers": {
		"example-provider": {
			"name": "ExampleProvider",
			"version": "1.0.0",
			"active": true,
			"language": "en",
			"type": "media",
			"env": "universal",
			"supportedMediaTypes": ["movie", "serie"],
			"priority": 10,
			"dir": "providers"
		}
	}
}
```

</details>

### Local Source

```typescript
const manager = await ScrapePluginManager.create({
	source: {
		type: "local",
		manifest: require("./manifest.json"),
		rootDir: "./providers",
		resolve: (path) => require(path)
	}
});
```

### Registry Source

```typescript
import exampleProvider from "./providers/example-provider";

const manager = await ScrapePluginManager.create({
	source: {
		type: "registry",
		name: "my-providers",
		providers: {
			"example-provider": exampleProvider
		}
	}
});
```

---

<br />

## 🔧 Creating a Provider Plugin

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
			xhr: { haveCorsPolicy: false, headers: {} }
		}
	];
}
```

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
		xhr: { haveCorsPolicy: false, headers: {} }
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

## � Bundling Providers

When providers are loaded from **GitHub** (via `GithubService`), each provider is fetched as a **single `index.js` file** and loaded via dynamic `import()` in an isolated temp directory. That directory has no `node_modules` and no sibling files — so relative imports (`./config`) and package imports (`grabit-engine`) would fail.

The bundler solves this by compiling each provider into a **standalone, self-contained ES module** with zero external imports.

### Install esbuild

```bash
npm install --save-dev esbuild
```

### Bundle all providers

```bash
npx bundle-provider
```

### Bundle a specific provider

```bash
npx bundle-provider my-cool-provider
```

### Folder structure

Providers can be organized **flat** or **grouped** inside subdirectories:

```
providers/
├── english/                    ← group folder (no index.ts)
│   ├── vidsrc/                 ← provider → scheme "english/vidsrc"
│   │   ├── index.ts
│   │   ├── config.ts
│   │   ├── stream.ts
│   │   └── subtitle.ts
│   └── another/                ← provider → scheme "english/another"
│       └── index.ts ...
├── loodvidrsc/                 ← provider → scheme "loodvidrsc"
│   ├── index.ts
│   └── ...
└── manifest.json
```

The bundler recursively walks the source directory. Folders with `index.ts` are providers; folders without are group organizers.

For grouped providers, pass the full relative path:

```bash
npx bundle-provider english/vidsrc
```

### Custom source & output directories

By default, providers are read from `providers/` and bundles are written next to the source. You can change both:

```bash
# Custom source directory
npx bundle-provider --src ./my-providers

# Custom output directory (mirrors the folder structure)
npx bundle-provider --out ./dist/providers

# Both
npx bundle-provider --src ./my-providers --out ./dist/providers
```

With `--out ./dist/providers`, the output becomes:

```
dist/providers/
├── english/vidsrc/index.js     ← standalone bundle
├── loodvidrsc/index.js         ← standalone bundle
└── ...
```

### What the bundle contains

Each bundled `index.js` inlines **everything** it needs:

- Your provider's config, stream, and subtitle logic
- Runtime code from `grabit-engine` (`Provider`, `defineProviderModule`, etc.)
- Manifest data from `manifest.json`

Tree-shaking keeps bundles small (~5–15 KB). The output has **zero** `import` statements.

### CLI reference

| Command                           | Description                                             |
| --------------------------------- | ------------------------------------------------------- |
| `npx bundle-provider`             | Bundle all providers                                    |
| `npx bundle-provider <scheme>`    | Bundle one provider (e.g. `vidsrc` or `english/vidsrc`) |
| `npx bundle-provider --src <dir>` | Custom source directory                                 |
| `npx bundle-provider --out <dir>` | Custom output directory                                 |
| `npx bundle-provider --dry-run`   | Preview without writing                                 |
| `npx bundle-provider --clean`     | Remove all generated bundles                            |

> **Tip:** After editing any provider source files, always re-bundle before pushing to GitHub.
>
> See [`scripts/BUNDLING.md`](scripts/BUNDLING.md) for the full bundling guide.

---

<br />

## 🧪 Testing Providers

Once you have written a provider, use the `test-provider` CLI tool to verify it scrapes correctly against real media data — without writing any test files or setting up a manager.

```bash
# Test a movie — minimal (TMDB fills title, year, duration, etc.)
npx test-provider --scheme my-provider --type movie --tmdb 27205

# Test a movie — full (all data provided, TMDB only fills gaps)
npx test-provider --scheme my-provider --type movie \
  --title "Inception" --year 2010 --tmdb 27205 --duration 148

# Test a series episode — minimal
npx test-provider --scheme my-provider --type serie \
  --tmdb 1396 --season 1 --episode 1

# Test a series episode — full
npx test-provider --scheme my-provider --type serie \
  --title "Breaking Bad" --year 2008 --tmdb 1396 \
  --season 1 --episode 1 --ep-tmdb 349232

# Test both streams and subtitles
npx test-provider --scheme my-provider --mode both --type movie --tmdb 27205

# Load media from a JSON file
npx test-provider --scheme my-provider --media-file ./test-media.json
```

The tool auto-bundles TypeScript source via esbuild if no pre-built `index.js` is present, fetches missing media data from TMDB automatically, runs the scrape with a configurable timeout, and prints a formatted report with a `PASS / EMPTY / FAIL` verdict.

> See [`/TESTING.md`](/TESTING.md) for the full guide — all flags, output format, media file examples, and tips.

---

<br />

## 📖 API Reference

> Full API documentation has been moved to **[API_REFERENCE.md](API_REFERENCE.md)** for better readability.
>
> It covers: `ScrapePluginManager`, `ScrapeRequester`, `ProviderModuleManifest`, `ProviderMetrics` & `ProviderHealthReport`, `ProviderContext`, `ProviderFetchOptions`, Media Input Types, Output Types, Provider Configuration, the `Provider` class, Error Classes, Utility Functions, and Services.

---

<br />

## ⚙️ Configuration

<table>
<thead>
<tr>
<th>Option</th>
<th>Type</th>
<th>Default</th>
<th>Description</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>source</code></td>
<td><code>GithubSource | LocalSource | RegistrySource</code></td>
<td>—</td>
<td><strong>Required.</strong> Where to load your plugins from.</td>
</tr>
<tr>
<td><code>debug</code></td>
<td><code>boolean</code></td>
<td><code>false</code></td>
<td>Turn on detailed logging.</td>
</tr>
<tr>
<td><code>strict</code></td>
<td><code>boolean</code></td>
<td><code>false</code></td>
<td>Throw errors for bad plugins instead of just skipping them.</td>
</tr>
<tr>
<td><code>autoUpdateIntervalMinutes</code></td>
<td><code>number</code></td>
<td><code>15</code></td>
<td>How often to refresh remote providers (min: 5).</td>
</tr>
<tr>
<td><code>cache.enabled</code></td>
<td><code>boolean</code></td>
<td><code>false</code></td>
<td>Turn on result caching.</td>
</tr>
<tr>
<td><code>cache.TTL</code></td>
<td><code>number</code></td>
<td><code>0</code></td>
<td>How long to keep cached results (in ms).</td>
</tr>
<tr>
<td><code>cache.MODULE_TTL</code></td>
<td><code>number</code></td>
<td><code>900000</code></td>
<td>How long to keep loaded provider modules in cache (15 min).</td>
</tr>
<tr>
<td><code>cache.TMDB_TTL</code></td>
<td><code>number</code></td>
<td><code>0</code></td>
<td>How long to cache TMDB API responses (in ms). Helps avoid hitting the TMDB API too hard. Set to e.g. <code>3600000</code> (1 hour) to cache responses.</td>
</tr>
<tr>
<td><code>cache.maxEntries</code></td>
<td><code>number</code></td>
<td><code>10000</code></td>
<td>Maximum number of entries in the in-memory cache. Oldest entries are evicted when the limit is reached (LRU).</td>
</tr>
<tr>
<td><code>tmdbApiKeys</code></td>
<td><code>string[]</code></td>
<td>—</td>
<td><strong>Required.</strong> Array of TMDB API keys. A random key is selected for each request to distribute load.</td>
</tr>
</tbody>
</table>

### Scrape Configuration

<table>
<thead>
<tr>
<th>Option</th>
<th>Type</th>
<th>Default</th>
<th>Description</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>scrapeConfig.concurrentOperations</code></td>
<td><code>number</code></td>
<td><code>5</code></td>
<td>How many providers can run at the same time.</td>
</tr>
<tr>
<td><code>scrapeConfig.maxAttempts</code></td>
<td><code>number</code></td>
<td><code>1</code></td>
<td>How many times to retry a failing provider.</td>
</tr>
<tr>
<td><code>scrapeConfig.operationTimeout</code></td>
<td><code>number</code></td>
<td><code>15000</code></td>
<td>Max time before giving up on a scrape (15 sec).</td>
</tr>
<tr>
<td><code>scrapeConfig.successQuorum</code></td>
<td><code>number</code></td>
<td><code>undefined</code></td>
<td>Stop once this many providers have succeeded.</td>
</tr>
<tr>
<td><code>scrapeConfig.errorThresholdRate</code></td>
<td><code>number</code></td>
<td><code>0.7</code></td>
<td>Error rate that triggers auto-disable (70%).</td>
</tr>
<tr>
<td><code>scrapeConfig.minOperationsForEvaluation</code></td>
<td><code>number</code></td>
<td><code>10</code></td>
<td>How many scrapes before checking if a provider is healthy.</td>
</tr>
</tbody>
</table>

---

<br />

## 📊 Metrics & Health Monitoring

The manager keeps track of how each provider is doing and can **automatically turn off** unhealthy ones:

```typescript
// Raw metrics map
const metrics = manager.getMetrics();
for (const [scheme, m] of metrics) {
	console.log(`${scheme}: ${m.successes} ok, ${m.errors} err`);
}

// Detailed health report
const report = manager.getMetricsReport();
report.forEach((r) => {
	console.log(`${r.moduleName}: ${r.totalOperations} ops, ` + `${(r.errorRate * 100).toFixed(1)}% errors, ` + `active=${r.active}`);
});
```

Providers that fail too often (more than `errorThresholdRate` after `minOperationsForEvaluation` scrapes) get turned off and won't be used again until the manager is reloaded.

---

<br />

## 📝 Examples

<details>
<summary><strong>React Native with GitHub source</strong></summary>

```typescript
import { ScrapePluginManager } from "grabit-engine";

const manager = await ScrapePluginManager.create({
	source: {
		type: "github",
		url: "your-org/providers-repo",
		branch: "main",
		rootDir: "dist", // optional
		moduleResolver: async (_scheme, sourceCode) => {
			const exports: Record<string, unknown> = {};
			const module = { exports };
			new Function("module", "exports", sourceCode)(module, exports);
			return (module.exports as any).default ?? module.exports;
		}
	},
	tmdbApiKeys: ["your-tmdb-api-key"],
	scrapeConfig: {
		concurrentOperations: 3,
		successQuorum: 2,
		operationTimeout: 15000
	}
});

// Minimal request — just tmdbId, TMDB fills the rest

// Minimal request — just tmdbId, TMDB fills the rest
const streams = await manager.getStreams({
	media: { type: "movie", tmdbId: "27205" },
	targetLanguageISO: "en"
});
```

</details>

<details>
<summary><strong>Node.js with local providers</strong></summary>

```typescript
import { ScrapePluginManager } from "grabit-engine";
import manifest from "./providers/manifest.json";

const manager = await ScrapePluginManager.create({
	source: {
		type: "local",
		manifest,
		rootDir: "./providers",
		resolve: (path) => require(path)
	},
	tmdbApiKeys: ["your-tmdb-api-key"],
	debug: true,
	cache: {
		enabled: true,
		TTL: 300_000,
		TMDB_TTL: 3_600_000, // Cache TMDB responses for 1 hour
		maxEntries: 5_000
	},
	scrapeConfig: {
		maxAttempts: 3,
		errorThresholdRate: 0.5
	}
});
```

</details>

<details>
<summary><strong>Targeted scraping by scheme</strong></summary>

```typescript
// Only scrape from a specific provider
const streams = await manager.getStreamsByScheme("example-provider", request);
const subs = await manager.getSubtitlesByScheme("subtitle-provider", request);
```

</details>

---

<br />

## ⚛️ React Hook (`useSources`)

An optional React hook for declarative scraping inside React / React Native components. Requires `react >= 17` as a **peer dependency** (already optional — non-React consumers are unaffected).

```bash
npm install react   # if not already installed
```

### Basic Usage

```tsx
import { useSources } from "grabit-engine";

function StreamList() {
	const { mediaSources, subtitleSources, isLoading, isManagerReady, error, scrape, clearSources } = useSources({
		managerConfig: {
			source: {
				type: "registry",
				name: "my-providers",
				providers: {
					/* ... */
				}
			},
			tmdbApiKeys: ["your-tmdb-api-key"]
		},
		type: "both"
	});

	const handleScrape = () => {
		scrape({
			media: { type: "movie", tmdbId: "27205" },
			targetLanguageISO: "en"
		});
	};

	return (
		<div>
			<button onClick={handleScrape} disabled={!isManagerReady || isLoading}>
				{isLoading ? "Scraping…" : "Scrape"}
			</button>
			{error && <p>Error: {error.message}</p>}
			<h3>Media ({mediaSources.length})</h3>
			<ul>
				{mediaSources.map((s) => (
					<li key={`${s.scheme}-${s.providerName}-${s.fileName}`}>{s.fileName}</li>
				))}
			</ul>
			<h3>Subtitles ({subtitleSources.length})</h3>
			<ul>
				{subtitleSources.map((s) => (
					<li key={`${s.scheme}-${s.providerName}-${s.fileName}`}>{s.fileName}</li>
				))}
			</ul>
		</div>
	);
}
```

### Continuous Mode

When `continuous: true`, calling `scrape()` ignores `scrapeConfig.successQuorum` and streams results **per-provider** as they arrive — the list grows live instead of waiting for all providers to finish.

```tsx
const { mediaSources, isContinuousScraping, scrape, stopContinuousScraping } = useSources({
	managerConfig: {
		/* ... */
	},
	continuous: true,
	type: "media"
});

// Start scraping — results appear one by one
scrape({ media: { type: "serie", tmdbId: "1396", ep_tmdbId: "62085", season: 1, episode: 1 }, targetLanguageISO: "en" });

// Cancel early — already-collected sources are kept
stopContinuousScraping();
```

### Config (`UseSourcesConfig`)

| Property        | Type                              | Default  | Description                                                           |
| --------------- | --------------------------------- | -------- | --------------------------------------------------------------------- |
| `managerConfig` | `ProviderManagerConfig`           | —        | Configuration for the `ScrapePluginManager` singleton.                |
| `continuous`    | `boolean`                         | `false`  | Stream results per-provider as they arrive (ignores `successQuorum`). |
| `type`          | `"media" \| "subtitle" \| "both"` | `"both"` | Which source category to fetch.                                       |

### Return Value (`UseSourcesReturn`)

| Property                   | Type                                         | Description                                                    |
| -------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| `mediaSources`             | `MediaSource[]`                              | Collected media sources (de-duplicated).                       |
| `subtitleSources`          | `SubtitleSource[]`                           | Collected subtitle sources (de-duplicated).                    |
| `isLoading`                | `boolean`                                    | `true` while manager is initialising or a scrape is in-flight. |
| `isManagerReady`           | `boolean`                                    | `true` once the manager singleton is created.                  |
| `isContinuousScraping`     | `boolean`                                    | `true` while a continuous scrape is still resolving providers. |
| `error`                    | `ProcessError \| HttpError \| null`          | The last error from init or scraping.                          |
| `scrape(requester)`        | `(req: RawScrapeRequester) => Promise<void>` | Start a scrape. Clears previous sources.                       |
| `stopContinuousScraping()` | `() => void`                                 | Cancel in-flight continuous scrape. Keeps collected sources.   |
| `clearSources()`           | `() => void`                                 | Clear all collected sources.                                   |

### Lifecycle

- **Mount** — The manager singleton is created asynchronously.
- **`scrape(requester)`** — Clears previous sources, then fetches. In continuous mode results stream in; in normal mode they arrive all at once.
- **New `scrape()` call** — Cancels any in-flight operations, clears sources, starts fresh.
- **`stopContinuousScraping()`** — Cancels remaining queued provider operations. Already-collected results are kept.
- **Unmount** — All operations are cancelled and the manager is destroyed automatically.

---

<br />

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suites
npx jest tests/models/manager/ --verbose      # Manager unit tests
npx jest tests/models/sources/ --verbose      # Source integration tests

# With coverage
npx jest --coverage
```

---

## 📄 License

<div align="center">

**ISC** © grabit-engine

</div>
