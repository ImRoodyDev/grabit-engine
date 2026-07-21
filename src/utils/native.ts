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
}

/** Result of {@link setupGrabitGlobals} — a readout of what is available. */
export interface GrabitGlobalsReport {
	/** `globalThis.__grabitCrypto` is set. */
	crypto: boolean;
	/** `globalThis.Buffer` is set. */
	buffer: boolean;
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
 *
 * const report = setupGrabitGlobals({ crypto: QuickCrypto, buffer: Buffer });
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

	let functionConstructor = false;
	try {
		functionConstructor = (new Function("a", "return a + 1;") as (a: number) => number)(1) === 2;
	} catch (error) {
		errors.push(`Function: ${error instanceof Error ? error.message : String(error)}`);
	}

	return {
		crypto,
		buffer,
		atob: typeof (globalThis as { atob?: unknown }).atob === "function",
		functionConstructor,
		errors
	};
}
