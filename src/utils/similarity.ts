import { Media } from "../types/index.ts";
import ParseDuration from "parse-duration";

type MatchCriteria = {
	title?: string;
	year?: string;
	date?: string;
	duration?: string;
};

/** Calculates a match score between a media item and target properties
 *
 * For movies/series:
 * Score range `[0 <-> 170]`
 *
 * For channels:
 * Score range `[0 <-> 100]`
 *
 * Scoring breakdown:
 * - `Title` similarity (`up to 100 points`): Based on cosine similarity of the media title and target title, scaled to 100.
 * - `Year` match (`50 points`): If the media's release year matches the target year, add 50 points.
 * - `Duration` similarity (`up to 20 points`): Based on how close the media's duration is to the target duration, with a maximum of 20 points for an exact match and decreasing as the difference increases.
 *
 * @argument title -  Match is considered true when similarity is 80 points or higher
 */
export function calculateMatchScore(criteria: MatchCriteria, media: Media): number {
	let score = 0;

	if (media.type == "channel") return cosineSimilarity(media.channelName, criteria.title || "") * 100;

	if (media.title && criteria.title) {
		const distance = cosineSimilarity(media.title, criteria.title);
		const distances = media.localizedTitles.map((t) => cosineSimilarity(t, criteria.title!) ?? 0);
		score += Math.max(distance, ...distances) * 100; // Scale cosine similarity to a score out of 100
	}
	if (media.releaseYear && criteria.year && media.releaseYear.toString() === criteria.year) {
		score += 50;
	}
	if (media.duration && criteria.duration) {
		const parsed = ParseDuration(criteria.duration) ?? 0 / 60000;
		const diff = Math.abs(media.duration - parsed);
		score += 20 - Math.min(diff, 20); // Add up to 20 points based on how close the durations are
	}
	return score;
}

/**
 * Helper function for name similarity scoring
 * @param itemName - The name of the item to compare
 * @param targetName - The target name to compare against
 * @returns The calculated distance score ( Thee lower the score, the more similar the names are )
 */
export function advanceLevenshteinDistance(itemName: string | null | undefined, targetName: string | null | undefined): number {
	if (!itemName || !targetName) return Infinity;

	const item = itemName.toLowerCase();
	const target = targetName.toLowerCase();

	// 1️⃣ Exact match
	if (item === target) return -Infinity;

	const levDistance = levenshteinDistance(item, target);

	// 2️⃣ Starts with target (strong relevance)
	if (item.startsWith(target)) {
		return levDistance - 50;
	}

	// 3️⃣ Word overlap (medium relevance)
	const itemWords = item.split(/\W+/);
	const targetWords = target.split(/\W+/);

	const commonWords = itemWords.filter((word) => targetWords.includes(word));

	if (commonWords.length > 0) {
		return levDistance - commonWords.length * 20;
	}

	// 4️⃣ Default
	return levDistance;
}

/**
 * Basic Levenshtein implementation for string similarity
 * @param a - First string
 * @param b - Second string
 * @returns The Levenshtein distance between the two strings
 */
export function levenshteinDistance(a: string, b: string): number {
	const matrix: number[][] = [];
	for (let i = 0; i <= b.length; i++) matrix[i] = [i];
	for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

	for (let i = 1; i <= b.length; i++) {
		for (let j = 1; j <= a.length; j++) {
			const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
			matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
		}
	}
	return matrix[b.length][a.length];
}

/**
 *  Cosine similarity for string comparison based on word frequency vectors
 *  @param a - First string
 *  @param b - Second string
 *  @returns The cosine similarity score between the two strings (0 to 1, where 1 means identical)
 */
export function cosineSimilarity(a: string, b: string): number {
	const vecA = buildVector(a);
	const vecB = buildVector(b);

	const allWords = new Set([...vecA.keys(), ...vecB.keys()]);

	let dotProduct = 0;
	let magnitudeA = 0;
	let magnitudeB = 0;

	for (const word of allWords) {
		const valA = vecA.get(word) || 0;
		const valB = vecB.get(word) || 0;

		dotProduct += valA * valB;
		magnitudeA += valA * valA;
		magnitudeB += valB * valB;
	}

	magnitudeA = Math.sqrt(magnitudeA);
	magnitudeB = Math.sqrt(magnitudeB);

	if (magnitudeA === 0 || magnitudeB === 0) return 0;

	return dotProduct / (magnitudeA * magnitudeB);
}

function buildVector(text: string): Map<string, number> {
	const words = text.toLowerCase().split(/\W+/).filter(Boolean);

	const freq = new Map<string, number>();

	for (const word of words) {
		freq.set(word, (freq.get(word) || 0) + 1);
	}

	return freq;
}
