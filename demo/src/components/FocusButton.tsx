import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme';

type Props = {
	label: string;
	onPress: () => void;
	disabled?: boolean;
	loading?: boolean;
	variant?: 'primary' | 'ghost';
	fullWidth?: boolean;
	hasTVPreferredFocus?: boolean;
	font: (n: number) => number;
	space: (n: number) => number;
};

/** Button with an explicit focus state so TV remote navigation stays visible. */
export function FocusButton({
	label,
	onPress,
	disabled = false,
	loading = false,
	variant = 'primary',
	fullWidth = false,
	hasTVPreferredFocus = false,
	font,
	space,
}: Props) {
	const [focused, setFocused] = useState(false);
	const isGhost = variant === 'ghost';

	return (
		<Pressable
			onPress={onPress}
			disabled={disabled}
			hasTVPreferredFocus={hasTVPreferredFocus}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
			style={[
				styles.button,
				{ paddingVertical: space(13), paddingHorizontal: space(22), borderRadius: radius.md },
				fullWidth && styles.fullWidth,
				isGhost ? styles.ghost : styles.primary,
				disabled && styles.disabled,
				focused && (isGhost ? styles.ghostFocused : styles.primaryFocused),
			]}
		>
			<View style={styles.inner}>
				{loading && <ActivityIndicator size="small" color={isGhost ? colors.textDim : '#fff'} />}
				<Text style={[styles.text, { fontSize: font(15) }, isGhost && styles.ghostText, disabled && styles.disabledText]}>
					{label}
				</Text>
			</View>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	button: { borderWidth: 2, borderColor: 'transparent', alignItems: 'center' },
	fullWidth: { alignSelf: 'stretch' },
	inner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
	primary: { backgroundColor: colors.accent },
	primaryFocused: { backgroundColor: '#5f93ff', borderColor: '#cfe0ff' },
	ghost: { backgroundColor: 'transparent', borderColor: colors.borderStrong },
	ghostFocused: { borderColor: colors.accent, backgroundColor: colors.surfaceRaised },
	disabled: { backgroundColor: colors.surfaceRaised, borderColor: 'transparent' },
	text: { color: '#fff', fontWeight: '700' },
	ghostText: { color: colors.textDim },
	disabledText: { color: colors.textFaint },
});
