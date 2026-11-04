/**
 * Collect read-only normalization replays of the R 4.6.0 bulk DE tables.
 *
 * Successor of scripts/advance_internal_qc.mts for the regenerated tables. The
 * September 5 replays in data/internal-qc/advancement-2026-09-05 describe the
 * replaced R 4.4.1 tables and are left unchanged; this run writes a new manifest,
 * scratch replays and immutable collected replays under R460_FOLDER.
 *
 *   npx tsx scripts/advance_internal_qc_r460.mts --workers=4
 *   npx tsx scripts/advance_internal_qc_r460.mts --collect-only
 *   npx tsx scripts/advance_internal_qc_r460.mts --datasets=GSE167105,GSE148641 --workers=2   rerun those configurations only
 *
 * Rscript must be R 4.6.0 (pass --rscript=<path> otherwise); the runtime is part
 * of every evidence ID.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseTsv } from './lib/internalQc.mjs';
import { R460_FOLDER, R460_NORMALIZATION, R460_NORMALIZATION_SCRIPT, r460ReplayFiles } from './lib/internalQcR460.mjs';

const ROOT = process.cwd();
const FOLDER = R460_FOLDER;
const path = (file: string): string => resolve(ROOT, file);
const hash = (file: string): string => createHash('sha256').update(readFileSync(path(file))).digest('hex');
const rscript = process.argv.find((arg) => arg.startsWith('--rscript='))?.slice('--rscript='.length) ?? 'Rscript';
const runtime = spawnSync(rscript, ['--vanilla', '-e', 'cat(paste(as.character(getRversion()),as.character(packageVersion("edgeR")),as.character(packageVersion("limma")),sep="/"))'], { encoding: 'utf8' });
if (runtime.status !== 0) throw new Error(`R runtime unavailable: ${runtime.stderr}`);
const runtimeVersion = runtime.stdout.trim();
if (!runtimeVersion.startsWith('4.6.0/')) throw new Error(`The R 4.6.0 replays need R 4.6.0; ${rscript} is ${runtimeVersion}.`);
const write = (file: string, value: unknown): void => writeFileSync(path(file), `${JSON.stringify(value, null, 2)}\n`);
mkdirSync(path(`${FOLDER}/replays/pinned`), { recursive: true });
const bindings = JSON.parse(readFileSync(path('data/author-validation/mechanical-audit.generated.json'), 'utf8')).datasets;
const configs = parseTsv(readFileSync(path('geo_replication/config/datasets.tsv'), 'utf8'));
const scriptSha256 = hash(R460_NORMALIZATION_SCRIPT);
const deCommonSha256 = hash('scripts/lib/de_common.R');
const jobs: any[] = [];
const skipped: any[] = [];
const selected = process.argv.find((arg) => arg.startsWith('--datasets='))?.slice('--datasets='.length).split(',');
// The September 5 intake analyses: one registered configuration row per comparison,
// fitted on the track's symbol-keyed fit matrix. The track gene map names the
// unmapped source IDs kept in the fit; the per-comparison normalization sidecar
// records the fit's library sizes and TMM factors.
const intakeStudies = JSON.parse(readFileSync(path('data/intake/september5-2026/studies.json'), 'utf8')) as Array<{ id: string; dir: string; tracks: Array<{ id: string }> }>;
const intakeAnalyses = JSON.parse(readFileSync(path('data/intake/september5-2026/analyses.json'), 'utf8')) as Array<{ studyId: string; track: string; contrast: string; analysisId: string }>;
for (const b of bindings) {
  if (intakeStudies.some((study) => study.id === b.datasetId)) continue; // replayed per comparison below
  const c = configs.find((entry) => entry.id === b.configId);
  if (!c || b.contrasts.length !== 1 || !c.input_path || !c.samplesheet) { skipped.push({ datasetId: b.datasetId, reason: 'No single-contrast canonical input binding; dedicated replay required.' }); continue; }
  const files = r460ReplayFiles(ROOT, c, b.contrasts[0].table);
  const absent = Object.values(files).filter((file) => !existsSync(path(file)));
  if (absent.length) { skipped.push({ datasetId: b.datasetId, reason: `A configured input, sample sheet, DE table or regeneration sidecar is absent: ${absent.join(', ')}.` }); continue; }
  const fingerprints = Object.fromEntries(Object.values(files).map((file) => [file, hash(file)]));
  const evidenceId = createHash('sha256').update(JSON.stringify({ config: c, fingerprints, script: scriptSha256, deCommon: deCommonSha256, runtimeVersion })).digest('hex');
  jobs.push({ datasetId: b.datasetId, configId: b.configId, contrastId: b.contrasts[0].contrastId, config: c,
    ...Object.fromEntries(Object.entries(files).map(([key, file]) => [key, path(file)])), fingerprints, evidenceId });
}
for (const analysis of intakeAnalyses) {
  const study = intakeStudies.find((s) => s.id === analysis.studyId)!;
  const c = configs.find((entry) => entry.id === analysis.analysisId);
  const trackBase = intakeAnalyses.find((a) => a.studyId === analysis.studyId && a.track === analysis.track)!.analysisId;
  if (!c) { skipped.push({ datasetId: analysis.studyId, analysisId: analysis.analysisId, reason: 'No registered configuration row.' }); continue; }
  const files: Record<string, string> = {
    input: `geo_replication/${c.input_path}`, sheet: `geo_replication/${c.samplesheet}`,
    table: `${study.dir}/processed/${analysis.analysisId}_DE.tsv`, provenance: `${study.dir}/processed/${analysis.analysisId}_provenance.tsv`,
    geneMap: `${study.dir}/metadata/${trackBase}_gene_map.tsv`,
    ...(c.input_kind === 'counts' ? { pairNormalization: `${study.dir}/processed/${analysis.analysisId}_normalization.tsv` } : {}),
  };
  const absent = Object.values(files).filter((file) => !existsSync(path(file)));
  if (absent.length) { skipped.push({ datasetId: analysis.studyId, analysisId: analysis.analysisId, reason: `Absent: ${absent.join(', ')}.` }); continue; }
  const fingerprints = Object.fromEntries(Object.values(files).map((file) => [file, hash(file)]));
  const evidenceId = createHash('sha256').update(JSON.stringify({ config: c, fingerprints, script: scriptSha256, deCommon: deCommonSha256, runtimeVersion })).digest('hex');
  jobs.push({ datasetId: analysis.studyId, trackId: analysis.track, configId: analysis.analysisId, contrastId: analysis.contrast, config: c,
    ...Object.fromEntries(Object.entries(files).map(([key, file]) => [key, path(file)])), fingerprints, evidenceId });
}
const manifestFile = `${FOLDER}/replay-manifest.json`;
const manifest = { schemaVersion: 1, runtimeVersion, scope: 'Read-only numeric replay of the R 4.6.0 canonical analysis under the de_common.R rules; source recovery and biological independence are separate checks.',
  script: R460_NORMALIZATION_SCRIPT, scriptSha256, deCommon: 'scripts/lib/de_common.R', deCommonSha256, jobs, skipped };
write(manifestFile, manifest);
if (!process.argv.includes('--collect-only')) {
  const workers = Math.max(1, Math.min(8, Number(process.argv.find((arg) => arg.startsWith('--workers='))?.slice('--workers='.length) ?? 1)));
  const queue = jobs.filter((j) => !selected || selected.includes(j.configId));
  await Promise.all(Array.from({ length: workers }, (_, worker) => new Promise<void>((complete, reject) => {
    const workerManifest = `${FOLDER}/replay-manifest.worker-${worker + 1}.json`;
    write(workerManifest, { ...manifest, jobs: queue.filter((_j, i) => i % workers === worker) });
    const child = spawn(rscript, ['--vanilla', path(manifest.script), path(workerManifest), path(`${FOLDER}/replays`)], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? complete() : reject(new Error(`R replay worker ${worker + 1} failed: ${code}`)));
  })));
}
const records = jobs.flatMap((j) => {
  // A replay is collected from this run's scratch output or, when that is absent (a
  // per-dataset rerun on another checkout), from the immutable replay with the same evidence ID.
  const pinnedFile = `${FOLDER}/replays/pinned/${j.configId}-${j.evidenceId}.json`;
  const scratch = `${FOLDER}/replays/${j.configId}.json`;
  const file = existsSync(path(scratch)) ? scratch : pinnedFile;
  if (!existsSync(path(file))) return [];
  const result = JSON.parse(readFileSync(path(file), 'utf8'));
  if (result.evidenceId !== j.evidenceId) return [];
  if (existsSync(path(pinnedFile)) && hash(pinnedFile) !== hash(file)) throw new Error(`Immutable replay differs: ${pinnedFile}`);
  if (!existsSync(path(pinnedFile))) copyFileSync(path(file), path(pinnedFile));
  return [{ datasetId: j.datasetId, ...(j.trackId ? { trackId: j.trackId } : {}), contrastId: j.contrastId, configId: j.configId, config: j.config, fingerprints: j.fingerprints,
    scriptSha256, deCommonSha256, replayFile: pinnedFile, replaySha256: hash(pinnedFile), ...result }];
});
write(R460_NORMALIZATION, { schemaVersion: 1, method: manifest.scope, script: manifest.script, deCommon: manifest.deCommon, records, skipped });
process.stdout.write(`Collected ${records.length}/${jobs.length} normalization replays: ${JSON.stringify(Object.fromEntries(['pass', 'review', 'not_assessed'].map((s) => [s, records.filter((r) => r.status === s).length])))}\n`);
