#!/usr/bin/env node

/**
 * Post-build script: places package.json markers inside dist/esm and dist/cjs
 * so Node.js treats .js files with the correct module system.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");

const markers = [
	{ dir: path.join(distDir, "esm"), type: "module" },
	{ dir: path.join(distDir, "cjs"), type: "commonjs" }
];

for (const { dir, type } of markers) {
	if (fs.existsSync(dir)) {
		fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type }, null, 2) + "\n");
	}
}
