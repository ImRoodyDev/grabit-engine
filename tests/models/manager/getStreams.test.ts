import { GrabitManager } from "../../../src/controllers/manager";
import { resetManager, GRAB_REQUEST, SERIE_GRAB_REQUEST, createMockModule, createRegistryConfig, mockMediaSource } from "./helpers";

jest.mock("../../../src/services/tmdb", () => ({
	TMDB: {
		init: jest.fn(),
		createRequesterMedia: jest.fn(async (req: any) => req.media)
	}
}));

afterEach(() => resetManager());

describe("GrabitManager › getStreams", () => {
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

		const manager = await GrabitManager.create(createRegistryConfig({ a: modA, b: modB }));
		const results = await manager.getStreams(GRAB_REQUEST);

		expect(results).toHaveLength(2);
		expect(results.map((r) => r.providerName).sort()).toEqual(["A", "B"]);
	});

	it("should fall back to getStreams in lazy mode by default", async () => {
		const eagerOnly = createMockModule({
			name: "eager-only",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "eager-only" })])
		});

		// lazyFallbackToStreams defaults to true, so an eager-only provider still runs in lazy mode.
		const manager = await GrabitManager.create(createRegistryConfig({ "eager-only": eagerOnly }, { lazy: true }));
		expect((await manager.getStreams(GRAB_REQUEST)).map((r) => r.providerName)).toEqual(["eager-only"]);
		expect(eagerOnly.workers.getStreams).toHaveBeenCalledTimes(1);
	});

	it("should not fall back to getStreams in strict lazy mode (lazyFallbackToStreams: false)", async () => {
		const eagerOnly = createMockModule({
			name: "eager-only",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "eager-only" })])
		});

		const strict = await GrabitManager.create(createRegistryConfig({ "eager-only": eagerOnly }, { lazy: true, lazyFallbackToStreams: false }));
		expect(await strict.getStreams(GRAB_REQUEST)).toEqual([]);
		expect(eagerOnly.workers.getStreams).not.toHaveBeenCalled();
	});

	it("should fall back to getStreams in lazy mode when configured", async () => {
		const fallbackProvider = createMockModule({
			name: "fallback-provider",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "fallback-provider" })])
		});
		const manager = await GrabitManager.create(createRegistryConfig({ fallbackProvider }, { lazy: true, lazyFallbackToStreams: true }));
		const worker = (manager as any).mediaWorker(fallbackProvider, true);

		expect(await worker(GRAB_REQUEST, {})).toHaveLength(1);
		expect(fallbackProvider.workers.getStreams).toHaveBeenCalledTimes(1);
	});

	it("should prefer getLazyStreams over the fallback worker", async () => {
		const getStreams = jest.fn().mockResolvedValue([mockMediaSource({ providerName: "eager" })]);
		const getLazyStreams = jest.fn().mockResolvedValue([mockMediaSource({ providerName: "lazy" })]);
		const provider = createMockModule({ getStreams, getLazyStreams });
		const manager = await GrabitManager.create(createRegistryConfig({ provider }, { lazy: true, lazyFallbackToStreams: true }));

		const results = await manager.getStreams(GRAB_REQUEST);

		expect(results[0].providerName).toBe("lazy");
		expect(getLazyStreams).toHaveBeenCalledTimes(1);
		expect(getStreams).not.toHaveBeenCalled();
	});

	it("should not select or penalise an eager-only provider in strict lazy mode (no fallback)", async () => {
		const eagerOnly = createMockModule({
			name: "eager-only",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "eager-only" })])
		});
		const manager = await GrabitManager.create(createRegistryConfig({ "eager-only": eagerOnly }, { lazy: true, lazyFallbackToStreams: false }));

		// Excluded from selection → never run → no failure metric (so it can't be auto-disabled).
		expect(manager.getProvidersByRequest("media", GRAB_REQUEST)).toHaveLength(0);
		expect(await manager.getStreams(GRAB_REQUEST)).toEqual([]);
		expect(eagerOnly.workers.getStreams).not.toHaveBeenCalled();
		expect(manager.getMetrics().has("eager-only")).toBe(false);
	});

	it("should select a lazy-only provider in lazy mode", async () => {
		const lazyOnly = createMockModule({
			name: "lazy-only",
			getLazyStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "lazy-only" })])
		});
		// The helper always seeds a default getStreams; drop it to make this provider lazy-only.
		delete (lazyOnly.workers as any).getStreams;

		const manager = await GrabitManager.create(createRegistryConfig({ "lazy-only": lazyOnly }, { lazy: true }));

		expect(manager.getProvidersByRequest("media", GRAB_REQUEST)).toHaveLength(1);
		const results = await manager.getStreams(GRAB_REQUEST);
		expect(results.map((r) => r.providerName)).toEqual(["lazy-only"]);
		expect(lazyOnly.workers.getLazyStreams).toHaveBeenCalledTimes(1);
	});

	it("should include an eager-only provider in lazy mode when fallback is enabled", async () => {
		const eagerOnly = createMockModule({
			name: "eager-only",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "eager-only" })])
		});
		const manager = await GrabitManager.create(createRegistryConfig({ "eager-only": eagerOnly }, { lazy: true, lazyFallbackToStreams: true }));

		expect(manager.getProvidersByRequest("media", GRAB_REQUEST)).toHaveLength(1);
		const results = await manager.getStreams(GRAB_REQUEST);
		expect(results.map((r) => r.providerName)).toEqual(["eager-only"]);
		expect(eagerOnly.workers.getStreams).toHaveBeenCalledTimes(1);
	});

	it("getLazyStreams() forces lazy selection: skips eager-only, keeps lazy-only, even when config.lazy is false", async () => {
		const eagerOnly = createMockModule({
			name: "eager-only",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "eager-only" })])
		});
		const lazyOnly = createMockModule({
			name: "lazy-only",
			getLazyStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "lazy-only" })])
		});
		delete (lazyOnly.workers as any).getStreams;

		// config.lazy defaults to false here — getLazyStreams() must still force lazy mode.
		// lazyFallbackToStreams:false makes it strict so the eager-only provider is skipped.
		const manager = await GrabitManager.create(createRegistryConfig({ "eager-only": eagerOnly, "lazy-only": lazyOnly }, { lazyFallbackToStreams: false }));
		const results = await manager.getLazyStreams(GRAB_REQUEST);

		expect(results.map((r) => r.providerName)).toEqual(["lazy-only"]);
		expect(lazyOnly.workers.getLazyStreams).toHaveBeenCalledTimes(1);
		expect(eagerOnly.workers.getStreams).not.toHaveBeenCalled();
	});

	it("should return empty array when no providers support the requested media type", async () => {
		const mod = createMockModule({ supportedMediaTypes: ["serie"] });
		const manager = await GrabitManager.create(createRegistryConfig({ test: mod }));

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

		const manager = await GrabitManager.create(createRegistryConfig({ a: active, b: inactive }));
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

		const manager = await GrabitManager.create(createRegistryConfig({ a: good, b: bad }));
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

		const manager = await GrabitManager.create(createRegistryConfig({ m: multi }));
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

		const manager = await GrabitManager.create(createRegistryConfig({ e: empty, v: valid }));
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

		const manager = await GrabitManager.create(createRegistryConfig({ m: movieOnly, s: serieOnly }));
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

		const manager = await GrabitManager.create(createRegistryConfig({ a: bad1, b: bad2 }));
		const results = await manager.getStreams(GRAB_REQUEST);

		expect(results).toEqual([]);
	});
});
