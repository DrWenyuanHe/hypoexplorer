/** Collect reproducible, read-only internal-QC evidence. Existing scientific outputs are never rewritten. */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseTsv } from './lib/internalQc.mjs';

const ROOT = process.cwd();
const FOLDER = 'data/internal-qc/advancement-2026-09-05';
const path = (file: string): string => resolve(ROOT, file);
const hash = (file: string): string => createHash('sha256').update(readFileSync(path(file))).digest('hex');
const rscript = process.argv.find((arg) => arg.startsWith('--rscript='))?.slice('--rscript='.length) ?? 'Rscript';
const runtime = spawnSync(rscript, ['--vanilla', '-e', 'cat(paste(as.character(getRversion()),as.character(packageVersion("edgeR")),as.character(packageVersion("limma")),sep="/"))'], { encoding: 'utf8' });
if (runtime.status !== 0) throw new Error(`R runtime unavailable: ${runtime.stderr}`);
const runtimeVersion = runtime.stdout.trim();
const write = (file: string, value: unknown): void => writeFileSync(path(file), `${JSON.stringify(value, null, 2)}\n`);
mkdirSync(path(`${FOLDER}/replays`), { recursive: true });
mkdirSync(path(`${FOLDER}/replays/pinned`), { recursive: true });
const baselinePath = `${FOLDER}/baseline.json`;
if (!existsSync(path(baselinePath))) {
  const old = JSON.parse(readFileSync(path('data/internal-qc/assessments.generated.json'), 'utf8'));
  write(baselinePath, { summary: old.summary, records: old.records.map((r: any) => ({ datasetId: r.datasetId, status: r.assessment.status, checks: Object.fromEntries(r.assessment.checks.map((c: any) => [c.id, c.status])) })) });
}
const bindings = JSON.parse(readFileSync(path('data/author-validation/mechanical-audit.generated.json'), 'utf8')).datasets;
const configs = parseTsv(readFileSync(path('geo_replication/config/datasets.tsv'), 'utf8'));
const jobs: any[] = [];
const skipped: any[] = [];
const selected = process.argv.find((arg) => arg.startsWith('--datasets='))?.slice('--datasets='.length).split(',');
const evidenceFile = `${FOLDER}/normalization-evidence.json`;
const previous = existsSync(path(evidenceFile)) ? JSON.parse(readFileSync(path(evidenceFile), 'utf8')).records : [];
for (const b of bindings) {
  const c = configs.find((entry) => entry.id === b.configId);
  if (!c || b.contrasts.length !== 1 || !c.input_path || !c.samplesheet) { skipped.push({ datasetId: b.datasetId, reason: 'No single-contrast canonical input binding; dedicated replay required.' }); continue; }
  const files = { input: `geo_replication/${c.input_path}`, sheet: `geo_replication/${c.samplesheet}`, table: b.contrasts[0].table };
  if (Object.values(files).some((file) => !existsSync(path(file)))) { skipped.push({ datasetId: b.datasetId, reason: 'A configured input, sample sheet or DE table is absent.' }); continue; }
  const fingerprints = Object.fromEntries(Object.values(files).map((file) => [file, hash(file)]));
  const evidenceId = createHash('sha256').update(JSON.stringify({ config: c, fingerprints, script: hash('scripts/audit_internal_normalization.R'), runtimeVersion })).digest('hex');
  jobs.push({ datasetId: b.datasetId, configId: b.configId, contrastId: b.contrasts[0].contrastId, config: c, ...Object.fromEntries(Object.entries(files).map(([key, file]) => [key, path(file)])), fingerprints, evidenceId });
}
const manifestFile = `${FOLDER}/replay-manifest.json`;
const manifest = { schemaVersion: 1, runtimeVersion, scope: 'Read-only numeric replay of the current canonical analysis; source recovery and biological independence are separate checks.', script: 'scripts/audit_internal_normalization.R', scriptSha256: hash('scripts/audit_internal_normalization.R'), jobs, skipped };
write(manifestFile, manifest);
if (!process.argv.includes('--collect-only')) {
  const workers = Math.max(1, Math.min(4, Number(process.argv.find((arg) => arg.startsWith('--workers='))?.slice('--workers='.length) ?? 1)));
  await Promise.all(Array.from({ length: workers }, (_, worker) => new Promise<void>((complete, reject) => {
    const workerManifest = `${FOLDER}/replay-manifest.worker-${worker + 1}.json`;
    write(workerManifest, { ...manifest, jobs: jobs.filter((j, i) => i % workers === worker && (!selected || selected.includes(j.configId))) });
    const child = spawn(rscript, ['--vanilla', path(manifest.script), path(workerManifest), path(`${FOLDER}/replays`)], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? complete() : reject(new Error(`R replay worker ${worker + 1} failed: ${code}`)));
  })));
}
const records = jobs.flatMap((j) => {
  const file = `${FOLDER}/replays/${j.configId}.json`;
  if (!existsSync(path(file))) return [];
  const result = JSON.parse(readFileSync(path(file), 'utf8'));
  if (result.evidenceId !== j.evidenceId) {
    const prior = previous.find((r: any) => r.datasetId === j.datasetId && r.scriptSha256 === manifest.scriptSha256 && JSON.stringify(r.config) === JSON.stringify(j.config) && JSON.stringify(r.fingerprints) === JSON.stringify(j.fingerprints)
      && r.replaySha256 && existsSync(path(r.replayFile)) && hash(r.replayFile) === r.replaySha256 && JSON.parse(readFileSync(path(r.replayFile), 'utf8')).evidenceId === r.evidenceId);
    return prior ? [prior] : [];
  }
  const pinnedFile = `${FOLDER}/replays/pinned/${j.configId}-${result.evidenceId}.json`;
  if (existsSync(path(pinnedFile)) && hash(pinnedFile) !== hash(file)) throw new Error(`Immutable replay differs: ${pinnedFile}`);
  if (!existsSync(path(pinnedFile))) copyFileSync(path(file), path(pinnedFile));
  return [{ datasetId: j.datasetId, contrastId: j.contrastId, configId: j.configId, config: j.config, fingerprints: j.fingerprints, scriptSha256: manifest.scriptSha256, replayFile: pinnedFile, replaySha256: hash(pinnedFile), ...result }];
});
write(evidenceFile, { schemaVersion: 1, method: manifest.scope, script: manifest.script, records, skipped });
process.stdout.write(`Collected ${records.length} normalization replays: ${JSON.stringify(Object.fromEntries(['pass', 'review', 'not_assessed'].map((s) => [s, records.filter((r) => r.status === s).length])))}\n`);
