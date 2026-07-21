# grabit-engine — Expo isolation demo

Minimal Expo app that validates `grabit-engine` in a clean environment. The
package is **linked from source** (`"grabit-engine": "file:.."`), so editing the
package's `src/` is reflected on the next reload — no rebuild, no repack.

Runs on phone, tablet and desktop-sized screens from one codebase, on stock
React Native. It also runs on Android TV (which is just Android), but without
the `react-native-tvos` fork there is no dedicated TV build target — see
"TV notes" below.

## Setup

```bash
cd demo
npm install
```

`.env` already holds `EXPO_PUBLIC_TMDB_API_KEYS`. It is gitignored.

## How the package is linked

`file:..` symlinks `node_modules/grabit-engine` to the repo root. Two consumers
read that link, both live from `src/` — the built `dist/` is not used by the demo:

- **Metro** resolves `grabit-engine` via the `react-native` export condition to
  `src/index.native.ts`. `metro.config.js` adds the package `src` and its
  `node_modules` to `watchFolders`/`nodeModulesPaths` so the source and its
  dependencies (cheerio, tldts, …) resolve. There is no duplicate-React risk —
  `react`/`react-native` exist only in the demo.
- **TypeScript** follows the same condition into the source, so `tsconfig.json`
  sets `allowImportingTsExtensions: true` (the package's declarations use `.ts`
  specifiers). `@types/node` is picked up from the package's own `node_modules`.

## Run

`react-native-quick-crypto` is a native Nitro module, so **Expo Go will not work**.
A development build is required:

```bash
npm run prebuild
npm run android          # or: npm run ios  (macOS only)
```

## TV notes

This project uses **stock react-native**, not `react-native-tvos`.

Android TV is still Android, so `npm run android` installs and runs on an Android
TV device, and `Platform.isTV` (present in stock RN on both platforms) still
drives the TV breakpoint below.

What stock RN does not give you:

- No Leanback launcher entry — the app installs but will not show up as a TV app
  in the Android TV home screen without a `LEANBACK_LAUNCHER` intent filter.
- No Apple TV / tvOS target at all.
- Remote D-pad focus relies on plain Android focus rather than the fork's TV
  focus engine, so `hasTVPreferredFocus` may be ignored.

If a real TV build target is needed later, reinstate
`react-native@npm:react-native-tvos@0.86-stable` plus
`@react-native-tvos/config-tv` and prebuild with `EXPO_TV=1`.

## Responsive layout

`src/useResponsive.ts` derives layout from `useWindowDimensions`, so it reacts to
rotation, split-screen and TV resolutions instead of assuming a phone.

| Breakpoint | Trigger | Columns | Type scale |
|---|---|---|---|
| phone | < 768 | 1 | 1.0 |
| tablet | ≥ 768 | 2 | 1.0 |
| desktop | ≥ 1280 | 3 | 1.1 |
| tv | `Platform.isTV` | 2 | 1.45 |

TV is deliberately not treated as "just a big desktop": it uses fewer columns and
much larger type because the viewer is metres away, and content is capped at
`maxContentWidth` so lines stay readable on a 16:9 panel.

Focus is handled for remote navigation — `FocusButton` and `SourceRow` render an
explicit focus ring, and the Scrape button takes `hasTVPreferredFocus`.

## How it uses the package

The `github` source glue now lives **in `grabit-engine` itself**, so the demo just
imports it:

- `moduleResolver` — passed to the `github` source (`src/config.ts`).
- `setupGrabitGlobals({ crypto, buffer })` — registers the runtime globals
  provider bundles need. The demo wraps it in `src/globals.ts`, passing
  `react-native-quick-crypto` and `@craftzdog/react-native-buffer`, and adds
  engine detection for the diagnostics panel.

| Piece | Reason |
|---|---|
| `metro.config.js` → `crypto` alias | The only Node builtin the package imports directly (`src/services/crypto.ts`). |
| `metro.config.js` → `stream`, `buffer` | Needed by `react-native-quick-crypto`, not by `grabit-engine`. |
| `src/globals.ts` → `setupGrabitGlobals` | Provider bundles run through `new Function`, so they have no `require`; the Metro alias can't reach them. The engine reads `globalThis.__grabitCrypto` and a global `Buffer`, which this registers. |

No hand-written shim files (`crypto.js`, `buffer.js`, …) are used anywhere.

## UI

`App.tsx` is a two-pane layout on landscape (request form + results side by side)
and stacks on phones. The form (`src/components/ScrapeForm.tsx`) is pre-filled with
Inception (movie, tmdbId 27205) so a first tap works, and supports movie/series with
optional title, year, and per-episode fields. Design tokens live in `src/theme.ts`.

## Known limitation

Provider bundles are evaluated at runtime via the `Function` constructor. Hermes
(Expo's default and, since RN 0.81, the only first-party engine) documents local
`eval` as unsupported. The `Function` constructor does not capture lexical scope
and is expected to work, but this is unverified on-device.
