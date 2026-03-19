# Bundling Providers

This guide explains how to bundle provider plugins into **standalone single-file JavaScript modules** so they can be fetched from GitHub (or any remote source) and loaded at runtime without dependency issues.

---

## Why bundle?

When the `GithubService` fetches a provider, it downloads a single `index.js` file and loads it via dynamic `import()` in a **temporary directory**. That temp directory has no `node_modules`, no sibling files — nothing. If your `index.js` contains:

```js
import { Provider } from "grabit-engine"; // ❌ can't resolve
import { config } from "./config"; // ❌ file doesn't exist
```

…it will fail. The solution: **bundle everything into one self-contained file** with no npm/package imports at runtime.

---

## How it works

The bundler uses **[esbuild](https://esbuild.github.io/)** to:

1. Take each provider's `index.ts` as the entry point
2. Resolve and inline **all** imports — including:
   - Local files (`./config`, `./stream`, `./subtitle`)
   - The `manifest.json` data
   - Runtime code from `grabit-engine` (`Provider`, `defineProviderModule`, `ProcessError`, etc.)
3. Tree-shake unused code — only what's actually called at runtime makes it in
4. Output a single `index.js` runtime-loadable module with a `default` export

The result is a **fully standalone file** that works in Node.js temp-file loading and in custom browser / React Native `moduleResolver` flows. If a provider explicitly uses `Crypto`, the bundle resolves it at runtime from Node's built-in `crypto`, `react-native-quick-crypto`, or a global polyfill such as `globalThis.__grabitCrypto` / `globalThis.crypto`.

---

## Prerequisites

esbuild must be installed (already added as a devDependency):

```bash
npm install --save-dev esbuild
```

---

## Usage

### Bundle all providers

```bash
npx bundle-provider
```

Finds every directory (and nested subdirectory) under `providers/` that has an `index.ts` and bundles it into the `dist/` folder.

### Bundle a specific provider

```bash
npx bundle-provider my-provider
```

For grouped providers, pass the full relative path:

```bash
npx bundle-provider english/vidsrc
```

### Custom source directory

If your providers live somewhere other than `providers/`:

```bash
npx bundle-provider --src ./my-providers
```

### Custom output folder

By default, bundles are written to `dist/`. To use a different folder name:

```bash
npx bundle-provider --out ./build
```

This produces:

```
build/english/vidsrc/index.js
build/loodvidrsc/index.js
build/manifest.json
```

You can combine `--src` and `--out`:

```bash
npx bundle-provider --src ./my-providers --out ./build
```

### Preview without writing files

```bash
npx bundle-provider --dry-run
```

### Clean up bundled files

```bash
npx bundle-provider --clean
```

Removes all generated `index.js` files from the output directory.

---

## Folder Structure

Providers can be organized flat or grouped inside subdirectories. The bundler **recursively** walks the source directory looking for folders that contain an `index.ts`.

### Flat layout

```
providers/
  vidsrc/
    index.ts, config.ts, stream.ts, subtitle.ts
  loodvidrsc/
    index.ts, config.ts, stream.ts, subtitle.ts
```

Schemes: `vidsrc`, `loodvidrsc`

### Grouped layout (one level of nesting)

```
providers/
  english/
    vidsrc/
      index.ts, config.ts, stream.ts, subtitle.ts
    another/
      index.ts, config.ts, stream.ts, subtitle.ts
  french/
    frsource/
      index.ts, config.ts, stream.ts, subtitle.ts
  loodvidrsc/
    index.ts, config.ts, stream.ts, subtitle.ts
```

Schemes: `english/vidsrc`, `english/another`, `french/frsource`, `loodvidrsc`

The group folder (e.g. `english/`) is just an organizer — it has **no** `index.ts` itself, so the bundler walks into it and finds the actual providers inside.

---

## Output

Bundles are written to the `dist/` folder (or the folder specified with `--out`), preserving the provider structure. The output path for each provider is determined by its `dir` field in `manifest.json`, matching the structure that `GithubService` expects when fetching providers at runtime.

Your source files are never modified.

```
providers/                          ← source (untouched)
  english/vidsrc/
    index.ts, config.ts, stream.ts, subtitle.ts
  loodvidrsc/
    index.ts, config.ts, stream.ts, subtitle.ts

dist/                               ← bundled output
  manifest.json                     ← copied from root
  providers/                        ← from manifest.json "dir" field
    english/vidsrc/
      index.js                      ← ✅ standalone bundle
    loodvidrsc/
      index.js                      ← ✅ standalone bundle
```

The `dist/` folder is what gets committed to Git and fetched by `GithubService`.

When configuring the GitHub source, set `rootDir` to `"dist"`:

```typescript
const manager = await GrabitManager.create({
	source: {
		type: "github",
		url: "https://github.com/your-org/your-providers",
		rootDir: "dist"
	}
});
```

`GithubService` fetches each provider at: `{rootDir}/{manifest.dir}/{scheme}/index.js`
which resolves to e.g. `dist/providers/english/vidsrc/index.js` — exactly matching the bundle output.

---

## What the bundled file looks like

A bundled `index.js` contains:

- An auto-generated header comment
- Inlined code for `Provider.create()`, `defineProviderModule()`, and any utilities they depend on
- Your provider's config, stream logic, and subtitle logic — all merged into one scope
- A `default` export that is the `ProviderModule` object

```
┌─────────────────────────────────────────────────────┐
│  index.js (bundled)                                 │
│                                                     │
│  ┌─ inlined from grabit-engine ──────────┐  │
│  │  Provider class (createResourceURL, etc.)     │  │
│  │  defineProviderModule()                       │  │
│  │  ProcessError, buildRelativePath, ...         │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌─ inlined from your provider ──────────────────┐  │
│  │  config object                                │  │
│  │  getStreams()                                  │  │
│  │  getSubtitles()                               │  │
│  │  manifest entry (from manifest.json)          │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  export default { meta: { name, ... }, workers: { getStreams, ... } }  │
└─────────────────────────────────────────────────────┘
```

---

## Workflow

The typical development workflow:

```
1. Create a provider
   npx create-provider my-provider

2. Implement your logic
   Edit providers/my-provider/config.ts
   Edit providers/my-provider/stream.ts
   Edit providers/my-provider/subtitle.ts

3. Bundle for distribution
   npx bundle-provider my-provider

4. Commit & push to GitHub
   git add dist/ manifest.json
   git push

5. Consumers load it via GithubService
   → fetches dist/my-provider/index.js
   → loads via import() — works because it's standalone
```

---

## Important notes

### Re-bundle after changes

The bundled `index.js` is a **snapshot** of your source files. If you edit `config.ts`, `stream.ts`, or `subtitle.ts`, you **must re-bundle** before pushing:

```bash
npx bundle-provider my-provider
```

### manifest.json is inlined

The `manifest.json` content gets embedded into the bundle at build time. If you update manifest fields (version, priority, etc.), re-bundle the affected providers.

### No external imports at runtime

The bundled file has **zero** `import` statements. Everything is self-contained. This is intentional — it ensures the file works when loaded from:

- GitHub (via `GithubService` → temp file → `import()`)
- Browser environments (via custom `moduleResolver`)
- React Native (via custom `moduleResolver`)

### TypeScript source is for development only

Users author providers in TypeScript for type safety and IDE support. The `.ts` files are **never** executed directly — only the bundled `index.js` runs at runtime.

### Bundle size

Typical bundles are **5–15 KB** depending on provider complexity. The inlined `grabit-engine` utilities add ~3–5 KB (after tree-shaking). This is a reasonable trade-off for full portability.

---

## Troubleshooting

### "esbuild is not installed"

```bash
npm install --save-dev esbuild
```

### "No providers found to bundle"

Make sure:

- The `providers/` directory exists at the project root
- Each provider has an `index.ts` file

### Bundle fails with import errors

If a provider imports something unusual, check:

- All imports from `grabit-engine` should be from the package's public API
- Don't import Node.js built-ins directly in provider code — use `ctx.xhr.fetch` instead of `node-fetch`
- Don't import `cheerio` directly — use `ctx.cheerio.load` from the provider context

### Large bundle size

If a bundle is unexpectedly large:

- Check for unnecessary imports in your provider code
- Run with `--dry-run` to verify which providers are being processed
- esbuild's tree-shaking removes unused code, but explicit imports of heavy modules will be included

---

## CLI Reference

| Flag / Argument                   | Description                                                    |
| --------------------------------- | -------------------------------------------------------------- |
| `npx bundle-provider`             | Bundle all providers into `dist/`                              |
| `npx bundle-provider <scheme>`    | Bundle a specific provider (e.g. `vidsrc` or `english/vidsrc`) |
| `npx bundle-provider --src <dir>` | Custom source directory (default: `providers/`)                |
| `npx bundle-provider --out <dir>` | Custom output folder (default: `dist/`)                        |
| `npx bundle-provider --dry-run`   | Preview without writing                                        |
| `npx bundle-provider --clean`     | Remove all `index.js` bundles from output folder               |

Flags can be combined:

```bash
npx bundle-provider english/vidsrc --src ./my-providers --out ./build --dry-run
```
