// Wires the app's crypto/Buffer implementations into grabit-engine's global
// registration helper, and adds engine detection for the diagnostics panel.
import { setupGrabitGlobals, type GrabitGlobalsReport } from 'grabit-engine';
import { Buffer } from '@craftzdog/react-native-buffer';
import QuickCrypto from 'react-native-quick-crypto';

export type DemoGlobalsReport = GrabitGlobalsReport & { engine: string };

function detectEngine(): string {
	const hermes = (globalThis as { HermesInternal?: { getRuntimeProperties?: () => Record<string, string> } })
		.HermesInternal;
	if (!hermes) return 'JSC / other';
	const version = hermes.getRuntimeProperties?.()['OSS Release Version'] ?? '';
	return `Hermes ${version}`.trim();
}

// Runs once at module load — before any provider bundle is evaluated.
export const GLOBALS: DemoGlobalsReport = {
	...setupGrabitGlobals({ crypto: QuickCrypto, buffer: Buffer }),
	engine: detectEngine(),
};
