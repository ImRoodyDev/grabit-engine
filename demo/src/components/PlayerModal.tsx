import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { MediaSource, SubtitleSource } from 'grabit-engine';
import { colors, radius } from '../theme';
import { fetchSubtitles, type Cue } from '../subtitles';
import { SubtitleOverlay } from './SubtitleOverlay';

type Props = {
	source: MediaSource | null;
	subtitles: SubtitleSource[];
	onClose: () => void;
	font: (n: number) => number;
	space: (n: number) => number;
};

type Variant = { label: string; url: string };

function variantsOf(source: MediaSource): Variant[] {
	if (typeof source.playlist === 'string') return [{ label: 'Auto', url: source.playlist }];
	return source.playlist.map((v) => ({ label: String(v.resolution ?? v.dimensions ?? 'stream'), url: v.source }));
}

const headersOf = (xhr?: { haveCorsPolicy: boolean; headers: Record<string, string> }) =>
	xhr && Object.keys(xhr.headers ?? {}).length > 0 ? xhr.headers : undefined;

/** Mounts only while a source is selected, so the video hook has a valid uri. */
function PlayerContent({ source, subtitles, onClose, font, space }: Props & { source: MediaSource }) {
	const variants = variantsOf(source);
	const [quality, setQuality] = useState(0);
	const [subIndex, setSubIndex] = useState<number | null>(null);
	const [cues, setCues] = useState<Cue[]>([]);
	const [subState, setSubState] = useState<'idle' | 'loading' | 'error'>('idle');

	const mediaHeaders = headersOf(source.xhr);
	const player = useVideoPlayer({ uri: variants[quality].url, headers: mediaHeaders }, (p) => {
		p.play();
	});

	useEffect(() => {
		if (subIndex === null) {
			setCues([]);
			setSubState('idle');
			return;
		}
		let alive = true;
		const sub = subtitles[subIndex];
		setSubState('loading');
		fetchSubtitles(sub.url, headersOf(sub.xhr))
			.then((c) => alive && (setCues(c), setSubState('idle')))
			.catch(() => alive && (setCues([]), setSubState('error')));
		return () => {
			alive = false;
		};
	}, [subIndex, subtitles]);

	return (
		<View style={styles.fill}>
			<VideoView style={styles.fill} player={player} fullscreenOptions={{ enable: true }} contentFit="contain" nativeControls />

			<SubtitleOverlay player={player} cues={cues} font={font} />

			{/* Top bar */}
			<View style={[styles.topBar, { paddingHorizontal: space(14), paddingTop: space(12) }]}>
				<Text style={[styles.title, { fontSize: font(14) }]} numberOfLines={1}>
					{source.providerName} · {source.format?.toUpperCase()}
				</Text>
				<Pressable onPress={onClose} hitSlop={12} style={styles.close}>
					<Text style={[styles.closeText, { fontSize: font(16) }]}>✕</Text>
				</Pressable>
			</View>

			{/* Bottom controls */}
			<View style={[styles.bottomBar, { paddingHorizontal: space(14), paddingBottom: space(14), gap: space(8) }]}>
				{variants.length > 1 && (
					<Row label="Quality" font={font}>
						{variants.map((v, i) => (
							<Chip key={i} active={i === quality} onPress={() => setQuality(i)} font={font} space={space}>
								{v.label}
							</Chip>
						))}
					</Row>
				)}

				<Row label="Subtitles" font={font}>
					<Chip active={subIndex === null} onPress={() => setSubIndex(null)} font={font} space={space}>
						Off
					</Chip>
					{subtitles.map((s, i) => (
						<Chip key={i} active={subIndex === i} onPress={() => setSubIndex(i)} font={font} space={space}>
							{s.languageName || s.language || `Track ${i + 1}`}
						</Chip>
					))}
					{subtitles.length === 0 && <Text style={[styles.hint, { fontSize: font(11) }]}>none found</Text>}
				</Row>

				{subState === 'loading' && (
					<View style={styles.subStatus}>
						<ActivityIndicator size="small" color={colors.textDim} />
						<Text style={[styles.hint, { fontSize: font(11) }]}>loading subtitles…</Text>
					</View>
				)}
				{subState === 'error' && (
					<Text style={[styles.hint, styles.err, { fontSize: font(11) }]}>couldn’t load that subtitle track</Text>
				)}
			</View>
		</View>
	);
}

export function PlayerModal({ source, subtitles, onClose, font, space }: Props) {
	return (
		<Modal visible={!!source} animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
			<View style={styles.backdrop}>
				{source && (
					<PlayerContent source={source} subtitles={subtitles} onClose={onClose} font={font} space={space} />
				)}
			</View>
		</Modal>
	);
}

function Row({ label, font, children }: { label: string; font: (n: number) => number; children: React.ReactNode }) {
	return (
		<View style={styles.row}>
			<Text style={[styles.rowLabel, { fontSize: font(10) }]}>{label.toUpperCase()}</Text>
			<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
				{children}
			</ScrollView>
		</View>
	);
}

function Chip({
	active,
	onPress,
	children,
	font,
	space,
}: {
	active: boolean;
	onPress: () => void;
	children: React.ReactNode;
	font: (n: number) => number;
	space: (n: number) => number;
}) {
	return (
		<Pressable
			onPress={onPress}
			style={[styles.chip, { paddingHorizontal: space(12), paddingVertical: space(6) }, active && styles.chipActive]}
		>
			<Text style={[styles.chipText, { fontSize: font(12) }, active && styles.chipTextActive]}>{children}</Text>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	backdrop: { flex: 1, backgroundColor: '#000' },
	fill: { flex: 1, backgroundColor: '#000' },
	topBar: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: 12,
	},
	title: { color: '#fff', fontWeight: '700', flex: 1, textShadowColor: '#000', textShadowRadius: 4 },
	close: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
	closeText: { color: '#fff', fontWeight: '700' },
	bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0 },
	row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
	rowLabel: { color: 'rgba(255,255,255,0.6)', fontWeight: '800', letterSpacing: 1, width: 64 },
	chips: { gap: 8, alignItems: 'center' },
	chip: { borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.14)' },
	chipActive: { backgroundColor: colors.accent },
	chipText: { color: '#fff', fontWeight: '600' },
	chipTextActive: { color: '#fff' },
	hint: { color: 'rgba(255,255,255,0.6)' },
	err: { color: '#ff9b9b' },
	subStatus: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
