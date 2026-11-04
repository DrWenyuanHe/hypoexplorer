/**
 * Replay the two dedicated limma-trend routes as regenerated under R 4.6.0.
 *
 * Successor of scripts/advance_internal_dedicated.mts. The September 5 replays
 * of the replaced tables stay in data/internal-qc/advancement-2026-09-05; this
 * writes R460_DEDICATED and one replay file per study under R460_FOLDER.
 *
 *   npx tsx scripts/advance_internal_dedicated_r460.mts [--rscript=<R 4.6.0 Rscript>]
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { R460_DEDICATED, R460_DEDICATED_SCRIPT, R460_FOLDER } from './lib/internalQcR460.mjs';

const hash = (path: string): string => createHash('sha256').update(readFileSync(resolve(path))).digest('hex');
const rscript = process.argv.find((a) => a.startsWith('--rscript='))?.slice(10) ?? 'Rscript';
const script = R460_DEDICATED_SCRIPT;
const jobs = [
  { configId: 'GSE157077', datasetId: 'mouse_scn_hfd_gse157077', directory: 'GSE157077_mmus_scn_hfd', inputs: ['GSE157077_mouse_scn_control.tsv.gz', 'GSE157077_mouse_scn_high_fat.tsv.gz'], tables: ['GSE157077_DE.tsv'] },
  { configId: 'GSE135639', datasetId: 'mouse_pomc_maternal_hfd_gse135639', directory: 'GSE135639_mmus_pomc_maternal_hfd', inputs: ['GSE135639_Newborn.txt.gz'], tables: ['GSE135639_dietP0_DE.tsv', 'GSE135639_dietP21_DE.tsv', 'GSE135639_ageChow_DE.tsv', 'GSE135639_ageHFD_DE.tsv'] },
];
mkdirSync(R460_FOLDER, { recursive: true });
const records = jobs.map((job) => {
  const base = `geo_replication/datasets/${job.directory}`;
  const sheet = `${base}/metadata/${job.configId}_samplesheet.tsv`;
  const producer = `scripts/regen-r460/de_${job.configId.toLowerCase()}_r460.R`;
  const files = [script, producer, 'scripts/lib/de_common.R', sheet, `${base}/processed/${job.configId}_feature_map.tsv.gz`,
    ...job.inputs.map((file) => `${base}/raw/${file}`), ...job.tables.map((file) => `${base}/processed/${file}`)];
  const fingerprints = Object.fromEntries(files.map((file) => [file, hash(file)]));
  const replayFile = `${R460_FOLDER}/${job.configId}-dedicated-replay.json`;
  const result = spawnSync(rscript, ['--vanilla', script, job.configId, replayFile], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Dedicated replay failed: ${job.configId}`);
  const replay = JSON.parse(readFileSync(replayFile, 'utf8'));
  if (!String(replay.software?.R).startsWith('4.6.0')) throw new Error(`The R 4.6.0 dedicated replay ran under R ${replay.software?.R}`);
  return { datasetId: job.datasetId, producer, sheet, fingerprints, replayFile, replaySha256: hash(replayFile), ...replay };
});
writeFileSync(R460_DEDICATED, `${JSON.stringify({ schemaVersion: 1, script, records }, null, 2)}\n`);
process.stdout.write(`Wrote ${R460_DEDICATED}: ${records.map((r) => `${r.configId} ${Object.values(r.contrasts).map((c: any) => c.status).join(',')}`).join('; ')}\n`);
