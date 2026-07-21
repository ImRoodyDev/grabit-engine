import { StyleSheet, Text, View } from 'react-native';
import type { FormState } from '../config';
import { colors, radius } from '../theme';
import { Field } from './Field';
import { Segmented } from './Segmented';
import { FocusButton } from './FocusButton';

type Props = {
	form: FormState;
	onChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
	onScrape: () => void;
	onClear?: () => void;
	canScrape: boolean;
	isLoading: boolean;
	showClear: boolean;
	font: (n: number) => number;
	space: (n: number) => number;
};

export function ScrapeForm({ form, onChange, onScrape, onClear, canScrape, isLoading, showClear, font, space }: Props) {
	const isSerie = form.type === 'serie';

	return (
		<View style={[styles.card, { borderRadius: radius.lg, padding: space(18), gap: space(14) }]}>
			<Text style={[styles.heading, { fontSize: font(12) }]}>Request</Text>

			<Segmented
				label="Media type"
				value={form.type}
				onChange={(v) => onChange('type', v)}
				options={[
					{ label: 'Movie', value: 'movie' },
					{ label: 'Series', value: 'serie' },
				]}
				font={font}
				space={space}
			/>

			<View style={[styles.row, { gap: space(12) }]}>
				<Field
					label="TMDB ID"
					value={form.tmdbId}
					onChangeText={(v) => onChange('tmdbId', v)}
					keyboardType="number-pad"
					placeholder="27205"
					font={font}
					space={space}
					flex={1}
				/>
				<Field
					label="Language"
					value={form.targetLanguageISO}
					onChangeText={(v) => onChange('targetLanguageISO', v)}
					placeholder="en"
					font={font}
					space={space}
					flex={1}
				/>
			</View>

			<Field
				label="Title (optional)"
				value={form.title}
				onChangeText={(v) => onChange('title', v)}
				placeholder="Inception"
				font={font}
				space={space}
			/>

			<View style={[styles.row, { gap: space(12) }]}>
				<Field
					label="Year (optional)"
					value={form.releaseYear}
					onChangeText={(v) => onChange('releaseYear', v)}
					keyboardType="number-pad"
					placeholder="2010"
					font={font}
					space={space}
					flex={1}
				/>
				{isSerie && (
					<>
						<Field
							label="Season"
							value={form.season}
							onChangeText={(v) => onChange('season', v)}
							keyboardType="number-pad"
							font={font}
							space={space}
							flex={1}
						/>
						<Field
							label="Episode"
							value={form.episode}
							onChangeText={(v) => onChange('episode', v)}
							keyboardType="number-pad"
							font={font}
							space={space}
							flex={1}
						/>
					</>
				)}
				{!isSerie && <View style={{ flex: 1 }} />}
			</View>

			<View style={[styles.actions, { gap: space(10), marginTop: space(2) }]}>
				<View style={{ flex: 2 }}>
					<FocusButton
						label={isLoading ? 'Scraping…' : 'Scrape'}
						onPress={onScrape}
						disabled={!canScrape}
						loading={isLoading}
						fullWidth
						hasTVPreferredFocus
						font={font}
						space={space}
					/>
				</View>
				{showClear && onClear && (
					<View style={{ flex: 1 }}>
						<FocusButton label="Clear" variant="ghost" fullWidth onPress={onClear} font={font} space={space} />
					</View>
				)}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
	heading: { color: colors.textFaint, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
	row: { flexDirection: 'row' },
	actions: { flexDirection: 'row' },
});
