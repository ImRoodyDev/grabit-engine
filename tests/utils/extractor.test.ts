import {
	extractYearFromText,
	extractContructorJSONArguments,
	extractContructorJSONArgumentsByName,
	extractVariableJSON,
	extractVariableByJSONKey,
	extractSetCookies,
	extractEvalCode,
	extractVariableValue,
	extractExtension
} from "../../src/utils/extractor";

// ─── extractExtension ─────────────────────────────────────────────────────────

describe("extractExtension", () => {
	it("should extract a simple file extension", () => {
		expect(extractExtension("video.mp4")).toBe("mp4");
		expect(extractExtension("subtitle.srt")).toBe("srt");
		expect(extractExtension("archive.tar")).toBe("tar");
	});

	it("should extract extension from a full URL", () => {
		expect(extractExtension("https://cdn.example.com/media/video.mp4")).toBe("mp4");
		expect(extractExtension("https://cdn.example.com/path/to/file.m3u8")).toBe("m3u8");
	});

	it("should extract extension when URL has query parameters", () => {
		expect(extractExtension("https://cdn.example.com/video.mp4?token=abc123&expires=999")).toBe("mp4");
		expect(extractExtension("https://example.com/stream.m3u8?quality=720")).toBe("m3u8");
	});

	it("should extract extension when URL has a fragment", () => {
		expect(extractExtension("https://example.com/video.mp4#t=10")).toBe("mp4");
		expect(extractExtension("file.srt#section")).toBe("srt");
	});

	it("should extract extension when URL has both query and fragment", () => {
		expect(extractExtension("https://example.com/video.mp4?v=1#start")).toBe("mp4");
	});

	it("should return the last extension for paths with multiple dots", () => {
		expect(extractExtension("https://cdn.example.com/my.video.file.mp4")).toBe("mp4");
		expect(extractExtension("archive.backup.tar")).toBe("tar");
	});

	it("should return null when there is no extension", () => {
		expect(extractExtension("https://example.com/video")).toBeNull();
		expect(extractExtension("noextension")).toBeNull();
		expect(extractExtension("")).toBeNull();
	});

	it("should return null for a trailing dot with no extension", () => {
		expect(extractExtension("file.")).toBeNull();
	});

	it("should handle common streaming extensions", () => {
		expect(extractExtension("https://stream.example.com/live/index.m3u8")).toBe("m3u8");
		expect(extractExtension("https://stream.example.com/chunk.ts")).toBe("ts");
		expect(extractExtension("https://cdn.example.com/movie.mkv")).toBe("mkv");
		expect(extractExtension("https://cdn.example.com/sub.vtt")).toBe("vtt");
		expect(extractExtension("https://cdn.example.com/sub.ass")).toBe("ass");
	});
});

// ─── extractYearFromText ──────────────────────────────────────────────────────

describe("extractYearFromText", () => {
	it("should extract the first valid year (1900-2099) from text", () => {
		expect(extractYearFromText("Movie released in 2023")).toBe(2023);
		expect(extractYearFromText("2023 film")).toBe(2023);
		expect(extractYearFromText("Old movie from 1995")).toBe(1995);
	});

	it("should return null if no valid year is found", () => {
		expect(extractYearFromText("No year here")).toBeNull();
		expect(extractYearFromText("")).toBeNull();
	});

	it("should return the first year when multiple are present", () => {
		expect(extractYearFromText("Movies from 2020 and 2021")).toBe(2020);
	});

	it("should ignore years outside the 1900-2099 range", () => {
		expect(extractYearFromText("Ancient history 1899")).toBeNull();
		expect(extractYearFromText("Future movie 2100")).toBeNull();
	});

	it("should handle years at the beginning, middle, and end of text", () => {
		expect(extractYearFromText("2022 is the year")).toBe(2022);
		expect(extractYearFromText("The year is 2021 now")).toBe(2021);
		expect(extractYearFromText("This happened in 2020")).toBe(2020);
	});
});

describe("extractVariableByJSONKey", () => {
	it("should return null for an empty string", () => {
		expect(extractVariableByJSONKey("", ["file"])).toBeNull();
	});

	it("should return null when no variable matches the required keys", () => {
		const src = 'let x = {"a": 1, "b": 2};';
		expect(extractVariableByJSONKey(src, ["file", "key"])).toBeNull();
	});

	it("should match the correct variable when only one satisfies required keys", () => {
		const src = 'let a = {"x": 1}; let b = {"file": "url.txt", "key": "abc"};';
		expect(extractVariableByJSONKey(src, ["file", "key"])).toEqual({ file: "url.txt", key: "abc" });
	});

	it("should return the first matching variable when multiple match", () => {
		const src = 'let a = {"file": "first.txt", "key": "k1"}; let b = {"file": "second.txt", "key": "k2"};';
		expect(extractVariableByJSONKey(src, ["file", "key"])).toEqual({ file: "first.txt", key: "k1" });
	});

	it("should match even when the variable name is a single letter or obfuscated", () => {
		const src = 'var _x2 = {"file": "video.m3u8", "key": "secret", "hls": 1};';
		expect(extractVariableByJSONKey(src, ["file", "key"])).toEqual({ file: "video.m3u8", key: "secret", hls: 1 });
	});

	it("should work with a single required key", () => {
		const src = 'let cfg = {"host": "example.com", "port": 80};';
		expect(extractVariableByJSONKey(src, ["host"])).toEqual({ host: "example.com", port: 80 });
	});

	it("should find the config object in a full HTML page regardless of variable name", () => {
		const src = `<script>
			// localStorage.debug = 'p2pml:*'
			let p3 = {"file":"https://ekola405gmt.com/playlist/abc.txt","hls":0,"key":"bKTIX0Eb","host":"1xcinema.net"};
			var ppl = new HDVBPlayer(p3);
		<\/script>`;
		const result = extractVariableByJSONKey(src, ["file", "key", "host"]);
		expect(result).not.toBeNull();
		expect(result!.file).toBe("https://ekola405gmt.com/playlist/abc.txt");
		expect(result!.key).toBe("bKTIX0Eb");
		expect(result!.host).toBe("1xcinema.net");
	});
});

describe("extractContructorJSONArguments", () => {
	describe("returns null", () => {
		it("should return null for an empty string", () => {
			expect(extractContructorJSONArguments("")).toBeNull();
		});

		it("should return null when there is no function call", () => {
			expect(extractContructorJSONArguments("const x = 42;")).toBeNull();
			expect(extractContructorJSONArguments("{ key: 'value' }")).toBeNull();
		});
	});

	describe("single object literal argument", () => {
		it("should parse a simple object literal", () => {
			expect(extractContructorJSONArguments("foo({key: 'value'})")).toEqual({ key: "value" });
		});

		it("should parse an object with multiple keys", () => {
			expect(extractContructorJSONArguments("init({url: 'http://example.com', timeout: 3000})")).toEqual({
				url: "http://example.com",
				timeout: 3000
			});
		});

		it("should parse a nested object literal", () => {
			expect(extractContructorJSONArguments("setup({options: {debug: true}})")).toEqual({
				options: { debug: true }
			});
		});

		it("should handle a constructor call with an object literal", () => {
			expect(extractContructorJSONArguments("new Player({src: 'video.mp4', autoplay: false})")).toEqual({
				src: "video.mp4",
				autoplay: false
			});
		});

		it("should fall back to indexed result when object parsing fails", () => {
			// Contains a property whose value cannot be JSON-parsed (e.g. unquoted complex value)
			const result = extractContructorJSONArguments("foo({key: undefined})");
			expect(result).toEqual({ 0: "{key: undefined}" });
		});
	});

	describe("single function argument", () => {
		it("should return the function expression at index 0 for a traditional function", () => {
			const result = extractContructorJSONArguments("run(function() { return 1; })");
			expect(result).toEqual({ 0: "function() { return 1; }" });
		});

		it("should return the arrow function at index 0", () => {
			const result = extractContructorJSONArguments("run(() => doSomething())");
			expect(result).toEqual({ 0: "() => doSomething()" });
		});
	});

	describe("multiple arguments", () => {
		it("should return an indexed map for multiple string arguments", () => {
			expect(extractContructorJSONArguments("fn('hello', 'world')")).toEqual({
				0: "'hello'",
				1: "'world'"
			});
		});

		it("should return an indexed map for mixed-type arguments", () => {
			expect(extractContructorJSONArguments("call('name', 42, true)")).toEqual({
				0: "'name'",
				1: "42",
				2: "true"
			});
		});

		it("should correctly split arguments containing nested structures", () => {
			const result = extractContructorJSONArguments("fn([1, 2, 3], {a: 1})");
			expect(result).toEqual({
				0: "[1, 2, 3]",
				1: "{a: 1}"
			});
		});

		it("should handle a single non-object, non-function argument", () => {
			expect(extractContructorJSONArguments("alert('hello')")).toEqual({ 0: "'hello'" });
		});
	});

	describe("object with JavaScript comments", () => {
		it("should parse an object containing single-line JS comments", () => {
			const source = `new Setup({
				sources: [{file:"https://example.com/master.m3u8"}],
				image: "https://example.com/thumb.jpg",
				width: "100%",
				//aspectratio: "16:9",
				preload: 'auto',
				//displayPlaybackLabel: true,
				//allowFullscreen: false,
				//"autoPause": { "viewability": true, "pauseAds": true },
				//skin: {controlbar: {text:"#6F6"}, timeslider:{progress:"#6F6"} },
				androidhls: "true"
			})`;

			const result = extractContructorJSONArguments(source) as Record<string, unknown>;
			expect(result).not.toBeNull();
			expect(result.sources).toEqual([{ file: "https://example.com/master.m3u8" }]);
			expect(result.image).toBe("https://example.com/thumb.jpg");
			expect(result.width).toBe("100%");
			expect(result.preload).toBe("auto");
			expect(result.androidhls).toBe("true");
			// Commented-out keys should not appear
			expect(result.aspectratio).toBeUndefined();
			expect(result.displayPlaybackLabel).toBeUndefined();
		});

		it("should parse an object containing block comments", () => {
			const source = `fn({ key1: "value1", /* key2: "value2", */ key3: 42 })`;
			const result = extractContructorJSONArguments(source) as Record<string, unknown>;
			expect(result).not.toBeNull();
			expect(result.key1).toBe("value1");
			expect(result.key3).toBe(42);
			expect(result.key2).toBeUndefined();
		});

		it("should preserve URLs with // inside string values", () => {
			const source = `fn({ url: "https://cdn.example.com/video.m3u8", name: "test" })`;
			const result = extractContructorJSONArguments(source) as Record<string, unknown>;
			expect(result).not.toBeNull();
			expect(result.url).toBe("https://cdn.example.com/video.m3u8");
			expect(result.name).toBe("test");
		});
	});

	describe("eval/packer output with escaped single quotes", () => {
		// Simulates unpacked eval code from a supervideo.cc embed page where single-quoted
		// values are escaped as \' because the packed payload was wrapped in single quotes.
		const SUPERVIDEO_SETUP = `new Setup({sources:[{file:"https://hfs311.serversicuro.cc/hls/,dnzpdtcj27g4a3gyvbmx5nbprn3pvcvwt5u6repjwet34bnompm2fgu4gksq,.urlset/master.m3u8"}],image:"https://img.supercdn.cc/lnx35h1a9rdh_xt.jpg",width:"100%",height:"100%",stretching:"uniform",duration:"2956.08",preload:\\'metadata\\',androidhls:"true",hlshtml:"true",primary:"html5",startparam:"start",playbackRateControls:[0.25,0.5,0.75,1,1.25,1.5,2],skin:{name:"myskin"},tracks:[{file:"/dlf?op=get_slides&length=2956.08&url=https://img.supercdn.cc/lnx35h1a9rdh0000.jpg",kind:"thumbnails"}],captions:{color:\\'#FFFFFF\\',fontSize:12,fontFamily:"Verdana",backgroundOpacity:0,edgeStyle:\\'uniform\\',fontOpacity:90},abouttext:"xvs",aboutlink:"",logo:{file:"https://supervideo.cc/images/logo_p.png",link:"https://supervideo.cc/lnx35h1a9rdh",position:"top-right",margin:"5",hide:true},cast:{}})`;

		it("should parse the object despite escaped single quotes from packer output", () => {
			const result = extractContructorJSONArguments(SUPERVIDEO_SETUP) as Record<string, unknown>;

			expect(result).not.toBeNull();
			expect(result.sources).toEqual([
				{ file: "https://hfs311.serversicuro.cc/hls/,dnzpdtcj27g4a3gyvbmx5nbprn3pvcvwt5u6repjwet34bnompm2fgu4gksq,.urlset/master.m3u8" }
			]);
			expect(result.preload).toBe("metadata");
			expect(result.stretching).toBe("uniform");
			expect(result.width).toBe("100%");
			expect(result.duration).toBe("2956.08");
			expect(result.primary).toBe("html5");

			const captions = result.captions as Record<string, unknown>;
			expect(captions.color).toBe("#FFFFFF");
			expect(captions.edgeStyle).toBe("uniform");
			expect(captions.fontSize).toBe(12);
			expect(captions.fontFamily).toBe("Verdana");

			const logo = result.logo as Record<string, unknown>;
			expect(logo.position).toBe("top-right");
			expect(logo.hide).toBe(true);

			expect(result.cast).toEqual({});
		});
	});
});
describe("extractContructorJSONArgumentsByName", () => {
	const HTML_SOURCE = `
		<div class="ad adblock rek banner" id="adv"></div>
		<script src="/player/js/adblock.js"></script>
		<script src="/playerjs/js/playerjs.js?=1771598611"></script>
		<script>
			var pl = new HDVBPlayer({
				file: '\/playlist\/$mrmCyBjSBCkN$6KJU9vHH9geVCyCBy-x-QF0EVABkrFz+QwKMB-diDuBA-B639kGloYnAcmjKiW1TlY3unkNyLiwGSVHGpnDrS13BRnWlF6Vus8F05G+XME6BNHUVNU3EsFQsj8S6mYrNFMCT5ts5afMCzLJs5$gbL6XRA85Vg!.txt',
				id: 'player-tt13918776',
				cuid: 'tt13918776',
				key: 'UHNIX1T3JOw1M8t9weKuMn10m8ScvPquFCBRlOwggKG76bMhn1U$6O9ikYDq0UhB',
				movie: 'tt13918776',
				host: '1xcinema.net',
				masterId: '1500',
				masterHash: 'e81123189dd4d684ec8b1ac2d2ece1ab',
				userIp: '83.81.233.133',
				poster: '',
				href: 'ekola405gmt.com',
				p2p: true,
				rek: {
					preroll: ['https:\/\/cvt-s2.agl002.online\/v\/_jMvM2I1MjE2YjQtYmVhNSWWYT_jL-I4ZjItN-NiYmZjZ-NlMjVi.xml'],
					midroll: [{ time: '3%', url: 'https:\/\/cvt-s2.agl002.online\/v\/_jMvNjk3O-FmN-UtNGY4MyWWMTczLTgxY-ItNGVjY-IyMjBhY-M3.xml' }],
					pausebanner: {
						class: '604c7625',
						key: '8b665394-f37b-4375-a801-6aaa9babb5b7',
						script: 'https:\/\/cvt-s2.agl002.online\/o\/s\/a941312e99999aac85c8d55346033a2f.js',
						show: true,
					},
					endtag: {
						class: '604c7625',
						key: '2174fead-70ec-439d-a235-75ae872c1daa',
						script: 'https:\/\/cvt-s2.agl002.online\/o\/s\/a941312e99999aac85c8d55346033a2f.js',
						conf: { show_time: 30, skip_time: 15, movie_et: null, banner_show: true, banner_time: 600 },
					},
					starttag: [],
					pushbanner: [],
				},
				autoplay: 0,
				domain: null,
				kp: 'tt13918776',
			});
		</script>`;

	it("should return null when the function name is not found in source", () => {
		expect(extractContructorJSONArgumentsByName(HTML_SOURCE, "UnknownPlayer")).toBeNull();
	});

	it("should extract and parse the HDVBPlayer constructor arguments from an HTML source", () => {
		const result = extractContructorJSONArgumentsByName(HTML_SOURCE, "HDVBPlayer") as Record<string, unknown>;

		expect(result).not.toBeNull();

		expect(result.id).toBe("player-tt13918776");
		expect(result.cuid).toBe("tt13918776");
		expect(result.movie).toBe("tt13918776");
		expect(result.host).toBe("1xcinema.net");
		expect(result.masterId).toBe("1500");
		expect(result.masterHash).toBe("e81123189dd4d684ec8b1ac2d2ece1ab");
		expect(result.userIp).toBe("83.81.233.133");
		expect(result.poster).toBe("");
		expect(result.href).toBe("ekola405gmt.com");
		expect(result.p2p).toBe(true);
		expect(result.autoplay).toBe(0);
		expect(result.domain).toBeNull();
		expect(result.kp).toBe("tt13918776");

		// Nested rek object
		const rek = result.rek as Record<string, unknown>;
		expect(Array.isArray(rek.preroll)).toBe(true);
		expect((rek.preroll as string[])[0]).toContain("cvt-s2.agl002.online");

		expect(Array.isArray(rek.midroll)).toBe(true);
		expect((rek.midroll as Array<Record<string, string>>)[0].time).toBe("3%");

		const pausebanner = rek.pausebanner as Record<string, unknown>;
		expect(pausebanner.class).toBe("604c7625");
		expect(pausebanner.show).toBe(true);

		const endtag = rek.endtag as Record<string, unknown>;
		const conf = endtag.conf as Record<string, unknown>;
		expect(conf.show_time).toBe(30);
		expect(conf.skip_time).toBe(15);
		expect(conf.movie_et).toBeNull();
		expect(conf.banner_show).toBe(true);
		expect(conf.banner_time).toBe(600);

		expect(rek.starttag).toEqual([]);
		expect(rek.pushbanner).toEqual([]);
	});

	it("should extract jwplayer setup args with JS comments (goodstream scenario)", () => {
		const scriptContent = `
			jwplayer("vplayer").setup({
				skin: {
					url:"/css2/jw8-theme.css?55",
					name: "jw8-theme"
				},
				sources: [{file:"https://hls2.goodstream.one/hls2/01/00032/xvokq5ns8p0d_,l,n,h,.urlset/master.m3u8?t=abc&s=123"}],
				image: "https://s2.goodstream.one/i/01/00032/xvokq5ns8p0d.jpg",
				width: "100%",
				height: "100%",
				stretching: "uniform",
				duration: "8884.10",
				//aspectratio: "16:9",
				preload: 'auto',
				advertising: { loadVideoTimeout: 30000 },
				//displayPlaybackLabel: true,
				horizontalVolumeSlider: true,
				//allowFullscreen: false,
				//"autoPause": { "viewability": true, "pauseAds": true },
				//skin: {controlbar: {text:"#6F6", icons:"#6F6"}, timeslider:{progress:"#6F6"}, menus:{text:"#6F6"} },
				//pipIcon: 'disabled',
				androidhls: "true",
				tracks: [{file: "https://s2.goodstream.one/vtt/thumb.vtt", kind: "thumbnails"}]
			});
			var player = jwplayer();
		`;

		const result = extractContructorJSONArgumentsByName(scriptContent.replace('jwplayer("vplayer").setup', "new Setup"), "new Setup") as Record<
			string,
			unknown
		>;

		expect(result).not.toBeNull();
		expect(result.sources).toEqual([{ file: "https://hls2.goodstream.one/hls2/01/00032/xvokq5ns8p0d_,l,n,h,.urlset/master.m3u8?t=abc&s=123" }]);
		expect(result.width).toBe("100%");
		expect(result.preload).toBe("auto");
		expect(result.androidhls).toBe("true");
		expect(result.horizontalVolumeSlider).toBe(true);
		// Commented-out keys must not leak through
		expect((result as any).aspectratio).toBeUndefined();
		expect((result as any).displayPlaybackLabel).toBeUndefined();
		expect((result as any).pipIcon).toBeUndefined();
	});

	it("should extract jwplayer setup args by name from eval-unpacked code with escaped quotes", () => {
		// Full unpacked eval output from a supervideo.cc embed — uses .setup() method call
		const unpackedCode = `jwplayer("vplayer").setup({sources:[{file:"https://hfs311.serversicuro.cc/hls/,dnzpdtcj27g4a3gyvbmx5nbprn3pvcvwt5u6repjwet34bnompm2fgu4gksq,.urlset/master.m3u8"}],image:"https://img.supercdn.cc/lnx35h1a9rdh_xt.jpg",width:"100%",height:"100%",stretching:"uniform",duration:"2956.08",preload:\\'metadata\\',androidhls:"true",hlshtml:"true",primary:"html5",startparam:"start",playbackRateControls:[0.25,0.5,0.75,1,1.25,1.5,2],skin:{name:"myskin"},tracks:[{file:"/dlf?op=get_slides&length=2956.08&url=https://img.supercdn.cc/lnx35h1a9rdh0000.jpg",kind:"thumbnails"}],captions:{color:\\'#FFFFFF\\',fontSize:12,fontFamily:"Verdana",backgroundOpacity:0,edgeStyle:\\'uniform\\',fontOpacity:90},abouttext:"xvs",aboutlink:"",logo:{file:"https://supervideo.cc/images/logo_p.png",link:"https://supervideo.cc/lnx35h1a9rdh",position:"top-right",margin:"5",hide:true},cast:{}});var vvplay,vvad;`;

		const result = extractContructorJSONArgumentsByName(unpackedCode, "setup") as Record<string, unknown>;

		expect(result).not.toBeNull();
		expect(result.sources).toEqual([
			{ file: "https://hfs311.serversicuro.cc/hls/,dnzpdtcj27g4a3gyvbmx5nbprn3pvcvwt5u6repjwet34bnompm2fgu4gksq,.urlset/master.m3u8" }
		]);
		expect(result.preload).toBe("metadata");
		expect(result.width).toBe("100%");

		const captions = result.captions as Record<string, unknown>;
		expect(captions.color).toBe("#FFFFFF");
		expect(captions.edgeStyle).toBe("uniform");
	});

	it("should extract jwplayer setup args containing ternary expressions (vimeos scenario)", () => {
		// Unpacked eval output from a vimeos embed — contains a JS ternary expression
		// (canAutoPlay?'viewable':false) as a property value, which is not valid JSON.
		const unpackedCode = `jwplayer("vplayer").setup({skin:{url:"/css2/jw8-theme.css?555",name:"jw8-theme",},sources:[{file:"https://vimeos.zip/hls2/02/00008/slm63blvjl6e_h/master.m3u8?t=vNW8ye8DrT07CzFcFAgvTjG9UWKYV3YUP3nYjF6uwek&s=1772686482&e=43200&v=133171932&srv=s14&i=0.0&sp=0&fr=slm63blvjl6e&r=e"}],autostart:canAutoPlay?\\'viewable\\':false,image:"https://s14.vimeos.net/i/02/00008/slm63blvjl6e.jpg",width:"100%",height:"100%",stretching:"uniform",duration:"7456.38",fullscreenOrientationLock:"none",preload:"auto",horizontalVolumeSlider:true,androidhls:"true",tracks:[{file:"https://s14.vimeos.net/vtt/02/00008/slm63blvjl6e_spa.vtt",label:"Spanish",kind:"captions","default":true},{file:"/srt/empty.srt",label:"Upload captions",kind:"captions"}],captions:{userFontScale:1,color:\\'#FFFFFF\\',backgroundColor:\\'#303030\\',fontFamily:"Tahoma",backgroundOpacity:30,fontOpacity:\\'100\\',},"sharing":{code:"%3CIFRAME SRC%3D%22https%3A%2F%2Fvimeos.net%2Fembed-slm63blvjl6e.html%22 FRAMEBORDER%3D0 MARGINWIDTH%3D0 MARGINHEIGHT%3D0 SCROLLING%3DNO WIDTH%3D640 HEIGHT%3D360 allowfullscreen%3E%3C%2FIFRAME%3E",link:"https://vimeos.net/slm63blvjl6e.html",sites:[]},"advertising":{"tag":"https://cvt-s1.adangle.online/v/_jMvYTFkZ-NmO-MtN2U3ZSWWMj_mL-JlNzUtMjYzOGZiYTY1NzZj.xml?cp.host=bb597b77de7440619f0e27524573ad12|lamovie.link&cp.domain=lamovie.link","client":"vast","vpaidmode":"insecure","preloadAds":true},\\'qualityLabels\\':{\"2349\":\"HD\"},abouttext:"Vimeus ",aboutlink:"https://xvs.tt/premium",cast:{},playbackRateControls:true,playbackRates:[1,1.25,1.5,2]});var vvplay,vvad;`;

		const result = extractContructorJSONArgumentsByName(unpackedCode.replace('jwplayer("vplayer").setup', "new Setup"), "new Setup") as Record<string, unknown>;

		expect(result).not.toBeNull();
		expect(result.sources).toEqual([
			{
				file: "https://vimeos.zip/hls2/02/00008/slm63blvjl6e_h/master.m3u8?t=vNW8ye8DrT07CzFcFAgvTjG9UWKYV3YUP3nYjF6uwek&s=1772686482&e=43200&v=133171932&srv=s14&i=0.0&sp=0&fr=slm63blvjl6e&r=e"
			}
		]);
		// The ternary expression should be replaced with null
		expect(result.autostart).toBeNull();
		expect(result.image).toBe("https://s14.vimeos.net/i/02/00008/slm63blvjl6e.jpg");
		expect(result.width).toBe("100%");
		expect(result.height).toBe("100%");
		expect(result.stretching).toBe("uniform");
		expect(result.duration).toBe("7456.38");
		expect(result.androidhls).toBe("true");
		expect(result.horizontalVolumeSlider).toBe(true);
		expect(result.playbackRateControls).toBe(true);
		expect(result.playbackRates).toEqual([1, 1.25, 1.5, 2]);
		expect(result.cast).toEqual({});

		const captions = result.captions as Record<string, unknown>;
		expect(captions.color).toBe("#FFFFFF");
		expect(captions.backgroundColor).toBe("#303030");
		expect(captions.fontOpacity).toBe("100");
		expect(captions.fontFamily).toBe("Tahoma");

		const advertising = result.advertising as Record<string, unknown>;
		expect(advertising.client).toBe("vast");
		expect(advertising.preloadAds).toBe(true);
	});
});
describe("extractVariableJSON", () => {
	it("should return null for an empty string", () => {
		expect(extractVariableJSON("", "p3")).toBeNull();
	});

	it("should return null when the variable is not declared", () => {
		expect(extractVariableJSON("var foo = {a: 1};", "bar")).toBeNull();
	});

	it("should return null when the variable value is not an object", () => {
		expect(extractVariableJSON("let p3 = 42;", "p3")).toBeNull();
		expect(extractVariableJSON('let p3 = "hello";', "p3")).toBeNull();
	});

	it("should extract a simple object from a let declaration", () => {
		expect(extractVariableJSON('let p3 = {"file": "url.txt", "hls": 0};', "p3")).toEqual({ file: "url.txt", hls: 0 });
	});

	it("should extract an object from a var declaration", () => {
		expect(extractVariableJSON('var cfg = {"key": "value"};', "cfg")).toEqual({ key: "value" });
	});

	it("should extract an object from a const declaration", () => {
		expect(extractVariableJSON('const opts = {"debug": true};', "opts")).toEqual({ debug: true });
	});

	it("should extract a deeply nested object", () => {
		const src = 'let p3 = {"rek": {"preroll": [], "midroll": [{"time": "3%"}]}};';
		expect(extractVariableJSON(src, "p3")).toEqual({ rek: { preroll: [], midroll: [{ time: "3%" }] } });
	});

	it("should extract the correct variable when multiple variables are declared", () => {
		const src = 'let a = {"x": 1}; let b = {"y": 2};';
		expect(extractVariableJSON(src, "a")).toEqual({ x: 1 });
		expect(extractVariableJSON(src, "b")).toEqual({ y: 2 });
	});

	it("should work when the variable is embedded in an HTML script tag", () => {
		const src = `<script>
			let p3 = {"file": "https://example.com/playlist.txt", "hls": 0, "translator": "1"};
			var ppl = new HDVBPlayer(p3);
		<\/script>`;
		expect(extractVariableJSON(src, "p3")).toEqual({
			file: "https://example.com/playlist.txt",
			hls: 0,
			translator: "1"
		});
	});
});

describe("extractSetCookies", () => {
	it("should return an empty array for a falsy value", () => {
		expect(extractSetCookies(null as any)).toEqual([]);
		expect(extractSetCookies(undefined as any)).toEqual([]);
	});

	it("should return an empty array when no Set-Cookie header is present", () => {
		expect(extractSetCookies({ "content-type": "text/html" })).toEqual([]);
	});

	it("should extract a single cookie string from a plain object (lowercase key)", () => {
		expect(extractSetCookies({ "set-cookie": "session=abc; Path=/" })).toEqual(["session=abc; Path=/"]);
	});

	it("should extract a single cookie string from a plain object (Pascal-case key)", () => {
		expect(extractSetCookies({ "Set-Cookie": "token=xyz; HttpOnly" })).toEqual(["token=xyz; HttpOnly"]);
	});

	it("should extract multiple cookies from an array value", () => {
		const headers = { "set-cookie": ["a=1; Path=/", "b=2; HttpOnly"] };
		expect(extractSetCookies(headers)).toEqual(["a=1; Path=/", "b=2; HttpOnly"]);
	});

	it("should work with a Headers-like object that has a .get() method", () => {
		const fakeHeaders = {
			get: (name: string) => (name.toLowerCase() === "set-cookie" ? "session=abc; Path=/" : null)
		};
		expect(extractSetCookies(fakeHeaders)).toEqual(["session=abc; Path=/"]);
	});

	it("should return an empty array when Headers.get() returns null", () => {
		const fakeHeaders = { get: () => null };
		expect(extractSetCookies(fakeHeaders)).toEqual([]);
	});

	it("should use getAll() when available on a Headers-like object", () => {
		const fakeHeaders = {
			get: () => "single=a",
			getAll: (name: string) => (name.toLowerCase() === "set-cookie" ? ["a=1", "b=2"] : [])
		};
		expect(extractSetCookies(fakeHeaders)).toEqual(["a=1", "b=2"]);
	});
});

describe("extractEvalCode", () => {
	it("should return null for an empty string", () => {
		expect(extractEvalCode("")).toBeNull();
	});

	it("should return null when there is no eval() call", () => {
		expect(extractEvalCode("console.log('hello')")).toBeNull();
	});

	it("should extract a simple eval() call", () => {
		// Note: the EVAL_CODE regex is lazy (*?) — it stops at the FIRST ")" found.
		// Content with nested parentheses will be truncated at the inner ")".
		// Use content without nested parens for a clean full match.
		expect(extractEvalCode("eval('x=1')")).toBe("eval('x=1')");
	});

	it("should extract an eval() call embedded in larger source", () => {
		const src = `var x = 1;\neval("var y = 2;");\nvar z = 3;`;
		expect(extractEvalCode(src)).toBe(`eval("var y = 2;")`);
	});

	it("should extract only the first eval() when multiple are present", () => {
		const src = `eval("first"); eval("second");`;
		expect(extractEvalCode(src)).toBe(`eval("first")`);
	});

	it("should handle multi-line eval content", () => {
		const src = `eval("var a = 1;\nvar b = 2;")`;
		expect(extractEvalCode(src)).toBe(`eval("var a = 1;\nvar b = 2;")`);
	});

	it("should correctly handle eval content with nested parentheses", () => {
		expect(extractEvalCode("eval('doSomething()')")).toBe("eval('doSomething()')");
	});
});

describe("extractVariableValue", () => {
	// ── const / let / var declarations ────────────────────────────────────────

	it("should return null for an empty string", () => {
		expect(extractVariableValue("", "MDCore")).toBeNull();
	});

	it("should return null when the variable is not present", () => {
		expect(extractVariableValue('const other = "value";', "MDCore")).toBeNull();
	});

	it("should extract a double-quoted string from a const declaration", () => {
		expect(extractVariableValue('const MDCore = "gjdw89lncgzrde";', "MDCore")).toBe("gjdw89lncgzrde");
	});

	it("should extract a single-quoted string from a let declaration", () => {
		expect(extractVariableValue("let token = 'abc123';", "token")).toBe("abc123");
	});

	it("should extract a backtick string from a var declaration", () => {
		expect(extractVariableValue("var msg = `hello world`;", "msg")).toBe("hello world");
	});

	it("should extract a numeric value", () => {
		expect(extractVariableValue("const count = 42;", "count")).toBe("42");
	});

	it("should extract a negative number", () => {
		expect(extractVariableValue("let offset = -3.14;", "offset")).toBe("-3.14");
	});

	it("should extract boolean true", () => {
		expect(extractVariableValue("const flag = true;", "flag")).toBe("true");
	});

	it("should extract boolean false", () => {
		expect(extractVariableValue("const flag = false;", "flag")).toBe("false");
	});

	it("should extract null", () => {
		expect(extractVariableValue("let x = null;", "x")).toBe("null");
	});

	it("should extract undefined", () => {
		expect(extractVariableValue("let x = undefined;", "x")).toBe("undefined");
	});

	// ── bare property assignments (no var/let/const) ───────────────────────────

	it("should extract a value from a bare property assignment (dot notation)", () => {
		expect(extractVariableValue('MDCore.ref = "gjdw89lncgzrde";', "MDCore.ref")).toBe("gjdw89lncgzrde");
	});

	it("should extract a value from a bare simple assignment", () => {
		expect(extractVariableValue("_token = 'xyz';", "_token")).toBe("xyz");
	});

	it("should not match compound operators (==, ===, +=, =>)", () => {
		expect(extractVariableValue("if (MDCore.ref == 'value') {}", "MDCore.ref")).toBeNull();
		expect(extractVariableValue("if (MDCore.ref === 'value') {}", "MDCore.ref")).toBeNull();
	});

	// ── embedded in HTML ───────────────────────────────────────────────────────

	it("should extract a value when the variable is inside a script tag", () => {
		const src = `<script>\n  const MDCore = "gjdw89lncgzrde";\n<\/script>`;
		expect(extractVariableValue(src, "MDCore")).toBe("gjdw89lncgzrde");
	});

	it("should extract a property assignment embedded in larger source", () => {
		const src = `var x = 1;\nMDCore.ref = "secret_key";\nvar y = 2;`;
		expect(extractVariableValue(src, "MDCore.ref")).toBe("secret_key");
	});

	// ── backslash escapes ──────────────────────────────────────────────────────

	it("should handle escaped quote characters inside a string value", () => {
		expect(extractVariableValue('const s = "he said \\"hi\\"";', "s")).toBe('he said \\"hi\\"');
	});
});
