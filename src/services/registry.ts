import { RegistrySource, ProvidersManifest } from "../types/index.ts";
import { validateProviderModules } from "../utils/validator.ts";
import { toInternalManifest, filterManifestProviders } from "../utils/standard.ts";
import { ResolvedProviderSource } from "../types/models/Manager.ts";

export namespace RegistryService {
	export async function initializeProviders(source: RegistrySource): Promise<ResolvedProviderSource> {
		// Filter on each module's declared language (from meta), then keep the originals.
		const langMap = Object.fromEntries(Object.entries(source.providers).map(([scheme, mod]) => [scheme, { language: mod.meta.language }]));
		const allowed = new Set(Object.keys(filterManifestProviders(langMap, source.filter)));
		const registry = new Map(Object.entries(source.providers).filter(([scheme]) => allowed.has(scheme)));
		// Inject the canonical scheme into each module's meta from the map key.
		for (const [scheme, mod] of registry.entries()) {
			mod.meta.scheme = scheme;
		}
		const validations = validateProviderModules(registry);
		// Build an ExternalProviderManifest (no scheme in body) then promote it.
		const meta = toInternalManifest({
			name: source.name,
			author: source.author ?? "unknown",
			providers: Object.fromEntries(
				Array.from(registry.entries()).map(([scheme, mod]) => [scheme, mod.meta])
			)
		});
		return {
			meta,
			providers: validations.validModules,
			validations: {
				errors: validations.errors,
				warnings: validations.warnings
			}
		};
	}

	export async function getManifest(source: RegistrySource): Promise<ProvidersManifest> {
		return toInternalManifest({
			name: source.name,
			author: source.author ?? "unknown",
			providers: Object.fromEntries(
				Object.entries(source.providers).map(([scheme, mod]) => [scheme, mod.meta])
			)
		});
	}
}
