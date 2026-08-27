import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme';

type Option<T extends string> = { label: string; value: T };

type Props<T extends string> = {
	label: string;
	value: T;
	options: Option<T>[];
	onChange: (v: T) => void;
	font: (n: number) => number;
	space: (n: number) => number;
};

/** Segmented control — a professional alternative to a raw picker. */
export function Segmented<T extends string>({ label, value, options, onChange, font, space }: Props<T>) {
	return (
		<View>
			<Text style={[styles.label, { fontSize: font(11), marginBottom: space(6) }]}>{label}</Text>
			<View style={[styles.track, { borderRadius: radius.md, padding: space(3) }]}>
				{options.map((opt) => {
					const active = opt.value === value;
					return (
						<Pressable
							key={opt.value}
							onPress={() => onChange(opt.value)}
							style={[styles.segment, { paddingVertical: space(9), borderRadius: radius.sm }, active && styles.segmentActive]}
						>
							<Text style={[styles.segmentText, { fontSize: font(13) }, active && styles.segmentTextActive]}>
								{opt.label}
							</Text>
						</Pressable>
					);
				})}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	label: { color: colors.textDim, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
	track: { flexDirection: 'row', backgroundColor: colors.surfaceInput, borderWidth: 1.5, borderColor: colors.border },
	segment: { flex: 1, alignItems: 'center' },
	segmentActive: { backgroundColor: colors.accent },
	segmentText: { color: colors.textDim, fontWeight: '600' },
	segmentTextActive: { color: '#fff' },
});
