import { appFetch, handleResponse, fetchWithTimeout, fetchWithRetry, fetchResponse, fetchResponseWithRetry } from "../../src/services/fetcher";
import { CACHE } from "../../src/services/cache";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a minimal Response-like object from a body string and options */
function fakeResponse(body: string, init?: ResponseInit): Response {
	return new Response(body, init);
}

// ── Mock the resolved fetch so we never hit the network ──────────────────────

let mockFetchImpl: jest.Mock;

// We mock the entire fetch resolution chain by replacing the module-level
// `resolveFetch` output.  The simplest way is to mock `appFetch`'s internal
// call via the impit module — but since the file uses a dynamic import, we
// instead monkey-patch `globalThis.fetch` and ensure `isNode()` returns false
// so that `resolveFetch` picks up the native path.
beforeAll(() => {
	mockFetchImpl = jest.fn();
	// Ensure the native-fetch branch is taken (simulates browser / RN)
	globalThis.fetch = mockFetchImpl as any;
});

beforeEach(() => {
	mockFetchImpl.mockReset();
	CACHE.clear();
});

afterAll(() => {
	CACHE.stopAutoCleanup();
});

// ── isNode override ──────────────────────────────────────────────────────────
// Force the browser path so we don't try to import impit during tests.
// We use spyOn instead of jest.mock so that all other exports (sanitizeMessage,
// normalizeHeaders, etc.) remain intact and available for transitive consumers.
import * as standardUtils from "../../src/utils/standard";
jest.spyOn(standardUtils, "isNode").mockReturnValue(false);

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("appFetch", () => {
	it("should make a basic GET request with default headers", async () => {
		mockFetchImpl.mockResolvedValueOnce(fakeResponse(JSON.stringify({ ok: true }), { status: 200 }));

		const res = await appFetch("https://httpbin.org/get");
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json).toEqual({ ok: true });

		// Verify default headers were applied
		const [url, init] = mockFetchImpl.mock.calls[0];
		expect(url).toBe("https://httpbin.org/get");
		expect(init.headers).toMatchObject({
			"Content-Type": "application/json",
			Accept: "application/json"
		});
	});

	it("should use clean option to skip default headers", async () => {
		mockFetchImpl.mockResolvedValueOnce(fakeResponse("hello", { status: 200 }));

		await appFetch("https://example.com", {
			clean: true,
			headers: { "X-Custom": "value" }
		});

		const [, init] = mockFetchImpl.mock.calls[0];
		expect(init.headers).toEqual({ "X-Custom": "value" });
		expect(init.headers["Content-Type"]).toBeUndefined();
	});

	it("should merge user headers with defaults", async () => {
		mockFetchImpl.mockResolvedValueOnce(fakeResponse("ok", { status: 200 }));

		await appFetch("https://example.com", {
			headers: { "X-Token": "abc", Accept: "text/html" }
		});

		const [, init] = mockFetchImpl.mock.calls[0];
		expect(init.headers["X-Token"]).toBe("abc");
		// User's Accept should override default
		expect(init.headers["Accept"]).toBe("text/html");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Cache integration
// ─────────────────────────────────────────────────────────────────────────────

describe("appFetch – caching", () => {
	it("should cache a successful response and return it on the next call", async () => {
		const body = JSON.stringify({ data: "cached" });
		mockFetchImpl.mockResolvedValue(fakeResponse(body, { status: 200, headers: { "Content-Type": "application/json" } }));

		// First call — should hit the network
		const res1 = await appFetch("https://api.example.com/data", { cacheTTL: 60_000 });
		expect(mockFetchImpl).toHaveBeenCalledTimes(1);
		expect(res1.status).toBe(200);

		// Wait a tick for the background serialization `.then()` to flush
		await new Promise((r) => setTimeout(r, 10));

		// Second call — should come from the cache, no new network call
		const res2 = await appFetch("https://api.example.com/data", { cacheTTL: 60_000 });
		expect(mockFetchImpl).toHaveBeenCalledTimes(1); // still 1
		expect(res2.status).toBe(200);

		const json = await res2.json();
		expect(json).toEqual({ data: "cached" });
	});

	it("should not cache when cacheTTL is not set", async () => {
		mockFetchImpl.mockResolvedValue(fakeResponse("ok", { status: 200 }));

		await appFetch("https://api.example.com/no-cache");
		await appFetch("https://api.example.com/no-cache");

		expect(mockFetchImpl).toHaveBeenCalledTimes(2);
	});

	it("should not cache non-ok responses", async () => {
		mockFetchImpl.mockResolvedValue(fakeResponse("Not Found", { status: 404, statusText: "Not Found" }));

		await appFetch("https://api.example.com/missing", { cacheTTL: 60_000 });
		await new Promise((r) => setTimeout(r, 10));
		await appFetch("https://api.example.com/missing", { cacheTTL: 60_000 });

		// Both should have hit the network since 404 is not cached
		expect(mockFetchImpl).toHaveBeenCalledTimes(2);
	});

	it("should use customCacheKey when provided", async () => {
		const body = JSON.stringify({ id: 1 });
		mockFetchImpl.mockResolvedValue(fakeResponse(body, { status: 200 }));

		await appFetch("https://api.example.com/item/1", { cacheTTL: 60_000, customCacheKey: "item-1" });
		await new Promise((r) => setTimeout(r, 10));

		// Verify the custom key was used in the cache
		expect(CACHE.has("item-1")).toBe(true);

		// Fetching with the same custom key returns cached
		const res = await appFetch("https://api.example.com/item/1", { cacheTTL: 60_000, customCacheKey: "item-1" });
		expect(mockFetchImpl).toHaveBeenCalledTimes(1);
		expect(res.status).toBe(200);
	});

	it("should differentiate cache keys by HTTP method", async () => {
		mockFetchImpl.mockResolvedValue(fakeResponse("ok", { status: 200 }));

		await appFetch("https://api.example.com/resource", { method: "GET", cacheTTL: 60_000 });
		await new Promise((r) => setTimeout(r, 10));

		await appFetch("https://api.example.com/resource", { method: "POST", cacheTTL: 60_000 });

		// GET and POST to the same URL should produce separate cache entries → 2 network calls
		expect(mockFetchImpl).toHaveBeenCalledTimes(2);
	});

	it("should preserve response headers through cache round-trip", async () => {
		mockFetchImpl.mockResolvedValue(
			fakeResponse("body", {
				status: 200,
				headers: { "X-Request-Id": "abc-123", "Content-Type": "text/plain" }
			})
		);

		await appFetch("https://api.example.com/headers", { cacheTTL: 60_000 });
		await new Promise((r) => setTimeout(r, 10));

		const cached = await appFetch("https://api.example.com/headers", { cacheTTL: 60_000 });
		expect(cached.headers.get("x-request-id")).toBe("abc-123");
		expect(cached.headers.get("content-type")).toBe("text/plain");
	});

	it("should respect cache expiration (TTL)", async () => {
		const body = JSON.stringify({ fresh: true });
		mockFetchImpl.mockResolvedValue(fakeResponse(body, { status: 200 }));

		// Cache with a very short TTL
		await appFetch("https://api.example.com/ttl", { cacheTTL: 50 });
		await new Promise((r) => setTimeout(r, 10));

		// Should be cached
		await appFetch("https://api.example.com/ttl", { cacheTTL: 50 });
		expect(mockFetchImpl).toHaveBeenCalledTimes(1);

		// Wait for TTL to expire
		await new Promise((r) => setTimeout(r, 60));

		// Should hit the network again
		await appFetch("https://api.example.com/ttl", { cacheTTL: 50 });
		expect(mockFetchImpl).toHaveBeenCalledTimes(2);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// handleResponse
// ─────────────────────────────────────────────────────────────────────────────

describe("handleResponse", () => {
	it("should parse JSON responses", async () => {
		const res = fakeResponse(JSON.stringify({ msg: "hello" }), {
			status: 200,
			headers: { "Content-Type": "application/json" }
		});
		const data = await handleResponse(res);
		expect(data).toEqual({ msg: "hello" });
	});

	it("should return text for non-JSON responses", async () => {
		const res = fakeResponse("<html>hi</html>", {
			status: 200,
			headers: { "Content-Type": "text/html" }
		});
		const data = await handleResponse(res);
		expect(data).toBe("<html>hi</html>");
	});

	it("should throw HttpError for non-ok responses", async () => {
		const res = fakeResponse(JSON.stringify({ error: "bad" }), {
			status: 400,
			statusText: "Bad Request",
			headers: { "Content-Type": "application/json" }
		});
		await expect(handleResponse(res)).rejects.toMatchObject({
			statusCode: 400,
			code: "FETCH_REQUEST_ERROR"
		});
	});

	it("should throw HttpError with text details when error body is not JSON", async () => {
		const res = fakeResponse("Something went wrong", {
			status: 500,
			statusText: "Internal Server Error"
		});
		await expect(handleResponse(res)).rejects.toMatchObject({
			statusCode: 500,
			details: "Something went wrong"
		});
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchWithTimeout
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchWithTimeout", () => {
	it("should return response when request completes within timeout", async () => {
		mockFetchImpl.mockResolvedValueOnce(fakeResponse("fast", { status: 200 }));

		const res = await fetchWithTimeout("https://example.com/fast", { timeout: 5000 });
		expect(res.status).toBe(200);
	});

	it("should abort the request when timeout is exceeded", async () => {
		// Simulate a slow network response
		mockFetchImpl.mockImplementation(
			(_url: string, init: any) =>
				new Promise((resolve, reject) => {
					const timer = setTimeout(() => resolve(fakeResponse("slow", { status: 200 })), 5000);
					init?.signal?.addEventListener("abort", () => {
						clearTimeout(timer);
						reject(new DOMException("The operation was aborted.", "AbortError"));
					});
				})
		);

		await expect(fetchWithTimeout("https://example.com/slow", { timeout: 50 })).rejects.toThrow(/abort/i);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchWithRetry
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchWithRetry", () => {
	it("should succeed on first attempt when no errors", async () => {
		mockFetchImpl.mockResolvedValueOnce(fakeResponse("ok", { status: 200 }));

		const res = await fetchWithRetry("https://example.com", { maxAttempts: 2, retryTimeout: 10 });
		expect(res.status).toBe(200);
		expect(mockFetchImpl).toHaveBeenCalledTimes(1);
	});

	it("should retry and eventually succeed", async () => {
		mockFetchImpl.mockRejectedValueOnce(new Error("Network error")).mockResolvedValueOnce(fakeResponse("recovered", { status: 200 }));

		const res = await fetchWithRetry("https://example.com", { maxAttempts: 1, retryTimeout: 10 });
		expect(res.status).toBe(200);
		expect(mockFetchImpl).toHaveBeenCalledTimes(2);
	});

	it("should throw after exhausting all retries", async () => {
		mockFetchImpl.mockRejectedValue(new Error("Network error"));

		await expect(fetchWithRetry("https://example.com", { maxAttempts: 2, retryTimeout: 10 })).rejects.toThrow("Network error");

		// 1 initial + 2 retries = 3 calls
		expect(mockFetchImpl).toHaveBeenCalledTimes(3);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchResponse
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchResponse", () => {
	it("should fetch and parse a JSON response", async () => {
		mockFetchImpl.mockResolvedValueOnce(
			fakeResponse(JSON.stringify({ items: [1, 2, 3] }), {
				status: 200,
				headers: { "Content-Type": "application/json" }
			})
		);

		const data = await fetchResponse("https://api.example.com/items");
		expect(data).toEqual({ items: [1, 2, 3] });
	});

	it("should throw on error responses", async () => {
		mockFetchImpl.mockResolvedValueOnce(
			fakeResponse(JSON.stringify({ error: "Unauthorized" }), {
				status: 401,
				statusText: "Unauthorized",
				headers: { "Content-Type": "application/json" }
			})
		);

		await expect(fetchResponse("https://api.example.com/secret")).rejects.toMatchObject({
			statusCode: 401
		});
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchResponseWithRetry
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchResponseWithRetry", () => {
	it("should retry on failure and return parsed response on success", async () => {
		mockFetchImpl.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(
			fakeResponse(JSON.stringify({ recovered: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" }
			})
		);

		const data = await fetchResponseWithRetry("https://api.example.com/retry", {
			maxAttempts: 1,
			retryTimeout: 10
		});
		expect(data).toEqual({ recovered: true });
		expect(mockFetchImpl).toHaveBeenCalledTimes(2);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Cache class unit tests (co-located for convenience)
// ─────────────────────────────────────────────────────────────────────────────

describe("Cache (standalone)", () => {
	it("should store and retrieve values", () => {
		CACHE.set("key1", { value: 42 }, 60_000);
		expect(CACHE.get("key1")).toEqual({ value: 42 });
	});

	it("should return null for missing keys", () => {
		expect(CACHE.get("nonexistent")).toBeNull();
	});

	it("should return null for expired entries", async () => {
		CACHE.set("expires", "data", 20);
		await new Promise((r) => setTimeout(r, 30));
		expect(CACHE.get("expires")).toBeNull();
	});

	it("should report has() correctly", () => {
		CACHE.set("exists", true, 60_000);
		expect(CACHE.has("exists")).toBe(true);
		expect(CACHE.has("nope")).toBe(false);
	});

	it("should delete entries", () => {
		CACHE.set("del", "value", 60_000);
		CACHE.delete("del");
		expect(CACHE.has("del")).toBe(false);
	});

	it("should clear all entries", () => {
		CACHE.set("a", 1, 60_000);
		CACHE.set("b", 2, 60_000);
		CACHE.clear();
		expect(CACHE.size).toBe(0);
	});
});
