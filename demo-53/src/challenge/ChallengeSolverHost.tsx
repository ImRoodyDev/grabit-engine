import React, { useEffect, useRef, useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import CookieManager from "@preeternal/react-native-cookie-manager";
import { challengeQueue, type ChallengeJob, type ChallengeResult } from "./challengeQueue";

// Posts the current HTML + UA back to RN once per second, so we always hold the
// latest solved page while polling the native cookie store for the target cookie.
const INJECTED = `
(function () {
	var post = function () {
		try {
			window.ReactNativeWebView.postMessage(JSON.stringify({
				html: document.documentElement.outerHTML,
				ua: navigator.userAgent
			}));
		} catch (e) {}
	};
	post();
	setInterval(post, 1000);
})();
true;
`;

// Markers present on a Cloudflare (or similar) interstitial. While any of these
// show up, the real page hasn't loaded yet; once they're gone, we're through —
// even if the cookie never appeared (CF off, already cleared, or HttpOnly cookie).
const CHALLENGE_MARKERS = [
	"checking your browser",
	"cf-browser-verification",
	"attention required",
	"just a moment",
	"cf-browser-verification",
	"challenge-platform",
	"cf-challenge",
	"_cf_chl_opt",
	'id="challenge-form"',
	"checking your browser",
	"cf-turnstile",
	"enable javascript and cookies to continue"
];

/** True while the HTML still looks like a challenge interstitial. */
function looksLikeChallenge(html: string): boolean {
	if (!html) return false;
	const h = html.toLowerCase();
	return CHALLENGE_MARKERS.some((m) => h.includes(m));
}

/** Drives a single challenge in a hidden WebView until solved or timed out. */
function SolverWebView({ job }: { job: ChallengeJob }) {
	const latest = useRef({ html: "", ua: job.userAgent ?? "" });
	const done = useRef(false);
	const startedAt = useRef(Date.now());
	const deadline = Date.now() + Math.max(30_000, job.timeoutMs);

	useEffect(() => {
		console.info("[Challenge] browser opened", {
			url: job.url,
			waitForCookie: job.waitForCookie,
			timeoutMs: deadline
		});

		const readCookies = async (): Promise<Record<string, string>> => {
			const jar = await CookieManager.get(job.url, true).catch((error) => {
				console.warn("[Challenge] cookie read failed", { url: job.url, error });
				return {};
			});
			const map: Record<string, string> = {};
			for (const [name, cookie] of Object.entries(jar)) map[name] = (cookie as { value: string }).value;
			return map;
		};

		const finish = (result: ChallengeResult, passed: boolean) => {
			if (done.current) return;
			done.current = true;
			console.info("[Challenge] browser closed", {
				url: job.url,
				passed,
				elapsedMs: Date.now() - startedAt.current
			});
			job.resolve(result);
			challengeQueue.remove(job.id);
		};

		const timer = setInterval(async () => {
			const cookieMap = await readCookies();
			const html = latest.current.html.trim();

			// Primary signal: the requested cookie appeared (cf_clearance).
			const cookieSolved = job.waitForCookie ? cookieMap[job.waitForCookie] != null : false;
			// Fallback: we have a real page that is NOT the interstitial. Covers sites where
			// CF is off / already cleared, or an HttpOnly cookie we can't read — so we stop
			// waiting the full timeout for a cookie that will never come.
			const pageSolved = !looksLikeChallenge(html);
			const solved = cookieSolved || pageSolved;
			const expired = Date.now() >= deadline;
			if (!solved && !expired) return;

			clearInterval(timer);
			const elapsedMs = Date.now() - startedAt.current;
			if (solved) {
				console.info("[Challenge] passed", {
					url: job.url,
					elapsedMs,
					via: cookieSolved ? "cookie" : "page",
					cookies: Object.keys(cookieMap).length,
					htmlBytes: html.length
				});
			} else {
				console.warn("[Challenge] not solved (timed out)", {
					url: job.url,
					elapsedMs,
					cookies: Object.keys(cookieMap).length,
					gotHtml: latest.current.html.length > 0
				});
			}

			finish(
				{
					html: latest.current.html,
					cookies: Object.entries(cookieMap)
						.map(([name, value]) => `${name}=${value}`)
						.join("; "),
					cookieMap,
					userAgent: latest.current.ua || job.userAgent || ""
				},
				solved
			);
		}, 500);

		return () => clearInterval(timer);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const onMessage = (event: WebViewMessageEvent) => {
		try {
			const data = JSON.parse(event.nativeEvent.data) as { html?: string; ua?: string };
			if (data.html) latest.current.html = data.html;
			if (data.ua) latest.current.ua = data.ua;
			console.info("[Challenge] page update", {
				url: job.url,
				htmlBytes: data.html?.length ?? 0,
				ua: data.ua ?? "unknown"
			});
		} catch {
			/* ignore malformed messages */
		}
	};

	return (
		<WebView
			source={{ uri: job.url, headers: job.headers }}
			injectedJavaScript={INJECTED}
			onMessage={onMessage}
			onLoadEnd={() => console.debug("[Challenge] page loaded", { url: job.url })}
			onError={({ nativeEvent }) => console.error("[Challenge] webview error", { url: job.url, error: nativeEvent })}
			onHttpError={({ nativeEvent }) => console.warn("[Challenge] http error", { url: job.url, status: nativeEvent.statusCode })}
			// cf_clearance is HttpOnly, so shared/third-party cookies must be enabled
			// for CookieManager to read it back natively.
			sharedCookiesEnabled
			thirdPartyCookiesEnabled
			javaScriptEnabled
			domStorageEnabled
			{...(job.userAgent ? { userAgent: job.userAgent } : {})}
			style={styles.web}
		/>
	);
}

/** Mounted once at the app root; renders a hidden WebView per pending challenge. */
export default function ChallengeSolverHost() {
	const jobs = useSyncExternalStore(challengeQueue.subscribe, challengeQueue.getSnapshot);
	if (jobs.length === 0) return null;

	return (
		<View style={styles.host} pointerEvents="none">
			{jobs.map((job) => (
				<SolverWebView key={job.id} job={job} />
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	// Full-screen but behind everything and invisible: the page still lays out and
	// runs its JS challenge, yet the user never sees or touches it.
	host: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: -1, opacity: 0 },
	web: { flex: 1, backgroundColor: "transparent" }
});
