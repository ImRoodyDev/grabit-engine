import { stringFromPattern, formatString, buildRelativePath, pathJoin } from "../../src/utils/path";
import { TProviderEntryPatterns, TQueryMapping } from "../../src/types/models/Provider";

describe("path utils", () => {
	describe("stringFromPattern", () => {
		test("should pad season and episode numbers", () => {
			const pattern = "S{season:2}E{episode:2}";
			const params = { season: 1, episode: 5 };
			expect(stringFromPattern(pattern, params)).toBe("S01E05");
		});

		test("should handle string identifiers", () => {
			const pattern = "Movie {id:string}";
			const params = { id: "tt1234567" };
			expect(stringFromPattern(pattern, params)).toBe("Movie tt1234567");
		});

		test("should pad generic keys with specified digits", () => {
			const pattern = "Path-{custom:4}";
			const params = { custom: 42 };
			expect(stringFromPattern(pattern, params)).toBe("Path-0042");
		});

		test("should extract numbers from strings for numeric padding", () => {
			const pattern = "Part-{num:3}";
			const params = { num: "abc12" };
			expect(stringFromPattern(pattern, params)).toBe("Part-012");
		});

		test("should default to 0 for missing numeric values", () => {
			const pattern = "Value-{val:2}";
			expect(stringFromPattern(pattern, {})).toBe("Value-00");
		});

		test("should return empty string for missing string values", () => {
			const pattern = "Name: {name:string}";
			expect(stringFromPattern(pattern, {})).toBe("Name: ");
		});

		test("should handle mixed patterns", () => {
			const pattern = "{show:string} - S{season:2}E{episode:3} - {id:string}";
			const params = {
				show: "Better Call Saul",
				season: 6,
				episode: 13,
				id: "final"
			};
			expect(stringFromPattern(pattern, params)).toBe("Better Call Saul - S06E013 - final");
		});

		test("should return the original match if spec is invalid", () => {
			const pattern = "{key:invalid}";
			expect(stringFromPattern(pattern, { key: "val" })).toBe("{key:invalid}");
		});
	});

	describe("formatString", () => {
		test("should replace indexed placeholders", () => {
			const pattern = "Hello {0}, welcome to {1}!";
			const args = ["User", "Earth"];
			expect(formatString(pattern, args)).toBe("Hello User, welcome to Earth!");
		});

		test("should handle multiple occurrences of the same index", () => {
			const pattern = "{0} says {0}";
			const args = ["Echo"];
			expect(formatString(pattern, args)).toBe("Echo says Echo");
		});

		test("should leave placeholder if argument is missing", () => {
			const pattern = "Missing {1}";
			const args = ["Only Zero"];
			expect(formatString(pattern, args)).toBe("Missing {1}");
		});

		test("should handle non-string arguments", () => {
			const pattern = "Score: {0}";
			const args = [100];
			expect(formatString(pattern, args)).toBe("Score: 100");
		});

		test("should handle empty arguments array", () => {
			const pattern = "No {0} here";
			expect(formatString(pattern, [])).toBe("No {0} here");
		});
	});

	describe("buildRelativePath", () => {
		const mockParams = {
			0: "12345",
			1: "12345",
			2: "tt1234567",
			3: "Test Movie",
			4: 2024,
			5: 1,
			6: 5,
			id: "12345",
			tmdb: "12345",
			imdb: "tt1234567",
			title: "Test Movie",
			year: 2024,
			season: 1,
			episode: 5
		} as unknown as TQueryMapping;

		test("should build simple endpoint path", () => {
			const entry: TProviderEntryPatterns = {
				endpoint: "/embed/movie?tmdb={id:string}"
			};
			expect(buildRelativePath(entry, mockParams)).toBe("/embed/movie?tmdb=12345");
		});

		test("should build path with season and episode placeholders", () => {
			const entry: TProviderEntryPatterns = {
				endpoint: "/embed/tv?tmdb={id:string}&season={season:1}&episode={episode:1}"
			};
			expect(buildRelativePath(entry, mockParams)).toBe("/embed/tv?tmdb=12345&season=1&episode=5");
		});

		test("should append pattern as query when path has no query and pattern starts with ?", () => {
			const entry: TProviderEntryPatterns = {
				endpoint: "/search",
				pattern: "?q={title:uri}"
			};
			expect(buildRelativePath(entry, mockParams, true)).toBe("/search?q=Test%20Movie");
		});

		test("should merge queries when both path and pattern have query strings", () => {
			const entry: TProviderEntryPatterns = {
				endpoint: "/search?type=movie",
				pattern: "?q={title:uri}"
			};
			expect(buildRelativePath(entry, mockParams, true)).toBe("/search?type=movie&q=Test%20Movie");
		});

		test("should append pattern starting with & to path with query", () => {
			const entry: TProviderEntryPatterns = {
				endpoint: "/search?type=movie",
				pattern: "&q={title:uri}"
			};
			expect(buildRelativePath(entry, mockParams, true)).toBe("/search?type=movie&q=Test%20Movie");
		});

		test("should convert pattern starting with & to query when path has no query", () => {
			const entry: TProviderEntryPatterns = {
				endpoint: "/search",
				pattern: "&q={title:uri}"
			};
			expect(buildRelativePath(entry, mockParams, true)).toBe("/search?q=Test%20Movie");
		});

		test("should append regular pattern string directly", () => {
			const entry: TProviderEntryPatterns = {
				endpoint: "/shows/{title:uri}",
				pattern: "-S{season:2}E{episode:2}"
			};
			expect(buildRelativePath(entry, mockParams, true)).toBe("/shows/Test%20Movie-S01E05");
		});

		test("should ignore pattern when includePattern is false", () => {
			const entry: TProviderEntryPatterns = {
				endpoint: "/search",
				pattern: "?q={title:uri}"
			};
			expect(buildRelativePath(entry, mockParams, false)).toBe("/search");
		});

		test("should append entry.queries to path without existing query", () => {
			const entry: TProviderEntryPatterns = {
				endpoint: "/api/movies",
				queries: { api_key: "abc123", format: "json" }
			};
			expect(buildRelativePath(entry, mockParams)).toBe("/api/movies?api_key=abc123&format=json");
		});

		test("should append entry.queries to path with existing query", () => {
			const entry: TProviderEntryPatterns = {
				endpoint: "/api/movies?id={id:string}",
				queries: { api_key: "abc123" }
			};
			expect(buildRelativePath(entry, mockParams)).toBe("/api/movies?id=12345&api_key=abc123");
		});

		test("should handle pattern and queries together", () => {
			const entry: TProviderEntryPatterns = {
				endpoint: "/search",
				pattern: "?q={title:uri}",
				queries: { api_key: "abc123" }
			};
			expect(buildRelativePath(entry, mockParams, true)).toBe("/search?q=Test%20Movie&api_key=abc123");
		});

		test("should encode special characters in query values", () => {
			const entry: TProviderEntryPatterns = {
				endpoint: "/api",
				queries: { key: "value with spaces", special: "a&b=c" }
			};
			expect(buildRelativePath(entry, mockParams)).toBe("/api?key=value%20with%20spaces&special=a%26b%3Dc");
		});
	});

	describe("pathJoin", () => {
		test("should join basic path segments", () => {
			expect(pathJoin("a", "b", "c")).toBe("a/b/c");
		});

		test("should remove trailing slash from first segment", () => {
			expect(pathJoin("a/", "b")).toBe("a/b");
		});

		test("should remove leading slash from subsequent segments", () => {
			expect(pathJoin("a", "/b")).toBe("a/b");
		});

		test("should handle multiple slashes correctly", () => {
			expect(pathJoin("a//", "//b", "c//")).toBe("a/b/c");
		});

		test("should filter out empty segments", () => {
			expect(pathJoin("a", "", "b")).toBe("a/b");
		});

		test("should handle single segment", () => {
			expect(pathJoin("single")).toBe("single");
		});

		test("should return empty string for no segments", () => {
			expect(pathJoin()).toBe("");
		});

		test("should handle root path correctly", () => {
			expect(pathJoin("/", "a")).toBe("a");
		});

		test("should handle multiple empty segments", () => {
			expect(pathJoin("", "a", "")).toBe("a");
		});

		test("should handle all slashes", () => {
			expect(pathJoin("/", "/", "/")).toBe("");
		});

		test("should preserve segments with only slashes removed", () => {
			expect(pathJoin("api", "v1", "users")).toBe("api/v1/users");
		});
	});
});
