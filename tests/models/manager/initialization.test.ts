import { GrabitManager } from "../../../src/controllers/manager";
import * as puppeteerCore from "../../../src/core/puppeteer";
import { resetManager, GRAB_REQUEST, createMockModule, createRegistryConfig, mockMediaSource } from "./helpers";

jest.mock("../../../src/services/tmdb", () => ({
	TMDB: {
		init: jest.fn(),
		createRequesterMedia: jest.fn(async (req: any) => req.media)
	}
}));

afterEach(() => resetManager());

describe("GrabitManager › initialization", () => {
	beforeEach(() => resetManager());

	it("should create a new instance from a registry source", async () => {
		const mod = createMockModule();
		const manager = await GrabitManager.create(createRegistryConfig({ test: mod }));

		expect(manager).toBeInstanceOf(GrabitManager);
	});

	it("should return the existing singleton on subsequent calls", async () => {
		const config = createRegistryConfig({ test: createMockModule() });

		const first = await GrabitManager.create(config);
		const second = await GrabitManager.create(config);

		expect(first).toBe(second);
	});

	it("should initialize with zero loaded modules when registry is empty", async () => {
		const manager = await GrabitManager.create(createRegistryConfig({}));
		const results = await manager.getStreams(GRAB_REQUEST);

		expect(results).toEqual([]);
	});

	it("should preserve loaded module count after initialization", async () => {
		const modA = createMockModule({ name: "a" });
		const modB = createMockModule({ name: "b" });
		const manager = await GrabitManager.create(createRegistryConfig({ a: modA, b: modB }));

		const modules = (manager as any).loadedModules;
		expect(modules).toHaveLength(2);
	});

	it("should reject invalid modules and keep valid ones when strict mode is off", async () => {
		const valid = createMockModule({ name: "valid" });
		// Missing supportedMediaTypes → validation error → filtered out
		const invalid = createMockModule({ name: "invalid", supportedMediaTypes: [] as any });

		const manager = await GrabitManager.create(createRegistryConfig({ v: valid, i: invalid }));
		const results = await manager.getStreams(GRAB_REQUEST);

		// Only the valid module contributes results
		expect(results.length).toBeGreaterThanOrEqual(1);
	});

	it("should accept schemes that start with a digit", async () => {
		const numericSchemeModule = createMockModule({ name: "9filmyzilla", scheme: "9filmyzilla" });
		const manager = await GrabitManager.create(createRegistryConfig({ "9filmyzilla": numericSchemeModule }));
		const results = await manager.getStreams(GRAB_REQUEST);

		expect(results.length).toBeGreaterThanOrEqual(1);
	});

	it("should configure and tear down the puppeteer pool from manager lifecycle", async () => {
		const configureSpy = jest.spyOn(puppeteerCore, "configurePuppeteerPool");
		const shutdownSpy = jest.spyOn(puppeteerCore, "shutdownPuppeteerPool").mockImplementation(() => undefined);

		const manager = await GrabitManager.create(
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
