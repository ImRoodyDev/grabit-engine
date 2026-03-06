import { ScrapePluginManager } from "../../../src/controllers/manager";
import { resetManager, GRAB_REQUEST, createMockModule, createRegistryConfig, mockMediaSource } from "./helpers";

jest.mock("../../../src/services/tmdb", () => ({
	TMDB: {
		init: jest.fn(),
		createRequesterMedia: jest.fn(async (req: any) => req.media)
	}
}));

afterEach(() => {
	resetManager();
});

describe("ScrapePluginManager › successQuorum", () => {
	beforeEach(() => resetManager());

	it("should return results as soon as the quorum is met", async () => {
		const slow = createMockModule({
			name: "slow",
			priority: 10,
			getStreams: jest.fn().mockImplementation(
				() =>
					new Promise((resolve) => {
						const t = setTimeout(() => resolve([mockMediaSource({ providerName: "slow" })]), 5_000);
						// Prevent the timer from keeping the Jest worker alive after the test
						if (typeof t === "object" && "unref" in t) t.unref();
					})
			)
		});
		const fast1 = createMockModule({
			name: "fast-1",
			priority: 0,
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "fast-1" })])
		});
		const fast2 = createMockModule({
			name: "fast-2",
			priority: 1,
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "fast-2" })])
		});

		const manager = await ScrapePluginManager.create(
			createRegistryConfig({ a: fast1, b: fast2, c: slow }, { scrapeConfig: { successQuorum: 2, operationTimeout: 10_000 } })
		);

		const start = Date.now();
		const results = await manager.getStreams(GRAB_REQUEST);
		const elapsed = Date.now() - start;

		expect(results.length).toBeGreaterThanOrEqual(2);
		expect(elapsed).toBeLessThan(3_000);
	});

	it("should return all results when quorum equals total provider count", async () => {
		const fast1 = createMockModule({
			name: "f1",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "f1" })])
		});
		const fast2 = createMockModule({
			name: "f2",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "f2" })])
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: fast1, b: fast2 }, { scrapeConfig: { successQuorum: 2 } }));

		const results = await manager.getStreams(GRAB_REQUEST);
		expect(results).toHaveLength(2);
	});

	it("should return partial results when quorum cannot be met due to failures", async () => {
		const good = createMockModule({
			name: "good",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "good" })])
		});
		const bad = createMockModule({
			name: "bad",
			getStreams: jest.fn().mockRejectedValue(new Error("fail"))
		});

		const manager = await ScrapePluginManager.create(
			createRegistryConfig({ a: good, b: bad }, { scrapeConfig: { successQuorum: 2, operationTimeout: 1_000 } })
		);

		const results = await manager.getStreams(GRAB_REQUEST);
		// Only 1 can succeed — returns what it collected
		expect(results).toHaveLength(1);
		expect(results[0].providerName).toBe("good");
	});
});

describe("ScrapePluginManager › operationTimeout", () => {
	beforeEach(() => resetManager());

	it("should return partial results when the timeout elapses", async () => {
		const fast = createMockModule({
			name: "fast",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "fast" })])
		});
		const hanging = createMockModule({
			name: "hanging",
			getStreams: jest.fn().mockImplementation(() => new Promise(() => {})) // never resolves
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: fast, b: hanging }, { scrapeConfig: { operationTimeout: 500 } }));

		const start = Date.now();
		const results = await manager.getStreams(GRAB_REQUEST);
		const elapsed = Date.now() - start;

		expect(results).toHaveLength(1);
		expect(results[0].providerName).toBe("fast");
		expect(elapsed).toBeLessThan(2_000);
	});

	it("should return empty when all providers hang beyond the timeout", async () => {
		const hanging1 = createMockModule({
			name: "hang-1",
			getStreams: jest.fn().mockImplementation(() => new Promise(() => {}))
		});
		const hanging2 = createMockModule({
			name: "hang-2",
			getStreams: jest.fn().mockImplementation(() => new Promise(() => {}))
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: hanging1, b: hanging2 }, { scrapeConfig: { operationTimeout: 300 } }));

		const results = await manager.getStreams(GRAB_REQUEST);
		expect(results).toEqual([]);
	});
});
