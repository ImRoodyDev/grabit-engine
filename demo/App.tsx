import { useCallback, useMemo, useState } from 'react';
import {
	FlatList,
	KeyboardAvoidingView,
	Platform,
	SafeAreaView,
	ScrollView,
	StatusBar,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import { useSources } from 'grabit-engine';

import { GLOBALS } from './src/globals';
import { buildRequest, DEFAULT_FORM, GRABIT_MANAGER_CONFIG, HAS_TMDB_KEY, type FormState } from './src/config';
import { useResponsive } from './src/useResponsive';
import { colors, radius } from './src/theme';
import { ScrapeForm } from './src/components/ScrapeForm';
import { SourceRow } from './src/components/SourceRow';
import { StatusBanner } from './src/components/StatusBanner';
import { Diagnostics } from './src/components/Diagnostics';

export default function App() {
	const { isTV, isLandscape, width, gutter, font, space } = useResponsive();
	const [form, setForm] = useState<FormState>(DEFAULT_FORM);

	const {
		mediaSources,
		subtitleSources,
		isLoading,
		isManagerReady,
		isContinuousScraping,
		error,
		scrape,
		stopContinuousScraping,
		clearSources,
	} = useSources({ managerConfig: GRABIT_MANAGER_CONFIG, continuous: true, type: 'both' });

	const results = useMemo(() => [...mediaSources, ...subtitleSources], [mediaSources, subtitleSources]);

	const onChange = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
		setForm((f) => ({ ...f, [key]: value }));
	}, []);

	const canScrape = isManagerReady && !isLoading && HAS_TMDB_KEY && form.tmdbId.trim().length > 0;
	const twoPane = isLandscape && width >= 900;
	const panelWidth = Math.min(twoPane ? width * 0.42 : width, isTV ? 640 : 460);

	const handleScrape = useCallback(() => scrape(buildRequest(form)), [scrape, form]);
	const handleClear = isContinuousScraping ? stopContinuousScraping : clearSources;

	const panel = (
		<>
			<ScrapeForm
				form={form}
				onChange={onChange}
				onScrape={handleScrape}
				onClear={handleClear}
				canScrape={canScrape}
				isLoading={isLoading}
				showClear={isContinuousScraping || results.length > 0}
				font={font}
				space={space}
			/>
			<View style={{ height: space(12) }} />
			<Diagnostics report={GLOBALS} font={font} space={space} />
			{(!HAS_TMDB_KEY || error) && (
				<View style={{ marginTop: space(12) }}>
					<StatusBanner error={error} hasTmdbKey={HAS_TMDB_KEY} font={font} space={space} />
				</View>
			)}
		</>
	);

	const resultsHeader = (
		<View style={[styles.resultsHead, { marginBottom: space(10) }]}>
			<Text style={[styles.resultsTitle, { fontSize: font(13) }]}>RESULTS</Text>
			<View style={[styles.countPill, { backgroundColor: colors.surfaceRaised }]}>
				<Text style={[styles.countText, { fontSize: font(12) }]}>
					{results.length}
					{isLoading ? ' · scraping…' : ''}
				</Text>
			</View>
		</View>
	);

	const list = (
		<FlatList
			data={results}
			keyExtractor={(s, i) => `${s.scheme}-${s.providerName}-${s.fileName}-${i}`}
			renderItem={({ item }) => <SourceRow source={item} font={font} space={space} isTV={isTV} />}
			ItemSeparatorComponent={() => <View style={{ height: space(9) }} />}
			ListHeaderComponent={resultsHeader}
			contentContainerStyle={{ paddingBottom: space(28) }}
			showsVerticalScrollIndicator={false}
			keyboardShouldPersistTaps="handled"
			ListEmptyComponent={
				<View style={[styles.empty, { padding: space(28) }]}>
					<Text style={[styles.emptyIcon, { fontSize: font(28) }]}>🎬</Text>
					<Text style={[styles.emptyText, { fontSize: font(13), marginTop: space(8) }]}>
						{isLoading ? 'Fetching sources…' : `No sources yet. ${isTV ? 'Select' : 'Tap'} Scrape to start.`}
					</Text>
				</View>
			}
		/>
	);

	return (
		<SafeAreaView style={styles.safe}>
			<StatusBar barStyle="light-content" hidden={isTV} />
			<KeyboardAvoidingView
				style={styles.flex}
				behavior={Platform.OS === 'ios' ? 'padding' : undefined}
			>
				<View style={[styles.header, { paddingHorizontal: gutter, paddingTop: space(14), paddingBottom: space(10) }]}>
					<View style={[styles.logo, { backgroundColor: colors.accent, borderRadius: radius.sm }]}>
						<Text style={[styles.logoText, { fontSize: font(15) }]}>G</Text>
					</View>
					<View style={{ flex: 1, minWidth: 0 }}>
						<Text style={[styles.brand, { fontSize: font(19) }]} numberOfLines={1}>
							grabit-engine
						</Text>
						<Text style={[styles.tagline, { fontSize: font(11) }]} numberOfLines={1}>
							provider scraping · isolation demo
						</Text>
					</View>
				</View>

				{twoPane ? (
					<View style={[styles.panes, { paddingHorizontal: gutter, gap: gutter }]}>
						<ScrollView
							style={{ width: panelWidth }}
							contentContainerStyle={{ paddingBottom: space(20) }}
							showsVerticalScrollIndicator={false}
							keyboardShouldPersistTaps="handled"
						>
							{panel}
						</ScrollView>
						<View style={styles.flex}>{list}</View>
					</View>
				) : (
					<FlatList
						data={results}
						keyExtractor={(s, i) => `${s.scheme}-${s.providerName}-${s.fileName}-${i}`}
						ItemSeparatorComponent={() => <View style={{ height: space(9) }} />}
						ListHeaderComponent={
							<View style={{ paddingHorizontal: gutter }}>
								<View style={[styles.panelBox, { maxWidth: panelWidth, alignSelf: 'center' }]}>{panel}</View>
								<View style={{ height: space(18) }} />
								{resultsHeader}
							</View>
						}
						renderItem={({ item }) => (
							<View style={{ paddingHorizontal: gutter }}>
								<SourceRow source={item} font={font} space={space} isTV={isTV} />
							</View>
						)}
						contentContainerStyle={{ paddingBottom: space(28) }}
						showsVerticalScrollIndicator={false}
						keyboardShouldPersistTaps="handled"
						ListEmptyComponent={
							<View style={[styles.empty, { padding: space(28) }]}>
								<Text style={[styles.emptyIcon, { fontSize: font(28) }]}>🎬</Text>
								<Text style={[styles.emptyText, { fontSize: font(13), marginTop: space(8) }]}>
									{isLoading ? 'Fetching sources…' : `No sources yet. ${isTV ? 'Select' : 'Tap'} Scrape to start.`}
								</Text>
							</View>
						}
					/>
				)}
			</KeyboardAvoidingView>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	safe: { flex: 1, backgroundColor: colors.bg },
	flex: { flex: 1 },
	header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
	logo: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
	logoText: { color: '#fff', fontWeight: '900' },
	brand: { color: colors.text, fontWeight: '800', letterSpacing: -0.4 },
	tagline: { color: colors.textFaint, marginTop: 1 },
	panes: { flex: 1, flexDirection: 'row' },
	panelBox: { width: '100%' },
	resultsHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
	resultsTitle: { color: colors.textFaint, fontWeight: '800', letterSpacing: 1.2 },
	countPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
	countText: { color: colors.textDim, fontWeight: '700' },
	empty: { alignItems: 'center', justifyContent: 'center' },
	emptyIcon: {},
	emptyText: { color: colors.textFaint, textAlign: 'center' },
});
