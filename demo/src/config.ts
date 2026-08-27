import { Platform } from "react-native";
import { moduleResolver, type RawScrapeRequester, UseSourcesConfig } from "grabit-engine";

// Desktop UAs used on native. The hidden challenge WebView otherwise defaults to the
// Android mobile UA, which some hosts (e.g. mixdrop) serve a stripped page to. cf_clearance
// binds to the UA, so this is picked once per app session and reused for every request.
const DESKTOP_USER_AGENTS = [
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
];

// One UA per app launch: random enough to avoid a single shared fingerprint, stable so
// cf_clearance stays valid across a scrape. On web, let the browser send its own UA.
const SESSION_USER_AGENT: string | undefined = Platform.OS === "web" ? undefined : DESKTOP_USER_AGENTS[Math.floor(Math.random() * DESKTOP_USER_AGENTS.length)];

/**
 * TMDB keys come from the environment so no secret is committed.
 * Set EXPO_PUBLIC_TMDB_API_KEYS in demo/.env (comma-separated for multiple keys).
 */
const TMDB_API_KEYS = (process.env.EXPO_PUBLIC_TMDB_API_KEYS ?? "")
	.split(",")
	.map((k) => k.trim())
	.filter(Boolean);

export const HAS_TMDB_KEY = TMDB_API_KEYS.length > 0;

/** Manager config is a singleton and independent of the scrape request. */
export const GRABIT_MANAGER_CONFIG: UseSourcesConfig["managerConfig"] = {
	source: {
		type: "github" as const,
		url: "https://github.com/ImRoodyDev/grabit-library",
		branch: "alpha-1.4b",
		rootDir: "dist",
		moduleResolver // shipped by grabit-engine
	},
	tmdbApiKeys: [...TMDB_API_KEYS],
	cache: { enabled: true, TTL: 300_000 },
	scrapeConfig: {
		concurrentOperations: 1,
		maxAttempts: 2,
		operationTimeout: 60_000 * 30, // 30 minutes
		errorThresholdRate: 2
	}
};

export type MediaType = "movie" | "serie";

/** Editable form state. Pre-filled with Inception so the demo works on first tap. */
export type FormState = {
	type: MediaType;
	tmdbId: string;
	title: string;
	releaseYear: string;
	season: string;
	episode: string;
	targetLanguageISO: string;
};

export const DEFAULT_FORM: FormState = {
	type: "movie",
	tmdbId: "27205", // Inception
	title: "Inception",
	releaseYear: "2010",
	season: "1",
	episode: "1",
	targetLanguageISO: "en"
};

/** Builds a RawScrapeRequester from form state, omitting blank optional fields. */
export function buildRequest(form: FormState): RawScrapeRequester {
	const year = Number(form.releaseYear);
	const base = {
		tmdbId: form.tmdbId.trim(),
		...(form.title.trim() ? { title: form.title.trim() } : {}),
		...(Number.isFinite(year) && year > 0 ? { releaseYear: year } : {})
	};

	const media =
		form.type === "serie"
			? { type: "serie" as const, ...base, season: Number(form.season) || 1, episode: Number(form.episode) || 1 }
			: { type: "movie" as const, ...base };

	return { media, targetLanguageISO: form.targetLanguageISO.trim() || "en", userAgent: SESSION_USER_AGENT };
}
