/**
 * Loads .env files for the provider-author CLIs.
 *
 * Zero dependency: uses Node's built-in `process.loadEnvFile()` (Node 20.12+ / 21.7+)
 * and falls back to a minimal parser on older runtimes. Existing `process.env` values
 * always win, so a real shell env or CI secret is never overwritten by a file.
 */
import fs from "node:fs";
import path from "node:path";

/** Files loaded in order; later ones override earlier ones. */
const ENV_FILES = [".env", ".env.local"];

/** Minimal KEY=VALUE parser used when `process.loadEnvFile` is unavailable. */
function parseEnvFile(contents) {
	const out = {};
	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;

		const eq = line.indexOf("=");
		if (eq <= 0) continue;

		const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
		let value = line.slice(eq + 1).trim();

		// Strip matching quotes; unescape \n only inside double quotes.
		if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
			const quote = value[0];
			value = value.slice(1, -1);
			if (quote === '"') value = value.replace(/\\n/g, "\n");
		}
		out[key] = value;
	}
	return out;
}

/**
 * Loads `.env` / `.env.local` from `cwd` (defaults to where the CLI was invoked).
 * @returns {string[]} the files that were actually loaded
 */
export function loadEnvFiles(cwd = process.cwd()) {
	const loaded = [];

	for (const name of ENV_FILES) {
		const file = path.resolve(cwd, name);
		if (!fs.existsSync(file)) continue;

		try {
			// Snapshot so file values never clobber an already-set shell/CI variable.
			const before = { ...process.env };
			if (typeof process.loadEnvFile === "function") {
				process.loadEnvFile(file);
			} else {
				Object.assign(process.env, parseEnvFile(fs.readFileSync(file, "utf8")));
			}
			for (const key of Object.keys(before)) process.env[key] = before[key];
			loaded.push(name);
		} catch {
			// A malformed .env should never break the CLI.
		}
	}

	return loaded;
}

/**
 * Reads a comma/whitespace separated list from an env var.
 * @returns {string[]} trimmed, non-empty entries
 */
export function envList(name) {
	return (process.env[name] ?? "")
		.split(/[,\s]+/)
		.map((v) => v.trim())
		.filter(Boolean);
}
