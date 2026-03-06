/** Base media information shared by all media types
 * - title: The title of the media (Always in English)
 * - localizedTitle: Localized title if available (For example, the title in the user's language or region)
 * - duration: Duration in minutes
 * - releaseYear: Release year
 * - tmdbId: TMDB ID
 * - imdbId: IMDB ID if available
 */
export type IBaseMedia = {
	/* The original language of the media (e.g., "en", "fr", "es") */
	original_language: string;
	/* The original title of the media*/
	title: string;
	/* Localized titles in requester's language */
	localizedTitles: string[];
	/* Duration in minutes */
	duration: number;
	/* Release year */
	releaseYear: number;
	/* TMDB ID */
	tmdbId: string;
	/* IMDB ID if available */
	imdbId?: string;
};

/** Movie media type
 * - type: Media type: "movie"
 */
export type MovieMedia = IBaseMedia & {
	type: "movie";
};

/** Series media type
 * - season: Season number
 * - episode: Episode number
 * - type: Media type: "serie"
 * - ep_tmdbId: Episode TMDB ID
 * - ep_imdbId: Episode IMDB ID
 */
export type SerieMedia = IBaseMedia & {
	season: number;
	episode: number;
	type: "serie";
	ep_tmdbId?: string;
	ep_imdbId?: string;
};

/** Channel media type
 * - channelId: Unique identifier for the channel
 * - channelName: Name of the channel
 * - type: Media type: "channel"
 */
export type ChannelMedia = {
	channelId: string;
	channelName: string;
	type: "channel";
};

/**
 * Union type for all media types (movie, series, channel)
 * This allows the requester handler to work with any type of media request while maintaining type safety and clear structure for each media type's specific properties.
 */
export type Media = MovieMedia | SerieMedia | ChannelMedia;

/**
 * MediaType is a union type that defines the possible media types: "movie", "serie", or "channel". This is used in the provider definition to specify which types of media a provider supports.
 */
export type MediaType = "movie" | "serie" | "channel";
export const MEDIA_TYPES: MediaType[] = ["movie", "serie", "channel"];

/**
 * MediaIdType is a union type that defines the possible media ID types: "tmdb" or "imdb". This can be used to specify which type of ID is being referenced when working with media identifiers.
 */
export type MediaIdType = "tmdb" | "imdb";
