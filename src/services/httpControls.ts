import pLimit from "p-limit";
import { CACHE } from "./cache.ts";

/**
 * HTTP hardening used by {@link appFetch}: a minimal cookie jar, per-host
 * concurrency limiting, and 429 rate-limit tracking. For provider fetches the
 * concurrency/rate-limit/coalesce controls default on from the provider config.
 */

/**
 * Minimal in-memory cookie jar keyed by host. No domain/path matching — enough to
 * carry a session across the hops of one scrape (create one per provider run).
 */
export class CookieJar {
	private byHost = new Map<string, Map<string, string>>();

	/** Merge a response's `Set-Cookie` into the jar for `host`. */
	setFromResponse(host: string, headers: Headers): void {
		const raw = headers.get("set-cookie");
		if (!raw) return;
		const jar = this.byHost.get(host) ?? new Map<string, string>();
		// Split only on commas that start a new "name=" pair (handles Expires dates).
		for (const part of raw.split(/,(?=\s*[^;,\s]+=)/)) {
			const kv = part.split(";")[0]?.trim() ?? "";
			const eq = kv.indexOf("=");
			if (eq > 0) jar.set(kv.slice(0, eq), kv.slice(eq + 1));
		}
		this.byHost.set(host, jar);
	}

	/** Manually seed a cookie (e.g. from a solved challenge). */
	set(host: string, name: string, value: string): void {
		const jar = this.byHost.get(host) ?? new Map<string, string>();
		jar.set(name, value);
		this.byHost.set(host, jar);
	}

	/** `Cookie` header value for `host` ("" when empty). */
	header(host: string): string {
		const jar = this.byHost.get(host);
		return jar ? [...jar].map(([k, v]) => `${k}=${v}`).join("; ") : "";
	}
}

/** Per-host concurrency limiters, reused across requests. */
const hostLimiters = new Map<string, ReturnType<typeof pLimit>>();

/** Returns a `p-limit` gate for `host` with the given concurrency (min 1). */
export function hostLimiter(host: string, concurrency: number): ReturnType<typeof pLimit> {
	let limit = hostLimiters.get(host);
	if (!limit) {
		limit = pLimit(Math.max(1, concurrency));
		hostLimiters.set(host, limit);
	}
	return limit;
}

/** Ms until `host` may be hit again after a 429, or null when not limited. */
export function rateLimitedFor(host: string): number | null {
	const until = CACHE.get<number>(`ratelimit:${host}`);
	if (until == null) return null;
	const ms = until - Date.now();
	return ms > 0 ? ms : null;
}

/** Record a 429 back-off window for `host`. */
export function noteRateLimit(host: string, retryAfterMs: number): void {
	CACHE.set(`ratelimit:${host}`, Date.now() + retryAfterMs, retryAfterMs);
}

/** Parse a `Retry-After` header (seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(value: string | null): number {
	if (!value) return 0;
	const secs = Number(value);
	if (!Number.isNaN(secs)) return Math.max(0, secs * 1000);
	const date = Date.parse(value);
	return Number.isNaN(date) ? 0 : Math.max(0, date - Date.now());
}
