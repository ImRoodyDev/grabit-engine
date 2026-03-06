#!/usr/bin/env node

/**
 * CLI tool to bundle provider plugins into standalone single-file ES modules.
 *
 * Each provider's source files (index.ts, config.ts, stream.ts, subtitle.ts)
 * are bundled into a single self-contained index.js with NO external imports.
 * This ensures the file can be fetched from GitHub and loaded via dynamic
 * import() without any dependency resolution issues.
 *
 * Bundler: esbuild (must be installed as a devDependency)
 *
 * Usage:
 *   npx bundle-provider                             — bundle all providers into dist/
 *   npx bundle-provider <scheme>                    — bundle a specific provider
 *   npx bundle-provider --src ./my-providers        — custom source directory
 *   npx bundle-provider --out ./build               — custom output folder name (default: dist)
 *   npx bundle-provider --clean                     — remove all bundled index.js files
 *   npx bundle-provider --dry-run                   — show what would be bundled without writing
 *
 * Supports nested group folders:
 *   providers/english/vidsrc/index.ts   → resolved as scheme "english/vidsrc"
 *   providers/loodvidrsc/index.ts       → resolved as scheme "loodvidrsc"
 *
 * Output:
 *   <out>/<scheme>/index.js   ← standalone ES module (default export)
 *
 * See scripts/BUNDLING.md for the full guide.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEFAULT_PROVIDERS_DIR = path.join(ROOT, "providers");
const DEFAULT_OUT_DIR = path.join(ROOT, "dist");
const MANIFEST_PATH = path.join(ROOT, "manifest.json");

// ─── Helpers ────────────────────────────────────────────────────────

function info(msg) {
	console.log(`\x1b[36mℹ\x1b[0m ${msg}`);
}

function success(msg) {
	console.log(`\x1b[32m✔\x1b[0m ${msg}`);
}

function warn(msg) {
	console.log(`\x1b[33m⚠\x1b[0m ${msg}`);
}

function error(msg) {
	console.error(`\x1b[31m✖\x1b[0m ${msg}`);
}

function fileSize(filePath) {
	const stats = fs.statSync(filePath);
	const kb = (stats.size / 1024).toFixed(1);
	return `${kb} KB`;
}

// ─── CLI Argument Parsing ───────────────────────────────────────────

function parseArgs() {
	const args = process.argv.slice(2);
	let scheme = null;
	let clean = false;
	let dryRun = false;
	let src = null;
	let out = null;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--clean") clean = true;
		else if (args[i] === "--dry-run") dryRun = true;
		else if (args[i] === "--src" && args[i + 1]) src = args[++i];
		else if (args[i] === "--out" && args[i + 1]) out = args[++i];
		else if (!args[i].startsWith("--")) scheme = args[i];
	}

	return { scheme, clean, dryRun, src, out };
}

// ─── Provider Discovery ────────────────────────────────────────────

/**
 * Resolve the source and output directories from CLI flags.
 */
function resolveDirs(srcFlag, outFlag) {
	const srcDir = srcFlag ? path.resolve(ROOT, srcFlag) : DEFAULT_PROVIDERS_DIR;
	const outDir = outFlag ? path.resolve(ROOT, outFlag) : DEFAULT_OUT_DIR;
	return { srcDir, outDir };
}

/**
 * Load and parse the manifest.json to get provider metadata.
 * Returns a map of scheme → manifest entry, or null if the manifest doesn't exist.
 */
function loadManifest() {
	if (!fs.existsSync(MANIFEST_PATH)) return null;
	const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
	return raw.providers ?? {};
}

/**
 * Recursively find all provider directories that have an index.ts entry point.
 * Supports flat layout (providers/vidsrc) and grouped layout (providers/english/vidsrc).
 * The "scheme" is the relative path from the source root (e.g. "english/vidsrc" or "vidsrc").
 *
 * The output path is built from the provider's `dir` field in manifest.json so the
 * bundle lands exactly where GithubService expects:
 *   {outDir}/{manifest.dir}/{scheme}/index.js
 *
 * Returns an array of { scheme, dir, entry, output } objects.
 */
function discoverProviders(srcDir, outDir, filterScheme) {
	if (!fs.existsSync(srcDir)) {
		error(`Providers directory not found: ${srcDir}`);
		error('Run "npx create-provider <scheme>" to create your first provider.');
		process.exit(1);
	}

	const manifest = loadManifest();
	const providers = [];

	// Recursive walker — walks into subdirectories looking for index.ts
	function walk(dir, relativePath) {
		const entries = fs.readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const childDir = path.join(dir, entry.name);
			const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
			const entryFile = path.join(childDir, "index.ts");

			if (fs.existsSync(entryFile)) {
				// This directory is a provider (has index.ts)
				if (filterScheme && childRelative !== filterScheme && entry.name !== filterScheme) continue;

				// Use the manifest's `dir` field so the output matches what
				// GithubService fetches: {rootDir}/{dir}/{scheme}/index.js
				const manifestDir = manifest?.[childRelative]?.dir ?? "";
				const outputDir = path.join(outDir, manifestDir, childRelative);

				providers.push({
					scheme: childRelative,
					dir: childDir,
					entry: entryFile,
					output: path.join(outputDir, "index.js")
				});
			} else {
				// No index.ts here — this might be a group folder, walk deeper
				walk(childDir, childRelative);
			}
		}
	}

	walk(srcDir, "");

	if (filterScheme && providers.length === 0) {
		error(`Provider "${filterScheme}" not found or has no index.ts entry point.`);
		process.exit(1);
	}

	return providers;
}

// ─── Clean ──────────────────────────────────────────────────────────

function cleanBundles(providers) {
	let cleaned = 0;
	for (const p of providers) {
		if (fs.existsSync(p.output)) {
			fs.unlinkSync(p.output);
			// Also remove .js.map if present
			const mapFile = p.output + ".map";
			if (fs.existsSync(mapFile)) fs.unlinkSync(mapFile);
			success(`Removed ${path.relative(ROOT, p.output)}`);
			cleaned++;
		}
	}
	if (cleaned === 0) info("Nothing to clean.");
	else success(`Cleaned ${cleaned} bundle(s).`);
}

// ─── Bundle ─────────────────────────────────────────────────────────

async function bundleProviders(providers, dryRun, outDir) {
	// Lazy-import esbuild so the error message is clear if not installed
	let esbuild;
	try {
		esbuild = await import("esbuild");
	} catch {
		error('esbuild is not installed. Run "npm install --save-dev esbuild" first.');
		process.exit(1);
	}

	// Validate manifest exists (providers import it)
	if (!fs.existsSync(MANIFEST_PATH)) {
		warn("manifest.json not found — providers that import it will fail to bundle.");
	}

	info(`Bundling ${providers.length} provider(s)...\n`);

	let succeeded = 0;
	let failed = 0;

	for (const provider of providers) {
		const relEntry = path.relative(ROOT, provider.entry);
		const relOutput = path.relative(ROOT, provider.output);

		if (dryRun) {
			info(`[dry-run] Would bundle: ${relEntry} → ${relOutput}`);
			succeeded++;
			continue;
		}

		// Ensure output directory exists (needed when --out is used)
		const outputDir = path.dirname(provider.output);
		if (!fs.existsSync(outputDir)) {
			fs.mkdirSync(outputDir, { recursive: true });
		}

		try {
			const result = await esbuild.build({
				entryPoints: [provider.entry],
				outfile: provider.output,
				bundle: true,
				format: "esm",
				platform: "node",
				target: "esnext",
				treeShaking: true,
				minifySyntax: false,
				minifyWhitespace: false,
				minifyIdentifiers: false,

				// Mark all node_modules packages as external EXCEPT grabit-engine.
				// Providers only need lightweight grabit-engine utilities (Provider class,
				// defineProviderModule, ProcessError, path utils) which get inlined.
				// Heavy deps (cheerio, puppeteer, undici, etc.) are provided at runtime
				// through the provider context (ctx) and must NOT be bundled.
				plugins: [
					{
						name: "externalize-deps",
						setup(build) {
							// Externalize any bare import that isn't grabit-engine or a relative/absolute path
							build.onResolve({ filter: /^[^./]/ }, (args) => {
								// Don't externalize entry points or absolute paths (Windows drive letters)
								if (args.kind === "entry-point" || /^[a-zA-Z]:/.test(args.path)) {
									return null;
								}
								if (args.path === "grabit-engine" || args.path.startsWith("grabit-engine/")) {
									return null; // let esbuild resolve & inline grabit-engine
								}
								return { path: args.path, external: true };
							});
						}
					}
				],

				// Handle JSON imports (manifest.json)
				loader: {
					".json": "json"
				},

				// Banner to mark the file as auto-generated
				banner: {
					js: [
						"// ╔══════════════════════════════════════════════════════════════╗",
						`// ║  AUTO-GENERATED — Do not edit manually                      ║`,
						`// ║  Provider: ${provider.scheme.padEnd(48)}║`,
						`// ║  Bundled with esbuild — npx bundle-provider                 ║`,
						"// ╚══════════════════════════════════════════════════════════════╝",
						""
					].join("\n")
				},

				// Write output
				write: true,

				// Log level
				logLevel: "warning"
			});

			if (result.warnings.length > 0) {
				for (const w of result.warnings) {
					warn(`  ${provider.scheme}: ${w.text}`);
				}
			}

			const size = fileSize(provider.output);
			success(`${relEntry} → ${relOutput} (${size})`);
			succeeded++;
		} catch (err) {
			error(`Failed to bundle "${provider.scheme}": ${err.message}`);
			failed++;
		}
	}

	// Summary
	console.log();
	if (failed === 0) {
		success(`All ${succeeded} provider(s) bundled successfully.`);
	} else {
		warn(`${succeeded} succeeded, ${failed} failed.`);
		process.exit(1);
	}
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
	const { scheme, clean, dryRun, src, out } = parseArgs();
	const { srcDir, outDir } = resolveDirs(src, out);
	const providers = discoverProviders(srcDir, outDir, scheme);

	// Log resolved directories
	info(`Source: ${path.relative(ROOT, srcDir) || "."}`);
	info(`Output: ${path.relative(ROOT, outDir)}`);
	console.log();

	if (clean) {
		cleanBundles(providers);
		return;
	}

	if (providers.length === 0) {
		info("No providers found to bundle.");
		info("Create one first: npx create-provider <scheme>");
		return;
	}

	await bundleProviders(providers, dryRun, outDir);

	// Copy manifest.json into the output directory so remote consumers
	// (e.g. GitHub source with rootDir) can find it alongside the bundles.
	if (fs.existsSync(MANIFEST_PATH)) {
		const destManifest = path.join(outDir, "manifest.json");
		if (dryRun) {
			info(`[dry-run] Would copy: manifest.json → ${path.relative(ROOT, destManifest)}`);
		} else {
			if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
			fs.copyFileSync(MANIFEST_PATH, destManifest);
			success(`Copied manifest.json → ${path.relative(ROOT, destManifest)}`);
		}
	} else {
		warn("manifest.json not found — skipping copy to output directory.");
	}
}

main().catch((err) => {
	error(err.message);
	process.exit(1);
});
