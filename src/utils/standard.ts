import { HttpError, ProcessError } from "../types/index.ts";
import { extractSetCookies } from "./extractor.ts";
import { Logger } from "./logger.ts";
import type { Response } from "../services/fetcher.ts";

// Utility functions for the stream scraper package
export const isDevelopment = () => typeof process !== "undefined" && process.env?.ENV !== "production";
export const isNode = () => typeof process !== "undefined" && process.versions != null && process.versions.node != null;
export const isBrowser = () => typeof window !== "undefined" && typeof window.document !== "undefined";

export function isCustomError(error: unknown): error is HttpError | ProcessError {
	return error instanceof HttpError || error instanceof ProcessError;
}
export const sanitizeMessage = (value: string): string => value.replace(/\\"/g, '"').replace(/"/g, "").replace(/\s+/g, " ").trim();

export const minutesToMilliseconds = (minutes: number): number => minutes * 60 * 1000;
export const hoursToMilliseconds = (hours: number): number => hours * 60 * 60 * 1000;
export const secondsToMilliseconds = (seconds: number): number => seconds * 1000;

export function customParseInt(input: string | undefined): number {
	if (input == null) return Number.NaN;
	return /^[0-9]+$/.test(input) ? Number.parseInt(input, 10) : Number.NaN;
}
export function commaSplitter(input: string | undefined): string[] {
	if (!input) return [];
	return input.split(",").map((part) => part.trim());
}

export async function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Calculate the row number based on the total number of retries.
 * @param attempts - The total number of retries .
 * @param retryScore - retries margin meaning how many retries is counted as 1.
 * @param maxAttempts - The maximum number of retries.
 * @returns - The row number.
 */
export function retriesCount(attempts: number, maxAttempts: number, retryScore = 1) {
	// Calculate the row number using the modulo operator
	const rowNumber = ((attempts - 1) % (retryScore * maxAttempts)) + 1;
	return Math.ceil(rowNumber / retryScore);
}

/** Run a function with retries and delay between attempts */
export async function excuteWithRetries<T>(fn: () => Promise<T>, maxAttempts: number = 1, backoffDelay: number = 0): Promise<T> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= Math.max(maxAttempts, 1); attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;
			Logger.warn(`Attempt ${attempt} failed. Retrying in ${backoffDelay}ms...`);
			if (attempt < maxAttempts) {
				if (backoffDelay > 0) await delay(backoffDelay); // Wait before retrying
			}
		}
	}
	throw lastError; // Rethrow the last error if all retries exhausted
}

/**
 * Asynchronous merge sort implementation that allows for an asynchronous comparison function.
 * Algorithm: Merge Sort
 * Time Complexity: O(n log n) on average and worst case, O(n) in the best case (when the array is already sorted)
 * Space Complexity: O(n) due to the temporary arrays used during merging
 */
export async function sorter<T>(items: T[], compareFn: (a: T, b: T) => number | Promise<number>): Promise<T[]> {
	async function merge(left: T[], right: T[]): Promise<T[]> {
		const result: T[] = [];
		let i = 0;
		let j = 0;

		while (i < left.length && j < right.length) {
			const cmp = await compareFn(left[i], right[j]);

			if (cmp <= 0) {
				result.push(left[i]);
				i++;
			} else {
				result.push(right[j]);
				j++;
			}
		}

		return [...result, ...left.slice(i), ...right.slice(j)];
	}

	async function mergeSort(arr: T[]): Promise<T[]> {
		if (arr.length <= 1) return arr;

		const mid = Math.floor(arr.length / 2);
		const left = await mergeSort(arr.slice(0, mid));
		const right = await mergeSort(arr.slice(mid));

		return merge(left, right);
	}

	return mergeSort([...items]);
}

/**
 * Normalize a headers object so that duplicate keys differing only by case
 * are collapsed into a single entry.  When two keys map to the same
 * lower-case form (e.g. `Accept` and `accept`), the **last** value wins
 * while the **first** casing encountered is preserved.
 *
 * @example
 * normalizeHeaders({ Accept: 'text/html', accept: 'application/json' })
 * // => { Accept: 'application/json' }
 */
export function normalizeHeaders<T extends Record<string, any>>(headers: T): { [K in string]: string } {
	const seen = new Map<string, string>(); // lower-case → first original key
	const result: Record<string, string> = {};

	for (const [key, value] of Object.entries(headers)) {
		const lower = key.toLowerCase();
		const canonical = seen.get(lower);

		if (value === undefined) {
			// Remove the header entirely if the value is undefined
			if (canonical !== undefined) delete result[canonical];
			else seen.set(lower, key); // track so future dupes are also skipped
			continue;
		}

		if (canonical !== undefined) {
			// Overwrite previous value, keep original casing
			result[canonical] = value;
		} else {
			seen.set(lower, key);
			result[key] = value;
		}
	}

	return result;
}

/** Creates a cookie string from the "Set-Cookie" headers.
 * @param headers - The headers object containing "Set-Cookie" entries.
 * @returns A string suitable for the "Cookie" header in subsequent requests.
 * @argument headers - Set-Cookie can only contain one cookie per header line
 * Example:
 * Input: {
 *   "Set-Cookie": [
 *     "sessionId=abc123; Path=/; HttpOnly",
 *     "userId=xyz789; Path=/; HttpOnly"
 *   ]
 * }
 * Output: "sessionId=abc123; userId=xyz789"
 */
export function createCookiesFromSet(headers: Response["headers"] | Record<string, any>): string {
	const cookies = extractSetCookies(headers);
	return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

/** Joins existing cookies with new cookies, ensuring no duplicates and proper formatting.*/
export function joinCookies(existingCookies: string | undefined, newCookies: string): string {
	if (!existingCookies) return newCookies;
	const existingSet = new Set(existingCookies.split(";").map((c) => c.trim()));
	const newSet = new Set(newCookies.split(";").map((c) => c.trim()));
	const combined = new Set([...existingSet, ...newSet]);
	return Array.from(combined).join("; ");
}

/** Attach a file extension to a URL or file path, replacing any existing extension if present.
 * @param extension - The file extension to attach (with or without a leading dot)
 * @param urlOrPath - The URL or file path to which the extension should be attached
 * - If urlOrPath is empty, the function will return the extension itself (normalized to remove any leading dot)
 * - If urlOrPath has an existing extension, it will be replaced with the new extension
 * - Trailing slashes and dots in urlOrPath will be stripped before attaching the extension
 * - The function will handle both absolute URLs and relative file paths correctly
 * - Can be used to ensure that a URL or file path has the correct extension for media processing or downloading
 * - Example usage:
 * ```ts
 * attachExtension("m3u8", "/path/to/video.mp4"); // Returns: "/path/to/video.m3u8"
 * attachExtension(".ts", "video"); // Returns: "video.ts"
 * attachExtension("mp4", "https://example.com/stream/"); // Returns: "https://example.com/stream.mp4"
 * attachExtension("m3u8", "https://example.com/stream.mp4"); // Returns: "https://example.com/stream.m3u8"
 * attachExtension("m3u8", "https://example.com/stream"); // Returns: "https://example.com/stream.m3u8"
 * attachExtension("m3u8", "https://example.com/stream/"); // Returns: "https://example.com/stream.m3u8"
 * ```
 */
export function attachExtension(extension: string, urlOrPath: string): string {
	if (!urlOrPath) return extension;
	// Normalize extension: strip leading dot if present
	const ext = extension.startsWith(".") ? extension.slice(1) : extension;
	// Strip trailing slashes and dots
	const normalized = urlOrPath.replace(/[/.]+$/, "");
	// Detect and replace an existing extension in the last path segment
	const lastSlash = normalized.lastIndexOf("/");
	const lastSegment = normalized.slice(lastSlash + 1);
	const dotIndex = lastSegment.lastIndexOf(".");
	if (dotIndex !== -1) {
		// Replace existing extension (even if it already matches)
		return `${normalized.slice(0, lastSlash + 1 + dotIndex)}.${ext}`;
	}
	return `${normalized}.${ext}`;
}

export function shuffleArray<T>(array: T[]): T[] {
	const shuffled = array.slice();
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled;
}

export function deduplicateArray<T>(array: T[]): T[] {
	return Array.from(new Set(array));
}

/** Returns a human-readable timestamp string in `HH:MM:SS:mmm` format. */
export function formatTimestamp(date: Date = new Date()): string {
	return (
		[String(date.getHours()).padStart(2, "0"), String(date.getMinutes()).padStart(2, "0"), String(date.getSeconds()).padStart(2, "0")].join(":") +
		`:${String(date.getMilliseconds()).padStart(3, "0")}`
	);
}
