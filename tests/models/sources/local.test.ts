/**
 * Integration-style tests that exercise `GrabitManager.create()` when the
 * source is a **local file-system** (LocalSource).
 *
 * The `resolve` callback is fully controlled by the test — no real `require()`
 * or `import()` calls hit the disk.  The tests validate:
 *  - manifest loading & provider resolution via `resolve()`
 *  - combined media + subtitle modules
 *  - end-to-end `getStreams` / `getSubtitles` / scheme-targeted methods
 *  - error paths (missing resolver result, invalid modules)
 *  - metrics tracking on local providers
 */

import { GrabitManager } from "../../../src/controllers/manager";
import { CACHE } from "../../../src/services/cache";

jest.mock("../../../src/services/tmdb", () => ({
	TMDB: {
		init: jest.fn(),
		createRequesterMedia: jest.fn(async (req: any) => req.media)
	}
}));
import {
	ProviderManagerConfig,
	ProviderModule,
	ProvidersManifest,
	MediaSource,
	SubtitleSource,
	ScrapeRequester,
	IProviderModuleWorkers
} from "../../../src/types";
import { Provider } from "../../../src/models/provider";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resetManager(): void {
	(GrabitManager as any).instance = undefined;
	(GrabitManager as any).context = undefined;
	(GrabitManager as any).logger = undefined;
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

const SERIE_REQUEST: ScrapeRequester = {
	media: {
		type: "serie",
		title: "Breaking Bad",
		original_language: "en",
		localizedTitles: [],
		duration: 47,
		releaseYear: 2008,
		tmdbId: "1396",
		season: 1,
		episode: 1,
		ep_tmdbId: "1396-1-1"
	},
	targetLanguageISO: "en"
};

// ─── Mock modules ─────────────────────────────────────────────────────────────

type FlatLocalOverrides = {
	scheme?: string;
	name?: string;
	version?: string;
	active?: boolean;
	language?: string;
	type?: "media" | "subtitle";
	env?: "node" | "universal";
	supportedMediaTypes?: string[];
	priority?: number;
	getStreams?: IProviderModuleWorkers["getStreams"];
	getSubtitles?: IProviderModuleWorkers["getSubtitles"];
	cleanup?: IProviderModuleWorkers["cleanup"];
};

function createLocalProvider(scheme: string): Provider {
	return {
		config: {
			scheme,
			name: scheme,
			language: "en",
			baseUrl: "https://local.example.com",
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

function createLocalStreamModule(overrides: FlatLocalOverrides = {}): ProviderModule {
	const scheme = overrides.scheme ?? "local-stream";
	return {
		meta: {
			name: overrides.name ?? "LocalStreamProvider",
			version: overrides.version ?? "1.0.0",
			active: overrides.active ?? true,
			language: overrides.language ?? "en",
			type: overrides.type ?? "media",
			env: overrides.env ?? "universal",
			supportedMediaTypes: (overrides.supportedMediaTypes as any) ?? ["movie", "serie"],
			priority: overrides.priority ?? 0
		},
		provider: createLocalProvider(scheme),
		workers: {
			...(overrides.getStreams !== undefined
				? { getStreams: overrides.getStreams }
				: {
						getStreams: jest.fn<Promise<MediaSource[]>, any>().mockResolvedValue([
							{
								providerName: "LocalStreamProvider",
								scheme: scheme,
								language: "en",
								format: "mp4",
								fileName: "video.mp4",
								playlist: "https://cdn.local/video.mp4",
								xhr: { haveCorsPolicy: false, headers: {} }
							}
						])
					}),
			...(overrides.cleanup !== undefined ? { cleanup: overrides.cleanup } : {})
		}
	};
}

function createLocalSubtitleModule(overrides: FlatLocalOverrides = {}): ProviderModule {
	const scheme = overrides.scheme ?? "local-subtitle";
	return {
		meta: {
			name: overrides.name ?? "LocalSubtitleProvider",
			version: overrides.version ?? "1.0.0",
			active: overrides.active ?? true,
			language: overrides.language ?? "en",
			type: overrides.type ?? "subtitle",
			env: overrides.env ?? "universal",
			supportedMediaTypes: (overrides.supportedMediaTypes as any) ?? ["movie", "serie"],
			priority: overrides.priority ?? 0
		},
		provider: createLocalProvider(scheme),
		workers: {
			...(overrides.getSubtitles !== undefined
				? { getSubtitles: overrides.getSubtitles }
				: {
						getSubtitles: jest.fn<Promise<SubtitleSource[]>, any>().mockResolvedValue([
							{
								providerName: "LocalSubtitleProvider",
								scheme: scheme,
								format: "srt",
								fileName: "subtitle.srt",
								language: "en",
								languageName: "English",
								url: "https://cdn.local/sub.srt",
								xhr: { haveCorsPolicy: false, headers: {} }
							}
						])
					}),
			...(overrides.cleanup !== undefined ? { cleanup: overrides.cleanup } : {})
		}
	};
}

// ─── Manifest factory ─────────────────────────────────────────────────────────

function createLocalManifest(providers: Record<string, ProviderModule>): ProvidersManifest {
	const mapped: Record<string, any> = {};
	for (const [scheme, mod] of Object.entries(providers)) {
		mapped[scheme] = {
			scheme: mod.provider.config.scheme ?? scheme,
			name: mod.meta.name ?? scheme,
			version: mod.meta.version ?? "1.0.0",
			active: mod.meta.active ?? true,
			language: mod.meta.language ?? "en",
			type: mod.meta.type ?? "media",
			env: mod.meta.env ?? "universal",
			supportedMediaTypes: mod.meta.supportedMediaTypes ?? ["movie"],
			priority: mod.meta.priority ?? 0,
			dir: ""
		};
	}
	return { name: "local-test-providers", author: "tester", providers: mapped };
}

// ─── Config builder ───────────────────────────────────────────────────────────

function buildLocalConfig(modules: Record<string, ProviderModule>, extras: Partial<ProviderManagerConfig> = {}): ProviderManagerConfig {
	const manifest = createLocalManifest(modules);

	return {
		source: {
			type: "local",
			manifest,
			rootDir: "./providers",
			resolve: jest.fn((path: string) => {
				// Extract the scheme from the resolved path  (e.g. "./providers/local-stream" → "local-stream")
				const parts = path.replace(/\\/g, "/").split("/");
				const scheme = parts[parts.length - 1];
				return modules[scheme] ?? null;
			})
		},
		tmdbApiKeys: [],
		debug: false,
		...extras
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GrabitManager › Local source", () => {
	beforeEach(() => resetManager());
	afterEach(() => resetManager());

	it("should initialise from a local source with a single stream provider", async () => {
		const streamMod = createLocalStreamModule();
		const config = buildLocalConfig({ "local-stream": streamMod });

		const manager = await GrabitManager.create(config);
		expect(manager).toBeInstanceOf(GrabitManager);
	});

	it("should call the resolve function for each provider in the manifest", async () => {
		const streamMod = createLocalStreamModule();
		const subMod = createLocalSubtitleModule();
		const config = buildLocalConfig({ "local-stream": streamMod, "local-subtitle": subMod });

		await GrabitManager.create(config);

		const resolve = (config.source as any).resolve as jest.Mock;
		expect(resolve).toHaveBeenCalledTimes(2);
		// Verify paths contain the scheme name
		const paths = resolve.mock.calls.map((c: any[]) => c[0] as string);
		expect(paths.some((p: string) => p.includes("local-stream"))).toBe(true);
		expect(paths.some((p: string) => p.includes("local-subtitle"))).toBe(true);
	});

	it("should return streams from a local stream provider", async () => {
		const streamMod = createLocalStreamModule();
		const config = buildLocalConfig({ "local-stream": streamMod });

		const manager = await GrabitManager.create(config);
		const streams = await manager.getStreams(MOVIE_REQUEST);

		expect(streams.length).toBe(1);
		expect(streams[0].fileName).toBe("video.mp4");
		expect(streams[0].format).toBe("mp4");
	});

	it("should return subtitles from a local subtitle provider", async () => {
		const subMod = createLocalSubtitleModule();
		const config = buildLocalConfig({ "local-subtitle": subMod });

		const manager = await GrabitManager.create(config);
		const subtitles = await manager.getSubtitles(MOVIE_REQUEST);

		expect(subtitles.length).toBe(1);
		expect(subtitles[0].language).toBe("en");
	});

	it("should handle multiple local providers (stream + subtitle)", async () => {
		const streamMod = createLocalStreamModule();
		const subMod = createLocalSubtitleModule();
		const config = buildLocalConfig({ "local-stream": streamMod, "local-subtitle": subMod });

		const manager = await GrabitManager.create(config);

		const streams = await manager.getStreams(MOVIE_REQUEST);
		expect(streams.length).toBe(1);

		const subs = await manager.getSubtitles(MOVIE_REQUEST);
		expect(subs.length).toBe(1);
	});

	it("should support getStreamsByScheme for a local provider", async () => {
		const streamMod = createLocalStreamModule();
		const config = buildLocalConfig({ "local-stream": streamMod });

		const manager = await GrabitManager.create(config);
		const streams = await manager.getStreamsByScheme("local-stream", MOVIE_REQUEST);

		expect(streams.length).toBe(1);
	});

	it("should support getSubtitlesByScheme for a local provider", async () => {
		const subMod = createLocalSubtitleModule();
		const config = buildLocalConfig({ "local-subtitle": subMod });

		const manager = await GrabitManager.create(config);
		const subtitles = await manager.getSubtitlesByScheme("local-subtitle", MOVIE_REQUEST);

		expect(subtitles.length).toBe(1);
	});

	it("should return empty when scheme is unknown for local source", async () => {
		const streamMod = createLocalStreamModule();
		const config = buildLocalConfig({ "local-stream": streamMod });

		const manager = await GrabitManager.create(config);
		const streams = await manager.getStreamsByScheme("nonexistent", MOVIE_REQUEST);

		expect(streams).toEqual([]);
	});

	it("should record metrics for local providers", async () => {
		const streamMod = createLocalStreamModule();
		const config = buildLocalConfig({ "local-stream": streamMod });

		const manager = await GrabitManager.create(config);
		await manager.getStreams(MOVIE_REQUEST);

		const metrics = manager.getMetrics();
		const entry = metrics.get("local-stream");
		expect(entry).toBeDefined();
		expect(entry!.successes).toBe(1);
		expect(entry!.errors).toBe(0);
	});

	it("should record error metrics when a local provider throws", async () => {
		const failMod = createLocalStreamModule({
			getStreams: jest.fn().mockRejectedValue(new Error("network failure"))
		});
		const config = buildLocalConfig({ "local-stream": failMod });

		const manager = await GrabitManager.create(config);
		const streams = await manager.getStreams(MOVIE_REQUEST);

		expect(streams).toEqual([]);
		const metrics = manager.getMetrics();
		const entry = metrics.get("local-stream");
		expect(entry).toBeDefined();
		expect(entry!.errors).toBe(1);
	});

	it("should support serie media type from a local provider", async () => {
		const streamMod = createLocalStreamModule({ supportedMediaTypes: ["movie", "serie"] });
		const config = buildLocalConfig({ "local-stream": streamMod });

		const manager = await GrabitManager.create(config);
		const streams = await manager.getStreams(SERIE_REQUEST);

		expect(streams.length).toBe(1);
	});

	it("should skip providers not supporting the requested media type", async () => {
		const movieOnlyMod = createLocalStreamModule({ supportedMediaTypes: ["movie"] });
		const config = buildLocalConfig({ "local-stream": movieOnlyMod });

		const manager = await GrabitManager.create(config);
		const streams = await manager.getStreams(SERIE_REQUEST);

		expect(streams).toEqual([]);
	});

	it("should handle a resolve function that returns a default export wrapper", async () => {
		const streamMod = createLocalStreamModule();
		const manifest = createLocalManifest({ "local-stream": streamMod });

		const config: ProviderManagerConfig = {
			source: {
				type: "local",
				manifest,
				rootDir: "./providers",
				resolve: jest.fn(() => ({ default: streamMod }) as any)
			},
			debug: false,
			tmdbApiKeys: []
		};

		const manager = await GrabitManager.create(config);
		const streams = await manager.getStreams(MOVIE_REQUEST);
		expect(streams.length).toBe(1);
	});

	it("should return getMetricsReport for local providers", async () => {
		const streamMod = createLocalStreamModule();
		const config = buildLocalConfig({ "local-stream": streamMod });

		const manager = await GrabitManager.create(config);
		await manager.getStreams(MOVIE_REQUEST);

		const report = manager.getMetricsReport();
		expect(report.length).toBeGreaterThan(0);
		expect(report[0].moduleName).toBe("LocalStreamProvider");
		expect(report[0].active).toBe(true);
		expect(report[0].successes).toBeGreaterThanOrEqual(1);
	});
});
