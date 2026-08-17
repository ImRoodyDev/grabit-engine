/** Stable sort that puts sources matching the target language first, preserving original order within each group. */
export function sortByTargetLanguage<T extends { language: string }>(sources: T[], targetLanguageISO: string): T[] {
	const matches: T[] = [];
	const rest: T[] = [];
	for (const source of sources) {
		if (source.language === targetLanguageISO) matches.push(source);
		else rest.push(source);
	}
	return [...matches, ...rest];
}

/** Minimal shape needed to merge scraped sources. */
type MergeableSource = { scheme: string; providerName: string; fileName: string };

/** Identity used to decide which already-collected sources a new batch replaces.
 *
 * Deliberately label-based rather than URL-based: provider playlists are commonly
 * tokenized (`?token=…&expiry=…`), so the same logical stream gets a fresh URL on
 * every scrape and could never be matched by URL.
 */
function sourceKey(source: MergeableSource): string {
	return `${source.scheme}\0${source.providerName}\0${source.fileName}`;
}

/** Merges a freshly scraped batch into the sources collected so far.
 *
 * Drops the entries this batch supersedes, then appends the batch **untouched**.
 * `fileName` is a generated display label (provider + format + language + the
 * provider's own name for the source), so two genuinely distinct streams — two
 * mirrors of one file, say — routinely share a key. De-duplicating inside a single
 * batch would silently discard a working source; only cross-batch replacement is
 * intended, so a re-scrape of one provider swaps its stale tokenized URLs for fresh
 * ones without stacking copies.
 */
export function mergeSources<T extends MergeableSource>(existing: T[], incoming: T[]): T[] {
	if (incoming.length === 0) return existing;
	const incomingKeys = new Set(incoming.map(sourceKey));
	return [...existing.filter((source) => !incomingKeys.has(sourceKey(source))), ...incoming];
}

/** Returns a human-readable timestamp string in `HH:MM:SS:mmm` format. */
export function formatTimestamp(date: Date = new Date()): string {
	return (
		[String(date.getHours()).padStart(2, "0"), String(date.getMinutes()).padStart(2, "0"), String(date.getSeconds()).padStart(2, "0")].join(":") +
		`:${String(date.getMilliseconds()).padStart(3, "0")}`
	);
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

export const sanitizeMessage = (value: string): string => value.replace(/\\"/g, '"').replace(/"/g, "").replace(/\s+/g, " ").trim();
