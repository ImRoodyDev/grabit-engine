import { isURL } from "validator";
import type { IsURLOptions } from "validator";
import { MEDIA_TYPES } from "../types/input/Media.ts";
import type { ProviderConfig } from "../types/models/Provider.ts";
import type { ProvidersManifest } from "../types/models/Manager.ts";
import type { IProviderModuleWorkers, ProviderModule, ProviderModuleManifest } from "../types/models/Modules.ts";
import { Provider } from "../models/provider.ts";

// Regex for validating provider schemes (e.g., "social/twitter", "9filmyzilla", "movie", "serie")
const SCHEME_REGEX = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
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
	// can contain lowercase letters, numbers, dots, dashes, underscores,
	// and slash-delimited groups. Each segment must start with a lowercase letter or digit.
	// No spaces or other special characters allowed.
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
	const providerRecord = module.provider as Partial<Provider> | undefined;
	const provideConfig = (providerRecord?.config ?? {}) as Partial<ProviderConfig>;
	const meta = (module.meta ?? {}) as Partial<ProviderModuleManifest>;
	const workers = (module.workers ?? {}) as Partial<IProviderModuleWorkers>;

	// Required fields validation
	if (!meta.name || typeof meta.name !== "string" || meta.name.trim().length === 0) {
		warnings.push("Provider name is required and must be a non-empty string.");
	}

	// Scheme is required and must be a valid scheme string.
	// A valid scheme is a non-empty string that can contain lowercase letters,
	// numbers, dots, dashes, underscores, and slash-delimited groups.
	if (!provideConfig.scheme || typeof provideConfig.scheme !== "string" || !isValidScheme(provideConfig.scheme)) {
		errors.push("Provider scheme is required and must be a valid scheme string (e.g., '9filmyzilla', 'social/twitter', 'movie', 'serie').");
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

		if (typeof mod !== "object" || mod === null) {
			errors.push([scheme, ["Provider module export is invalid. Expected an object with meta, provider, and workers."]]);
			continue;
		}

		if (!("provider" in mod) || !("meta" in mod) || !("workers" in mod)) {
			errors.push([scheme, ["Provider module export is malformed. Expected fields: meta, provider, workers."]]);
			continue;
		}

		const v = validateProviderModule(mod);
		const moduleErrors = v.errors.map((message) => message.trim()).filter(Boolean);
		const moduleWarnings = v.warnings.map((message) => message.trim()).filter(Boolean);

		if (moduleErrors.length > 0) {
			errors.push([scheme, moduleErrors]);
		}
		if (moduleWarnings.length > 0) {
			warnings.push([scheme, moduleWarnings]);
		}

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

type ValidationIssues = [string, string[]][];

export function formatValidationIssues(issues: ValidationIssues): string {
	return issues.map(([scheme, messages]) => `Scheme "${scheme}":\n  - ${messages.join("\n  - ")}`).join("\n");
}

export function countValidationMessages(issues: ValidationIssues): number {
	return issues.reduce((count, [, messages]) => count + messages.length, 0);
}
