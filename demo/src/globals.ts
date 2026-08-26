// Wires the app's crypto/Buffer implementations into grabit-engine's global
// registration helper, and adds engine detection for the diagnostics panel.
import { setupGrabitGlobals, setChallengeSolver, type GrabitGlobalsReport } from 'grabit-engine';
import { Buffer } from '@craftzdog/react-native-buffer';
import QuickCrypto from 'react-native-quick-crypto';
import { challengeQueue } from './challenge/challengeQueue';

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

// Route the engine's solveChallenge() to a hidden in-app WebView. The <ChallengeSolverHost>
// mounted in App.tsx actually runs the WebView; this only wires the entry point. On web the
// host renders nothing, so a challenge there resolves with whatever cookies/HTML it can read.
setChallengeSolver({ solve: (url, requester, options) => challengeQueue.solve(url, requester, options) });
