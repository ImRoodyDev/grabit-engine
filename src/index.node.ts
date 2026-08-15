/**
 * CJS / Node.js entry point.
 * Re-exports everything from the main barrel except React hooks,
 * which would cause a hard require("react") at module load time.
 * React hooks are available via the "grabit-engine/react" subpath.
 */

// Extension Manager
export * from "./controllers/manager.ts";
export * from "./controllers/provider.ts";

// Service for extension
export * from "./services/unpacker.ts";
// Node-only: the real Node built-in. This entry is never bundled for the browser,
// so the top-level `crypto` import is safe here (the universal barrels use the
// lazy `CryptoUniversal` proxy from `services/crypto.ts` instead).
export { default as Crypto } from "crypto";
export * from "./services/tldts.ts";

// Provider Modules
export * from "./models/provider.ts";

// HTTP hardening (cookie jar, per-host limits, rate-limit).
export { CookieJar } from "./services/httpControls.ts";

// Pluggable challenge solver — host injects one for RN WebView / FlareSolverr.
export { setChallengeSolver } from "./core/solver.ts";

// Types
export * from "./types/index.ts";
export { RequestInfo, RequestInit, Response } from "./services/fetcher.ts";

// Hook types only (no runtime React dependency)
export * from "./types/hooks/useSources.ts";

// Important utilities
export { default as ISO6391 } from "iso-639-1";
export * from "./utils/path.ts";
export * from "./utils/standard.ts";
export * from "./utils/similarity.ts";
export * from "./utils/extractor.ts";

// React Native / browser helpers for the GitHub source
export * from "./utils/native.ts";
