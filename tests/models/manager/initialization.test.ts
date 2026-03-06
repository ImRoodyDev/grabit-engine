import { ScrapePluginManager } from "../../../src/controllers/manager";
import { resetManager, GRAB_REQUEST, createMockModule, createRegistryConfig, mockMediaSource } from "./helpers";

jest.mock("../../../src/services/tmdb", () => ({
	TMDB: {
		init: jest.fn(),
		createRequesterMedia: jest.fn(async (req: any) => req.media)
	}
}));

afterEach(() => resetManager());

describe("ScrapePluginManager › initialization", () => {
	beforeEach(() => resetManager());

	it("should create a new instance from a registry source", async () => {
		const mod = createMockModule();
		const manager = await ScrapePluginManager.create(createRegistryConfig({ test: mod }));

		expect(manager).toBeInstanceOf(ScrapePluginManager);
	});

	it("should return the existing singleton on subsequent calls", async () => {
		const config = createRegistryConfig({ test: createMockModule() });

		const first = await ScrapePluginManager.create(config);
		const second = await ScrapePluginManager.create(config);

		expect(first).toBe(second);
	});

	it("should initialize with zero loaded modules when registry is empty", async () => {
		const manager = await ScrapePluginManager.create(createRegistryConfig({}));
		const results = await manager.getStreams(GRAB_REQUEST);

		expect(results).toEqual([]);
	});

	it("should preserve loaded module count after initialization", async () => {
		const modA = createMockModule({ name: "a" });
		const modB = createMockModule({ name: "b" });
		const manager = await ScrapePluginManager.create(createRegistryConfig({ a: modA, b: modB }));

		const modules = (manager as any).loadedModules;
		expect(modules).toHaveLength(2);
	});

	it("should reject invalid modules and keep valid ones when strict mode is off", async () => {
		const valid = createMockModule({ name: "valid" });
		// Missing supportedMediaTypes → validation error → filtered out
		const invalid = createMockModule({ name: "invalid", supportedMediaTypes: [] as any });

		const manager = await ScrapePluginManager.create(createRegistryConfig({ v: valid, i: invalid }));
		const results = await manager.getStreams(GRAB_REQUEST);

		// Only the valid module contributes results
		expect(results.length).toBeGreaterThanOrEqual(1);
	});
});
