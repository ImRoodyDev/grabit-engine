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

await esbuild.build({
	entryPoints: [path.join(ROOT, "src", "index.node.ts")],
	bundle: true,
	format: "cjs",
	platform: "node",
	target: "node18",
	outfile: path.join(ROOT, "dist", "cjs", "src", "index.js"),
	external,
	// Readable output for debugging
	minify: false,
	// Preserve original names
	keepNames: true,
	// Source maps for debugging
	sourcemap: false
});
