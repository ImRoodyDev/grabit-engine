#!/usr/bin/env node

/**
 * CLI tool to bundle provider plugins into standalone single-file JS modules.
 *
 * Each provider's source files (index.ts, config.ts, stream.ts, subtitle.ts)
 * are bundled into a single self-contained index.js with NO npm/package imports.
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
 *   <out>/<scheme>/index.js   ← standalone runtime-loadable module (default export)
 *
 * See scripts/BUNDLING.md for the full guide.
 */

import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

const ROOT = process.cwd();
const DEFAULT_PROVIDERS_DIR = path.join(ROOT, "providers");
const DEFAULT_OUT_DIR = path.join(ROOT, "dist");
const MANIFEST_PATH = path.join(ROOT, "manifest.json");
const PROVIDER_SHIM_PATH = "grabit-engine-provider-shim";
const PROVIDER_CRYPTO_SHIM_PATH = "grabit-engine-provider-crypto-shim";

// ─── Node.js Built-ins ──────────────────────────────────────────────

/** Set of Node.js core module names (e.g. "fs", "crypto", "path"). */
const NODE_BUILTINS = new Set(builtinModules.filter((m) => !m.startsWith("_")));

/** Check whether a bare import specifier is a Node.js built-in. */
function isNodeBuiltin(specifier) {
	if (specifier.startsWith("node:")) return true;
	return NODE_BUILTINS.has(specifier.split("/")[0]);
}

// ─── Context-Provided Packages ──────────────────────────────────────

/**
 * Packages that the runtime `ProviderContext` already injects.
 * Providers must NOT import these directly — they will not be available
 * when the bundle is loaded from a temp directory.
 *
 * Map: package name → guidance message showing the correct ctx usage.
 */
const CONTEXT_PROVIDED = new Map([
	["cheerio", "ctx.cheerio.$load(html) or ctx.cheerio.load(url, requester, ctx.xhr)"],
	["puppeteer", "ctx.puppeteer.launch(url, options)"],
	["puppeteer-real-browser", "ctx.puppeteer.launch(url, options)"],
	["impit", "ctx.xhr.fetch(url, options, requester) — Impit is used internally"],
	["undici", "ctx.xhr.fetch(url, options, requester)"],
	["node-fetch", "ctx.xhr.fetch(url, options, requester)"]
]);

/** Extract the npm package name from a bare import specifier. */
function packageName(specifier) {
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

// ─── Provider-Safe Modules ──────────────────────────────────────────

/**
 * Modules from grabit-engine that are safe to include in provider bundles.
 * These depend only on lightweight utilities, types, and Node.js built-ins.
 *
 * Heavy modules are intentionally EXCLUDED to prevent cheerio, impit,
 * puppeteer and react from leaking into the bundle:
 *   controllers/manager, core/*, services/fetcher, services/github,
 *   services/registry, services/cache, hooks/*
 *
 * services/crypto is handled separately through a virtual shim so providers
 * can keep importing { Crypto } from "grabit-engine" without pulling the
 * service's atob/btoa polyfill side-effects into every bundle.
 */
/**
 * Subpath imports that are allowed inside provider bundles.
 *
 * IMPORTANT: keep this list tight.
 * Anything included here can end up bundled into remote GitHub-loaded providers.
 */
const PROVIDER_SAFE_MODULES = [
	"controllers/provider",
	"models/provider",
	"services/unpacker",

	// Intentionally NOT re-exported from the main shim — providers must opt-in
	// via `import { tldts } from \"grabit-engine/services/tldts\"`.
	"services/tldts",

	// Safe standalone runtime errors + (mostly) type-only modules
	"types/HttpError",
	"types/ProcessError",
	"types/input/Media",
	"types/input/Requester",
	"types/output/MediaSources",
	"types/models/Modules",
	"types/models/Provider",
	"types/models/Context",
	"types/models/Manager",

	"utils/path",
	"utils/standard",
	"utils/similarity",
	"utils/extractor",
	"utils/internal",
	"utils/validator"
];

/**
 * What `import { ... } from "grabit-engine"` exposes to providers.
 *
 * Keep this minimal to avoid pulling large optional deps into every bundle.
 * Providers can still import additional safe modules via `grabit-engine/...`.
 */
const PROVIDER_SHIM_EXPORTS = [
	"controllers/provider",
	"models/provider",
	"services/unpacker",

	// Common utilities
	"utils/path",
	"utils/standard",
	"utils/similarity",
	"utils/extractor",

	// Errors (runtime)
	"types/HttpError",
	"types/ProcessError"
];

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
				//
				// The manifest key may be the full relative path (e.g. "debug/ip")
				// or just the leaf scheme name (e.g. "ip").  Try both.
				const leafScheme = entry.name;
				let manifestDir, schemeForOutput;

				if (manifest?.[childRelative]?.dir != null) {
					// Full relative path matches a manifest key
					manifestDir = manifest[childRelative].dir;
					schemeForOutput = childRelative;
				} else if (manifest?.[leafScheme]?.dir != null) {
					// Leaf scheme name matches a manifest key
					manifestDir = manifest[leafScheme].dir;
					schemeForOutput = leafScheme;
				} else {
					// No manifest entry — fall back to childRelative with no dir prefix
					manifestDir = "";
					schemeForOutput = childRelative;
				}

				const outputDir = path.join(outDir, manifestDir, schemeForOutput);

				providers.push({
					scheme: schemeForOutput,
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

/**
 * Create the esbuild plugin that handles import resolution for provider bundles.
 *
 * Strategy:
 *  1. The main `grabit-engine` entry is replaced with a lightweight shim that
 *     only re-exports provider-safe modules — preventing heavy transitive deps
 *     (cheerio, impit, puppeteer, react) from being pulled into the bundle.
 *  2. `grabit-engine/*` subpath imports resolve normally (let esbuild handle).
 *  3. Node.js built-ins (`crypto`, `fs`, `path`, …) are externalized.
 *  4. Known context-provided packages (`cheerio`, `impit`, …) are externalized
 *     and flagged — providers must use ProviderContext (ctx) instead.
 *  5. Everything else is resolved and inlined by esbuild.
 *
 * @param {Set<string>} contextImports  Mutable set — collects context-provided
 *                                       packages that were imported directly.
 */
function createExternalizePlugin(contextImports) {
	let shimResolveDir = null;
	let isResolvingShim = false;

	function resolveVirtualCryptoShim() {
		return { path: PROVIDER_CRYPTO_SHIM_PATH, namespace: "provider-shim" };
	}

	return {
		name: "provider-bundler",
		setup(build) {
			// ── 1. Replace main "grabit-engine" with provider-safe shim ──
			// When a provider does `import { X } from "grabit-engine"`, the main
			// entry re-exports EVERYTHING including the manager, core modules,
			// and hooks — pulling in cheerio, impit, puppeteer, and react.
			// We intercept this and serve a shim that only re-exports the
			// lightweight, provider-safe modules.
			build.onResolve({ filter: /^grabit-engine$/ }, async (args) => {
				if (args.kind === "entry-point" || isResolvingShim) return null;

				// Resolve once to discover the installed package location
				if (!shimResolveDir) {
					isResolvingShim = true;
					try {
						const result = await build.resolve("grabit-engine", {
							kind: "import-statement",
							resolveDir: args.resolveDir
						});
						if (!result.errors?.length) {
							shimResolveDir = path.dirname(result.path);
						}
					} finally {
						isResolvingShim = false;
					}
				}

				return { path: PROVIDER_SHIM_PATH, namespace: "provider-shim" };
			});

			build.onResolve({ filter: /^grabit-engine-provider-crypto-shim$/ }, () => resolveVirtualCryptoShim());

			build.onResolve({ filter: /^grabit-engine\/services\/crypto(?:\.(?:js|ts))?$/ }, (args) => {
				if (args.kind === "entry-point") return null;
				return resolveVirtualCryptoShim();
			});

			build.onLoad({ filter: /.*/, namespace: "provider-shim" }, (args) => {
				if (args.path === PROVIDER_CRYPTO_SHIM_PATH) {
					return {
						contents: [
							'const runtimeRequire = typeof require === "function" ? require : undefined;',
							"const globalCryptoCandidates = [globalThis.__grabitCrypto, globalThis.Crypto, globalThis.crypto];",
							'const isReactNative = typeof navigator !== "undefined" && navigator.product === "ReactNative";',
							"let Crypto;",
							"",
							"if (runtimeRequire) {",
							'\tconst moduleNames = isReactNative ? ["react-native-quick-crypto", "crypto"] : ["crypto", "react-native-quick-crypto"];',
							"\tfor (const moduleName of moduleNames) {",
							"\t\ttry {",
							"\t\t\tCrypto = runtimeRequire(moduleName);",
							"\t\t\tif (Crypto) break;",
							"\t\t} catch {",
							"\t\t\t// Try the next runtime candidate.",
							"\t\t}",
							"\t}",
							"}",
							"",
							"if (!Crypto) {",
							'\tCrypto = globalCryptoCandidates.find((candidate) => candidate && typeof candidate.createHash === "function");',
							"}",
							"",
							"if (!Crypto) {",
							"\tthrow new Error(",
							"\t\t'Crypto is not available in this runtime. In React Native, install react-native-quick-crypto and expose it via require(\"react-native-quick-crypto\") or set globalThis.__grabitCrypto/globalThis.crypto before evaluating GitHub provider bundles.'",
							"\t);",
							"}",
							"",
							"export { Crypto };"
						].join("\n"),
						loader: "js"
					};
				}

				// Determine whether the installed package has .ts or .js files
				const dir = shimResolveDir || path.join(ROOT, "src");
				const hasTs = fs.existsSync(path.join(dir, "controllers", "provider.ts"));
				const ext = hasTs ? ".ts" : ".js";
				const loader = hasTs ? "ts" : "js";

				const lines = PROVIDER_SHIM_EXPORTS.map((m) => `export * from "./${m}${ext}";`);
				// Keep Crypto available from the root import for compatibility,
				// but served via a virtual shim to avoid polyfill side-effects.
				lines.push(`export { Crypto } from "${PROVIDER_CRYPTO_SHIM_PATH}";`);
				// ISO6391 is used by the provider module wrapper and is lightweight.
				lines.push(`export { default as ISO6391 } from "iso-639-1";`);
				// Back-compat: some providers import `{ tldts }` from "grabit-engine".
				// Keep it as a named re-export so it can be tree-shaken when unused.
				lines.push(`export { tldts } from "./services/tldts${ext}";`);

				return { contents: lines.join("\n"), resolveDir: dir, loader };
			});

			// ── 2. Block unsafe grabit-engine/* subpath imports ──
			// Only allow subpaths that resolve to provider-safe modules.
			// Unsafe subpaths (core/*, services/fetcher, controllers/manager,
			// hooks/*) would transitively pull in cheerio, impit, puppeteer.
			build.onResolve({ filter: /^grabit-engine\// }, (args) => {
				if (args.kind === "entry-point") return null;

				// Extract the subpath after "grabit-engine/"
				const subpath = args.path.slice("grabit-engine/".length);

				// Check whether the subpath starts with a safe module prefix
				const isSafe = PROVIDER_SAFE_MODULES.some((safe) => subpath === safe || subpath.startsWith(safe + "/"));

				if (isSafe) return null; // let esbuild resolve normally

				// Unsafe subpath — block with a clear error
				return {
					errors: [
						{
							text:
								`Unsafe import "${args.path}" blocked. ` +
								`This module transitively pulls in heavy runtime dependencies (cheerio, impit, etc.) ` +
								`that are not available when the bundle is loaded from a temp directory. ` +
								`Use ProviderContext (ctx) for HTTP, HTML parsing, and browser automation instead.`
						}
					]
				};
			});

			// ── 3. Handle all remaining bare imports ──
			build.onResolve({ filter: /^[^./]/ }, (args) => {
				if (args.kind === "entry-point" || /^[a-zA-Z]:/.test(args.path)) {
					return null;
				}

				// Node.js built-ins — safe to externalize everywhere
				if (isNodeBuiltin(args.path)) {
					return { path: args.path, external: true };
				}

				// Context-provided packages — externalize + flag as forbidden
				const pkg = packageName(args.path);
				if (CONTEXT_PROVIDED.has(pkg)) {
					contextImports.add(pkg);
					return { path: args.path, external: true };
				}

				// Everything else — let esbuild resolve & inline.
				// Small npm packages (parse-duration, tldts, validator, etc.)
				// will be fully inlined. If not installed, esbuild fails with
				// a clear "Could not resolve …" message.
				return null;
			});
		}
	};
}

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
	/** @type {Map<string, Set<string>>} scheme → set of forbidden packages */
	const allContextViolations = new Map();

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

		// Per-provider import tracking
		const contextImports = new Set();

		try {
			const result = await esbuild.build({
				entryPoints: [provider.entry],
				outfile: provider.output,
				bundle: true,
				format: "cjs",
				platform: "node",
				target: "esnext",
				treeShaking: true,
				minifySyntax: false,
				minifyWhitespace: false,
				minifyIdentifiers: false,

				plugins: [createExternalizePlugin(contextImports)],

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

			// ── Post-build import validation ────────────────────────────
			if (contextImports.size > 0) {
				allContextViolations.set(provider.scheme, contextImports);
				error(`Provider "${provider.scheme}" directly imports runtime-injected packages:`);
				for (const pkg of contextImports) {
					const hint = CONTEXT_PROVIDED.get(pkg) ?? "use ProviderContext";
					error(`  × "${pkg}" → ${hint}`);
				}
				error(
					`  These packages are NOT available when the bundle is loaded from a temp directory.\n` +
						`  Remove the direct imports and use the ProviderContext (ctx) argument instead.`
				);
				// Still count as succeeded (bundle was written) but flag the issue
			}

			const size = fileSize(provider.output);
			success(`${relEntry} → ${relOutput} (${size})`);
			succeeded++;
		} catch (err) {
			error(`Failed to bundle "${provider.scheme}": ${err.message}`);
			failed++;
		}
	}

	// ── Summary ─────────────────────────────────────────────────────
	console.log();
	if (allContextViolations.size > 0) {
		console.log();
		warn(
			`${allContextViolations.size} provider(s) import packages that must come from ProviderContext.\n` +
				`  These bundles will FAIL at runtime when loaded from GitHub.\n` +
				`  Fix the provider source code to use ctx.cheerio / ctx.xhr / ctx.puppeteer instead of direct imports.`
		);
		console.log();
	}

	if (failed === 0 && allContextViolations.size === 0) {
		success(`All ${succeeded} provider(s) bundled successfully.`);
	} else if (failed === 0) {
		warn(`${succeeded} bundled, but ${allContextViolations.size} have forbidden imports (see above).`);
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

	// When bundling ALL providers (no specific scheme), wipe the output directory
	// first so stale/renamed/deleted providers don't linger.
	// When bundling a single provider, leave the rest of the output intact.
	if (!scheme && !dryRun && fs.existsSync(outDir)) {
		info(`Cleaning output directory: ${path.relative(ROOT, outDir)}`);
		fs.rmSync(outDir, { recursive: true, force: true });
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
