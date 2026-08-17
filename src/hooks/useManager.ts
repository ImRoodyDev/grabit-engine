import { useEffect, useRef, useState } from "react";
import { GrabitManager } from "../controllers/manager.ts";
import type { ProviderManagerConfig } from "../types/models/Manager.ts";
import { ProcessError } from "../types/ProcessError.ts";
import type { SourcesError } from "../types/hooks/useSources.ts";

/**
 * How many mounted `useManager` consumers currently depend on the singleton.
 *
 * `useSources` is normally mounted per screen. Destroying the manager whenever *a*
 * screen unmounted tore down the auto-update service, the operation limiters and the
 * provider context on every navigation, and the next screen rebuilt all of it. An
 * unmount that overlapped the next screen's mount could even destroy the instance that
 * screen had just been handed. Reference counting keeps one live manager for as long as
 * anything is still using it.
 */
let consumerCount = 0;

/** Shared so concurrent mounts await one initialization instead of racing several. */
let sharedManager: Promise<GrabitManager> | null = null;

function acquireManager(config: ProviderManagerConfig): Promise<GrabitManager> {
	consumerCount++;
	sharedManager ??= GrabitManager.create(config).catch((error: unknown) => {
		// Never leave a rejected promise cached — the next mount should be free to retry.
		sharedManager = null;
		throw error;
	});
	return sharedManager;
}

function releaseManager(): void {
	consumerCount = Math.max(0, consumerCount - 1);
	if (consumerCount > 0) return;

	const pending = sharedManager;
	sharedManager = null;
	// The instance may still be initializing, so wait for it before tearing down — and
	// bail out if another consumer acquired it while we were waiting.
	void pending
		?.then((manager) => {
			if (consumerCount === 0) manager.destroy();
		})
		.catch(() => {
			// Initialization already failed; there is nothing to tear down.
		});
}

/**
 * Internal hook that manages the {@link GrabitManager} singleton lifecycle.
 *
 * - Creates the manager on first mount (async), reusing it for every later consumer.
 * - Destroys it only once the last consumer unmounts, so navigating between screens
 *   keeps the loaded provider modules — and their cache entries — alive.
 * - Safe under React 18 StrictMode (double-mount / double-unmount).
 */
export function useManager(config: ProviderManagerConfig) {
	const [manager, setManager] = useState<GrabitManager | null>(null);
	const [isInitializing, setIsInitializing] = useState(true);
	const [initError, setInitError] = useState<SourcesError | null>(null);

	/** Guards against setting state after the effect cleanup has fired. */
	const mountedRef = useRef(true);

	/**
	 * The config object is intentionally **not** listed as a dependency.
	 * The manager is a singleton — once created, subsequent calls to
	 * `GrabitManager.create()` return the existing instance regardless
	 * of the config that is passed.  Re-creating on every config reference
	 * change would be wasteful and error-prone.
	 */
	useEffect(() => {
		mountedRef.current = true;

		acquireManager(config)
			.then((mgr) => {
				if (!mountedRef.current) return;
				setManager(mgr);
				setIsInitializing(false);
			})
			.catch((err: unknown) => {
				if (!mountedRef.current) return;
				setInitError(err instanceof ProcessError ? err : new ProcessError({ code: "MANAGER_INIT_ERROR", message: String(err) }));
				setIsInitializing(false);
			});

		return () => {
			mountedRef.current = false;
			releaseManager();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return { manager, isInitializing, initError } as const;
}
