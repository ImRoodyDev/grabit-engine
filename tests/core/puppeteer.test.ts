const mockConnect = jest.fn();

jest.mock(
	"puppeteer-real-browser",
	() => ({
		connect: (...args: unknown[]) => mockConnect(...args)
	}),
	{ virtual: true }
);

import { __resetPuppeteerPoolForTests, configurePuppeteerPool, puppeteerLoad } from "../../src/core/puppeteer";

function createMockPage() {
	return {
		setUserAgent: jest.fn().mockResolvedValue(undefined),
		setExtraHTTPHeaders: jest.fn().mockResolvedValue(undefined),
		goto: jest.fn().mockResolvedValue({ ok: () => true, status: () => 200 }),
		evaluate: jest.fn().mockResolvedValue(false),
		waitForNavigation: jest.fn().mockResolvedValue(undefined),
		setRequestInterception: jest.fn().mockResolvedValue(undefined),
		on: jest.fn(),
		close: jest.fn().mockResolvedValue(undefined),
		isClosed: jest.fn().mockReturnValue(false)
	} as any;
}

function createMockBrowser() {
	return {
		newPage: jest.fn(),
		close: jest.fn().mockResolvedValue(undefined)
	} as any;
}

function createRequest(overrides: Record<string, unknown> = {}) {
	return {
		requester: {
			media: { type: "movie", tmdbId: "27205" },
			targetLanguageISO: "en",
			...overrides
		}
	} as any;
}

describe("puppeteer pool", () => {
	beforeEach(() => {
		mockConnect.mockReset();
		__resetPuppeteerPoolForTests();
	});

	afterEach(() => {
		__resetPuppeteerPoolForTests();
	});

	it("reuses a pooled browser across sequential requests", async () => {
		const firstPage = createMockPage();
		const secondPage = createMockPage();
		const browser = createMockBrowser();
		browser.newPage.mockResolvedValue(secondPage);
		mockConnect.mockResolvedValue({ browser, page: firstPage });

		configurePuppeteerPool({ maxConcurrentBrowsers: 1, minWarmBrowsers: 0, idleBrowserTTL: 60_000 });

		const first = await puppeteerLoad(new URL("https://example.com/one"), createRequest());
		expect(mockConnect).toHaveBeenCalledTimes(1);

		await first.browser.close();

		const second = await puppeteerLoad(new URL("https://example.com/two"), createRequest());
		expect(mockConnect).toHaveBeenCalledTimes(1);
		expect(browser.newPage).toHaveBeenCalledTimes(1);

		await second.browser.close();

		expect(firstPage.close).toHaveBeenCalledTimes(1);
		expect(secondPage.close).toHaveBeenCalledTimes(1);
		expect(browser.close).not.toHaveBeenCalled();
	});

	it("waits for a browser slot when the pool is full for a different browser signature", async () => {
		const firstPage = createMockPage();
		const secondPage = createMockPage();
		const firstBrowser = createMockBrowser();
		const secondBrowser = createMockBrowser();

		mockConnect.mockResolvedValueOnce({ browser: firstBrowser, page: firstPage }).mockResolvedValueOnce({ browser: secondBrowser, page: secondPage });

		configurePuppeteerPool({ maxConcurrentBrowsers: 1, minWarmBrowsers: 0, idleBrowserTTL: 0 });

		const first = await puppeteerLoad(new URL("https://example.com/a"), createRequest({ proxyAgent: { proxy: { host: "proxy-a", port: 8080 } } }));

		const secondPromise = puppeteerLoad(new URL("https://example.com/b"), createRequest({ proxyAgent: { proxy: { host: "proxy-b", port: 8081 } } }));

		await Promise.resolve();
		expect(mockConnect).toHaveBeenCalledTimes(1);

		await first.browser.close();

		const second = await secondPromise;
		expect(mockConnect).toHaveBeenCalledTimes(2);
		expect(firstBrowser.close).toHaveBeenCalledTimes(1);

		await second.browser.close();
	});

	it("keeps a browser warm when minWarmBrowsers >= 1 by opening a fresh keeper page on release", async () => {
		const providerPage = createMockPage();
		const keeperPage = createMockPage();
		const nextPage = createMockPage();
		const browser = createMockBrowser();

		// First newPage call → keeper page created during release, second → next lease page
		browser.newPage.mockResolvedValueOnce(keeperPage).mockResolvedValueOnce(nextPage);
		mockConnect.mockResolvedValue({ browser, page: providerPage });

		configurePuppeteerPool({ maxConcurrentBrowsers: 1, minWarmBrowsers: 1, idleBrowserTTL: 60_000 });

		const first = await puppeteerLoad(new URL("https://example.com/one"), createRequest());
		expect(mockConnect).toHaveBeenCalledTimes(1);

		// Releasing should open a keeper page BEFORE closing the provider's page
		await first.browser.close();

		// Keeper page was opened to keep the browser alive
		expect(browser.newPage).toHaveBeenCalledTimes(1);
		// Provider page was still closed
		expect(providerPage.close).toHaveBeenCalledTimes(1);
		// The real browser was NOT closed (it's warm)
		expect(browser.close).not.toHaveBeenCalled();

		// Second request reuses the warm browser and gets the keeper page
		const second = await puppeteerLoad(new URL("https://example.com/two"), createRequest());
		expect(mockConnect).toHaveBeenCalledTimes(1);
		// No extra newPage needed — the keeper page is reused as initialPage
		expect(browser.newPage).toHaveBeenCalledTimes(1);

		await second.browser.close();
	});

	it("does not open a keeper page when minWarmBrowsers is 0", async () => {
		const page = createMockPage();
		const browser = createMockBrowser();
		mockConnect.mockResolvedValue({ browser, page });

		configurePuppeteerPool({ maxConcurrentBrowsers: 1, minWarmBrowsers: 0, idleBrowserTTL: 60_000 });

		const result = await puppeteerLoad(new URL("https://example.com"), createRequest());
		await result.browser.close();

		// No keeper page was requested — browser is not warm-retained
		expect(browser.newPage).not.toHaveBeenCalled();
		// Provider page was closed normally
		expect(page.close).toHaveBeenCalledTimes(1);
	});

	it("evicts stale browsers and retries acquisition transparently", async () => {
		const stalePage = createMockPage();
		const staleBrowser = createMockBrowser();
		staleBrowser.newPage.mockRejectedValue(new Error("Protocol error: Connection closed"));

		const freshPage = createMockPage();
		const freshBrowser = createMockBrowser();

		mockConnect.mockResolvedValueOnce({ browser: staleBrowser, page: stalePage }).mockResolvedValueOnce({ browser: freshBrowser, page: freshPage });

		configurePuppeteerPool({ maxConcurrentBrowsers: 2, minWarmBrowsers: 0, idleBrowserTTL: 60_000 });

		// First request uses the first browser
		const first = await puppeteerLoad(new URL("https://example.com/one"), createRequest());
		await first.browser.close();

		// Second request tries to reuse stale browser → newPage fails → retries with fresh browser
		const second = await puppeteerLoad(new URL("https://example.com/two"), createRequest());
		expect(mockConnect).toHaveBeenCalledTimes(2);

		await second.browser.close();
	});
});
