# Code Review: Provider Bundling / Shim Surface

**Date**: 2026-03-20
**Component**: `scripts/bundle-provider.js` + provider-safe runtime modules
**Ready for Production**: Yes (after verifying provider bundles still load in your target runtimes)
**Critical Issues**: 0

## Summary

Provider bundle size inflation was primarily caused by a “barrel” import (`src/types/index.ts`) being pulled into provider bundles through provider-safe modules (notably `src/controllers/provider.ts`, `src/utils/validator.ts`, `src/utils/standard.ts`, `src/utils/similarity.ts`) and by the bundler shim re-exporting too wide a surface.

The barrel exports runtime models for Cheerio/Puppeteer/XHR which transitively reference heavy dependencies and core modules. When those were pulled into the bundler’s dependency graph, esbuild inlined far more code than needed.

## Priority 1 (Must Fix) ⛔

- None.

## Priority 2 (Should Fix) ⚠

- **Over-broad shim exports**: A root-level `import { ... } from "grabit-engine"` previously re-exported `types/index` and other optional modules, making it easy for providers to accidentally include large dependencies.
  - **Fix applied**: shrink the shim export surface while still allowing explicit opt-in via `grabit-engine/...` subpath imports.

## Recommended Changes

- Prefer `import type` when importing types in provider code.
- For provider bundles, avoid importing `tldts` or other optional libs unless needed.
- Keep provider-safe modules free of `src/types/index.ts` barrel imports.

## Changes Applied

- Refactored provider-safe modules to avoid `../types/index.ts`:
  - `src/controllers/provider.ts`
  - `src/utils/validator.ts`
  - `src/utils/standard.ts`
  - `src/utils/similarity.ts`
- Tightened bundler shim exports in `scripts/bundle-provider.js`:
  - Removed `types/index` from the shim surface.
  - Stopped implicitly pulling optional modules like `services/tldts` via the root import.

## Security Notes (OWASP)

- **A03 Injection**: No new dynamic evaluation added. Existing provider loading from GitHub uses user-supplied `moduleResolver` in non-Node runtimes; ensure downstream apps treat provider repos as trusted code.
- **A06 Vulnerable & Outdated Components**: Provider bundles can still inline third-party deps when providers import them. Consider documenting an allowlist policy for provider dependencies.
