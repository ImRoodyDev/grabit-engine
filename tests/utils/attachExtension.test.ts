import { attachExtension } from "../../src/utils/standard";

describe("attachExtension", () => {
	describe("basic attachment", () => {
		it("should append extension when no extension exists", () => {
			expect(attachExtension(".m3u8", "/path/to/video.mp4")).toBe("/path/to/video.m3u8");
		});

		it("should accept extension with a leading dot", () => {
			expect(attachExtension(".m3u8", "/path/to/video")).toBe("/path/to/video.m3u8");
		});

		it("should return the extension itself when urlOrPath is empty", () => {
			expect(attachExtension("m3u8", "")).toBe("m3u8");
		});
	});

	describe("replacing an existing extension", () => {
		it("should replace a different extension", () => {
			expect(attachExtension("m3u8", "/path/to/video.mp4")).toBe("/path/to/video.m3u8");
		});

		it("should keep the same extension when it already matches", () => {
			expect(attachExtension("m3u8", "/path/to/video.m3u8")).toBe("/path/to/video.m3u8");
		});

		it("should replace extension on a filename without a directory", () => {
			expect(attachExtension(".ts", "video.mp4")).toBe("video.ts");
		});
	});

	describe("trailing slash handling", () => {
		it("should strip a single trailing slash before attaching extension", () => {
			expect(attachExtension("m3u8", "/path/to/video/")).toBe("/path/to/video.m3u8");
		});

		it("should strip multiple trailing slashes", () => {
			expect(attachExtension("m3u8", "/path/to/video///")).toBe("/path/to/video.m3u8");
		});
	});

	describe("trailing dot handling", () => {
		it("should strip a trailing dot before attaching extension", () => {
			expect(attachExtension("m3u8", "/path/to/video.")).toBe("/path/to/video.m3u8");
		});

		it("should strip multiple trailing dots", () => {
			expect(attachExtension("m3u8", "/path/to/video...")).toBe("/path/to/video.m3u8");
		});

		it("should strip mixed trailing dots and slashes", () => {
			expect(attachExtension("m3u8", "/path/to/video/..")).toBe("/path/to/video.m3u8");
		});
	});

	describe("URL handling", () => {
		it("should replace extension in an absolute URL path", () => {
			expect(attachExtension("m3u8", "https://example.com/stream.mp4")).toBe("https://example.com/stream.m3u8");
		});

		it("should attach extension to an absolute URL path without one", () => {
			expect(attachExtension("m3u8", "https://example.com/stream")).toBe("https://example.com/stream.m3u8");
		});

		it("should strip trailing slash from URL before attaching extension", () => {
			expect(attachExtension("m3u8", "https://example.com/stream/")).toBe("https://example.com/stream.m3u8");
		});
	});

	describe("edge cases", () => {
		it("should handle a path with multiple dots in the last segment", () => {
			expect(attachExtension("m3u8", "/path/to/my.video.file.mp4")).toBe("/path/to/my.video.file.m3u8");
		});

		it("should not confuse dots in directory names with file extensions", () => {
			expect(attachExtension("m3u8", "/path/to.dir/video")).toBe("/path/to.dir/video.m3u8");
		});

		it("should handle a root-only path", () => {
			expect(attachExtension("m3u8", "/")).toBe(".m3u8");
		});
	});
});
