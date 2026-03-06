import { isURL } from "validator";
import type { IsURLOptions } from "validator";
import { MEDIA_TYPES, ProvidersManifest, ProviderModule, ProviderModuleManifest, IProviderModuleWorkers, ProviderConfig } from "../types/index.ts";
import { Provider } from "../index.ts";
import { Logger } from "./logger.ts";

// Regex for validating provider schemes (e.g., "social/twitter", "movie", "serie")
const SCHEME_REGEX = /^[a-z][a-z0-9._-]*$/;
const VERSION_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?$/;

/**
 *  Checks if the given string is a valid URL.
 * @param url
 * @param options
 * @returns
 */
export function isValidURL(url: string, options?: IsURLOptions): boolean {
	// Simple URL validation using regex
	return isURL(url, {
		// require_protocol: true,
		allow_fragments: true,
		allow_underscores: true,
		allow_query_components: true,
		allow_trailing_dot: true,
		// require_protocol: false,
		...options
	});
}

function isValidScheme(scheme: string): boolean {
	// Scheme must be a non-empty string,
	// can contain letters, numbers, dashes, and underscores,
	// and must start with a letter (onnly lowercase letters allowed to avoid case sensitivity issues)
	// No spaces or special characters allowed
	return SCHEME_REGEX.test(scheme);
}

function isValidVersion(version: string): boolean {
	// Simple version validation (e.g., "1.0.0", "2.1", "0.5.3-beta")
	return VERSION_REGEX.test(version);
}

/**
 * Validates the provider manifest and returns an object containing any errors or warnings found during validation.
 */
export function validateProvidersManifest(manifest: ProvidersManifest) {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (!manifest.name || typeof manifest.name !== "string" || manifest.name.trim().length === 0) {
		errors.push("Manifest name is required and must be a non-empty string.");
	}

	// Warnings for optional fields
	if (manifest.author !== undefined && (typeof manifest.author !== "string" || manifest.author.trim().length === 0)) {
		warnings.push("Manifest author must be a non-empty string if specified.");
	}

	// Record of providers must be an object with at least one entry
	if (!manifest.providers || typeof manifest.providers !== "object" || Object.keys(manifest.providers).length === 0) {
		errors.push("Manifest must contain a 'providers' object with at least one provider entry.");
	}

	return {
		valid: errors.length === 0,
		manifest: manifest,
		errors,
		warnings
	};
}

export function validateProviderModule(module: ProviderModule) {
	const errors: string[] = [];
	const warnings: string[] = [];
	const provideConfig = module.provider.config as Partial<ProviderConfig>;
	const meta = (module.meta ?? {}) as Partial<ProviderModuleManifest>;
	const workers = (module.workers ?? {}) as Partial<IProviderModuleWorkers>;

	// Required fields validation
	if (!meta.name || typeof meta.name !== "string" || meta.name.trim().length === 0) {
		warnings.push("Provider name is required and must be a non-empty string.");
	}

	// Scheme is required and must be a valid scheme string	// A valid scheme is a non-empty string that can contain lowercase letters, numbers, dashes, and underscores, and must start with a letter
	if (!provideConfig.scheme || typeof provideConfig.scheme !== "string" || !isValidScheme(provideConfig.scheme)) {
		errors.push("Provider scheme is required and must be a valid scheme string (e.g., 'social/twitter', 'movie', 'serie').");
	}

	// Version is required
	if (!meta.version || typeof meta.version !== "string" || !isValidVersion(meta.version)) {
		warnings.push("Provider version is required and must be a valid version string (e.g., '1.0.0', '2.1', '0.5.3-beta').");
	}

	// Active is required and must be a boolean
	if (meta.active !== undefined && typeof meta.active !== "boolean") {
		errors.push("Provider active status must be a boolean.");
	}

	// Language is required and must be a non-empty string or non-empty array of strings
	if (meta.language !== undefined) {
		if (Array.isArray(meta.language)) {
			if (meta.language.length === 0) {
				errors.push("Provider language array must contain at least one language code.");
			} else if (!meta.language.every((lang: string) => typeof lang === "string" && lang.trim().length > 0)) {
				errors.push("Provider language array must contain only non-empty strings.");
			}
		} else if (typeof meta.language !== "string" || meta.language.trim().length === 0) {
			errors.push("Provider language must be a non-empty string or array of strings if specified.");
		}
	}

	// Requireed type env
	if (!meta.env || typeof meta.env !== "string" || !["node", "universal"].includes(meta.env)) {
		errors.push("Provider env is required and must be either 'node' or 'universal'.");
	}

	// Type is optional but if specified, must be either "media" or "subtitle"
	if (meta.type !== undefined && typeof meta.type !== "string") {
		errors.push("Provider type must be a string if specified.");
	} else if (meta.type !== undefined && !["media", "subtitle"].includes(meta.type)) {
		errors.push("Provider type must be either 'media' or 'subtitle' if specified.");
	}

	// Check the supported media types should be an array of strings of type 	MediaType (movie, serie, channel)
	if (!meta.supportedMediaTypes || !Array.isArray(meta.supportedMediaTypes) || meta.supportedMediaTypes.length === 0) {
		errors.push("Provider must specify at least one supported media type.");
	} else {
		for (const mediaType of meta.supportedMediaTypes) {
			if (!MEDIA_TYPES.includes(mediaType)) {
				errors.push(`Provider supported media type '${mediaType}' is not a valid media type.`);
			}
		}
	}

	// Priority should be a number if specified
	if (meta.priority !== undefined && typeof meta.priority !== "number") {
		errors.push("Provider priority must be a number if specified.");
	}

	// Dir should be a string if specified
	if (meta.dir !== undefined && (typeof meta.dir !== "string" || meta.dir.trim().length === 0)) {
		errors.push("Provider dir must be a non-empty string if specified.");
	}

	// Optional fields validation ( Getters)
	if (workers.getStreams !== undefined && typeof workers.getStreams !== "function") {
		errors.push("Provider getStreams must be a function if specified.");
	} else if (meta.type == "media" && workers.getStreams === undefined) {
		warnings.push("Provider of type 'media' should implement getStreams method.");
	}

	if (workers.getSubtitles !== undefined && typeof workers.getSubtitles !== "function") {
		errors.push("Provider getSubtitles must be a function if specified.");
	} else if (meta.type == "subtitle" && workers.getSubtitles === undefined) {
		warnings.push("Provider of type 'subtitle' should implement getSubtitles method.");
	}

	return { errors, warnings };
}

/**
 * Validates all provider modules in the registry and returns an object containing any errors or warnings
 * found during validation. This function iterates through each provider module in the registry, validates it
 * using the validateProviderModule function, and aggregates any errors or warnings into a single result object.
 * @returns An object with the following properties:
 */
export function validateProviderModules(registry: Map<string, ProviderModule | null>) {
	const errors: [string, string[]][] = [];
	const warnings: [string, string[]][] = [];
	const validModules: Map<string, ProviderModule> = new Map();

	for (const [scheme, mod] of registry) {
		if (!mod) {
			warnings.push([scheme, ["Provider module could not be loaded."]]);
			continue;
		}

		const v = validateProviderModule(mod);
		errors.push([scheme, v.errors]);
		warnings.push([scheme, v.warnings]);

		// Only add valid modules to the validModules map
		if (v.errors.length === 0) {
			validModules.set(scheme, mod);
		}
	}

	// If there are no valid modules, set valid to false
	if (validModules.size === 0) {
		errors.push(["registry", ["No valid provider modules found in the registry."]]);
	}

	return {
		valid: errors.length === 0,
		validModules,
		errors,
		warnings
	};
}

export function validateManifestConfiguration(provider: Provider, manifest: ProviderModuleManifest): void {
	const config = provider.config;
	const prefix = `\x1b[41m\x1b[37m ${manifest.name} \x1b[0m`;

	if (config.name !== manifest.name) {
		Logger.alwaysWarn(`${prefix} Provider config name "${config.name}" does not match manifest name "${manifest.name}".`);
	}

	const configLangs = Array.isArray(config.language) ? config.language : [config.language];
	const manifestLangs = Array.isArray(manifest.language) ? manifest.language : [manifest.language];
	const missingInManifest = configLangs.filter((lang) => !manifestLangs.includes(lang));
	const missingInConfig = manifestLangs.filter((lang) => !configLangs.includes(lang));
	if (missingInManifest.length > 0) {
		Logger.alwaysWarn(`${prefix} Languages in config but missing in manifest: [${missingInManifest.join(", ")}]`);
	}
	if (missingInConfig.length > 0) {
		Logger.alwaysWarn(`${prefix} Languages in manifest but missing in config: [${missingInConfig.join(", ")}]`);
	}
	if (missingInManifest.length === 0 && missingInConfig.length === 0 && configLangs.join(",") !== manifestLangs.join(",")) {
		Logger.alwaysWarn(`${prefix} Language order mismatch — config: [${configLangs.join(", ")}], manifest: [${manifestLangs.join(", ")}]`);
	}

	const configEntryKeys = [...new Set(Object.keys(config.entries).map((k) => k.replace(/^search_/, "")))].sort();
	const manifestMediaTypes = [...manifest.supportedMediaTypes].sort();
	if (configEntryKeys.length !== manifestMediaTypes.length || !configEntryKeys.every((key, i) => key === manifestMediaTypes[i])) {
		Logger.alwaysWarn(`${prefix} Provider config entry types [${configEntryKeys}] do not match manifest supportedMediaTypes [${manifestMediaTypes}].`);
	}
}
