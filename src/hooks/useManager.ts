import { useEffect, useRef, useState } from "react";
import { GrabitManager } from "../controllers/manager.ts";
import type { ProviderManagerConfig } from "../types/models/Manager.ts";
import { ProcessError } from "../types/ProcessError.ts";
import type { SourcesError } from "../types/hooks/useSources.ts";

/**
 * Internal hook that manages the {@link GrabitManager} singleton lifecycle.
 *
 * - Creates the manager on mount (async).
 * - Destroys the manager on unmount so resources are released.
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
		let instance: GrabitManager | null = null;

		GrabitManager.create(config)
			.then((mgr) => {
				if (!mountedRef.current) {
					// Component already unmounted while we were awaiting — clean up.
					mgr.destroy();
					return;
				}
				instance = mgr;
				setManager(mgr);
				setIsInitializing(false);
			})
			.catch((err) => {
				if (!mountedRef.current) return;
				setInitError(err instanceof ProcessError ? err : new ProcessError({ code: "MANAGER_INIT_ERROR", message: String(err) }));
				setIsInitializing(false);
			});

		return () => {
			mountedRef.current = false;

			if (instance) {
				instance.destroy();
				setManager(null);
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return { manager, isInitializing, initError } as const;
}
