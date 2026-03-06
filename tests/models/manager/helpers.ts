/**
 * Shared test helpers for ScrapePluginManager test suites.
 *
 * Centralises stubs, factories, and reset utilities so every split test file
 * operates against an identical, deterministic baseline.
 */
import { ScrapePluginManager } from "../../../src/controllers/manager";
import { CACHE } from "../../../src/services/cache";
import { ProviderModule, ProviderManagerConfig, MediaSource, SubtitleSource, ScrapeRequester, IProviderModuleWorkers } from "../../../src/types";
import { MovieMedia, SerieMedia } from "../../../src/types/input/Media";
import { Provider } from "../../../src/models/provider";

export { ScrapePluginManager as ScrapePluginManager } from "../../../src/controllers/manager";
export { CACHE } from "../../../src/services/cache";

// ─── Singleton reset ──────────────────────────────────────────────────────────

/** Reset the ScrapePluginManager singleton + clear the global cache between tests */
export function resetManager(): void {
	const instance = (ScrapePluginManager as any).instance as ScrapePluginManager | undefined;
	if (instance) instance.destroy();
	CACHE.clear();
}

// ─── Media stubs ──────────────────────────────────────────────────────────────

export const MOVIE_MEDIA: MovieMedia = {
	type: "movie",
	title: "Test Movie",
	original_language: "en",
	localizedTitles: [],
	duration: 120,
	releaseYear: 2024,
	tmdbId: "12345",
	imdbId: "tt0000001"
};

export const SERIE_MEDIA: SerieMedia = {
	type: "serie",
	title: "Test Serie",
	original_language: "en",
	localizedTitles: [],
	duration: 45,
	releaseYear: 2024,
	tmdbId: "67890",
	imdbId: "tt0000002",
	season: 1,
	episode: 1,
	ep_tmdbId: "67890-1-1"
};

export const GRAB_REQUEST: ScrapeRequester = {
	media: MOVIE_MEDIA,
	targetLanguageISO: "en"
};

export const SERIE_GRAB_REQUEST: ScrapeRequester = {
	media: SERIE_MEDIA,
	targetLanguageISO: "en"
};

// ─── Source factories ─────────────────────────────────────────────────────────

/** Build a minimal `MediaSource` */
export function mockMediaSource(partial: Partial<MediaSource> = {}): MediaSource {
	return {
		providerName: "mock",
		language: "en",
		format: "mp4",
		fileName: "video.mp4",
		playlist: "https://example.com/video.mp4",
		xhr: { haveCorsPolicy: false, headers: {} },
		...partial
	} as MediaSource;
}

/** Build a minimal `SubtitleSource` */
export function mockSubtitleSource(partial: Partial<SubtitleSource> = {}): SubtitleSource {
	return {
		providerName: "mock-sub",
		format: "srt",
		fileName: "subtitle.srt",
		language: "en",
		languageName: "English",
		url: "https://example.com/sub.srt",
		xhr: { haveCorsPolicy: false, headers: {} },
		...partial
	} as SubtitleSource;
}

// ─── Module factories ─────────────────────────────────────────────────────────

/** Flat option bag accepted by createMockModule / createMockSubtitleModule.
 *  Maps the old flat ProviderModule shape to the new { meta, provider, workers } structure.
 */
type FlatModuleOverrides = {
	name?: string;
	scheme?: string;
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

/** Build a mock `Provider` with a minimal config and `isMediaSupported` always returning `true`. */
function createMockProvider(scheme: string): Provider {
	return {
		config: {
			scheme,
			name: scheme,
			language: "en",
			baseUrl: "https://example.com",
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

/** Build a stub `ProviderModule` with sensible defaults. Override any field. */
export function createMockModule(overrides: FlatModuleOverrides = {}): ProviderModule {
	const name = overrides.name ?? "mock-provider";
	const scheme = overrides.scheme ?? name;
	return {
		meta: {
			name,
			version: overrides.version ?? "1.0.0",
			active: overrides.active ?? true,
			language: overrides.language ?? "en",
			type: overrides.type ?? "media",
			env: overrides.env ?? "universal",
			supportedMediaTypes: (overrides.supportedMediaTypes as any) ?? ["movie"],
			priority: overrides.priority ?? 0
		},
		provider: createMockProvider(scheme),
		workers: {
			...(overrides.getStreams !== undefined ? { getStreams: overrides.getStreams } : { getStreams: jest.fn().mockResolvedValue([mockMediaSource()]) }),
			...(overrides.getSubtitles !== undefined ? { getSubtitles: overrides.getSubtitles } : {}),
			...(overrides.cleanup !== undefined ? { cleanup: overrides.cleanup } : {})
		}
	};
}

/** Build a stub subtitle `ProviderModule` */
export function createMockSubtitleModule(overrides: FlatModuleOverrides = {}): ProviderModule {
	const name = overrides.name ?? "mock-subtitle-provider";
	const scheme = overrides.scheme ?? name;
	return {
		meta: {
			name,
			version: overrides.version ?? "1.0.0",
			active: overrides.active ?? true,
			language: overrides.language ?? "en",
			type: overrides.type ?? "subtitle",
			env: overrides.env ?? "universal",
			supportedMediaTypes: (overrides.supportedMediaTypes as any) ?? ["movie"],
			priority: overrides.priority ?? 0
		},
		provider: createMockProvider(scheme),
		workers: {
			...(overrides.getSubtitles !== undefined
				? { getSubtitles: overrides.getSubtitles }
				: { getSubtitles: jest.fn().mockResolvedValue([mockSubtitleSource()]) }),
			...(overrides.getStreams !== undefined ? { getStreams: overrides.getStreams } : {}),
			...(overrides.cleanup !== undefined ? { cleanup: overrides.cleanup } : {})
		}
	};
}

// ─── Config factories ─────────────────────────────────────────────────────────

/** Build a `RegistrySource`-based config — no network, no file-system */
export function createRegistryConfig(modules: Record<string, ProviderModule>, extras: Partial<ProviderManagerConfig> = {}): ProviderManagerConfig {
	return {
		source: {
			type: "registry",
			name: "test-registry",
			providers: modules
		},
		tmdbApiKeys: [],
		debug: false,
		...extras
	};
}
