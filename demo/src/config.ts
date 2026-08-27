import { moduleResolver } from "grabit-engine";

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
export const GRABIT_MANAGER_CONFIG = {
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
export function buildRequest(form: FormState) {
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

	return { media, targetLanguageISO: form.targetLanguageISO.trim() || "en" };
}
