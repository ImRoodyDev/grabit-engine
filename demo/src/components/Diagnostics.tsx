import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DemoGlobalsReport } from '../globals';
import { colors, radius } from '../theme';

type Props = {
	report: DemoGlobalsReport;
	font: (n: number) => number;
	space: (n: number) => number;
};

/** Collapsible runtime-capability readout; these failure modes are invisible otherwise. */
export function Diagnostics({ report, font, space }: Props) {
	const [open, setOpen] = useState(report.errors.length > 0);

	const checks = [
		['Function()', report.functionConstructor],
		['crypto', report.crypto],
		['Buffer', report.buffer],
		['atob', report.atob],
	] as const;

	const allOk = checks.every(([, ok]) => ok) && report.errors.length === 0;

	return (
		<View style={[styles.wrap, { borderRadius: radius.md, padding: space(12) }]}>
			<Pressable style={styles.header} onPress={() => setOpen((o) => !o)}>
				<View style={styles.headerLeft}>
					<View style={[styles.led, { backgroundColor: allOk ? colors.good : colors.bad }]} />
					<Text style={[styles.title, { fontSize: font(11) }]}>RUNTIME</Text>
					<Text style={[styles.engine, { fontSize: font(11) }]} numberOfLines={1}>
						{report.engine}
					</Text>
				</View>
				<Text style={[styles.chevron, { fontSize: font(11) }]}>{open ? '▲' : '▼'}</Text>
			</Pressable>

			{open && (
				<View style={[styles.checks, { marginTop: space(10), gap: space(8) }]}>
					{checks.map(([label, ok]) => (
						<View key={label} style={styles.check}>
							<Text style={[styles.checkLabel, { fontSize: font(11) }]}>{label}</Text>
							<Text style={[ok ? styles.ok : styles.bad, { fontSize: font(11) }]}>{ok ? 'ok' : 'FAIL'}</Text>
						</View>
					))}
					{report.errors.map((e, i) => (
						<Text key={i} style={[styles.err, { fontSize: font(10) }]}>
							{e}
						</Text>
					))}
				</View>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	wrap: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
	header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
	headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
	led: { width: 8, height: 8, borderRadius: 4 },
	title: { color: colors.textFaint, fontWeight: '800', letterSpacing: 1 },
	engine: { color: colors.textDim, flex: 1 },
	chevron: { color: colors.textFaint },
	checks: { flexDirection: 'row', flexWrap: 'wrap' },
	check: { flexDirection: 'row', alignItems: 'center', gap: 5, marginRight: 14 },
	checkLabel: { color: colors.textDim },
	ok: { color: colors.good, fontWeight: '700' },
	bad: { color: colors.bad, fontWeight: '700' },
	err: { color: colors.bad, width: '100%' },
});
