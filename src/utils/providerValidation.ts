import type { ProviderModuleManifest } from "../types/models/Modules.ts";
import { Provider } from "../models/provider.ts";
import { Logger } from "./logger.ts";

export function validateManifestConfiguration(provider: Provider, manifest: ProviderModuleManifest): void {
	const config = provider.config;
	const label = `${manifest.name || config.name || "unknown-provider"} (${config.scheme || "unknown-scheme"})`;
	const prefix = `[${label}]`;

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
		Logger.alwaysWarn(`${prefix} Language order mismatch — config: [${configLangs.join(", ")}], manifest: [${manifestLangs.join(", ")}].`);
	}

	const configEntryKeys = [...new Set(Object.keys(config.entries).map((k) => k.replace(/^search_/, "")))].sort();
	const manifestMediaTypes = [...manifest.supportedMediaTypes].sort();
	if (configEntryKeys.length !== manifestMediaTypes.length || !configEntryKeys.every((key, i) => key === manifestMediaTypes[i])) {
		Logger.alwaysWarn(`${prefix} Provider config entry types [${configEntryKeys}] do not match manifest supportedMediaTypes [${manifestMediaTypes}].`);
	}
}
