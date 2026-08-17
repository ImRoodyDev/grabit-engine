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

