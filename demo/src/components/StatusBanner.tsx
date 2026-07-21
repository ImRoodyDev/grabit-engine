import { StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme';

type Props = {
	error: { message?: string; code?: string } | null;
	hasTmdbKey: boolean;
	font: (n: number) => number;
	space: (n: number) => number;
};

/** Only renders for states that need attention (missing key / error). */
export function StatusBanner({ error, hasTmdbKey, font, space }: Props) {
	const base = [styles.banner, { padding: space(12), borderRadius: radius.md }];

	if (!hasTmdbKey) {
		return (
			<View style={[...base, styles.warn]}>
				<Text style={[styles.warnText, { fontSize: font(12), lineHeight: font(17) }]}>
					No TMDB key found. Set EXPO_PUBLIC_TMDB_API_KEYS in demo/.env and restart with --clear.
				</Text>
			</View>
		);
	}

	if (error) {
		return (
			<View style={[...base, styles.error]}>
				<Text style={[styles.errorTitle, { fontSize: font(11) }]}>{error.code ?? 'ERROR'}</Text>
				<Text style={[styles.errorText, { fontSize: font(12), lineHeight: font(17) }]}>
					{error.message ?? String(error)}
				</Text>
			</View>
		);
	}

	return null;
}

const styles = StyleSheet.create({
	banner: { borderWidth: 1 },
	warn: { backgroundColor: '#2a2410', borderColor: '#4a3d16' },
	warnText: { color: colors.warn },
	error: { backgroundColor: '#2a1414', borderColor: '#4a1f1f', gap: 4 },
	errorTitle: { color: colors.bad, fontWeight: '800', letterSpacing: 0.5 },
	errorText: { color: '#e9bcbc' },
});
