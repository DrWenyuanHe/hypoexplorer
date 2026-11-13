// Bulk-upload public/datasets/** to a Cloudflare R2 bucket via wrangler, so the
// HypoExplorer app can serve its data bundles off-origin instead of from the app
// host. Flip the app over by setting VITE_BUNDLE_BASE_URL to the bucket's public
// URL (see the BUNDLE_BASE comment in src/data/datasets.ts) — no code changes.
//
// Object keys mirror the app's request paths EXACTLY. The loaders fetch
//   `${bundleBaseUrl}/datasets/<id>/<file>`  (loadDatasetMeta.ts, loadTrack.ts)
// so a local file  public/datasets/<id>/<file>  must land at R2 key
//   datasets/<id>/<file>     ← key is relative to public/, NOT public/datasets/.
//
// Auth: Wrangler resolves/refreshes API or OAuth credentials; the current token
// is captured only in memory for the official metadata-list API. R2 read/write
// permission is required. The account comes from CLOUDFLARE_ACCOUNT_ID or the
// repository's wrangler.jsonc. S3 access keys are a different credential type.
//
// Usage:
//   npm run upload:bundles                      # upload public/{datasets,query,qc}
//   npm run upload:bundles -- --dry-run         # list keys, upload nothing
//   npm run upload:bundles -- --remote-dry-run  # compare origin metadata, 0 PUTs
//   npm run upload:bundles -- --expression-only # new expression index + pointer
//   npm run upload:bundles -- --env-file .env.cfdeploy # explicit Wrangler env
//   npm run upload:bundles -- --only macaque_snrna   # one dataset subtree
//   npm run upload:bundles -- --skip-index-check    # skip the index/corpus verify
//   R2_BUCKET=other-bucket npm run upload:bundles    # override bucket name
//   npm run upload:bundles -- --no-purge        # skip the post-upload edge purge (see below)
//   npm run upload:bundles -- --allow-reduced-bundles  # publish bundles that look like the public release
//
// Reduced bundles: the public data release (fetch:data, data:offline) empties
// every KEGG collection and the macaque per-animal CPM. Publishing it would
// replace the full production bundles, so the uploader refuses when it finds
// signs of it (scripts/lib/publicDataRelease.mts), in every mode including the
// dry runs. --allow-reduced-bundles overrides that, for a deliberate reduced
// publication or a reviewed false positive.
//
// Edge purge: the data host's cache rule ignores the query string, so ?v= no
// longer separates releases at the edge. After a real upload the publisher
// purges every changed dataset directory, query build, the QC pool and the
// pointers by prefix (the whole host past 100 prefixes), using
// CLOUDFLARE_EDGE_TOKEN (Cache Purge permission; read from the environment,
// --env-file or .env.local). A real upload refuses to start without that token
// unless --no-purge is given, and exits non-zero if the purge fails. Neither
// --dry-run nor --remote-dry-run ever purges. docs/EDGE_PROTECTION.md.
//
// Bundles are loaded as classic scripts (JSONP-style globals), so cross-origin
// serving needs no CORS config on the bucket — that is the reason the convention
// exists. CORS is OPTIONAL here, and only buys the loading bar its numbers: with
// an Access-Control-Allow-Origin policy on the bucket (plus VITE_BUNDLE_CORS=true
// at build time) the app reads bundles with a streaming fetch and can report
// "1.4 MB of 2.4 MB"; without it the bar is indeterminate. Nothing else differs.
//
// Compression: R2 does no Accept-Encoding negotiation — the bucket serves the
// exact bytes stored, so identity uploads would ship the 1-10 MB bundles at
// ~4-6x their compressed size (the .htaccess sidecar trick has no R2
// equivalent). Instead, text objects >= MIN_COMPRESS_BYTES are stored as
// brotli-11 bytes with `Content-Encoding: br` object metadata. This REQUIRES
// serving through a Cloudflare custom domain (which R2 production serving
// requires anyway — r2.dev is rate-limited and dev-only): the proxy transcodes
// br -> gzip/identity for the rare client that does not accept br, per
// https://developers.cloudflare.com/speed/optimization/content/compression/.
// Fetched directly from r2.dev, a no-br client would get raw brotli bytes.
//
// Cache-Control policy lives in lib/r2Incremental.mts:
// immutable-for-a-year everywhere (same ?v= contract as same-origin), except
// the mutable query/tracks.js and query/expression-manifest.js pointers.

import { spawn, spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { acquireR2LocalLock, prepareR2Object, queryPublicationPrefixes, R2_POINTER_KEYS, synchronizeR2Objects, type R2PreparedObject } from './lib/r2Incremental.mjs';
import { createR2InventoryReader } from './lib/r2RemoteInventory.mjs';
import { createCloudflareClient, resolveEdgeCredentials } from './lib/cloudflareApi.mjs';
import { manualPurgeInstructions, purgeEdgeCache, purgeRequestForKeys } from './lib/edgePurge.mjs';
import { reducedBundleFindings } from './lib/publicDataRelease.mjs';

const BUCKET = process.env.R2_BUCKET ?? 'hypoexplorer-datasets';
const PUBLIC_ROOT = path.resolve('public'); // keys are computed relative to here
const CONCURRENCY = Number(process.env.R2_CONCURRENCY ?? 8);
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1) {
  throw new Error('R2_CONCURRENCY must be a positive integer.');
}

// The immutable contract for the data bundles. Since the R2 cutover this is its
// only live definition — public/datasets/.htaccess states the same policy but is
// dormant, because nothing Apache serves those paths any more.
// Every bundle URL carries ?v=<app version>, so a given URL never changes content.
// The two MUST agree, or every PoP revalidates on a one-day clock URLs the service
// worker already treats as permanent. Safe ONLY as long as data redeploys bump the
// app version, which the ?v= scheme already requires; uploading changed bundles
// without a bump is a stale-data bug.

// The one exception: query/tracks.js is the mutable POINTER naming the current
// index build. Its content changes on every index rebuild under the same key,
// and a pinned stale pointer parks clients on the (safe but slow) full-download
// fallback — the build-id check in queryIndex.ts rejects shards from a build
// the pointer does not name. Five minutes bounds that window at the edge; a new
// ?v= refreshes the browser copy, and the post-upload purge refreshes the edge
// copy (the data host's cache key ignores ?v=).


// Every public/ subtree the app fetches from bundleBaseUrl.
//
// `query` is the sharded cross-dataset index (scripts/build_query_index.mts).
// It MUST ship alongside `datasets`: the client tries the index first and falls
// back to downloading every track bundle when it is absent, so an upload that
// covers only `datasets` leaves production silently on the slow path — a working
// site that moves ~284 MB per cross-dataset query instead of ~100 KB, with
// nothing failing to signal it.
//
// Upload the two together, and always AFTER rebuilding the index, or the shards
// and the manifest can end up from different builds — the client detects that
// via the build id and falls back, which is safe but again silently slow.
//
// `qc` is the per-population QA report PDFs (QCTab's report modal fetches
// `${bundleBaseUrl}/qc/<file>`), stored uncompressed — see COMPRESSIBLE above.
const UPLOAD_DIRS = ['datasets', 'query', 'qc'] as const;

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const remoteDryRun = argv.includes('--remote-dry-run');
// Skip the post-upload edge purge. Only for a publisher that purges by other
// means: the data host's cache key ignores ?v=, so unpurged keys keep serving
// their previous bytes from the edge (docs/EDGE_PROTECTION.md).
const noPurge = argv.includes('--no-purge');
const expressionOnly = argv.includes('--expression-only');
const allowReduced = argv.includes('--allow-reduced-bundles');
const envFileIndex = argv.indexOf('--env-file');
const envFile = envFileIndex >= 0 ? argv[envFileIndex + 1] : undefined;
if (envFileIndex >= 0 && (!envFile || envFile.startsWith('--'))) throw new Error('--env-file requires a filename.');
const wranglerArgs = envFile ? ['--env-file', envFile] : [];
// Resolve the same explicit environment for authentication, LIST and PUT.
// In particular, --env-file must not point writes at a different account than
// the account whose fresh metadata justified skipping those writes.
const wranglerEnv = { ...process.env, ...(envFile ? parseEnv(await readFile(envFile, 'utf8')) : {}) };
// Bypass for re-running an upload whose index was already verified this
// session. Never set it to get past a failure: the check's whole subject is
// data that looks fine and is not.
const skipIndexCheck = argv.includes('--skip-index-check');
const onlyIdx = argv.indexOf('--only');
let only: string | null = null;
if (onlyIdx >= 0) {
  const val = argv[onlyIdx + 1];
  if (!val || val.startsWith('--')) {
    console.error('Error: --only requires a dataset id, e.g. --only macaque_snrna');
    process.exit(2);
  }
  only = val;
}
if (only && expressionOnly) throw new Error('--only and --expression-only cannot be combined.');


// Store these as brotli bytes (Content-Encoding: br) when big enough to matter.
// Same 4 KB floor as precompress_dist.mts: below it the win is a packet or two.
// Deliberately NOT every known content type: PDFs carry their own internal
// compression, so brotli buys nothing and would force the proxy to transcode
// for the PDF viewers that don't send Accept-Encoding: br.

// Resolve the wrangler CLI entry so we can run it with `node <bin>` — this avoids
// npx overhead per call and the Windows .cmd/shell-quoting trap (the repo path
// contains a space), and passes args literally with no shell involved.
const require = createRequire(import.meta.url);
const wranglerPkgPath = require.resolve('wrangler/package.json');
const wranglerPkg = JSON.parse(await readFile(wranglerPkgPath, 'utf8')) as { bin: string | Record<string, string> };
const binRel = typeof wranglerPkg.bin === 'string' ? wranglerPkg.bin : wranglerPkg.bin.wrangler;
const WRANGLER_BIN = path.join(path.dirname(wranglerPkgPath), binRel);

// Parse a `var NAME = {...};` JSONP bundle back into an object — same fixed
// machine-written shape (and same slicing approach) as build_query_index.mts.
async function readBundleFile<T>(file: string): Promise<T | null> {
  if (!existsSync(file)) return null;
  const src = await readFile(file, 'utf8');
  const varAt = src.indexOf('var ');
  if (varAt < 0) return null;
  const start = src.indexOf('{', varAt);
  if (start < 0) return null;
  try {
    return JSON.parse(src.slice(start).replace(/;\s*$/, '')) as T;
  } catch {
    return null;
  }
}

// Verify the local query index was built against the local bundles. Publishing
// datasets whose track lists disagree with the index re-opens the exact hole
// the build-id scheme closed: the manifest still names every dataset, so the
// client's coverage check passes, but the index omits new tracks ("gene not
// detected" for data never read) or resurrects removed ones. Freshness of
// VALUES is covered separately: the build id now digests every emitted row, so
// a data-only reprocess yields a new id — but only if the index was actually
// rebuilt, which is precisely what this check cannot see for --only uploads
// (hence the warning printed there).
async function indexFreshnessProblems(): Promise<string[]> {
  const problems: string[] = [];
  const manifest = await readBundleFile<{ tracks?: Array<{ ds: string; trackId: string }> }>(
    path.join(PUBLIC_ROOT, 'query', 'tracks.js'),
  );
  if (!manifest) return problems;   // index absence is gated separately below
  if (!Array.isArray(manifest.tracks)) return ['query/tracks.js is unparseable or has no track list'];

  const byDs = new Map<string, string[]>();
  for (const t of manifest.tracks) {
    const arr = byDs.get(t.ds);
    if (arr) arr.push(t.trackId);
    else byDs.set(t.ds, [t.trackId]);
  }

  const datasetsRoot = path.join(PUBLIC_ROOT, 'datasets');
  const dirs = existsSync(datasetsRoot)
    ? (await readdir(datasetsRoot, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    : [];
  for (const ds of dirs) {
    const meta = await readBundleFile<{ populations?: string[] }>(path.join(datasetsRoot, ds, 'meta.js'));
    if (!meta?.populations?.length) {
      problems.push(`datasets/${ds}/meta.js is missing or declares no populations — cannot verify the index against it`);
      continue;
    }
    const indexed = byDs.get(ds);
    if (!indexed) {
      problems.push(`dataset "${ds}" is on disk but absent from query/tracks.js — the index predates it`);
      continue;
    }
    if (indexed.join(' ') !== meta.populations.join(' ')) {
      problems.push(
        `dataset "${ds}": query/tracks.js indexes ${indexed.length} track(s) but meta.js declares ` +
        `${meta.populations.length} — the track lists differ`,
      );
    }
  }
  for (const ds of byDs.keys()) {
    if (!dirs.includes(ds)) problems.push(`query/tracks.js names dataset "${ds}", which no longer exists under public/datasets/`);
  }
  return problems;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const toKey = (absFile: string): string => path.relative(PUBLIC_ROOT, absFile).split(path.sep).join('/');

function putObject(object: R2PreparedObject): Promise<void> {
  // Content-Type stays the SOURCE file's type — encoding is carried separately,
  // so the object is "javascript, brotli-encoded", not "a .br file".
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        WRANGLER_BIN, 'r2', 'object', 'put', `${BUCKET}/${object.key}`,
        '--file', object.uploadPath,
        '--content-type', object.httpMetadata.contentType!,
        ...(object.httpMetadata.contentEncoding ? ['--content-encoding', object.httpMetadata.contentEncoding] : []),
        '--cache-control', object.httpMetadata.cacheControl!,
        '--remote', ...wranglerArgs,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], env: wranglerEnv },
    );
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Wrangler object PUT failed (exit ${code}): ${object.key}`))));
  });
}

const queryPrefixes = only ? [] : queryPublicationPrefixes(
  (await readBundleFile<{ buildId?: unknown }>(path.join(PUBLIC_ROOT, 'query/tracks.js')))?.buildId,
  (await readBundleFile<{ buildId?: unknown }>(path.join(PUBLIC_ROOT, 'query/expression-manifest.js')))?.buildId,
  expressionOnly,
);
const selectedQueryKey = (key: string) => queryPrefixes.some((prefix) => prefix.endsWith('/') ? key.startsWith(prefix) : key === prefix);
const files: string[] = [];
const perDir: Record<string, number> = {};
for (const dir of UPLOAD_DIRS) {
  const abs = path.join(PUBLIC_ROOT, dir);
  if (!existsSync(abs)) {
    // `query` is generated, not committed in every checkout — say so rather than
    // uploading a partial set in silence.
    console.warn(`  ! public/${dir}/ does not exist — skipping.` +
      (dir === 'query' ? ' Run `npx tsx scripts/build_query_index.mts` to generate it.' : ''));
    continue;
  }
  let n = 0;
  for await (const f of walk(abs)) {
    // Dotfiles here are leftover server config, not data: the only one is
    // public/datasets/.htaccess, an Apache cache policy that stopped doing
    // anything when these bundles moved to R2. Config has no business as a
    // public bucket object; the live policy is the --cache-control flag above.
    if (path.basename(f).startsWith('.')) continue;
    // --only filters the dataset subtree; the query index and the QC PDF pool
    // are global, so both are excluded when a single dataset is targeted.
    if (only && !toKey(f).startsWith(`datasets/${only}/`)) continue;
    if (expressionOnly && !selectedQueryKey(toKey(f))) continue;
    if (dir === 'query' && !selectedQueryKey(toKey(f))) continue;
    files.push(f);
    n++;
  }
  perDir[dir] = n;
}
// Publish order matters. query/tracks.js is the POINTER: it names the build id
// that every shard URL derives from, so it must be written only AFTER every
// shard of that build is in place. Uploading it early opens a window where
// clients resolve a build whose shards are still arriving — they degrade to the
// safe full-download path, but silently and for as long as they cache the
// pointer. Sorting gives deterministic output; the completion barrier below
// keeps the pointer out of the concurrent work queue and suppresses it if any
// required object fails. (The pointer is also the one non-immutable object.)
files.sort((a, b) => {
  const ka = toKey(a), kb = toKey(b);
  if (R2_POINTER_KEYS.has(ka) !== R2_POINTER_KEYS.has(kb)) return R2_POINTER_KEYS.has(ka) ? 1 : -1;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
});

const summary = Object.entries(perDir).map(([d, n]) => `${n} in public/${d}/`).join(', ');
console.log(`Found ${files.length} files (${summary})${only ? ` (filtered: ${only})` : ''} → bucket "${BUCKET}"`);
// Before any index check: those pass on the public release too, because its
// query indexes are rebuilt from the same reduced bundles.
const reduced = await reducedBundleFindings(PUBLIC_ROOT, { only });
if (reduced.length && !allowReduced) {
  console.error('\nERROR: refusing to publish — these bundles look restored from the public data release:');
  for (const finding of reduced) console.error(`  ✗ ${finding}`);
  console.error('\nThat release has KEGG emptied and the macaque per-animal CPM withheld; uploading it would');
  console.error('replace the full production bundles. Publish from the full analysis bundles instead.');
  console.error('If these are full bundles rebuilt over a restore, delete the marker and the KEGG note named');
  console.error('above and re-run; the content checks still apply. --allow-reduced-bundles overrides this.');
  process.exit(1);
}
if (reduced.length) {
  console.warn('\nWARNING: --allow-reduced-bundles: publishing bundles that look like the public data release:');
  for (const finding of reduced) console.warn(`  ! ${finding}`);
}

if (!only) {
  const requiredPointers = expressionOnly ? ['query/expression-manifest.js'] : [...R2_POINTER_KEYS];
  for (const key of requiredPointers) {
    if (!files.some((file) => toKey(file) === key)) throw new Error(`Required query pointer is missing: ${key}. Rebuild the indexes before publication.`);
  }
}

// A full upload that ships datasets without the query index leaves production on
// the fallback path: correct results, but ~284 MB per cross-dataset query
// instead of ~100 KB, with nothing failing to signal it. That is precisely the
// kind of regression a CI run should refuse to publish, so exit non-zero rather
// than warn. `--only` targets a single dataset subtree and is exempt.
if (!only && !perDir.query) {
  console.error('\nERROR: no query-index files staged (public/query/ is missing or empty).');
  console.error('Publishing datasets alone would silently leave production on the full-download');
  console.error('path — ~284 MB per cross-dataset query instead of ~100 KB.');
  console.error('\nBuild it first:  npx tsx scripts/build_query_index.mts');
  console.error('Then re-run this. To upload one dataset subtree only, use --only <id>.');
  process.exit(1);
}

// Refuse to publish an index that was not built against these bundles. On
// --only the query tree is not uploaded, so a local mismatch does not change
// what lands on R2 — demoted to a warning so a staged dataset can still ship.
const staleness = expressionOnly ? [] : await indexFreshnessProblems();
if (staleness.length) {
  if (only) {
    console.warn('\nWARNING: the local query index disagrees with public/datasets metas:');
    for (const p of staleness) console.warn(`  ! ${p}`);
    console.warn('Rebuild it before the next full upload:  npx tsx scripts/build_query_index.mts');
  } else {
    console.error('\nERROR: refusing to publish — query/tracks.js was not built against these bundles:');
    for (const p of staleness) console.error(`  ✗ ${p}`);
    console.error('\nRebuild the index:  npx tsx scripts/build_query_index.mts');
    console.error('Then re-run this upload.');
    process.exit(1);
  }
}

// VALUE freshness, not just structure — and deliberately NOT nested inside the
// branch above. indexFreshnessProblems() compares dataset ids and track LISTS,
// which a data-only reprocess leaves untouched: new logFC / p / expression in
// the bundles, the same tracks, so `staleness` is EMPTY in precisely the case
// this gate exists to catch. Every shard URL is immutable and cached for a
// year, so publishing that pairing is not a transient inconsistency — it is
// last month's numbers served forever from a deploy that reported success.
//
// The generator's --check re-reads the corpus and compares every emitted row
// against it, which is the only thing that actually witnesses value drift. It
// costs one full pass over public/datasets/ (~357 MB off local disk); an upload
// about to push hundreds of megabytes over the network can afford it.
// --skip-index-check exists for re-running an upload that already passed.
if (!only && !expressionOnly && !skipIndexCheck) {
  console.log('\nverifying the query index against the source bundles (build_query_index.mts --check)…');
  const check = spawnSync(
    process.execPath,
    [require.resolve('tsx/cli'), 'scripts/build_query_index.mts', '--check'],
    { stdio: 'inherit' },
  );
  if (check.status !== 0) {
    console.error('\nERROR: refusing to publish — the local query index does not match the local bundles.');
    console.error('Rebuild it:  npx tsx scripts/build_query_index.mts');
    console.error('Then re-run this upload. (--skip-index-check bypasses this, at your own risk.)');
    process.exit(1);
  }
}
if (!only && !skipIndexCheck) {
  console.log('\nverifying the lossless expression index against the source bundles (build_expression_index.mts --check)…');
  const check = spawnSync(process.execPath, [require.resolve('tsx/cli'), 'scripts/build_expression_index.mts', '--check'], { stdio: 'inherit' });
  if (check.status !== 0) throw new Error('Refusing to publish: the expression index does not match its source bundles. Run npm run build:expression-index.');
}
if (only) {
  console.warn('\nNOTE: --only uploads dataset bundles WITHOUT the query index. If this upload changes');
  console.warn('any values (a reprocess with new logFC/p), the deployed index keeps serving the OLD');
  console.warn('numbers from immutable shard URLs until it is rebuilt and fully re-uploaded:');
  console.warn('  npx tsx scripts/build_query_index.mts && npm run upload:bundles');
}

if (dryRun) {
  for (const f of files.slice(0, 20)) console.log(`  ${toKey(f)}`);
  if (files.length > 20) console.log(`  … and ${files.length - 20} more`);
  console.log('(dry run — nothing uploaded)');
  process.exit(0);
}

// Resolve the purge credential BEFORE any PUT: an upload that cannot purge would
// leave the edge serving the previous bytes under the new release's URLs.
const edge = resolveEdgeCredentials({ envFile });
const edgeClient = !remoteDryRun && !noPurge && edge.token ? createCloudflareClient(edge.token) : null;
if (!remoteDryRun && !noPurge && !edgeClient) {
  console.error('\nERROR: CLOUDFLARE_EDGE_TOKEN is not set (environment, --env-file or .env.local).');
  console.error('A real upload must purge the changed keys from the edge cache afterwards: the data host');
  console.error('ignores ?v= in its cache key. Create the token described in docs/EDGE_PROTECTION.md');
  console.error('(Zone > Cache Purge > Purge), or pass --no-purge and purge the data host yourself.');
  process.exit(2);
}
// Every key a PUT was attempted for, including failed attempts: purging an
// unchanged key costs one cache refill, missing a changed one serves stale data.
const attemptedKeys: string[] = [];
async function purgeAfterUpload(): Promise<void> {
  if (remoteDryRun || !attemptedKeys.length) return;
  const request = purgeRequestForKeys(attemptedKeys);
  if (!request) return;
  if (noPurge) {
    console.warn(`\nWARNING: --no-purge: ${attemptedKeys.length} changed object(s) were NOT purged from the edge cache.`);
    console.warn(manualPurgeInstructions(edge.zoneId));
    return;
  }
  const scope = 'prefixes' in request ? `${request.prefixes.length} prefix(es)` : `host ${request.hosts.join(', ')}`;
  try {
    await purgeEdgeCache(edgeClient!, edge.zoneId, request);
    console.log(`Purged the edge cache for ${scope}.`);
  } catch (error) {
    console.error(`\nERROR: objects were uploaded but the edge purge failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(manualPurgeInstructions(edge.zoneId));
    process.exitCode = 1;
  }
}

// Resolve credentials using Wrangler's documented refresh flow. Capture stdout
// in memory only; printing a failed child's buffers could expose a token.
const config = await readFile(path.resolve('wrangler.jsonc'), 'utf8');
const account = wranglerEnv.CLOUDFLARE_ACCOUNT_ID ?? /"account_id"\s*:\s*"([a-f0-9]{32})"/i.exec(config)?.[1];
if (!account) throw new Error('Set CLOUDFLARE_ACCOUNT_ID or account_id in wrangler.jsonc.');
wranglerEnv.CLOUDFLARE_ACCOUNT_ID = account;
const authentication = spawnSync(process.execPath, [WRANGLER_BIN, 'auth', 'token', '--json', ...wranglerArgs], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: wranglerEnv,
});
if (authentication.status !== 0) throw new Error('Wrangler authentication failed. Verify the configured R2 credentials.');
let token: string;
try {
  const auth = JSON.parse(authentication.stdout);
  if ((auth.type !== 'api_token' && auth.type !== 'oauth') || typeof auth.token !== 'string') throw new Error();
  token = auth.token;
} catch { throw new Error('Wrangler did not return a supported API/OAuth token.'); }
const list = createR2InventoryReader({ account, bucket: BUCKET, token, prefixes: expressionOnly
  ? queryPrefixes : only ? [`datasets/${only}/`] : ['datasets/', 'qc/', ...queryPrefixes] });
const releaseLock = await acquireR2LocalLock(path.join(os.tmpdir(), 'hypoexplorer-r2-locks'), account, BUCKET);
try {
  const cache = path.resolve('.wrangler/r2-upload-cache');
  const prepared: R2PreparedObject[] = [];
  let cursor = 0;
  console.log('\nHashing source files and verifying/reusing stored-byte compression cache…');
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, async () => {
    while (cursor < files.length) {
      const file = files[cursor++];
      prepared.push(await prepareR2Object(file, toKey(file), cache));
      if (prepared.length % 100 === 0 || prepared.length === files.length) console.log(`  prepared ${prepared.length}/${files.length}`);
    }
  }));
  prepared.sort((a, b) => a.key.localeCompare(b.key));
  let settled = 0;
  let result: Awaited<ReturnType<typeof synchronizeR2Objects>>;
  try {
    result = await synchronizeR2Objects(prepared, {
      concurrency: CONCURRENCY, dryRun: remoteDryRun,
      list,
      put: (object) => { attemptedKeys.push(object.key); return putObject(object); },
      onSettled: () => { settled++; if (settled % 20 === 0) console.log(`  ${settled} changed objects processed`); },
    });
  } finally {
    // Also after a failed or interrupted publication: whatever reached R2 must
    // not stay shadowed by the edge cache.
    await purgeAfterUpload();
  }
  const storedBytes = prepared.filter((object) => result.uploaded.includes(object.key)).reduce((sum, object) => sum + object.storedSize, 0);
  const plannedBytes = prepared.filter((object) => result.planned.includes(object.key)).reduce((sum, object) => sum + object.storedSize, 0);
  console.log(`\n${result.unchanged.length} unchanged objects verified at R2; ${result.planned.length} require upload (${plannedBytes.toLocaleString()} stored bytes).`);
  console.log(`${prepared.filter((object) => object.cacheHit).length}/${prepared.length} reused verified local compression/staging bytes.`);
  if (result.unverifiable.length) console.warn(`${result.unverifiable.length} remote ETags were not single-part MD5 hashes; those objects require verified replacement.`);
  if (remoteDryRun) console.log('Remote dry run: 0 PUT requests; no objects or metadata changed.');
  else console.log(`Uploaded ${result.uploaded.length} objects / ${storedBytes.toLocaleString()} stored bytes to "${BUCKET}".`);
  if (result.skippedPointers.length) console.error(`Pointers withheld: ${result.skippedPointers.join(', ')}`);
  for (const failure of result.failures) console.error(`  ✗ ${failure.object.key}: ${failure.error instanceof Error ? failure.error.message : 'upload failed'}`);
  if (result.failures.length) process.exitCode = 1;
} finally { await releaseLock(); }
