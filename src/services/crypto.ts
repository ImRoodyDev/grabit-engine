// // crypto-wrapper.ts
// import { isNode } from "../utils/standard";
// let crypto: typeof import("crypto");
// if (isNode() && navigator.product !== "ReactNative") {
// 	// Node.js
// 	crypto = require("crypto");
// } else {
// 	// React Native
// 	try {
// 		crypto = require("react-native-quick-crypto") as typeof import("crypto");
// 	} catch {
// 		throw new Error("Crypto library not found for React Native. Install react-native-quick-crypto");
// 	}
// }
// export default crypto;

import Crypto from "crypto";
import { Logger } from "../utils/logger.ts";

export { Crypto };

// Polyfill atob / btoa for environments that don't provide them globally
// (e.g. React Native < 0.74).
// The `base-64` package is an optional peer dependency; install it when
// targeting React Native:
//
//   npm install base-64
//   # or
//   yarn add base-64
//
if (typeof globalThis.atob === "undefined" || typeof globalThis.btoa === "undefined") {
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const base64 = require("base-64") as { encode: (s: string) => string; decode: (s: string) => string };
		if (typeof globalThis.btoa === "undefined") {
			(globalThis as typeof globalThis & { btoa: (s: string) => string }).btoa = base64.encode;
		}
		if (typeof globalThis.atob === "undefined") {
			(globalThis as typeof globalThis & { atob: (s: string) => string }).atob = base64.decode;
		}
	} catch {
		// `base-64` is not installed — atob/btoa will remain unavailable.
		// Install the optional peer dependency `base-64` if you need this polyfill.
		Logger.warn("base-64 package not found. atob/btoa functions will not be available in this environment. Install base-64 for support.");
	}
}
