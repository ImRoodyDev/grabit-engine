<div align="center">

<img src="https://raw.githubusercontent.com/ImRoodyDev/grabit-engine/refs/heads/main/grabit.svg" width="120" alt="Grabit Engine" />
<h1>Grabit Engine</h1>

<a href="https://www.npmjs.com/package/grabit-engine"><img src="https://img.shields.io/npm/v/grabit-engine?style=flat&logo=npm" alt="npm version" /></a>

<img src="https://img.shields.io/badge/license-ISC-green?style=flat" alt="License" />
<img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat&logo=node.js" alt="Node.js" />
<img src="https://img.shields.io/badge/typescript-%5E5.0-blue?style=flat&logo=typescript" alt="TypeScript" />
<img src="https://img.shields.io/badge/jest-tested-C21325?style=flat&logo=jest" alt="Jest" />
<img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat" alt="PRs Welcome" />

<br />

**A simple, plugin-based engine for scraping media streams and subtitles.**
Load provider plugins from **GitHub**, **local files**, or **directly in code** — with health tracking, auto-updates, caching, and more built right in. Works in Node.js, browsers, React and React Native.

</div>

---

## 📚 Documentation

Guides live in [`docs/`](docs/) — the README keeps just the overview and a quick start.

| Guide | What it covers |
|---|---|
| [Installation](docs/INSTALLATION.md) | install + React Native / Expo setup |
| [Provider Sources](docs/PROVIDER_SOURCES.md) | GitHub, local, and registry sources |
| [Creating a Provider Plugin](docs/CREATING_A_PROVIDER.md) | `config.ts` / `stream.ts` / `subtitle.ts` / `index.ts` |
| [Bundling Providers](BUNDLING.md) | bundling plugins into standalone modules |
| [Testing Providers](TESTING.md) | the `test-provider` CLI |
| [Configuration](docs/CONFIGURATION.md) | manager + scrape config, metrics & health |
| [Examples](docs/EXAMPLES.md) | end-to-end usage examples |
| [React Hook (`useSources`)](docs/REACT_HOOK.md) | the React/React Native hook |
| [API Reference](docs/API_REFERENCE.md) | full API surface |

**New capabilities** (see [What's new](#-whats-new)):
[HTTP hardening](docs/HTTP.md) · [Challenge solver](docs/CHALLENGE_SOLVER.md) · [Source flags](docs/SOURCE_FLAGS.md) · [Lazy sources](docs/LAZY_SOURCES.md) · [full changelog](IMPROVEMENTS.md)

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
- ♻️ **Warm Puppeteer pool** — reuse browser processes as tabs instead of spawning a browser for every request
- 💾 **Built-in cache** — save results in memory so you don't repeat work
- 🔁 **Retries** — automatically retry failed providers
- ✅ **Validation** — checks that plugins are set up correctly before loading

---

## 🚀 Quick Start

```typescript
import { GrabitManager } from "grabit-engine";

// Create the manager with a registry source (simplest approach)
const manager = await GrabitManager.create({
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
const streams = await manager.getStreams({
	media: {
		type: "movie",
		tmdbId: "27205"
	},
	targetLanguageISO: "en"
});

// Scrape from a specific provider by scheme
const targeted = await manager.getStreamsByScheme("my-provider", request);
```

See [Provider Sources](docs/PROVIDER_SOURCES.md) for GitHub/local sources and
[Creating a Provider Plugin](docs/CREATING_A_PROVIDER.md) to build your own.

---

## 🆕 What's new

Recent additions — each is opt-in and documented in its own guide:

- **[HTTP hardening](docs/HTTP.md)** — `ctx.xhr` gains a cookie jar, plus per-host concurrency,
  `429` rate-limit handling, and request coalescing (on by default from `config.xhr`). Proxy is
  host config on the manager — a proxy agent or a URL resolver — see
  [Configuration → Proxy](docs/CONFIGURATION.md#proxy).
- **[Challenge solver](docs/CHALLENGE_SOLVER.md)** — `ctx.solveChallenge(url, …)` (puppeteer on
  Node; inject a hidden RN WebView or FlareSolverr via `setChallengeSolver`).
- **[Source flags](docs/SOURCE_FLAGS.md)** — `xhr.flags: SourceFlag[]` (replaces
  `haveCorsPolicy`) so a source states exactly how the host must play it.
- **[Lazy sources](docs/LAZY_SOURCES.md)** — return `{ lazy: { id } }` and a `resolveLazy`
  worker to defer final-URL resolution to play time.

Full details in [IMPROVEMENTS.md](IMPROVEMENTS.md).

---

## 🧭 Browser access: `ctx.puppeteer` vs `ctx.solveChallenge`

Two ways to drive a real browser from a provider, with different reach:

- **`ctx.puppeteer`** hands you the live Puppeteer `page` (and `browser`) leased from the shared
  pool. Use it only when you truly need the page object: listening to network requests to capture
  the media URL, or injecting / interacting directly in the browser. It runs on **Node only**, so a
  provider that uses it must set **`env: "node"`** in its `manifest.json` entry. Off Node
  (browser / React Native) the engine only runs `env: "universal"` providers, so a node-only
  provider is correctly skipped there instead of failing at runtime.
- **`ctx.solveChallenge(url, requester, opts)`** returns just
  `{ html, cookies, cookieMap, userAgent }`. Use it when you only need the rendered HTML (for
  example to pass a Cloudflare interstitial and read the DOM). It works everywhere: on Node it
  drives Puppeteer, and a host can inject an RN hidden WebView or FlareSolverr solver via
  `setChallengeSolver`, so these providers stay `env: "universal"`.

Rule of thumb: need the page or a network listener, use `ctx.puppeteer` with `env: "node"`. Only
need the solved HTML, use `ctx.solveChallenge` with `env: "universal"`.

When reusing a solved result, forward the returned `userAgent` (and cookies) on later requests:
Cloudflare binds `cf_clearance` to the exact User-Agent and IP that earned it.

---

## 📜 License

ISC — see [LICENSE](LICENSE). For educational / personal use.
