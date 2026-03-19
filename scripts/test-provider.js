#!/usr/bin/env node

/**
 * CLI tool to test a provider plugin locally against real media data.
 *
 * This is a DEV-ONLY tool — it is not bundled into the package exports.
 * It exists to help provider developers verify their scraper works correctly
 * before publishing.
 *
 * ─── Usage ──────────────────────────────────────────────────────────────────
 *
 *   Movie (minimal — TMDB fills the rest):
 *     npx test-provider --scheme my-provider --type movie --tmdb 27205
 *
 *   Movie (full — skips TMDB fetch for provided fields):
 *     npx test-provider --scheme my-provider --type movie \
 *       --title "Inception" --year 2010 --tmdb 27205 --imdb tt1375666 --duration 148
 *
 *   Series (minimal — TMDB fills the rest):
 *     npx test-provider --scheme my-provider --type serie \
 *       --tmdb 1396 --season 1 --episode 1
 *
 *   Series (full — skips TMDB fetch for provided fields):
 *     npx test-provider --scheme my-provider --type serie \
 *       --title "Breaking Bad" --year 2008 --tmdb 1396 \
 *       --season 1 --episode 1 --ep-tmdb 349232
 *
 *   Channel:
 *     npx test-provider --scheme my-provider --type channel \
 *       --channel-id cnn --channel-name "CNN"
 *
 *   From a JSON file:
 *     npx test-provider --scheme my-provider --media-file ./test-media.json
 *
 * ─── Options ────────────────────────────────────────────────────────────────
 *
 *   --scheme <scheme>              Provider scheme to test (required)
 *   --type <movie|serie|channel>   Media type (required unless --media-file)
 *   --tmdb <string>                TMDB ID (required for movie/serie)
 *   --title <string>               Media title in English (optional, filled by TMDB)
 *   --year <number>                Release year (optional, filled by TMDB)
 *   --imdb <string>                IMDB ID (optional, filled by TMDB)
 *   --duration <number>            Duration in minutes (optional, filled by TMDB)
 *   --season <number>              Season number (required for serie)
 *   --episode <number>             Episode number (required for serie)
 *   --ep-tmdb <string>             Episode TMDB ID (optional, filled by TMDB)
 *   --ep-imdb <string>             Episode IMDB ID (optional, filled by TMDB)
 *   --channel-id <string>          Channel ID (channel only)
 *   --channel-name <string>        Channel name (channel only)
 *   --media-file <path>            Load media from a JSON file (overrides above flags)
 *   --mode <streams|subtitles|both>  What to test (default: streams)
 *   --lang <iso>                   Target language ISO code (default: "en")
 *   --user-agent <string>          Custom user agent string
 *   --src <path>                   Providers directory (default: ./providers)
 *   --manifest-dir <path>          Directory containing manifest.json (default: project root, then --src)
 *   --timeout <ms>                 Scrape timeout in ms (default: 90000)
 *   --raw                          Print raw JSON output alongside the formatted report
 *   --no-bundle                    Skip auto-bundling; requires a pre-bundled index.js
 *
 * ─── Provider file resolution order ────────────────────────────────────────
 *
 *   1. <src>/<scheme>/index.js   ← pre-bundled output from `npx bundle-provider`
 *   2. <src>/<scheme>/index.ts   ← TypeScript source (auto-bundled via esbuild if available)
 *
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Root of the grabit-engine package (where this script lives) */
const PKG_ROOT = path.resolve(__dirname, "..");
/** Root of the developer's project (where they run the command) */
const ROOT = process.cwd();

// ─── ANSI color helpers ──────────────────────────────────────────────────────

const c = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	magenta: "\x1b[35m",
	white: "\x1b[37m",
	bgGreen: "\x1b[42m",
	bgRed: "\x1b[41m",
	bgYellow: "\x1b[43m"
};

function bold(s) {
	return `${c.bold}${s}${c.reset}`;
}
function dim(s) {
	return `${c.dim}${s}${c.reset}`;
}
function info(msg) {
	console.log(`${c.cyan}ℹ${c.reset} ${msg}`);
}
function success(msg) {
	console.log(`${c.green}✔${c.reset} ${msg}`);
}
function warn(msg) {
	console.log(`${c.yellow}⚠${c.reset} ${msg}`);
}
function error(msg) {
	console.error(`${c.red}✖${c.reset} ${msg}`);
}
function header(msg) {
	console.log(`\n${c.bold}${c.cyan}${msg}${c.reset}`);
}
function rule() {
	console.log(`${c.dim}${"─".repeat(60)}${c.reset}`);
}

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs() {
	const argv = process.argv.slice(2);
	const opts = {
		scheme: null,
		mediaType: null,
		title: null,
		year: null,
		tmdb: null,
		imdb: null,
		duration: null,
		season: null,
		episode: null,
		epTmdb: null,
		epImdb: null,
		channelId: null,
		channelName: null,
		mediaFile: null,
		mode: "streams",
		lang: null,
		userAgent: null,
		src: null,
		manifestDir: null,
		timeout: 90000,
		raw: false,
		noBundle: false
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = argv[i + 1];

		const take = () => {
			i++;
			return next;
		};

		if (arg === "--scheme") opts.scheme = take();
		else if (arg === "--type") opts.mediaType = take();
		else if (arg === "--title") opts.title = take();
		else if (arg === "--year") opts.year = Number(take());
		else if (arg === "--tmdb") opts.tmdb = take();
		else if (arg === "--imdb") opts.imdb = take();
		else if (arg === "--duration") opts.duration = Number(take());
		else if (arg === "--season") opts.season = Number(take());
		else if (arg === "--episode") opts.episode = Number(take());
		else if (arg === "--ep-tmdb") opts.epTmdb = take();
		else if (arg === "--ep-imdb") opts.epImdb = take();
		else if (arg === "--channel-id") opts.channelId = take();
		else if (arg === "--channel-name") opts.channelName = take();
		else if (arg === "--media-file") opts.mediaFile = take();
		else if (arg === "--mode") opts.mode = take();
		else if (arg === "--lang") opts.lang = take();
		else if (arg === "--user-agent") opts.userAgent = take();
		else if (arg === "--src") opts.src = take();
		else if (arg === "--manifest-dir") opts.manifestDir = take();
		else if (arg === "--timeout") opts.timeout = Number(take());
		else if (arg === "--raw") opts.raw = true;
		else if (arg === "--no-bundle") opts.noBundle = true;
		else if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		}
	}

	return opts;
}

function printHelp() {
	console.log(`
${bold("test-provider")} — Test a provider plugin locally

${bold("USAGE")}
  npx test-provider --scheme <scheme> [media flags] [options]

${bold("MEDIA FLAGS")} ${dim("(skip if using --media-file)")}
  --type <movie|serie|channel>     Media type (required)
  --tmdb <string>                  TMDB ID (required for movie/serie)
  --title <string>                 Title in English (optional, filled by TMDB)
  --year <number>                  Release year (optional, filled by TMDB)
  --imdb <string>                  IMDB ID (optional, filled by TMDB)
  --duration <number>              Duration in minutes (optional, filled by TMDB)
  --season <number>                Season number (required for serie)
  --episode <number>               Episode number (required for serie)
  --ep-tmdb <string>               Episode TMDB ID (optional, filled by TMDB)
  --ep-imdb <string>               Episode IMDB ID (optional, filled by TMDB)
  --channel-id <string>            Channel ID (channel)
  --channel-name <string>          Channel name (channel)
  --media-file <path>              Load media from JSON file

${bold("OPTIONS")}
  --scheme <scheme>                Provider scheme (required)
  --mode <streams|subtitles|both>  What to test (default: streams)
  --lang <iso>                     Target language ISO (default: en)
  --user-agent <string>            Custom user agent
  --src <path>                     Providers directory (default: ./providers)
  --manifest-dir <path>            Directory of manifest.json (default: project root, then --src)
	--timeout <ms>                   Timeout in ms (default: 90000)
  --raw                            Also print raw JSON output
  --no-bundle                      Require pre-bundled index.js, skip auto-bundling
  --help, -h                       Show this help

${bold("EXAMPLES")}
  npx test-provider --scheme vidsrc --type movie --tmdb 27205

  npx test-provider --scheme vidsrc --type serie --tmdb 1396 \\
    --season 1 --episode 1

  npx test-provider --scheme vidsrc --media-file ./test-media.json --mode both
`);
}

// ─── Media Builder ───────────────────────────────────────────────────────────

function buildMedia(opts) {
	if (opts.mediaFile) {
		const filePath = path.resolve(ROOT, opts.mediaFile);
		if (!fs.existsSync(filePath)) {
			error(`media-file not found: ${filePath}`);
			process.exit(1);
		}
		try {
			return JSON.parse(fs.readFileSync(filePath, "utf-8"));
		} catch (e) {
			error(`Failed to parse media-file: ${e.message}`);
			process.exit(1);
		}
	}

	if (!opts.mediaType) {
		error("--type <movie|serie|channel> is required (or use --media-file).");
		process.exit(1);
	}

	const type = opts.mediaType;

	if (type === "movie") {
		// Only tmdb is strictly required — TMDB service fills the rest
		const missing = ["tmdb"].filter((k) => opts[k] == null);
		if (missing.length) {
			error(`Missing required flags for movie: ${missing.map((k) => `--${k}`).join(", ")}`);
			process.exit(1);
		}
		return {
			type: "movie",
			tmdbId: String(opts.tmdb),
			...(opts.title != null && { title: opts.title }),
			...(opts.year != null && { releaseYear: opts.year }),
			...(opts.imdb != null && { imdbId: opts.imdb }),
			...(opts.duration != null && { duration: opts.duration })
		};
	}

	if (type === "serie") {
		// tmdb, season, and episode are required — TMDB service fills the rest
		const missing = ["tmdb", "season", "episode"].filter((k) => opts[k] == null);
		if (missing.length) {
			error(`Missing required flags for serie: ${missing.map((k) => `--${k}`).join(", ")}`);
			process.exit(1);
		}
		return {
			type: "serie",
			tmdbId: String(opts.tmdb),
			season: opts.season,
			episode: opts.episode,
			...(opts.title != null && { title: opts.title }),
			...(opts.year != null && { releaseYear: opts.year }),
			...(opts.imdb != null && { imdbId: opts.imdb }),
			...(opts.duration != null && { duration: opts.duration }),
			...(opts.epTmdb != null && { ep_tmdbId: String(opts.epTmdb) }),
			...(opts.epImdb != null && { ep_imdbId: opts.epImdb })
		};
	}

	if (type === "channel") {
		const missing = ["channelId", "channelName"].filter((k) => opts[k] == null);
		if (missing.length) {
			error(`Missing required flags for channel: ${missing.map((k) => `--${k === "channelId" ? "channel-id" : "channel-name"}`).join(", ")}`);
			process.exit(1);
		}
		return {
			type: "channel",
			channelId: opts.channelId,
			channelName: opts.channelName
		};
	}

	error(`Unknown --type value: "${type}". Must be movie, serie, or channel.`);
	process.exit(1);
}

// ─── Provider Loader ─────────────────────────────────────────────────────────

/**
 * Read the manifest.json and return the provider entry for the given scheme.
 * Returns null if no manifest or no matching provider entry is found.
 */
function readProviderManifestEntry(scheme, srcDir, manifestDir) {
	const manifestCandidates = [
		...(manifestDir ? [path.resolve(ROOT, manifestDir, "manifest.json")] : []),
		path.join(ROOT, "manifest.json"),
		path.join(srcDir, "manifest.json")
	];

	for (const manifestPath of manifestCandidates) {
		if (!fs.existsSync(manifestPath)) continue;
		try {
			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
			const providerMeta = manifest?.providers?.[scheme];
			if (providerMeta) return providerMeta;
		} catch {
			// Ignore parse errors — try next candidate
		}
	}
	return null;
}

function resolveProviderEntry(scheme, srcDir, manifestDir) {
	// Default: <srcDir>/<scheme>
	let schemeDir = path.join(srcDir, scheme);

	// Check manifest for a provider-specific `dir` override.
	const providerMeta = readProviderManifestEntry(scheme, srcDir, manifestDir);
	if (providerMeta?.dir) {
		// `dir` is relative to the project root (e.g. "providers/media")
		schemeDir = path.join(ROOT, providerMeta.dir, scheme);
	}

	if (!fs.existsSync(schemeDir)) {
		error(`Provider directory not found: ${path.relative(ROOT, schemeDir)}`);
		error(`Make sure "--src" points to the correct providers directory.`);
		process.exit(1);
	}

	const bundledPath = path.join(schemeDir, "index.js");
	const sourcePath = path.join(schemeDir, "index.ts");

	if (fs.existsSync(bundledPath)) {
		return { path: bundledPath, type: "bundled" };
	}
	if (fs.existsSync(sourcePath)) {
		return { path: sourcePath, type: "source" };
	}

	error(`No index.js or index.ts found in: ${path.relative(ROOT, schemeDir)}`);
	error(`Run "npx bundle-provider ${scheme}" first to create a bundled index.js, or ensure index.ts exists.`);
	process.exit(1);
}

/**
 * Auto-bundle a TypeScript provider entry into a temporary JS file using esbuild.
 * Returns the path to the temporary bundle.
 */
async function bundleInMemory(entryPath) {
	let esbuild;
	try {
		esbuild = await import("esbuild");
	} catch {
		error("esbuild is not installed — cannot auto-bundle TypeScript source.");
		error("Install it: npm install --save-dev esbuild");
		error('Or run "npx bundle-provider <scheme>" first, then retry.');
		process.exit(1);
	}

	const tmpFile = path.join(os.tmpdir(), `test-provider-${Date.now()}.cjs`);

	// Plugin: provide empty shims for React and its sub-paths.
	// React is an optional peer dep only needed for the React hooks API,
	// never for provider scraping logic. By shimming it we avoid a runtime
	// `require("react")` that would fail when the temp bundle runs from os.tmpdir().
	const reactShimPlugin = {
		name: "react-shim",
		setup(build) {
			build.onResolve({ filter: /^react(\/.*)?$/ }, (args) => ({
				path: args.path,
				namespace: "react-shim"
			}));
			build.onLoad({ filter: /.*/, namespace: "react-shim" }, () => ({
				contents: "module.exports = {};",
				loader: "js"
			}));
		}
	};

	try {
		await esbuild.build({
			entryPoints: [entryPath],
			outfile: tmpFile,
			bundle: true,
			format: "cjs",
			platform: "node",
			target: "esnext",
			treeShaking: true,
			loader: { ".json": "json" },
			logLevel: "silent",
			write: true,
			// Keep optional / heavy peer deps external — they are loaded at runtime
			// from the host project's node_modules if needed.
			// Native addons (.node files) like impit cannot be bundled by esbuild.
			external: ["puppeteer", "puppeteer-core", "puppeteer-real-browser", "@puppeteer/browsers", "rebrowser-puppeteer", "rebrowser-puppeteer-core", "impit"],
			plugins: [reactShimPlugin]
		});
	} catch (e) {
		error(`Failed to bundle provider source: ${e.message}`);
		// Clean up temp file if it was partially written
		if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
		process.exit(1);
	}

	return tmpFile;
}

/**
 * Dynamically import the provider module.
 * Handles cleanup of temp bundle files automatically.
 */
async function loadProviderModule(scheme, srcDir, noBundle, manifestDir) {
	const entry = resolveProviderEntry(scheme, srcDir, manifestDir);
	let modulePath = entry.path;
	let tmpFile = null;

	if (entry.type === "source") {
		if (noBundle) {
			error(`Provider "${scheme}" only has a TypeScript source (index.ts) but --no-bundle was set.`);
			error(`Run "npx bundle-provider ${scheme}" first to create index.js.`);
			process.exit(1);
		}
		info(`TypeScript source detected — auto-bundling ${dim(path.relative(ROOT, entry.path))} ...`);
		modulePath = await bundleInMemory(entry.path);
		tmpFile = modulePath;
		success(`Bundled to temp file`);
	} else {
		info(`Loading pre-bundled provider: ${dim(path.relative(ROOT, entry.path))}`);
		tmpFile = createTempCopy(entry.path, `${scheme.replace(/\//g, "_")}-bundled`);
		modulePath = tmpFile;
	}

	let mod;
	try {
		mod = await import(pathToFileURL(modulePath).href);
	} finally {
		// Always clean up temp bundle if it was created
		if (tmpFile && fs.existsSync(tmpFile)) {
			fs.unlinkSync(tmpFile);
		}
	}

	const providerModule = mod.default?.default ?? mod.default ?? mod;

	if (!providerModule || typeof providerModule !== "object" || !providerModule.workers) {
		error(`Provider "${scheme}" did not export a valid module (expected a ProviderModule with meta, provider, and workers).`);
		process.exit(1);
	}

	return providerModule;
}

// ─── Context Loader ──────────────────────────────────────────────────────────

/**
 * Load the provider context from the grabit-engine package dist.
 * This mirrors what ScrapePluginManager.createContext() does internally.
 */
async function loadContext(scheme) {
	const distCore = path.join(PKG_ROOT, "dist", "esm", "src", "core");

	if (!fs.existsSync(distCore)) {
		error(`Package dist not found at: ${distCore}`);
		error("The grabit-engine package must be built first.");
		error(`Run "npm run build" inside the package, or reinstall: npm install grabit-engine`);
		process.exit(1);
	}

	const [xhrMod, cheerioMod, puppeteerMod, loggerMod] = await Promise.all([
		import(pathToFileURL(path.join(distCore, "xhr.js")).href),
		import(pathToFileURL(path.join(distCore, "cheerio.js")).href),
		import(pathToFileURL(path.join(distCore, "puppeteer.js")).href),
		import(pathToFileURL(path.join(PKG_ROOT, "dist", "esm", "src", "utils", "logger.js")).href)
	]);
	if (typeof puppeteerMod.disableHeadlessMode === "function") puppeteerMod.disableHeadlessMode(true);

	// Logger is always in debug mode for the test script
	const { DebugLogger } = loggerMod;
	const log = new DebugLogger(true, scheme ?? "provider");
	log.setJumpLine(true);
	log.setTimestamp(true);

	return {
		xhr: xhrMod.default,
		cheerio: cheerioMod.default,
		puppeteer: puppeteerMod.default,
		log
	};
}

// ─── Result Formatters ───────────────────────────────────────────────────────

function formatMediaSource(source, index) {
	const lines = [];
	lines.push(`  ${c.bold}${c.green}[${index + 1}] ${source.fileName ?? "(unnamed)"}${c.reset}`);
	lines.push(`      ${dim("Scheme:")}      ${source.scheme ?? "—"}`);
	lines.push(`      ${dim("Provider:")}    ${source.providerName ?? "—"}`);
	lines.push(`      ${dim("Format:")}      ${source.format ?? "—"}`);
	lines.push(`      ${dim("Language:")}    ${source.language ?? "—"}`);
	lines.push(`      ${dim("CORS policy:")} ${source.xhr?.haveCorsPolicy ? `${c.yellow}yes${c.reset}` : `${c.green}no${c.reset}`}`);

	if (source.xhr?.headers && Object.keys(source.xhr.headers).length > 0) {
		lines.push(`      ${dim("Headers:")}     ${JSON.stringify(source.xhr.headers)}`);
	}

	if (typeof source.playlist === "string") {
		lines.push(`      ${dim("Playlist:")}    ${source.playlist}`);
	} else if (Array.isArray(source.playlist) && source.playlist.length > 0) {
		lines.push(`      ${dim("Qualities:")}`);
		for (const q of source.playlist) {
			lines.push(`        ${c.dim}•${c.reset} ${q.resolution ?? "?"} — ${q.source}`);
		}
	}

	return lines.join("\n");
}

function formatSubtitleSource(source, index) {
	const lines = [];
	lines.push(`  ${c.bold}${c.green}[${index + 1}] ${source.fileName ?? "(unnamed)"}${c.reset}`);
	lines.push(`      ${dim("Scheme:")}   ${source.scheme ?? "—"}`);
	lines.push(`      ${dim("Provider:")} ${source.providerName ?? "—"}`);
	lines.push(`      ${dim("Format:")}   ${source.format ?? "—"}`);

	if (source.language) {
		lines.push(`      ${dim("Language:")}  [${source.language}] ${source.languageName ?? ""}`);
	}
	if (source.url) {
		lines.push(`      ${dim("URL:")}       ${source.url}`);
	}

	return lines.join("\n");
}

// ─── Run ─────────────────────────────────────────────────────────────────────

async function runScrape(providerModule, requester, mode, timeout) {
	const results = { streams: null, subtitles: null, errors: {} };

	const withTimeout = (promise, label) =>
		Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${timeout}ms`)), timeout))]).catch((err) => {
			results.errors[label] = err.message ?? String(err);
			return null;
		});

	if ((mode === "streams" || mode === "both") && typeof providerModule.workers?.getStreams === "function") {
		results.streams = await withTimeout(providerModule.workers.getStreams(requester, globalContext), "streams");
	}

	if ((mode === "subtitles" || mode === "both") && typeof providerModule.workers?.getSubtitles === "function") {
		results.subtitles = await withTimeout(providerModule.workers.getSubtitles(requester, globalContext), "subtitles");
	}

	return results;
}

// ─── Global context (set after loading) ─────────────────────────────────────
let globalContext = null;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
	const opts = parseArgs();

	// Validate required args
	if (!opts.scheme) {
		error("--scheme <scheme> is required.");
		error('Run "npx test-provider --help" for usage.');
		process.exit(1);
	}

	const validModes = ["streams", "subtitles", "both"];
	if (!validModes.includes(opts.mode)) {
		error(`--mode must be one of: ${validModes.join(", ")}`);
		process.exit(1);
	}

	const srcDir = opts.src ? path.resolve(ROOT, opts.src) : path.join(ROOT, "providers");

	// ─── Banner ──────────────────────────────────────────────────────────
	console.log();
	console.log(`${c.bold}${c.magenta}┌─────────────────────────────────────────────┐${c.reset}`);
	console.log(`${c.bold}${c.magenta}│  grabit-engine  ·  Provider Tester  │${c.reset}`);
	console.log(`${c.bold}${c.magenta}└─────────────────────────────────────────────┘${c.reset}`);
	console.log();

	// ─── Build media ─────────────────────────────────────────────────────
	header("► Media");
	rule();
	const media = buildMedia(opts);

	console.log(`  ${dim("type:")}   ${bold(media.type)}`);
	if (media.type === "movie" || media.type === "serie") {
		console.log(`  ${dim("title:")}  ${media.title}`);
		console.log(`  ${dim("year:")}   ${media.releaseYear}`);
		console.log(`  ${dim("tmdb:")}   ${media.tmdbId}`);
		if (media.imdbId) console.log(`  ${dim("imdb:")}   ${media.imdbId}`);
	}
	if (media.type === "serie") {
		console.log(`  ${dim("S/E:")}    S${media.season}E${media.episode}`);
		console.log(`  ${dim("ep_tmdb:")} ${media.ep_tmdbId}`);
	}
	if (media.type === "channel") {
		console.log(`  ${dim("name:")}  ${media.channelName}  ${dim(`(id: ${media.channelId})`)}`);
	}

	if (opts.userAgent) {
		console.log(`  ${dim("user agent:")} ${opts.userAgent}`);
	}

	// ─── Resolve target language ─────────────────────────────────────
	// If --lang was not explicitly set, auto-detect from the provider's manifest language
	if (!opts.lang) {
		const manifestEntry = readProviderManifestEntry(opts.scheme, srcDir, opts.manifestDir);
		if (manifestEntry?.language) {
			const provLang = Array.isArray(manifestEntry.language) ? manifestEntry.language[0] : manifestEntry.language;
			if (provLang) {
				opts.lang = provLang;
				info(`Auto-detected target language from manifest: ${bold(opts.lang)}`);
			}
		}
		if (!opts.lang) opts.lang = "en";
	}

	// ─── TMDB enrichment ─────────────────────────────────────────────
	// For movies/series with partial data, use TMDB to fill in the gaps
	let enrichedMedia = media;
	if (media.type !== "channel") {
		try {
			const tmdbMod = await import(pathToFileURL(path.join(PKG_ROOT, "dist", "esm", "src", "services", "tmdb.js")).href);
			const TMDB = tmdbMod.TMDB;

			// Initialize TMDB with a pool of API keys
			TMDB.init([
				"10923b261ba94d897ac6b81148314a3f",
				"b573d051ec65413c949e68169923f7ff",
				"da40aaeca884d8c9a9a4c088917c474c",
				"4e44d9029b1270a757cddc766a1bcb63",
				"39151834c95219c3cae772b4465079d7",
				"6bca0b74270a3299673d934c1bb11b4d",
				"902ddd650dd51f569c2ef95468612ad1",
				"4c7ff8e6151131469216f007e4be3b3d",
				"21e3f055fa996f78a2886737bb6e7957",
				"98325a9d3ed3ec225e41ccc4d360c817",
				"3fd2be6f0c70a2a598f084ddfb75487c",
				"9780d3ceee590a40bd3446da3f81171d",
				"04c35731a5ee918f014970082a0088b1",
				"516adf1e1567058f8ecbf30bf2eb9378",
				"9b702a6b89b0278738dab62417267c49"
			]);

			info("Fetching media details from TMDB (filling missing fields)...");
			enrichedMedia = await TMDB.createRequesterMedia({
				media,
				targetLanguageISO: opts.lang
			});
			success("TMDB enrichment complete");

			// Log enriched media data
			header("► Enriched Media (after TMDB)");
			rule();
			console.log(`  ${dim("type:")}   ${bold(enrichedMedia.type)}`);
			console.log(`  ${dim("title:")}  ${enrichedMedia.title}`);
			console.log(`  ${dim("year:")}   ${enrichedMedia.releaseYear}`);
			console.log(`  ${dim("tmdb:")}   ${enrichedMedia.tmdbId}`);
			if (enrichedMedia.imdbId) console.log(`  ${dim("imdb:")}   ${enrichedMedia.imdbId}`);
			console.log(`  ${dim("duration:")} ${enrichedMedia.duration} min`);
			console.log(`  ${dim("language:")} ${enrichedMedia.original_language}`);
			console.log(`  ${dim("targetLang:")} ${opts.lang}`);
			if (enrichedMedia.localizedTitles?.length) console.log(`  ${dim("localized:")} ${enrichedMedia.localizedTitles.join(", ")}`);
			else console.log(`  ${dim("localized:")} ${dim('(none — no TMDB translations matched target lang "' + opts.lang + '")')}`);
			if (enrichedMedia.type === "serie") {
				console.log(`  ${dim("S/E:")}    S${enrichedMedia.season}E${enrichedMedia.episode}`);
				if (enrichedMedia.ep_tmdbId) console.log(`  ${dim("ep_tmdb:")} ${enrichedMedia.ep_tmdbId}`);
				if (enrichedMedia.ep_imdbId) console.log(`  ${dim("ep_imdb:")} ${enrichedMedia.ep_imdbId}`);
			}
		} catch (e) {
			warn(`TMDB enrichment failed: ${e.message ?? e}`);
			warn("Proceeding with provided media data as-is.");
			// Ensure required IBaseMedia fields have sensible defaults so providers don't crash
			if (enrichedMedia.type !== "channel") {
				enrichedMedia.title = enrichedMedia.title ?? "Unknown";
				enrichedMedia.original_language = enrichedMedia.original_language ?? "en";
				enrichedMedia.localizedTitles = enrichedMedia.localizedTitles ?? [];
				enrichedMedia.duration = enrichedMedia.duration ?? 0;
				enrichedMedia.releaseYear = enrichedMedia.releaseYear ?? 0;
			}
		}
	}

	const requester = {
		media: enrichedMedia,
		targetLanguageISO: opts.lang,
		userAgent: opts.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
	};

	// ─── Load context ────────────────────────────────────────────────────
	header("► Loading context");
	rule();
	info("Importing provider context from package dist...");
	globalContext = await loadContext(opts.scheme);
	success("Context ready  (xhr, cheerio, puppeteer, log)");

	// ─── Load provider ────────────────────────────────────────────────────
	header("► Loading provider");
	rule();
	const providerModule = await loadProviderModule(opts.scheme, srcDir, opts.noBundle, opts.manifestDir);

	const hasStreams = typeof providerModule.workers?.getStreams === "function";
	const hasSubtitles = typeof providerModule.workers?.getSubtitles === "function";

	console.log(`  ${dim("scheme:")}      ${bold(providerModule.provider?.config?.scheme ?? opts.scheme)}`);
	console.log(`  ${dim("name:")}        ${providerModule.meta?.name ?? dim("(unnamed)")}`);
	console.log(`  ${dim("version:")}     ${providerModule.meta?.version ?? dim("(unknown)")}`);
	const langDisplay = providerModule.meta?.language
		? Array.isArray(providerModule.meta.language)
			? providerModule.meta.language.join(", ")
			: providerModule.meta.language
		: dim("(unknown)");
	console.log(`  ${dim("language:")}    ${langDisplay}`);
	console.log(`  ${dim("getStreams:")}   ${hasStreams ? `${c.green}✔ yes${c.reset}` : `${c.dim}— no${c.reset}`}`);
	console.log(`  ${dim("getSubtitles:")} ${hasSubtitles ? `${c.green}✔ yes${c.reset}` : `${c.dim}— no${c.reset}`}`);

	// Warn if mode requires capabilities the provider doesn't have
	if (opts.mode === "streams" && !hasStreams) {
		warn(`Provider does not implement getStreams — nothing to test in streams mode.`);
		process.exit(0);
	}
	if (opts.mode === "subtitles" && !hasSubtitles) {
		warn(`Provider does not implement getSubtitles — nothing to test in subtitles mode.`);
		process.exit(0);
	}

	// ─── Run scrape ───────────────────────────────────────────────────────
	header(`► Scraping  ${dim(`(mode: ${opts.mode}, timeout: ${opts.timeout}ms)`)}`);
	rule();
	info("Running scrape...");
	const startTime = Date.now();

	const results = await runScrape(providerModule, requester, opts.mode, opts.timeout);
	const elapsed = Date.now() - startTime;

	// ─── Show results ─────────────────────────────────────────────────────

	// ── Streams
	if (results.streams !== null) {
		header(`► Stream Sources  ${dim(`(${results.streams?.length ?? 0} found)`)}`);
		rule();

		if (results.errors.streams) {
			error(`getStreams failed: ${results.errors.streams}`);
		} else if (!results.streams || results.streams.length === 0) {
			warn("getStreams returned no results.");
		} else {
			for (let i = 0; i < results.streams.length; i++) {
				console.log(formatMediaSource(results.streams[i], i));
				console.log();
			}
		}
	}

	// ── Subtitles
	if (results.subtitles !== null) {
		header(`► Subtitle Sources  ${dim(`(${results.subtitles?.length ?? 0} found)`)}`);
		rule();

		if (results.errors.subtitles) {
			error(`getSubtitles failed: ${results.errors.subtitles}`);
		} else if (!results.subtitles || results.subtitles.length === 0) {
			warn("getSubtitles returned no results.");
		} else {
			for (let i = 0; i < results.subtitles.length; i++) {
				console.log(formatSubtitleSource(results.subtitles[i], i));
				console.log();
			}
		}
	}

	// ── Raw JSON
	if (opts.raw) {
		header("► Raw JSON");
		rule();
		console.log(JSON.stringify(results, null, 2));
	}

	// ── Summary
	header("► Summary");
	rule();

	const streamCount = results.streams?.length ?? 0;
	const subtitleCount = results.subtitles?.length ?? 0;
	const hasAnyError = Object.keys(results.errors).length > 0;
	const hasAnyResult = streamCount > 0 || subtitleCount > 0;

	console.log(`  ${dim("Time elapsed:")}  ${elapsed}ms`);
	if (results.streams !== null)
		console.log(`  ${dim("Stream sources:")}  ${streamCount > 0 ? `${c.green}${streamCount}${c.reset}` : `${c.yellow}0${c.reset}`}`);
	if (results.subtitles !== null)
		console.log(`  ${dim("Subtitle sources:")} ${subtitleCount > 0 ? `${c.green}${subtitleCount}${c.reset}` : `${c.yellow}0${c.reset}`}`);

	if (hasAnyError) {
		for (const [label, msg] of Object.entries(results.errors)) {
			error(`${label}: ${msg}`);
		}
	}

	console.log();
	if (!hasAnyError && hasAnyResult) {
		console.log(`${c.bgGreen}${c.bold}  PASS  ${c.reset} Provider "${opts.scheme}" scraped successfully.`);
	} else if (!hasAnyError && !hasAnyResult) {
		console.log(`${c.bgYellow}${c.bold}  EMPTY  ${c.reset} Provider returned no results — check your scraping logic.`);
	} else {
		console.log(`${c.bgRed}${c.bold}  FAIL  ${c.reset} Provider "${opts.scheme}" encountered errors.`);
	}

	console.log();
	process.exit(hasAnyError ? 1 : 0);
}

main().catch((err) => {
	error(err.stack ?? err.message ?? String(err));
	process.exit(1);
});
