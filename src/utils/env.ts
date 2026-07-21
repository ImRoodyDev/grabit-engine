// Environment predicate, kept dependency-free so the error types (HttpError,
// ProcessError) can use it without importing the utils barrel — that import
// chain created a require cycle (types/index -> ProcessError -> standard ->
// types/index). Re-exported from ./standard.ts for backwards compatibility.

/** `true` when `process.env.ENV` is anything other than "production". */
export const isDevelopment = () => typeof process !== "undefined" && process.env?.ENV !== "production";
