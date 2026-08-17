import { appFetch, __moduleLoader, __resetFetchClientsForTests, RequestInit } from "../../src/services/fetcher";
import { CACHE } from "../../src/services/cache";
import * as standardUtils from "../../src/utils/standard";

// Force the Node/Impit branch — the bare-fetch branch never builds a proxied client.
jest.spyOn(standardUtils, "isNode").mockReturnValue(true);
jest.spyOn(standardUtils, "isBrowser").mockReturnValue(false);

/** Minimal stand-in for http-proxy-agent — `extractProxyUrl` only reads `.proxy`.
 *  The real package is ESM-only and cannot be required from a Jest CJS test.
 */
function proxyAgent(url: string): RequestInit["agent"] {
	return { proxy: new URL(url) } as unknown as RequestInit["agent"];
}

/** Records the proxyUrl each constructed client was pinned to, and which one served each call. */
const constructedProxyUrls: (string | undefined)[] = [];
const requestsByProxyUrl: (string | undefined)[] = [];

class FakeImpit {
	constructor(private options: { browser: string; proxyUrl?: string }) {
		constructedProxyUrls.push(options.proxyUrl);
	}
	async fetch(): Promise<Response> {
		requestsByProxyUrl.push(this.options.proxyUrl);
		return new Response("ok", { status: 200 });
	}
}

beforeEach(() => {
	constructedProxyUrls.length = 0;
	requestsByProxyUrl.length = 0;
	CACHE.clear();
	__resetFetchClientsForTests();
	__moduleLoader.load = async () => ({ Impit: FakeImpit });
});

afterAll(() => CACHE.stopAutoCleanup());

describe("resolveFetch – proxy isolation", () => {
	it("should use native global fetch when useImpit is false even on Node", async () => {
		const nativeFetch = jest.fn().mockResolvedValue(new Response("native", { status: 200 }));
		const originalFetch = globalThis.fetch;
		globalThis.fetch = nativeFetch as typeof fetch;
		__moduleLoader.load = jest.fn(async () => {
			throw new Error("Impit should not be loaded when useImpit is false");
		});

		await appFetch("https://example.com/native", { useImpit: false });

		expect(nativeFetch).toHaveBeenCalledTimes(1);
		expect(__moduleLoader.load).not.toHaveBeenCalled();
		globalThis.fetch = originalFetch;
	});

	it("should not route an unproxied request through a previously used proxy", async () => {
		const agent = proxyAgent("http://proxy-a.example:8080");

		await appFetch("https://example.com/one", { agent });
		await appFetch("https://example.com/two"); // no agent

		expect(requestsByProxyUrl).toEqual(["http://proxy-a.example:8080/", undefined]);
	});

	it("should keep a separate client per proxy", async () => {
		await appFetch("https://example.com/a", { agent: proxyAgent("http://proxy-a.example:8080") });
		await appFetch("https://example.com/b", { agent: proxyAgent("http://proxy-b.example:9090") });

		expect(requestsByProxyUrl).toEqual(["http://proxy-a.example:8080/", "http://proxy-b.example:9090/"]);
	});

	it("should build the native client once per proxy and reuse it", async () => {
		const agent = proxyAgent("http://proxy-a.example:8080");

		await appFetch("https://example.com/1", { agent });
		await appFetch("https://example.com/2", { agent });
		await appFetch("https://example.com/3", { agent });

		expect(constructedProxyUrls).toEqual(["http://proxy-a.example:8080/"]);
	});
});
