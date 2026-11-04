// Clear the per-gene logFC standard error (`se`) on the macaque snRNA track
// bundles, so the atlas's rows plot WITHOUT a 95% CI instead of drawing one from
// a number that is not a sampling SD.
//
// WHAT THIS SCRIPT USED TO DO, AND WHY IT STOPPED
// -----------------------------------------------
// The macaque bundles are migrated verbatim from legacy pop_<id>.js
// (scripts/migrate_macaque_bundles.mts), which dropped the edgeR QL F statistic
// — but the committed per-cluster DE_all.csv still carries F. This script set
// se = |logFC| / sqrt(F), justified by the claim that a 1-df QL F is a Wald
// statistic so F = (coef/SE)². That claim is false: glmQLFTest reports a
// deviance-ratio statistic over the posterior QL dispersion. The resulting
// number reproduces edgeR's p-value but does not estimate the sampling SD of
// logFC, and measured on a comparable dataset it runs ~0.75x the QL-adjusted
// Wald SE — which would have entered the atlas at ~1.77x its earned weight.
// See src/utils/seRecovery.ts for the full argument and the measurements.
//
// The other edgeR datasets are fixed by refitting them (scripts/compute_edger_se.R
// writes a true Wald SE beside each DE table). The macaque atlas CANNOT be:
// data/raw/results/<cluster>/de/ carries logFC, logCPM, F, PValue and FDR plus a
// normalized-CPM matrix, but no pseudobulk counts and no library sizes, so there
// is nothing to refit from inside this repo. Excluding it is the honest option
// left. Its per-track effects still render everywhere they did before — only the
// pooled inverse-variance estimate declines to use them.
//
// TO RESTORE IT: commit the per-cluster pseudobulk count matrices, extend
// compute_edger_se.R to cover them, and set `se` from that instead.
//
// This is additive in the same sense as before: every other field stays
// byte-identical. Re-run after any macaque rebuild.
//
// Run: tsx scripts/add_macaque_se.mts
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seFromStat } from '../src/utils/seRecovery';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE_DIR = resolve(ROOT, 'public', 'datasets', 'macaque_snrna');
const RESULTS = resolve(ROOT, 'data', 'raw', 'results');

// Parse the quoted DE_all.csv into gene -> F (col 2). Gene symbols carry no commas.
function readClusterF(deCsvPath: string): Map<string, number> {
  const text = readFileSync(deCsvPath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  const header = lines[0].split(',').map((f) => f.replace(/^"|"$/g, ''));
  const iF = header.indexOf('F');
  const iGene = header.indexOf('gene');
  const map = new Map<string, number>();
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',').map((x) => x.replace(/^"|"$/g, ''));
    const F = Number(f[iF]);
    const gene = f[iGene];
    if (gene && Number.isFinite(F)) map.set(gene, F);
  }
  return map;
}

const resultDirs = readdirSync(RESULTS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const bundleFiles = readdirSync(BUNDLE_DIR).filter((f) => /^track_.+\.js$/.test(f));

let patched = 0;
const noDir: string[] = [];
const stats = { rows: 0, seSet: 0, seNull: 0 };

for (const file of bundleFiles) {
  const trackId = file.replace(/^track_(.+)\.js$/, '$1');
  const dir = resultDirs.find((d) => d.startsWith(`${trackId}__`));
  if (!dir) { noDir.push(trackId); continue; }
  const fMap = readClusterF(resolve(RESULTS, dir, 'de', 'DE_all.csv'));

  const raw = readFileSync(resolve(BUNDLE_DIR, file), 'utf8');
  const m = raw.match(/^([\s\S]*?)\nvar (\w+) = ([\s\S]*?);\s*$/);
  if (!m) throw new Error(`${file}: unexpected bundle format`);
  const [, header, key, jsonStr] = m;
  const obj = JSON.parse(jsonStr) as { de?: Array<{ gene: string; logFC: number; se?: number | null }> };

  for (const row of obj.de ?? []) {
    stats.rows++;
    // seFromStat returns null for edgeR-QL without a persisted SE, and none can
    // be computed for macaque (no counts committed). Called rather than
    // hardcoding null so that IF a sidecar ever exists, this picks it up.
    const se = seFromStat(row.logFC, fMap.get(row.gene) ?? Number.NaN, 'edgeR-QL');
    row.se = se;
    if (se == null) stats.seNull++; else stats.seSet++;
  }

  writeFileSync(resolve(BUNDLE_DIR, file), `${header}\nvar ${key} = ${JSON.stringify(obj)};\n`);
  patched++;
}

console.log(`add_macaque_se: patched ${patched}/${bundleFiles.length} track bundles`);
console.log(`  de rows: ${stats.rows}  se set: ${stats.seSet}  se null: ${stats.seNull}`);
if (noDir.length) console.log(`  WARNING no result dir for: ${noDir.join(', ')}`);
