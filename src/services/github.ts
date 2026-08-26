import {
	GithubSource,
	HttpError,
	isHttpError,
	isProcessError,
	ProcessError,
	ExternalProviderManifest,
	ProvidersManifest,
	ProviderModule,
	ProviderModuleManifest
} from "../types/index.ts";
import { ResolvedProviderSource } from "../types/models/Manager.ts";
import { pathJoin } from "../utils/path.ts";
import { isNode, toInternalManifest, filterManifestProviders, scheduleYield } from "../utils/standard.ts";
import { Logger } from "../utils/logger.ts";
import { validateProvidersManifest, validateProviderModules } from "../utils/validator.ts";
import { appFetch } from "./fetcher.ts";
import { createSourceCacheKey } from "./cache.ts";
import * as ProviderStore from "./providerStore.ts";
import pLimit from "p-limit";

/** How many provider bundles are downloaded at once during a cold start. */
export const PROVIDER_FETCH_CONCURRENCY = isNode() ? 6 : 2;

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

function isProviderModuleShape(value: unknown): value is ProviderModule {
	return typeof value === "object" && value !== null && "provider" in value && "meta" in value && "workers" in value;
}

function normalizeResolvedProviderModule(value: unknown): ProviderModule | null {
	let current = value;

	for (let depth = 0; depth < 4; depth++) {
		if (isProviderModuleShape(current)) return current;
		if (typeof current !== "object" || current === null || !("default" in current)) break;

		const next = (current as { default?: unknown }).default;
		if (next === undefined || next === current) break;
		current = next;
	}

	return isProviderModuleShape(current) ? current : null;
}

export namespace GithubService {
	const GITHUB_REGEX = [/^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/, /^github\.com\/([^/]+)\/([^/.]+)(\.git)?$/, /^([^/]+)\/([^/]+)$/];

	export async function initializeProviders(source: GithubSource): Promise<ResolvedProviderSource> {
		// Fetch the manifest (persisted + conditional when a store is configured).
		const fetchOpts = createOptions(source);
		const sourceKey = createSourceCacheKey(source);
		const manifest = await loadManifest(fetchOpts, source, sourceKey);
		// Drop providers the filter excludes before paying any fetch/eval cost.
		const wanted = filterManifestProviders(manifest.providers, source.filter);
		const modules = await fetchModuleFromGithub(fetchOpts, wanted, source, sourceKey);
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
		// Refresh always wants the live manifest, so bypass the persisted copy here.
		const manifest = await githubFetchManifest(fetchOpts);
		return manifest;
	}

	export async function getModule([scheme, manifest]: [string, ProviderModuleManifest], source: GithubSource) {
		const fetchOpts = createOptions(source);
		const sourceKey = createSourceCacheKey(source);
		const modules = await fetchModuleFromGithub(fetchOpts, { [scheme]: manifest }, source, sourceKey);
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

	/** Validate raw manifest.json text and promote it to an internal ProvidersManifest. */
	function parseManifest(opts: GitHubFetchOptions, manifestText: string): ProvidersManifest {
		try {
			// The raw JSON has scheme only as a map key, not inside each entry — parse as ExternalProviderManifest.
			const validated = validateProvidersManifest(JSON.parse(manifestText) as ExternalProviderManifest);
			if (!validated.valid) {
				throw new ProcessError({
					code: "PROVIDERS_MANIFEST_INVALID",
					message: `Invalid GitHub manifest for repo ${opts.owner}/${opts.repo}`,
					details: validated.errors
				});
			}
			// Promote to ProvidersManifest by injecting scheme into each entry.
			return toInternalManifest(validated.manifest);
		} catch (error) {
			if (isHttpError(error) || isProcessError(error)) throw error;
			throw new ProcessError({
				code: "PROVIDERS_MANIFEST_PARSE_ERROR",
				message: `Failed to parse GitHub manifest for repo ${opts.owner}/${opts.repo}`,
				details: error
			});
		}
	}

	/** Fetch the raw manifest.json from a GitHub repo. */
	async function githubFetchManifest(opts: GitHubFetchOptions): Promise<ProvidersManifest> {
		return parseManifest(opts, await fetchFileFromGitHub(opts, "manifest.json"));
	}

	/**
	 * Manifest load with an optional persistent store. Sends a conditional
	 * `If-None-Match`, reuses the persisted manifest on 304, and — when the network
	 * is unreachable — falls back to the persisted copy so a warm start still works
	 * offline. Without a store it is just {@link githubFetchManifest}.
	 */
	async function loadManifest(opts: GitHubFetchOptions, source: GithubSource, sourceKey: string): Promise<ProvidersManifest> {
		const store = source.persistentStore;
		if (!store) return githubFetchManifest(opts);

		const ttl = source.persistentStoreTTL;
		const stored = await ProviderStore.readManifest(store, sourceKey, ttl);
		try {
			const res = await fetchRawFileConditional(opts, "manifest.json", stored?.etag);
			if (res.status === 304 && stored) return stored.manifest;

			const manifest = parseManifest(opts, res.text);
			await ProviderStore.writeManifest(store, sourceKey, { etag: res.etag, manifest }, ttl);
			return manifest;
		} catch (error) {
			if (stored) {
				Logger.debug(`[GithubService] Manifest fetch failed, using persisted copy: ${error instanceof Error ? error.message : error}`);
				return stored.manifest;
			}
			// No persisted fallback — take the full path (raw + REST fallback) so the error is faithful.
			return githubFetchManifest(opts);
		}
	}

	/**
	 * Raw fetch that supports conditional requests. Returns `status: 304` (no body)
	 * when the ETag still matches, otherwise the body and its new ETag. Throws on
	 * other non-OK statuses like the unconditional fetch.
	 */
	async function fetchRawFileConditional(opts: GitHubFetchOptions, filePath: string, etag?: string): Promise<{ status: number; text: string; etag?: string }> {
		const headers: Record<string, string> = { "User-Agent": "grabit-engine" };
		if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
		if (etag) headers["If-None-Match"] = etag;

		const url = `https://raw.githubusercontent.com/${opts.owner}/${opts.repo}/${opts.branch}/${opts.rootDir}${filePath}`;
		const res = await appFetch(url, { headers, clean: true });
		if (res.status === 304) return { status: 304, text: "", etag };
		if (!res.ok) {
			throw new HttpError({
				code: "GITHUB_RAW_ERROR",
				message: `GitHub raw request failed with status ${res.status}: ${res.statusText}`,
				details: await res.text(),
				statusCode: res.status,
				expose: false
			});
		}
		return { status: res.status, text: await res.text(), etag: res.headers?.get?.("etag") ?? undefined };
	}

	/**
	 * Fetch a file's contents over `raw.githubusercontent.com`.
	 *
	 * The REST API's `/contents` endpoint allows only 60 requests per hour per IP when
	 * unauthenticated, and a provider library costs one request per provider plus one for
	 * the manifest on every app start. A few reloads exhaust the quota and GitHub answers
	 * 403 with an empty body — which surfaces as providers that mysteriously fail to load
	 * while others succeed, depending on where in the list the quota ran out.
	 *
	 * The raw host serves identical bytes from a CDN and is not metered by that quota.
	 */
	async function fetchRawFile(opts: GitHubFetchOptions, filePath: string): Promise<string> {
		const headers: Record<string, string> = { "User-Agent": "grabit-engine" };
		// Private repos still need auth here; public ones ignore it.
		if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

		const url = `https://raw.githubusercontent.com/${opts.owner}/${opts.repo}/${opts.branch}/${opts.rootDir}${filePath}`;
		const res = await appFetch(url, { headers, clean: true });
		if (!res.ok) {
			const body = await res.text();
			throw new HttpError({
				code: "GITHUB_RAW_ERROR",
				message: `GitHub raw request failed with status ${res.status}: ${res.statusText}`,
				details: body,
				statusCode: res.status,
				expose: false
			});
		}
		return res.text();
	}

	/**
	 * Fetch a single raw file from a GitHub repo.
	 *
	 * Prefers the unmetered raw host and falls back to the REST API, which covers the cases
	 * raw does not serve (some private-repo token setups, or a raw outage).
	 */
	async function fetchFileFromGitHub(opts: GitHubFetchOptions, filePath: string): Promise<string> {
		try {
			return await fetchRawFile(opts, filePath);
		} catch (error) {
			Logger.debug(`[GithubService] Raw fetch failed for "${filePath}", falling back to the REST API: ` + `${error instanceof Error ? error.message : error}`);
			const apiPath = `/repos/${opts.owner}/${opts.repo}/contents/${opts.rootDir}${filePath}?ref=${opts.branch}`;
			return githubFetch<string>(apiPath, { token: opts.token, raw: true });
		}
	}

	/**
	 * Fetch and resolve every provider listed in `providers`.
	 *
	 * Providers are fetched concurrently: each one is a full HTTPS round-trip, and doing
	 * them one at a time made a cold start cost `providers × latency` before the manager
	 * was usable. `modules` is keyed by distinct schemes, so concurrent writes are safe.
	 *
	 * @param opts       - GitHub repo + auth info
	 * @param providers  - scheme → relative folder path (from manifest.json)
	 * @param source     - the GitHub source (resolver, persistent store, concurrency, yield)
	 * @param sourceKey  - cache key identifying this source, for the persistent store
	 * @returns scheme → resolved ProviderModule
	 */
	async function fetchModuleFromGithub(
		opts: GitHubFetchOptions,
		providers: Record<string, ProviderModuleManifest>,
		source: GithubSource,
		sourceKey: string
	): Promise<Record<string, ProviderModule | null>> {
		const modules: Record<string, ProviderModule | null> = {};
		const moduleResolver = source.moduleResolver;
		const store = source.persistentStore;
		// Yield between compiles off-Node by default, so the UI thread can paint.
		const yieldOnEval = source.yieldOnEval ?? !isNode();
		// Bounded so a large library stays polite to the CDN and to device memory.
		const limit = pLimit({ concurrency: source.concurrency ?? PROVIDER_FETCH_CONCURRENCY });

		await Promise.all(
			Object.entries(providers).map(([scheme, manifest]) =>
				limit(async () => {
					// Reuse persisted source when the version still matches; only fetch on a miss.
					// TTL refreshes the key's expiry on reuse so active versions aren't pruned.
					const ttl = source.persistentStoreTTL;
					let sourceCode: string | null = store ? await ProviderStore.readModuleSource(store, sourceKey, scheme, manifest.version, ttl) : null;
					const fetchPath = `${pathJoin(manifest.dir, scheme)}/index.js`;
					const fullApiUrl = `https://raw.githubusercontent.com/${opts.owner}/${opts.repo}/${opts.branch}/${opts.rootDir}${fetchPath}`;
					if (sourceCode == null) {
						try {
							sourceCode = await fetchFileFromGitHub(opts, fetchPath);
							if (store) await ProviderStore.writeModuleSource(store, sourceKey, scheme, manifest.version, sourceCode, ttl);
						} catch (error) {
							Logger.error(
								`[GithubService] Failed to fetch source for provider "${scheme}":\n` +
									`  URL: ${fullApiUrl}\n` +
									`  rootDir: "${opts.rootDir || "(none)"}"\n` +
									`  manifest.dir: "${manifest.dir ?? "(none)"}"\n` +
									`  Error: ${error instanceof Error ? error.message : error}`
							);
							modules[scheme] = null;
							return; // Skip this provider but continue loading others
						}
					}

					try {
						// Give the event loop a turn before the synchronous compile below.
						if (yieldOnEval) await scheduleYield();
						if (moduleResolver) {
							// User-provided resolver (for browsers / React Native)
							modules[scheme] = normalizeResolvedProviderModule(await moduleResolver(scheme, sourceCode));
						} else if (isNode()) {
							// Default: Node.js temp-file resolver
							modules[scheme] = await defaultNodeResolver(scheme, sourceCode);
						}

						if (modules[scheme] === null) {
							Logger.error(`[GithubService] Provider "${scheme}" resolved, but did not export a valid ProviderModule shape.`);
						} else {
							// Always ensure meta.scheme reflects the canonical map key regardless
							// of what the provider bundle declares internally.
							modules[scheme]!.meta.scheme = scheme;
						}
					} catch (error) {
						Logger.error(`[GithubService] Failed to resolve module for provider "${scheme}": ${error instanceof Error ? error.message : error}`);
						modules[scheme] = null;
					}
				})
			)
		);

		return modules;
	}

	/**
	 * Write source to a temp file and dynamically import it.
	 * All Node.js APIs (fs, path, os, url) are lazy-imported so they
	 * are never bundled in frontend / React Native builds.
	 *
	 * IMPORTANT: imports are wrapped in `new Function` so Metro's static
	 * analyzer never sees them. A plain `await import("fs")` — even inside
	 * an `isNode()` guard — is still added to Metro's module graph, and since
	 * Node built-ins have no file path the Expo serializer crashes with
	 * `The "to" argument must be of type string. Received undefined`.
	 *
	 * Throws a clear error when running outside Node.js.
	 */
	async function defaultNodeResolver(scheme: string, sourceCode: string): Promise<ProviderModule | null> {
		let fs: typeof import("fs");
		let path: typeof import("path");
		let os: typeof import("os");
		let urlMod: typeof import("url");

		// new Function hides the import() calls from Metro's static analyzer so
		// Node built-in modules are never added to the bundle graph.
		const _import = new Function("id", "return import(id)") as (id: string) => Promise<any>;

		try {
			fs = await _import("fs");
			path = await _import("path");
			os = await _import("os");
			urlMod = await _import("url");
		} catch {
			throw new ProcessError({
				code: "NODE_ENV_REQUIRED",
				message: "Default module resolver requires Node.js environment. Please provide a custom resolver for browser or React Native environments."
			});
		}

		const safeName = scheme.replace(/\//g, "_");
		// Async I/O: these run once per provider during startup and used to block the event loop.
		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `provider-${safeName}-`));
		const filePath = path.join(tmpDir, "index.js");
		await fs.promises.writeFile(filePath, sourceCode, "utf-8");

		try {
			// _import is used here too — the href is runtime-computed so Metro
			// couldn't resolve it anyway, but _import keeps the pattern consistent.
			const mod = await _import(urlMod.pathToFileURL(filePath).href);
			return normalizeResolvedProviderModule(mod);
		} catch (err: unknown) {
			// Detect "Cannot find package" errors — these almost always mean the
			// provider bundle contains a direct import of an npm package that
			// should instead be accessed through ProviderContext.
			const msg = err instanceof Error ? err.message : String(err);
			const pkgMatch = msg.match(/Cannot find package '([^']+)'/);
			if (pkgMatch) {
				throw new ProcessError({
					code: "PROVIDER_MISSING_PACKAGE",
					message:
						`Failed to load provider "${scheme}": Cannot find package '${pkgMatch[1]}'. ` +
						`Provider bundles run in an isolated temp directory with no node_modules. ` +
						`If this is a runtime-provided library (cheerio, puppeteer, etc.), ` +
						`the provider must use the ProviderContext (ctx) argument instead of importing it directly. ` +
						`Re-bundle with "npx bundle-provider" to see which imports need fixing.`
				});
			}
			throw err;
		} finally {
			// Node reads the file eagerly during import(), and the module now lives in the
			// ESM registry — so the directory can go. Without this every provider left a
			// temp directory behind on every process start, forever.
			void fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
		}
	}
}
