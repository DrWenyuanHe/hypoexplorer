/**
 * Read-only audit of every current macaque app track after the R 4.6.0 regeneration.
 *
 * Successor of scripts/audit_macaque_internal_qc.mts, which audits the replaced
 * run_all_clusters.R outputs and stays byte-identical (retained evidence pins it
 * and its data/internal-qc/advancement-2026-09-05/macaque evidence). This audit
 * reads data/raw/scripts/run_atlas_r460.R for the declared protocol, verifies the
 * producer's provenance hashes, and refits every population from the committed
 * pseudobulk with scripts/audit_macaque_normalization_r460.R.
 *
 *   npx tsx scripts/audit_macaque_internal_qc_r460.mts [--rscript=<R 4.6.0 Rscript>]   refit, then write the evidence
 *   npx tsx scripts/audit_macaque_internal_qc_r460.mts --check                          verify the saved refit and evidence
 *
 * Never refits into or changes scientific outputs.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MACAQUE_SAMPLES, auditMacaqueTrack, macaqueProtocol, parseMacaqueBundle, parseMacaqueCsv } from './lib/macaqueQc.mjs';
import {
  MACAQUE_R460_AUDIT_VERSION, MACAQUE_R460_EVIDENCE, MACAQUE_R460_HASH_SCHEME, MACAQUE_R460_REPLAY, MACAQUE_R460_SOURCE_PATHS,
  aggregateMacaqueTracksR460, macaqueR460Fingerprint, macaqueTrackPaths, provenanceHashMatches, refitTrackAudit, type MacaqueRefit,
} from './lib/macaqueQcR460.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const OUT = dirname(MACAQUE_R460_EVIDENCE);
const fingerprints: Record<string, string> = {};
const bytesOf = (path: string): Buffer => {
  const bytes = readFileSync(resolve(ROOT, path));
  fingerprints[path] = macaqueR460Fingerprint(path, bytes);
  return bytes;
};
const read = (path: string): string => bytesOf(path).toString('utf8');
const kv = (text: string): Record<string, string> => Object.fromEntries(text.trim().split(/\r?\n/).slice(1).map((line) => {
  const tab = line.indexOf('\t');
  return [line.slice(0, tab), line.slice(tab + 1)];
}));

for (const path of MACAQUE_R460_SOURCE_PATHS) bytesOf(path);
const meta = parseMacaqueBundle(read('public/datasets/macaque_snrna/meta.js'));
const protocol = macaqueProtocol(read('data/raw/scripts/run_atlas_r460.R'));
if (!protocol.valid) throw new Error('The declared atlas protocol changed; inspect the condition map and model before auditing.');
const trackIds: string[] = meta.populations;
if (!Array.isArray(trackIds) || !trackIds.length || new Set(trackIds).size !== trackIds.length) throw new Error('Atlas track registry is empty or duplicated');
const composition = parseMacaqueCsv(read('data/raw/results/_global/composition/cell_counts_by_sample_and_cluster_long.csv')).rows;
const runRows = parseMacaqueCsv(read('data/raw/results/_global/summary/run_status.csv')).rows;
const runProvenance = kv(read('data/raw/results/_global/RUN_provenance.tsv'));
const atlasGenerator = createHash('sha256').update(readFileSync(resolve(ROOT, 'data/raw/scripts/run_atlas_r460.R'))).digest('hex');
const folders = readdirSync(resolve(ROOT, 'data/raw/results'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const layout = trackIds.map((id) => {
  const matches = folders.filter((folder) => folder.startsWith(`${id}__`));
  if (matches.length !== 1) throw new Error(`${id}: expected one result folder, found ${matches.length}`);
  return { id, folder: matches[0], paths: macaqueTrackPaths(id, matches[0]) };
});
for (const { paths } of layout) for (const path of paths) bytesOf(path);

// The refit binds every file it reads (and the declared protocol); its evidence ID changes with any of them.
const refitInputs = ['scripts/audit_macaque_normalization_r460.R', 'data/raw/scripts/run_atlas_r460.R',
  ...layout.flatMap(({ paths }) => [paths[1], paths[2], paths[3], paths[4], paths[5]])].sort();
const evidenceId = createHash('sha256').update(JSON.stringify(refitInputs.map((path) => [path, fingerprints[path]]))).digest('hex');
if (!CHECK) {
  const rscript = process.argv.find((arg) => arg.startsWith('--rscript='))?.slice('--rscript='.length) ?? 'Rscript';
  mkdirSync(resolve(ROOT, OUT), { recursive: true });
  const manifestPath = resolve(ROOT, OUT, 'refit-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify({ evidenceId, tracks: layout.map(({ id, paths }) => {
    const groups = parseMacaqueCsv(readFileSync(resolve(ROOT, paths[3]), 'utf8')).rows[0];
    return { trackId: id, pseudobulk: resolve(ROOT, paths[4]), de: resolve(ROOT, paths[1]), normcpm: resolve(ROOT, paths[2]), librarySizes: resolve(ROOT, paths[5]),
      samplesKept: groups.samples_kept.split(';'), groups: protocol.groups };
  }) }, null, 2)}\n`);
  const run = spawnSync(rscript, ['--vanilla', resolve(ROOT, 'scripts/audit_macaque_normalization_r460.R'), manifestPath, resolve(ROOT, MACAQUE_R460_REPLAY)], { stdio: 'inherit' });
  if (run.status !== 0) throw new Error('The pseudobulk refit failed.');
}
if (!existsSync(resolve(ROOT, MACAQUE_R460_REPLAY))) throw new Error(`Missing ${MACAQUE_R460_REPLAY}. Run npx tsx scripts/audit_macaque_internal_qc_r460.mts.`);
const refit = JSON.parse(read(MACAQUE_R460_REPLAY)) as { evidenceId: string; tracks: Record<string, MacaqueRefit>; software: Record<string, string> };
if (refit.evidenceId !== evidenceId) throw new Error('The saved pseudobulk refit is stale. Run npx tsx scripts/audit_macaque_internal_qc_r460.mts.');
if (!String(refit.software?.R).startsWith('4.6.0')) throw new Error(`The pseudobulk refit ran under R ${refit.software?.R}; R 4.6.0 is required.`);

const tracks = layout.map(({ id, paths }) => {
  const provenance = kv(readFileSync(resolve(ROOT, paths[6]), 'utf8'));
  const provenanceCurrent = provenance.generator_sha256 === atlasGenerator && provenance.population_id === id
    && provenanceHashMatches(readFileSync(resolve(ROOT, paths[4])), provenance.pseudobulk_sha256)
    && provenanceHashMatches(readFileSync(resolve(ROOT, paths[1])), provenance.de_all_sha256)
    && provenanceHashMatches(readFileSync(resolve(ROOT, paths[2])), provenance.normcpm_sha256);
  const evidence = [MACAQUE_R460_SOURCE_PATHS[0], MACAQUE_R460_SOURCE_PATHS[12], MACAQUE_R460_SOURCE_PATHS[13], MACAQUE_R460_REPLAY, ...paths];
  const base = auditMacaqueTrack({ id, bundle: parseMacaqueBundle(readFileSync(resolve(ROOT, paths[0]), 'utf8')), datasetMeta: meta,
    de: parseMacaqueCsv(readFileSync(resolve(ROOT, paths[1]), 'utf8')).rows, cpm: parseMacaqueCsv(readFileSync(resolve(ROOT, paths[2]), 'utf8')),
    groupRows: parseMacaqueCsv(readFileSync(resolve(ROOT, paths[3]), 'utf8')).rows, composition, runRows, protocol, evidence });
  return { ...refitTrackAudit(base, refit.tracks[id], provenanceCurrent, evidence), provenanceCurrent, refit: refit.tracks[id]?.status ?? 'missing', paths };
});
const excluded = runRows.filter((row) => !trackIds.includes(row.cluster)).map((row) => ({ trackId: row.cluster, status: row.status, message: row.message,
  hasSavedDe: folders.filter((folder) => folder.startsWith(`${row.cluster}__`)).some((folder) => existsSync(resolve(ROOT, 'data/raw/results', folder, 'de/DE_all.csv'))) }));
if (excluded.some((entry) => entry.status === 'ok' || entry.hasSavedDe)) throw new Error('An undisplayed successful population needs explicit registry review');
const aggregate = aggregateMacaqueTracksR460(tracks);
const evidence = {
  schemaVersion: 1, auditVersion: MACAQUE_R460_AUDIT_VERSION, fingerprintScheme: MACAQUE_R460_HASH_SCHEME, datasetId: 'macaque_snrna', contrastId: 'obese_vs_normal',
  producer: { path: 'data/raw/scripts/run_atlas_r460.R', sha256: atlasGenerator, runProvenanceGenerator: runProvenance.generator_sha256 ?? null },
  refit: { path: MACAQUE_R460_REPLAY, evidenceId, software: refit.software },
  trackIds, fingerprints: Object.fromEntries(Object.entries(fingerprints).sort(([a], [b]) => a.localeCompare(b))),
  summary: {
    appTracks: tracks.length, deRows: tracks.reduce((sum, track) => sum + track.deRows, 0),
    cpmValues: tracks.reduce((sum, track) => sum + track.cpmValues, 0),
    threeVersusThree: tracks.filter((track) => track.normalSamples.length === 3 && track.obeseSamples.length === 3).length,
    reducedReplicationTracks: tracks.filter((track) => track.droppedSamples.length).map((track) => track.trackId),
    refitPassing: tracks.filter((track) => track.refit === 'pass').length,
    provenanceCurrent: tracks.filter((track) => track.provenanceCurrent).length,
    checks: Object.fromEntries(aggregate.checks.map((check) => [check.id, { status: check.status, passingTracks: tracks.filter((track) => track.assessment.checks.find((entry) => entry.id === check.id)?.status === 'pass').length }])),
  },
  assessment: aggregate, tracks, excluded,
  blockers: [
    'The six source Seurat objects HCA_Macaque001_S001-S006 are not in the repository; data/raw/pseudobulk/samples.tsv records their sizes and SHA-256, but nucleus-level counts, nucleus filtering and the pseudobulk sums cannot be remeasured here.',
    'An authoritative animal-to-object crosswalk from Lei Data S4 M1-M6 to the HCA_Macaque001_S001-S006 object names is absent. Numbering alone is not a crosswalk.',
    'Original read/nucleus quality metrics, doublet filtering and ambient-RNA evidence are absent. Saved composition totals cannot certify those upstream steps.',
    'COP, e36, e38, e39 and i43 have two retained samples in one arm. They require replication review even after source identity is established.',
  ],
};
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
const output = resolve(ROOT, MACAQUE_R460_EVIDENCE);
if (CHECK) {
  if (!existsSync(output) || readFileSync(output, 'utf8').replace(/\r\n/g, '\n') !== serialized) throw new Error('Atlas audit is stale. Run npx tsx scripts/audit_macaque_internal_qc_r460.mts.');
} else {
  writeFileSync(output, serialized);
  const headers = ['track', 'Normal', 'Obese', 'DE_rows', 'CPM_values', 'refit', 'status', ...aggregate.checks.map((check) => check.id), 'excluded_samples'];
  const rows = tracks.map((track) => [track.trackId, track.normalSamples.length, track.obeseSamples.length, track.deRows, track.cpmValues, track.refit, track.assessment.status,
    ...aggregate.checks.map((check) => track.assessment.checks.find((entry) => entry.id === check.id)!.status), track.droppedSamples.join(';')]);
  writeFileSync(resolve(ROOT, OUT, 'tracks.tsv'), `${[headers, ...rows].map((row) => row.join('\t')).join('\n')}\n`);
}
if (MACAQUE_SAMPLES.length !== 6) throw new Error('unexpected sample layout');
process.stdout.write(`${JSON.stringify(evidence.summary)}\n`);
