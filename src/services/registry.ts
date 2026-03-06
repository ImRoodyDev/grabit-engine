import { RegistrySource, ProvidersManifest } from "../types/index.ts";
import { validateProviderModules } from "../utils/validator.ts";
import { ResolvedProviderSource } from "../types/models/Manager.ts";

export namespace RegistryService {
	export async function initializeProviders(source: RegistrySource): Promise<ResolvedProviderSource> {
		const registry = new Map(Object.entries(source.providers));
		const validations = validateProviderModules(registry);
		return {
			meta: {
				name: source.name,
				author: source.author ?? "unknown",
				providers: Object.fromEntries(
					Object.entries(source.providers).map(([scheme, mod]) => {
						return [scheme, mod.meta];
					})
				)
			},
			providers: validations.validModules,
			validations: {
				errors: validations.errors,
				warnings: validations.warnings
			}
		};
	}

	export async function getManifest(source: RegistrySource): Promise<ProvidersManifest> {
		return {
			name: source.name,
			author: source.author ?? "unknown",
			providers: Object.fromEntries(
				Object.entries(source.providers).map(([scheme, mod]) => {
					return [scheme, mod.meta];
				})
			)
		};
	}
}
