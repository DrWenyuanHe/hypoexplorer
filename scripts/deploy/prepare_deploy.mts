// Make sure a production build has every gitignored input it ships, before
// `pnpm run deploy:cf` builds and uploads it.
//
//   pnpm run prepare:deploy                   # fetch what is missing, refuse on a mismatch
//   pnpm run prepare:deploy --refresh-query   # replace a local query catalog with the origin's
//
// HYPOEXPLORER_APP_ORIGIN overrides the app host the tracker catalog and atlases
// are fetched from (default https://hypoexplorer.com).
//
// A fresh clone has none of these inputs, and a build without them either fails
// (no public/query/tracks.js) or succeeds without the reference atlases and the
// tracker catalog, which a deploy would then remove from the live site. See
// scripts/lib/deployInputs.mts for what each one is.
//
// - Query catalog: the deployed app must pin the catalog the data origin serves.
//   A missing local catalog is fetched from the origin. A local catalog that
//   differs from the origin's (one built by build:query-index or data:offline,
//   or one fetched before the last upload) stops the deploy: upload it first, or
//   pass --refresh-query to take the origin's.
// - Tracker catalog: fetched from the app host when missing.
// - Reference atlases: any missing or incomplete atlas is fetched from the app
//   host (pnpm run fetch:expression <atlas>), or, for an atlas whose source is
//   tracked here (HYPOMAP Visium), built from it. A complete local atlas is
//   kept, so a rebuilt atlas (build:expression-external) deploys as built.
//
// Exits non-zero, having changed nothing it could not verify, if any input is
// still missing afterwards.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { ATLAS_DIRS, atlasProblems, BUILT_ATLASES, TRACKER_CATALOG } from '../lib/deployInputs.mjs';
import { diskOrigin, httpOrigin, readQueryGeneration } from '../lib/queryGeneration.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = path.join(ROOT, 'public');
const refreshQuery = process.argv.includes('--refresh-query');
const app = (process.env.HYPOEXPLORER_APP_ORIGIN || 'https://hypoexplorer.com').replace(/\/+$/, '');
// The origin `vite build` compiles in, resolved the way Vite resolves it.
const bundleBase = (loadEnv('production', ROOT, 'VITE_').VITE_BUNDLE_BASE_URL ?? '').replace(/\/+$/, '');

const local = (relative: string) => path.join(PUBLIC, relative);
const readLocal = (relative: string) => existsSync(local(relative)) ? readFileSync(local(relative), 'utf8') : null;
function writeLocal(relative: string, text: string): void {
  mkdirSync(path.dirname(local(relative)), { recursive: true });
  writeFileSync(local(relative), text);
  console.log(`  wrote public/${relative} (${text.length.toLocaleString()} bytes)`);
}
async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

const failures: string[] = [];

// ── Query catalog ────────────────────────────────────────────────────────────
console.log(`Query catalog (data origin ${bundleBase || 'same-origin'})`);
if (!bundleBase) {
  // A same-origin build ships public/query itself, so there is no origin to
  // match; it must still hold one complete, consistent generation.
  await readQueryGeneration(diskOrigin(PUBLIC)).catch((error: Error) => failures.push(`${error.message}; build the indexes first`));
} else {
  const remote = await readQueryGeneration(httpOrigin(bundleBase, { headers: { 'cache-control': 'no-cache' } }));
  const pointers = [remote.tracks!, remote.expression];
  const present = pointers.filter((pointer) => readLocal(pointer.key) !== null);
  const differing = pointers.filter((pointer) => {
    const text = readLocal(pointer.key);
    return text !== null && text.replace(/\r\n/g, '\n') !== pointer.text.replace(/\r\n/g, '\n');
  }).map((pointer) => pointer.key);
  if (differing.length && !refreshQuery) {
    failures.push(
      `public/${differing.join(' and public/')} ${differing.length === 1 ? 'differs' : 'differ'} from ${bundleBase}. The deployed app would pin an index `
      + 'the data origin does not serve. Publish the local index first (pnpm run upload:bundles), or take the '
      + "origin's with pnpm run prepare:deploy --refresh-query (or pnpm run fetch:query).",
    );
  } else {
    if (present.length < pointers.length || differing.length) {
      for (const pointer of pointers) writeLocal(pointer.key, pointer.text);
    } else {
      console.log('  public/query matches the data origin');
    }
    if (!readLocal(remote.expressionManifest.key)) writeLocal(remote.expressionManifest.key, remote.expressionManifest.text);
  }
}

// ── Tracker catalog ──────────────────────────────────────────────────────────
console.log('Tracker catalog');
if (readLocal(TRACKER_CATALOG) === null) writeLocal(TRACKER_CATALOG, await fetchText(`${app}/${TRACKER_CATALOG}`));
else console.log(`  public/${TRACKER_CATALOG} present`);

// ── Reference atlases ────────────────────────────────────────────────────────
console.log('Reference atlases');
const require = createRequire(import.meta.url);
const tsx = (script: string, args: string[] = []) => spawnSync(process.execPath, [require.resolve('tsx/cli'), path.join(ROOT, script), ...args], {
  cwd: ROOT, stdio: 'inherit', env: { ...process.env, HYPOEXPLORER_APP_ORIGIN: app },
});
const incomplete = ATLAS_DIRS.filter((dir) => atlasProblems(local(`expression/${dir}`), `public/expression/${dir}`).length);
for (const dir of ATLAS_DIRS) if (!incomplete.includes(dir)) console.log(`  public/expression/${dir} complete`);
for (const { dir, builder } of BUILT_ATLASES.filter((atlas) => incomplete.includes(atlas.dir))) {
  console.log(`  building ${dir} from its tracked source`);
  if (tsx(builder).status !== 0) failures.push(`building ${dir} failed`);
}
const toFetch = incomplete.filter((dir) => !BUILT_ATLASES.some((atlas) => atlas.dir === dir));
if (toFetch.length) {
  console.log(`  fetching ${toFetch.join(', ')} from ${app}`);
  if (tsx('scripts/fetch/fetch_expression_references.mts', toFetch).status !== 0) failures.push(`fetching ${toFetch.join(', ')} failed`);
}
for (const dir of ATLAS_DIRS) failures.push(...atlasProblems(local(`expression/${dir}`), `public/expression/${dir}`));

if (failures.length) {
  console.error('\nERROR: refusing to deploy without every shipped input:');
  for (const failure of failures) console.error(`  x ${failure}`);
  process.exit(1);
}
console.log('\nEvery deploy input is present.');
