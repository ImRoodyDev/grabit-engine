import { mergeSources } from "../../src/utils/internal";

type Source = { scheme: string; providerName: string; fileName: string; playlist: string };

/** Build a source the way controllers/provider.ts generates it: fileName is a
 *  display label, so distinct streams can share one. */
function source(fileName: string, playlist: string, scheme = "repelishd"): Source {
	return { scheme, providerName: "Repelishd", fileName, playlist };
}

// Two Dropload mirrors — same generated label, different URL — plus two Doodstream links.
const DROPLOAD_A = source("[Repelishd][M3U8] - Spanish - [Dropload] Video ", "https://r1.dropcdn.io/a/master.m3u8");
const DROPLOAD_B = source("[Repelishd][M3U8] - Spanish - [Dropload] Video ", "https://r2.dropcdn.io/b/master.m3u8");
const DOOD_LATINO = source("[Repelishd][MP4] - Spanish - scary-movie-[latino] - DoodStream ", "https://bb506hh.cloudatacdn.com/x?token=1");
const DOOD_CAST = source("[Repelishd][MP4] - Spanish - scary-movie-2[castellano] - DoodStream ", "https://ufd1142tw.cloudatacdn.com/y?token=2");

describe("mergeSources", () => {
	it("should keep every source in a batch even when two share a generated fileName", () => {
		const merged = mergeSources([], [DROPLOAD_A, DROPLOAD_B, DOOD_LATINO, DOOD_CAST]);

		expect(merged).toHaveLength(4);
		expect(merged.map((s) => s.playlist)).toEqual([DROPLOAD_A.playlist, DROPLOAD_B.playlist, DOOD_LATINO.playlist, DOOD_CAST.playlist]);
	});

	it("should replace a provider's stale entries when it is re-scraped", () => {
		const existing = mergeSources([], [DROPLOAD_A, DOOD_LATINO]);
		// Same streams re-scraped — tokenized URLs differ, labels do not
		const refreshed = [source(DROPLOAD_A.fileName, "https://r1.dropcdn.io/a/master.m3u8?t=new"), source(DOOD_LATINO.fileName, "https://bb506hh.cloudatacdn.com/x?token=9")];

		const merged = mergeSources(existing, refreshed);

		expect(merged).toHaveLength(2);
		expect(merged.map((s) => s.playlist)).toEqual(refreshed.map((s) => s.playlist));
	});

	it("should keep sources from other providers untouched", () => {
		const other = source("[Other][MP4] - Spanish - clip ", "https://other.example/v.mp4", "other");
		const merged = mergeSources([other, DROPLOAD_A], [DOOD_LATINO]);

		expect(merged).toEqual([other, DROPLOAD_A, DOOD_LATINO]);
	});

	it("should be idempotent so a repeated state update cannot duplicate entries", () => {
		const batch = [DROPLOAD_A, DROPLOAD_B];
		const once = mergeSources([], batch);

		// React StrictMode can run the same functional state updater twice with the same `prev`
		expect(mergeSources(once, batch)).toEqual(once);
	});

	it("should return the existing list unchanged for an empty batch", () => {
		const existing = [DROPLOAD_A];
		expect(mergeSources(existing, [])).toBe(existing);
	});
});
