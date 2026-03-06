import {
	GithubSource,
	HttpError,
	isHttpError,
	isProcessError,
	ProcessError,
	ProvidersManifest,
	ProviderModule,
	ProviderModuleManifest
} from "../types/index.ts";
import { ResolvedProviderSource } from "../types/models/Manager.ts";
import { pathJoin } from "../utils/path.ts";
import { isNode } from "../utils/standard.ts";
import { validateProvidersManifest, validateProviderModules } from "../utils/validator.ts";
import { appFetch } from "./fetcher.ts";

export interface GitHubRepoInfo {
	owner: string;
	repo: string;
}

export interface GitHubFetchOptions extends GitHubRepoInfo {
	branch: string;
	token?: string;
	/** Normalized root directory prefix (no leading slash, with trailing slash, or empty string) */
	rootDir: string;
}

export namespace GithubService {
	const GITHUB_REGEX = [/^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/, /^github\.com\/([^/]+)\/([^/.]+)(\.git)?$/, /^([^/]+)\/([^/]+)$/];

	export async function initializeProviders(source: GithubSource): Promise<ResolvedProviderSource> {
		// Fetch the manifest from GitHub and validate it
		const fetchOpts = createOptions(source);
		const manifest = await githubFetchManifest(fetchOpts);
		const modules = await fetchModuleFromGithub(fetchOpts, manifest.providers, source.moduleResolver);
		const registry = new Map(Object.entries(modules));
		const validations = validateProviderModules(registry);

		return {
			meta: manifest,
			providers: validations.validModules,
			validations: {
				errors: validations.errors,
				warnings: validations.warnings
			}
		};
	}

	export async function getManifest(source: GithubSource): Promise<ProvidersManifest> {
		const fetchOpts = createOptions(source);
		// Fetch the manifest from GitHub and validate it
		const manifest = await githubFetchManifest(fetchOpts);
		return manifest;
	}

	export async function getModule([scheme, manifest]: [string, ProviderModuleManifest], source: GithubSource) {
		const fetchOpts = createOptions(source);
		const modules = await fetchModuleFromGithub(fetchOpts, { [scheme]: manifest }, source.moduleResolver);
		const registry = new Map(Object.entries(modules));
		const validations = validateProviderModules(registry);

		return {
			module: registry.get(scheme) ?? null,
			validations: {
				errors: validations.errors,
				warnings: validations.warnings
			}
		};
	}

	function createOptions(source: GithubSource): GitHubFetchOptions {
		// Parse the GitHub URL to extract owner and repo information
		const parsed = parseGithubURL(source.url);
		if (!parsed) {
			throw new ProcessError({
				code: "INVALID_GITHUB_URL",
				message: `Invalid GitHub URL: ${source.url}. Expected formats: https://github.com/owner/repo, github.com/owner/repo, or owner/repo`
			});
		}

		// Github fetch options
		const branch = source.branch ?? "main";
		const token = source.token;
		// Normalize rootDir: strip leading/trailing slashes, then append '/' if non-empty
		const rawRoot = (source.rootDir ?? "").replace(/^\/+|\/+$/g, "");
		const rootDir = rawRoot ? `${rawRoot}/` : "";
		const fetchOpts: GitHubFetchOptions = { owner: parsed.owner, repo: parsed.repo, branch, token, rootDir };
		return fetchOpts;
	}

	/** Parses a GitHub URL and extracts the owner and repository name
	 * Supports the following formats:
	 * - https://github.com/owner/repo
	 * - github.com/owner/repo
	 * - owner/repo
	 * Returns an object with `owner` and `repo` properties if the URL is valid, or null if it is not.
	 */
	function parseGithubURL(url: string): GitHubRepoInfo | null {
		for (const p of GITHUB_REGEX) {
			const m = url.match(p);
			if (m) return { owner: m[1], repo: m[2] };
		}
		return null;
	}

	/**
	 * Authenticated request to the GitHub REST API via fetch.
	 * Works in Node 18+, browsers, and React Native.
	 */
	async function githubFetch<T>(apiPath: string, opts: { token?: string; raw?: boolean } = {}): Promise<T> {
		const headers: Record<string, string> = {
			"User-Agent": "grabit-engine",
			Accept: opts.raw ? "application/vnd.github.v3.raw" : "application/vnd.github.v3+json"
		};
		if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

		const res = await appFetch(`https://api.github.com${apiPath}`, { headers, clean: true });
		if (!res.ok) {
			const body = await res.text();
			throw new HttpError({
				code: "GITHUB_API_ERROR",
				message: `GitHub API request failed with status ${res.status}: ${res.statusText}`,
				details: body,
				statusCode: res.status,
				expose: false
			});
		}
		return opts.raw ? ((await res.text()) as T) : ((await res.json()) as T);
	}

	/** Fetch the raw manifest.json from a GitHub repo. */
	async function githubFetchManifest(opts: GitHubFetchOptions): Promise<ProvidersManifest> {
		try {
			const apiPath = `/repos/${opts.owner}/${opts.repo}/contents/${opts.rootDir}manifest.json?ref=${opts.branch}`;
			const manifestText = await githubFetch<string>(apiPath, { token: opts.token, raw: true });
			const validated = validateProvidersManifest(JSON.parse(manifestText) as ProvidersManifest);
			if (!validated.valid) {
				throw new ProcessError({
					code: "PROVIDERS_MANIFEST_INVALID",
					message: `Invalid GitHub manifest for repo ${opts.owner}/${opts.repo}`,
					details: validated.errors
				});
			}
			return validated.manifest;
		} catch (error) {
			if (isHttpError(error) || isProcessError(error)) throw error;
			throw new ProcessError({
				code: "PROVIDERS_MANIFEST_PARSE_ERROR",
				message: `Failed to parse GitHub manifest for repo ${opts.owner}/${opts.repo}`,
				details: error
			});
		}
	}

	/** Fetch a single raw file frodm a GitHub repo. */
	async function fetchFileFromGitHub(opts: GitHubFetchOptions, filePath: string): Promise<string> {
		const apiPath = `/repos/${opts.owner}/${opts.repo}/contents/${opts.rootDir}${filePath}?ref=${opts.branch}`;
		return githubFetch<string>(apiPath, { token: opts.token, raw: true });
	}

	/**
	 * Fetch and resolve every provider listed in `providers`.
	 *
	 * @param opts             - GitHub repo + auth info
	 * @param providers        - scheme → relative folder path (from manifest.json)
	 * @param moduleResolver   - Optional callback to turn source code into a module.
	 *                           If omitted a Node.js default (temp file + import) is used.
	 * @returns scheme → resolved ProviderModule
	 */
	async function fetchModuleFromGithub(
		opts: GitHubFetchOptions,
		providers: Record<string, ProviderModuleManifest>,
		moduleResolver?: (scheme: string, sourceCode: string) => Promise<ProviderModule>
	): Promise<Record<string, ProviderModule | null>> {
		const modules: Record<string, ProviderModule | null> = {};

		for (const [scheme, manifest] of Object.entries(providers)) {
			// Try index.js first, fall back to index.ts
			let sourceCode: string;
			try {
				sourceCode = await fetchFileFromGitHub(opts, `${pathJoin(manifest.dir, scheme)}/index.js`);
			} catch (error) {
				modules[scheme] = null;
				continue; // Skip this provider but continue loading others
			}

			if (moduleResolver) {
				// User-provided resolver (for browsers / React Native)
				modules[scheme] = await moduleResolver(scheme, sourceCode);
			} else if (isNode()) {
				// Default: Node.js temp-file resolver
				modules[scheme] = await defaultNodeResolver(scheme, sourceCode);
			}
		}

		return modules;
	}

	/**
	 * Write source to a temp file and dynamically import it.
	 * All Node.js APIs (fs, path, os, url) are lazy-imported so they
	 * are never bundled in frontend / React Native builds.
	 *
	 * Throws a clear error when running outside Node.js.
	 */
	async function defaultNodeResolver(scheme: string, sourceCode: string): Promise<ProviderModule> {
		let fs: typeof import("fs");
		let path: typeof import("path");
		let os: typeof import("os");
		let urlMod: typeof import("url");

		try {
			fs = await import("fs");
			path = await import("path");
			os = await import("os");
			urlMod = await import("url");
		} catch {
			throw new ProcessError({
				code: "NODE_ENV_REQUIRED",
				message: "Default module resolver requires Node.js environment. Please provide a custom resolver for browser or React Native environments."
			});
		}

		const safeName = scheme.replace(/\//g, "_");
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `provider-${safeName}-`));
		const filePath = path.join(tmpDir, "index.js");
		fs.writeFileSync(filePath, sourceCode, "utf-8");

		const mod = await import(urlMod.pathToFileURL(filePath).href);
		return mod.default ?? mod;
	}
}
