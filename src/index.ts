// Extension Manager
export * from "./controllers/manager.ts";
export * from "./controllers/provider.ts";

// Service for extension.
// `services/crypto.ts` is intentionally NOT re-exported here: it imports the Node
// built-in `crypto`, which browser bundlers do not polyfill. It is available from
// the Node entry point (`index.node.ts`); browsers and React Native supply their own
// implementation through `setupGrabitGlobals`.
export * from "./services/unpacker.ts";
export * from "./services/tldts.ts";

// Provider Modules
export * from "./models/provider.ts";

// Types
export * from "./types/index.ts";
export { RequestInfo, RequestInit, Response } from "./services/fetcher.ts";

// React hooks (optional — requires React as a peer dependency)
export { useSources } from "./hooks/useSources.ts";
export * from "./types/hooks/useSources.ts";

// Important utilities
export { default as ISO6391 } from "iso-639-1";
export * from "./utils/path.ts";
export * from "./utils/standard.ts";
export * from "./utils/similarity.ts";
export * from "./utils/extractor.ts";

// React Native / browser helpers for the GitHub source
export * from "./utils/native.ts";
