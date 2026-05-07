import { ProviderContext } from "./Context.ts";
import { Provider } from "../../models/provider.ts";
import { MediaType } from "../input/Media.ts";
import { ScrapeRequester } from "../input/Requester.ts";
import { SubtitleSource, MediaSource, InternalSubtitleSource, InternalMediaSource } from "../output/MediaSources.ts";

export type ProviderModuleManifest = {
	/** Scheme identifier for the provider (e.g., `"opensubtitles"`) */
	scheme: string;

	/** Name of the provider (e.g., `"OpenSubtitles"`) */
	name: string;

	/** Collection version
	 * @example "1.0.0"
	 */
	version: string;

	/** Whether the provider is currently active */
	active: boolean;

	/** Language code or array of language codes (e.g., `"en"`, `"fr"`, or `["en", "fr"]`)
	 *  The first is the main language of the provider
	 */
	language: string | string[];

	/**
	 * type of element this provider provides
	 */
	type: "media" | "subtitle";

	/** Environment compatibility: `"node"` for Node.js only, `"universal"` for both Node.js and browser environments */
	env: "node" | "universal";

	/** Supported media types for this provider `(e.g., ["movie", "serie", "channel"])` */
	supportedMediaTypes: MediaType[];

	/** Priority of the provider (lower == higher priority) */
	priority?: number;

	/**
	 * dir folder path (supports groups, e.g. "providers/social/twitter")
	 * This defines the folder structure for the provider modules, allowing for organized grouping of providers based on categories or types. The keys represent the scheme identifiers used to reference the providers, while the values specify the relative paths to the provider modules within the project structure.
	 */
	dir?: string;
};

/** Provider module type definition
 * This type represents the structure of a provider module, which includes both
 * the provider's configuration and its handler methods for scraping media information.
 * The provider module is designed to be flexible, allowing for partial implementation of the IProviderManager interface while still requiring essential configuration properties such as name, priority, active status, language, and supported media types.
 */
export type ProviderModule = {
	/** The provider's configuration and metadata */
	meta: ProviderModuleManifest;
	/** The provider instance */
	provider: Provider;
	/** The worker methods for the provider */
	workers: IProviderModuleWorkers;
};
// export type ProviderModule = ProviderModuleManifest & IProviderModuleWorkers;

/** Provider handler interface defining methods for constructing resource URLs
 *  and applying patterns based on provider configuration and media information from the requester.
 */
export interface IProviderModuleWorkers {
	/** Grabs streams for a given requester */
	getStreams?(requester: ScrapeRequester, context: ProviderContext): Promise<MediaSource[]>;
	/** Grabs subtitles for a given requester */
	getSubtitles?(requester: ScrapeRequester, context: ProviderContext): Promise<SubtitleSource[]>;

	/** Optional cleanup method to release resources or perform any necessary cleanup tasks when the provider module is unloaded or the manager is shut down. */
	cleanup?(): Promise<void>;
}

export type InternalIProviderModuleWorkers = {
	/** Grabs streams for a given requester */
	getStreams?(requester: ScrapeRequester, context: ProviderContext): Promise<InternalMediaSource[]>;
	/** Grabs subtitles for a given requester */
	getSubtitles?(requester: ScrapeRequester, context: ProviderContext): Promise<InternalSubtitleSource[]>;

	/** Optional cleanup method to release resources or perform any necessary cleanup tasks when the provider module is unloaded or the manager is shut down. */
	cleanup?(): Promise<void>;
};
