# Build and delivery

The [package scripts](../../package.json) define the canonical command chains.
`pnpm run build` is `vite build` alone: this repository has no prebuild hook, and
the scientific checks (`check:*`) are separate commands, most of which need
retained inputs that are not here. The build needs the gitignored query catalog in
`public/query/` (`pnpm run fetch:query` or `pnpm run prepare:deploy`).
`pnpm run deploy:dist` builds and precompresses delivery assets.
The app CI workflow runs type checks, lint, `deadcode` (knip), `context:check`, tests and a
built-site Chromium smoke check. It fetches the query catalog and the reference
atlases from the live origins instead of building them, so it checks the app
against the published data, not the data itself. The [publication release procedure](../PUBLICATION_RELEASE.md)
documents citation, licensing, exact release identity and local archive packaging.
`verify:release` rejects an app built from different source or data, even if its
version is unchanged. `verify:deploy` compares that identity with `/release.json`
on the deployed site. Exports carry the same identity.
`pnpm run build:agent-export` packages every dataset's published bundle results
as plain CSV with agent instructions, for a manual Zenodo deposit linked from
`/methods/`. It reads `public/datasets/` and writes only the ignored
`dist-export/`; see the [agent export runbook](../AGENT_EXPORT.md).
For app-only TypeScript validation use `pnpm exec tsc -p tsconfig.json --noEmit` and
`pnpm exec tsc -p tsconfig.node.json --noEmit`. Both are incremental; delete the
ignored `.tmp/tsc/` to force a full check.

`pnpm run check:bundle-eol` requires every tracked file that
`.gitattributes` marks `-text` or `eol=lf` (dataset bundles, retained sources,
replay tables, DE results and evidence ledgers; Git LFS files excepted) to carry
its committed line endings, because the evidence and expression ledgers pin those
exact bytes. `text=auto` files are exempt, since `core.autocrlf` may write them as
CRLF. A checkout made before a file became `-text` or `eol=lf` can hold CRLF
copies that `git status` reports clean and a plain `git checkout` leaves in place;
five replication sources and 244 files of the September 11 scientific snapshot
were once pinned in exactly that state. `pnpm run restore:bundle-eol` restores copies that
differ only in line endings and reports any with a real edit. The gate compares
file sizes first, so it stays a few seconds. The expression-index builder refuses
to pin such an input rather than record a checksum no other checkout reproduces.

The site is an assets Worker configured in [wrangler.jsonc](../../wrangler.jsonc).
`pnpm run deploy:cf` runs `prepare:deploy`, `deploy:dist`, `verify:release`,
`wrangler deploy` and `verify:deploy`; `deploy:cf:dry` stops at
`wrangler deploy --dry-run`. [prepare_deploy.mts](../../scripts/prepare_deploy.mts)
fetches the gitignored inputs the build ships (query catalog, tracker catalog,
reference atlases) when they are missing, keeps complete local atlases, and stops
when the local query pointers differ from the data origin's, because the app
would pin an index R2 does not serve (`--refresh-query` takes the origin's).
`verify:release` fails when `dist/` lacks an atlas file or the tracker catalog,
and `verify:deploy` checks that the live site serves them. Keep the
assets-only site on native Cloudflare delivery.

The R2 custom domain `data.hypoexplorer.com` serves bundles directly; no Worker
sits in front of it (the earlier data gate Worker was retired in 2026-10). R2
egress is free, so the cost to bound is Class B reads on edge-cache misses.
[Edge protection](../EDGE_PROTECTION.md) documents the data host's edge cache
and WAF rules, the cache purge after an upload, and the scheduled spend guard
Worker that blocks the data host when month-to-date Class B reads reach
8,000,000 (the free allowance is 10 million per month).

Dataset bundles and the query indexes are published together by `upload:bundles`;
inspect [the uploader](../../scripts/upload_bundles_r2.mts) before use. It refuses
bundles restored from the public data release (`fetch:data`, `data:offline`),
whose KEGG collections and macaque per-animal CPM are emptied: the marker
`fetch:data` writes, the release's `KEGG_NOT_INCLUDED.md`, an empty macaque `cpm`
or an all-empty KEGG corpus stops every mode, dry runs included
([the checks](../../scripts/lib/publicDataRelease.mts)). `--allow-reduced-bundles`
overrides it. The expression
survey has a separate exact-value index: `pnpm run build:expression-index` builds it
and `pnpm run check:expression-index` verifies the full retained corpus. Both index
builders retain previous immutable generations, reject conflicting writes and
publish their local pointers last. Vite pins the expression manifest's build ID.

Expression-only NeuroSeq and GSE147092 OXT reference products under
`public/expression/` remain site assets. They do not enter the R2 expression index
or receive a synthetic registered contrast. The OXT source import and offline
full-value replay are `pnpm run build:expression-reference` and
`pnpm run check:expression-reference`, a separate check that the build does not run.
The GTEx, HPA and Allen reference-atlas products under
`public/expression/{gtex,hpa,allen-human}/` are site assets too, but they are
gitignored and generated. `pnpm run build:expression-external` writes about
230 MB in 8,198 JSON files and replays every value; it needs retained source
downloads (the GTEx GCT and the Allen expression extracts among them) that are not
in this repository. Without them,
`pnpm run fetch:expression` (and `prepare:deploy`, for any atlas that is missing)
copies the deployed products from hypoexplorer.com. A deploy uploads
these files as Workers static assets; nothing goes to R2. They are most of
`public/`'s 9,800 files. A Workers Free version is capped at 20,000 asset files,
so measure the file count before adding another provider. The `.br`/`.gz` sidecars
stay out of the upload (`public/.assetsignore`) and do not count.
The separate `check:oxt-avp` check covers the admitted GSE65663 dataset's
bundles and current intake audit. Reproduce its R4.6 analysis through the
[intake runbook](../../data/intake/oxt-avp-2026-10-19/README.md) when inputs or
producer code change; the application build does not run a statistical refit.

The [incremental publisher](../../scripts/lib/r2Incremental.mts) compares a fresh
R2 inventory with the actual stored-byte MD5, size and HTTP metadata. Unchanged
objects are skipped; verified compressed bytes are reused locally. A no-op run
performs metadata reads and zero PUTs. Only current referenced query generations
are candidates for upload; old remote objects are retained. Non-MD5 remote ETags
cannot authorize a skip. The publisher verifies every required payload at R2 before
writing either mutable pointer, then verifies the result. Failed uploads withhold
pointers and a rerun skips the objects that already succeeded.

Use `pnpm run upload:bundles --remote-dry-run --env-file .env.local` for a
read-only remote comparison; `.env.local` must set `CLOUDFLARE_ACCOUNT_ID`
beside the R2 token. With `--env-file .env.cfdeploy` the R2 inventory answers
HTTP 401. Add `--expression-only` to limit it to the current
expression generation and its pointer. Omit `--remote-dry-run` only for an
authorized publication. Offline `--dry-run` makes no remote requests. The source
checks remain enabled; `--skip-index-check` is only for a rerun already verified
in the same session. The ignored compression cache is `.wrangler/r2-upload-cache/`.
The account/bucket lock excludes other local publishers; CI must also serialize
publishers on different hosts. Concurrent remote changes are detected, but the REST
check-and-write sequence is not a distributed atomic transaction.

The uploader stores `public, max-age=300` on `/query/tracks.js` and
`/query/expression-manifest.js`, the only mutable objects, and year-long
immutable caching on everything else. The service worker also limits mutable
pointers to 300 seconds. App version 0.14.2 changes their browser URLs to escape
previously cached responses. The edge lifetime of the pointers follows the edge
cache rules and the post-upload purge described in
[edge protection](../EDGE_PROTECTION.md).
`public/query/` is generated and ignored. Off-origin builds remove dataset,
query and QC trees from site assets; the tracker catalog stays origin-relative.
Prerendered public documents are real assets, and service-worker navigation
fallback is scoped to the root document. Updates stay prompt-gated
(`registerType: 'prompt'`, no `skipWaiting`), while `clientsClaim` lets an
activated worker control tabs that had no controller. `applyWaitingWorker()` in
`src/pwa/registerUpdates.ts` reloads on `controllerchange`, reloads plainly when
the update's worker is already active, and falls back to `forceRefresh()` after
an 8-second watchdog.

The [brand guide](../../brand/README.md) identifies the approved raster masters
and regeneration command. Header art and browser/app icons ship from
`public/brand/v1/`; the PWA precaches them with the shared brand CSS. Confirm
the root document and public pages both emit the shared icon links, and check
`dist/manifest.webmanifest` when changing installed-app icons.

Run only the commands required by the task. Deployment and uploading change
external state and require task authorization. Inspect current site responses,
version, edge rule state and uploader verification output to establish success.
Passing context checks establishes documentation freshness, not delivery health.

The [September 15 loading audit](../DATA_LOADING_AUDIT_2026-09-15.md) records baseline
payload measurements; [the implementation report](../DATA_LOADING_IMPLEMENTATION_2026-09-15.md)
records the changes and their validation. Immutable
query objects use their data build ID alone as the browser cache key. Mutable
dataset filenames, metadata, nomenclature and query pointers use the first 32
hexadecimal characters of the release fingerprint as their `?v=` cache key,
so a same-version release cannot reuse an earlier generation's cached data.
Unverified development/test builds retain the app-version fallback.

## HypoMap atlas

The HypoMap views are build-flagged and off: `VITE_HYPOMAP_EXPRESSION` and
`VITE_HYPOMAP_COEXPRESSION`. When on, they read the atlas pinned in
[hypomap-release.json](../../hypomap-release.json) from
`${VITE_BUNDLE_BASE_URL}/hypomap/<tag>/` ([atlas.ts](../../src/search/hypomap/atlas.ts)).
Hosted builds are off-origin, so the atlas lives in R2. `pnpm run fetch:hypomap`
installs it in the ignored `public/hypomap/<tag>/`. A full `upload:bundles`
publishes it when that directory exists. `--hypomap-only` publishes only the atlas
and skips the dataset, query and QC trees and their checks. The uploader reads only
the pinned tag. Before any remote request it checks `manifest.json` against
`manifestSha256` and every listed file against the manifest's size and SHA-256
([hypomapAtlas.mts](../../scripts/lib/hypomapAtlas.mts)). Off-origin builds also
remove `dist/hypomap/`. The atlas cannot be served same-origin from Workers static
assets, because `public/.assetsignore` excludes `*.gz`. Only the Vite dev server
serves it from `public/`. Co-expression also calls `/hypomap-preview-api/`, which
only the offline dev server proxies to the loopback service in `services/hypomap/`.
The steps below therefore make the expression view deliverable, not co-expression.

Every atlas object is immutable under its tag. The uploader stores the `.json.gz`
files unchanged, with `Content-Type: application/gzip` and no `Content-Encoding`.
R2 returns the HTTP metadata stored with an object, and Cloudflare does not
compress `application/gzip`, so `fetch()` returns the gzip bytes. `atlas.ts` checks
them against the manifest's SHA-256 and decompresses them. If an object were stored
with `Content-Encoding: gzip`, for example by a manual upload, the browser would
decode it before `fetch()` returned. `atlas.ts` would still parse the JSON, but it
would skip that file's checksum, because it verifies only gzip bytes.
`manifest.json` follows the uploader's brotli rule for text; it is checked against
`manifestSha256` after decoding either way. This follows from the uploader and
`atlas.ts`, not from a live response. The atlas has not been uploaded, and the
current path rule blocks `/hypomap/`.

The spend guard counts Class B operations for the whole bucket, and the shutoff
rule blocks the whole data host, so atlas reads are covered without a change. A
gene lookup reads the manifest, metadata and search index once, then one shard.

`atlas.ts` reads with `fetch()`, so the bucket needs a CORS policy for the app
origins whatever `VITE_BUNDLE_CORS` says:

```json
{ "rules": [ { "allowed": { "origins": ["https://hypoexplorer.com", "https://www.hypoexplorer.com"], "methods": ["GET", "HEAD"] } } ] }
```

R2 CORS applies to the whole bucket. It does not change how bundles load; they
stay script tags until `VITE_BUNDLE_CORS` is set, which is a separate decision. The
data host caches every response, and R2's documentation says cached objects keep
their CORS headers until they are refreshed. It is not verified whether a response
first cached for a request without `Origin` (a crawler, `curl`) or for the other
app origin is later served to the app without a matching
`Access-Control-Allow-Origin`. `pnpm run verify:edge --hypomap` tests the
no-`Origin` case; run it again with `APP_ORIGIN=https://www.hypoexplorer.com`. If
either fails, add a response header transform rule on `data.hypoexplorer.com`
for `starts_with(http.request.uri.path, "/hypomap/")` that sets
`Access-Control-Allow-Origin: *`, and purge `data.hypoexplorer.com/hypomap/<tag>/`.
The atlas is public and read without credentials. `edge:apply` does not manage
transform rules, so that rule is added by hand.

To publish an atlas tag, in order:

1. Publish the release asset named in `hypomap-release.json`, then run
   `pnpm run fetch:hypomap`.
2. `pnpm run edge:apply`. The dry run should show updates to
   `hypoexplorer_data_paths` and `hypoexplorer_data_burst` only. Then run
   `pnpm run edge:apply --apply` and `pnpm run verify:edge`.
3. Write the CORS policy above to a file and run
   `pnpm exec wrangler r2 bucket cors set hypoexplorer-datasets --file <file>`.
4. `pnpm run upload:bundles --hypomap-only --remote-dry-run --env-file .env.local`,
   then the same command without `--remote-dry-run` for the authorized upload. It
   purges `hypomap/<tag>/`.
5. `pnpm run verify:edge --hypomap`, once for each app origin.
6. Only then decide whether a hosted build turns on `VITE_HYPOMAP_EXPRESSION`.

A new tag repeats steps 1, 2, 4 and 5, because the path rule names the tag.
