import { Media } from "../types/index.ts";
import ParseDuration from "parse-duration";

type MatchCriteria = {
	title?: string;
	year?: string;
	date?: string;
	/** Duration text
	 * @example "1h 30m", "90m", "5400s"
	 */
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
		// The query is tokenized once and reused, instead of once per localized title.
		const queryVector = buildVector(criteria.title);
		const distance = cosineSimilarityVectors(buildVector(media.title), queryVector);
		const distances = media.localizedTitles.map((t) => cosineSimilarityVectors(buildVector(t), queryVector));
		score += Math.max(distance, ...distances) * 100; // Scale cosine similarity to a score out of 100
	}
	if (media.releaseYear && criteria.year && media.releaseYear.toString() === criteria.year) {
		score += 50;
	}
	if (media.duration && criteria.duration) {
		// ParseDuration returns milliseconds, media.duration is in minutes — convert before comparing.
		const parsed = (ParseDuration(criteria.duration) ?? 0) / 60000;
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
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	// The distance is symmetric, so drive the row width with the shorter string
	// to keep memory at O(min(n, m)).
	const [short, long] = a.length <= b.length ? [a, b] : [b, a];

	// Two rolling rows instead of a full (n+1) x (m+1) matrix — same result, less allocation.
	let previous = new Array<number>(short.length + 1);
	let current = new Array<number>(short.length + 1);
	for (let j = 0; j <= short.length; j++) previous[j] = j;

	for (let i = 1; i <= long.length; i++) {
		current[0] = i;
		for (let j = 1; j <= short.length; j++) {
			const cost = long.charAt(i - 1) === short.charAt(j - 1) ? 0 : 1;
			current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
		}
		[previous, current] = [current, previous];
	}

	return previous[short.length];
}

/**
 *  Cosine similarity for string comparison based on word frequency vectors
 *  @param a - First string
 *  @param b - Second string
 *  @returns The cosine similarity score between the two strings (0 to 1, where 1 means identical)
 */
export function cosineSimilarity(a: string, b: string): number {
	return cosineSimilarityVectors(buildVector(a), buildVector(b));
}

/** Cosine similarity over pre-built word-frequency vectors.
 *  Lets callers that compare one query against many strings tokenize the query once.
 */
function cosineSimilarityVectors(vecA: Map<string, number>, vecB: Map<string, number>): number {
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
