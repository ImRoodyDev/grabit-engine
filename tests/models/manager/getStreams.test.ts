import { ScrapePluginManager } from "../../../src/controllers/manager";
import { resetManager, GRAB_REQUEST, SERIE_GRAB_REQUEST, createMockModule, createRegistryConfig, mockMediaSource } from "./helpers";

jest.mock("../../../src/services/tmdb", () => ({
	TMDB: {
		init: jest.fn(),
		createRequesterMedia: jest.fn(async (req: any) => req.media)
	}
}));

afterEach(() => resetManager());

describe("ScrapePluginManager › getStreams", () => {
	beforeEach(() => resetManager());

	it("should return combined sources from multiple providers", async () => {
		const modA = createMockModule({
			name: "provider-a",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "A" })])
		});
		const modB = createMockModule({
			name: "provider-b",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "B" })])
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: modA, b: modB }));
		const results = await manager.getStreams(GRAB_REQUEST);

		expect(results).toHaveLength(2);
		expect(results.map((r) => r.providerName).sort()).toEqual(["A", "B"]);
	});

	it("should return empty array when no providers support the requested media type", async () => {
		const mod = createMockModule({ supportedMediaTypes: ["serie"] });
		const manager = await ScrapePluginManager.create(createRegistryConfig({ test: mod }));

		const results = await manager.getStreams(GRAB_REQUEST);

		expect(results).toEqual([]);
	});

	it("should skip inactive providers", async () => {
		const active = createMockModule({
			name: "active",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "active" })])
		});
		const inactive = createMockModule({
			name: "inactive",
			active: false,
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "inactive" })])
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: active, b: inactive }));
		const results = await manager.getStreams(GRAB_REQUEST);

		expect(results).toHaveLength(1);
		expect(results[0].providerName).toBe("active");
		expect(inactive.workers.getStreams).not.toHaveBeenCalled();
	});

	it("should handle a provider that throws without breaking others", async () => {
		const good = createMockModule({
			name: "good",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "good" })])
		});
		const bad = createMockModule({
			name: "bad",
			getStreams: jest.fn().mockRejectedValue(new Error("network down"))
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: good, b: bad }));
		const results = await manager.getStreams(GRAB_REQUEST);

		expect(results).toHaveLength(1);
		expect(results[0].providerName).toBe("good");
	});

	it("should flatten multi-source provider results into a single array", async () => {
		const multi = createMockModule({
			name: "multi",
			getStreams: jest
				.fn()
				.mockResolvedValue([mockMediaSource({ providerName: "multi", fileName: "a.mp4" }), mockMediaSource({ providerName: "multi", fileName: "b.mp4" })])
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ m: multi }));
		const results = await manager.getStreams(GRAB_REQUEST);

		expect(results).toHaveLength(2);
		expect(results.every((r) => r.providerName === "multi")).toBe(true);
	});

	it("should handle providers that return an empty array", async () => {
		const empty = createMockModule({
			name: "empty",
			getStreams: jest.fn().mockResolvedValue([])
		});
		const valid = createMockModule({
			name: "valid",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "valid" })])
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ e: empty, v: valid }));
		const results = await manager.getStreams(GRAB_REQUEST);

		expect(results).toHaveLength(1);
		expect(results[0].providerName).toBe("valid");
	});

	it("should not call providers that don't support the requested media type", async () => {
		const movieOnly = createMockModule({
			name: "movie-only",
			supportedMediaTypes: ["movie"],
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "movie-only" })])
		});
		const serieOnly = createMockModule({
			name: "serie-only",
			supportedMediaTypes: ["serie"],
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "serie-only" })])
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ m: movieOnly, s: serieOnly }));
		const results = await manager.getStreams(SERIE_GRAB_REQUEST);

		expect(results).toHaveLength(1);
		expect(results[0].providerName).toBe("serie-only");
		expect(movieOnly.workers.getStreams).not.toHaveBeenCalled();
	});

	it("should handle all providers failing gracefully", async () => {
		const bad1 = createMockModule({
			name: "bad-1",
			getStreams: jest.fn().mockRejectedValue(new Error("fail 1"))
		});
		const bad2 = createMockModule({
			name: "bad-2",
			getStreams: jest.fn().mockRejectedValue(new Error("fail 2"))
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: bad1, b: bad2 }));
		const results = await manager.getStreams(GRAB_REQUEST);

		expect(results).toEqual([]);
	});
});
