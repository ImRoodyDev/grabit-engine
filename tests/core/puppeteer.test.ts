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
});
