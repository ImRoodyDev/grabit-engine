import { Platform, useWindowDimensions } from 'react-native';

export type Breakpoint = 'phone' | 'tablet' | 'desktop' | 'tv';

const isTV = Platform.isTV;

/**
 * Layout derived from the live window size, so it reacts to rotation,
 * split-screen and TV resolutions instead of assuming a phone.
 *
 * TV gets a "10-foot UI": larger type and fewer columns, because the
 * viewer sits metres away rather than centimetres.
 */
export function useResponsive() {
	const { width, height } = useWindowDimensions();

	const breakpoint: Breakpoint = isTV ? 'tv' : width >= 1280 ? 'desktop' : width >= 768 ? 'tablet' : 'phone';

	// Landscape gets more columns so wide screens are actually used.
	const landscape = width > height;
	const columns =
		breakpoint === 'tv' ? 3 : breakpoint === 'desktop' ? 3 : breakpoint === 'tablet' ? (landscape ? 3 : 2) : 1;

	// Scales type and spacing up for TV viewing distance.
	const scale = breakpoint === 'tv' ? 1.45 : breakpoint === 'desktop' ? 1.1 : 1;

	return {
		width,
		height,
		breakpoint,
		columns,
		scale,
		isTV,
		isLandscape: landscape,
		/**
		 * Fill the screen. Only caps line length on absurdly wide monitors —
		 * a TV should use its full panel, not sit in a letterbox.
		 */
		maxContentWidth: breakpoint === 'tv' ? width : Math.min(width, 2200),
		gutter: Math.round((breakpoint === 'phone' ? 18 : 28) * scale),
		font: (size: number) => Math.round(size * scale),
		space: (size: number) => Math.round(size * scale),
	};
}
