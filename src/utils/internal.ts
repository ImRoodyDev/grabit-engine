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
