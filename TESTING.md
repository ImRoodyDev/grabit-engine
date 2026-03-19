# Testing Providers

This guide explains how to use the `test-provider` CLI tool to verify that your provider plugin scrapes successfully before publishing.

This is a **dev-only** tool — it is not exported from or bundled into the `grabit-engine` package. Its sole purpose is to help provider authors confirm their scraping logic works correctly against real media data.

---

## How it works

The tester does the following in one command:

1. **Resolves your provider** — finds `providers/<scheme>/index.js` (pre-bundled) or auto-bundles `index.ts` on the fly via esbuild into a temporary file.
2. **Bootstraps the context** — loads the same `xhr`, `cheerio`, and `puppeteer` context that `GrabitManager` uses internally.
3. **Enriches media via TMDB** — for movies/series, the tester calls `TMDB.createRequesterMedia()` to fill in any missing fields (title, year, duration, IMDB ID, localized titles, etc.). You only need to provide the minimum required fields. Fields you provide are **never overwritten**.
4. **Runs the scrape** — calls `getStreams` and/or `getSubtitles` on your module with the enriched media, with a configurable timeout.
5. **Reports results** — prints a formatted report of every source found, with a `PASS / EMPTY / FAIL` verdict at the end.

No test framework required. No manager setup needed.

---

## Prerequisites

esbuild must be installed (only needed if using TypeScript source directly):

```bash
npm install --save-dev esbuild
```

If you pre-bundle with `npx bundle-provider` first, esbuild is not required at test time.

---

## Usage

### Test a movie

```bash
# Minimal — only tmdb is required, TMDB fills title, year, duration, etc.
npx test-provider --scheme my-provider --type movie --tmdb 27205

# Full — all data provided, TMDB only fills gaps like localizedTitles
npx test-provider --scheme my-provider --type movie \
  --title "Inception" --year 2010 --tmdb 27205 --imdb tt1375666 --duration 148
```

### Test a series episode

```bash
# Minimal — only tmdb, season, episode required
npx test-provider --scheme my-provider --type serie \
  --tmdb 1396 --season 1 --episode 1

# Full
npx test-provider --scheme my-provider --type serie \
  --title "Breaking Bad" --year 2008 --tmdb 1396 \
  --season 1 --episode 1 --ep-tmdb 349232
```

### Test a channel

```bash
npx test-provider --scheme my-provider --type channel \
  --channel-id cnn --channel-name "CNN"
```

### Test subtitles instead of streams

```bash
npx test-provider --scheme my-provider --mode subtitles --type movie --tmdb 27205
```

### Test both streams and subtitles

```bash
npx test-provider --scheme my-provider --mode both --type movie --tmdb 27205
```

### Load media from a JSON file

Instead of passing individual flags, you can supply a pre-built `Media` object from a file:

```bash
npx test-provider --scheme my-provider --media-file ./test-media.json
```

`test-media.json` must contain a valid `Media` object (or a partial one — TMDB fills the rest). Examples:

**Minimal movie** (only `type` and `tmdbId`):

```json
{
	"type": "movie",
	"tmdbId": "27205"
}
```

**Full movie:**

```json
{
	"type": "movie",
	"title": "Inception",
	"releaseYear": 2010,
	"tmdbId": "27205",
	"imdbId": "tt1375666",
	"duration": 148
}
```

**Minimal series** (only `type`, `tmdbId`, `season`, `episode`):

```json
{
	"type": "serie",
	"tmdbId": "1396",
	"season": 1,
	"episode": 1
}
```

**Full series:**

```json
{
	"type": "serie",
	"title": "Breaking Bad",
	"releaseYear": 2008,
	"tmdbId": "1396",
	"duration": 47,
	"season": 1,
	"episode": 1,
	"ep_tmdbId": "349232"
}
```

```json
{
	"type": "channel",
	"channelId": "cnn",
	"channelName": "CNN"
}
```

---

## Grouped providers

If your provider lives in a group subdirectory (e.g. `providers/english/vidsrc/`), pass the full relative path as the scheme:

```bash
npx test-provider --scheme english/vidsrc --type movie \
  --title "Inception" --year 2010 --tmdb 27205 --duration 148
```

---

## Custom providers directory

By default the tool looks for providers in `./providers/`. Use `--src` to point to a different directory:

```bash
npx test-provider --scheme my-provider --src ./my-providers \
  --type movie --title "Inception" --year 2010 --tmdb 27205 --duration 148
```

---

## Custom manifest directory

By default the tool looks for `manifest.json` in the **project root** (where you run the command), then falls back to the `--src` directory. If your manifest lives somewhere else, pass `--manifest-dir` to tell the tool exactly where to find it:

```bash
npx test-provider --scheme my-provider --manifest-dir ./config \
  --type movie --title "Inception" --year 2010 --tmdb 27205 --duration 148
```

The manifest is used to read a provider's `dir` field so the tool can find providers stored outside the default `--src` directory. If no matching entry is found in the manifest, the tool falls back to `<src>/<scheme>`.

---

## Provider file resolution

The tool resolves the provider entry in this order:

| Priority | File                      | Notes                                         |
| -------- | ------------------------- | --------------------------------------------- |
| 1st      | `<src>/<scheme>/index.js` | Pre-bundled output from `npx bundle-provider` |
| 2nd      | `<src>/<scheme>/index.ts` | TypeScript source — auto-bundled via esbuild  |

If neither file exists, the tool exits with an error.

To skip auto-bundling and require a pre-built `index.js`, pass `--no-bundle`:

```bash
npx test-provider --scheme my-provider --no-bundle ...
```

---

## Output

The tool prints a structured report broken into sections:

```
┌─────────────────────────────────────────────┐
│  grabit-engine  ·  Provider Tester  │
└─────────────────────────────────────────────┘

► Media
────────────────────────────────────────────────────────────
  type:   movie
  title:  Inception
  year:   2010
  tmdb:   27205
  imdb:   tt1375666

► Loading context
────────────────────────────────────────────────────────────
ℹ Importing provider context from package dist...
✔ Context ready  (xhr, cheerio, puppeteer)

► Loading provider
────────────────────────────────────────────────────────────
ℹ Loading pre-bundled provider: providers/my-provider/index.js
  scheme:       my-provider
  name:         My Provider
  version:      1.0.0
  getStreams:   ✔ yes
  getSubtitles: — no

► Scraping  (mode: streams, timeout: 90000ms)
────────────────────────────────────────────────────────────
ℹ Running scrape...

► Stream Sources  (2 found)
────────────────────────────────────────────────────────────
  [1] episode.m3u8
      Scheme:      my-provider
      Provider:    My Provider
      Format:      m3u8
      Language:    en
      CORS policy: no
      Qualities:
        • 1080p — https://cdn.example.com/1080/stream.m3u8
        • 720p  — https://cdn.example.com/720/stream.m3u8

► Summary
────────────────────────────────────────────────────────────
  Time elapsed:   1243ms
  Stream sources: 2

  PASS  Provider "my-provider" scraped successfully.
```

### Verdict labels

| Label   | Meaning                                  |
| ------- | ---------------------------------------- |
| `PASS`  | At least one result returned, no errors  |
| `EMPTY` | No error thrown, but no results returned |
| `FAIL`  | An error was thrown during scraping      |

The process exits with code `0` on PASS/EMPTY and `1` on FAIL.

---

## Options reference

| Option                              | Default       | Description                                                                |
| ----------------------------------- | ------------- | -------------------------------------------------------------------------- |
| `--scheme <scheme>`                 | —             | Provider scheme to test **(required)**                                     |
| `--type <movie\|serie\|channel>`    | —             | Media type (required unless `--media-file`)                                |
| `--tmdb <string>`                   | —             | TMDB ID **(required for movie/serie)**                                     |
| `--title <string>`                  | —             | Title in English (optional — filled by TMDB)                               |
| `--year <number>`                   | —             | Release year (optional — filled by TMDB)                                   |
| `--imdb <string>`                   | —             | IMDB ID (optional — filled by TMDB)                                        |
| `--duration <number>`               | —             | Duration in minutes (optional — filled by TMDB)                            |
| `--season <number>`                 | —             | Season number **(required for serie)**                                     |
| `--episode <number>`                | —             | Episode number **(required for serie)**                                    |
| `--ep-tmdb <string>`                | —             | Episode TMDB ID (optional — filled by TMDB)                                |
| `--ep-imdb <string>`                | —             | Episode IMDB ID (optional — filled by TMDB)                                |
| `--channel-id <string>`             | —             | Channel ID (channel only)                                                  |
| `--channel-name <string>`           | —             | Channel name (channel only)                                                |
| `--media-file <path>`               | —             | Load media from a JSON file (overrides per-field flags)                    |
| `--mode <streams\|subtitles\|both>` | `streams`     | What to test                                                               |
| `--lang <iso>`                      | `en`          | Target language ISO code                                                   |
| `--user-agent <string>`             | —             | Custom user agent string                                                   |
| `--src <path>`                      | `./providers` | Providers directory                                                        |
| `--manifest-dir <path>`             | —             | Directory containing `manifest.json` (default: project root, then `--src`) |
| `--timeout <ms>`                    | `90000`       | Scrape timeout in milliseconds                                             |
| `--raw`                             | `false`       | Also print raw JSON output                                                 |
| `--no-bundle`                       | `false`       | Require pre-bundled `index.js`, skip auto-bundling                         |
| `--help`, `-h`                      | —             | Show help                                                                  |

---

## Tips

- **Always test before pushing to GitHub.** Bundle your provider first (`npx bundle-provider <scheme>`), then run the tester against the bundled output to catch any runtime import issues.
- **Use `--raw`** when debugging to inspect the full JSON response from your provider.
- **Use `--mode both`** if your provider implements both `getStreams` and `getSubtitles` to validate both in one run.
- **Use `--media-file`** to keep a reusable set of test cases alongside your provider source.
- **Test with real IDs** — use accurate TMDB/IMDB IDs to increase the chance of the provider finding a valid result.
