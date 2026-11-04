import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const folder = 'data/internal-qc/advancement-2026-09-05';
const script = 'scripts/audit_internal_dedicated.R';
const hash = (path: string): string => createHash('sha256').update(readFileSync(resolve(path))).digest('hex');
const rscript = process.argv.find((a) => a.startsWith('--rscript='))?.slice(10) ?? 'Rscript';
const jobs = [
  { configId: 'GSE157077', datasetId: 'mouse_scn_hfd_gse157077', directory: 'GSE157077_mmus_scn_hfd', inputs: ['GSE157077_mouse_scn_control.tsv.gz', 'GSE157077_mouse_scn_high_fat.tsv.gz'], tables: ['GSE157077_DE.tsv'] },
  { configId: 'GSE135639', datasetId: 'mouse_pomc_maternal_hfd_gse135639', directory: 'GSE135639_mmus_pomc_maternal_hfd', inputs: ['GSE135639_Newborn.txt.gz'], tables: ['GSE135639_dietP0_DE.tsv', 'GSE135639_dietP21_DE.tsv', 'GSE135639_ageChow_DE.tsv', 'GSE135639_ageHFD_DE.tsv'] },
];
const records = jobs.map((job) => {
  const base = `geo_replication/datasets/${job.directory}`;
  const sheet = `${base}/metadata/${job.configId}_samplesheet.tsv`;
  const files = [script, `scripts/de_${job.configId.toLowerCase()}.R`, sheet, ...job.inputs.map((file) => `${base}/raw/${file}`), ...job.tables.map((file) => `${base}/processed/${file}`)];
  const fingerprints = Object.fromEntries(files.map((file) => [file, hash(file)]));
  const replayFile = `${folder}/${job.configId}-dedicated-replay.json`;
  const result = spawnSync(rscript, ['--vanilla', script, job.configId, replayFile], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Dedicated replay failed: ${job.configId}`);
  return { datasetId: job.datasetId, sheet, fingerprints, replayFile, replaySha256: hash(replayFile), ...JSON.parse(readFileSync(replayFile, 'utf8')) };
});
writeFileSync(`${folder}/dedicated-evidence.json`, `${JSON.stringify({ schemaVersion: 1, script, records }, null, 2)}\n`);
