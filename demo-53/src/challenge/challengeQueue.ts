// Bridge between grabit-engine's imperative `solveChallenge()` and the React
// WebView host. The engine calls `solve()`; we push a job and hand back a promise
// that the host (ChallengeSolverHost) resolves once the hidden WebView has earned
// the challenge cookies. Pure JS — no React or WebView imports, so it is safe to
// register from globals before the UI mounts.
import type { ChallengeSolveOptions, ChallengeSolveResult } from 'grabit-engine';

export type ChallengeResult = ChallengeSolveResult;

export type ChallengeJob = {
	id: number;
	url: string;
	userAgent?: string;
	waitForCookie?: string;
	headers?: Record<string, string>;
	timeoutMs: number;
	resolve: (result: ChallengeResult) => void;
	reject: (error: unknown) => void;
};

let nextId = 1;
let jobs: ChallengeJob[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((notify) => notify());

export const challengeQueue = {
	/** Engine entry point (wired via setChallengeSolver). Resolves when solved. */
	solve(url: URL, requester: { userAgent?: string }, options: ChallengeSolveOptions = {}): Promise<ChallengeResult> {
		return new Promise<ChallengeResult>((resolve, reject) => {
			jobs = [
				...jobs,
				{
					id: nextId++,
					url: url.toString(),
					userAgent: requester.userAgent,
					waitForCookie: options.waitForCookie,
					headers: options.headers,
					timeoutMs: options.timeoutMs ?? 20000,
					resolve,
					reject,
				},
			];
			emit();
		});
	},

	/** Drop a finished job so the host unmounts its WebView. */
	remove(id: number): void {
		jobs = jobs.filter((job) => job.id !== id);
		emit();
	},

	// useSyncExternalStore glue for the host component.
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	getSnapshot(): ChallengeJob[] {
		return jobs;
	},
};
