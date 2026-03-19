import { ScrapePluginManager } from "../../../src/controllers/manager";
import * as puppeteerCore from "../../../src/core/puppeteer";
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

	it("should accept schemes that start with a digit", async () => {
		const numericSchemeModule = createMockModule({ name: "9filmyzilla", scheme: "9filmyzilla" });
		const manager = await ScrapePluginManager.create(createRegistryConfig({ "9filmyzilla": numericSchemeModule }));
		const results = await manager.getStreams(GRAB_REQUEST);

		expect(results.length).toBeGreaterThanOrEqual(1);
	});

	it("should configure and tear down the puppeteer pool from manager lifecycle", async () => {
		const configureSpy = jest.spyOn(puppeteerCore, "configurePuppeteerPool");
		const shutdownSpy = jest.spyOn(puppeteerCore, "shutdownPuppeteerPool").mockImplementation(() => undefined);

		const manager = await ScrapePluginManager.create(
			createRegistryConfig(
				{ test: createMockModule() },
				{
					scrapeConfig: {
						puppeteer: {
							maxConcurrentBrowsers: 1,
							minWarmBrowsers: 1,
							idleBrowserTTL: 5_000
						}
					}
				}
			)
		);

		expect(configureSpy).toHaveBeenCalledWith({
			maxConcurrentBrowsers: 1,
			minWarmBrowsers: 1,
			idleBrowserTTL: 5_000
		});

		manager.destroy();
		expect(shutdownSpy).toHaveBeenCalled();

		configureSpy.mockRestore();
		shutdownSpy.mockRestore();
	});
});
