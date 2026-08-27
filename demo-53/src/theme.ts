// Shared design tokens so the UI reads as one system.

export const colors = {
	bg: '#0b0d12',
	surface: '#13161f',
	surfaceRaised: '#181c27',
	surfaceInput: '#0f121a',
	border: '#232838',
	borderStrong: '#2f3648',
	text: '#f4f6fb',
	textDim: '#9aa4b8',
	textFaint: '#5c6578',
	accent: '#4b85ff',
	accentSoft: '#1d2b4d',
	good: '#4fce8b',
	bad: '#ff7a7a',
	warn: '#f0c674',
	media: '#4b85ff',
	subtitle: '#a679ff',
} as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const typeColor = (isSubtitle: boolean) => (isSubtitle ? colors.subtitle : colors.media);
