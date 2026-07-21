import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { colors, radius } from '../theme';

type Props = {
	label: string;
	value: string;
	onChangeText: (v: string) => void;
	placeholder?: string;
	keyboardType?: KeyboardTypeOptions;
	font: (n: number) => number;
	space: (n: number) => number;
	flex?: number;
};

export function Field({ label, value, onChangeText, placeholder, keyboardType, font, space, flex }: Props) {
	const [focused, setFocused] = useState(false);

	return (
		<View style={[styles.wrap, flex != null && { flex }]}>
			<Text style={[styles.label, { fontSize: font(11), marginBottom: space(6) }]}>{label}</Text>
			<TextInput
				value={value}
				onChangeText={onChangeText}
				placeholder={placeholder}
				placeholderTextColor={colors.textFaint}
				keyboardType={keyboardType}
				autoCapitalize="none"
				autoCorrect={false}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				style={[
					styles.input,
					{
						fontSize: font(15),
						paddingVertical: space(11),
						paddingHorizontal: space(13),
						borderRadius: radius.md,
					},
					focused && styles.inputFocused,
				]}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	wrap: { minWidth: 0 },
	label: { color: colors.textDim, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
	input: {
		backgroundColor: colors.surfaceInput,
		color: colors.text,
		borderWidth: 1.5,
		borderColor: colors.border,
	},
	inputFocused: { borderColor: colors.accent, backgroundColor: '#0d1220' },
});
