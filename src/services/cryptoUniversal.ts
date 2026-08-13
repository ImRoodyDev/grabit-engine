// Environment-agnostic `Crypto` accessor (browser / React Native safe).
//
// Unlike `./crypto.ts` — which statically `import`s the Node built-in `crypto` and
// is therefore reachable only from the Node entry points — this module never
// references a Node built-in at the top level, so it is safe to include in the
// universal (`index.ts`) and React Native (`index.native.ts`) barrels: Webpack,
// Vite and Metro will not try to bundle a Node built-in from here.
//
// It resolves an implementation lazily, on property access, from a host-provided
// global (in priority order):
//   1. `globalThis.__grabitCrypto` — set via `setupGrabitGlobals({ crypto })`
//   2. `globalThis.crypto` / `globalThis.Crypto` — only if it exposes a Node-style
//      API (i.e. has `createHash`); the Web Crypto `globalThis.crypto` is skipped.
//
// Node consumers never reach this file: package `exports` resolve the `node`
// condition to `index.node.*`, which re-exports the real Node `crypto`.

/** Finds a Node-compatible crypto implementation on the global object, if any. */
function resolveCryptoImpl(): any {
	const g = globalThis as any;
	const candidates = [g.__grabitCrypto, g.crypto, g.Crypto];
	for (const candidate of candidates) {
		if (candidate && typeof candidate.createHash === "function") {
			return candidate;
		}
	}
	return undefined;
}

const MISSING_MESSAGE =
	"Crypto is not available in this runtime. In React Native / the browser, install a " +
	"Node-compatible crypto (e.g. react-native-quick-crypto) and expose it via " +
	"setupGrabitGlobals({ crypto }) — or set globalThis.__grabitCrypto / globalThis.crypto — " +
	"before using Crypto.";

/**
 * `Crypto` — a lazy proxy over the resolved crypto implementation.
 *
 * Property access (`Crypto.createHash(...)`, `Crypto.pbkdf2Sync(...)`,
 * `Crypto.createDecipheriv(...)`, …) resolves the host implementation on first use,
 * so it works even when the host installs its crypto after this module is imported.
 * Typed as `any` so consumers are not forced to depend on `@types/node`.
 */
export const Crypto: any = new Proxy(
	{},
	{
		get(_target, property) {
			const impl = resolveCryptoImpl();
			if (!impl) {
				throw new Error(MISSING_MESSAGE);
			}
			const value = impl[property as keyof typeof impl];
			return typeof value === "function" ? value.bind(impl) : value;
		},
		has(_target, property) {
			const impl = resolveCryptoImpl();
			return impl ? property in impl : false;
		},
	},
);
