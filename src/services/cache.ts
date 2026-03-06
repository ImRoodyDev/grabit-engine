import { ProviderSource } from "../types/index.ts";
import { minutesToMilliseconds } from "../utils/standard.ts";

type CacheEntry<T> = {
	data: T;
	timestamp: number;
	ttl: number; // Time to live in milliseconds
};

export class Cache<T = any> {
	private storage = new Map<string, CacheEntry<T>>();
	private autoCleanupInterval: ReturnType<typeof setInterval> | null = null;
	private maxSize: number;

	/**
	 * @param maxSize Maximum number of entries before LRU-style eviction kicks in.
	 *               Defaults to 10,000. Set to `Infinity` to disable eviction.
	 */
	constructor(maxSize: number = 10_000) {
		this.maxSize = maxSize;
		this.startAutoCleanup(minutesToMilliseconds(15)); // Default auto-cleanup every 15 minutes
	}

	public set(key: string, data: T, ttl: number) {
		// If key already exists, delete first so it moves to the end of insertion order
		if (this.storage.has(key)) {
			this.storage.delete(key);
		}

		// Evict oldest entries when storage exceeds maxSize
		while (this.storage.size >= this.maxSize) {
			const oldestKey = this.storage.keys().next().value;
			if (oldestKey !== undefined) this.storage.delete(oldestKey);
			else break;
		}

		const entry: CacheEntry<T> = {
			data,
			timestamp: Date.now(),
			ttl
		};
		this.storage.set(key, entry);
	}

	public get<G = T>(key: string): G | null {
		const entry = this.storage.get(key);
		if (!entry) {
			return null;
		}
		if (Date.now() - entry.timestamp > entry.ttl) {
			this.storage.delete(key);
			return null;
		}
		return entry.data as unknown as G;
	}

	public delete(key: string) {
		this.storage.delete(key);
	}

	public clear() {
		this.storage.clear();
	}

	public get size(): number {
		return this.storage.size;
	}

	public has(key: string): boolean {
		const entry = this.storage.get(key);
		if (!entry) {
			return false;
		}
		if (Date.now() - entry.timestamp > entry.ttl) {
			this.storage.delete(key);
			return false;
		}
		return true;
	}

	public isExpired(key: string): boolean {
		const entry = this.storage.get(key);
		if (!entry) {
			return true;
		}
		return Date.now() - entry.timestamp > entry.ttl;
	}

	public setMaxSize(maxSize: number) {
		this.maxSize = maxSize;
	}

	private startAutoCleanup(interval: number = 60000) {
		if (this.autoCleanupInterval) {
			clearInterval(this.autoCleanupInterval);
		}
		this.autoCleanupInterval = setInterval(() => {
			this.clearExpired();
		}, interval);

		// Allow the Node.js process to exit naturally even if this timer is still active
		if (typeof this.autoCleanupInterval === "object" && "unref" in this.autoCleanupInterval) {
			this.autoCleanupInterval.unref();
		}
	}

	/** Stop the auto-cleanup interval. Call this when the cache is no longer needed. */
	public stopAutoCleanup() {
		if (this.autoCleanupInterval) {
			clearInterval(this.autoCleanupInterval);
			this.autoCleanupInterval = null;
		}
	}

	private clearExpired() {
		const now = Date.now();
		const expiredKeys: string[] = [];
		for (const [key, entry] of this.storage.entries()) {
			if (now - entry.timestamp > entry.ttl) {
				expiredKeys.push(key);
			}
		}
		for (const key of expiredKeys) {
			this.storage.delete(key);
		}
	}
}

export function createSourceCacheKey(source: ProviderSource): string {
	return source.type === "github"
		? `github:${source.url}@${source.branch ?? "main"}`
		: source.type === "registry"
			? `registry:${source.name}`
			: `local:${source.manifest.name}`;
}
export const createHealthCacheKey = (source: ProviderSource): string => `${createSourceCacheKey(source)}:health`;

export function isSourceCached(source: ProviderSource): boolean {
	return CACHE.has(createSourceCacheKey(source));
}

export const CACHE = new Cache();
