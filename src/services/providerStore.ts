// Persistent bundle cache for remote sources. Wraps a host-provided key/value
// store (AsyncStorage / MMKV / localStorage) so fetched provider source and the
// manifest survive app restarts instead of being re-downloaded every cold start.
//
// Every call is wrapped in try/catch: a broken or throwing store must never break
// provider loading — it just degrades to a normal network fetch.

import type { PersistentStore, ProvidersManifest } from "../types/models/Manager.ts";
import { Logger } from "../utils/logger.ts";

const NS = "grabit";
/** Default lifetime of a persisted bundle before autoUpdate prunes it (7 days). */
export const DEFAULT_PERSISTENT_STORE_TTL = 7 * 24 * 60 * 60 * 1000;

/** Persisted manifest plus the ETag it was fetched with (for conditional requests). */
export type StoredManifest = { etag?: string; manifest: ProvidersManifest };

/** One tracked entry: its storage key and the epoch ms after which it is stale. */
type IndexEntry = { key: string; expiresAt: number };

/** Manifest key is per source; module key is per source + scheme + version, so a
 *  version bump in the manifest naturally misses and re-fetches that provider. */
export const manifestKey = (sourceKey: string): string => `${NS}:manifest:${sourceKey}`;
export const moduleKey = (sourceKey: string, scheme: string, version: string): string => `${NS}:module:${sourceKey}:${scheme}@${version}`;

/** A single GLOBAL index (not per-source) listing every key we persist with its
 *  expiry. Being global lets a prune sweep leftovers from sources no longer in use
 *  — e.g. after the app switches to a different repo/branch. */
export const indexKey = (): string => `${NS}:index`;

// Index updates are read-modify-write, and modules are persisted concurrently during
// load. Serialize every mutation through one chain so concurrent writers can't clobber
// each other's entries. The store is process-global, so a process-level lock suffices.
let indexChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
	const next = indexChain.then(fn, fn);
	indexChain = next.then(
		() => {},
		() => {}
	);
	return next;
}

async function readIndex(store: PersistentStore): Promise<IndexEntry[]> {
	try {
		const raw = await store.getItem(indexKey());
		return raw ? (JSON.parse(raw) as IndexEntry[]) : [];
	} catch {
		return [];
	}
}

async function writeIndex(store: PersistentStore, entries: IndexEntry[]): Promise<void> {
	try {
		await store.setItem(indexKey(), JSON.stringify(entries));
	} catch (error) {
		Logger.debug(`[ProviderStore] Failed to persist index: ${error instanceof Error ? error.message : error}`);
	}
}

/** Record a key in the global index with a fresh expiry (replacing any prior entry). */
function trackKey(store: PersistentStore, key: string, ttl: number): Promise<void> {
	return serialize(async () => {
		const entries = await readIndex(store);
		const next = entries.filter((e) => e.key !== key);
		next.push({ key, expiresAt: Date.now() + ttl });
		await writeIndex(store, next);
	});
}

/**
 * Delete every tracked key whose expiry has passed — across all sources — then
 * rewrite the index to the survivors. Called at startup and on autoUpdate so
 * persisted storage never grows without bound. Needs `store.removeItem`.
 * @returns how many keys were removed.
 */
export function pruneExpired(store: PersistentStore): Promise<number> {
	return serialize(async () => {
		const entries = await readIndex(store);
		if (entries.length === 0) return 0;
		if (!store.removeItem) {
			Logger.debug("[ProviderStore] Store has no removeItem; cannot prune expired modules.");
			return 0;
		}

		const now = Date.now();
		const expired = entries.filter((e) => e.expiresAt <= now);
		const live = entries.filter((e) => e.expiresAt > now);

		for (const e of expired) {
			try {
				await store.removeItem(e.key);
			} catch (error) {
				Logger.debug(`[ProviderStore] Failed to delete expired key "${e.key}": ${error instanceof Error ? error.message : error}`);
			}
		}

		if (expired.length > 0) await writeIndex(store, live);
		return expired.length;
	});
}

export async function readManifest(store: PersistentStore, sourceKey: string, ttl: number = DEFAULT_PERSISTENT_STORE_TTL): Promise<StoredManifest | null> {
	try {
		const key = manifestKey(sourceKey);
		const raw = await store.getItem(key);
		// Refresh expiry on read so an in-use source's manifest never ages out.
		if (raw != null) await trackKey(store, key, ttl);
		return raw ? (JSON.parse(raw) as StoredManifest) : null;
	} catch (error) {
		Logger.debug(`[ProviderStore] Failed to read persisted manifest: ${error instanceof Error ? error.message : error}`);
		return null;
	}
}

export async function writeManifest(
	store: PersistentStore,
	sourceKey: string,
	value: StoredManifest,
	ttl: number = DEFAULT_PERSISTENT_STORE_TTL
): Promise<void> {
	try {
		const key = manifestKey(sourceKey);
		await store.setItem(key, JSON.stringify(value));
		await trackKey(store, key, ttl);
	} catch (error) {
		Logger.debug(`[ProviderStore] Failed to persist manifest: ${error instanceof Error ? error.message : error}`);
	}
}

export async function readModuleSource(
	store: PersistentStore,
	sourceKey: string,
	scheme: string,
	version: string,
	ttl: number = DEFAULT_PERSISTENT_STORE_TTL
): Promise<string | null> {
	try {
		const key = moduleKey(sourceKey, scheme, version);
		const source = await store.getItem(key);
		// A cache hit means this version is still in use: push its expiry out so only
		// truly unused (superseded) versions age out and get pruned.
		if (source != null) await trackKey(store, key, ttl);
		return source;
	} catch (error) {
		Logger.debug(`[ProviderStore] Failed to read persisted source for "${scheme}": ${error instanceof Error ? error.message : error}`);
		return null;
	}
}

export async function writeModuleSource(
	store: PersistentStore,
	sourceKey: string,
	scheme: string,
	version: string,
	source: string,
	ttl: number = DEFAULT_PERSISTENT_STORE_TTL
): Promise<void> {
	try {
		const key = moduleKey(sourceKey, scheme, version);
		await store.setItem(key, source);
		// Track the key + expiry so a later prune can delete it (see pruneExpired).
		await trackKey(store, key, ttl);
	} catch (error) {
		Logger.debug(`[ProviderStore] Failed to persist source for "${scheme}": ${error instanceof Error ? error.message : error}`);
	}
}
