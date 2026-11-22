// Generate .br + .gz sidecars for the text assets in dist/, at brotli-11 and
// gzip-9 rather than a server's streaming quality level.
//
// ── WHO ACTUALLY SERVES THESE, AS OF 2026-09-04: NOBODY ─────────────────────
// The apex is Cloudflare Workers static assets, which compresses at the edge and
// has no sidecar mechanism, and public/.assetsignore deliberately keeps *.br and
// *.gz out of the `wrangler deploy` upload — shipping them would mean a second,
// unreachable copy of every asset. The data bundles never used this path either:
// upload_bundles_r2.mts compresses independently and stores brotli bytes with
// Content-Encoding: br on the R2 objects themselves, and a production build has
// already deleted dist/{datasets,query,qc} by then (dropOffOriginData).
//
// NOT PART OF THE CLOUDFLARE DEPLOY ANY MORE (2026-11). `deploy:cf` runs
// `build`, not `deploy:dist`, so this no longer runs on every deploy. It is kept
// for an Apache/LiteSpeed host: public/.htaccess plus these sidecars is what a
// move back off Cloudflare would need, and `pnpm run deploy:dist` (build +
// precompress) is that path. www.hypoexplorer.com is a Worker custom domain too
// (wrangler.jsonc routes), so no live host reads the sidecars.
//
// verify_deploy.mts uses dist/nomenclature/table.js.br as its brotli-11
// yardstick only when the host it probes serves sidecars; against the
// Cloudflare edge it checks the compression saving and skips the comparison
// when no sidecar exists. Run this by hand if you want that number anyway.
//
// Incremental: a sidecar is skipped when it is newer than its source, so the
// first run is slow (brotli-11) and subsequent runs touch only what changed.
//
// Run AFTER `pnpm run build`, or use `pnpm run deploy:dist` (build + precompress)
// when producing a dist/ for an Apache upload.
//
// HISTORICAL, AND STILL TRUE OF ANY APACHE ORIGIN: skipping this is silent, and
// it has happened once. A dist/ uploaded to Apache without sidecars serves fine —
// the origin falls back to on-the-fly compression, so nothing 404s and no error
// surfaces. It just ships brotli at a streaming quality level: measured on the
// live site at the time, a track bundle came back at 713 KB where the brotli-11
// sidecar is 434 KB. Two ways to lose it: the step never ran (the case that bit
// us — dist/ held zero .br files), or the upload dropped them (an upload that
// filters by extension will quietly leave them behind).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../..', 'dist');

// Compress only text assets big enough to matter: below ~4 KB the sidecar +
// header overhead eats the win and TCP ships it in a packet or two anyway.
const MIN_BYTES = 4096;
const EXTENSIONS = new Set(['.js', '.css']);

if (!fs.existsSync(DIST)) {
  console.error('precompress_dist: dist/ not found — run `npm run build` first.');
  process.exit(1);
}

let made = 0;
let skipped = 0;
let bytesIn = 0;
let bytesBr = 0;
let bytesGz = 0;

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

for (const file of walk(DIST)) {
  const ext = path.extname(file);
  if (!EXTENSIONS.has(ext)) continue;
  const st = fs.statSync(file);
  if (st.size < MIN_BYTES) continue;

  const brFile = `${file}.br`;
  const gzFile = `${file}.gz`;
  const fresh = (side: string) => fs.existsSync(side) && fs.statSync(side).mtimeMs >= st.mtimeMs;
  if (fresh(brFile) && fresh(gzFile)) {
    skipped++;
    continue;
  }

  const buf = fs.readFileSync(file);
  const br = zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  });
  const gz = zlib.gzipSync(buf, { level: 9 });
  fs.writeFileSync(brFile, br);
  fs.writeFileSync(gzFile, gz);
  made++;
  bytesIn += buf.length;
  bytesBr += br.length;
  bytesGz += gz.length;
  if (made % 25 === 0) console.log(`  ${made} compressed…`);
}

const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
console.log(
  `precompress_dist: ${made} compressed (${skipped} fresh), ` +
    `${mb(bytesIn)} MB -> br ${mb(bytesBr)} MB / gz ${mb(bytesGz)} MB`,
);
