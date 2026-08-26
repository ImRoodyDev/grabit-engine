# 📝 Examples

<details>
<summary><strong>React Native with GitHub source</strong></summary>

```typescript
import { GrabitManager, moduleResolver, setupGrabitGlobals } from "grabit-engine";
import QuickCrypto from "react-native-quick-crypto";
import { Buffer } from "@craftzdog/react-native-buffer";
import base64 from "base-64";

// Register crypto/Buffer/base64 (and any provider env) before creating the manager.
setupGrabitGlobals({
	crypto: QuickCrypto,
	buffer: Buffer,
	base64,
	// Keys providers read from globalThis.__grabitEnv; EXPO_PUBLIC_* so Metro inlines it.
	env: { WYZIE_SUBS_KEYS: process.env.EXPO_PUBLIC_WYZIE_SUBS_KEYS },
});

const manager = await GrabitManager.create({
	source: {
		type: "github",
		url: "your-org/providers-repo",
		branch: "main",
		rootDir: "dist", // optional
		moduleResolver // shipped by grabit-engine — no need to hand-write it
	},
	tmdbApiKeys: ["your-tmdb-api-key"],
	scrapeConfig: {
		concurrentOperations: 3,
		successQuorum: 2,
		operationTimeout: 15000,
		puppeteer: {
			maxConcurrentBrowsers: 2,
			minWarmBrowsers: 1,
			idleBrowserTTL: 60000
		}
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
import { GrabitManager } from "grabit-engine";
import manifest from "./providers/manifest.json";

const manager = await GrabitManager.create({
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

