import { defineConfig, type ViteUserConfig } from 'vitest/config';
import type { TestSpecification } from 'vitest/node';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, sep } from 'node:path';
import { generateSeoPages, renderSeoRoute } from './scripts/lib/seoPages.mjs';
import { readQueryCatalogBuild } from './scripts/lib/queryCatalogBuild.mjs';
import { readExpressionIndexBuild } from './scripts/lib/expressionIndexBuildIdentity.mjs';
import { readReleaseBuild } from './scripts/lib/releaseBuild.mjs';
import type { ReleaseIdentity } from './src/data/releaseIdentity';
import { BRAND, BRAND_HEAD } from './src/common/brand';

const __dirname = dirname(fileURLToPath(import.meta.url));
function queryCatalogDefinitions(mode: string): Record<string, string> {
  // Tests supply their own observed and expected fixture catalog independently.
  if (mode === 'test') return { __QUERY_CATALOG_BUILD_ID__: JSON.stringify('test') };
  const catalog = readQueryCatalogBuild(resolve(__dirname, 'public/query/tracks.js'));
  return {
    __QUERY_CATALOG_BUILD_ID__: JSON.stringify(catalog.buildId),
    __QUERY_CATALOG_CONTENT__: JSON.stringify(catalog.content),
  };
}
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8'),
);
const APP_VERSION = pkg.version;

// ── Bundle byte sizes, measured at build time ───────────────────────────────
// A progress bar needs a DENOMINATOR, and the network cannot supply one here.
// Bundles ship compressed (brotli bytes stored on the R2 objects themselves,
// with Content-Encoding: br), so a response's Content-Length is the COMPRESSED
// size while a streaming reader yields DECOMPRESSED bytes — not comparable, and
// using the header as a total sends the bar past 100% a sixth of the way in.
//
// The uncompressed size is known exactly right here, from the files themselves,
// so it is measured once and inlined as __BUNDLE_SIZES__ (read by
// src/data/bundleSource.ts). Keys are request PATHS ('/datasets/<id>/<file>'):
// what the loaders ask for once BUNDLE_BASE and the ?v= bust are stripped, so
// the same map serves the same-origin and off-origin deploys alike. ~19 KB of
// JSON, ~2 KB over the wire, inlined at one reference site.
//
// Sizes are a HINT, never a gate. A URL missing from the map (a query shard, a
// bundle added after this build) loads exactly as before, just without a
// percentage — which is also what keeps this honest across a data-only
// redeploy, and the ?v= contract already requires an app rebuild for one.
function measureBundleSizes(): Record<string, number> {
  const root = resolve(__dirname, 'public');
  const sizes: Record<string, number> = {};
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        // Request paths are POSIX; resolve() hands back platform separators.
        sizes[`/${full.slice(root.length + 1).split(sep).join('/')}`] = statSync(full).size;
      }
    }
  };
  walk(resolve(root, 'datasets'));
  return sizes;
}

// Append ?v=<version> to the unhashed <script src="/..."> tags in index.html
// that eager-load data/metadata from /public. Vite hashes /assets/ for us, but
// these dataset bundles share filenames across deploys and were being served
// from browser cache after upgrades — leaving stale data inside a fresh UI
// bundle.
//
// Rather than asserting a fixed replacement count (which broke every time the
// eager set changed), we version each REQUIRED eager path explicitly and assert
// that each one was found and rewritten. Add/remove a dataset's eager bundle
// here when the default dataset changes.
//
// Deliberately EMPTY: index.html no longer eager-loads any dataset bundle. The
// default route is the landing hub, which reads none of that data, so the three
// tags that used to live here (meta.js, track_e9.js, track_e9.pathways.js) cost
// every visitor 3.78 MB of parser-blocking script for a page that renders a
// search box. Data is loaded on demand instead (see App's enter-explorer effect).
//
// An empty list is a legal no-op: the rewrite loop below never runs, and the
// drift guard finds no /datasets/ tags to complain about. Both guards stay armed
// so that reintroducing an eager tag without listing it here still fails loudly.
const REQUIRED_EAGER_SCRIPTS: string[] = [];

// Placeholder in index.html's <head> where the bundle origin's preconnect goes.
// Only meaningful when the bundles are served off-origin (R2/CDN): the browser
// otherwise discovers that origin only when the first bundle is requested, and
// pays a fresh DNS + TCP + TLS handshake right when it is most latency-sensitive.
const PRECONNECT_MARKER = '<!--BUNDLE_PRECONNECT-->';

function cacheBustPublicScripts(): Plugin {
  // Origin the eager tags load from. The runtime loaders already prepend
  // dataset.bundleBaseUrl (src/data/datasets.ts), but these <script> tags are
  // literal HTML that VITE_BUNDLE_BASE_URL cannot reach on its own — so when the
  // bundles move off-origin (R2/CDN) index.html would 404 unless we rewrite them
  // here too. Empty = app-relative, matching the same-origin default.
  let bundleBase = '';
  return {
    name: 'cache-bust-public-scripts',
    apply: 'build',
    configResolved(config) {
      // Strip any trailing slash, matching BUNDLE_BASE in src/data/datasets.ts.
      // The paths below are absolute, so "https://host/" would produce
      // "https://host//datasets/..." and 404 on every eager bundle.
      bundleBase = ((config.env.VITE_BUNDLE_BASE_URL as string | undefined) ?? '').replace(/\/+$/, '');
    },
    transformIndexHtml(html: string) {
      // Guard the OTHER direction too. The loop below asserts every listed path
      // exists in index.html; without this check the reverse drift is silent —
      // an eager tag added to index.html but not listed here gets no ?v= and no
      // bundle base. That is exactly how track_e9.pathways.js went unversioned,
      // and now that bundles are off-origin an unlisted tag keeps pointing at the
      // app host and 404s in production instead of merely serving stale.
      const eagerRe = /<script\s+src="(\/datasets\/[^"]+)"/g;
      const unlisted: string[] = [];
      let m: RegExpExecArray | null = eagerRe.exec(html);
      while (m !== null) {
        if (!REQUIRED_EAGER_SCRIPTS.includes(m[1])) unlisted.push(m[1]);
        m = eagerRe.exec(html);
      }
      if (unlisted.length > 0) {
        throw new Error(
          `cache-bust-public-scripts: index.html eager-loads ${unlisted.join(', ')} but ${unlisted.length > 1 ? 'they are' : 'it is'} missing from REQUIRED_EAGER_SCRIPTS. Add ${unlisted.length > 1 ? 'them' : 'it'} so the bundle base + ?v= cache-bust apply.`,
        );
      }

      let result = html;
      for (const path of REQUIRED_EAGER_SCRIPTS) {
        let replaced = 0;
        const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`<script\\s+src="${escaped}"`, 'g');
        result = result.replace(re, () => {
          replaced++;
          return `<script src="${bundleBase}${path}?v=${APP_VERSION}"`;
        });
        if (replaced !== 1) {
          throw new Error(
            `cache-bust-public-scripts: expected exactly 1 eager <script> for ${path}, got ${replaced}. Check index.html.`,
          );
        }
      }

      // Warm the bundle origin's connection during head parse. Skipped entirely
      // when bundles are same-origin (empty base) — preconnecting to your own
      // origin is a no-op that only costs a wasted line of HTML. NO `crossorigin`
      // attribute: the loaders inject classic <script> tags without one (no-cors),
      // and browsers segregate connections by CORS mode — a crossorigin preconnect
      // would warm a CORS socket those fetches never reuse, wasting the hint.
      const preconnect = bundleBase
        ? `<link rel="preconnect" href="${new URL(bundleBase).origin}" />`
        : '';
      result = result.replace(PRECONNECT_MARKER, preconnect);

      return result;
    },
  };
}

// Drop the data trees from the build output when the app is configured to load
// them from somewhere else.
//
// Vite copies all of public/ into dist/, which means a build with
// VITE_BUNDLE_BASE_URL pointed at R2 still emits a 386 MB copy of
// public/datasets (plus ~51 MB of public/query and ~128 MB of public/qc PDFs)
// that NOTHING will ever request: every loader — and QCTab's QA-report modal —
// prepends the bundle base, so those bytes are dead weight in the artifact —
// slower builds, slower deploy uploads, and a deploy target that has to store
// the corpus twice.
//
// Only runs when the base URL is set. With the default empty base the bundles
// ARE served from the app host, so they must stay — but since the R2 cutover
// that is never what production wants, so an empty base gets a loud warning
// rather than silence. The build still succeeds: a same-origin build is a
// legitimate way to stage the site somewhere self-contained. What it must not
// be is an accident, and it was one once — a dist built on a checkout without
// the gitignored .env.local went live, asked hypoexplorer.com for
// /query/tracks.js (404), and every gene lookup fell back to downloading all
// 200-odd track bundles while nothing errored.
function dropOffOriginData(): Plugin {
  let bundleBase = '';
  let outDir = 'dist';
  return {
    name: 'drop-off-origin-data',
    apply: 'build',
    configResolved(config) {
      bundleBase = ((config.env.VITE_BUNDLE_BASE_URL as string | undefined) ?? '').replace(/\/+$/, '');
      outDir = config.build.outDir;
      if (!bundleBase) {
        console.warn(
          '\n[drop-off-origin-data] VITE_BUNDLE_BASE_URL is EMPTY: this build is SAME-ORIGIN. It will request ' +
          '/datasets/**, /query/** and /qc/** from the app host and ship them inside dist/. Production serves ' +
          'data from R2 — if this dist is headed for hypoexplorer.com, create .env.local with ' +
          'VITE_BUNDLE_BASE_URL=https://data.hypoexplorer.com and rebuild. `npm run verify:deploy` will ' +
          'reject the upload otherwise.\n',
        );
      }
    },
    closeBundle() {
      if (!bundleBase) return;
      for (const dir of ['datasets', 'query', 'qc']) {
        const target = resolve(__dirname, outDir, dir);
        if (!existsSync(target)) continue;
        rmSync(target, { recursive: true, force: true });
        // Loud on purpose: silently deleting a third of a gigabyte from the
        // build output is exactly the kind of thing someone needs to see when
        // they are debugging a 404.
        console.log(
          `[drop-off-origin-data] removed ${outDir}/${dir}/ — VITE_BUNDLE_BASE_URL is set (${bundleBase}), ` +
          `so it is served from there. Upload public/${dir}/ to that origin with \`npm run upload:bundles\`.`,
        );
      }
    },
  };
}

// Emit the deploy's version stamp next to index.html.
//
// This is the ground truth for "what is the origin serving right now", and it is
// what src/pwa/versionWatch.ts polls to decide whether a tab is running an old
// build. It exists because the service-worker update path cannot answer that
// question in the two cases where the answer matters most: when no worker ever
// registers (blocked, private mode, insecure context) and when the installed
// worker is wedged serving a precached shell from an earlier deploy.
//
// Deliberately a separate file rather than a header or a marker inside
// index.html: index.html is what a wedged worker precaches, so reading the
// version out of it would report the STALE version and the check would pass
// while broken. A distinct URL, excluded from precache (globPatterns covers only
// js/css/html) and routed NetworkOnly below, always reaches the origin.
//
// Kept in lockstep with __APP_VERSION__ by construction: both read package.json
// here, so the comparison in versionWatch is between the same two numbers.
//
// The stamp also records the bundle origin this build was compiled against
// (`bundleBase`, '' for same-origin). It is the only place a deploy states which
// host its data URLs point at, and it exists because the failure it witnesses
// is silent: a build made without the gitignored .env.local compiles to
// same-origin, asks the app host for /query/tracks.js, gets a 404, and every
// cross-dataset query falls back to downloading every track bundle — while the
// site loads, the data is right, and nothing errors. verify_deploy.mts reads
// this field and probes the origin the DEPLOYED build uses, not the one the
// local env happens to name.
function emitVersionManifest(release: ReleaseIdentity | null): Plugin {
  let bundleBase = '';
  return {
    name: 'emit-version-manifest',
    apply: 'build',
    configResolved(config) {
      // Same normalisation as src/data/bundleBase.ts, so the stamp says what the
      // loaders actually prepend.
      bundleBase = ((config.env.VITE_BUNDLE_BASE_URL as string | undefined) ?? '').replace(/\/+$/, '');
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version: APP_VERSION, bundleBase, releaseId: release?.releaseId })}\n`,
      });
      if (release) this.emitFile({
        type: 'asset', fileName: 'release.json',
        source: `${JSON.stringify({ ...release, bundleBase }, null, 2)}\n`,
      });
      for (const name of ['CITATION.cff', 'REUSE.md', 'LICENSE']) {
        if (existsSync(resolve(__dirname, name))) this.emitFile({
          type: 'asset', fileName: name, source: readFileSync(resolve(__dirname, name)),
        });
      }
    },
  };
}

// NOTE ON WORKBOX MATCHERS — READ BEFORE EDITING runtimeCaching BELOW.
//
// workbox-build serialises each `urlPattern` function with `Function.toString()`
// and injects the SOURCE TEXT into the generated sw.js. It does NOT capture the
// surrounding closure. Any identifier a matcher references from module scope is
// therefore UNDEFINED inside the service worker.
//
// That bit us: a previous `API_HOSTS` Set declared here was referenced from the
// matcher body, so the emitted sw.js contained `API_HOSTS.has(e.host)` with no
// definition anywhere in the file. workbox-routing's findMatchingRoute calls
// matchers with no try/catch, so EVERY request whose pathname was not /api/ or
// /auth/ threw a ReferenceError that escaped the fetch listener before
// respondWith — silently disabling the service worker for all other requests and
// making any route registered after it dead code.
//
// Rule: matcher bodies must be SELF-CONTAINED. Inline literals only. Anything a
// matcher needs is spelled out inside its own body, even at the cost of
// duplication between here and the array below.
//
// Hosts that serve API/auth responses carrying tokens or PII must never be
// cached. There are none today (the app loads only static data); if you add one,
// put the literal string inside the NetworkOnly matcher body below — not here.

// Dev-only review-state persistence for the Dataset Tracker.
//
// On the published static site the tracker is READ-ONLY — its review state is
// baked into the build from src/data/tracker/reviews.json. Locally, this plugin
// exposes GET/POST /api/tracker/reviews so edits in the dev UI write straight back
// to that same tracked file ("commit -> rebuild -> served", no export step).
//
// `apply: 'serve'` means it exists ONLY under `vite`/`vite dev`; `vite build`
// never includes it, so production literally has no endpoint. The client mirrors
// this with an `import.meta.env.DEV` guard in reviewStore.js.
function trackerReviewsApi(): Plugin {
  const REVIEWS = resolve(__dirname, 'src/data/tracker/reviews.json');
  const MAX_BODY = 5 * 1024 * 1024; // cap review payloads at 5 MB (dev-only DoS guard)
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((res, rej) => {
      let d = '';
      req.on('data', (c) => {
        d += c;
        if (d.length > MAX_BODY) { rej(new Error('payload too large')); req.destroy(); }
      });
      req.on('end', () => res(d));
    });
  return {
    name: 'tracker-reviews-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (url !== '/api/tracker/reviews') return next();
        const json = (code: number, obj: unknown) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(obj));
        };
        try {
          if (req.method === 'GET') {
            let data = {};
            try { if (existsSync(REVIEWS)) data = JSON.parse(readFileSync(REVIEWS, 'utf-8')); } catch { /* unreadable/empty file -> empty reviews */ }
            return json(200, data);
          }
          if (req.method === 'POST' || req.method === 'PUT') {
            const body = await readBody(req);
            const obj = JSON.parse(body || '{}');
            // Only accept a plain object map (acc -> {status,note,...}); reject
            // arrays/scalars so a stray POST can't corrupt the baked reviews file.
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
              return json(400, { error: 'reviews payload must be a JSON object' });
            }
            mkdirSync(dirname(REVIEWS), { recursive: true });
            writeFileSync(REVIEWS, JSON.stringify(obj, null, 2));
            return json(200, { ok: true, n: Object.keys(obj).length });
          }
          return json(405, { error: 'method not allowed' });
        } catch (e) {
          return json(500, { error: String((e as Error)?.message || e) });
        }
      });
    },
  };
}

/** Emit the public study documents before the service worker is generated. */
function publicStudyPages(): Plugin {
  let outDir = '';
  return {
    name: 'public-study-pages',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (!/^\/(?:studies|about|topics|methods|how-to-cite)(?:\/|$)/.test(pathname)
          && pathname !== '/robots.txt' && pathname !== '/sitemap.xml') return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const document = renderSeoRoute(pathname);
        res.statusCode = document ? 200 : 404;
        res.setHeader('Content-Type', document?.contentType ?? 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(req.method === 'HEAD' ? undefined : document?.body ?? 'Page not found');
      });
    },
    writeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        generateSeoPages(outDir);
      },
    },
  };
}

// ── Test environments and scheduling ────────────────────────────────────────
// Logic, data and build-script tests (.ts) run in Node; component tests (.tsx)
// keep jsdom. Constructing a jsdom window is a fixed cost per test file that
// bought those files nothing, and under a full parallel run it was the largest
// single component of the suite's time. A .ts file that does touch the DOM opts
// back in with a `// @vitest-environment jsdom` docblock, which Vitest reads
// before the project's environment. The `node` and `jsdom` test projects below
// split the files by extension.
const NODE_TEST_FILES = 'src/**/*.test.ts';
const ENVIRONMENT_DOCBLOCK = /@(?:vitest|jest)-environment\s+?([\w-]+)\b/;

// The environment Vitest will give `spec`: its docblock, else its project's.
function testEnvironment(spec: TestSpecification): string {
  return ENVIRONMENT_DOCBLOCK.exec(readFileSync(spec.moduleId, 'utf8'))?.[1] ?? spec.project.name;
}

// Vitest hands out its pool one environment group at a time — every file of the
// first environment to appear in the sorted list, then the next — so its
// longest-first ordering only holds WITHIN a group. With jsdom first, the Node
// group's slowest files (evidence checks that re-hash retained sources) were
// handed out only after the last component test, and ended the run on their own.
// Queue the Node group first: it is mostly quick files, so the long component
// tests still start within seconds and the two groups' longest files overlap.
//
// Loaded only for tests: vitest/node costs over a second to import, and dev and
// build have no use for it.
async function nodeFirstSequencer() {
  const { BaseSequencer } = await import('vitest/node');
  return class NodeFirstSequencer extends BaseSequencer {
    async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
      const sorted = await super.sort(files);
      const inNode = new Set(sorted.filter((spec) => testEnvironment(spec) === 'node'));
      return [...inNode, ...sorted.filter((spec) => !inNode.has(spec))];
    }
  };
}

export default defineConfig(async ({ mode }): Promise<ViteUserConfig> => {
  const release = mode === 'test' ? null : readReleaseBuild(__dirname);
  return ({
  // Keep dependency prebundles local when worktrees share installed packages.
  cacheDir: '.tmp/vite',
  // Tests assume same-origin bundles: locator tests assert bare /datasets/...
  // URLs, and defineDataset() derives every bundleBaseUrl from
  // VITE_BUNDLE_BASE_URL. Since the R2 cutover a developer's .env.local
  // normally points that at the R2 origin, and vitest inherits Vite's env-file
  // loading (vi.stubEnv cannot help: import.meta.env is baked at transform
  // time, before setup files run). Diverting envDir to a directory with no
  // .env files makes the suite independent of the machine's deploy config.
  // Tests that exercise off-origin behavior set bundleBaseUrl explicitly.
  envDir: mode === 'test' ? resolve(__dirname, 'src/__tests__') : undefined,
  plugins: [
    react(),
    {
      name: 'brand-identity',
      transformIndexHtml: (html) => html.replace('<!--BRAND_HEAD-->', BRAND_HEAD),
    },
    cacheBustPublicScripts(),
    dropOffOriginData(),
    emitVersionManifest(release),
    publicStudyPages(),
    trackerReviewsApi(),
    VitePWA({
      // "prompt": a freshly deployed SW installs and parks in "waiting" instead
      // of activating immediately, and the APP decides when to call
      // updateSW(true) (SKIP_WAITING + reload).
      //
      // NOT the same thing as an optional update. Updating is mandatory —
      // <UpdateModal> cannot be dismissed and reloads on a countdown — but the
      // app must own the moment it happens, which "autoUpdate" does not allow:
      // that mode activates the new worker and reloads the page the instant it
      // installs, mid-task, with no notice. "prompt" + a non-dismissable modal
      // gives the same guarantee (no tab keeps running a superseded build) while
      // the user still sees what is about to happen and why.
      registerType: 'prompt',
      // We register the SW ourselves from src/pwa/registerUpdates.js, so tell
      // the plugin not to inject its own registration script.
      injectRegister: null,
      includeAssets: ['brand/v1/*.png', 'brand/v1/brand.css', 'favicon.ico'],
      manifest: {
        name: 'HypoExplorer',
        short_name: 'HypoExplorer',
        description: 'Explore hypothalamic gene expression and biological pathways.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: BRAND.themeColor,
        background_color: '#FFFFFF',
        icons: [
          { src: '/brand/v1/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/brand/v1/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        // Precache the app shell only: the Vite-built bundle + index.html.
        globPatterns: ['**/*.{js,css,html}'],
        // The /public data blobs are large and already cache-busted via
        // ?v=<version> at request time — precaching them would bloat the install
        // to hundreds of MB and fight that scheme. Keep them out of precache; the
        // SW lets them pass to the network as today. This covers the relocated
        // per-dataset bundles under /datasets/** as well as the legacy compat
        // shims at /pop_*.js and /qc_global.js, and the sharded query index.
        //
        // The lazily-imported chunks are excluded for a DIFFERENT reason:
        // globPatterns '**/*.js' would otherwise precache them, and precaching
        // downloads at SW INSTALL. That hands back exactly what the dynamic
        // import() was introduced to defer — the chunk stays off the critical
        // rendering path but is still fetched on every first visit, which is
        // most of what we were trying to avoid.
        //
        //   xlsx (419 KB) + html2canvas (198 KB) — reached only from export
        //     click handlers.
        //   charts (319 KB, recharts + d3) + BarSEMChartImpl — reached only when
        //     a chart mounts, i.e. never on the landing hub.
        //
        // Precaching `charts` would buy offline charting, which is worth little
        // here: the charts have nothing to draw without the dataset bundles,
        // and those are deliberately not precached either. Let them arrive on
        // demand; the runtime CacheFirst rules do not match /assets/, so they
        // use the normal HTTP cache and are hashed, hence immutable.
        globIgnores: [
          'pop_*.js', 'qc_global.js', 'qc/**', 'datasets/**', 'query/**', 'tracker/**',
          // Public documents load independently; do not download the entire
          // study directory every time somebody installs the app shell.
          'studies/**', 'about/**', 'topics/**', 'methods/**', 'how-to-cite/**',
          // The nomenclature table (2.4 MB + 5.8 MB) is reference data that most
          // sessions never touch: the alias file loads on the first gene search
          // and the full table only when its page is opened. Precaching would
          // charge every visitor 8 MB at service-worker install for a page they
          // may never visit — the same reason the dataset bundles are excluded.
          'nomenclature/**',
          'assets/xlsx-*.js', 'assets/html2canvas-*.js',
          'assets/charts-*.js', 'assets/BarSEMChartImpl-*.js',
        ],
        // Complete QC evidence is about 4.04 MiB after minification. Keep it
        // available offline alongside the shell, with room for additional notes.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Take control of pages that no worker is currently controlling, as
        // soon as this worker activates.
        //
        // NOT the same switch as skipWaiting, which stays off: activation is
        // still gated on the app sending SKIP_WAITING, so "prompt" semantics are
        // untouched — a new worker cannot jump in front of a running session.
        // This only decides who controls a page that has NO controller once the
        // handover the user asked for has already happened.
        //
        // It is load-bearing for the reload. An uncontrolled page (hard reload,
        // a first visit the installing worker never claimed, the tab
        // forceRefresh() leaves behind) gets no controllerchange event without
        // it, and controllerchange is the signal registerUpdates.ts reloads on.
        // Without this, those tabs could accept an update and then sit there —
        // the "spinning forever" report. registerUpdates.ts still carries a
        // timeout for the cases this cannot reach.
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // The app uses hash routes, so only the root document needs a fallback.
        // Static study/About pages and unknown paths must retain their own HTML
        // or HTTP 404, including when a service worker controls the browser.
        navigateFallback: 'index.html',
        navigateFallbackAllowlist: [/^\/(?:index\.html)?(?:\?.*)?$/],
        // …but never for the static data files or API/auth requests.
        navigateFallbackDenylist: [/^\/datasets\//, /^\/query\//, /^\/tracker\//, /^\/nomenclature\//, /^\/pop_/, /^\/qc_global/, /^\/qc\//, /^\/api\//, /^\/auth\//],
        // Route order IS match order (workbox-routing iterates registration
        // order and takes the first hit), so the deny rule must come FIRST.
        runtimeCaching: [
          {
            // API/auth responses may carry tokens or PII — NEVER cache them.
            // NetworkOnly stores nothing. Add sensitive hosts to the inlined
            // array literal (see the self-contained-matcher note above).
            urlPattern: ({ url }) =>
              /^\/(api|auth)\//.test(url.pathname) ||
              ([] as string[]).includes(url.host),
            handler: 'NetworkOnly',
            method: 'GET',
          },
          {
            // version.json is the deploy's version stamp (emitVersionManifest
            // above), polled by src/pwa/versionWatch.ts to detect a tab running
            // an old build. Caching it would defeat the check exactly when it is
            // needed: a wedged worker would answer from its own cache and report
            // the stale version as current, forever. NetworkOnly, no exceptions
            // — a failed fetch is already handled as "unknown", not "up to date".
            urlPattern: ({ url }) => /(^|\/)(?:version|release)\.json$/.test(url.pathname),
            handler: 'NetworkOnly',
            method: 'GET',
          },
          {
            // Both mutable query pointers have a five-minute lifetime, aligned
            // with the max-age=300 the uploader stores on those R2 objects.
            //
            // It names the build id that every shard URL is derived from, so a
            // client holding a stale copy keeps requesting the previous build's
            // shards — which still exist, still verify, and still answer
            // correctly, so the staleness is silent and could otherwise persist
            // for as long as the entry lived. StaleWhileRevalidate keeps the
            // instant response for a recent entry while refreshing in the
            // background. Older entries expire after five minutes.
            //
            // MUST precede the shard rule below: that one matches any /query/
            // path, including this one.
            urlPattern: ({ url }) => /(^|\/)query\/(?:tracks|expression-manifest)\.js$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            method: 'GET',
            options: {
              cacheName: 'hypoexplorer-query-manifest',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 4, maxAgeSeconds: 300 },
            },
          },
          {
            // The sharded query index: ~770 files of 40–140 KB, published under
            // an immutable /query/<buildId>/ prefix, so a given URL's bytes never
            // change and CacheFirst-for-a-year is exactly right.
            //
            // Split into its OWN cache from the track bundles because workbox
            // evicts by ENTRY COUNT, not bytes — sharing one cache would let a
            // handful of 10 MB bundles evict hundreds of tiny index shards, or
            // vice versa, and neither working set would stay warm. Two caches let
            // each get an entry budget matched to its own object size.
            urlPattern: ({ url }) => /(^|\/)query\//.test(url.pathname),
            handler: 'CacheFirst',
            method: 'GET',
            options: {
              cacheName: 'hypoexplorer-query-index',
              cacheableResponse: { statuses: [200] },
              expiration: {
                // ~140 KB worst case per shard, so 400 entries is well under
                // 60 MB and comfortably holds any realistic session's lookups.
                // Entries from superseded builds age out on their own.
                maxEntries: 400,
                maxAgeSeconds: 60 * 60 * 24 * 365,
                purgeOnQuotaError: true,
              },
            },
          },
          {
            // The nomenclature table. Ships with the APP rather than with the
            // bundles (it is committed under public/nomenclature/ and is not in
            // dropOffOriginData's list), so it is always same-origin and always
            // in step with the UI reading it. Immutable for a given ?v= exactly
            // like a dataset bundle, hence CacheFirst — but its own cache, since
            // two large entries sharing the bundles' 40-entry budget would evict
            // tracks the user is actually browsing.
            urlPattern: ({ url }) => /(^|\/)nomenclature\//.test(url.pathname),
            handler: 'CacheFirst',
            method: 'GET',
            options: {
              cacheName: 'hypoexplorer-nomenclature',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 6, maxAgeSeconds: 60 * 60 * 24 * 365, purgeOnQuotaError: true },
            },
          },
          {
            // Dataset bundles: immutable for a given ?v=, and by far the
            // heaviest thing the app fetches. CacheFirst because a versioned URL
            // never changes content — revalidating it would waste a round trip
            // on every open. Matches on the /datasets/ path segment regardless
            // of origin, so it covers both the same-origin default and an
            // off-origin R2/CDN base URL.
            urlPattern: ({ url }) => /(^|\/)datasets\//.test(url.pathname),
            handler: 'CacheFirst',
            method: 'GET',
            options: {
              // Must NOT contain '-precache-': cleanupOutdatedCaches deletes any
              // cache whose name carries that substring on every SW activate.
              cacheName: 'hypoexplorer-data-bundles',
              // Only real 200s. Deliberately NOT [0, 200]: the loaders inject
              // classic <script> tags with no crossorigin attribute, so an
              // off-origin bundle comes back OPAQUE (type 'opaque', status 0).
              // Caching opaques here would (a) store an opaque 404 as a
              // permanent "valid" entry under CacheFirst and (b) charge ~7 MB of
              // quota padding per entry. Same-origin deploys get the full win
              // today; to extend it off-origin, set a CORS policy on the bucket
              // and give the injected scripts crossOrigin='anonymous' so the
              // responses become inspectable 200s.
              cacheableResponse: { statuses: [200] },
              expiration: {
                // Bundles run 1–10 MB each. 40 entries is roughly 100–250 MB —
                // enough to keep a browsing session's tracks warm without
                // letting one dataset sweep sit on a quarter of the user's quota
                // forever. Cross-dataset queries no longer land here at all:
                // they resolve from the query index above, so this cache now
                // only holds tracks the user actually opened in the explorer.
                maxEntries: 40,
                maxAgeSeconds: 60 * 60 * 24 * 365,
                purgeOnQuotaError: true,
              },
            },
          },
        ],
      },
      // The production SW is generated by `vite build`. Dev defaults to disabled
      // (registerUpdates() also no-ops in dev), so dev keeps fast HMR with no SW.
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    ...(release ? { __RELEASE_IDENTITY__: JSON.stringify(release) } : {}),
    __BUNDLE_SIZES__: JSON.stringify(measureBundleSizes()),
    ...queryCatalogDefinitions(mode),
    ...(mode === 'test' ? {} : {
      __EXPRESSION_INDEX_BUILD_ID__: JSON.stringify(readExpressionIndexBuild(resolve(__dirname, 'public/query/expression-manifest.js'))),
    }),
    // Tests must resolve the same dataset registry on every machine. The test
    // envDir above keeps .env.local out of Vite's OWN env loading, but an
    // AMBIENT process-level VITE_BUNDLE_BASE_URL still reaches import.meta.env
    // (vitest folds process.env in on top), and a parent process that exported
    // it is a real path here: Bun auto-loads .env.local, so any gstack tool
    // wrapping the suite hands the R2 origin down and flips every entry of the
    // datasetsRegistry golden. Runtime pins (test.env, setup-file deletes)
    // lose that race, so replace the expression at TRANSFORM time instead —
    // under `define`, bundleBase.ts never reads the environment in test mode.
    ...(mode === 'test' ? { 'import.meta.env.VITE_BUNDLE_BASE_URL': '""' } : {}),
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'recharts', 'xlsx', 'html2canvas'],
  },
  server: {
    fs: { allow: ['.'] },
    // Launchers (the desktop preview, autoPort) pick a free port and pass it
    // as PORT; honour it strictly so the dev server never drifts onto a port
    // another project already holds on the other IP stack.
    ...(process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : {}),
  },
  build: {
    rolldownOptions: {
      output: {
        // Keep the heavyweight, feature-specific libraries in their OWN chunks
        // rather than melting them into one `vendor` blob.
        //
        // A catch-all `node_modules -> 'vendor'` rule does not just group code,
        // it OVERRIDES code splitting: a dynamic import() of a package named
        // here is still emitted into the shared chunk, so it loads eagerly and
        // the lazy import buys nothing. These three are export/chart-only —
        // xlsx and html2canvas are reached solely from export click handlers —
        // so they must be splittable to stay off the first-paint path.
        manualChunks: (id) => {
          // Keep the complete evidence ledgers in separate cached files so
          // accumulated QC notes do not push the app shell over its size limit.
          const path = id.replace(/\\/g, '/');
          if (path.endsWith('/data/internal-qc/assessments.generated.json')) return 'internal-qc-evidence';
          if (path.endsWith('/data/author-validation/validation-records.generated.json')) return 'author-validation-evidence';
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('node_modules/xlsx')) return 'xlsx';
          if (id.includes('node_modules/html2canvas')) return 'html2canvas';
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-') || id.includes('node_modules/victory-vendor')) return 'charts';
          return 'vendor';
        },
      },
    },
  },
  test: {
    // See "Test environments and scheduling" above. Both projects extend this
    // block; only their file sets and environments differ. Keep discovery
    // inside the application tree: local gstack state can be an ACL-protected
    // directory on Windows, and asking Vitest to traverse the whole repository
    // makes an unrelated tool cache capable of aborting every test.
    projects: [
      { extends: true, test: { name: 'node', environment: 'node', include: [NODE_TEST_FILES] } },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          exclude: [NODE_TEST_FILES],
        },
      },
    ],
    sequence: mode === 'test' ? { sequencer: await nodeFirstSequencer() } : undefined,
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    // The two SHA-256-pinned evidence tests read bytes the R 4.6.0 regeneration
    // replaced; src/__tests__/sealedEvidenceProjection.test.ts runs them under the
    // supersession projection instead (data/quality/regeneration-r460-2026-09-25/README.md).
    exclude: ['**/.gstack/**', 
      // Public repository: these read retained evidence or pre-publication git history.
      'src/__tests__/analysisCorpusIntegrity.test.ts', 'src/__tests__/concordanceReviewEvidence.test.ts', 'src/__tests__/matrixShape.test.ts', 'src/__tests__/seoStudyContent.test.ts', 'src/__tests__/agentExport.test.ts', 'src/__tests__/existingExpression.test.ts', 'src/__tests__/expressionIndex.test.ts', 'src/__tests__/dedicatedReplicationEvidence.test.ts', 'src/__tests__/keyedSourceRelationship.test.ts', 'src/__tests__/qualityConsistency.test.ts', 'src/__tests__/replicationEvidence.test.ts', 'src/__tests__/reviewedReplicationMapping.test.ts', 'src/__tests__/reviewedTextEvidence.test.ts', 'src/__tests__/sealedEvidenceProjection.test.ts', 'src/__tests__/verificationAdvancement.test.ts', 'src/__tests__/countConservationEvidence.test.ts', 'src/__tests__/reviewedFgseaSpecies.test.ts',
      'src/__tests__/countConservationEvidence.test.ts', 'src/__tests__/reviewedFgseaSpecies.test.ts'],
    // Raised from the 5 s default because code-splitting moved real work INTO
    // the timed window. recharts (the largest dependency in the app) used to be
    // evaluated when GeneExplorerTab imported BarSEMChart at module-load time,
    // which vitest does not time; it is now behind a dynamic import() that runs
    // inside whichever test first mounts a chart. Evaluating it can exceed 5 s on
    // a busy machine with workers competing, which surfaced as unrelated tests
    // (app.contrast, barSEMChart's beforeAll) timing out intermittently while
    // passing in isolation.
    //
    // This is a budget for real work, not cover for a hang: a genuinely stuck
    // test still fails, 10 s later.
    testTimeout: 15000,
    hookTimeout: 15000,
  },
  });
});
