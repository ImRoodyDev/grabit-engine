import React, { useState } from "react";
import { getSessionUserAgent, setDeviceUserAgent } from "./deviceUserAgent";
import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

/** Hidden WebView mounted once at startup: captures the device's real UA. */
export default function DeviceUserAgentProbe() {
	const [done, setDone] = useState(() => getSessionUserAgent() != null);
	if (done) return null;
	return (
		<WebView
			source={{ html: "<!doctype html><meta charset=utf-8>" }}
			injectedJavaScript={"window.ReactNativeWebView.postMessage(navigator.userAgent); true;"}
			onMessage={(e) => {
				setDeviceUserAgent(e.nativeEvent.data);
				setDone(true);
			}}
			javaScriptEnabled
			style={styles.probe}
			pointerEvents="none"
		/>
	);
}

const styles = StyleSheet.create({
	probe: { position: "absolute", width: 1, height: 1, opacity: 0 }
});
