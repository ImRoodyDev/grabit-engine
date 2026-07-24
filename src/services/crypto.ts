// Node-only crypto re-export.
//
// This module imports the Node built-in `crypto` at the top level, so it is
// reachable ONLY from the Node entry points (`index.node.ts` / the CJS bundle).
// It is deliberately absent from `index.ts` and `index.native.ts`: Webpack 5,
// Vite and Metro do not polyfill Node built-ins, so a browser or React Native
// build that resolved this file would fail to bundle.
//
// React Native / browser consumers get their crypto implementation through
// `setupGrabitGlobals({ crypto })` in `utils/native.ts` instead, which takes the
// implementation as a parameter rather than importing one.
//
// The atob/btoa polyfill that used to live here relied on a bare `require()`,
// which is undefined in ESM — it threw on every load, was swallowed by its own
// try/catch, and warned that `base-64` was missing even when installed. Pass
// `base64` to `setupGrabitGlobals` instead.

import Crypto from "crypto";
export { Crypto };
