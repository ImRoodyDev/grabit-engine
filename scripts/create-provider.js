#!/usr/bin/env node

/**
 * CLI tool to scaffold a new provider plugin folder.
 *
 * Usage:
 *   npx create-provider <scheme>
 *   npx create-provider <group>/<scheme>
 *
 * Example:
 *   npx create-provider my-cool-provider
 *   npx create-provider media/my-cool-provider
 *
 * This creates:
 *   providers/<scheme>/
 *   ├── index.ts      ← reads manifest.json by scheme, no duplication
 *   ├── config.ts     ← provider settings (URL, endpoints)
 *   ├── stream.ts     ← stream scraping logic
 *   └── subtitle.ts   ← subtitle scraping logic
 *
 * It also adds the provider entry to manifest.json automatically.
 *
 * See scripts/explain.md for a full guide on how this CLI works.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const ROOT = process.cwd();
const PROVIDERS_DIR = path.join(ROOT, "providers");
const MANIFEST_PATH = path.join(ROOT, "manifest.json");
const PKG_NAME = "grabit-engine";
const SEGMENT_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
const SCHEME_REGEX = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;

// ─── Helpers ────────────────────────────────────────────────────────

function toPascalCase(str) {
	return str
		.split(/[-_]/)
		.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
		.join("");
}

function info(msg) {
	console.log(`\x1b[36mℹ\x1b[0m ${msg}`);
}

function success(msg) {
	console.log(`\x1b[32m✔\x1b[0m ${msg}`);
}

function error(msg) {
	console.error(`\x1b[31m✖\x1b[0m ${msg}`);
}

function ask(question) {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

/**
 * Parse CLI flags from process.argv.
 * Returns { scheme }.
 */
function parseArgs() {
	const args = process.argv.slice(2);
	let schemeArgs = null;
	let lang = null;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--lang" && args[i + 1]) {
			lang = args[++i];
		} else if (!args[i].startsWith("--")) {
			schemeArgs = args[i];
		}
	}

	return { schemeArgs, lang };
}

/**
 * Parse a comma-separated language string into a single string or an array.
 * e.g. "en" → "en", "en,fr,es" → ["en", "fr", "es"]
 */
function parseLanguage(langFlag) {
	if (!langFlag) return "en";
	const parts = langFlag
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	if (parts.length === 0) return "en";
	return parts.length === 1 ? parts[0] : parts;
}

// ─── Manifest ───────────────────────────────────────────────────────

function loadManifest() {
	if (fs.existsSync(MANIFEST_PATH)) {
		return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
	}
	// Create a fresh manifest if none exists
	return {
		name: "providers",
		author: "",
		providers: {}
	};
}

function saveManifest(manifest) {
	fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
	fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, "\t") + "\n", "utf-8");
}

function addToManifest(scheme, dir, name, language) {
	const manifest = loadManifest();

	if (manifest.providers[scheme] && manifest.providers[scheme].dir == dir) {
		info(`Manifest already has an entry for "${scheme}", skipping update.`);
		return;
	}

	manifest.providers[scheme] = {
		name,
		version: "1.0.0",
		active: true,
		language,
		type: "media",
		env: "universal",
		supportedMediaTypes: ["movie", "serie"],
		priority: 100,
		dir
	};

	saveManifest(manifest);
	success("Added entry to manifest.json");
}

// ─── Templates ──────────────────────────────────────────────────────

function formatLanguageLiteral(language) {
	if (Array.isArray(language)) {
		return `[${language.map((l) => `"${l}"`).join(", ")}]`;
	}
	return `"${language}"`;
}

function configTemplate(scheme, name, language) {
	return `import { type ProviderConfig, type TProviderSelectors, Provider } from "${PKG_NAME}";

/**
 * Provider configuration for ${name}.
 */
export const config: ProviderConfig = {
	scheme: "${scheme}",
	name: "${name}",
	language: ${formatLanguageLiteral(language)},
	baseUrl: "https://example.com",
	entries: {
		movie: {
			endpoint: "/embed/movie?tmdb={id:string}"
		},
		serie: {
			endpoint: "/embed/tv?tmdb={id:string}&season={season:1}&episode={episode:1}"
		}
	},
	mediaIds: ["tmdb", "imdb"],
 };

export const locators: TProviderSelectors = {
	$results: '.search-page > .result-item',
	$result_entry: 'article a',
	$result_title: 'article .details .title',
	$result_year: 'article .details .year',
	$result_date: 'article .details .date',
	$result_duration: 'article .details .duration',
} as const;

export const PROVIDER = Provider.create(config);
`;
}

function streamTemplate(name) {
	return `import type { ScrapeRequester, InternalMediaSource, ProviderContext } from "${PKG_NAME}";
import { PROVIDER } from "./config";

/**
 * Stream handler for ${name}.
 *
 * Fetches and parses media streams from the provider's endpoint.
 */
export async function getStreams(requester: ScrapeRequester, ctx: ProviderContext): Promise<InternalMediaSource[]> {
 	// Create the search URL based on the requester's media information
	const resourceURL = PROVIDER.createResourceURL(requester);
	ctx.log.debug(\`Created resource URL: \${resourceURL}\`);

	// Page Extra headers
	const pageRequestOpt = {
		...requester,
		extraHeaders: {
			accept:
				'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
			'accept-language': 'en-US,en;q=0.9,es;q=0.8',
			'cache-control': 'no-cache',
			pragma: 'no-cache',
			priority: 'u=0, i',
			'sec-ch-ua-mobile': '?0',
			'sec-ch-ua-platform': '"Windows"',
			'sec-fetch-dest': 'document',
			'sec-fetch-mode': 'navigate',
			'sec-fetch-site': 'same-origin',
			'sec-fetch-user': '?1',
			'upgrade-insecure-requests': '1',
			'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
			Referer: resourceURL.origin + '/',
			cookie: 'starstruck_eaba890c7302d2af9e8bbf05a869c2b9=cb0a907fd1a24b17d4f16b19a0d30d68;',
		},
	};

	const resultsPage = await ctx.cheerio.load(resourceURL, pageRequestOpt, ctx.xhr);
	// ctx.log.info(\`Page HTML: \${resultsPage.$.html()}\`);

	const src = resultsPage.$("video > source").attr("src");

	if (!src) return [];

	return [
		{
			fileName: "video.mp4",
			format: "mp4",
			language: "en",
			playlist: src,
			xhr: { haveCorsPolicy: false, headers: {} }
		}
	];
}
`;
}

function subtitleTemplate(name) {
	return `import type { ScrapeRequester, InternalSubtitleSource, ProviderContext } from "${PKG_NAME}";
import { PROVIDER } from "./config";

/**
 * Subtitle handler for ${name}.
 *
 * Fetches subtitle data from the provider's API.
 */
export async function getSubtitles(requester: ScrapeRequester, ctx: ProviderContext): Promise<InternalSubtitleSource[]> {
	const url = PROVIDER.createResourceURL(requester);

	const subtitleUrl = new URL(\`\${url.origin}/api/subtitles?id=\${url.searchParams.get("tmdb")}\`);
	const response = await ctx.xhr.fetch(subtitleUrl, {}, requester);
	const data = (await response.json()) as { language: string; languageName: string; url: string }[];

	if (!Array.isArray(data) || data.length === 0) return [];

	return data.map((sub) => ({
		fileName: "subtitles.srt",
		format: "srt" as const,
		language: sub.language,
		languageName: sub.languageName,
		url: sub.url,
		xhr: { haveCorsPolicy: false, headers: {} }
	}));
}
`;
}

function indexTemplate(scheme, manifestRelative) {
	return `import { defineProviderModule } from "${PKG_NAME}";
import type { ProviderModuleManifest } from "${PKG_NAME}";
import manifest from "${manifestRelative}";
import { PROVIDER } from "./config";
import { getStreams } from "./stream";
import { getSubtitles } from "./subtitle";

export default defineProviderModule(PROVIDER, manifest.providers["${scheme}"] as ProviderModuleManifest, {
	getStreams,
	getSubtitles
});
`;
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
	let { schemeArgs, lang } = parseArgs();

	// Interactive mode if no scheme argument
	if (!schemeArgs) {
		schemeArgs = await ask("Provider scheme (e.g. my-provider): ");
	}

	// Interactive mode if no language argument
	if (!lang) {
		lang = await ask('Language(s) — comma-separated for multiple (default: "en"): ');
	}

	const language = parseLanguage(lang);

	if (!schemeArgs) {
		error("No scheme provided.");
		console.log();
		console.log("Usage:");
		console.log("  npx create-provider <scheme>");
		console.log();
		console.log("Examples:");
		console.log("  npx create-provider my-provider");
		console.log("  npx create-provider media/my-provider");
		process.exit(1);
	}

	if (!SCHEME_REGEX.test(schemeArgs)) {
		error(`Invalid scheme "${schemeArgs}". Each segment must match: ${SEGMENT_REGEX}`);
		error("  - Start with a lowercase letter or number");
		error("  - Only lowercase letters, numbers, hyphens, and underscores");
		error("  - Use / to create group folders (e.g. media/my-provider)");
		error("  Examples: my-provider, cool_scraper, media/my-provider, english/vidsrc");
		process.exit(1);
	}

	// Extract the last segment as the provider name for PascalCase
	const segments = schemeArgs.split("/");
	const scheme = segments.pop();
	const name = toPascalCase(scheme);
	const providerDir = path.join(PROVIDERS_DIR, ...segments, scheme);
	// Compute relative path from provider dir back to manifest.json at project root
	const manifestRelative = "../".repeat(segments.length + 2) + "manifest.json";

	if (fs.existsSync(providerDir)) {
		error(`Folder already exists: providers/${schemeArgs}/`);
		process.exit(1);
	}

	const langDisplay = Array.isArray(language) ? language.join(", ") : language;
	info(`Creating provider "${name}" (scheme: ${schemeArgs}, language: ${langDisplay})`);
	console.log();

	// 1. Create the provider folder
	fs.mkdirSync(providerDir, { recursive: true });

	// 2. Write provider files
	const files = [
		{ name: "config.ts", content: configTemplate(scheme, name, language) },
		{ name: "stream.ts", content: streamTemplate(name) },
		{ name: "subtitle.ts", content: subtitleTemplate(name) },
		{ name: "index.ts", content: indexTemplate(scheme, manifestRelative) }
	];

	for (const file of files) {
		const filePath = path.join(providerDir, file.name);
		fs.writeFileSync(filePath, file.content, "utf-8");
		success(`Created providers/${schemeArgs}/${file.name}`);
	}

	// 3. Add entry to manifest.json
	addToManifest(scheme, ["providers", ...segments].join("/"), name, language);

	console.log();
	success(`Provider "${name}" is ready!`);
	console.log();
	info("Next steps:");
	console.log(`  1. Edit providers/${schemeArgs}/config.ts   — set your base URL and endpoints`);
	console.log(`  2. Edit providers/${schemeArgs}/stream.ts   — implement stream scraping logic`);
	console.log(`  3. Edit providers/${schemeArgs}/subtitle.ts — implement subtitle logic (or remove)`);
	console.log();
}

main().catch((err) => {
	error(err.message);
	process.exit(1);
});
