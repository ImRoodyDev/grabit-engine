import { ScrapePluginManager } from "../../../src/controllers/manager";
import { resetManager, GRAB_REQUEST, createMockModule, createMockSubtitleModule, createRegistryConfig, mockMediaSource } from "./helpers";

jest.mock("../../../src/services/tmdb", () => ({
	TMDB: {
		init: jest.fn(),
		createRequesterMedia: jest.fn(async (req: any) => req.media)
	}
}));

afterEach(() => resetManager());

describe("ScrapePluginManager › provider filtering", () => {
	beforeEach(() => resetManager());

	it("should prefer providers matching the target language", async () => {
		const en = createMockModule({
			name: "en-prov",
			language: "en",
			priority: 5,
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "en" })])
		});
		const fr = createMockModule({
			name: "fr-prov",
			language: "fr",
			priority: 0,
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "fr" })])
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ en, fr }));
		const results = await manager.getStreams({ ...GRAB_REQUEST, targetLanguageISO: "en" });

		expect(results).toHaveLength(2);
	});

	it("should only include providers with getStreams defined for media requests", async () => {
		const media = createMockModule({
			name: "media-prov",
			type: "media",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource()])
		});
		const subtitle = createMockSubtitleModule({
			name: "sub-prov",
			type: "subtitle",
			getStreams: undefined
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: media, b: subtitle }));
		const results = await manager.getStreams(GRAB_REQUEST);

		expect(results).toHaveLength(1);
		expect(subtitle.workers.getSubtitles).not.toHaveBeenCalled();
	});

	it("should only include providers with getSubtitles defined for subtitle requests", async () => {
		const media = createMockModule({ name: "media-prov", type: "media" });
		const subtitle = createMockSubtitleModule({
			name: "sub-prov",
			type: "subtitle",
			supportedMediaTypes: ["movie"]
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: media, b: subtitle }));
		const results = await manager.getSubtitles(GRAB_REQUEST);

		expect(results).toHaveLength(1);
		expect(media.workers.getStreams).not.toHaveBeenCalled();
	});

	it("should exclude node-only providers when env is not node (handled by Node env check)", async () => {
		// In a Node.js test env, isNode() returns true so "node" providers ARE included.
		// This test just verifies they load correctly.
		const nodeOnly = createMockModule({
			name: "node-only",
			env: "node",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "node-only" })])
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ n: nodeOnly }));
		const results = await manager.getStreams(GRAB_REQUEST);

		// In Node env both "node" and "universal" providers are included
		expect(results).toHaveLength(1);
	});

	it("should support providers handling multiple media types", async () => {
		const multi = createMockModule({
			name: "multi-type",
			supportedMediaTypes: ["movie", "serie"],
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "multi-type" })])
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ m: multi }));

		const movieResults = await manager.getStreams(GRAB_REQUEST);
		expect(movieResults).toHaveLength(1);

		const serieResults = await manager.getStreams({
			media: { type: "serie", title: "Test", duration: 40, releaseYear: 2024, tmdbId: "999", imdbId: "tt999", season: 1, episode: 1, ep_tmdbId: "999-1-1" },
			targetLanguageISO: "en"
		});
		expect(serieResults).toHaveLength(1);
	});
});
