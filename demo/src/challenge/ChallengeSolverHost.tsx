import React, { useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import { challengeQueue } from "./challengeQueue";
import SolverWebView from "./SolverWebView";
import DeviceUserAgentProbe from "./DeviceUserAgentProbe";

/** Mounted once at the app root; runs the UA probe and a hidden WebView per challenge. */
export default function ChallengeSolverHost() {
	const jobs = useSyncExternalStore(challengeQueue.subscribe, challengeQueue.getSnapshot);

	return (
		<View style={styles.host} pointerEvents="box-none">
			<DeviceUserAgentProbe />
			{jobs.map((job) => (
				<SolverWebView key={job.id} job={job} />
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	// Absolute overlay above the app, but click-through: hidden slots don't block,
	// only a revealed (manual) slot captures touches.
	host: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }
});
