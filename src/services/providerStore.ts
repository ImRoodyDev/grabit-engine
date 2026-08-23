// Persistent bundle cache for remote sources. Wraps a host-provided key/value
// store (AsyncStorage / MMKV / localStorage) so fetched provider source and the
// manifest survive app restarts instead of being re-downloaded every cold start.
//
// Every call is wrapped in try/catch: a broken or throwing store must never break
// provider loading — it just degrades to a normal network fetch.

import type { PersistentStore, ProvidersManifest } from "../types/models/Manager.ts";
import { Logger } from "../utils/logger.ts";

const NS = "grabit";

/** Persisted manifest plus the ETag it was fetched with (for conditional requests). */
export type StoredManifest = { etag?: string; manifest: ProvidersManifest };

/** Manifest key is per source; module key is per source + scheme + version, so a
 *  version bump in the manifest naturally misses and re-fetches that provider. */
export const manifestKey = (sourceKey: string): string => `${NS}:manifest:${sourceKey}`;
export const moduleKey = (sourceKey: string, scheme: string, version: string): string => `${NS}:module:${sourceKey}:${scheme}@${version}`;

export async function readManifest(store: PersistentStore, sourceKey: string): Promise<StoredManifest | null> {
	try {
		const raw = await store.getItem(manifestKey(sourceKey));
		return raw ? (JSON.parse(raw) as StoredManifest) : null;
	} catch (error) {
		Logger.debug(`[ProviderStore] Failed to read persisted manifest: ${error instanceof Error ? error.message : error}`);
		return null;
	}
}

export async function writeManifest(store: PersistentStore, sourceKey: string, value: StoredManifest): Promise<void> {
	try {
		await store.setItem(manifestKey(sourceKey), JSON.stringify(value));
	} catch (error) {
		Logger.debug(`[ProviderStore] Failed to persist manifest: ${error instanceof Error ? error.message : error}`);
	}
}

export async function readModuleSource(store: PersistentStore, sourceKey: string, scheme: string, version: string): Promise<string | null> {
	try {
		return await store.getItem(moduleKey(sourceKey, scheme, version));
	} catch (error) {
		Logger.debug(`[ProviderStore] Failed to read persisted source for "${scheme}": ${error instanceof Error ? error.message : error}`);
		return null;
	}
}

export async function writeModuleSource(store: PersistentStore, sourceKey: string, scheme: string, version: string, source: string): Promise<void> {
	try {
		await store.setItem(moduleKey(sourceKey, scheme, version), source);
	} catch (error) {
		Logger.debug(`[ProviderStore] Failed to persist source for "${scheme}": ${error instanceof Error ? error.message : error}`);
	}
}
