# Data loading and R2 audit — 2026-09-15

This document preserves the pre-index audit baseline. The subsequently implemented
index, incremental uploader and cache corrections are documented in
[the implementation report](DATA_LOADING_IMPLEMENTATION_2026-09-15.md).

> Note (2026-10): the data gate Worker described here was retired; see
> [edge protection](EDGE_PROTECTION.md) for the current data-host protection.

## Conclusion

Compression, CDN caching, conditional responses and in-session request deduplication
already work. The largest remaining opportunities are a lossless per-gene index for
the new expression survey and incremental R2 publication. Increasing compression
alone will not remove the unnecessary whole-track downloads.

This audit reviewed the working checkout, sampled public production responses and
checked the expression UI in the browser. Local improvements are listed below;
no bucket objects, Cloudflare settings or deployments were changed. This is not a
Lighthouse/Core Web Vitals measurement or an account-wide traffic/cost analysis.

## Delivery paths

- Existing study data and query indexes: browser → data-gate Worker → Cloudflare
  cache → R2 on a cache miss. The Worker retains request admission and daily-budget
  enforcement before forwarding; its Durable Object uses token leases.
- NeuroSeq: same-origin static JSON shipped with the application assets. It is
  currently outside R2, the R2 uploader and the data gate.
- Successful bundle requests share promises and values within the browser session.
  Dataset/query service-worker caches retain successful responses between visits.
- Gene searches and exports compute locally. The expression flow sends no uploaded
  expression matrix or exported file to the server. Publication uploads are a
  separate operator workflow.

## Measured download footprint

Decimal bytes, for the selected data only; application JavaScript, metadata already
loaded elsewhere, protocol overhead and request headers are excluded. Gzip-6 values
are local estimates on the same files, **not observed R2 transfer sizes**. Production
may negotiate Brotli. Results describe the cold data path; warm successful values
are reused within the session.

| Survey | Data requests | Decoded bytes | Estimated gzip bytes |
| --- | ---: | ---: | ---: |
| NeuroSeq, Lepr | 3 JSON files | 4,118,364 | 479,643 |
| Whole hypothalamus, Igf1r | 4 full tracks | 17,857,800 | 4,948,561 |
| AgRP across studies | 3 tracks + 3 NeuroSeq JSON files | 12,582,843 | 3,058,572 |
| All 31 existing source records | 29 distinct tracks | 119,765,082 | 35,159,308 |

NeuroSeq's manifest is 48,474 bytes, gene directory 4,006,871 bytes and Lepr shard
63,019 bytes. Most of that first-query cost is the directory. Its entire collection
is 259 JSON files / 17,777,289 bytes; it is not all downloaded for one gene.
Exact paths, source hashes and compression estimates are retained in
[the byte census](../data/performance/loading-audit-2026-09-15.json).

The existing-source adapter correctly omits pathways, but still downloads full
DE tables and expression arrays for every gene in each selected track. One requested
gene costs the same track bytes as twelve. Four displayed Igf1r rows contain only
582 bytes of expression data.

### Highest-value data improvement: lossless gene shards

A local 512-bucket sketch for Igf1r across all 29 tracks measured 151,541 bytes of
JSON (52,649 gzip), plus 15,034 bytes of sample scaffolding (2,680 gzip). Approximately
55.3 KB gzip could therefore answer the current four-study query that takes 4.95 MB:
about **98.9% less estimated transfer**. This is a measured design sketch, not an
implemented endpoint or measured browser latency. At 10 Mbit/s, those payloads alone
have transfer floors of roughly 4 seconds and 44 milliseconds; latency, parsing and
rendering are additional.

Use a separate immutable expression index, with a small source/sample manifest,
symbol/stable-ID resolution and gene shards containing the exact stored numeric
arrays. Preserve ambiguous identifiers, sample order, all selected tracks, RNA
fractions, conditions, species and stored units. Validate every emitted sample
value against the current bundle adapter before switching readers.

The ordinary cross-dataset expression index is **not a drop-in replacement**: it
rounds to four significant digits and indexes only default tracks. Three selected
expression tracks are non-default. Using it directly would reduce fidelity or
silently omit sources.

## Live cache observations

Small public probes observed gate mode `enforce`, Brotli compression and CDN hits.
Two metadata GETs each returned 2,296 bytes; an ETag conditional GET returned 304
with no body. A representative track HEAD changed from MISS to HIT and reported a
444,241-byte Brotli representation; gzip-only and identity negotiation also worked.
These observations cover sampled responses, not every object or edge location.
Two subsequent tiny metadata GETs measured 622.7 ms on a new connection and
72.8 ms on the reused connection, both CDN HIT and 2,296 compressed bytes.
These are HTTP request durations, not browser page speed or pure network RTT.
[Retained public response evidence](../data/performance/r2-cache-audit-2026-09-15.json).

The mutable `/query/tracks.js` pointer returned `Cache-Control: public,
max-age=14400` (four hours), while the uploader specifies 300 seconds. This can
retain an old index after a data publication. Cloudflare's Browser Cache TTL can
override a shorter origin lifetime, so inspect the effective data-host rule and use
Respect Existing Headers for the pointer. The cause is a hypothesis supported by
the observed header and [Cloudflare's documented TTL behavior](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/).

The user approved read-only account verification. Existing credentials returned
401/403, so account rules and Smart Tiered Cache status could not be established.
No credential contents were printed and no settings were changed. The public
four-hour lifetime remains confirmed independently of that limitation.

Keep the current budget gate in place. Caching in front of its admission decision
would bypass the request budget. Prefer verifying Smart Tiered Cache for the
existing `fetch()` origin path, rather than adding a redundant local Cache API
layer. [R2 caching guidance](https://developers.cloudflare.com/r2/buckets/public-buckets/#caching)
and [Worker cache behavior](https://developers.cloudflare.com/workers/reference/how-the-cache-works/).

R2 egress is free; fewer bytes primarily help readers, while cache hits reduce
R2 read operations. GET/HEAD requests that reach R2 are Class B operations. A
client HEAD has no response body but can still cause a full upstream cache fill.
[R2 pricing](https://developers.cloudflare.com/r2/pricing/) and
[HEAD cache behavior](https://developers.cloudflare.com/cache/concepts/cache-behavior/).

## Publication footprint

| R2 upload inventory | Objects | Source bytes before compression |
| --- | ---: | ---: |
| Datasets | 944 | 1,161,854,574 |
| Query index | 1,444 | 448,027,068 |
| QC PDFs | 60 | 134,561,892 |
| Total | 2,448 | 1,744,443,534 |

The uploader recompresses and PUTs every selected object on every full run. It
does not skip unchanged content. Actual uploaded bytes are lower than this raw
inventory because text objects use Brotli.

Implement incremental publication using content **and HTTP metadata** hashes,
keyed by target bucket and object key. Verify a remote publication manifest rather
than trusting an unverified local cache. Upload changed objects, await success,
then publish pointers and the new synchronization manifest. An unchanged release
could avoid 2,448 data PUTs and their payload, using a small manifest read. Cache
compressed bytes by source hash and compression settings to avoid repeating
quality-11 CPU work. Handle partial failures, concurrent publishers and missing
remote objects explicitly. This larger synchronization change remains proposed.

Cloudflare static-asset deployment already compares content hashes and requests
only missing assets; moving NeuroSeq into R2 would not itself improve publication.
[Static asset upload behavior](https://developers.cloudflare.com/workers/static-assets/direct-upload/).
Locally measured NeuroSeq Brotli-11 compression is 1,019,396 bytes across the entire
collection (94.3% smaller); this is not a live compression measurement.

`precompress_dist.mts` produces sidecars that Cloudflare's asset upload excludes.
That costs local build time, with no live Cloudflare transfer benefit; keep it only
where the rollback/verification workflow needs it. The current local `dist/` is a
same-origin build; deployment must use the intended off-origin data configuration.

## Local improvements from this audit

1. **Defer expression values until requested.** Opening the survey or catalog
   fetches source metadata without automatically downloading the Lepr directory
   and value shard. Survey and example buttons submit the query.
2. **Bound and cancel queued work.** At most four expression source loads start
   together. Leaving/changing a query prevents its unstarted source loads from
   beginning. Shared requests already in flight can finish and populate their
   cache safely; the UI ignores obsolete results.
3. **Reuse immutable query URLs across UI releases.** Query objects with a data
   build ID in their path no longer receive an extra app-version query string.
   Mutable dataset filenames, the query pointer and legacy query layouts retain
   version invalidation. Fetch and script fallback use the same URL.
4. **Publish the query pointer after successful uploads.** The pointer is excluded
   from the concurrent work queue and published only when every required upload
   succeeds. Sorting it last alone did not provide that guarantee.
5. **Check the live pointer TTL.** The gate verifier now checks for at most five
   minutes and rejects `immutable`; the current live four-hour response fails
   this intended contract. The check detects the issue and does not change it.
   Run `npm run verify:gate -- --pointer-only` for a single bounded public HEAD
   without reading account credentials or issuing the larger gate probe suite.

## Remaining priorities

1. Build and validate the lossless expression index described above.
2. Add verified incremental R2 uploads and compressed-output reuse.
3. Correct the live pointer cache policy and verify Smart Tiered Cache with an
   account credential that has permission to read the relevant settings.
4. Give NeuroSeq immutable content-addressed assets and a dedicated bounded
   persistent cache, then replace its full directory with a smaller lookup index.
   Its current session cache works, but `cache: 'no-cache'` and the absence of an
   expression service-worker rule cause revalidation across page visits. Do not
   simply freeze mutable JSON paths without a data-version contract.

Scientific expression values, provenance and source precision remain unchanged.

## Validation of the local changes

- 113 tests passed across the expression UI/readers/routes, bundle transports,
  query index, upload publication barrier and gate rules.
- Both app and script TypeScript checks and scoped Biome lint passed.
- The browser showed an idle initial survey and idle tissue selection, then the
  same four Igf1r study results after submission. NeuroSeq Lepr also completed;
  exports became available and the browser reported no errors.
- The 20 context-tool tests passed. Maintained maps and reviews accompany the
  source and report changes.
- The single-request live pointer verifier returned HTTP 200 with max-age=14400
  and correctly failed the five-minute contract. That configuration issue is
  unresolved; the local code changes have not been deployed.

Focused test command:

```powershell
npx vitest run src/__tests__/expressionSurveyView.test.tsx src/__tests__/neuroseqExpression.test.ts src/__tests__/existingExpression.test.ts src/__tests__/expressionRoute.test.tsx src/__tests__/bundleProgress.test.ts src/__tests__/bundleSource.test.ts src/__tests__/queryIndex.test.ts src/__tests__/uploadPublication.test.ts src/__tests__/dataGateRules.test.ts --maxWorkers=2 --minWorkers=1
```
