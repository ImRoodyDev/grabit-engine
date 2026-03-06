import { ProcessError } from "../types/ProcessError.ts";

const UNPACK_LOOKUP = /\b\w+\b/g;
const JUICERS = [/}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\), *(\d+), *(.*)\)\)/, /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\)/];

/** Detects whether `source` is P.A.C.K.E.R. coded. */
export function detectPacked(source: string) {
	return source.replace(" ", "").startsWith("eval(function(p,a,c,k,e,");
}

/** Unpacks P.A.C.K.E.R. packed js code. */
export function unpackV2(source: string) {
	let { payload, symtab, radix, count } = _filterargs(source);

	if (count != symtab.length) {
		throw new ProcessError({
			code: "UNPACKER_ERROR",
			message: "Malformed p.a.c.k.e.r. symtab.",
			status: 500,
			expose: false
		});
	}

	let unbase: Unbaser;
	try {
		unbase = new Unbaser(radix);
	} catch (e) {
		throw new ProcessError({
			code: "UNPACKER_ERROR",
			message: e instanceof Error ? `Error initializing Unbaser: ${e.message}` : "Error initializing Unbaser",
			status: 500,
			expose: false
		});
	}

	/** Look up symbols in the synthetic symtab. */
	function lookup(match: string): string {
		const word = match;
		let word2: string;
		if (radix == 1) {
			word2 = symtab[parseInt(word)];
		} else {
			word2 = symtab[unbase.unbase(word)];
		}
		return word2 || word;
	}

	// Convert the payload into a string, then run through the lookup to
	source = payload.replace(UNPACK_LOOKUP, lookup);
	return _replacestrings(source);

	/** Juice from a source file the four args needed by decoder. */
	function _filterargs(source: string) {
		for (const juicer of JUICERS) {
			//const args = re.search(juicer, source, re.DOTALL);
			const args = juicer.exec(source);
			if (args) {
				let a = args;
				if (a[2] == "[]") {
					//don't know what it is
					// a = list(a);
					// a[1] = 62;
					// a = tuple(a);
				}
				try {
					return {
						payload: a[1],
						symtab: a[4].split("|"),
						radix: parseInt(a[2]),
						count: parseInt(a[3])
					};
				} catch (ValueError) {
					throw new ProcessError({
						code: "UNPACKER_ERROR",
						message: "Corrupted p.a.c.k.e.r. data.",
						status: 500,
						expose: false
					});
				}
			}
		}
		throw new ProcessError({
			code: "UNPACKER_ERROR",
			message: "Could not make sense of p.a.c.k.e.r data (unexpected code structure)",
			status: 500,
			expose: false
		});
	}

	/** Strip string lookup table (list) and replace values in source. */
	function _replacestrings(source: string): string {
		// Strip string lookup table (list) and replace values in source.
		// Need to work on this.
		return source;
	}
}

/** Unpack the code from the /packer/ (Doesn't work in NODE.JS, only in WEB).
 * @see http://matthewfl.com/unPacker.html
 * @param {string} code The packed code
 * @returns {string} The unpacked code
 * @author Matthew Flaschen <matthew@matthewfl.com>
 */
export function disabled_unpackV1(code: string): string {
	function indent(codeLines: string[]): string[] {
		try {
			var tabs: any = 0,
				old: any = -1,
				add: any = "";
			for (var i = 0; i < codeLines.length; i++) {
				if (codeLines[i].indexOf("{") != -1) tabs++;
				if (codeLines[i].indexOf("}") != -1) tabs--;

				if (old != tabs) {
					old = tabs;
					add = "";
					while (old > 0) {
						add += "\t";
						old--;
					}
					old = tabs;
				}

				codeLines[i] = add + codeLines[i];
			}
		} finally {
			tabs = null;
			old = null;
			add = null;
		}
		return codeLines;
	}

	var env: any = {
		eval: function (c: string) {
			code = c;
		},
		window: {},
		document: {}
	};

	// eslint-disable-next-line no-eval
	// @ts-ignore
	eval("with(env) {" + code + "}");

	var codeWithNewLines = (code + "").replace(/;/g, ";\n").replace(/{/g, "\n{\n").replace(/}/g, "\n}\n").replace(/\n;\n/g, ";\n").replace(/\n\n/g, "\n");

	var splitLines = codeWithNewLines.split("\n");
	splitLines = indent(splitLines);

	return splitLines.join("\n");
}

/**
 * Functor for a given base. Will efficiently convert
 * strings to natural numbers.
 */
class Unbaser {
	protected ALPHABET: Record<number, string> = {
		62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
		95: "' !\"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'"
	};
	protected base: number;
	protected dictionary: Record<string, number> = {};

	constructor(base: number) {
		this.base = base;

		// fill elements 37...61, if necessary
		if (36 < base && base < 62) {
			this.ALPHABET[base] = this.ALPHABET[base] || this.ALPHABET[62].substr(0, base);
		}
		// If base can be handled by int() builtin, let it do it for us
		if (2 <= base && base <= 36) {
			this.unbase = (value) => parseInt(value, base);
		} else {
			// Build conversion dictionary cache
			try {
				[...this.ALPHABET[base]].forEach((cipher, index) => {
					this.dictionary[cipher] = index;
				});
			} catch (er) {
				throw new ProcessError({
					code: "UNPACKER_ERROR",
					message: "Unsupported base encoding.",
					status: 500,
					expose: false
				});
			}
			this.unbase = this._dictunbaser;
		}
	}

	public unbase: (a: string) => number;

	/** Decodes a value to an integer. */
	private _dictunbaser(value: string): number {
		let ret = 0;
		[...value].reverse().forEach((cipher, index) => {
			ret = ret + this.base ** index * this.dictionary[cipher];
		});
		return ret;
	}
}
