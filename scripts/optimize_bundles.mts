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
// Run:  npx tsx scripts/optimize_bundles.mts [--dry-run] [--only <datasetId>]

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { slimTrackObject, slimPathwayBlock } from './lib/bundleSlim.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DATASETS_DIR = path.join(REPO_ROOT, 'public', 'datasets');

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

function loadGlobal(file: string): { key: string; value: unknown; header: string } {
  const src = fs.readFileSync(file, 'utf8');
  const ctx: Record<string, unknown> = {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: file });
  const keys = Object.keys(ctx);
  if (keys.length !== 1) {
    throw new Error(`${path.basename(file)} defined ${keys.length} globals (expected 1): ${keys.join(', ')}`);
  }
  // Preserve the generator's comment header verbatim (everything before `var `).
  const varIdx = src.indexOf('var ');
  const header = varIdx > 0 ? `${src.slice(0, varIdx).trimEnd()}\n` : '';
  return { key: keys[0], value: ctx[keys[0]], header };
}

interface Totals { before: number; after: number; files: number; nonSequential: string[] }

function optimizeFile(file: string, totals: Totals): void {
  const before = fs.statSync(file).size;
  const { key, value, header } = loadGlobal(file);
  const obj = value as Record<string, unknown>;

  if (path.basename(file).endsWith('.pathways.js')) {
    slimPathwayBlock(obj);
  } else {
    const stats = slimTrackObject(obj);
    if (!stats.rankPosSequential) {
      totals.nonSequential.push(path.relative(REPO_ROOT, file));
    }
  }

  const body = `${header}var ${key} = ${JSON.stringify(obj)};\n`;
  const after = Buffer.byteLength(body);
  if (!dryRun) fs.writeFileSync(file, body);
  totals.before += before;
  totals.after += after;
  totals.files += 1;
}

function main(): void {
  const datasets = fs
    .readdirSync(DATASETS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((d) => !only || d === only);
  if (only && datasets.length === 0) throw new Error(`--only ${only}: no such dataset dir`);

  const totals: Totals = { before: 0, after: 0, files: 0, nonSequential: [] };
  for (const ds of datasets) {
    const dir = path.join(DATASETS_DIR, ds);
    for (const f of fs.readdirSync(dir)) {
      // Only track_<id>.js and track_<id>.pathways.js carry DE/pathway tables;
      // meta.js, qc_global.js and pathways_index.js are left byte-identical.
      if (!f.startsWith('track_') || !f.endsWith('.js')) continue;
      optimizeFile(path.join(dir, f), totals);
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
