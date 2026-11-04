# Data loading improvements — 2026-09-15

> Note (2026-10): the data gate Worker described here was retired; see
> [edge protection](EDGE_PROTECTION.md) for the current data-host protection.

## Implemented behavior

The existing-source expression survey now uses a dedicated lossless gene index.
An initial lookup fetches one immutable source/sample manifest and the bucket for
the requested gene. All selected populations and tissues share these two requests;
repeating the gene needs no additional data requests during that session. Adding a
source already covered by the manifest does not download its full track.

| Igf1r across four whole-hypothalamus studies | Before | After |
| --- | ---: | ---: |
| Data objects | 4 full tracks | 1 manifest + 1 gene shard |
| Decoded bytes | 17,857,800 | 183,159 |
| Local gzip level 6 bytes | 4,948,561 | 62,429 |

This is a **98.74% reduction in estimated compressed data bytes**. The comparison
excludes app code and HTTP overhead and is not a production latency measurement.
The same index shard covers all 31 curated existing sources, including nondefault
tracks. NeuroSeq continues to use its previously validated separate source import.

## Fidelity and publication safety

The retained [validation evidence](../data/expression/existing/validation.json)
records 534,346 feature rows and **5,785,609 exact finite sample values**, with zero
numerical difference. Every normalized source query matches the full-track adapter;
raw sample identities are independently aligned. Fourteen ambiguous source keys
retain their original candidate order. Missing data, measured zero, RNA fractions,
conditions and measurement units retain their existing meanings.

Build IDs derive from content, without timestamps. Immutable URLs and globals carry
the full SHA-256 identity. Both index builders retain old generations, reject a
conflicting immutable write and update the mutable pointer after complete output.
The app pins its expression generation and refuses mismatches without falling back
to whole-track downloads.

## Uploads

The R2 publisher reads fresh origin metadata and skips only objects matching the
stored-byte MD5, size and all relevant HTTP metadata. This catches metadata-only
cache/compression changes as well as content changes. A verified local Brotli cache
avoids repeated compression. Current manifests select the query generations to
publish; historical local generations do not create unnecessary uploads.

All payloads must verify at R2 before either mutable pointer is published. A failed
upload withholds pointers; a rerun resumes using the current remote inventory.
An unchanged run issues no PUT requests. Account/bucket locking prevents overlapping
local publishers, while cross-host publishers still require CI serialization.
No remote deletion or purge is part of this change.

Read-only checks against the real R2 API verified an existing metadata object was
unchanged and produced zero PUT callbacks. The new expression generation needs
514 initial objects / 24,090,848 stored bytes (24.1 MB); repeated preparation reused
all 514 verified compressed files. No objects were uploaded during these checks.
[Retained remote comparison](../data/performance/r2-incremental-verification-2026-09-15.json).

## Cache correction

The previous live pointer response advertised four hours despite five-minute R2
metadata. The data gate now sets both outgoing browser/CDN headers and the upstream
edge-cache policy to 300 seconds for the two mutable pointers. Its internal cache
key isolates old entries and shares requests across client version variants.
Error/redirect responses are not cached. Immutable objects keep their long TTLs,
streaming bodies, ETags, compression and conditional request behavior.

The service-worker pointer policy also changed from seven days to 300 seconds.
Version 0.14.2 changes mutable browser URLs; a gate deployment cannot invalidate
responses already held by a browser using an older app. The expression reader
avoids this pointer entirely by loading its app-pinned immutable manifest.

Cloudflare documents the underlying mechanisms in its
[Worker fetch cache properties](https://developers.cloudflare.com/workers/runtime-apis/request/#the-cf-property-requestinitcfproperties)
and [Worker/cache-rule precedence](https://developers.cloudflare.com/cache/interaction-cloudflare-products/workers-cache-rules/).

## Validation and rollout status

- Full expression rebuild/check: exact sample fidelity and deterministic products.
- Full existing query rebuild: current data reproduced while preserving expression
  files and older immutable generations.
- Reader tests: all 31 sources match original tracks, concurrent requests share two
  objects, repeats make no new request, invalid data fails closed, retries work.
- Publication tests: no-op runs, changed metadata, compression reuse/corruption,
  partial failures, pointer ordering, remote changes and local locking.
- Worker tests: stream preservation, five-minute policies, HEAD/304 responses,
  uncached errors and unchanged admission controls; typecheck and deployment dry run.
- Browser: Igf1r in bulk hypothalamus and arcuate tissue; Lepr across 18 genetically
  defined source records. Results loaded successfully with no console errors.
- App/script TypeScript checks and focused lint; an off-origin Vite production build
  passed with the R2 URL, pinned expression build and generated service worker.

The Vite build validates app compilation, not the broader historical scientific
prebuild chain. Previously reported missing ignored evidence archives and historical
fingerprint mismatches remain outside this loading change.

These implementation changes are local. The Cloudflare checks were read-only;
the new index and cache Worker have not been published. Publish data before the
app that references it, then deploy the gate and verify both live pointers. The
[delivery runbook](agent-context/delivery.md) contains the exact commands.
