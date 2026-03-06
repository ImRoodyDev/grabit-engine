import { MediaIdType as MediaIdProvider, MediaType } from "../input/Media.ts";
import { stringFromPattern } from "../../utils/path.ts";

/** Provider configuration */
export type ProviderConfig = {
	/** Unique name of the provider (e.g., `"open-subtitles"`) */
	scheme: string;
	/** Name of the provider (e.g., `"OpenSubtitles"`) */
	name: string;
	/** Language code or array of language codes (e.g., `"en"`, `"fr"`, or `["en", "fr"]`)
	 *  The first is the main language of the provider
	 */
	language: string | string[];
	/** Homepage URL (e.g., "https://vidsrc.me/") */
	baseUrl: string;
	/** Supported media types mapped to their endpoint patterns
	 * The keys can be "movie", "serie", "channel"
	 * for direct media access, or "search_movie", "search_serie", "search_channel" for search endpoints.
	 * The values define how to construct the URL for accessing the media or performing a search based on
	 * the requester's media information.
	 *
	 * For formatting patterns:
	 * `{key:<digits>}` for zero-padded numeric values
	 * `{key:string}` for string-based values
	 * `{key:uri}` for URI-encoded values
	 * `{key:form-uri}` for form URI-encoded values}
	 *
	 * @example {
	 *   movie: { endpoint: '/embed/movie?tmdb={id:string}' },
	 *   serie: { endpoint: '/embed/tv?tmdb={id:string}&season={season:1}&episode={episode:1}' },
	 *   channel: { endpoint: '/embed/channel?tmdb={id:string}' },
	 * 	 search_movie: { endpoint: '/?s={0}', pattern: '/{id:string}/' }
	 *   search_serie: { endpoint: '/?s={0}', pattern: '/{id:string}/' }
	 * }
	 * The endpoint can include placeholders for media data (e.g., {id:string}, {season:2}, {episode:2}, {0} for search queries).
	 * @see {@link EProviderQueryKey} - for numeric placeholder index mappings used in search endpoints (e.g., {0} maps to "query").
	 * @see {@link stringFromPattern} - for how placeholders in the endpoint and pattern are replaced with media information to construct the final URL.
	 */
	entries: TProviderEntries;
	/** Supported media ID types, ordered by preference (e.g., ["tmdb", "imdb"])
	 * - If not specified, the provider will use TMDB IDs by default
	 * If type is channels its ignored since channels don't have tmdb/imdb ids
	 * @default ["tmdb"]
	 */
	mediaIds?: MediaIdProvider[];
	/** Whether content is CORS protected
	 * !! FOR NOW => NOT ATTACHED TO ANY FUNCTIONALITY
	 */
	contentAreCORSProtected?: boolean;
	/** Optional custom XHR settings for requests to this provider */
	xhr?: {
		/** Validate sent sources
		 * When enabled, the extension will perform an additional validation step by fetching
		 * the media URL and checking for a successful response before considering the source valid.
		 * This can help filter out dead links or sources that are not accessible, but may increase the time it takes to retrieve sources.
		 */
		validateSources?: boolean;
		/** Custom headers to include in requests to this provider */
		headers?: { [key: string]: string };
		retries?: {
			/** Maximum number of retry attempts for failed requests */
			maxAttempts?: number;
			/** Optional timeout in milliseconds for each request attempt */
			timeout?: number;
		};
	};
	/** Whether to use the search algorithm for this provider
	 * When enabled, the provider's search endpoint will be used to find media entries based on the requester's media information, and the results will be scored based on title, year, season/episode matches.
	 * A minimum score threshold can be set to filter out poor matches.
	 *
	 * Score ranges:
	 *  * For movies/series:
	 * Score range `[0 <-> 170]`
	 *
	 * For channels:
	 * Score range `[0 <-> 100]`
	 *
	 * Scoring breakdown:
	 * - `Title` similarity (`up to 100 points`): Based on cosine similarity of the media title and target title, scaled to 100.
	 * - `Year` match (`50 points`): If the media's release year matches the target year, add 50 points.
	 * - `Duration` similarity (`up to 20 points`): Based on how close the media's duration is to the target duration, with a maximum of 20 points for an exact match and decreasing as the difference increases.
	 *
	 *
	 * @argument title -  Match is considered true when similarity is 80 points or higher
	 */
	useSearchAlgorithm?: {
		/**
		 * Whether to enable the search algorithm for this provider.
		 * When enabled, the provider's search endpoint will be used to find media entries,
		 * and the results will be scored based on title, year, season/episode matches.
		 * A minimum score threshold can be set to filter out poor matches.
		 */
		enabled: boolean;
		/**
		 * Minimum score for a match to be considered valid.
		 * Title, year, season/episode matches contribute to the score.
		 * A higher score indicates a better match.
		 * Score range `[0 <-> 170]`
		 *
		 * For channels:
		 * Score range `[0 <-> 100]`
		 */
		minimumMatchScore: number;
	};
};

/** Mapping of media types to their corresponding endpoint patterns for a provider
 *  Query Parameters in endpoint patterns:
 * - {id:string} - Media ID (TMDB or IMDB based on provider's mediaIds preference)
 * - {season:N} - Season number, N = zero-padding width (e.g., {season:2} → "01")
 * - {episode:N} - Episode number, N = zero-padding width
 * @see {@link EProviderQueryKey} for numeric placeholder index mappings
 *
 * The pattern should contain placeholders in the format:
 * - `{key:<digits>}` for zero-padded numeric values
 * - `{key:string}` for string-based values
 * - `{key:uri}` for URI-encoded values
 * - `{key:form-uri}` for form URI-encoded values
 */
export type TProviderEntries = { [key in TProviderEntryKey]?: TProviderEntryPatterns };

/** Valid media type keys for provider entries */
type TProviderEntryKey = MediaType | `search_${MediaType}`;

/** Provider entry patterns for constructing media URLs */
export type TProviderEntryPatterns = {
	/**
	 * URL pattern with placeholders for media data
	 * {[key]: string | uri | form-uri | digits} - Placeholder format for media data to be replaced when constructing the URL
	 * Examples:
	 *   '/embed/movie?tmdb={id:string}'
	 *   '/embed/tv?tmdb={id:string}&season={season:1}&episode={episode:1}'
	 *   '/?s={0}'
	 * Placeholders:
	 *   {id:string} - Media ID
	 *   {season:N} - Season number, N = zero-padding width (e.g., {season:2} → "01")
	 *   {episode:N} - Episode number, N = zero-padding width
	 *
	 * @see {@link EProviderQueryKey} for numeric placeholder index mappings
	 */
	endpoint: string;
	/** Optional extra pattern for matching/searching media entries
	 * Examples:
	 * '-{season:2}x{episode:2}/' for TV shows to match "Show Name - S01E01/"
	 * @see {@link EProviderQueryKey} for numeric placeholder index mappings
	 */
	pattern?: string;
	/** Optional query parameters as key-value pairs */
	queries?: { [key: string]: string | number | boolean };
};

/** Maps numeric placeholder indices to query parameter names
 * Used in endpoint patterns like '/?s={0}' where {0} maps to "Media ID"
 * This allows for flexible endpoint patterns while maintaining a consistent way to reference media data in the provider configuration.
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
 */
export enum EProviderQueryKey {
	id = 0,
	tmdb = 1,
	imdb = 2,
	title = 3,
	year = 4,
	season = 5,
	episode = 6,
	ep_id = 7,
	ep_tmdb = 8,
	ep_imdb = 9
}

/** Mapping of query keys to their corresponding values for a provider */
export type TQueryMapping = { [key in EProviderQueryKey]: string | number | boolean } & { [key in keyof typeof EProviderQueryKey]?: string | number | boolean };

/** Supported media ID types for providers, with optional episode ID for series */
export type SupportedId<WithEpisodes extends boolean = false> = WithEpisodes extends true
	? {
			id: string;
			ep_id: string;
		}
	: {
			id: string;
		};

/**
 * Selectors for parsing search results from a provider's search endpoint.
 * These are used to extract media entries from the search results page.
 * - $results: Selector for the container that holds all search results.
 * - $result_entry: Selector for each individual search result entry within the results container.
 * - $result_title: Selector for the title of the media within each search result entry.
 * - $result_year: (Optional) Selector for the release year of the media within each search result entry.
 * - $result_date: (Optional) Selector for the release date of the media within each search result entry.
 * - $result_duration: (Optional) Selector for the duration of the media within each search result entry.
 *
 * For movies/series:
 * Score range `[0 <-> 170]`
 *
 * For channels:
 * Score range `[0 <-> 100]`
 *
 * Scoring breakdown:
 * - Title similarity (up to 100 points): Based on cosine similarity of the media title and target title, scaled to 100.
 * - Year match (50 points): If the media's release year matches the target year, add 50 points.
 * - Duration similarity (up to 20 points): Based on how close the media's duration is to the target duration, with a maximum of 20 points for an exact match and decreasing as the difference increases.
 */
export type TProviderSelectors = {
	$results: string;
	$result_entry: string;
	$result_title: string;
	$result_year?: string;
	$result_date?: string;
	$result_duration?: string;
};
