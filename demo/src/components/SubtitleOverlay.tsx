import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { VideoPlayer } from 'expo-video';
import { cueAt, type Cue } from '../subtitles';

type Props = {
	player: VideoPlayer;
	cues: Cue[];
	font: (n: number) => number;
};

/**
 * Renders the active subtitle cue over the video. expo-video can't display
 * external sidecar subtitles, so we poll the player's currentTime and show the
 * matching cue ourselves.
 */
export function SubtitleOverlay({ player, cues, font }: Props) {
	const [line, setLine] = useState<string | null>(null);
	const lastRef = useRef<string | null>(null);

	useEffect(() => {
		if (cues.length === 0) {
			setLine(null);
			return;
		}
		const id = setInterval(() => {
			const next = cueAt(cues, player.currentTime ?? 0);
			if (next !== lastRef.current) {
				lastRef.current = next;
				setLine(next);
			}
		}, 200);
		return () => clearInterval(id);
	}, [player, cues]);

	if (!line) return null;

	return (
		<View pointerEvents="none" style={styles.wrap}>
			<Text style={[styles.text, { fontSize: font(16) }]}>{line}</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	wrap: { position: 'absolute', left: 16, right: 16, bottom: 56, alignItems: 'center' },
	text: {
		color: '#fff',
		textAlign: 'center',
		fontWeight: '600',
		backgroundColor: 'rgba(0,0,0,0.72)',
		paddingHorizontal: 10,
		paddingVertical: 4,
		borderRadius: 6,
		overflow: 'hidden',
		lineHeight: 22,
	},
});
