import { LocalSource, ProviderModule, ProvidersManifest } from "../types/index.ts";
import { pathJoin } from "../utils/path.ts";
import { validateProviderModules } from "../utils/validator.ts";
import { ResolvedProviderSource } from "../types/models/Manager.ts";

export namespace RequireService {
	export async function initializeProviders(source: LocalSource): Promise<ResolvedProviderSource> {
		let rootDir = source.rootDir ?? "./";
		if (!rootDir.endsWith("/")) rootDir += "/";
		const registry = new Map<string, ProviderModule>();

		// Load each provider module using the provided resolver function
		for (const [scheme, manifest] of Object.entries(source.manifest.providers)) {
			const resolved = await source.resolve(pathJoin(rootDir, manifest.dir, scheme));
			// Handle default exports (CommonJS / ESM interop)
			const mod = (resolved as any).default ?? resolved;
			registry.set(scheme, mod);
		}

		// Validate the loaded providers
		const validations = validateProviderModules(registry);

		return {
			meta: source.manifest,
			providers: registry,
			validations: {
				errors: validations.errors,
				warnings: validations.warnings
			}
		};
	}

	export async function getManifest(source: LocalSource): Promise<ProvidersManifest> {
		return source.manifest;
	}
}
