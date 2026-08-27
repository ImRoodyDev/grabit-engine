// Fetches and parses external subtitle files (VTT or SRT) into timed cues.
// expo-video can only surface subtitles embedded in the stream, so the scraped
// sidecar subtitle URLs are rendered by the app itself (see SubtitleOverlay).

export type Cue = { start: number; end: number; text: string };

/** "00:01:23,456" or "01:23.456" or "83.4" -> seconds. */
function toSeconds(stamp: string): number {
	const clean = stamp.trim().replace(',', '.');
	const parts = clean.split(':').map(Number);
	if (parts.some((n) => Number.isNaN(n))) return NaN;
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	return parts[0];
}

const CUE_TIME = /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;

/** Parses VTT or SRT text. Tolerant of both (SRT indices, VTT headers/cue settings). */
export function parseSubtitles(raw: string): Cue[] {
	const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const blocks = text.split(/\n\n+/);
	const cues: Cue[] = [];

	for (const block of blocks) {
		const lines = block.split('\n').filter((l) => l.trim() !== '');
		if (lines.length === 0) continue;

		const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
		if (timeLineIdx === -1) continue; // header ("WEBVTT") or junk block

		const [startRaw, endRaw] = lines[timeLineIdx].split('-->');
		const start = toSeconds(startRaw);
		// End timestamp may carry cue settings ("... align:start line:90%") — take first token.
		const end = toSeconds((endRaw ?? '').trim().split(/\s+/)[0] ?? '');
		if (Number.isNaN(start) || Number.isNaN(end)) continue;

		const body = lines
			.slice(timeLineIdx + 1)
			.join('\n')
			.replace(/<[^>]+>/g, '') // strip tags like <i>, <c>
			.trim();
		if (body) cues.push({ start, end, text: body });
	}

	return cues.sort((a, b) => a.start - b.start);
}

/** Fetches a subtitle URL and parses it. Throws with context on failure. */
export async function fetchSubtitles(url: string, headers?: Record<string, string>): Promise<Cue[]> {
	let res: Response;
	try {
		res = await fetch(url, headers ? { headers } : undefined);
	} catch (e) {
		throw new Error(`Could not fetch subtitles: ${e instanceof Error ? e.message : String(e)}`);
	}
	if (!res.ok) throw new Error(`Subtitle request failed (${res.status})`);

	const cues = parseSubtitles(await res.text());
	if (cues.length === 0) throw new Error('No cues found in subtitle file');
	return cues;
}

/** Binary-search-free active-cue lookup (cue lists are small). */
export function cueAt(cues: Cue[], time: number): string | null {
	for (const c of cues) {
		if (time >= c.start && time <= c.end) return c.text;
		if (c.start > time) break;
	}
	return null;
}

/** Detects whether a sidecar URL/format is VTT (iOS-safe) vs SRT. */
export const looksLikeVtt = (format?: string, url?: string) =>
	format?.toLowerCase() === 'vtt' || (url?.toLowerCase().includes('.vtt') ?? false);
