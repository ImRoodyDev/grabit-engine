# 🔗 Provider Sources

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
const manager = await GrabitManager.create({
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
const manager = await GrabitManager.create({
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

const manager = await GrabitManager.create({
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

