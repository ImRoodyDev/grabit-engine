import { memo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MediaSource, SubtitleSource } from 'grabit-engine';
import { colors, radius, typeColor } from '../theme';

type Props = {
	source: MediaSource | SubtitleSource;
	font: (n: number) => number;
	space: (n: number) => number;
	isTV: boolean;
	/** Provided for media sources — opens the in-app player. */
	onPress?: () => void;
};

/** Media playlists are either a URL string or a list of quality variants. */
function mediaLinks(source: MediaSource): { label: string; url: string }[] {
	if (typeof source.playlist === 'string') return [{ label: 'stream', url: source.playlist }];
	return source.playlist.map((v) => ({ label: String(v.resolution ?? v.dimensions), url: v.source }));
}

function SourceRowBase({ source, font, space, isTV, onPress }: Props) {
	const [focused, setFocused] = useState(false);

	const isSubtitle = 'url' in source;
	const accent = typeColor(isSubtitle);
	const links = isSubtitle ? [{ label: source.format, url: (source as SubtitleSource).url }] : mediaLinks(source as MediaSource);
	const lang = isSubtitle ? (source as SubtitleSource).languageName : source.language;
	const playable = !isSubtitle && !!onPress;

	return (
		<Pressable
			focusable={isTV}
			onPress={playable ? onPress : undefined}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
			style={[
				styles.row,
				{ borderRadius: radius.md, paddingVertical: space(12), paddingHorizontal: space(14), gap: space(12) },
				focused && styles.rowFocused,
			]}
		>
			{/* Left accent stripe communicates media vs subtitle at a glance. */}
			<View style={[styles.stripe, { backgroundColor: accent }]} />

			<View style={styles.body}>
				<View style={styles.topLine}>
					<Text style={[styles.provider, { fontSize: font(14) }]} numberOfLines={1}>
						{source.providerName}
					</Text>
					{playable && (
						<View style={[styles.play, { backgroundColor: accent }]}>
							<Text style={[styles.playIcon, { fontSize: font(10) }]}>▶</Text>
						</View>
					)}
					<View style={[styles.badge, { backgroundColor: `${accent}22`, borderColor: `${accent}55` }]}>
						<Text style={[styles.badgeText, { color: accent, fontSize: font(10) }]}>{source.format?.toUpperCase()}</Text>
					</View>
				</View>

				<Text style={[styles.fileName, { fontSize: font(12.5), marginTop: space(3) }]} numberOfLines={1}>
					{source.fileName}
				</Text>

				<View style={[styles.metaLine, { marginTop: space(5), gap: space(6) }]}>
					<Text style={[styles.meta, { fontSize: font(11) }]}>{source.scheme}</Text>
					<Text style={styles.dot}>·</Text>
					<Text style={[styles.meta, { fontSize: font(11) }]}>{lang}</Text>
					{source.xhr?.haveCorsPolicy && (
						<>
							<Text style={styles.dot}>·</Text>
							<Text style={[styles.meta, styles.cors, { fontSize: font(11) }]}>needs headers</Text>
						</>
					)}
				</View>

				<View style={[styles.links, { marginTop: space(8), gap: space(6) }]}>
					{links.map((link, i) => (
						<View key={i} style={styles.linkItem}>
							<View style={[styles.qualityTag, { backgroundColor: colors.surfaceInput }]}>
								<Text style={[styles.qualityText, { fontSize: font(10) }]}>{link.label}</Text>
							</View>
							<Text style={[styles.link, { fontSize: font(11) }]} numberOfLines={1} selectable={!isTV}>
								{link.url}
							</Text>
						</View>
					))}
				</View>
			</View>
		</Pressable>
	);
}

export const SourceRow = memo(SourceRowBase);

const styles = StyleSheet.create({
	row: {
		flexDirection: 'row',
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.border,
	},
	rowFocused: {
		borderColor: colors.accent,
		backgroundColor: colors.surfaceRaised,
		...Platform.select({ default: { transform: [{ scale: 1.01 }] } }),
	},
	stripe: { width: 3, borderRadius: 2, alignSelf: 'stretch' },
	body: { flex: 1, minWidth: 0 },
	topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
	provider: { color: colors.text, fontWeight: '700', flex: 1 },
	play: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
	playIcon: { color: '#fff', marginLeft: 1 },
	badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1 },
	badgeText: { fontWeight: '800', letterSpacing: 0.5 },
	fileName: { color: colors.textDim },
	metaLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
	meta: { color: colors.textFaint },
	cors: { color: colors.warn },
	dot: { color: colors.textFaint },
	links: {},
	linkItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
	qualityTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, minWidth: 44, alignItems: 'center' },
	qualityText: { color: colors.textDim, fontWeight: '700' },
	link: { color: colors.accent, flex: 1 },
});
