import type { Response } from "../services/fetcher.ts";

const YEAR_REGEX = /(19|20)\d{2}/;
const FUNCTIONJSON_REGEX = /\b(new\s+)?[a-zA-Z_$][\w$]*\s*\(/m;
const VARIABLE_DECL_REGEX = /(?:var|let|const)\s+[a-zA-Z_$][\w$]*\s*=\s*\{/gm;
const QUOTE_UNQUOTED_REGEX = /([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g;
const SINGLE_TO_DOUBLE_QUOTES_REGEX = /'/g;
const TRAILING_COMMA_REGEX = /,\s*([}\]])/g;
const EVAL_CODE = /eval\s*\(/;
const JS_ESCAPED_SINGLE_QUOTE_REGEX = /\\'/g;
const SCALAR_VALUE_REGEX = /^(-?[\d.]+(?:e[+-]?\d+)?|true|false|null|undefined)/;
const TERNARY_EXPR_REGEX = /(:\s*)[a-zA-Z_$][\w$]*\s*\?\s*(?:'[^']*'|"[^"]*"|\w+)\s*:\s*(?:'[^']*'|"[^"]*"|\w+)/g;
const ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;

/** Utility to extract an file extension form an string/url */
export function extractExtension(url: string): string | null {
	const match = url.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
	return match ? match[1] : null;
}

/** Utility function to extract a 4-digit year from a given text string.
 * This function searches for the first occurrence of a valid year (between 1900 and 2099) in the input text and returns it as a number. If no valid year is found, it returns null.
 * @param text - The input string from which to extract the year.
 * @returns The extracted year as a number, or null if no valid year is found.
 */
export function extractYearFromText(text: string): number | null {
	const yearMatch = text.match(YEAR_REGEX);
	return yearMatch ? parseInt(yearMatch[0], 10) : null;
}

/** Extracts "Set-Cookie" header values from a headers object, normalizing to an array of strings.
 * This function checks for both "set-cookie" and "Set-Cookie" keys (case-insensitive) in the provided headers object. If found, it returns an array of cookie strings, ensuring that even a single string value is wrapped in an array. If no "Set-Cookie" header is present, it returns an empty array.
 * @param headers - An object representing HTTP headers, where keys are header names and values are either strings or arrays of strings.
 * @returns An array of cookie strings extracted from the "Set-Cookie" header, or an empty array if the header is not present.
 */
export function extractSetCookies(headers: Response["headers"] | Record<string, any>): string[] {
	if (!headers) return [];

	// Headers-like (Fetch API / Headers) — supports `.get()`
	const maybeGet = (headers as any).get;
	if (typeof maybeGet === "function") {
		// Prefer getAll/getAll-like if available (some environments expose getAll)
		const maybeGetAll = (headers as any).getAll;
		if (typeof maybeGetAll === "function") {
			const all = maybeGetAll.call(headers, "set-cookie") || maybeGetAll.call(headers, "Set-Cookie");
			if (Array.isArray(all) && all.length) return all;
		}

		const val = maybeGet.call(headers, "set-cookie") ?? maybeGet.call(headers, "Set-Cookie");
		if (!val) return [];
		return Array.isArray(val) ? val : [val];
	}

	// Plain object (Node IncomingHttpHeaders or simple record)
	const sc = (headers as any)["set-cookie"] ?? (headers as any)["Set-Cookie"] ?? (headers as any)["setCookie"];
	if (!sc) return [];
	return Array.isArray(sc) ? sc : [sc];
}

/** Extracts the first JavaScript code snippet that is passed to an `eval()` call within the provided source string.
 * This function uses a regular expression to search for the pattern `eval(...)` in the input source string. If a match is found, it returns the entire code snippet that is passed to `eval()`, including the `eval()` call itself. If no such pattern is found, it returns `null`.
 * @param source - The input string to search for `eval()` calls.
 * @returns The extracted code snippet passed to `eval()`, or `null` if no match is found.
 */
export function extractEvalCode(source: string): string | null {
	const match = EVAL_CODE.exec(source);
	if (!match) return null;
	// match.index points to the start of "eval", match[0] ends just before the "("
	// Use balanced-parenthesis extraction so nested parens are handled correctly.
	const parenStart = match.index + match[0].length - 1; // index of the "("
	const enclosed = extractEnclosedContent(source, parenStart, "(", ")");
	if (!enclosed) return null;
	return source.slice(match.index, parenStart) + enclosed;
}

/**
 * Scans a source string for **any** `var/let/const` declaration whose assigned
 * object literal contains **all** of the specified `requiredKeys`.
 *
 * This is useful when the variable name changes across page renders (e.g. `p3`,
 * `cfg`, `_x2`) but the object shape is stable — you can identify it by the
 * keys it must contain.
 *
 * ```js
 * // varName unknown — find by required keys ["file", "key"]
 * let _x2 = { "file": "https://...", "key": "bKTI...", "hls": 0, ... };
 * ```
 *
 * @param source       - Raw source string (e.g. full HTML page or script block).
 * @param requiredKeys - Every key listed here must exist in the parsed object.
 * @returns The first matching parsed object, or `null` if none is found.
 */
export function extractVariableByJSONKey(source: string, requiredKeys: string[]): Record<string | number, unknown> | null {
	// Fresh instance required — /gm regexes are stateful (lastIndex persists).
	const declarationRegex = new RegExp(VARIABLE_DECL_REGEX.source, VARIABLE_DECL_REGEX.flags);

	let match: RegExpExecArray | null;

	while ((match = declarationRegex.exec(source)) !== null) {
		// Position of the opening "{" is the last char of the full match
		const braceStart = match.index + match[0].length - 1;
		const extracted = extractEnclosedContent(source, braceStart, "{", "}");
		if (!extracted) continue;

		const parsed = parseArgString(extracted);
		if (!parsed) continue;

		const hasAllKeys = requiredKeys.every((k) => Object.prototype.hasOwnProperty.call(parsed, k));
		if (hasAllKeys) return parsed;
	}

	return null;
}

/** Extracts arguments from the first function or constructor call
 * inside a JavaScript source string.
 *
 * Supports:
 *  - new Something(...)
 *  - Something(...)
 *  - function(...)
 *
 * If a single object literal is passed → returns parsed JSON.
 * Otherwise → returns indexed argument map.
 *
 * @param codeString - Full JavaScript source as string
 */
export function extractContructorJSONArguments(codeString: string): Record<string | number, unknown> | null {
	/**
	 * This regex matches:
	 *  - optional "new"
	 *  - function name OR anonymous function
	 *  - opening parenthesis
	 *
	 * It captures the index of the first "("
	 */
	const callMatch = codeString.match(FUNCTIONJSON_REGEX);

	if (!callMatch) return null;

	const startIndex = callMatch.index! + callMatch[0].lastIndexOf("(");

	const argsString = extractParenthesisContent(codeString, startIndex);

	if (!argsString) return null;

	return parseArgString(argsString);
}

/** Extracts the arguments of a specific named function call from an HTML body
 * or any source string, then parses them using {@link extractContructorJSONArguments}.
 *
 * The function locates the first occurrence of `functionName(...)` inside the
 * source (which can be a full HTML page), extracts the raw argument content
 * from inside the parentheses (handling nesting correctly), reconstructs a
 * minimal call string, and delegates parsing to `extractContructorJSONArguments`.
 *
 * @param source       - Raw source string to search within (e.g. an HTML body).
 * @param functionName - Exact name of the function call to locate.
 * @returns Parsed argument map identical to {@link extractContructorJSONArguments}, or
 *          `null` if the function call is not found or its args cannot be extracted.
 */
export function extractContructorJSONArgumentsByName(source: string, functionName: string): Record<string | number, unknown> | null {
	const regex = new RegExp(`\\b${functionName}\\s*\\(`, "m");
	const match = source.match(regex);
	if (!match || match.index === undefined) return null;

	const startIndex = match.index + match[0].lastIndexOf("(");
	const argsContent = extractParenthesisContent(source, startIndex);
	if (argsContent === null) return null;

	// Directly parse the extracted args — avoids a second regex + parenthesis scan
	return parseArgString(argsContent);
}

/**
 * Extracts and parses a JSON object assigned to a JavaScript variable declaration.
 *
 * Handles `var`, `let`, and `const` declarations of the form:
 *   `var/let/const varName = { ... };`
 *
 * Useful when a script first assigns a config object to a variable and then
 * passes that variable to a constructor, e.g.:
 * ```js
 * let p3 = { file: "...", hls: 0 };
 * var ppl = new HDVBPlayer(p3);
 * ```
 *
 * @param source  - Raw source string (e.g. full HTML page or script block).
 * @param varName - The variable name whose value should be extracted.
 * @returns Parsed object, or `null` if not found / not parseable.
 */
export function extractVariableJSON(source: string, varName: string): Record<string | number, unknown> | null {
	const regex = new RegExp(`(?:var|let|const)\\s+${escapeRegex(varName)}\\s*=\\s*`);
	const match = source.match(regex);
	if (!match || match.index === undefined) return null;

	const afterAssign = source.slice(match.index + match[0].length);
	const leadingSpaces = afterAssign.length - afterAssign.trimStart().length;
	const trimmed = afterAssign.trimStart();

	if (!trimmed.startsWith("{")) return null;

	const braceStart = match.index + match[0].length + leadingSpaces;
	const extracted = extractEnclosedContent(source, braceStart, "{", "}");
	if (!extracted) return null;

	return parseArgString(extracted);
}

/**
 * Extracts the scalar value (string, number, boolean, null, or undefined) assigned
 * to a variable or property path anywhere in a JavaScript source string.
 *
 * Handles both:
 *  - Declared variables:   `const MDCore = "gjdw89lncgzrde";`
 *  - Property assignments: `MDCore.ref = "gjdw89lncgzrde";`  (no `var`/`let`/`const`)
 *
 * The `varName` argument may be a simple identifier (`"MDCore"`) **or** a dotted
 * property path (`"MDCore.ref"`).  The search is case-sensitive and ignores
 * compound operators (`==`, `===`, `+=`, `=>`, …).
 *
 * @param source  - Raw source string (e.g. full HTML page or a script block).
 * @param varName - Exact identifier or property path whose value is needed.
 * @returns The extracted value as a raw string, or `null` if not found / not parseable.
 *
 * @example
 * extractVariableValue(`const MDCore = "gjdw89lncgzrde";`, "MDCore");
 * // → "gjdw89lncgzrde"
 *
 * extractVariableValue(`MDCore.ref = "gjdw89lncgzrde";`, "MDCore.ref");
 * // → "gjdw89lncgzrde"
 */
export function extractVariableValue(source: string, varName: string): string | null {
	const escaped = escapeRegex(varName);

	// Two patterns tried in order:
	//  1. var/let/const VARNAME = <value>
	//  2. VARNAME = <value>  (bare assignment, no declaration keyword)
	// The second pattern uses a negative lookbehind so we don't accidentally
	// match mid-word, and a negative lookahead to skip ==, ===, =>, +=, etc.
	const patterns: RegExp[] = [new RegExp(`(?:var|let|const)\\s+${escaped}\\s*=\\s*`, "m"), new RegExp(`(?<![\\w$])${escaped}\\s*=(?![=>])\\s*`, "m")];

	for (const pattern of patterns) {
		const match = source.match(pattern);
		if (!match || match.index === undefined) continue;

		const afterAssign = source.slice(match.index + match[0].length).trimStart();
		const value = parseScalarValue(afterAssign);
		if (value !== null) return value;
	}

	return null;
}

/**
 * Extracts content inside matching parentheses
 * starting from the index of the first "(".
 *
 * Handles nested parentheses correctly.
 */
function extractParenthesisContent(str: string, startIndex: number): string | null {
	const inner = extractEnclosedContent(str, startIndex, "(", ")");
	if (!inner) return null;
	return inner.slice(1, -1); // strip the surrounding ( )
}

/**
 * Generic helper: extracts the substring from `startIndex` that starts with
 * `open` and ends at the matching `close`, respecting nesting.
 *
 * Returns the full substring **including** the surrounding delimiters,
 * or `null` if no matching pair is found.
 */
function extractEnclosedContent(str: string, startIndex: number, open: string, close: string): string | null {
	let depth = 0;
	let contentStart = -1;

	for (let i = startIndex; i < str.length; i++) {
		const char = str[i];

		if (char === open) {
			depth++;
			if (depth === 1) contentStart = i;
		} else if (char === close) {
			depth--;
			if (depth === 0) return str.slice(contentStart, i + 1);
		}
	}

	return null;
}

/**
 * Strips JavaScript single-line (`// …`) and block (`/* … *​/`) comments from
 * a source string while preserving content inside string literals (`"`, `'`, `` ` ``).
 */
function stripJSComments(src: string): string {
	// Collect slices and join once at the end to avoid O(n²) string concat.
	const parts: string[] = [];
	let i = 0;
	let sliceStart = 0; // start of the current "keep" region

	while (i < src.length) {
		const ch = src[i];

		// String literals — skip over verbatim, respecting backslash escapes
		if (ch === '"' || ch === "'" || ch === "`") {
			const quote = ch;
			let j = i + 1;
			while (j < src.length) {
				if (src[j] === "\\") {
					j += 2;
					continue;
				}
				if (src[j] === quote) {
					j++;
					break;
				}
				j++;
			}
			i = j;
			continue;
		}

		// Single-line comment — flush kept region, skip comment
		if (ch === "/" && src[i + 1] === "/") {
			if (i > sliceStart) parts.push(src.slice(sliceStart, i));
			let j = i + 2;
			while (j < src.length && src[j] !== "\n" && src[j] !== "\r") {
				j++;
			}
			i = j;
			sliceStart = j;
			continue;
		}

		// Block comment — flush kept region, skip comment
		if (ch === "/" && src[i + 1] === "*") {
			if (i > sliceStart) parts.push(src.slice(sliceStart, i));
			let j = i + 2;
			while (j + 1 < src.length && !(src[j] === "*" && src[j + 1] === "/")) {
				j++;
			}
			i = j + 2;
			sliceStart = i;
			continue;
		}

		i++;
	}

	// No comments found — return original string without any allocation
	if (sliceStart === 0) return src;

	if (sliceStart < src.length) parts.push(src.slice(sliceStart));
	return parts.join("");
}

/**
 * Parses a raw argument string (already extracted from parentheses)
 * into an object or indexed argument map.
 */
function parseArgString(argsString: string): Record<string | number, unknown> | null {
	const trimmed = argsString.trim();

	/**
	 * Case 1: Single object literal
	 */
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		try {
			const jsonSafe = stripJSComments(trimmed)
				// Unescape JS-escaped single quotes (common in eval/packer output where
				// the packed payload is wrapped in single quotes, so inner ' are \').
				.replace(JS_ESCAPED_SINGLE_QUOTE_REGEX, "'")
				// Replace JS ternary expressions (e.g. canAutoPlay?'viewable':false) with null
				// so they don't break JSON parsing.
				.replace(new RegExp(TERNARY_EXPR_REGEX.source, TERNARY_EXPR_REGEX.flags), "$1null")
				// Fresh instances for /g regexes — avoids lastIndex bleed between calls.
				.replace(new RegExp(QUOTE_UNQUOTED_REGEX.source, QUOTE_UNQUOTED_REGEX.flags), '$1"$2":') // quote unquoted keys
				.replace(SINGLE_TO_DOUBLE_QUOTES_REGEX, '"') // single → double quotes (stateless /g on .replace() is safe)
				.replace(new RegExp(TRAILING_COMMA_REGEX.source, TRAILING_COMMA_REGEX.flags), "$1"); // strip trailing commas

			return JSON.parse(jsonSafe);
		} catch {
			return { 0: trimmed };
		}
	}

	/**
	 * Case 2: Single function argument
	 */
	if (trimmed.startsWith("function") || trimmed.includes("=>")) {
		return { 0: trimmed };
	}

	/**
	 * Case 3: Multiple arguments
	 */
	const args = splitArguments(trimmed);
	const result: Record<number, string> = {};

	args.forEach((arg, index) => {
		result[index] = arg.trim();
	});

	return result;
}

/**
 * Parses the first scalar value (quoted string, number, boolean, null, or
 * undefined) from the very start of `src`.
 *
 * Respects backslash escapes inside strings.
 * Returns the **inner** content of strings (without surrounding quotes).
 */
function parseScalarValue(src: string): string | null {
	const first = src[0];

	// Single-quoted string
	if (first === "'") {
		const end = findQuoteEnd(src, 1, "'");
		return end === -1 ? null : src.slice(1, end);
	}

	// Double-quoted string
	if (first === '"') {
		const end = findQuoteEnd(src, 1, '"');
		return end === -1 ? null : src.slice(1, end);
	}

	// Template literal (backtick string)
	if (first === "`") {
		const end = findQuoteEnd(src, 1, "`");
		return end === -1 ? null : src.slice(1, end);
	}

	// Number, boolean, null, undefined
	const primitiveMatch = src.match(SCALAR_VALUE_REGEX);
	if (primitiveMatch) return primitiveMatch[1];

	return null;
}

/**
 * Returns the index of the closing `quote` character starting from `start`,
 * skipping over backslash-escaped characters.
 *
 * Returns `-1` if no closing quote is found.
 */
function findQuoteEnd(str: string, start: number, quote: string): number {
	for (let i = start; i < str.length; i++) {
		if (str[i] === "\\") {
			i++; // skip the escaped character
			continue;
		}
		if (str[i] === quote) return i;
	}
	return -1;
}

/**
 * Escapes a string for safe use inside a `RegExp` constructor.
 */
function escapeRegex(str: string): string {
	return str.replace(ESCAPE_REGEX, "\\$&");
}

/**
 * Splits arguments by comma while respecting nesting.
 */
function splitArguments(str: string): string[] {
	const result: string[] = [];
	let depth = 0;
	let start = 0;

	for (let i = 0; i < str.length; i++) {
		const char = str[i];
		if (char === "{" || char === "(" || char === "[") depth++;
		else if (char === "}" || char === ")" || char === "]") depth--;
		else if (char === "," && depth === 0) {
			result.push(str.slice(start, i));
			start = i + 1;
		}
	}

	if (start < str.length) result.push(str.slice(start));

	return result;
}
