// Shrink the committed data bundles under public/datasets/** in place.
//
// The bundles were produced by several generators over time
// (migrate_macaque_bundles, add_macaque_se, build_geo_datasets,
// build_explorer_bundles_batch2), some of whose inputs no longer exist in the
// repo — so this optimizer transforms the bundles themselves rather than
// re-running those pipelines. The generators that CAN re-run apply the same
// policy at write time (scripts/lib/bundleSlim.mts), so regeneration does not
// restore the bloat. Idempotent: a second pass is a no-op.
//
// What changes (see bundleSlim.mts for the full policy + safety argument):
//   - PValue/FDR (de) and pval/padj (pathways): 6 significant digits with a
//     threshold guard — any value whose rounding would flip a classification
//     at 1e-4/1e-3/0.01/0.05 keeps full precision.
//   - se / rank_score: 5 significant digits. logFC/NES/ES untouched.
//   - de[].rankPos dropped after verifying rankPos === index+1 (refuses and
//     reports otherwise); de[].logCPM dropped only when null; de[].ens dropped.
//
// After running: `npm test`, rebuild the query index
// (scripts/build_query_index.mts) so shard stats derive from the same bytes,
// and re-upload (npm run upload:bundles) if bundles are served off-origin.
//
// Run:  npx tsx scripts/deploy/optimize_bundles.mts [--dry-run] [--only <datasetId>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slimTrackObject, slimPathwayBlock } from '../lib/bundleSlim.mjs';
import { type DiskBundle, jsonpHeader, listDiskCorpus, parseJsonp, readJsonp } from '../lib/bundleReader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const PUBLIC_ROOT = path.join(REPO_ROOT, 'public');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const onlyIdx = argv.indexOf('--only');
let only: string | null = null;
if (onlyIdx >= 0) {
  only = argv[onlyIdx + 1] ?? null;
  if (!only || only.startsWith('--')) {
    throw new Error('--only requires a dataset id argument');
  }
}

interface Totals { before: number; after: number; files: number; nonSequential: string[] }

// Bundles are PARSED, never evaluated: the bundle reader refuses code around
// the JSON payload and any global but the one the locator names, so a stray
// file in a dataset folder can neither run nor be rewritten as that study.
function optimizeFile({ file, global }: DiskBundle, kind: 'track' | 'pathways', totals: Totals): void {
  const before = fs.statSync(file).size;
  const src = fs.readFileSync(file, 'utf8');
  const obj = parseJsonp<Record<string, unknown>>(src, global, file);
  // Preserve the generator's comment header verbatim.
  const leading = jsonpHeader(src);
  const header = leading ? `${leading.trimEnd()}\n` : '';

  if (kind === 'pathways') {
    slimPathwayBlock(obj);
  } else {
    const stats = slimTrackObject(obj);
    if (!stats.rankPosSequential) {
      totals.nonSequential.push(path.relative(REPO_ROOT, file));
    }
  }

  const body = `${header}var ${global} = ${JSON.stringify(obj)};\n`;
  const after = Buffer.byteLength(body);
  if (!dryRun) fs.writeFileSync(file, body);
  totals.before += before;
  totals.after += after;
  totals.files += 1;
}

function main(): void {
  // The registry decides which folders are studies and the locators name their
  // files; a folder the registry does not name is left untouched.
  const corpus = listDiskCorpus({ publicRoot: PUBLIC_ROOT });
  for (const dir of corpus.unregistered) console.warn(`  skip datasets/${dir}: not in src/data/datasets.ts`);
  const datasets = corpus.datasets.filter(({ dataset }) => !only || dataset.id === only);
  if (only && datasets.length === 0) throw new Error(`--only ${only}: no such dataset dir`);

  const totals: Totals = { before: 0, after: 0, files: 0, nonSequential: [] };
  for (const { paths } of datasets) {
    const meta = readJsonp<{ populations?: string[] }>(paths.meta.file, paths.meta.global);
    // Only each declared track's bundle and pathway sibling carry DE/pathway
    // tables; meta.js, qc_global.js, pathways_index.js and time courses are
    // left byte-identical. A bundle not on disk (a checkout without the
    // corpus) is skipped, as is a track file meta.js does not declare.
    for (const trackId of meta.populations ?? []) {
      const track = paths.track(trackId);
      if (fs.existsSync(track.file)) optimizeFile(track, 'track', totals);
      const pathways = paths.pathways(trackId);
      if (fs.existsSync(pathways.file)) optimizeFile(pathways, 'pathways', totals);
    }
  }

  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  console.log(
    `optimize_bundles${dryRun ? ' (dry-run)' : ''}: ${totals.files} files, ` +
      `${mb(totals.before)} MB -> ${mb(totals.after)} MB ` +
      `(-${(100 - (totals.after / totals.before) * 100).toFixed(1)}%)`,
  );
  for (const f of totals.nonSequential) {
    console.warn(`  WARN ${f}: rankPos not sequential — field kept, investigate`);
  }
}

main();
