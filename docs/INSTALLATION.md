# 📦 Installation

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

React Native versions below 0.74 do not expose `atob` / `btoa` as globals. Pass the `base-64` package to `setupGrabitGlobals` and the library installs them for you:

```ts
import base64 from "base-64";

setupGrabitGlobals({ base64 });
```

On Node.js and modern browsers the built-in `atob` / `btoa` are used and no extra package is needed.

</details>

<details>
<summary><strong>Optional: crypto polyfill (React Native)</strong></summary>

```bash
npm install react-native-quick-crypto
```

If your providers use `Crypto` and you load them in React Native, install `react-native-quick-crypto`. GitHub-loaded provider bundles look for crypto in this order: `globalThis.__grabitCrypto`, `globalThis.Crypto`, `globalThis.crypto`, `require("react-native-quick-crypto")`, `require("crypto")`. Since bundles are evaluated with the `Function` constructor they have no `require`, so in React Native the global path is the only one that works — use [`setupGrabitGlobals`](#react-native--expo-setup) to register it.

</details>

<br />

### React Native / Expo setup

React Native has no dynamic `import()` from a string and no Node built-ins, so the `github` source needs two pieces of glue. The engine ships both, so you don't have to write them by hand:

- **`moduleResolver`** — evaluates a fetched provider bundle into a module. Pass it to the `github` source.
- **`setupGrabitGlobals`** — registers the globals bundled providers read at runtime (`crypto`, `Buffer`, and `atob`/`btoa`), and reports what the runtime supports.

```bash
npm install react-native-quick-crypto @craftzdog/react-native-buffer base-64
```

```tsx
import { GrabitManager, moduleResolver, setupGrabitGlobals } from "grabit-engine";
import QuickCrypto from "react-native-quick-crypto";
import { Buffer } from "@craftzdog/react-native-buffer";
import base64 from "base-64";

// Call once, before creating a manager. Existing globals are never overwritten.
const report = setupGrabitGlobals({ crypto: QuickCrypto, buffer: Buffer, base64 });
if (!report.functionConstructor) {
	// The runtime cannot evaluate provider bundles (eval-restricted engine).
}

const manager = await GrabitManager.create({
	source: { type: "github", url: "owner/repo", branch: "main", rootDir: "dist", moduleResolver },
	tmdbApiKeys: [KEY],
});
```

`setupGrabitGlobals` returns `{ crypto, buffer, atob, functionConstructor, errors }` — a boolean readout plus any assignment errors, useful for an on-device diagnostics panel. All three options are optional; omit them if your providers don't use them. `base64` is only needed on React Native < 0.74, which has no global `atob`/`btoa`. You must also alias `crypto` in `metro.config.js` for `react-native-quick-crypto`'s own imports — see its setup docs.

---

