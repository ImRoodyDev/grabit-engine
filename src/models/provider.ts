import { Media, MediaType } from "../types/input/Media.ts";
import { ProviderConfig, EProviderQueryKey, TQueryMapping, SupportedId } from "../types/models/Provider.ts";
import { ScrapeRequester } from "../types/input/Requester.ts";
import { ProcessError } from "../types/ProcessError.ts";
import { buildRelativePath, stringFromPattern } from "../utils/path.ts";
import { deduplicateArray } from "../utils/standard.ts";

/** Normalizes the language property to an array of language codes */
function normalizeLanguages(language: string | string[]): string[] {
	return Array.isArray(language) ? language : [language];
}

/** Checks if the provider's language(s) include a given language code */
function hasLanguage(language: string | string[], code: string): boolean {
	return normalizeLanguages(language).includes(code);
}

export class Provider {
	private constructor(public config: ProviderConfig) {}

	public static create(config: ProviderConfig): Provider {
		return new Provider(config);
	}

	/** Constructs query parameters for a provider based on the media information and the provider's expected query format
	 * @param localizedTextIndex Index into `media.localizedTitles` to pick a translated title.
	 *   - `undefined` (default) — auto-selects a localized title when the provider's language differs from the media's original language.
	 *   - `number` — uses that specific index (wraps around via modulo).
	 *   - `null` — forces the original title, skipping localization entirely.
	 */
	private createQueries(media: Media, localizedTextIndex?: number | null): TQueryMapping {
		// Initialize mappings for both index-based and name-based query keys
		let indexMapping: { [key in EProviderQueryKey]?: string | number } = {};
		let nameMapping: { [key in keyof typeof EProviderQueryKey]?: string | number } = {};

		// Determine wheather to use translated title based on provider's language configuration
		// If localizedText index is provided and valid, use it, otherwise fallback to the first localized title or original title
		// If its null that mean to skip using localized title even if provider support the media language, and use original title instead
		const useTranslatated =
			localizedTextIndex !== null &&
			media.type !== "channel" &&
			(this.useTranslation(media) ||
				(localizedTextIndex !== undefined && media.localizedTitles[Math.max(localizedTextIndex, 0) % media.localizedTitles.length]));

		// Safe loc index
		const safeLocalizedTextIndex = media.type !== "channel" ? Math.max(localizedTextIndex ?? 0, 0) % media.localizedTitles.length : 0;

		if (media.type === "movie") {
			const supportedId = this.retrievePreferedIds<"movie">(media);

			indexMapping = {
				[EProviderQueryKey.id]: supportedId.id,
				[EProviderQueryKey.tmdb]: media.tmdbId,
				[EProviderQueryKey.imdb]: media.imdbId ?? "",
				[EProviderQueryKey.title]: useTranslatated ? (media.localizedTitles[safeLocalizedTextIndex] ?? media.title) : media.title,
				[EProviderQueryKey.year]: media.releaseYear
			};

			nameMapping = {
				id: indexMapping[EProviderQueryKey.id],
				tmdb: indexMapping[EProviderQueryKey.tmdb],
				imdb: indexMapping[EProviderQueryKey.imdb],
				title: indexMapping[EProviderQueryKey.title],
				year: indexMapping[EProviderQueryKey.year]
			};
		}
		if (media.type === "serie") {
			const supportedId = this.retrievePreferedIds<"serie">(media);

			indexMapping = {
				[EProviderQueryKey.id]: supportedId.id,
				[EProviderQueryKey.tmdb]: media.tmdbId,
				[EProviderQueryKey.imdb]: media.imdbId ?? "",
				[EProviderQueryKey.title]: useTranslatated ? (media.localizedTitles[safeLocalizedTextIndex] ?? media.title) : media.title,
				[EProviderQueryKey.year]: media.releaseYear,
				[EProviderQueryKey.season]: media.season,
				[EProviderQueryKey.episode]: media.episode,
				[EProviderQueryKey.ep_id]: supportedId.ep_id,
				[EProviderQueryKey.ep_tmdb]: media.ep_tmdbId,
				[EProviderQueryKey.ep_imdb]: media.ep_imdbId
			};

			nameMapping = {
				id: indexMapping[EProviderQueryKey.id],
				tmdb: indexMapping[EProviderQueryKey.tmdb],
				imdb: indexMapping[EProviderQueryKey.imdb],
				title: indexMapping[EProviderQueryKey.title],
				year: indexMapping[EProviderQueryKey.year],
				season: indexMapping[EProviderQueryKey.season],
				episode: indexMapping[EProviderQueryKey.episode],
				ep_id: indexMapping[EProviderQueryKey.ep_id],
				ep_tmdb: indexMapping[EProviderQueryKey.ep_tmdb],
				ep_imdb: indexMapping[EProviderQueryKey.ep_imdb]
			};
		} else if (media.type === "channel") {
			const supportedId = this.retrievePreferedIds<"channel">(media);

			indexMapping = {
				[EProviderQueryKey.id]: supportedId.id,
				[EProviderQueryKey.title]: media.channelName
			};

			nameMapping = {
				id: indexMapping[EProviderQueryKey.id],
				title: indexMapping[EProviderQueryKey.title]
			};
		}

		return { ...indexMapping, ...nameMapping } as TQueryMapping;
	}

	/** Creates a URL for the media resource based on the provider's configuration and the media information provided in the requester.
	 *
	 * @param localizedTextIndex Index into `localizedTitles` to pick a translated title.
	 *   - `undefined` — auto-selects based on provider language.
	 *   - `number` — uses that index (wraps via modulo).
	 *   - `null` — forces the original title, skipping localization.
	 * @description Throws an error if the media type is not supported by the provider.
	 * @returns A URL object representing the full URL to access the media resource on the provider's platform.
	 */
	public createResourceURL(requester: Omit<ScrapeRequester, "userAgent" | "proxyAgent">, localizedTextIndex?: number | null): URL {
		// Entry point
		const entry = this.config.entries[requester.media.type] || this.config.entries[`search_${requester.media.type}`];

		// Check if the media type is supported by the provider (movie, serie, or channel)
		if (!entry) {
			throw new ProcessError({
				code: "ProviderError",
				status: 400,
				message: `Provider ${this.config.name} does not support media type ${requester.media.type}`
			});
		}

		// Build the relative path
		const relativePath = buildRelativePath(entry, this.createQueries(requester.media, localizedTextIndex));

		// Construct the full URL using the provider's base URL and the relative path
		return new URL(relativePath, this.config.baseUrl);
	}

	/** Generates a deduplicated, prioritized list of resource URLs for the media request,
	 * combining ID-based and localized-title-based variants.
	 * @throws If the media type is not supported by the provider.
	 * @returns Deduplicated URL array ordered by priority.
	 */
	public createResourceUrls(requester: Omit<ScrapeRequester, "userAgent" | "proxyAgent">, customURL?: URL): URL[] {
		// Entry point
		const entry = this.config.entries[requester.media.type] || this.config.entries[`search_${requester.media.type}`];

		// Check if the media type is supported by the provider (movie, serie, or channel)
		if (!entry) {
			throw new ProcessError({
				code: "ProviderError",
				status: 400,
				message: `Provider ${this.config.name} does not support media type ${requester.media.type}`
			});
		}

		// Determine if we should use translation based on provider's language and media's original language
		const useTranslation = this.useTranslation(requester.media);
		const titleCount = requester.media.type === "channel" ? -1 : requester.media.localizedTitles.length;

		// Build the URL
		const urls = [
			// First: ID-based search (default createResourceURL)
			customURL?.href ?? this.createResourceURL(requester, undefined).href,
			// Then: localized title variants following the translation priority order
			...Array.from({ length: titleCount + 1 }, (_, i) => {
				const localizedIndex = useTranslation ? (i < titleCount ? i : null) : i === 0 ? null : i - 1;
				return this.createResourceURL(requester, localizedIndex).href;
			})
		];

		// Deduplicate URLs (in case of duplicate titles or if translation is not used)
		return deduplicateArray(urls).map((url) => new URL(url));
	}

	/** Creates a pattern string by replacing placeholders
	 *  in the given `pattern` with corresponding values from the media object and any additional custom parameters `customPattern`.
	 *
	 * For formatting patterns:
	 * `{key:<digits>}` for zero-padded numeric values
	 * `{key:string}` for string-based values
	 * `{key:uri}` for URI-encoded values
	 * `{key:form-uri}` for form URI-encoded values}
	 *
	 * - id = 0 → Media ID (TMDB or IMDB based on provider's mediaIds preference)
	 * - tmdb = 1 → Media TMDB ID
	 * - imdb = 2 → Media IMDB ID
	 * - title = 3 → Media title
	 * - year = 4 → Release year
	 * - season = 5 → Season number
	 * - episode = 6 → Episode number
	 * - ep_id = 7 → Episode ID Based on provider's mediaIds preference (for series)
	 * - ep_tmdb = 8 → Episode TMDB ID (for series)
	 * - ep_imdb = 9 → Episode IMDB ID (for series)
	 * @param localizedTextIndex Index into `localizedTitles` to pick a translated title.
	 *   - `undefined` — auto-selects based on provider language.
	 *   - `number` — uses that index (wraps via modulo).
	 *   - `null` — forces the original title, skipping localization.
	 * @see {@link EProviderQueryKey} for numeric placeholder index mappings}
	 */
	public createPatternString(pattern: string, media: Media, customPattern?: Record<string, unknown>, localizedTextIndex?: number | null): string {
		return stringFromPattern(pattern, {
			...this.createQueries(media, localizedTextIndex),
			...customPattern
		});
	}

	/** Applies the provider's pattern to a given URL or path, replacing placeholders with media information from the requester */
	public applyPatternURL(urlOrPath: string, requester: Omit<ScrapeRequester, "userAgent" | "proxyAgent">): URL {
		// Entry point
		const entry = this.config.entries[requester.media.type] || this.config.entries[`search_${requester.media.type}`];

		// Check if the media type is supported by the provider (movie, serie, or channel)
		if (!entry) {
			throw new ProcessError({
				code: "ProviderError",
				status: 400,
				message: `Provider ${this.config.name} does not support media type ${requester.media.type}`
			});
		}

		// Build the relative path
		const relativePath = buildRelativePath(entry, this.createQueries(requester.media), true);

		return new URL(relativePath, urlOrPath);
	}

	/** Checks if the provider supports the given media based on the provider's configuration and the media's properties */
	public isMediaSupported(media: Media): boolean {
		// Check if the media type is supported by the provider (movie, serie, or channel)
		const entrySupported = Object.keys(this.config.entries)
			.map((key) => key.replace("search_", ""))
			.includes(media.type);

		if (media.type !== "channel") {
			const supportedMediaIdTypes = this.config.mediaIds || ["tmdb"];
			return (
				// For provider that use search Algoritm this check is optional as they can still attempt to search using title
				// and other media information, but for provider that rely on direct media ID matching, this check is crucial
				// to ensure that the provider can actually process the media request based on its configuration.
				entrySupported &&
				supportedMediaIdTypes.some((type) => {
					const value = type === "tmdb" ? media.tmdbId : media.imdbId;
					return typeof value === "string" && value.trim().length > 0;
				})
			);
		} else return entrySupported;
	}

	/** Retrieves the preferred media ID(s) for the given media
	 * This function checks the media type and retrieves the appropriate ID(s) (TMDB or IMDB) based on the provider's expected media ID types.
	 * If the media type is not supported or if the required IDs are not available,
	 * it throws an error.
	 * @description Throws Error if not supported or invalid media ID is found based on provider's configuration. For series, it checks for both media ID and episode ID based on the provider's mediaIds preference.
	 * @returns An object containing the supported media ID(s) for the given media.
	 * - For movies: { id: string }
	 * - For series: { id: string, ep_id: string }
	 * - For channels: { id: string }
	 */
	public retrievePreferedIds<T = MediaType>(media: Media): SupportedId<T extends "serie" ? true : false> {
		if (!this.isMediaSupported(media))
			throw new ProcessError({
				code: "ProviderUnsupportedMedia",
				status: 400,
				message: `Media type ${media.type} is not supported by provider or No valid media ID found ${this.config.name}.`
			});

		const supportedMediaIdTypes = this.config.mediaIds || ["tmdb"];

		if (media.type === "channel") {
			return {
				id: media.channelId
			} as SupportedId<T extends "serie" ? true : false>;
		} else if (media.type === "movie") {
			const id = supportedMediaIdTypes
				.map((type) => (type === "tmdb" ? media.tmdbId : media.imdbId))
				.filter((id): id is string => !!id && id?.trim().length > 0)[0];

			if (!id) {
				throw new ProcessError({
					code: "ProviderUnsupportedMedia",
					status: 400,
					message: `No valid media ID found for provider ${this.config.name}.`
				});
			}

			return {
				id
			} as SupportedId<T extends "serie" ? true : false>;
		} else {
			const id = supportedMediaIdTypes
				.map((type) => (type === "tmdb" ? media.tmdbId : media.imdbId))
				.filter((id): id is string => !!id && id?.trim().length > 0)[0];
			const ep_id = supportedMediaIdTypes
				.map((type) => (type === "tmdb" ? media.ep_tmdbId : media.ep_imdbId))
				.filter((id): id is string => !!id && id?.trim().length > 0)[0];

			if (!id || !ep_id) {
				throw new ProcessError({
					code: "ProviderUnsupportedMedia",
					status: 400,
					message: `No valid series IDs found for provider ${this.config.name}. Missing media ID or episode ID based on provider's mediaIds preference.
						Provided media ID: ${id}, Provided episode ID: ${ep_id} \n Media IDs should be based on provider's mediaIds preference: ${supportedMediaIdTypes.join(", ")}.`
				});
			}

			return {
				id,
				ep_id
			} as SupportedId<T extends "serie" ? true : false>;
		}
	}

	/** Retrieves the primary language code from the provider's configuration */
	public getPrimaryLanguage(): string {
		const languages = normalizeLanguages(this.config.language);
		return languages.length > 0 ? languages[0] : "en";
	}

	public useTranslation(media: Media): boolean {
		if (media.type === "channel") return false; // Channels typically don't have localized titles
		if (!media.original_language || !media.localizedTitles?.length) return false;

		const providerLanguages = normalizeLanguages(this.config.language);
		return !providerLanguages.includes(media.original_language.toLowerCase().split("-")[0]) && media.localizedTitles.length > 0;
	}
}
