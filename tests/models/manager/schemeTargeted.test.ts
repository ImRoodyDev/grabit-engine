import { GrabitManager } from "../../../src/controllers/manager";
import { resetManager, GRAB_REQUEST, createMockModule, createMockSubtitleModule, createRegistryConfig, mockMediaSource, mockSubtitleSource } from "./helpers";

jest.mock("../../../src/services/tmdb", () => ({
	TMDB: {
		init: jest.fn(),
		createRequesterMedia: jest.fn(async (req: any) => req.media)
	}
}));

afterEach(() => resetManager());

describe("GrabitManager › getStreamsByScheme", () => {
	beforeEach(() => resetManager());

	it("should return streams from the targeted scheme only", async () => {
		const modA = createMockModule({
			scheme: "alpha",
			name: "provider-a",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "A" })])
		});
		const modB = createMockModule({
			scheme: "beta",
			name: "provider-b",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "B" })])
		});

		const manager = await GrabitManager.create(createRegistryConfig({ alpha: modA, beta: modB }));
		const results = await manager.getStreamsByScheme("alpha", GRAB_REQUEST);

		expect(results).toHaveLength(1);
		expect(results[0].providerName).toBe("A");
		// Other provider should not be called
		expect(modB.workers.getStreams).not.toHaveBeenCalled();
	});

	it("should return empty array for an unknown scheme", async () => {
		const mod = createMockModule({ name: "known" });
		const manager = await GrabitManager.create(createRegistryConfig({ known: mod }));

		const results = await manager.getStreamsByScheme("unknown", GRAB_REQUEST);
		expect(results).toEqual([]);
	});

	it("should return empty array when the scheme's provider is inactive", async () => {
		const mod = createMockModule({
			scheme: "deactivated",
			name: "deactivated",
			active: false,
			getStreams: jest.fn().mockResolvedValue([mockMediaSource()])
		});
		const manager = await GrabitManager.create(createRegistryConfig({ deactivated: mod }));

		const results = await manager.getStreamsByScheme("deactivated", GRAB_REQUEST);
		expect(results).toEqual([]);
		expect(mod.workers.getStreams).not.toHaveBeenCalled();
	});

	it("should return empty array when the scheme's provider has no getStreams", async () => {
		const subtitleOnly = createMockSubtitleModule({
			scheme: "sub-only",
			name: "sub-only",
			getStreams: undefined
		});
		const manager = await GrabitManager.create(createRegistryConfig({ "sub-only": subtitleOnly }));

		const results = await manager.getStreamsByScheme("sub-only", GRAB_REQUEST);
		expect(results).toEqual([]);
	});

	it("should handle a scheme provider that throws", async () => {
		const failing = createMockModule({
			name: "boom",
			getStreams: jest.fn().mockRejectedValue(new Error("explosion"))
		});

		const manager = await GrabitManager.create(createRegistryConfig({ boom: failing }));
		const results = await manager.getStreamsByScheme("boom", GRAB_REQUEST);

		expect(results).toEqual([]);
	});

	it("should record metrics for scheme-targeted scraping", async () => {
		const mod = createMockModule({
			scheme: "metric-scheme",
			name: "metric-scheme",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "metric-scheme" })])
		});

		const manager = await GrabitManager.create(createRegistryConfig({ "metric-scheme": mod }, { scrapeConfig: { maxAttempts: 1 } }));

		await manager.getStreamsByScheme("metric-scheme", GRAB_REQUEST);
		await manager.getStreamsByScheme("metric-scheme", GRAB_REQUEST);

		const record = manager.getMetrics().get("metric-scheme");
		expect(record).toBeDefined();
		expect(record!.successes).toBe(2);
	});
});

describe("GrabitManager › getSubtitlesByScheme", () => {
	beforeEach(() => resetManager());

	it("should return subtitles from the targeted scheme only", async () => {
		const subA = createMockSubtitleModule({
			scheme: "sub-a",
			name: "sub-a",
			getSubtitles: jest.fn().mockResolvedValue([mockSubtitleSource({ providerName: "sub-A" })])
		});
		const subB = createMockSubtitleModule({
			scheme: "sub-b",
			name: "sub-b",
			getSubtitles: jest.fn().mockResolvedValue([mockSubtitleSource({ providerName: "sub-B" })])
		});

		const manager = await GrabitManager.create(createRegistryConfig({ "sub-a": subA, "sub-b": subB }));
		const results = await manager.getSubtitlesByScheme("sub-a", GRAB_REQUEST);

		expect(results).toHaveLength(1);
		expect(results[0].providerName).toBe("sub-A");
		expect(subB.workers.getSubtitles).not.toHaveBeenCalled();
	});

	it("should return empty array for an unknown scheme", async () => {
		const sub = createMockSubtitleModule({ scheme: "sub-known", name: "sub-known" });
		const manager = await GrabitManager.create(createRegistryConfig({ "sub-known": sub }));

		const results = await manager.getSubtitlesByScheme("nope", GRAB_REQUEST);
		expect(results).toEqual([]);
	});

	it("should return empty array when the scheme's provider has no getSubtitles", async () => {
		const mediaOnly = createMockModule({ scheme: "media-only", name: "media-only" });
		const manager = await GrabitManager.create(createRegistryConfig({ "media-only": mediaOnly }));

		const results = await manager.getSubtitlesByScheme("media-only", GRAB_REQUEST);
		expect(results).toEqual([]);
	});

	it("should return empty array when the scheme's provider is inactive", async () => {
		const sub = createMockSubtitleModule({
			scheme: "inactive-sub",
			name: "inactive-sub",
			active: false,
			getSubtitles: jest.fn().mockResolvedValue([mockSubtitleSource()])
		});
		const manager = await GrabitManager.create(createRegistryConfig({ "inactive-sub": sub }));

		const results = await manager.getSubtitlesByScheme("inactive-sub", GRAB_REQUEST);
		expect(results).toEqual([]);
		expect(sub.workers.getSubtitles).not.toHaveBeenCalled();
	});
});
