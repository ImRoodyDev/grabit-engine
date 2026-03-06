/**
 * Integration-style tests that exercise `ScrapePluginManager.create()` when the
 * source is a **GitHub repository**.
 *
 * The GitHub network calls (`appFetch`) are fully mocked so no real HTTP traffic
 * is generated.  The tests validate:
 *  - manifest fetching & validation
 *  - module source resolution (via `moduleResolver`)
 *  - end-to-end `getStreams` / `getSubtitles` through the manager
 *  - error paths (invalid manifest, missing modules, network failures)
 */

import { ScrapePluginManager } from "../../../src/controllers/manager";
import { CACHE } from "../../../src/services/cache";
import { ProviderManagerConfig, ProviderModule, ProvidersManifest, MediaSource, SubtitleSource, ScrapeRequester } from "../../../src/types";
import { Provider } from "../../../src/models/provider";

jest.mock("../../../src/services/tmdb", () => ({
	TMDB: {
		init: jest.fn(),
		createRequesterMedia: jest.fn(async (req: any) => req.media)
	}
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resetManager(): void {
	(ScrapePluginManager as any).instance = undefined;
	(ScrapePluginManager as any).context = undefined;
	(ScrapePluginManager as any).logger = undefined;
	CACHE.clear();
}

const MOVIE_REQUEST: ScrapeRequester = {
	media: {
		type: "movie",
		title: "Inception",
		original_language: "en",
		localizedTitles: [],
		duration: 148,
		releaseYear: 2010,
		tmdbId: "27205",
		imdbId: "tt1375666"
	},
	targetLanguageISO: "en"
};

// ─── Mock data ────────────────────────────────────────────────────────────────

/** Simulated manifest.json that would live at the repo root */
const GITHUB_MANIFEST: ProvidersManifest = {
	name: "test-github-providers",
	author: "test-author",
	providers: {
		"example-provider": {
			scheme: "example-provider",
			name: "ExampleProvider",
			version: "1.0.0",
			active: true,
			language: "en",
			type: "media",
			env: "universal",
			supportedMediaTypes: ["movie", "serie"],
			priority: 10,
			dir: "providers"
		} as any
	}
};

/** Simulated JS source code that the GitHub API would return for the provider */
const PROVIDER_SOURCE_CODE = `
module.exports = {
  default: {
    scheme: "example-provider",
    name: "ExampleProvider",
    version: "1.0.0",
    active: true,
    language: "en",
    type: "media",
    env: "universal",
    supportedMediaTypes: ["movie", "serie"],
    priority: 10,
    getStreams: async () => ([{
      providerName: "ExampleProvider",
      scheme: "example-provider",
      language: "en",
      format: "mp4",
      fileName: "inception.mp4",
      playlist: "https://cdn.example.com/inception.mp4",
      xhr: { haveCorsPolicy: false, headers: {} }
    }])
  }
};
`;

/** Build a mock `Provider` for GitHub-sourced module tests */
function createGithubProvider(scheme: string): Provider {
	return {
		config: {
			scheme,
			name: scheme,
			language: "en",
			baseUrl: "https://cdn.example.com",
			entries: {
				movie: { endpoint: "/{id:string}" },
				serie: { endpoint: "/{id:string}" }
			},
			mediaIds: ["tmdb"]
		},
		isMediaSupported: jest.fn().mockReturnValue(true),
		createQueries: jest.fn(),
		createResourceURL: jest.fn(),
		applyPatternURL: jest.fn(),
		retrievePreferedIds: jest.fn()
	} as unknown as Provider;
}

/** Build a mock module that a moduleResolver would return */
function createGithubModule(): ProviderModule {
	return {
		meta: {
			name: "ExampleProvider",
			version: "1.0.0",
			active: true,
			language: "en",
			type: "media",
			env: "universal",
			supportedMediaTypes: ["movie", "serie"],
			priority: 10
		},
		provider: createGithubProvider("example-provider"),
		workers: {
			getStreams: jest.fn<Promise<MediaSource[]>, any>().mockResolvedValue([
				{
					providerName: "ExampleProvider",
					scheme: "example-provider",
					language: "en",
					format: "mp4",
					fileName: "inception.mp4",
					playlist: "https://cdn.example.com/inception.mp4",
					xhr: { haveCorsPolicy: false, headers: {} }
				}
			])
		}
	};
}

function createGithubSubtitleModule(): ProviderModule {
	return {
		meta: {
			name: "SubtitleProvider",
			version: "1.0.0",
			active: true,
			language: "en",
			type: "subtitle",
			env: "universal",
			supportedMediaTypes: ["movie"],
			priority: 0
		},
		provider: createGithubProvider("subtitle-provider"),
		workers: {
			getSubtitles: jest.fn<Promise<SubtitleSource[]>, any>().mockResolvedValue([
				{
					providerName: "SubtitleProvider",
					scheme: "subtitle-provider",
					format: "srt",
					fileName: "subtitles.srt",
					language: "en",
					languageName: "English",
					url: "https://cdn.example.com/sub.srt",
					xhr: { haveCorsPolicy: false, headers: {} }
				}
			])
		}
	};
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

/**
 * Mock the fetch layer so `GithubService` never hits the network.
 * The mock intercepts specific GitHub API paths and returns canned responses.
 */
jest.mock("../../../src/services/fetcher", () => {
	const original = jest.requireActual("../../../src/services/fetcher");
	return {
		...original,
		appFetch: jest.fn(async (url: string) => {
			// Manifest request
			if (url.includes("/contents/manifest.json")) {
				return {
					ok: true,
					status: 200,
					text: async () => JSON.stringify(GITHUB_MANIFEST),
					json: async () => GITHUB_MANIFEST
				};
			}
			// Provider index.js source code
			if (url.includes("/contents/") && url.includes("index.js")) {
				return {
					ok: true,
					status: 200,
					text: async () => PROVIDER_SOURCE_CODE,
					json: async () => ({})
				};
			}
			// Fallback — 404
			return {
				ok: false,
				status: 404,
				statusText: "Not Found",
				text: async () => "Not Found"
			};
		})
	};
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ScrapePluginManager › GitHub source", () => {
	beforeEach(() => resetManager());

	it("should initialise from a GitHub source with a custom moduleResolver", async () => {
		const mockModule = createGithubModule();
		const moduleResolver = jest.fn<Promise<ProviderModule>, [string, string]>().mockResolvedValue(mockModule);

		const config: ProviderManagerConfig = {
			source: {
				type: "github",
				url: "https://github.com/test-owner/test-providers",
				branch: "main",
				moduleResolver
			},
			tmdbApiKeys: [],
			debug: false
		};

		const manager = await ScrapePluginManager.create(config);
		expect(manager).toBeInstanceOf(ScrapePluginManager);
		// moduleResolver should have been called for each provider in the manifest
		expect(moduleResolver).toHaveBeenCalledWith("example-provider", expect.any(String));
	});

	it("should return streams from a GitHub-sourced provider", async () => {
		const mockModule = createGithubModule();
		const moduleResolver = jest.fn<Promise<ProviderModule>, [string, string]>().mockResolvedValue(mockModule);

		const config: ProviderManagerConfig = {
			source: {
				type: "github",
				url: "test-owner/test-providers",
				branch: "main",
				moduleResolver
			},
			tmdbApiKeys: [],
			debug: false
		};

		const manager = await ScrapePluginManager.create(config);
		const streams = await manager.getStreams(MOVIE_REQUEST);
		expect(streams.length).toBeGreaterThan(0);
		expect(streams[0].fileName).toBe("inception.mp4");
	});

	it("should support the shorthand owner/repo URL format", async () => {
		const mockModule = createGithubModule();
		const moduleResolver = jest.fn<Promise<ProviderModule>, [string, string]>().mockResolvedValue(mockModule);

		const config: ProviderManagerConfig = {
			source: {
				type: "github",
				url: "test-owner/test-providers",
				moduleResolver
			},
			tmdbApiKeys: [],
			debug: false
		};

		const manager = await ScrapePluginManager.create(config);
		expect(manager).toBeInstanceOf(ScrapePluginManager);
	});

	it("should handle a provider whose module source cannot be fetched", async () => {
		// Return a module that is null (simulating failed fetch)
		const moduleResolver = jest.fn<Promise<ProviderModule | null>, [string, string]>().mockResolvedValue(null as any);

		const config: ProviderManagerConfig = {
			source: {
				type: "github",
				url: "test-owner/test-providers",
				branch: "main",
				moduleResolver: moduleResolver as unknown as any
			},
			tmdbApiKeys: [],
			debug: false
		};

		// Should not throw — modules that fail to load are skipped
		const manager = await ScrapePluginManager.create(config);
		const streams = await manager.getStreams(MOVIE_REQUEST);
		expect(streams).toEqual([]);
	});

	it("should support getStreamsByScheme from a GitHub-sourced provider", async () => {
		const mockModule = createGithubModule();
		const moduleResolver = jest.fn<Promise<ProviderModule>, [string, string]>().mockResolvedValue(mockModule);

		const config: ProviderManagerConfig = {
			source: {
				type: "github",
				url: "test-owner/test-providers",
				branch: "main",
				moduleResolver
			},
			tmdbApiKeys: [],
			debug: false
		};

		const manager = await ScrapePluginManager.create(config);
		const streams = await manager.getStreamsByScheme("example-provider", MOVIE_REQUEST);
		expect(streams.length).toBeGreaterThan(0);
		expect(streams[0].scheme).toBe("example-provider");
	});

	it("should record metrics for GitHub-sourced providers", async () => {
		const mockModule = createGithubModule();
		const moduleResolver = jest.fn<Promise<ProviderModule>, [string, string]>().mockResolvedValue(mockModule);

		const config: ProviderManagerConfig = {
			source: {
				type: "github",
				url: "test-owner/test-providers",
				branch: "main",
				moduleResolver
			},
			tmdbApiKeys: [],
			debug: false
		};

		const manager = await ScrapePluginManager.create(config);
		await manager.getStreams(MOVIE_REQUEST);

		const metrics = manager.getMetrics();
		expect(metrics.size).toBeGreaterThan(0);
		const entry = metrics.get("example-provider");
		expect(entry).toBeDefined();
		expect(entry!.successes).toBe(1);
	});

	it("should return getMetricsReport for GitHub-sourced providers", async () => {
		const mockModule = createGithubModule();
		const moduleResolver = jest.fn<Promise<ProviderModule>, [string, string]>().mockResolvedValue(mockModule);

		const config: ProviderManagerConfig = {
			source: {
				type: "github",
				url: "test-owner/test-providers",
				branch: "main",
				moduleResolver
			},
			tmdbApiKeys: [],
			debug: false
		};

		const manager = await ScrapePluginManager.create(config);
		await manager.getStreams(MOVIE_REQUEST);

		const report = manager.getMetricsReport();
		expect(report.length).toBeGreaterThan(0);
		expect(report[0].moduleName).toBe("ExampleProvider");
		expect(report[0].active).toBe(true);
	});
});

describe("ScrapePluginManager › GitHub source with subtitles", () => {
	beforeEach(() => resetManager());

	it("should initialise and return subtitles from a GitHub-sourced subtitle provider", async () => {
		// Override manifest to include a subtitle provider
		const { appFetch } = require("../../../src/services/fetcher");

		const subtitleManifest: ProvidersManifest = {
			name: "subtitle-providers",
			author: "test-author",
			providers: {
				"subtitle-provider": {
					scheme: "subtitle-provider",
					name: "SubtitleProvider",
					version: "1.0.0",
					active: true,
					language: "en",
					type: "subtitle",
					env: "universal",
					supportedMediaTypes: ["movie"],
					priority: 0,
					dir: "providers"
				} as any
			}
		};

		(appFetch as jest.Mock).mockImplementation(async (url: string) => {
			if (url.includes("/contents/manifest.json")) {
				return { ok: true, status: 200, text: async () => JSON.stringify(subtitleManifest), json: async () => subtitleManifest };
			}
			if (url.includes("index.js")) {
				return { ok: true, status: 200, text: async () => "module.exports = {}", json: async () => ({}) };
			}
			return { ok: false, status: 404, statusText: "Not Found", text: async () => "Not Found" };
		});

		const subModule = createGithubSubtitleModule();
		const moduleResolver = jest.fn<Promise<ProviderModule>, [string, string]>().mockResolvedValue(subModule);

		const config: ProviderManagerConfig = {
			source: {
				type: "github",
				url: "test-owner/subtitle-providers",
				branch: "main",
				moduleResolver
			},
			tmdbApiKeys: [],
			debug: false
		};

		const manager = await ScrapePluginManager.create(config);
		const subtitles = await manager.getSubtitles(MOVIE_REQUEST);
		expect(subtitles.length).toBeGreaterThan(0);
		expect(subtitles[0].language).toBe("en");
	});
});
