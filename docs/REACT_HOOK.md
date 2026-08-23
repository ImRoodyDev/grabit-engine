# ⚛️ React Hook (`useSources`)

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
| `managerConfig` | `ProviderManagerConfig`           | —        | Configuration for the `GrabitManager` singleton.                      |
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

## 🔥 Pre-warming the manager on app start

`useSources` (and `useManager`) create the `GrabitManager` singleton lazily on **first mount**. On the first navigation to a scraping screen, that means the provider modules are loaded right when the user is waiting — noticeable on low-end / native devices.

To hide that cost, kick off manager creation at **app start** with the exported `acquireManager`. It returns the same shared, in-flight `create()` promise that the hooks reuse, so by the time the first screen mounts the modules are already loaded (or loading).

```ts
// App entry — e.g. index.js / App.tsx bootstrap, before rendering the tree.
import { acquireManager } from "grabit-engine/react"; // or "grabit-engine" on browser/RN

const managerConfig = {
	source: {
		/* ... */
	},
	tmdbApiKeys: ["your-tmdb-api-key"]
};

// Fire-and-forget: start loading providers now. The first `useSources`/`useManager`
// render will join this same promise instead of starting a fresh load.
acquireManager(managerConfig);
```

> **Reference counting:** every `acquireManager()` registers a consumer and **must** be balanced by a `releaseManager()`, otherwise the singleton is kept alive for the whole process lifetime. For an app-start pre-warm that is usually exactly what you want (hold one reference for the app's lifetime). If you ever need to tear it down explicitly, call `releaseManager()` once. Because it is a singleton, passing `managerConfig` to `acquireManager` and later to `useSources` is safe — the config from the first call wins and subsequent calls reuse the instance.

### `useManager` (low-level)

If you want the manager instance without the scraping state machine (`useScraper`), consume `useManager` directly. It handles the singleton lifecycle (create on first mount, destroy on last unmount) and is StrictMode-safe:

```tsx
import { useManager } from "grabit-engine/react";

function MyComponent() {
	const { manager, isInitializing, initError } = useManager(managerConfig);
	// manager is null until ready; call manager.getStreams(...) yourself.
}
```

| Export             | Signature                                              | Description                                                                     |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `useManager`       | `(config) => { manager, isInitializing, initError }`   | Hook: create/reuse the singleton, destroy on last unmount.                      |
| `acquireManager`   | `(config) => Promise<GrabitManager>`                   | Register a consumer and start creation. Use to pre-warm on app start.           |
| `releaseManager`   | `() => void`                                           | Release one consumer reference. Destroys the singleton when the last releases.  |

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

