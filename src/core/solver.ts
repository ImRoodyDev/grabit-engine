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
	try {
		const page = session.page;
		// Wait for the named challenge cookie (e.g. cf_clearance) if requested.
		if (options.waitForCookie) {
			const deadline = Date.now() + (options.timeoutMs ?? 20000);
			while (Date.now() < deadline) {
				const cookies = await page.cookies();
				if (cookies.some((c: { name: string }) => c.name === options.waitForCookie)) break;
				await new Promise((r) => setTimeout(r, 500));
			}
		}
		const html = await page.content();
		const cookies = await page.cookies();
		const cookieMap: Record<string, string> = {};
		for (const c of cookies) cookieMap[c.name] = c.value;
		let userAgent = "";
		try {
			userAgent = await page.evaluate(() => (globalThis as any).navigator?.userAgent ?? "");
		} catch {
			/* best-effort */
		}
		return { html, cookies: cookies.map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join("; "), cookieMap, userAgent };
	} finally {
		await session.page.close().catch(() => null);
	}
}

export default { solveChallenge, setChallengeSolver };
