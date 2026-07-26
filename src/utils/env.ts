// Environment predicate, kept dependency-free so the error types (HttpError,
// ProcessError) can use it without importing the utils barrel — that import
// chain created a require cycle (types/index -> ProcessError -> standard ->
// types/index). Re-exported from ./standard.ts for backwards compatibility.

/**
 * `true` when the host runtime is in development.
 *
 * Order matters. React Native/Metro define the `__DEV__` global and set it to `false` in
 * release builds, but they also polyfill `process` **without** setting `process.env.ENV`.
 * A bare `process.env.ENV !== "production"` check therefore evaluates to `true` inside a
 * shipped app, which is what made every `logger.debug`/`info` call print in production.
 * `__DEV__` is the only reliable signal there, so it wins when present.
 *
 * Node keeps its previous behaviour — absent env vars still mean development — so server
 * side logging is unchanged. Runtimes that expose neither signal stay quiet.
 */
export const isDevelopment = (): boolean => {
	// const reactNativeDev = (globalThis as { __DEV__?: boolean }).__DEV__;
	// if (typeof reactNativeDev === "boolean") return reactNativeDev;

	if (typeof process !== "undefined") {
		return (process.env?.NODE_ENV ?? process.env?.ENV) !== "production";
	}

	return false;
};
