/**
 * Run the high-fat-diet intake's DE and FGSEA with the R 4.6.0 producers.
 *
 *   pnpm run analyze:hfd [--rscript=<R 4.6.0 Rscript>] [--force]
 *
 * 1. scripts/regen-r460/run_hfd_r460.R writes each study's DE, SE, CPM,
 *    provenance and session record (data/intake/hfd-2026-09-12/studies.json).
 * 2. scripts/regen-r460/run_fgsea_r460.R writes the FGSEA tables for every DE
 *    table those studies produce. It keeps a validated current set and stops on
 *    a stale one; `--force` replaces it.
 *
 * Both write into geo_replication/datasets/ in this checkout (restored by
 * `pnpm run fetch:data`; not tracked here), or under HYPO_OUT_ROOT when it is
 * set. FGSEA runs with LC_COLLATE=C, as scripts/regenerate_bulk_de_current.R
 * runs it: the provenance membership hashes sort names, and the committed
 * provenance was computed under C collation. `pnpm run check:hfd-intake`
 * audits the result against those producers' exact bytes.
 *
 * Rscript must be R 4.6.0. The sealed originals (scripts/run_hfd_pipeline.R,
 * scripts/run_mouse_fgsea.R) are pinned by retained evidence and never run here.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = 'data/intake/hfd-2026-09-12/studies.json';
const rscript = process.argv.find((arg) => arg.startsWith('--rscript='))?.slice('--rscript='.length) ?? 'Rscript';
const force = process.argv.includes('--force');

const runtime = spawnSync(rscript, ['--vanilla', '-e', 'cat(as.character(getRversion()))'], { encoding: 'utf8' });
if (runtime.error || runtime.status !== 0) {
  throw new Error(`Cannot run ${rscript}: ${runtime.error?.message ?? runtime.stderr.trim()}. Pass --rscript=<path to R 4.6.0 Rscript>.`);
}
if (runtime.stdout.trim() !== '4.6.0') {
  throw new Error(`The HFD producers need R 4.6.0; ${rscript} is R ${runtime.stdout.trim()}. Pass --rscript=<path to R 4.6.0 Rscript>.`);
}

interface Study { accession: string; tracks: { analysisId: string }[]; contrasts?: { id: string }[] }
const studies = JSON.parse(readFileSync(path.join(ROOT, MANIFEST), 'utf8')) as Study[];
// The DE table stems, derived as scripts/regenerate_bulk_de_current.R derives them for
// its hfd jobs: each track's analysisId, then one suffixed stem per further contrast.
const stems = studies.flatMap((study) => study.tracks.flatMap((track) => {
  const contrasts = study.contrasts?.length ? study.contrasts : [{ id: '' }];
  return contrasts.map((contrast, i) => (i === 0 ? track.analysisId : `${track.analysisId}_${contrast.id}`));
}));

function run(script: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  console.log(`\n$ ${rscript} ${script} ${args.join(' ')}`);
  const result = spawnSync(rscript, [script, ...args], { cwd: ROOT, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('scripts/regen-r460/run_hfd_r460.R', studies.map((study) => study.accession));
run('scripts/regen-r460/run_fgsea_r460.R', [...stems, ...(force ? ['--force'] : [])], { ...process.env, LC_COLLATE: 'C' });
