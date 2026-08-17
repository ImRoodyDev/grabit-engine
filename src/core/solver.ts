import puppeteerCore from "./puppeteer.ts";
import type { ChallengeSolver, ChallengeSolveOptions, ChallengeSolveResult } from "../types/models/Solver.ts";
import type { ScrapeRequester } from "../types/input/Requester.ts";
import { ProcessError } from "../types/ProcessError.ts";
import { isNode } from "../utils/standard.ts";

/**
 * Pluggable challenge solver. Uses a host-injected solver when present
 * (RN hidden WebView / server FlareSolverr), otherwise the Node puppeteer pool.
 */

/** Host-provided solver, set via {@link setChallengeSolver}. */
let _hostSolver: ChallengeSolver | null = null;

/** Inject a challenge solver from the host (e.g. an RN WebView bridge or FlareSolverr). */
export function setChallengeSolver(solver: ChallengeSolver | null): void {
	_hostSolver = solver;
}

/** Solve a Cloudflare/anti-bot interstitial and return the earned html + cookies + UA. */
export async function solveChallenge(url: URL, requester: ScrapeRequester, options: ChallengeSolveOptions = {}): Promise<ChallengeSolveResult> {
	if (_hostSolver) return _hostSolver.solve(url, requester, options);
	if (!isNode()) {
		throw new ProcessError({
			code: "NO_CHALLENGE_SOLVER",
			message: "No challenge solver available. Set one via setChallengeSolver() (e.g. a hidden RN WebView).",
			expose: false
		});
	}
	return solveWithPuppeteer(url, requester, options);
}

/** Default Node solver: drive the puppeteer pool, then read the page's cookies + UA. */
async function solveWithPuppeteer(url: URL, requester: ScrapeRequester, options: ChallengeSolveOptions): Promise<ChallengeSolveResult> {
	const session = await puppeteerCore.launch(url, {
		requester,
		browsingOptions: { ignoreError: true, loadCriteria: "networkidle2", ...(options.headers ? { extraHeaders: options.headers } : {}) }
	});
	const page = session.page;
	// page.cookies() is deprecated. Use browser.cookies() and scope to the host, so a pooled/warm
	// browser that visited other sites does not leak their cookies into the result.
	const host = url.hostname.toLowerCase();
	const readCookies = async () =>
		(await session.browser.cookies()).filter((c) => {
			const domain = c.domain.replace(/^\./, "").toLowerCase();
			return host === domain || host.endsWith(`.${domain}`);
		});

	try {
		// Wait for the named challenge cookie (e.g. cf_clearance) if requested.
		if (options.waitForCookie) {
			const deadline = Date.now() + (options.timeoutMs ?? 20000);
			while (Date.now() < deadline) {
				if ((await readCookies()).some((c) => c.name === options.waitForCookie)) break;
				await new Promise((r) => setTimeout(r, 500));
			}
		}
		const html = await page.content();
		const cookies = await readCookies();
		const cookieMap: Record<string, string> = {};
		for (const c of cookies) cookieMap[c.name] = c.value;
		// puppeteerLoad applies requester.userAgent when set, so that is the UA the browser used.
		// Only when the requester omits one does the browser pick its own, which we read from the page.
		// The host must reuse this exact UA later, since Cloudflare binds cf_clearance to the UA (and IP).
		let userAgent = requester.userAgent ?? "";
		if (!userAgent) {
			try {
				userAgent = await page.evaluate(() => (globalThis as any).navigator?.userAgent ?? "");
			} catch {
				/* best-effort */
			}
		}
		return { html, cookies: cookies.map((c) => `${c.name}=${c.value}`).join("; "), cookieMap, userAgent };
	} finally {
		await session.page.close().catch(() => null);
	}
}

export default { solveChallenge, setChallengeSolver };
