# ⚙️ Configuration

<table>
<thead>
<tr>
<th>Option</th>
<th>Type</th>
<th>Default</th>
<th>Description</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>source</code></td>
<td><code>GithubSource | LocalSource | RegistrySource</code></td>
<td>—</td>
<td><strong>Required.</strong> Where to load your plugins from.</td>
</tr>
<tr>
<td><code>debug</code></td>
<td><code>boolean</code></td>
<td><code>false</code></td>
<td>Turn on detailed logging.</td>
</tr>
<tr>
<td><code>strict</code></td>
<td><code>boolean</code></td>
<td><code>false</code></td>
<td>Throw errors for bad plugins instead of just skipping them.</td>
</tr>
<tr>
<td><code>lazy</code></td>
<td><code>boolean</code></td>
<td><code>false</code></td>
<td>Return lazy source handles (no <code>playlist</code>) from <code>getStreams</code> by dispatching to each provider's <code>getLazyStreams</code> (falls back to <code>getStreams</code>). Resolve a handle on play with <code>resolveLazySource</code>. See <a href="./LAZY_SOURCES.md">Lazy sources</a>.</td>
</tr>
<tr>
<td><code>autoUpdateIntervalMinutes</code></td>
<td><code>number</code></td>
<td><code>15</code></td>
<td>How often to refresh remote providers (min: 5).</td>
</tr>
<tr>
<td><code>cache.enabled</code></td>
<td><code>boolean</code></td>
<td><code>false</code></td>
<td>Turn on result caching.</td>
</tr>
<tr>
<td><code>cache.TTL</code></td>
<td><code>number</code></td>
<td><code>0</code></td>
<td>How long to keep cached results (in ms).</td>
</tr>
<tr>
<td><code>cache.MODULE_TTL</code></td>
<td><code>number</code></td>
<td><code>900000</code></td>
<td>How long to keep loaded provider modules in cache (15 min).</td>
</tr>
<tr>
<td><code>cache.TMDB_TTL</code></td>
<td><code>number</code></td>
<td><code>0</code></td>
<td>How long to cache TMDB API responses (in ms). Helps avoid hitting the TMDB API too hard. Set to e.g. <code>3600000</code> (1 hour) to cache responses.</td>
</tr>
<tr>
<td><code>cache.maxEntries</code></td>
<td><code>number</code></td>
<td><code>10000</code></td>
<td>Maximum number of entries in the in-memory cache. Oldest entries are evicted when the limit is reached (LRU).</td>
</tr>
<tr>
<td><code>tmdbApiKeys</code></td>
<td><code>string[]</code></td>
<td>—</td>
<td><strong>Required.</strong> Array of TMDB API keys. A random key is selected for each request to distribute load.</td>
</tr>
</tbody>
</table>

### Scrape Configuration

<table>
<thead>
<tr>
<th>Option</th>
<th>Type</th>
<th>Default</th>
<th>Description</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>scrapeConfig.concurrentOperations</code></td>
<td><code>number</code></td>
<td><code>5</code></td>
<td>How many providers can run at the same time.</td>
</tr>
<tr>
<td><code>scrapeConfig.maxAttempts</code></td>
<td><code>number</code></td>
<td><code>1</code></td>
<td>How many times to retry a failing provider.</td>
</tr>
<tr>
<td><code>scrapeConfig.operationTimeout</code></td>
<td><code>number</code></td>
<td><code>15000</code></td>
<td>Max time before giving up on a scrape (15 sec).</td>
</tr>
<tr>
<td><code>scrapeConfig.successQuorum</code></td>
<td><code>number</code></td>
<td><code>undefined</code></td>
<td>Stop once this many providers have succeeded.</td>
</tr>
<tr>
<td><code>scrapeConfig.waitForActiveProvidersAfterQuorum</code></td>
<td><code>boolean</code></td>
<td><code>false</code></td>
<td>After <code>successQuorum</code> is reached, wait for providers already running in active concurrency slots to finish before resolving. Queued providers are still cancelled immediately.</td>
</tr>
<tr>
<td><code>scrapeConfig.errorThresholdRate</code></td>
<td><code>number</code></td>
<td><code>0.7</code></td>
<td>Error rate that triggers auto-disable (70%).</td>
</tr>
<tr>
<td><code>scrapeConfig.minOperationsForEvaluation</code></td>
<td><code>number</code></td>
<td><code>10</code></td>
<td>How many scrapes before checking if a provider is healthy.</td>
</tr>
<tr>
<td><code>scrapeConfig.puppeteer.maxConcurrentBrowsers</code></td>
<td><code>number</code></td>
<td><code>2</code></td>
<td>Global cap for real Puppeteer browser processes. Matching requests reuse an existing browser as a new tab whenever possible.</td>
</tr>
<tr>
<td><code>scrapeConfig.puppeteer.minWarmBrowsers</code></td>
<td><code>number</code></td>
<td><code>0</code></td>
<td>Minimum number of idle browsers to keep warm for each browser configuration signature that has already been used.</td>
</tr>
<tr>
<td><code>scrapeConfig.puppeteer.idleBrowserTTL</code></td>
<td><code>number</code></td>
<td><code>60000</code></td>
<td>How long an idle pooled browser stays alive before it is closed, unless it is still needed to satisfy <code>minWarmBrowsers</code>.</td>
</tr>
<tr>
<td><code>scrapeConfig.puppeteer.maxBrowserSessionTTL</code></td>
<td><code>number</code></td>
<td><code>120000</code></td>
<td>Maximum time a single page lease may stay open before it is automatically released and a warning is logged. Guards against providers that forget to call <code>browser.close()</code>.</td>
</tr>
</tbody>
</table>

When a provider calls <code>ctx.puppeteer.launch(...)</code>, the manager now leases a tab from a shared browser pool. Calling the returned <code>browser.close()</code> releases that tab back to the pool; calling <code>manager.destroy()</code> closes the real browser processes. If a provider forgets to release its tab, the pool will auto-release it after <code>maxBrowserSessionTTL</code> (default 2 minutes) and log a warning.

By default, <code>successQuorum</code> resolves immediately once enough providers return results. Enable <code>waitForActiveProvidersAfterQuorum</code> if you want the manager to keep waiting for providers that were already running when quorum was reached, while still cancelling anything that had not started yet.

---

<br />

## 📊 Metrics & Health Monitoring

The manager keeps track of how each provider is doing and can **automatically turn off** unhealthy ones:

```typescript
// Raw metrics map
const metrics = manager.getMetrics();
for (const [scheme, m] of metrics) {
	console.log(`${scheme}: ${m.successes} ok, ${m.errors} err`);
}

// Detailed health report
const report = manager.getMetricsReport();
report.forEach((r) => {
	console.log(`${r.moduleName}: ${r.totalOperations} ops, ` + `${(r.errorRate * 100).toFixed(1)}% errors, ` + `active=${r.active}`);
});
```

Providers that fail too often (more than `errorThresholdRate` after `minOperationsForEvaluation` scrapes) get turned off and won't be used again until the manager is reloaded.

---

<br />


---

## Proxy

Route provider requests through a proxy. Configure a **default** on the manager; a scrape
request can override it via `proxy`. Proxy config is host-owned — providers / `ctx.xhr` never
receive proxy credentials.

A single `proxy` field takes one of two shapes:

- **Proxy agent** — `{ agent, auth? }`. Routes through an http/https/socks agent; `auth` is sent
  as a `Proxy-Authorization` header (URL-embedded `user:pass@` creds work through the agent).
- **URL resolver** — `{ resolver, headers? }`. Rewrites each request to a proxy endpoint that
  fetches the target for you (e.g. a web proxy that takes the target as `?url=`). `resolver(url,
  { method, headers, body })` receives the **target** request (method, UA/Referer/cookies, body) so
  it can encode them into the endpoint however the proxy expects, and returns the endpoint URL.
  The actual request to that endpoint is a plain **`GET`** carrying **only** the resolver's own
  `headers` (its API key/auth) plus the abort signal — the target headers/method/body are never put
  on the wire, only handed to the resolver.

```typescript
import { HttpsProxyAgent } from "https-proxy-agent";

// Agent-based
const manager = await GrabitManager.create({
  source: { /* … */ },
  proxy: {
    agent: new HttpsProxyAgent("http://user:pass@proxy.example:8080"),
    auth: "Bearer <token>" // optional Proxy-Authorization header
  }
});

// Resolver-based (URL-rewriting web proxy)
const manager2 = await GrabitManager.create({
  source: { /* … */ },
  proxy: {
    resolver: (url) => `https://proxy.example/get?url=${encodeURIComponent(String(url))}`,
    headers: { "x-api-key": "<token>" }
  }
});

// Per scrape request — overrides the default; falls back to it when omitted:
await manager.getStreams({ media, targetLanguageISO: "en", proxy });
```

The engine applies the proxy to every provider request via the requester — an agent proxy sets
the dispatcher (and `Proxy-Authorization` when `auth` is set); a resolver proxy rewrites the URL
and attaches its `headers`. Only agent proxies also apply to `ctx.puppeteer` (browser) sessions.
