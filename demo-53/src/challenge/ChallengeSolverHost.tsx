import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import CookieManager from "@preeternal/react-native-cookie-manager";
import { challengeQueue, type ChallengeJob, type ChallengeResult } from "./challengeQueue";
import { getSessionUserAgent, setDeviceUserAgent } from "./deviceUserAgent";

// Toggle the interactive fallback: when a challenge can't auto-solve before its
// timeout, reveal the WebView and let the user tap through the check. Set false to
// keep the old behaviour (give up silently at the timeout).
const INTERACTIVE_FALLBACK = true;
// How long the user gets to solve it by hand once the WebView is revealed.
const MANUAL_WINDOW_MS = 8_000;
// On TV the prompt must be focusable for the remote to select it. WebView content
// itself is hard to navigate with a remote — see the note in the repo discussion.
const FOCUS_ON_TV = Platform.isTV === true;
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
	"just a moment",
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

/** Mounted once at the app root; runs the UA probe and a hidden WebView per challenge. */
export default function ChallengeSolverHost() {
	const jobs = useSyncExternalStore(challengeQueue.subscribe, challengeQueue.getSnapshot);

	return (
		<View style={styles.host} pointerEvents="box-none">
			<DeviceUserAgentProbe />
			{jobs.map((job) => (
				<SolverWebView key={job.id} job={job} />
			))}
		</View>
	);
}

/** Hidden WebView mounted once at startup: captures the device's real UA. */
function DeviceUserAgentProbe() {
	const [done, setDone] = useState(() => getSessionUserAgent() != null);
	if (done) return null;
	return (
		<WebView
			source={{ html: "<!doctype html><meta charset=utf-8>" }}
			injectedJavaScript={"window.ReactNativeWebView.postMessage(navigator.userAgent); true;"}
			onMessage={(e) => {
				setDeviceUserAgent(e.nativeEvent.data);
				setDone(true);
			}}
			javaScriptEnabled
			style={styles.probe}
			pointerEvents="none"
		/>
	);
}

/** Drives a single challenge in a hidden WebView until solved or timed out. */
function SolverWebView({ job }: { job: ChallengeJob }) {
	const latest = useRef({ html: "", ua: job.userAgent ?? "" });
	const done = useRef(false);
	const startedAt = useRef(Date.now());
	// Auto-solve window (headless). Interactive fallback adds MANUAL_WINDOW_MS after.
	const autoDeadline = useRef(Date.now() + Math.max(5_000, job.timeoutMs)).current;
	const manualRef = useRef(false);
	const manualDeadline = useRef(0);

	// Rendering state: whether the WebView is revealed and whether the prompt shows.
	const [manual, setManual] = useState(false);
	const [prompt, setPrompt] = useState(true);

	useEffect(() => {
		console.info("[Challenge] browser opened", { url: job.url, waitForCookie: job.waitForCookie, timeoutMs: job.timeoutMs });

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
			console.info("[Challenge] browser closed", { url: job.url, passed, elapsedMs: Date.now() - startedAt.current });
			job.resolve(result);
			challengeQueue.remove(job.id);
		};

		const settle = (cookieMap: Record<string, string>, passed: boolean, via: string) => {
			const elapsedMs = Date.now() - startedAt.current;
			if (passed)
				console.info("[Challenge] passed", { url: job.url, elapsedMs, via, cookies: Object.keys(cookieMap).length, htmlBytes: latest.current.html.length });
			else
				console.warn("[Challenge] not solved (timed out)", {
					url: job.url,
					elapsedMs,
					via,
					cookies: Object.keys(cookieMap).length,
					gotHtml: latest.current.html.length > 0
				});
			finish(
				{
					html: latest.current.html,
					cookies: Object.entries(cookieMap)
						.map(([name, value]) => `${name}=${value}`)
						.join("; "),
					cookieMap,
					userAgent: latest.current.ua || job.userAgent || ""
				},
				passed
			);
		};

		const timer = setInterval(async () => {
			const cookieMap = await readCookies();
			const html = latest.current.html.trim();

			// Primary signal: the requested cookie appeared (cf_clearance). Fallback: a real
			// page that is NOT the interstitial (CF off / cleared, or an unreadable HttpOnly cookie).
			const cookieSolved = job.waitForCookie ? cookieMap[job.waitForCookie] != null : false;
			const pageSolved = html.length > 0 && !looksLikeChallenge(html);
			if (cookieSolved || pageSolved) {
				clearInterval(timer);
				settle(cookieMap, true, cookieSolved ? "cookie" : "page");
				return;
			}

			const now = Date.now();
			if (now < autoDeadline) return; // still auto-solving headlessly

			if (!INTERACTIVE_FALLBACK) {
				clearInterval(timer);
				settle(cookieMap, false, "auto");
				return;
			}

			// Reveal the WebView and let the user solve it by hand, once.
			if (!manualRef.current) {
				manualRef.current = true;
				manualDeadline.current = now + MANUAL_WINDOW_MS;
				setManual(true);
				setPrompt(true);
				console.warn("[Challenge] awaiting manual solve", { url: job.url, windowMs: MANUAL_WINDOW_MS });
				return;
			}

			// Manual window elapsed without a solve — give up.
			if (now >= manualDeadline.current) {
				clearInterval(timer);
				settle(cookieMap, false, "manual");
			}
		}, 500);

		return () => clearInterval(timer);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const onMessage = (event: WebViewMessageEvent) => {
		try {
			const data = JSON.parse(event.nativeEvent.data) as { html?: string; ua?: string };
			if (data.html) latest.current.html = data.html;
			if (data.ua) latest.current.ua = data.ua;
		} catch {
			/* ignore malformed messages */
		}
	};

	return (
		<View style={[styles.slot, manual ? styles.slotVisible : styles.slotHidden]} pointerEvents={manual ? "auto" : "none"}>
			<WebView
				focusable={FOCUS_ON_TV}
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

			{manual && prompt && (
				<Pressable style={styles.overlay} onPress={() => setPrompt(false)} focusable={FOCUS_ON_TV} hasTVPreferredFocus={FOCUS_ON_TV}>
					<View style={styles.promptBox}>
						<Text style={styles.promptTitle}>Verification needed</Text>
						<Text style={styles.promptText}>Press verification box, then complete the check to continue.</Text>
					</View>
				</Pressable>
			)}
		</View>
	);
}

/** True while the HTML still looks like a challenge interstitial. */
function looksLikeChallenge(html: string): boolean {
	if (!html) return false;
	const h = html.toLowerCase();
	return CHALLENGE_MARKERS.some((m) => h.includes(m));
}

const styles = StyleSheet.create({
	// Absolute overlay above the app, but click-through: hidden slots don't block,
	// only a revealed (manual) slot captures touches.
	host: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 },
	probe: { position: "absolute", width: 1, height: 1, opacity: 0 },
	slot: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
	// Rendered but invisible & non-interactive: the page still runs its JS challenge.
	slotHidden: { opacity: 0, zIndex: -1 },
	slotVisible: { opacity: 1, zIndex: 1000 },
	web: { flex: 1, backgroundColor: "transparent" },
	overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" },
	promptBox: { maxWidth: 320, padding: 20, borderRadius: 14, backgroundColor: "#1c1c22", borderWidth: 1, borderColor: "#3a3a44", gap: 8 },
	promptTitle: { color: "#fff", fontWeight: "700", fontSize: 16, textAlign: "center" },
	promptText: { color: "rgba(255,255,255,0.75)", fontSize: 13, textAlign: "center" }
});
