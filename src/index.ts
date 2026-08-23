// Extension Manager
export * from "./controllers/manager.ts";
export * from "./controllers/provider.ts";

// Service for extension.
// The browser / React-Native-safe `Crypto` accessor resolves the implementation
// lazily from a host-provided global (`setupGrabitGlobals`) and never references a
// Node built-in at the top level. Node consumers get the real Node `crypto` via the
// `node` export condition (`index.node.ts`).
export { CryptoUniversal as Crypto } from "./services/crypto.ts";
export * from "./services/unpacker.ts";
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

// React hooks (optional — requires React as a peer dependency)
export { useSources } from "./hooks/useSources.ts";
// Manager lifecycle primitives — for pre-warming the singleton on app start
// (`acquireManager`/`releaseManager`) or building a custom hook (`useManager`).
export { useManager, acquireManager, releaseManager } from "./hooks/useManager.ts";
export * from "./types/hooks/useSources.ts";

// Important utilities
export { default as ISO6391 } from "iso-639-1";
export * from "./utils/path.ts";
export * from "./utils/standard.ts";
export * from "./utils/similarity.ts";
export * from "./utils/extractor.ts";

// React Native / browser helpers for the GitHub source
export * from "./utils/native.ts";
