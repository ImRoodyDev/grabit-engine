import { HttpError } from "../types/HttpError.ts";
import { MovieMedia, SerieMedia } from "../types/input/Media.ts";
import { RawScrapeRequester } from "../types/input/Requester.ts";
import { ProcessError } from "../types/ProcessError.ts";
import { Logger } from "../utils/logger.ts";
import { fetchResponse, RequestInit } from "./fetcher.ts";

export namespace TMDB {
	const API_BASE_URL = "https://api.themoviedb.org/3";
	const API_KEYS: string[] = [];
	let CACHE_TTL = 0;

	/**
	 * Full details for a movie.
	 *
	 * @see https://developer.themoviedb.org/reference/movie-details
	 */
	interface MovieDetails {
		/** The TMDB ID. */
		id: number;
		/** The IMDb ID, or null if not available. */
		imdb_id: string | null;
		/** The original language of the movie (e.g. "en", "fr"). */
		original_language: string;
		/** The original title of the movie. */
		original_title: string;
		/** Release date in YYYY-MM-DD format. */
		release_date: string;
		/** Runtime in minutes. */
		runtime: number;
		/** The movie's title. ( Translated if available) */
		title: string;

		translations: Translations<MovieTranslationData>;
		external_ids: ExternalIds;
	}

	/**
	 * Full details for a TV show.
	 *
	 * @see https://developer.themoviedb.org/reference/tv-series-details
	 */
	interface TvShowDetails {
		/** The TMDB ID. */
		id: number;
		/** The languages available for the TV show. */
		languages: string[];
		/** The name of the TV show. */
		name: string;
		/** The original language of the TV show (e.g. "en", "fr"). */
		original_language: string;
		/** The original name of the TV show. */
		original_name: string;
		first_air_date: string;
		translations: Translations<SerieTranslationData>;
		external_ids: ExternalIds;
	}

	type ExternalIds = {
		id: number;
		imdb_id: string | null;
		wikidata_id: string | null;
		facebook_id: string | null;
		instagram_id: string | null;
		twitter_id: string | null;
	};

	type MovieTranslationData = {
		homepage: string;
		overview: string;
		runtime: number;
		tagline: string;
		title: string;
	};
	type SerieTranslationData = {
		homepage: string;
		overview: string;
		runtime: number;
		tagline: string;
		name: string;
	};

	type Translation<T extends MovieTranslationData | SerieTranslationData> = {
		iso_639_1: string;
		name: string;
		iso_3166_1: string;
		english_name: string;
		data: T;
	};

	type Translations<T extends MovieTranslationData | SerieTranslationData> = {
		translations: Translation<T>[];
	};

	function getRandomApiKey(): string {
		if (API_KEYS.length === 0) {
			throw new ProcessError({
				code: "TMDB_API_KEY_MISSING",
				message: "No TMDB API keys provided. Please set the API keys before making requests."
			});
		}
		const randomIndex = Math.floor(Math.random() * API_KEYS.length);
		return API_KEYS[randomIndex];
	}
	async function apiFetchResponse<GeneticResponse = unknown, GeneticError = unknown>(request: RequestInfo | URL, options: RequestInit = {}) {
		// Destructure options
		const { headers, ...restOptions } = options;

		// Check if the request url start with / if yes add the API
		if (typeof request === "string" && request.startsWith("/")) {
			// Remove leading slash to make it relative to the base URL (preserves /3/ in API)
			request = new URL(request, API_BASE_URL);
			request.pathname = "/3" + request.pathname;
			request.searchParams.append("api_key", getRandomApiKey());
		}

		// Set default options for proper cookie handling
		const defaultOptions: RequestInit = {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json"
				// Authorization: `Bearer ${getRandomApiKey()}`
			},
			cacheTTL: CACHE_TTL // Use the configured cache TTL
		};

		// Merge with user options
		const mergedOptions: RequestInit = {
			...defaultOptions,
			headers: {
				...defaultOptions.headers,
				...headers
			},
			...restOptions
		};

		return await fetchResponse<GeneticResponse, GeneticError>(request, mergedOptions).catch((error) => {
			if (error instanceof HttpError) {
				Logger.error(`[TMDB API] link: ${request.toString()}\nerror: ${error.message}`);
				return null;
			} else {
				Logger.error(`[TMDB API] Unexpected error in API call: ${error}`);
				throw error;
			}
		});
	}
	/** Retrieve detailed information for a specific TV show by ID. */
	async function tvDetails(id: string, lang = "en") {
		// Prepare query parameters for the API request
		const paramsObj: Record<string, string> = {
			language: lang,
			append_to_response: "translations,external_ids" // Extra data to retrieve
		};
		const params = new URLSearchParams(paramsObj).toString();

		// Make the API request to fetch TV details
		const response = await apiFetchResponse<TvShowDetails>(`/tv/${id}?${params}`);
		if (!response) return null;
		return response;
	}
	/** Retrieve detailed information for a specific movie by ID. */
	async function movieDetails(id: string, lang = "en") {
		// Prepare query parameters for the API request
		const paramsObj: Record<string, string> = {
			language: lang,
			append_to_response: "translations,external_ids" // Retrieve additional video, release date, and external IDs info
		};
		const params = new URLSearchParams(paramsObj).toString();

		// Make the API request to fetch movie details
		const response = await apiFetchResponse<MovieDetails>(`/movie/${id}?${params}`);
		if (!response) return null;
		return response;
	}
	async function episodeIds(tmdbId: string, season: number, episode: number) {
		const response = await apiFetchResponse<ExternalIds>(`/tv/${tmdbId}/season/${season}/episode/${episode}/external_ids`);
		if (!response) return null;
		return response;
	}

	/** Initialize the TMDB API keys and optional cache TTL. */
	export function init(keys: string[], options?: { cacheTTL?: number }) {
		API_KEYS.length = 0;
		API_KEYS.push(...keys);
		if (options?.cacheTTL !== undefined) {
			CACHE_TTL = options.cacheTTL;
		}
	}
	/** Create a requester media object based on the provided ScrapeRequester.
	 * It will override not override `user-provided` media properties except for `localizedTitles`,
	 * which will be generated based on the requester's `target language ISO code` and the media's translations from TMDB.
	 */
	export async function createRequesterMedia(requester: RawScrapeRequester): Promise<MovieMedia | SerieMedia> {
		const response =
			requester.media.type === "movie"
				? await movieDetails(requester.media.tmdbId, requester.targetLanguageISO)
				: requester.media.type === "serie"
					? await tvDetails(requester.media.tmdbId, requester.targetLanguageISO)
					: null;

		if (response === null) {
			throw new ProcessError({
				code: "TMDB_MEDIA_NOT_FOUND",
				message: `Media not found on TMDB for ID: ${(requester.media as any).tmdbId} and type: ${(requester.media as any).type}`
			});
		}

		// Get all localized titles from translations based on requester's target language ISO code
		const translatedTitles = response.translations.translations
			.map((t) => ({
				iso_639_1: t.iso_639_1,
				title: "title" in t.data ? t.data.title : t.data.name
			}))
			.filter((t) => {
				// Include only translations that match the requester's target language ISO code and the original title
				const matchesTargetLanguage = t.iso_639_1.toLowerCase().includes(requester.targetLanguageISO);
				return matchesTargetLanguage && !!t.title && t.title.length > 0;
			});

		if (requester.media.type === "movie" && "original_title" in response) {
			return {
				type: "movie",
				tmdbId: response.id.toString(),
				imdbId: requester.media.imdbId ?? response.external_ids.imdb_id ?? undefined,
				title: requester.media.title ?? response.original_title,
				localizedTitles: [...(requester.media.localizedTitles ?? []), ...translatedTitles.map((t) => t.title)],
				original_language: requester.media.original_language ?? response.original_language,
				duration: requester.media.duration ?? response.runtime,
				releaseYear: (requester.media.releaseYear ?? parseInt(response.release_date?.split("-")[0] ?? "0")) || 0
			} satisfies MovieMedia;
		} else if (requester.media.type === "serie" && "original_name" in response) {
			const epIds = await episodeIds(response.id.toString(), requester.media.season, requester.media.episode);
			// Get all localized titles from translations based on requester's target language ISO code
			return {
				type: "serie",
				tmdbId: response.id.toString(),
				imdbId: requester.media.imdbId ?? response.external_ids.imdb_id ?? undefined,
				ep_tmdbId: requester.media.ep_tmdbId ?? epIds?.id.toString() ?? undefined,
				title: requester.media.title ?? response.original_name,
				localizedTitles: [...(requester.media.localizedTitles ?? []), ...translatedTitles.map((t) => t.title)],
				original_language: requester.media.original_language ?? response.original_language,
				duration: requester.media.duration ?? response.translations.translations[0]?.data.runtime ?? 0,
				releaseYear: (requester.media.releaseYear ?? parseInt(response.first_air_date?.split("-")[0] ?? "0")) || 0,
				season: requester.media.season,
				episode: requester.media.episode
			} satisfies SerieMedia;
		} else {
			throw new ProcessError({
				code: "TMDB_UNSUPPORTED_MEDIA_TYPE",
				message: `Unsupported media type for TMDB requester media creation: ${requester.media.type}`
			});
		}
	}
}
