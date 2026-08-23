/**
 * Unit coverage for the native cold-start loading helpers:
 *   - filterManifestProviders (scheme/language narrowing before fetch+eval)
 *   - providerStore (persistent bundle cache, guarded against a broken store)
 */
import { filterManifestProviders } from "../../src/utils/standard";
import * as ProviderStore from "../../src/services/providerStore";
import type { PersistentStore } from "../../src/types/models/Manager";

type Entry = { language: string | string[] };

const PROVIDERS: Record<string, Entry> = {
	"en/alpha": { language: "en" },
	"fr/beta": { language: ["fr", "en"] },
	"es/gamma": { language: "es-ES" }
};

describe("filterManifestProviders", () => {
	it("returns all providers when no filter is given", () => {
		expect(Object.keys(filterManifestProviders(PROVIDERS))).toHaveLength(3);
		expect(Object.keys(filterManifestProviders(PROVIDERS, {}))).toHaveLength(3);
	});

	it("keeps only the listed schemes", () => {
		const out = filterManifestProviders(PROVIDERS, { schemes: ["en/alpha", "es/gamma"] });
		expect(Object.keys(out).sort()).toEqual(["en/alpha", "es/gamma"]);
	});

	it("keeps providers whose language intersects (primary subtag)", () => {
		const out = filterManifestProviders(PROVIDERS, { languages: ["en"] });
		// en/alpha (en) and fr/beta (fr,en) match; es/gamma does not
		expect(Object.keys(out).sort()).toEqual(["en/alpha", "fr/beta"]);
	});

	it("normalizes region tags to the primary subtag on both sides", () => {
		const out = filterManifestProviders(PROVIDERS, { languages: ["ES-mx"] });
		expect(Object.keys(out)).toEqual(["es/gamma"]);
	});

	it("applies scheme and language filters together", () => {
		const out = filterManifestProviders(PROVIDERS, { schemes: ["en/alpha", "fr/beta"], languages: ["fr"] });
		expect(Object.keys(out)).toEqual(["fr/beta"]);
	});
});

describe("providerStore", () => {
	const makeStore = (): PersistentStore & { map: Map<string, string> } => {
		const map = new Map<string, string>();
		return {
			map,
			getItem: (k) => map.get(k) ?? null,
			setItem: (k, v) => void map.set(k, v),
			removeItem: (k) => void map.delete(k)
		};
	};

	it("keys modules by source, scheme and version", () => {
		expect(ProviderStore.moduleKey("github:x", "en/alpha", "1.2.0")).toBe("grabit:module:github:x:en/alpha@1.2.0");
		expect(ProviderStore.manifestKey("github:x")).toBe("grabit:manifest:github:x");
	});

	it("round-trips module source through the store", async () => {
		const store = makeStore();
		await ProviderStore.writeModuleSource(store, "github:x", "en/alpha", "1.0.0", "SRC");
		expect(await ProviderStore.readModuleSource(store, "github:x", "en/alpha", "1.0.0")).toBe("SRC");
		// A version bump misses, so a stale bundle is never served.
		expect(await ProviderStore.readModuleSource(store, "github:x", "en/alpha", "2.0.0")).toBeNull();
	});

	it("round-trips the manifest with its etag", async () => {
		const store = makeStore();
		const value = { etag: 'W/"abc"', manifest: { name: "lib", providers: {} } };
		await ProviderStore.writeManifest(store, "github:x", value as any);
		expect(await ProviderStore.readManifest(store, "github:x")).toEqual(value);
	});

	it("degrades gracefully when the store throws", async () => {
		const broken: PersistentStore = {
			getItem: () => {
				throw new Error("boom");
			},
			setItem: () => {
				throw new Error("boom");
			}
		};
		// Reads return null and writes swallow, so loading falls back to the network.
		expect(await ProviderStore.readModuleSource(broken, "k", "s", "v")).toBeNull();
		expect(await ProviderStore.readManifest(broken, "k")).toBeNull();
		await expect(ProviderStore.writeModuleSource(broken, "k", "s", "v", "x")).resolves.toBeUndefined();
	});
});
