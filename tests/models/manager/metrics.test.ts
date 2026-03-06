import { ScrapePluginManager, ProviderHealthReport } from "../../../src/controllers/manager";
import { resetManager, GRAB_REQUEST, createMockModule, createRegistryConfig, mockMediaSource } from "./helpers";

jest.mock("../../../src/services/tmdb", () => ({
	TMDB: {
		init: jest.fn(),
		createRequesterMedia: jest.fn(async (req: any) => req.media)
	}
}));

afterEach(() => resetManager());

describe("ScrapePluginManager › getMetrics", () => {
	beforeEach(() => resetManager());

	it("should return an empty map before any operations", async () => {
		const mod = createMockModule({ name: "idle" });
		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: mod }));

		const metrics = manager.getMetrics();
		expect(metrics.size).toBe(0);
	});

	it("should track successes after getStreams calls", async () => {
		const mod = createMockModule({
			name: "tracked",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "tracked" })])
		});
		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: mod }, { scrapeConfig: { maxAttempts: 1 } }));

		await manager.getStreams(GRAB_REQUEST);
		await manager.getStreams(GRAB_REQUEST);
		await manager.getStreams(GRAB_REQUEST);

		const record = manager.getMetrics().get("tracked");
		expect(record).toBeDefined();
		expect(record!.successes).toBe(3);
		expect(record!.errors).toBe(0);
	});

	it("should track failures after getStreams calls", async () => {
		const mod = createMockModule({
			name: "failing",
			getStreams: jest.fn().mockRejectedValue(new Error("fail"))
		});
		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: mod }, { scrapeConfig: { maxAttempts: 1 } }));

		await manager.getStreams(GRAB_REQUEST);
		await manager.getStreams(GRAB_REQUEST);

		const record = manager.getMetrics().get("failing");
		expect(record).toBeDefined();
		expect(record!.successes).toBe(0);
		expect(record!.errors).toBe(2);
	});

	it("should include lastOperation timestamp", async () => {
		const mod = createMockModule({
			name: "timed",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource()])
		});
		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: mod }));

		const before = new Date();
		await manager.getStreams(GRAB_REQUEST);

		const record = manager.getMetrics().get("timed");
		expect(record).toBeDefined();
		expect(record!.lastOperation.getTime()).toBeGreaterThanOrEqual(before.getTime());
	});

	it("should track metrics independently per module", async () => {
		const modA = createMockModule({
			name: "mod-a",
			getStreams: jest.fn().mockResolvedValue([mockMediaSource({ providerName: "A" })])
		});
		const modB = createMockModule({
			name: "mod-b",
			getStreams: jest.fn().mockRejectedValue(new Error("fail"))
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: modA, b: modB }, { scrapeConfig: { maxAttempts: 1 } }));

		await manager.getStreams(GRAB_REQUEST);

		const metrics = manager.getMetrics();
		expect(metrics.get("mod-a")?.successes).toBe(1);
		expect(metrics.get("mod-a")?.errors).toBe(0);
		expect(metrics.get("mod-b")?.successes).toBe(0);
		expect(metrics.get("mod-b")?.errors).toBe(1);
	});
});

describe("ScrapePluginManager › getHealthReport", () => {
	beforeEach(() => resetManager());

	it("should return a report for every loaded module", async () => {
		const modA = createMockModule({ name: "report-a" });
		const modB = createMockModule({ name: "report-b" });
		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: modA, b: modB }));

		const report = manager.getMetricsReport();
		expect(report).toHaveLength(2);
		expect(report.map((r) => r.moduleName).sort()).toEqual(["report-a", "report-b"]);
	});

	it("should compute errorRate correctly", async () => {
		let calls = 0;
		const mod = createMockModule({
			name: "rate-check",
			getStreams: jest.fn().mockImplementation(() => {
				calls++;
				if (calls <= 3) return Promise.resolve([mockMediaSource()]);
				return Promise.reject(new Error("fail"));
			})
		});

		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: mod }, { scrapeConfig: { maxAttempts: 1 } }));

		for (let i = 0; i < 4; i++) await manager.getStreams(GRAB_REQUEST);

		const report = manager.getMetricsReport();
		const entry = report.find((r) => r.moduleName === "rate-check")!;
		expect(entry.totalOperations).toBe(4);
		expect(entry.successes).toBe(3);
		expect(entry.errors).toBe(1);
		expect(entry.errorRate).toBeCloseTo(0.25);
		expect(entry.active).toBe(true);
	});

	it("should reflect disabled status when module is auto-disabled", async () => {
		const failing = createMockModule({
			name: "disabled-check",
			getStreams: jest.fn().mockRejectedValue(new Error("fail"))
		});

		const manager = await ScrapePluginManager.create(
			createRegistryConfig({ a: failing }, { scrapeConfig: { errorThresholdRate: 0.5, minOperationsForEvaluation: 3, maxAttempts: 1 } })
		);

		for (let i = 0; i < 4; i++) await manager.getStreams(GRAB_REQUEST);

		const report = manager.getMetricsReport();
		const entry = report.find((r) => r.moduleName === "disabled-check")!;
		expect(entry.active).toBe(false);
		expect(entry.errorRate).toBe(1);
	});

	it("should default errorRate to 0 for modules with no operations", async () => {
		const mod = createMockModule({ name: "unused" });
		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: mod }));

		const report = manager.getMetricsReport();
		const entry = report.find((r) => r.moduleName === "unused")!;
		expect(entry.totalOperations).toBe(0);
		expect(entry.errorRate).toBe(0);
	});
});
