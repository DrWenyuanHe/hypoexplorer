// Probe the DEPLOYED site and assert the serving contract the repo's config
// claims to provide: precompressed sidecars in play, correct content
// negotiation, immutable data URLs, revalidated HTML, and the build actually
// being the one in this checkout.
//
// Why this exists: hypoexplorer.com is Cloudflare-proxied in front of the
// Hostinger origin, so every response now passes through two layers that both
// compress and both cache. The site still "works" when a layer of that stack
// silently drops out — it loads, the data is correct, nothing errors — it just
// moves several hundred KB more per track than it should. That is the exact
// regression this catches: the deploy live at the time this was written shipped
// with no .br/.gz sidecars at all (`npm run precompress` was never run against
// it), and the only visible symptom was brotli responses coming back LARGER
// than gzip ones.
//
// Usage:
//   npx tsx scripts/verify_deploy.mts                       # https://hypoexplorer.com
//   npx tsx scripts/verify_deploy.mts https://staging.host   # any origin
//   npm run verify:deploy
//
// Exits non-zero if any check fails, so it can gate a deploy.

import https from 'node:https';
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDatasets } from '../src/data/datasets';
import { manifestFreshness, REBUILD_HINT } from '../src/data/indexFreshness';
import { readReleaseBuild } from './lib/releaseBuild.mjs';
import { verifyServedReleaseData } from './lib/deployedDataVerification.mjs';
import { releaseBundleVersion } from '../src/data/releaseIdentity';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'),
) as { version: string };
const EXPECTED_RELEASE = readReleaseBuild(path.resolve(__dirname, '..'));
const BUNDLE_VERSION = releaseBundleVersion(EXPECTED_RELEASE.releaseId, pkg.version);

const ORIGIN = (process.argv[2] ?? 'https://hypoexplorer.com').replace(/\/+$/, '');

// Where the DATA bundles live. Since the R2 cutover the app origin serves only
// the shell (HTML, hashed assets, nomenclature); /datasets, /query and /qc are
// fetched from VITE_BUNDLE_BASE_URL. Probing the data checks against the app
// origin would either measure a STALE pre-cutover tree left on the host, or
// 404 once that tree is cleaned up — either way it describes bytes no visitor
// downloads.
//
// Two origins matter, and they are compared below:
//   * LOCAL_BUNDLE_BASE — what THIS checkout's build would compile in, resolved
//     the way `vite build` does;
//   * the DEPLOYED base — what the live build actually compiled in, read from
//     the version stamp it ships (emitVersionManifest in vite.config.ts).
// The data probes follow the DEPLOYED base, because that is the origin every
// visitor's loaders prepend. Probing the local one instead was a real blind
// spot: a build made without .env.local compiled to same-origin and 404'd
// /query/tracks.js on the app host, sending every cross-dataset gene lookup
// down the download-everything path — while this gate, aimed at R2 by the local
// env, reported the index fresh.
//
// The file list below is Vite's own precedence for `vite build`, which runs in
// production mode: process env first, then .env.production.local, .env.local,
// .env.production, .env — highest first, first match wins. It must stay in
// lockstep with the build. A gate that reads a DIFFERENT env file than the
// build it is verifying is worse than no gate: it goes green against an origin
// no visitor uses, which is exactly the silent pass this script exists to
// prevent. Note .env.production.local outranks .env.local, so dropping the
// mode-specific files would not merely miss a case — it would pick the wrong
// origin whenever both exist.
const BUILD_ENV_FILES = ['.env.production.local', '.env.local', '.env.production', '.env'];
function resolveBundleBase(): string {
  if (process.env.VITE_BUNDLE_BASE_URL !== undefined) return process.env.VITE_BUNDLE_BASE_URL;
  for (const f of BUILD_ENV_FILES) {
    try {
      const text = readFileSync(path.resolve(__dirname, '..', f), 'utf8');
      const m = text.match(/^VITE_BUNDLE_BASE_URL=(.*)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch {
      // File absent — try the next one.
    }
  }
  return '';
}
const LOCAL_BUNDLE_BASE = resolveBundleBase().replace(/\/+$/, '');

// A large track bundle: the file class the whole compression story exists for.
// Small files compress so similarly under every algorithm that they cannot
// distinguish a brotli-11 sidecar from a proxy's on-the-fly brotli.
const PROBE_BUNDLE = '/datasets/macaque_snrna/track_Ast1.js';

interface Probe {
  status: number;
  headers: Record<string, string>;
  bytes: number; // RAW bytes on the wire, before any decompression
}

// node:https rather than fetch() on purpose. undici transparently decompresses,
// so `arrayBuffer().byteLength` reports the DECOMPRESSED size — the one number
// this script must not use. Counting chunks off the raw socket is the only way
// to measure what a browser would actually download.
function probe(urlPath: string, acceptEncoding: string, origin: string = ORIGIN): Promise<Probe> {
  const url = new URL(origin + urlPath);
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          'Accept-Encoding': acceptEncoding,
          // Identify as a browser: some edges vary compression policy by user
          // agent, and measuring a curl-shaped request would not describe what
          // visitors actually receive.
          'User-Agent': 'Mozilla/5.0 (compatible; hypoexplorer-verify-deploy)',
        },
      },
      (res) => {
        let bytes = 0;
        res.on('data', (c: Buffer) => {
          bytes += c.length;
        });
        res.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
          }
          resolve({ status: res.statusCode ?? 0, headers, bytes });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(90_000, () => req.destroy(new Error(`timeout fetching ${urlPath}`)));
    req.end();
  });
}

// Body-returning sibling of probe(), for the few responses this script must
// parse rather than measure. Same timeout and browser UA as probe() — an
// untimed request would let a stalled origin wedge the whole deploy gate, and
// a UA-less one can trip edge bot mitigation into serving a challenge page.
// Identity encoding because node:https does not decompress; if the origin
// answers with a Content-Encoding anyway (a bucket serving stored brotli with
// no transcoding proxy in front), the body would be undecodable garbage — so
// that comes back as an explicit error rather than a downstream parse failure.
// The size ceiling is far above tracks.js/index.html but stops a runaway body.
const FETCH_TEXT_MAX_BYTES = 32 * 1024 * 1024;
function fetchBytes(url: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'Accept-Encoding': 'identity',
          'User-Agent': 'Mozilla/5.0 (compatible; hypoexplorer-verify-deploy)',
        },
      },
      (res) => {
        const encoding = res.headers['content-encoding'];
        if (encoding) {
          res.resume();
          reject(new Error(`origin sent Content-Encoding: ${encoding} to an identity request — no transcoding in front of this origin?`));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (c: Buffer) => {
          bytes += c.length;
          if (bytes > FETCH_TEXT_MAX_BYTES) {
            req.destroy(new Error(`response exceeded ${FETCH_TEXT_MAX_BYTES} bytes fetching ${url}`));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(90_000, () => req.destroy(new Error(`timeout fetching ${url}`)));
  });
}

async function fetchText(url: string): Promise<{ status: number; body: string }> {
  const response = await fetchBytes(url);
  return { status: response.status, body: response.body.toString('utf8') };
}

// The deployed version stamp, fetched once up front because the data origin
// depends on it. `bundleBase` is null when the stamp predates the field (or is
// missing/unparseable) — reported as a failed check further down, not silently
// substituted, since "unknown origin" is exactly the state this exists to flag.
// Both fetches go through the helpers declared above.
interface DeployedStamp { status: number; version: string | null; bundleBase: string | null; cacheControl: string }
const STAMP: DeployedStamp = await (async () => {
  const head = await probe('/version.json', 'br, gzip');
  const stamp: DeployedStamp = {
    status: head.status, version: null, bundleBase: null, cacheControl: head.headers['cache-control'] ?? '',
  };
  if (head.status !== 200) return stamp;
  try {
    const parsed: unknown = JSON.parse((await fetchText(`${ORIGIN}/version.json`)).body);
    const { version, bundleBase } = (parsed as { version?: unknown; bundleBase?: unknown } | null) ?? {};
    if (typeof version === 'string') stamp.version = version;
    if (typeof bundleBase === 'string') stamp.bundleBase = bundleBase.replace(/\/+$/, '');
  } catch {
    // Not JSON (an error page, a truncated upload) — reported as a failure below.
  }
  return stamp;
})();

// Deployed base when the stamp carries one; otherwise the local one, so a
// pre-stamp deploy is still probed somewhere sensible while the stamp check
// itself fails and says why.
const DATA_ORIGIN = (STAMP.bundleBase ?? LOCAL_BUNDLE_BASE) || ORIGIN;

const results: { ok: boolean; name: string; detail: string }[] = [];
const check = (ok: boolean, name: string, detail: string) => {
  results.push({ ok, name, detail });
};
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

/**
 * Does this Cache-Control actually force a revalidation on EVERY request?
 *
 * Parses directives instead of substring-matching, because the obvious regex
 * (/no-cache|must-revalidate|max-age=0/) is wrong in a way that passes:
 * `must-revalidate` alone does NOT mean "revalidate every time". It governs what
 * happens once a response goes STALE, so
 *
 *     Cache-Control: public, max-age=31536000, must-revalidate
 *
 * matches that regex while licensing a year of reuse with no network call at
 * all. On /version.json that is precisely the silent failure the stamp exists to
 * detect — clients pinned to an old build, and a gate saying they are not.
 *
 * Freshness is what matters, so: no-store or no-cache pass outright. Otherwise
 * `max-age=0` must be present — s-maxage alone is not enough, because browsers
 * ignore it entirely and would fall back to heuristic caching — and every
 * s-maxage that IS present must also be zero, or shared caches keep serving.
 *
 * Three directives disqualify regardless of freshness, because each one licenses
 * exactly the reuse-without-asking this is checking for:
 *   immutable                 skip revalidation even when stale
 *   stale-while-revalidate    serve stale now, refresh in the background
 *   stale-if-error            serve stale when the origin is unreachable
 */
const NEVER_REVALIDATES = ['immutable', 'stale-while-revalidate', 'stale-if-error'];
function revalidatesEveryRequest(cacheControl: string): boolean {
  const directives = cacheControl.toLowerCase().split(',').map((d) => d.trim()).filter(Boolean);
  const name = (d: string) => d.split('=')[0].trim();
  if (directives.some((d) => NEVER_REVALIDATES.includes(name(d)))) return false;
  if (directives.includes('no-store') || directives.includes('no-cache')) return true;

  const age = (key: string) => directives
    .map((d) => new RegExp(`^${key}\\s*=\\s*"?(\\d+)"?$`).exec(d))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  const maxAge = age('max-age');
  const sMaxAge = age('s-maxage');
  // No max-age at all means heuristic caching in the browser, which is NOT a
  // guaranteed revalidation — so an empty list fails rather than passes.
  return maxAge.length > 0 && maxAge.every((a) => a === 0) && sMaxAge.every((a) => a === 0);
}

console.log(
  `Verifying ${ORIGIN}${DATA_ORIGIN !== ORIGIN ? ` (data bundles: ${DATA_ORIGIN})` : ''}\n`,
);

// ── Compression ──────────────────────────────────────────────────────────────
const brotli = await probe(`${PROBE_BUNDLE}?v=${BUNDLE_VERSION}`, 'br, gzip', DATA_ORIGIN);
const gzip = await probe(`${PROBE_BUNDLE}?v=${BUNDLE_VERSION}`, 'gzip', DATA_ORIGIN);
const identity = await probe(`${PROBE_BUNDLE}?v=${BUNDLE_VERSION}`, 'identity', DATA_ORIGIN);

check(
  brotli.status === 200 && gzip.status === 200 && identity.status === 200,
  'probe bundle reachable',
  `${PROBE_BUNDLE} -> br ${brotli.status} / gzip ${gzip.status} / identity ${identity.status}`,
);

check(
  brotli.headers['content-encoding'] === 'br',
  'brotli offered to br-capable clients',
  `content-encoding: ${brotli.headers['content-encoding'] || '(none)'} — ${kb(brotli.bytes)}`,
);

// The corruption check. A client that did not offer br must never receive br:
// it cannot decode the bytes. This is the classic failure when a CDN in front
// of an origin mishandles `Vary: Accept-Encoding` and serves one cached variant
// to everyone, and it is invisible from a modern browser (which accepts br).
check(
  gzip.headers['content-encoding'] !== 'br',
  'no brotli served to gzip-only clients',
  `content-encoding: ${gzip.headers['content-encoding'] || '(none)'} — ${kb(gzip.bytes)}`,
);

check(
  !identity.headers['content-encoding'],
  'identity request served uncompressed',
  `content-encoding: ${identity.headers['content-encoding'] || '(none)'} — ${kb(identity.bytes)}`,
);

check(
  (brotli.headers.vary ?? '').toLowerCase().includes('accept-encoding'),
  'Vary: Accept-Encoding present',
  `vary: ${brotli.headers.vary || '(none)'}`,
);

// THE sidecar check, and the reason this script exists.
//
// Calibrated against the real thing rather than a rule of thumb. The obvious
// test — "is brotli smaller than gzip?" — is far too weak to be useful here:
// an on-the-fly brotli at a streaming quality level ALSO beats gzip-9, just
// barely. Measured on this site with no sidecars deployed at all, brotli came
// back 2% under gzip and sailed through that test, while the brotli-11 sidecar
// for the same file is 22% under it. The weak version would have declared a
// deploy healthy while it left a fifth of the transfer on the table.
//
// So compress the probe file locally at the exact settings precompress_dist.mts
// uses, and compare the wire bytes against that. No magic constant, and it
// re-calibrates itself whenever the data changes.
//
// Guarded by an identity-size match first: if the deployed bundle is not the
// same bytes as the local one, the local compression is not a valid yardstick,
// so the check degrades to the weak form rather than reporting a false failure.
const probeSource = path.resolve(__dirname, '..', 'public', PROBE_BUNDLE.replace(/^\//, ''));
let localBr: number | null = null;
let sameContent = false;
try {
  const buf = readFileSync(probeSource);
  // Within 1%: the wire body and the file on disk can differ by trailing-byte
  // handling without being different content.
  sameContent = Math.abs(buf.length - identity.bytes) / buf.length < 0.01;
  localBr = zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  }).length;
} catch {
  // Probe bundle not in this checkout — fall through to the weak check.
}

if (brotli.status === 200 && gzip.status === 200) {
  if (localBr !== null && sameContent) {
    // 10% headroom absorbs brotli version differences between this Node and
    // whatever produced the deployed sidecar. It is nowhere near wide enough to
    // let an on-the-fly encode (measured 26% over) pass.
    const ceiling = localBr * 1.1;
    const overBy = ((brotli.bytes / localBr - 1) * 100).toFixed(0);
    check(
      brotli.bytes <= ceiling,
      'brotli-11 sidecars are being served',
      brotli.bytes <= ceiling
        ? `br ${kb(brotli.bytes)}, matching the local brotli-11 sidecar (${kb(localBr)}) — sidecars in play`
        : `br ${kb(brotli.bytes)} is ${overBy}% over the brotli-11 sidecar for this file (${kb(localBr)}). ` +
          `Clients are getting on-the-fly brotli, not the sidecar — worth ${kb(brotli.bytes - localBr)} per ` +
          (DATA_ORIGIN !== ORIGIN
            ? 'track load. Re-run `npm run upload:bundles` (R2 stores brotli-11 bytes at upload time).'
            : 'track load. Run `npm run deploy:dist`, then re-upload dist/ INCLUDING the .br/.gz files.'),
    );
  } else {
    const ratio = brotli.bytes / gzip.bytes;
    check(
      brotli.bytes < gzip.bytes,
      'brotli-11 sidecars are being served (weak check)',
      `br ${kb(brotli.bytes)} vs gzip ${kb(gzip.bytes)} — ` +
        `${localBr === null ? 'probe bundle not in this checkout' : 'deployed bundle differs from the local one'}, ` +
        `so this only checks br < gzip (${ratio < 1 ? 'ok' : 'FAILING'}), not that the sidecar is the source. ` +
        'A pass here is weak evidence: on-the-fly brotli also beats gzip.',
    );
  }
}

// ── App-origin compression ───────────────────────────────────────────────────
// The data-bundle checks above follow the bundles to DATA_ORIGIN, which since
// the R2 cutover means they no longer prove anything about how the APP host
// compresses the shell. Probe a large same-origin asset for that: the
// nomenclature table, which ships with dist/ (deliberately same-origin, see
// vite.config.ts) and at ~17 MB raw is far past the size where compression
// quality is distinguishable. Calibrate against the actual sidecar in the local
// dist/ rather than recompressing, so the number is the real artifact.
const APP_PROBE = '/nomenclature/table.js';
const appProbeSource = path.resolve(__dirname, '..', 'dist', 'nomenclature', 'table.js');
let appLocalLen: number | null = null;
let appLocalBr: number | null = null;
try {
  appLocalLen = readFileSync(appProbeSource).length;
  appLocalBr = readFileSync(`${appProbeSource}.br`).length;
} catch {
  // No local dist/ (or precompress not run) — skip rather than fail; the
  // build-identity check below already reports a missing local dist/.
}

// WHICH MODEL IS THIS HOST USING? Ask it, rather than assuming.
//
// The two are not interchangeable and demand different assertions:
//   * SIDECAR (Apache/LiteSpeed on Hostinger) — public/.htaccess rewrites to a
//     stored <file>.br, so the wire bytes should MATCH the local brotli-11
//     artifact. Anything above that means the rewrite stopped firing and the
//     host fell back to on-the-fly encoding, which is invisible except in size.
//   * EDGE (Cloudflare Workers static assets) — there are no sidecars;
//     public/.assetsignore deliberately keeps them out of the upload, and the
//     edge compresses on demand. Holding THAT to the brotli-11 number is a
//     guaranteed false alarm, because Cloudflare will never match quality 11.
//
// Requesting the sidecar URL directly separates them: it is a real file under
// Apache and a 404 on Cloudflare. Detecting rather than hardcoding also means
// this keeps working if the app moves back, or somewhere else again.
if (appLocalLen !== null && appLocalBr !== null) {
  const appBr = await probe(APP_PROBE, 'br, gzip');
  const appIdentity = await probe(APP_PROBE, 'identity');
  const sidecarProbe = await probe(`${APP_PROBE}.br`, 'identity');
  // 200 = the sidecar is a real file (Apache). 404 = it is not (Cloudflare).
  // ANYTHING ELSE is not evidence either way: a 403, 429, 5xx or stray redirect
  // would otherwise be read as "no sidecars here" and silently downgrade the
  // strict brotli-11 comparison to the permissive saving-vs-identity one.
  const servesSidecars = sidecarProbe.status === 200;
  const modelKnown = sidecarProbe.status === 200 || sidecarProbe.status === 404;
  const appSame =
    appIdentity.status === 200 && Math.abs(appLocalLen - appIdentity.bytes) / appLocalLen < 0.01;
  const CHECK = servesSidecars
    ? 'app-origin sidecars are being served'
    : 'app origin compresses the shell at the edge';

  if (!modelKnown) {
    check(false, 'app-origin serving model is identifiable',
      `${APP_PROBE}.br -> ${sidecarProbe.status} on ${ORIGIN}. Only 200 (sidecar present, Apache) or `
      + '404 (absent, edge compression) identifies which contract to hold this origin to; anything else '
      + 'is an origin problem, and guessing would silently pick the more permissive check.');
  } else if (appBr.status !== 200) {
    check(false, CHECK,
      `${APP_PROBE} -> ${appBr.status} on ${ORIGIN} — the app host does not have this build's files yet.`);
  } else if (!appSame) {
    check(false, CHECK,
      `${APP_PROBE} on ${ORIGIN} is not this build's file (wire ${kb(appIdentity.bytes)} vs local ` +
        `${kb(appLocalLen)}) — dist/ has not been uploaded, so compression cannot be measured.`);
  } else if (servesSidecars) {
    const ceiling = appLocalBr * 1.1;
    const overBy = ((appBr.bytes / appLocalBr - 1) * 100).toFixed(0);
    check(
      appBr.bytes <= ceiling,
      CHECK,
      appBr.bytes <= ceiling
        ? `${APP_PROBE} br ${kb(appBr.bytes)}, matching the local sidecar (${kb(appLocalBr)})`
        : `${APP_PROBE} br ${kb(appBr.bytes)} is ${overBy}% over the local sidecar (${kb(appLocalBr)}) — ` +
          'the host is compressing on the fly. Re-upload dist/ INCLUDING the .br/.gz files and .htaccess.',
    );
  } else {
    // Edge model. What can still silently break is compression being off or
    // degraded, so gate on the saving against identity rather than on a number
    // this host cannot reach. The measured saving here is ~76%; 60% is clear of
    // normal variation but nowhere near passing an uncompressed response.
    const saved = 1 - appBr.bytes / appIdentity.bytes;
    const encoded = /br|gzip/.test(appBr.headers['content-encoding'] ?? '');
    const overSidecar = ((appBr.bytes / appLocalBr - 1) * 100).toFixed(0);
    check(
      encoded && saved >= 0.6,
      CHECK,
      encoded && saved >= 0.6
        ? `${APP_PROBE} ${appBr.headers['content-encoding']} ${kb(appBr.bytes)}, ${(saved * 100).toFixed(0)}% off ` +
          `identity (${kb(appIdentity.bytes)}). Costs ${kb(appBr.bytes - appLocalBr)} more than the brotli-11 ` +
          `sidecar (${kb(appLocalBr)}, +${overSidecar}%) — expected: the edge trades ratio for not storing them.`
        : `${APP_PROBE} came back ${appBr.headers['content-encoding'] || 'UNCOMPRESSED'} at ${kb(appBr.bytes)} ` +
          `against ${kb(appIdentity.bytes)} identity (${(saved * 100).toFixed(0)}% saved). The edge is not ` +
          'compressing the shell; check the zone\'s compression settings.',
    );
  }
}

// ── Legacy same-origin data paths ────────────────────────────────────────────
// The compatibility contract for clients that predate the R2 cutover. Those
// builds fetch /datasets/**, /query/** and /qc/** from the APP origin, and their
// update prompt was dismissible, so one that keeps declining never reaches the
// mandatory-update code and asks this host for data indefinitely.
//
// Nothing else here can catch it breaking. Every data probe above follows the
// STAMPED bundle origin straight to R2, so a missing, malformed or ignored
// public/_redirects breaks every straggler while all the other checks pass — the
// same shape of silent failure this script exists for, and one this branch
// introduced by moving the apex onto a Worker that serves only dist/.
//
// Two ways to satisfy the contract, and both count: a Worker 302s to R2, an
// Apache origin still holds the files and answers 200. Only "gone" is a failure.
// The query string is asserted because loaders append the release cache key to
// mutable bundle URLs; a redirect that drops it would change the cache key.
{
  const CHECK_NAME = 'legacy same-origin data paths still resolve';
  const SENTINEL = `v=${BUNDLE_VERSION}`;
  const LEGACY = [
    `/datasets/macaque_snrna/meta.js?${SENTINEL}`,
    `/query/tracks.js?${SENTINEL}`,
    `/qc/?${SENTINEL}`,
  ];
  const problems: string[] = [];
  const notes: string[] = [];
  for (const p of LEGACY) {
    const r = await probe(p, 'identity');
    if (r.status === 200) { notes.push(`${p.split('?')[0]} 200 (served here)`); continue; }
    if (r.status !== 301 && r.status !== 302 && r.status !== 307 && r.status !== 308) {
      problems.push(`${p.split('?')[0]} -> ${r.status}, neither served nor redirected`);
      continue;
    }
    const loc = r.headers.location ?? '';
    const expectedPrefix = `${DATA_ORIGIN}${p.split('?')[0]}`;
    if (!loc.startsWith(expectedPrefix)) {
      problems.push(`${p.split('?')[0]} -> ${r.status} to "${loc}", expected ${expectedPrefix}`);
    } else if (!loc.includes(SENTINEL)) {
      problems.push(`${p.split('?')[0]} redirects but DROPS the query string ("${loc}") — ?v= is the cache key`);
    } else {
      notes.push(`${p.split('?')[0]} ${r.status} -> ${DATA_ORIGIN} (query preserved)`);
    }
  }
  check(
    problems.length === 0,
    CHECK_NAME,
    problems.length === 0
      ? notes.join('; ')
      : `${problems.join('; ')} — pre-R2 clients cannot reach data from this origin. Check that `
        + 'public/_redirects survived the build into dist/ and was not filtered out of the upload.',
  );
}

// ── Caching ──────────────────────────────────────────────────────────────────
// The ?v=<release prefix> contract: every /datasets/ URL is immutable for a given
// release, which is what lets both the service worker and the edge cache hold
// them forever. If this header goes missing the app still works, and simply
// re-downloads multi-MB bundles it already had.
check(
  (brotli.headers['cache-control'] ?? '').includes('immutable'),
  'data bundles are immutable-cached',
  `cache-control: ${brotli.headers['cache-control'] || '(none)'}`,
);

const html = await probe('/', 'br, gzip');
check(
  revalidatesEveryRequest(html.headers['cache-control'] ?? ''),
  'HTML revalidates every request',
  `cache-control: ${html.headers['cache-control'] || '(none)'}`,
);

// ── Version stamp ────────────────────────────────────────────────────────────
// /version.json is what the in-app watcher (src/pwa/versionWatch.ts) polls to
// decide a tab is running a build the origin no longer serves — the safety net
// for clients whose service worker is absent or wedged. It has three silent
// failure modes, and every one of them ends with the mandatory update never
// firing for those clients while the site looks perfectly healthy:
//   * never uploaded — the fetch 404s, which the watcher deliberately reads as
//     "unknown", i.e. no update offered, forever;
//   * stale — an upload that carried an older dist/ names a version nobody is
//     running, so clients force-refresh, come back unchanged, and stop after
//     the watcher's second attempt;
//   * cached at the edge — it answers with the previous deploy's number, which
//     is precisely the staleness it exists to detect.
//
// The stamp was fetched up front (STAMP) because the data probes need its
// bundleBase; the checks are only emitted here, in report order.
{
  const deployed = STAMP.version;
  check(
    deployed === pkg.version,
    'deployed version stamp matches this checkout',
    deployed === pkg.version
      ? `/version.json -> v${deployed}`
      : `/version.json -> ${STAMP.status === 200 ? `"${deployed ?? '(unparseable)'}"` : `HTTP ${STAMP.status}`}` +
        `, expected v${pkg.version} — clients cannot detect they are out of date. ` +
        'Re-upload dist/ (version.json sits next to index.html) after `npm run deploy:dist`.',
  );

  check(
    revalidatesEveryRequest(STAMP.cacheControl),
    'version stamp revalidates every request',
    `cache-control: ${STAMP.cacheControl || '(none)'}`,
  );

  // A version label alone cannot identify recomputed data or changed source.
  // Compare every build identity field to this checkout, then check the stamp
  // and current release document agree. Missing legacy manifests fail closed.
  try {
    const expected = EXPECTED_RELEASE;
    const response = await fetchText(`${ORIGIN}/release.json`);
    const release = JSON.parse(response.body);
    const stamp = JSON.parse((await fetchText(`${ORIGIN}/version.json`)).body);
    const mismatches = Object.entries(expected).filter(([key, value]) => release[key] !== value).map(([key]) => key);
    check(response.status === 200 && mismatches.length === 0 && stamp.releaseId === expected.releaseId,
      'deployed release metadata matches this checkout',
      mismatches.length ? `Mismatch: ${mismatches.join(', ')}` : `release ${release.releaseId ?? '(missing)'}`);
    const releaseHeaders = await probe('/release.json', 'identity');
    check(revalidatesEveryRequest(releaseHeaders.headers['cache-control'] ?? ''),
      'release metadata revalidates every request', releaseHeaders.headers['cache-control'] ?? '(none)');
  } catch (error) {
    check(false, 'deployed release metadata matches this checkout', String(error));
  }

  // ── Bundle origin ──
  // Which host the DEPLOYED build's data loaders prepend. Two ways to be wrong,
  // both silent in the browser:
  //   * the stamp has no bundleBase — a build from before the field existed, so
  //     nothing on the live site says where its data URLs go and the probes
  //     above had to guess (they used the local env);
  //   * the deployed base differs from what this checkout compiles in — most
  //     often '' (same-origin) from a build made on a clone without .env.local,
  //     which then asks the app host for /query/** and /datasets/** that live
  //     on R2. The gene explorer degrades to downloading every track bundle.
  const describe = (base: string | null) =>
    base === null ? '(not recorded)' : base === '' ? "'' (same-origin)" : base;
  check(
    STAMP.bundleBase !== null,
    'deployed build records its bundle origin',
    STAMP.bundleBase !== null
      ? `/version.json bundleBase: ${describe(STAMP.bundleBase)}`
      : `/version.json carries no bundleBase — this build predates the stamp, so the data probes above ` +
        `were aimed at the LOCAL env's origin (${describe(LOCAL_BUNDLE_BASE)}) rather than the one visitors use. ` +
        'Rebuild with `npm run deploy:dist` and re-upload dist/.',
  );
  // ── The production pairing, asserted independently of any local file ──
  //
  // The comparison below (deployed vs this checkout's env) has a hole big enough
  // to drive the original bug through: on a clone with NO .env.local, both sides
  // are '' , so a same-origin build — the exact defect — compares equal and the
  // gate goes green. Every signal it consults is absent in precisely the
  // situation that produces the defect, which makes it self-defeating rather
  // than merely incomplete.
  //
  // So for the production origin, state the requirement outright. This is the
  // one fact about this deployment that does not depend on anyone's working
  // copy: hypoexplorer.com serves its data from R2, full stop. A staging origin
  // passed as argv[2] is unaffected and still gets the env comparison only.
  //
  // Nor can the requirement be inferred by probing /datasets/ on the app origin:
  // public/_redirects now 302s those paths to R2, so a same-origin build's
  // requests still resolve 200 and the probe cannot tell the two apart.
  // Compared on the canonical origin, not the raw string: `https://hypoexplorer.com:443`
  // and a differently-cased host are the same site, and matching literally would let
  // either spelling skip this check and fall back to the comparison that passes when
  // both sides are empty — the very hole this exists to close.
  const PRODUCTION = { origin: 'https://hypoexplorer.com', bundleBase: 'https://data.hypoexplorer.com' };
  const canonical = (u: string) => { try { return new URL(u).origin.toLowerCase(); } catch { return u.toLowerCase(); } };
  if (canonical(ORIGIN) === canonical(PRODUCTION.origin) && STAMP.bundleBase !== null) {
    check(
      STAMP.bundleBase === PRODUCTION.bundleBase,
      'production serves data from the expected origin',
      STAMP.bundleBase === PRODUCTION.bundleBase
        ? `bundleBase ${PRODUCTION.bundleBase}`
        : `${PRODUCTION.origin} is serving a build whose data origin is ${describe(STAMP.bundleBase)}, but its ` +
          `data lives at ${PRODUCTION.bundleBase}. ` +
          (STAMP.bundleBase === ''
            ? 'A same-origin build reaches production only when it was built without .env.local. Its data URLs ' +
              'now hit public/_redirects and 302 to R2, so the site still works — it just pays an extra ' +
              'round trip on every bundle, and dist/ carries ~900 MB nothing serves.'
            : 'Check VITE_BUNDLE_BASE_URL in the environment that produced this build.'),
    );
  }

  // Only meaningful once the origin IS recorded; otherwise this would restate
  // the failure above.
  if (STAMP.bundleBase !== null) {
    check(
      STAMP.bundleBase === LOCAL_BUNDLE_BASE,
      'deployed bundle origin matches this checkout\'s build env',
      STAMP.bundleBase === LOCAL_BUNDLE_BASE
        ? `both ${describe(LOCAL_BUNDLE_BASE)}`
        : `deployed ${describe(STAMP.bundleBase)} != local ${describe(LOCAL_BUNDLE_BASE)} — ` +
          (STAMP.bundleBase === ''
            ? 'the live build compiled to same-origin, so it asks the app host for /query/tracks.js (404 since the ' +
              'R2 cutover) and every cross-dataset query falls back to downloading every track bundle. The usual ' +
              'cause is building on a checkout without the gitignored .env.local (VITE_BUNDLE_BASE_URL). '
            : 'the live build points its data URLs somewhere this checkout does not. ') +
          'Rebuild with `npm run deploy:dist` and re-upload dist/.',
    );
  }
}

// ── Query-manifest freshness ─────────────────────────────────────────────────
// A deploy that ships the app without re-uploading /query passes every check
// above while every cross-dataset query silently falls back to the full-
// download fan-out (manifestCovers / the freshness gates degrade to slow, by
// design) — a soft outage on mobile that nothing errors about. Fetch the
// DEPLOYED manifest and hold it to the union of the needs the app's fast
// paths gate on: gene/pathway query (coverage, trackCounts, contrast), the
// compare view (defaultTrack, contrast, exprScaffold) and the dataset catalog
// (defaultTrack, contrast). No metaFor: that lookup is browser-opportunistic.
//
// Probed at the SAME release cache key browsers use: an unversioned
// request is a distinct edge/browser cache entry, and right after an upload it
// can see the new object while every client stays pinned to the stale one for
// its TTL — a pass describing bytes no visitor downloads.
//
// Structural checks and buildId comparison diagnose stale indexes. The exact
// pointer-byte check below also catches metadata changes under the same buildId.
{
  type QueryManifest = Parameters<typeof manifestFreshness>[0] & { buildId?: string };
  const CHECK_NAME = 'deployed query manifest is fresh for this registry';
  const manifestUrl = `${DATA_ORIGIN}/query/tracks.js?v=${BUNDLE_VERSION}`;
  let detailOnFailure: string | null = null;
  let manifest: QueryManifest | null = null;
  try {
    const res = await fetchText(manifestUrl);
    if (res.status !== 200) {
      detailOnFailure = `${manifestUrl} -> ${res.status} — the query index is unreachable, so every `
        + 'cross-dataset query takes the slow full-download path. If /query was never uploaded to this '
        + 'origin, run `npm run upload:bundles`.';
    } else {
      const assignment = res.body.indexOf('=');
      if (assignment < 0) throw new Error('no assignment in tracks.js');
      const parsed: unknown = JSON.parse(res.body.slice(assignment + 1).trim().replace(/;\s*$/, ''));
      // Trust-boundary shape gate: a 200 whose payload parses but is not a
      // manifest (CDN error page, wrong object) must FAIL this check, not
      // throw past it and abort the whole report.
      if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { tracks?: unknown }).tracks)) {
        detailOnFailure = `${manifestUrl}: response parsed but has no tracks array — not a query manifest.`;
      } else {
        manifest = parsed as QueryManifest;
      }
    }
  } catch (error) {
    detailOnFailure = `${manifestUrl}: ${error instanceof Error ? error.message : String(error)} — `
      + 'could not read the deployed manifest; fix the origin problem before trusting this deploy.';
  }

  if (manifest) {
    const fresh = manifestFreshness(manifest, listDatasets(), [
      'coverage', 'trackCounts', 'defaultTrack', 'contrast', 'exprScaffold',
    ]);
    const problems = [...fresh.problems];

    let buildNote = '';
    try {
      const localTracks = readFileSync(path.resolve(__dirname, '..', 'public', 'query', 'tracks.js'), 'utf8');
      const localBuildId = localTracks.match(/"buildId"\s*:\s*"([a-z0-9]+)"/)?.[1] ?? null;
      if (localBuildId && manifest.buildId !== localBuildId) {
        problems.push(
          `deployed buildId "${manifest.buildId ?? '(none)'}" != local "${localBuildId}" — the deployed index `
          + 'is not the one this checkout built (stale-data replays pass every structural need; only the '
          + 'content-derived id catches them)',
        );
      } else if (localBuildId) {
        buildNote = `, buildId ${localBuildId} matches local`;
      }
    } catch {
      buildNote = ' (no local public/query/tracks.js — buildId comparison skipped)';
    }

    const shown = problems.slice(0, 3).join('; ');
    const more = problems.length > 3 ? ` (+${problems.length - 3} more)` : '';
    check(
      problems.length === 0,
      CHECK_NAME,
      problems.length === 0
        ? `${manifest.tracks.length} tracks indexed for ${listDatasets().length} registered datasets${buildNote}`
        : `${problems.length} problem(s): ${shown}${more} — ${REBUILD_HINT} `
          + '(NOTE: freshness is judged against THIS checkout\'s registry; from a checkout behind '
          + 'production, fix the checkout, not the deployment.)',
    );
  } else {
    check(false, CHECK_NAME, detailOnFailure ?? 'unknown failure');
  }
}

// Release labels are claims. Verify the actual objects at the browser's cache
// keys too. This is an exact pointer check plus two track samples, not a remote
// checksum of every shard/track in the full corpus.
for (const result of await verifyServedReleaseData(path.resolve(__dirname, '..'), {
  dataOrigin: DATA_ORIGIN, bundleVersion: BUNDLE_VERSION,
  querySha256: EXPECTED_RELEASE.dataBuildSha256, expressionBuildId: EXPECTED_RELEASE.expressionBuildId,
}, fetchBytes)) check(result.ok, result.name, result.detail);

// ── Deployed build identity ──────────────────────────────────────────────────
// dist/ is gitignored and uploaded by hand, so "did the upload actually happen"
// is a real and recurring question. The entry chunk's content hash answers it:
// compare what the live index.html references against what the local build
// emitted. A mismatch means the deployed site is not this checkout — which also
// means every other result above describes the OLD build.
let localEntry: string | null = null;
try {
  const localHtml = readFileSync(path.resolve(__dirname, '..', 'dist', 'index.html'), 'utf8');
  localEntry = localHtml.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1] ?? null;
} catch {
  // No local dist/ — nothing to compare against. Reported below, not failed.
}

const liveBody = (await fetchText(`${ORIGIN}/`)).body;
const liveEntry = liveBody.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1] ?? null;

if (localEntry && liveEntry) {
  check(
    localEntry === liveEntry,
    'deployed build matches local dist/',
    localEntry === liveEntry
      ? `both ${liveEntry}`
      : `live ${liveEntry} != local ${localEntry} — dist/ has not been uploaded since the last build ` +
        `(local package.json is v${pkg.version})`,
  );
} else {
  console.log(
    `  ·  deployed entry chunk: ${liveEntry ?? '(not found)'}` +
      `${localEntry ? '' : '  (no local dist/ to compare against)'}`,
  );
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log();
for (const { ok, name, detail } of results) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`        ${detail}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log(`\n${failed.length} FAILED:`);
  for (const f of failed) console.log(`  x ${f.name}`);
  process.exit(1);
}
