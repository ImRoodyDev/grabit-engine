import { cosineSimilarity, advanceLevenshteinDistance, levenshteinDistance } from "../../src/utils/similarity";

describe("similarity utils", () => {
	describe("cosineSimilarity", () => {
		it("should return 1 for identical strings", () => {
			expect(cosineSimilarity("The Matrix", "The Matrix")).toBeCloseTo(1, 10);
		});

		it("should return 0 for strings with no shared words", () => {
			expect(cosineSimilarity("Inception", "Interstellar")).toBe(0);
		});

		it("should return expected similarity for partial word overlap", () => {
			expect(cosineSimilarity("The Matrix", "Matrix Reloaded")).toBeCloseTo(0.5, 5);
			expect(cosineSimilarity("Matrix Reloaded", "The Matrix")).toBeCloseTo(0.5, 5);
		});

		it("should return 0 when either input has no words", () => {
			expect(cosineSimilarity("", "The Matrix")).toBe(0);
			expect(cosineSimilarity("", "")).toBe(0);
		});
	});

	describe("levenshteinDistance", () => {
		it("should return 0 for identical strings", () => {
			expect(levenshteinDistance("test", "test")).toBe(0);
		});

		it("should calculate correct distance for movie titles", () => {
			expect(levenshteinDistance("The Matrix", "The Matrix")).toBe(0);
			expect(levenshteinDistance("The Matrix", "Matrix")).toBe(4);
			expect(levenshteinDistance("Star Wars", "Star Trek")).toBe(4);
		});
	});

	describe("advanceLevenshteinDistance", () => {
		it("should return -Infinity for exact matches", () => {
			expect(advanceLevenshteinDistance("Inception", "Inception")).toBe(-Infinity);
		});

		it("should return Infinity for null or undefined inputs", () => {
			expect(advanceLevenshteinDistance(null, "Inception")).toBe(Infinity);
			expect(advanceLevenshteinDistance("Inception", undefined)).toBe(Infinity);
			expect(advanceLevenshteinDistance(null, null)).toBe(Infinity);
		});

		it("should reward word-overlap matches for movie titles", () => {
			const distance = advanceLevenshteinDistance("The Dark Knight", "Dark Knight");
			expect(distance).toBeLessThan(0); // Negative due to overlap bonus
			expect(distance).toBe(levenshteinDistance("The Dark Knight", "Dark Knight") - 40);
		});

		it("should sort movie titles array with closest matches first", () => {
			const target = "The Matrix";
			const titles = ["Star Wars: Episode IV - A New Hope", "The Matrix Reloaded", "Matrix", "The Matrix", "Interstellar", "Inception"];

			// Sort by distance (ascending, so closest first)
			const sortedTitles = titles.sort((a, b) => {
				const distA = advanceLevenshteinDistance(a, target);
				const distB = advanceLevenshteinDistance(b, target);
				return distA - distB;
			});

			// The Matrix should be first (exact match, -Infinity)
			expect(sortedTitles[0]).toBe("The Matrix");

			// The Matrix Reloaded should be second (substring match with bonus)
			expect(sortedTitles[1]).toBe("The Matrix Reloaded");

			// Matrix should be third (not a substring, higher distance)
			expect(sortedTitles[2]).toBe("Matrix");

			// Other titles should follow based on distance
			expect(sortedTitles.indexOf("Star Wars: Episode IV - A New Hope")).toBeGreaterThan(2);
			expect(sortedTitles.indexOf("Interstellar")).toBeGreaterThan(2);
			expect(sortedTitles.indexOf("Inception")).toBeGreaterThan(2);
		});

		it("should handle array sorting with various movie title variations", () => {
			const target = "Avengers: Endgame";
			const titles = ["Avengers: Infinity War", "Endgame", "The Avengers", "Avengers: Endgame", "Iron Man 3", "Captain America: Civil War"];

			const sortedTitles = titles.sort((a, b) => {
				return advanceLevenshteinDistance(a, target) - advanceLevenshteinDistance(b, target);
			});

			// Exact match first
			expect(sortedTitles[0]).toBe("Avengers: Endgame");

			// Substring matches next
			expect(sortedTitles[1]).toBe("Endgame"); // Contains "Endgame"

			// Then other Avengers movies
			expect(sortedTitles[2]).toBe("Avengers: Infinity War");
			expect(sortedTitles[3]).toBe("The Avengers");
		});
	});
});
