// Make sure a production build has every gitignored input it ships, before
// `pnpm run deploy:cf` builds and uploads it.
//
//   pnpm run prepare:deploy                   # fetch what is missing, refuse on a mismatch
//   pnpm run prepare:deploy --refresh-query   # replace a local query catalog with the origin's
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
//   host (pnpm run fetch:expression <atlas>). A complete local atlas is kept, so
//   a rebuilt atlas (build:expression-external) deploys as built.
//
// Exits non-zero, having changed nothing it could not verify, if any input is
// still missing afterwards.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { ATLAS_DIRS, atlasProblems, expressionBuildIdOf, QUERY_POINTERS, TRACKER_CATALOG } from './lib/deployInputs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  // A same-origin build ships public/query itself, so there is no origin to match.
  for (const pointer of QUERY_POINTERS) if (!readLocal(pointer)) failures.push(`public/${pointer} is missing; build the indexes first`);
} else {
  const [tracks, pointer] = await Promise.all(QUERY_POINTERS.map((relative) => fetchText(`${bundleBase}/${relative}`)));
  const buildId = expressionBuildIdOf(pointer);
  if (!buildId) throw new Error(`${bundleBase}/query/expression-manifest.js names no expression build`);
  const immutable = `query/expression/${buildId}/manifest.js`;
  const remote: Record<string, string> = { 'query/tracks.js': tracks, 'query/expression-manifest.js': pointer };
  const present = QUERY_POINTERS.filter((relative) => readLocal(relative) !== null);
  const differing = QUERY_POINTERS.filter((relative) => {
    const text = readLocal(relative);
    return text !== null && text.replace(/\r\n/g, '\n') !== remote[relative].replace(/\r\n/g, '\n');
  });
  if (differing.length && !refreshQuery) {
    failures.push(
      `public/${differing.join(' and public/')} ${differing.length === 1 ? 'differs' : 'differ'} from ${bundleBase}. The deployed app would pin an index `
      + 'the data origin does not serve. Publish the local index first (pnpm run upload:bundles), or take the '
      + "origin's with pnpm run prepare:deploy --refresh-query (or pnpm run fetch:query).",
    );
  } else {
    if (present.length < QUERY_POINTERS.length || differing.length) {
      for (const relative of QUERY_POINTERS) writeLocal(relative, remote[relative]);
    } else {
      console.log('  public/query matches the data origin');
    }
    if (!readLocal(immutable)) writeLocal(immutable, await fetchText(`${bundleBase}/${immutable}`));
  }
}

// ── Tracker catalog ──────────────────────────────────────────────────────────
console.log('Tracker catalog');
if (readLocal(TRACKER_CATALOG) === null) writeLocal(TRACKER_CATALOG, await fetchText(`${app}/${TRACKER_CATALOG}`));
else console.log(`  public/${TRACKER_CATALOG} present`);

// ── Reference atlases ────────────────────────────────────────────────────────
console.log('Reference atlases');
const incomplete = ATLAS_DIRS.filter((dir) => atlasProblems(local(`expression/${dir}`), `public/expression/${dir}`).length);
for (const dir of ATLAS_DIRS) if (!incomplete.includes(dir)) console.log(`  public/expression/${dir} complete`);
if (incomplete.length) {
  console.log(`  fetching ${incomplete.join(', ')} from ${app}`);
  const require = createRequire(import.meta.url);
  const run = spawnSync(process.execPath, [require.resolve('tsx/cli'), path.join(ROOT, 'scripts/fetch_expression_references.mts'), ...incomplete], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, HYPOEXPLORER_APP_ORIGIN: app },
  });
  if (run.status !== 0) failures.push(`fetching ${incomplete.join(', ')} failed`);
}
for (const dir of ATLAS_DIRS) failures.push(...atlasProblems(local(`expression/${dir}`), `public/expression/${dir}`));

if (failures.length) {
  console.error('\nERROR: refusing to deploy without every shipped input:');
  for (const failure of failures) console.error(`  x ${failure}`);
  process.exit(1);
}
console.log('\nEvery deploy input is present.');
