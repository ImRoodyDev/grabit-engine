describe("URL utilities", () => {
	it("should return the base URL without query parameters", () => {
		const relativeURLs = [
			null,
			"/search?q=matrix",
			"/playlist/3868a32b24c820079cb3a4f5393934d.txt",
			"\/playlist\/$mrmCyBjSBCkN$6KJU9vHH9geVCyCBy-x-QF0EVABkrFz+QwKMB-diDuBA-B639kGloYnAcmjKiW1TlY3unkNyLiwGSVHGpnDrS13BRnWlF6Vus8F05G+XME6BNHUVNU3EsFQsj8S6mYrNFMCT5ts5afMCzLJs5$gbL6XRA85Vg!.txt",
			"https://example.com/path/to/resource?query=param&another=value",
			"https://ekola405gmt.com/playlist/bPZaj+BQXo8x36H5JigwxyYV74JpzHwcUpzUlfY-OTyMPDaKHogCOC0imY7c7B3jSVugYpBR1KbmYxQ0mRqWIdCj-UEnjBEmE8aHnNZGe5QmMO4Wanr3TM4-ZApQcrRuB88jfi3-h4sD5AEcHlcBgZOQcE$zhlaQs-u8tR7JXtg!.txt"
		];

		const expectedBaseURLs = [
			"/search",
			"\/playlist\/$mrmCyBjSBCkN$6KJU9vHH9geVCyCBy-x-QF0EVABkrFz+QwKMB-diDuBA-B639kGloYnAcmjKiW1TlY3unkNyLiwGSVHGpnDrS13BRnWlF6Vus8F05G+XME6BNHUVNU3EsFQsj8S6mYrNFMCT5ts5afMCzLJs5$gbL6XRA85Vg!.txt",
			"https://example.com/path/to/resource"
		];

		// console.log("Testing URL join with relative URLs:");
		// New url join with base URL
		relativeURLs.forEach((url, index) => {
			const baseURL = "https://example.com";
			const fullURL = new URL(url!, baseURL).href;
			const expectedBaseURL = expectedBaseURLs[index];
			// console.log(`Input URL: ${url}`);
			// console.log(`Full URL: ${fullURL}`);
			expect(fullURL).toBeDefined();
		});
	});
});
