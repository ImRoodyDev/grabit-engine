#!/usr/bin/env node

/**
 * Build CJS output using esbuild.
 *
 * ESM-only dependencies (parse-duration, p-limit, yocto-queue) are bundled
 * inline so that the CJS output works with require() in Node.js/Jest without
 * needing the consumer to configure transformIgnorePatterns.
 *
 * All other dependencies are kept external to avoid duplication.
 */

import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

// Collect every dependency name except the ESM-only ones we want to inline.
const ESM_ONLY = new Set(["parse-duration", "p-limit", "yocto-queue", "node-fetch"]);

const external = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.optionalDependencies || {}), ...Object.keys(pkg.peerDependencies || {})].filter(
	(dep) => !ESM_ONLY.has(dep)
);

const shared = {
	bundle: true,
	format: "cjs",
	platform: "node",
	target: "node18",
	external,
	// Readable output for debugging
	minify: false,
	// Preserve original names
	keepNames: true,
	// Source maps for debugging
	sourcemap: false
};

await esbuild.build({
	...shared,
	entryPoints: [path.join(ROOT, "src", "index.node.ts")],
	outfile: path.join(ROOT, "dist", "cjs", "src", "index.js")
});

/**
 * The React hooks are a separate entry point ("grabit-engine/react") because the main
 * CJS bundle deliberately excludes them — importing them there would force a hard
 * require("react") at load time.
 *
 * Their runtime imports of the engine are redirected to the main CJS bundle instead of
 * being inlined: a second inlined copy would carry its own GrabitManager singleton, so
 * require("grabit-engine") and require("grabit-engine/react") would manage different
 * providers and different browser pools.
 */
const shareEngineRuntime = {
	name: "share-engine-runtime",
	setup(build) {
		build.onResolve({ filter: /\.\.\/(controllers\/manager|types\/ProcessError)\.ts$/ }, () => ({
			// Relative to dist/cjs/src/hooks/ → dist/cjs/src/index.js
			path: "../index.js",
			external: true
		}));
	}
};

await esbuild.build({
	...shared,
	entryPoints: [path.join(ROOT, "src", "hooks", "useSources.ts")],
	outfile: path.join(ROOT, "dist", "cjs", "src", "hooks", "useSources.js"),
	plugins: [shareEngineRuntime]
});
