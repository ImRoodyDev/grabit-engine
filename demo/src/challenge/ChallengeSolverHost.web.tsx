// Web has no hidden-WebView challenge solver (native only). Rendering nothing
// keeps App.tsx platform-agnostic; the engine simply has no host solver on
// web and reports NO_CHALLENGE_SOLVER if a provider ever needs one.
export default function ChallengeSolverHost() {
	return null;
}
