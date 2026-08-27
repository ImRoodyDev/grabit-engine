// Captures the device's real WebView User-Agent once at startup and strips the
// Android "; wv" token so it reads as genuine mobile Chrome. Cloudflare auto-solves
// for the device's real UA but can stall on a spoofed/desktop/wv one — so we reuse
// this exact string for the challenge WebView and every scrape fetch.

let sessionUserAgent: string | undefined;
/** The captured UA (wv-stripped), or undefined until the probe resolves / on web. */
export function getSessionUserAgent(): string | undefined {
	return sessionUserAgent;
}

/** Store the probed UA once, removing the Android WebView "; wv" marker.
 * @example "Mozilla/5.0 (Linux; Android 10; SM-G960U Build/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.7922.199 Mobile Safari/537.36"
 * @example Returns - "Mozilla/5.0 (Linux; Android 10; SM-G960U Build/QP1A.190711.020) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.7922.199 Mobile Safari/537.36"
 */
export function setDeviceUserAgent(rawUa: string): void {
	if (!rawUa || sessionUserAgent) return; // first capture wins
	sessionUserAgent = rawUa
		.replace(/;?\s*wv\b/i, "") // "... Build/…; wv)" -> "... Build/…)"
		.replace(/\s{2,}/g, " ")
		.trim();
}
