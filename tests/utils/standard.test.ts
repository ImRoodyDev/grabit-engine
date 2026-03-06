import { sorter, normalizeHeaders } from "../../src/utils/standard";
import { advanceLevenshteinDistance, cosineSimilarity } from "../../src/utils/similarity";

describe("normalizeHeaders", () => {
	it("should return an empty object for empty input", () => {
		expect(normalizeHeaders({})).toEqual({});
	});

	it("should pass through headers with no case conflicts", () => {
		const headers = {
			Accept: "text/html",
			"Content-Type": "application/json",
			DNT: "1"
		};
		expect(normalizeHeaders(headers)).toEqual({
			Accept: "text/html",
			"Content-Type": "application/json",
			DNT: "1"
		});
	});

	it("should deduplicate keys that differ only by case, keeping the first casing and last value", () => {
		const headers = {
			Accept: "text/html",
			accept: "application/json"
		};
		const result = normalizeHeaders(headers);
		expect(result).toEqual({ Accept: "application/json" });
		expect(Object.keys(result)).toEqual(["Accept"]);
	});

	it("should handle multiple duplicate groups", () => {
		const headers = {
			Pragma: "no-cache",
			Priority: "u=0, i",
			pragma: "no-cache",
			priority: "u=0, i"
		};
		const result = normalizeHeaders(headers);
		expect(result).toEqual({
			Pragma: "no-cache",
			Priority: "u=0, i"
		});
		expect(Object.keys(result)).toHaveLength(2);
	});

	it("should handle mixed-case sec-fetch headers", () => {
		const headers = {
			"Sec-Fetch-Dest": "document",
			"Sec-Fetch-Mode": "navigate",
			"sec-fetch-dest": "empty",
			"sec-fetch-mode": "cors"
		};
		const result = normalizeHeaders(headers);
		// First casing preserved, last value wins
		expect(result["Sec-Fetch-Dest"]).toBe("empty");
		expect(result["Sec-Fetch-Mode"]).toBe("cors");
		expect(result["sec-fetch-dest"]).toBeUndefined();
		expect(result["sec-fetch-mode"]).toBeUndefined();
	});

	it("should handle the full real-world duplicate header set", () => {
		const headers = {
			Accept: "text/html,application/xhtml+xml",
			DNT: "1",
			Pragma: "no-cache",
			Priority: "u=0, i",
			"Cache-Control": "no-store",
			"Accept-Language": "en-US,en;q=0.9",
			"Sec-Fetch-Dest": "document",
			"Sec-Fetch-Mode": "navigate",
			"Sec-Fetch-Site": "none",
			"Sec-Fetch-User": "?1",
			"User-Agent": "Mozilla/5.0 Chrome/145",
			accept: "text/html",
			"accept-language": "en-US,en;q=0.9,es;q=0.8",
			"cache-control": "no-cache",
			pragma: "no-cache",
			priority: "u=0, i",
			"sec-fetch-dest": "document",
			"sec-fetch-mode": "navigate",
			"sec-fetch-site": "same-origin",
			"sec-fetch-user": "?1",
			"upgrade-insecure-requests": "1",
			Referer: "https://example.com"
		};

		const result = normalizeHeaders(headers);
		const keys = Object.keys(result);

		// No duplicate keys when compared case-insensitively
		const lowerKeys = keys.map((k) => k.toLowerCase());
		expect(new Set(lowerKeys).size).toBe(lowerKeys.length);

		// Unique headers kept intact
		expect(result["User-Agent"]).toBe("Mozilla/5.0 Chrome/145");
		expect(result["upgrade-insecure-requests"]).toBe("1");
		expect(result["Referer"]).toBe("https://example.com");

		// Duplicates resolved: last value wins, first casing preserved
		expect(result["Accept"]).toBe("text/html");
		expect(result["Pragma"]).toBe("no-cache");
		expect(result["Cache-Control"]).toBe("no-cache");
		expect(result["Sec-Fetch-Site"]).toBe("same-origin");
	});

	it("should preserve single-occurrence lowercase keys as-is", () => {
		const headers = {
			"x-custom-header": "value1",
			"x-another": "value2"
		};
		expect(normalizeHeaders(headers)).toEqual({
			"x-custom-header": "value1",
			"x-another": "value2"
		});
	});

	it("should remove headers with undefined values", () => {
		const headers = {
			Accept: "text/html",
			"Content-Type": undefined,
			DNT: "1"
		};
		const result = normalizeHeaders(headers);
		expect(result).toEqual({ Accept: "text/html", DNT: "1" });
		expect("Content-Type" in result).toBe(false);
	});

	it("should remove a previously set header if a later duplicate has undefined", () => {
		const headers = {
			Pragma: "no-cache",
			pragma: undefined
		};
		const result = normalizeHeaders(headers);
		expect(result).toEqual({});
		expect("Pragma" in result).toBe(false);
	});

	it("should keep the header if first is undefined but a later duplicate has a value", () => {
		const headers = {
			accept: undefined,
			Accept: "text/html"
		};
		const result = normalizeHeaders(headers);
		expect(result).toEqual({ accept: "text/html" });
	});
});

describe("sorter", () => {
	it("should sort strings by similarity to a target name", async () => {
		const target = "The Avengers";
		const result = await sorter(
			["Captain America: The First Avenger", "Iron Man", "The Avengers", "Avengers: Endgame"],
			(a: string, b: string) => advanceLevenshteinDistance(a, target) - advanceLevenshteinDistance(b, target)
		);
		expect(result).toEqual(["The Avengers", "Avengers: Endgame", "Captain America: The First Avenger", "Iron Man"]);
	});

	it("should sort strings by cosine similarity to a target name", async () => {
		const target = "The Matrix";
		const result = await sorter(
			["Interstellar", "The Matrix", "The Matrix Reloaded", "Matrix"],
			(a: string, b: string) => cosineSimilarity(b, target) - cosineSimilarity(a, target)
		);

		expect(result).toEqual(["The Matrix", "The Matrix Reloaded", "Matrix", "Interstellar"]);
	});

	it("should keep titles with zero cosine similarity at the end", async () => {
		const target = "Avengers Endgame";
		const result = await sorter(
			["Iron Man", "Captain America", "Avengers: Endgame", "Endgame"],
			(a: string, b: string) => cosineSimilarity(b, target) - cosineSimilarity(a, target)
		);

		expect(result).toEqual(["Avengers: Endgame", "Endgame", "Iron Man", "Captain America"]);
	});
});
