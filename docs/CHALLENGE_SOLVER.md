# Challenge solver (`ctx.solveChallenge`)

A portable way to get past a Cloudflare / anti-bot interstitial. On Node it uses the built-in
puppeteer pool; on React Native / server you inject your own solver — puppeteer can't run
on-device.

## In a provider

```typescript
import { CookieJar } from "grabit-engine";

export async function getStreams(requester, ctx) {
  const { html, cookies, cookieMap, userAgent } = await ctx.solveChallenge(url, requester, {
    waitForCookie: "cf_clearance", // optional: wait until this cookie appears
    timeoutMs: 20000
  });

  // Reuse the earned session on the following HTTP hops:
  const jar = new CookieJar();
  for (const [name, value] of Object.entries(cookieMap)) jar.set(new URL(url).host, name, value);
  await ctx.xhr.fetch(next, { cookieJar: jar, headers: { "User-Agent": userAgent } }, requester);
}
```

`ChallengeSolveResult` → `{ html, cookies, cookieMap, userAgent }`.

## Injecting a solver (host side)

`ctx.solveChallenge` uses a host-provided solver when one is set, otherwise the Node puppeteer
pool. Register yours once at startup:

```typescript
import { setChallengeSolver } from "grabit-engine";

setChallengeSolver({
  async solve(url, requester, options) {
    // return { html, cookies, cookieMap, userAgent }
  }
});
```

### React Native — hidden WebView (recommended on device)

Puppeteer can't run on a phone. The idiomatic approach is a **hidden/off-screen WebView** that
loads the URL, lets the JS challenge run, then reports back the rendered HTML + cookies + UA.
Wire that WebView bridge into `setChallengeSolver` and providers keep calling
`ctx.solveChallenge` unchanged.

### Server — FlareSolverr

Point the solver at a [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) instance:

```typescript
setChallengeSolver({
  async solve(url, requester, options) {
    const r = await fetch("http://flaresolverr:8191/v1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "request.get", url: url.href, maxTimeout: options?.timeoutMs ?? 60000 })
    });
    const { solution } = await r.json();
    const cookieMap = Object.fromEntries(solution.cookies.map((c) => [c.name, c.value]));
    return {
      html: solution.response,
      cookies: solution.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
      cookieMap,
      userAgent: solution.userAgent
    };
  }
});
```

> The raw `ctx.puppeteer` API is still available on Node for flows that need a live page (e.g. a
> network listener that captures a `.m3u8`).
