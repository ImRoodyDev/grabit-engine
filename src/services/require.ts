import { LocalSource, ProviderModule, ProvidersManifest } from "../types/index.ts";
import { pathJoin } from "../utils/path.ts";
import { validateProviderModules } from "../utils/validator.ts";
import { toInternalManifest } from "../utils/standard.ts";
import { ResolvedProviderSource } from "../types/models/Manager.ts";
import { PROVIDER_FETCH_CONCURRENCY } from "./github.ts";
import pLimit from "p-limit";

export namespace RequireService {
	export async function initializeProviders(source: LocalSource): Promise<ResolvedProviderSource> {
		let rootDir = source.rootDir ?? "./";
		if (!rootDir.endsWith("/")) rootDir += "/";
		const registry = new Map<string, ProviderModule>();

		// Load each provider module using the provided resolver function.
		// Resolvers may hit the filesystem or network, so run them concurrently.
		const limit = pLimit({ concurrency: PROVIDER_FETCH_CONCURRENCY });
		await Promise.all(
			Object.entries(source.manifest.providers).map(([scheme, manifest]) =>
				limit(async () => {
					const resolved = await source.resolve(pathJoin(rootDir, manifest.dir, scheme));
					// Handle default exports (CommonJS / ESM interop)
					const mod = (resolved as any).default ?? resolved;
					registry.set(scheme, mod);
				})
			)
		);

		// Validate the loaded providers
		const validations = validateProviderModules(registry);

		// source.manifest is typed as ProvidersManifest but was authored externally
		// (scheme only as map key) — promote it to guarantee scheme is in each entry.
		const meta = toInternalManifest(source.manifest);

		return {
			meta,
			providers: registry,
			validations: {
				errors: validations.errors,
				warnings: validations.warnings
			}
		};
	}

	export async function getManifest(source: LocalSource): Promise<ProvidersManifest> {
		return toInternalManifest(source.manifest);
	}
}
