// React Native / browser helpers for loading GitHub-sourced providers.
//
// Outside Node there is no dynamic `import()` from a string and no built-in
// `crypto`, so consumers previously had to hand-write two pieces of glue:
//
//   1. a `moduleResolver` that turns fetched bundle source into a module, and
//   2. registration of the globals bundled providers read at runtime
//      (`globalThis.__grabitCrypto` and a global `Buffer`).
//
// Both are provided here so the setup is identical across apps. Nothing in this
// file imports `crypto`, `react-native-quick-crypto`, or `buffer`: those stay
// optional peer dependencies, and the implementations are passed in by the
// caller (see `setupGrabitGlobals`). That keeps this module safe to include in
// the Metro graph.

import type { ProviderModule } from "../types/models/Modules.ts";

/**
 * Default `moduleResolver` for the `github` source in React Native and browsers.
 *
 * Evaluates a fetched provider bundle into a {@link ProviderModule}. Uses the
 * `Function` constructor rather than a local `eval` — Hermes (React Native's
 * engine) supports the former (it captures no lexical scope) but documents local
 * `eval` as unsupported.
 *
 * Failures are re-thrown with the provider scheme attached; otherwise a broken
 * bundle surfaces later as a bare "Cannot read property 'default' of undefined"
 * with nothing pointing at the culprit.
 *
 * @example
 * ```ts
 * import { GrabitManager, moduleResolver } from "grabit-engine";
 *
 * const manager = await GrabitManager.create({
 *   source: { type: "github", url: "owner/repo", branch: "main", moduleResolver },
 *   tmdbApiKeys: [KEY],
 * });
 * ```
 */
export async function moduleResolver(scheme: string, sourceCode: string): Promise<ProviderModule> {
	const exports: Record<string, unknown> = {};
	const module = { exports };

	try {
		new Function("module", "exports", sourceCode)(module, exports);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`[${scheme}] provider bundle failed to evaluate: ${message}`);
	}

	const resolved = (module.exports as { default?: unknown })?.default ?? module.exports;

	if (!resolved || typeof resolved !== "object") {
		throw new Error(`[${scheme}] provider bundle produced no module export (got ${typeof resolved})`);
	}

	return resolved as ProviderModule;
}

/** Implementations to expose to provider bundles. Both are optional. */
export interface GrabitGlobalsOptions {
	/**
	 * Crypto implementation, exposed as `globalThis.__grabitCrypto`.
	 * In React Native pass `require("react-native-quick-crypto")`.
	 * Providers that never use crypto can omit this.
	 */
	crypto?: unknown;
	/**
	 * Buffer implementation, exposed as `globalThis.Buffer`.
	 * In React Native pass `require("@craftzdog/react-native-buffer").Buffer`.
	 * Bundled providers reference `Buffer` as a bare global with no fallback,
	 * and React Native has no global `Buffer`, so this is required for any
	 * provider that decodes binary data.
	 */
	buffer?: unknown;
	/**
	 * base64 codec used to polyfill `globalThis.btoa` / `globalThis.atob` on
	 * runtimes that lack them (React Native < 0.74). Pass `require("base-64")`.
	 * Ignored when the runtime already provides both.
	 */
	base64?: { encode: (s: string) => string; decode: (s: string) => string };
	/**
	 * Environment values for provider bundles, exposed as `globalThis.__grabitEnv`.
	 *
	 * Provider bundles are fetched and evaluated with `new Function` outside the
	 * Metro/Babel graph, so `process.env` is never inlined and stays empty at
	 * runtime on React Native. Providers that need a secret (e.g. an API key) read
	 * it from `globalThis.__grabitEnv` instead, and this is how the host app
	 * supplies it. On React Native the values must come from your app's own source
	 * so Metro inlines them — use an `EXPO_PUBLIC_`-prefixed var:
	 *
	 * ```ts
	 * setupGrabitGlobals({ env: { WYZIE_SUBS_KEYS: process.env.EXPO_PUBLIC_WYZIE_SUBS_KEYS } });
	 * ```
	 *
	 * Note: anything shipped to a client is readable by users — never put a secret
	 * here that must stay private; proxy those through a backend instead. Unlike the
	 * other globals, provided keys are merged into any existing `__grabitEnv` (the
	 * host app is the authority for env), so repeated calls accumulate.
	 */
	env?: Record<string, string | undefined>;
}

/** Result of {@link setupGrabitGlobals} — a readout of what is available. */
export interface GrabitGlobalsReport {
	/** `globalThis.__grabitCrypto` is set. */
	crypto: boolean;
	/** `globalThis.Buffer` is set. */
	buffer: boolean;
	/** `globalThis.__grabitEnv` is set (an `env` bag was provided or already existed). */
	env: boolean;
	/** `atob` exists globally (needed to decode base64; RN >= 0.74 provides it). */
	atob: boolean;
	/** The `Function` constructor works — the whole GitHub-source model needs it. */
	functionConstructor: boolean;
	/** Assignment failures, one string per failed global. */
	errors: string[];
}

/**
 * Registers the globals that GitHub provider bundles expect, and reports what
 * the current runtime supports. Call once, before creating a manager with the
 * `github` source. Existing globals are never overwritten.
 *
 * @example
 * ```ts
 * import { setupGrabitGlobals } from "grabit-engine";
 * import QuickCrypto from "react-native-quick-crypto";
 * import { Buffer } from "@craftzdog/react-native-buffer";
 * import base64 from "base-64";
 *
 * const report = setupGrabitGlobals({
 *   crypto: QuickCrypto,
 *   buffer: Buffer,
 *   base64,
 *   // Values providers read from globalThis.__grabitEnv (process.env is empty in bundles).
 *   env: { WYZIE_SUBS_KEYS: process.env.EXPO_PUBLIC_WYZIE_SUBS_KEYS },
 * });
 * if (!report.functionConstructor) {
 *   // Runtime cannot evaluate provider bundles (e.g. eval-restricted engine).
 * }
 * ```
 */
export function setupGrabitGlobals(options: GrabitGlobalsOptions = {}): GrabitGlobalsReport {
	const errors: string[] = [];
	const target = globalThis as Record<string, unknown>;

	const assign = (name: string, value: unknown): boolean => {
		// Nothing to install: report whether the runtime already provides it.
		if (value === undefined) return typeof target[name] !== "undefined";
		try {
			if (typeof target[name] === "undefined") target[name] = value;
			return true;
		} catch (error) {
			// Surfaced rather than swallowed: a silent failure here looks like a
			// provider bug much later, at decrypt time.
			errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
			return false;
		}
	};

	const crypto = assign("__grabitCrypto", options.crypto);
	const buffer = assign("Buffer", options.buffer);

	// Env is a value bag the host builds up, not a one-shot polyfill: merge
	// provided keys onto any existing __grabitEnv rather than assign-once.
	if (options.env) {
		try {
			const existing = (target.__grabitEnv as Record<string, string | undefined>) ?? {};
			target.__grabitEnv = { ...existing, ...options.env };
		} catch (error) {
			errors.push(`__grabitEnv: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const env = typeof target.__grabitEnv !== "undefined";

	// Providers decode base64 payloads; RN < 0.74 ships neither btoa nor atob.
	if (options.base64) {
		assign("btoa", options.base64.encode);
		assign("atob", options.base64.decode);
	}

	let functionConstructor = false;
	try {
		functionConstructor = (new Function("a", "return a + 1;") as (a: number) => number)(1) === 2;
	} catch (error) {
		errors.push(`Function: ${error instanceof Error ? error.message : String(error)}`);
	}

	return {
		crypto,
		buffer,
		env,
		atob: typeof (globalThis as { atob?: unknown }).atob === "function",
		functionConstructor,
		errors
	};
}
