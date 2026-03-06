import { TProviderEntryPatterns, TQueryMapping } from "../types/models/Provider.ts";

const SFPattern = /\{\s*(\w+)\s*:\s*(\d+|string|uri|form-uri)\s*\}/g;
const FMPattern = /{(\d+)}/g;
const NON_DIGIT_PATTERN = /\D/g;
const REPLACE_URI_SPACE_PATTERN = /%20/g;
const REMOVE_TRAILING_SLASH_PATTERN = /\/+$/;
const REMOVE_LEADING_TRAILING_SLASH_PATTERN = /^\/+|\/+$/g;

/** Generates a string based on a pattern by replacing placeholders with provided values.
 *
 * The pattern should contain placeholders in the format:
 * - `{key:<digits>}` for zero-padded numeric values
 * - `{key:string}` for string-based values
 * - `{key:uri}` for URI-encoded values
 * - `{key:form-uri}` for form URI-encoded values
 *
 * @param pattern - The pattern string containing placeholders
 * @param params - Configuration object containing values for replacement
 * @returns The resulting string with placeholders replaced by values
 *
 * @example
 * // Returns '02x07'
 * stringFromPattern('{season:2}x{episode:2}', { season: 2, episode: 7 });
 *
 * @example
 * // Returns 'Custom: 0042'
 * stringFromPattern('Custom: {anyKey:4}', { anyKey: 42 });
 */
export function stringFromPattern<T extends Record<string, unknown>>(pattern: string, params: T = {} as T): string {
	return pattern.replace(SFPattern, (match: string, key: string, spec: string) => {
		// Value from parameters
		const value = params[key];

		// Handle string specification
		if (spec === "string") {
			return String(value !== undefined && value !== null ? value : "");
		}
		// Handle URI encoding specification
		else if (spec === "uri") {
			return encodeURI(String(value !== undefined && value !== null ? value : ""));
		}

		// Handle form URI encoding specification
		else if (spec === "form-uri") {
			return encodeURI(String(value !== undefined && value !== null ? value : ""), "form-uri");
		}

		// Handle numeric padding specification
		const digits = parseInt(spec, 10);
		if (!isNaN(digits)) {
			// Helper function to extract numeric value
			const extractNumber = (val: unknown) => {
				if (typeof val === "number") return val;
				const numericStr = String(val ?? "").replace(NON_DIGIT_PATTERN, ""); // Remove non-digits
				return numericStr === "" ? 0 : parseInt(numericStr, 10);
			};

			const num = extractNumber(value);
			return String(num).padStart(digits, "0");
		}

		return match;
	});
}

/** Handle indexed placeholders like {0}, {1}, ...
 * @param pattern - The pattern string containing indexed placeholders.
 * @param args - The values to replace indexed placeholders.
 * @returns The resulting string with indexed placeholders replaced by values.
 *
 * @example
 * // Returns 'Hello World'
 * formatString('Hello {0}', ['World']);
 *
 * @example
 * // Returns 'Item 1: Apple, Item 2: Banana'
 * formatString('Item 1: {0}, Item 2: {1}', ['Apple', 'Banana']);
 */
export function formatString(pattern: string, args: unknown[]): string {
	// Handle indexed placeholders like {0}, {1}, ...
	let formattedString = pattern;

	// If the pattern has indexed placeholders like {0}, {1}, ...
	formattedString = formattedString.replace(FMPattern, (match: string, index: string) => {
		const idx = parseInt(index, 10);
		return args[idx] !== undefined ? String(args[idx]) : match;
	});

	return formattedString || "";
}

/** Encodes a string for use in a URI, with optional form encoding (spaces as '+').
 * @param str - The string to encode.
 * @param type - The encoding type: "uri" for standard URI encoding, "form-uri" for form encoding (spaces as '+').
 * @return The encoded string.
 * @example
 * // Returns 'Hello%20World'
 * encodeURI('Hello World');
 * // Returns 'Hello+World'
 * encodeURI('Hello World', 'form-uri');
 */
export function encodeURI(str: string, type: "uri" | "form-uri" = "uri"): string {
	const encoded = encodeURIComponent(str);
	if (type === "form-uri") {
		// Replace spaces with '+' for form-uri encoding
		return encoded.replace(REPLACE_URI_SPACE_PATTERN, "+");
	}
	return encoded;
}

/** Builds a relative path for a provider entry by replacing placeholders in the endpoint and pattern with provided parameters.
 * @param entry - The provider entry containing the endpoint and optional pattern.
 * @param params - The parameters to replace placeholders in the endpoint and pattern.
 * @param includePattern - Whether to include the pattern in the resulting path (default: false).
 * @return The constructed relative path with placeholders replaced by parameter values.
 *
 * This function handles the following scenarios:
 * - If the endpoint contains query parameters and the pattern starts with a query, it correctly joins them with '&'.
 * - If the endpoint does not contain query parameters and the pattern starts with a query, it adds '?' before the pattern.
 * - If the pattern is a regular string (not a query), it simply appends it to the endpoint.
 * - It also appends any additional query parameters from entry.queries if present.
 */
export function buildRelativePath(entry: TProviderEntryPatterns, params: TQueryMapping, includePattern: boolean = false): string {
	let path = entry.endpoint;
	// Replace string format placeholders
	path = stringFromPattern(path, params);

	// Build pattern string
	const pattern = includePattern && entry.pattern && stringFromPattern(entry.pattern, params);

	// Now do checking to build a correct relative path for URL that can be later used to pass in a URL constructor with the provider's base URL
	// Path can already contain query or is an query and pattern is another query, so we need to handle the joining correctly
	if (pattern) {
		const pathHasQuery = path.includes("?");
		const patternStartsWithQuery = pattern.startsWith("?");
		const patternStartsWithAmp = pattern.startsWith("&");

		if (pathHasQuery && patternStartsWithQuery) {
			// Both have query strings: path?a=1 + ?b=2 → path?a=1&b=2
			path = path + "&" + pattern.slice(1);
		} else if (pathHasQuery && patternStartsWithAmp) {
			// Path has query, pattern starts with &: path?a=1 + &b=2 → path?a=1&b=2
			path = path + pattern;
		} else if (!pathHasQuery && patternStartsWithQuery) {
			// Path has no query, pattern is a query: path + ?b=2 → path?b=2
			path = path + pattern;
		} else if (!pathHasQuery && patternStartsWithAmp) {
			// Path has no query, pattern starts with &: path + &b=2 → path?b=2
			path = path + "?" + pattern.slice(1);
		} else {
			// Pattern is a regular string (not a query), just append it
			path = path + pattern;
		}
	}

	// Append additional query parameters from entry.queries if present
	if (entry.queries && Object.keys(entry.queries).length > 0) {
		const queryString = Object.entries(entry.queries)
			.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
			.join("&");

		if (path.includes("?")) {
			path = path + "&" + queryString;
		} else {
			path = path + "?" + queryString;
		}
	}

	return path;
}

/** Joins multiple path segments into a single path, ensuring that there are no duplicate slashes and that the resulting path is properly formatted.
 * @param parts - The path segments to join.
 * @returns The joined path string.
 */
export function pathJoin(...parts: (string | undefined)[]): string {
	return parts
		.map((part, index) => {
			if (index === 0) {
				// For the first part, remove trailing slash if present
				return part?.replace(REMOVE_TRAILING_SLASH_PATTERN, "") ?? "";
			} else {
				// For subsequent parts, remove leading and trailing slashes
				return part?.replace(REMOVE_LEADING_TRAILING_SLASH_PATTERN, "") ?? "";
			}
		})
		.filter((part) => part.length > 0) // Remove empty parts
		.join("/"); // Join with a single slash
}
