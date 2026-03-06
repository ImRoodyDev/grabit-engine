import { ScrapePluginManager } from "../../../src/controllers/manager";
import { CACHE } from "../../../src/services/cache";
import { ProviderModule } from "../../../src/types";
import { resetManager, GRAB_REQUEST, createMockModule, createRegistryConfig, mockMediaSource } from "./helpers";

jest.mock("../../../src/services/tmdb", () => ({
	TMDB: {
		init: jest.fn(),
		createRequesterMedia: jest.fn(async (req: any) => req.media)
	}
}));

afterEach(() => resetManager());

describe("ScrapePluginManager › health metrics", () => {
	beforeEach(() => resetManager());

	it("should NOT disable a module before minOperationsForEvaluation is reached", async () => {
		const failing = createMockModule({
			name: "fragile",
			getStreams: jest.fn().mockRejectedValue(new Error("fail"))
		});

		const manager = await ScrapePluginManager.create(
			createRegistryConfig({ a: failing }, { scrapeConfig: { errorThresholdRate: 0.7, minOperationsForEvaluation: 5 } })
		);

		for (let i = 0; i < 4; i++) await manager.getStreams(GRAB_REQUEST);

		const modules = (manager as any).loadedModules as ProviderModule[];
		expect(modules.find((m) => m.meta.name === "fragile")?.meta.active).toBe(true);
	});

	it("should disable a module once error rate exceeds threshold after minimum operations", async () => {
		let callCount = 0;
		const flaky = createMockModule({
			name: "flaky",
			getStreams: jest.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) return Promise.resolve([mockMediaSource({ providerName: "flaky" })]);
				return Promise.reject(new Error("fail"));
			})
		});

		const manager = await ScrapePluginManager.create(
			createRegistryConfig({ a: flaky }, { scrapeConfig: { errorThresholdRate: 0.7, minOperationsForEvaluation: 5, maxAttempts: 1 } })
		);

		for (let i = 0; i < 6; i++) await manager.getStreams(GRAB_REQUEST);

		const modules = (manager as any).loadedModules as ProviderModule[];
		expect(modules.find((m) => m.meta.name === "flaky")?.meta.active).toBe(false);
	});

	it("should keep a module active when error rate stays below threshold", async () => {
		let callCount = 0;
		const decent = createMockModule({
			name: "decent",
			getStreams: jest.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 2 || callCount === 4) return Promise.reject(new Error("fail"));
				return Promise.resolve([mockMediaSource({ providerName: "decent" })]);
			})
		});

		const manager = await ScrapePluginManager.create(
			createRegistryConfig({ a: decent }, { scrapeConfig: { errorThresholdRate: 0.7, minOperationsForEvaluation: 5, maxAttempts: 1 } })
		);

		for (let i = 0; i < 6; i++) await manager.getStreams(GRAB_REQUEST);

		const modules = (manager as any).loadedModules as ProviderModule[];
		expect(modules.find((m) => m.meta.name === "decent")?.meta.active).toBe(true);
	});

	it("should persist metrics to cache and restore them on a new instance", async () => {
		const failing = createMockModule({
			name: "cached-mod",
			getStreams: jest.fn().mockRejectedValue(new Error("fail"))
		});
		const config = createRegistryConfig(
			{ a: failing },
			{
				scrapeConfig: { errorThresholdRate: 0.5, minOperationsForEvaluation: 3, maxAttempts: 1 },
				cache: { enabled: true, TTL: 60_000, MODULE_TTL: 60_000 }
			}
		);

		const first = await ScrapePluginManager.create(config);
		for (let i = 0; i < 4; i++) await first.getStreams(GRAB_REQUEST);

		// Reset singleton but keep cache
		(ScrapePluginManager as any).instance = undefined;
		(ScrapePluginManager as any).context = undefined;

		const second = await ScrapePluginManager.create(config);
		const modules = (second as any).loadedModules as ProviderModule[];
		expect(modules.find((m) => m.meta.name === "cached-mod")?.meta.active).toBe(false);
	});

	it("should not persist metrics when cache is cleared between instances", async () => {
		const makeConfig = () => {
			const failing = createMockModule({
				name: "cleared-mod",
				getStreams: jest.fn().mockRejectedValue(new Error("fail"))
			});
			return createRegistryConfig(
				{ a: failing },
				{
					scrapeConfig: { errorThresholdRate: 0.5, minOperationsForEvaluation: 3, maxAttempts: 1 },
					cache: { enabled: true, TTL: 60_000, MODULE_TTL: 60_000 }
				}
			);
		};

		const first = await ScrapePluginManager.create(makeConfig());
		for (let i = 0; i < 4; i++) await first.getStreams(GRAB_REQUEST);

		// Full reset including cache — metrics are lost
		resetManager();

		const second = await ScrapePluginManager.create(makeConfig());
		const modules = (second as any).loadedModules as ProviderModule[];
		expect(modules.find((m) => m.meta.name === "cleared-mod")?.meta.active).toBe(true);
	});

	it("should record success metrics correctly", async () => {
		const reliable = createMockModule({
			name: "reliable",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "reliable" })])
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: reliable }, { scrapeConfig: { maxAttempts: 1 } }));

		await manager.getStreams(GRAB_REQUEST);
		await manager.getStreams(GRAB_REQUEST);

		const metrics = manager.getMetrics();
		const record = metrics.get("reliable");
		expect(record).toBeDefined();
		expect(record!.successes).toBe(2);
		expect(record!.errors).toBe(0);
	});

	it("should record both success and error metrics for flaky providers", async () => {
		let callCount = 0;
		const flaky = createMockModule({
			name: "flakymod",
			getStreams: jest.fn().mockImplementation(() => {
				callCount++;
				if (callCount % 2 === 0) return Promise.reject(new Error("odd fail"));
				return Promise.resolve([mockMediaSource({ providerName: "flakymod" })]);
			})
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: flaky }, { scrapeConfig: { maxAttempts: 1 } }));

		for (let i = 0; i < 4; i++) await manager.getStreams(GRAB_REQUEST);

		const metrics = manager.getMetrics();
		const record = metrics.get("flakymod");
		expect(record).toBeDefined();
		expect(record!.successes).toBe(2);
		expect(record!.errors).toBe(2);
	});
});
