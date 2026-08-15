import type { ScrapeRequester } from "../input/Requester.ts";

/**
 * Pluggable Cloudflare / anti-bot challenge solver.
 *
 * The engine ships a puppeteer-real-browser solver on Node. Other environments
 * plug in their own backing so challenge-solving is portable:
 *  - React Native: a hidden in-app WebView (recommended — puppeteer can't run
 *    on-device; the WebView executes the JS challenge and returns cookies + UA).
 *  - Web: a same-origin/relay proxy the page can reach (processing stays client-side).
 *  - Server: FlareSolverr, or the built-in puppeteer solver.
 *
 * A provider calls `ctx.solveChallenge(url)` and reuses the returned cookies + UA
 * on the following `ctx.xhr` hops (feed them into a {@link CookieJar}).
 */
export interface ChallengeSolver {
	/** Solve the interstitial at `url` and return the earned session material. */
	solve(url: URL, requester: ScrapeRequester, options?: ChallengeSolveOptions): Promise<ChallengeSolveResult>;
}

export interface ChallengeSolveOptions {
	/** Cookie name to wait for before resolving (e.g. `cf_clearance`). */
	waitForCookie?: string;
	/** Extra headers to seed the solving session. */
	headers?: Record<string, string>;
	/** Give up after this many ms. */
	timeoutMs?: number;
}

export interface ChallengeSolveResult {
	/** Rendered HTML of the solved page. */
	html: string;
	/** `Cookie` header value earned (e.g. `cf_clearance=…`). */
	cookies: string;
	/** Cookies as a name → value map. */
	cookieMap: Record<string, string>;
	/** User-Agent used by the solver (reuse it on follow-up requests). */
	userAgent: string;
}
