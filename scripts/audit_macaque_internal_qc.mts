/** Read-only audit of every current macaque app track. Never refits or changes scientific outputs. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MACAQUE_AUDIT_VERSION, MACAQUE_HASH_SCHEME, MACAQUE_SOURCE_PATHS, aggregateMacaqueTracks, atlasFingerprint, auditMacaqueTrack,
  macaqueProtocol, parseMacaqueBundle, parseMacaqueCsv,
} from './lib/macaqueQc.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'data/internal-qc/advancement-2026-09-05/macaque';
const fingerprints: Record<string, string> = {};
const read = (path: string): string => {
  const bytes = readFileSync(resolve(ROOT, path));
  fingerprints[path] = atlasFingerprint(bytes);
  return bytes.toString('utf8');
};
for (const path of MACAQUE_SOURCE_PATHS) read(path);
const meta = parseMacaqueBundle(read('public/datasets/macaque_snrna/meta.js'));
const protocol = macaqueProtocol(read('data/raw/scripts/run_all_clusters.R'));
if (!protocol.valid) throw new Error('The declared atlas protocol changed; inspect the condition map and model before auditing.');
const trackIds: string[] = meta.populations;
if (!Array.isArray(trackIds) || !trackIds.length || new Set(trackIds).size !== trackIds.length) throw new Error('Atlas track registry is empty or duplicated');
const composition = parseMacaqueCsv(read('data/raw/results/_global/composition/cell_counts_by_sample_and_cluster_long.csv')).rows;
const runRows = parseMacaqueCsv(read('data/raw/results/_global/summary/run_status.csv')).rows;
const folders = readdirSync(resolve(ROOT, 'data/raw/results'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const tracks = trackIds.map((id) => {
  const matches = folders.filter((folder) => folder.startsWith(`${id}__`));
  if (matches.length !== 1) throw new Error(`${id}: expected one result folder, found ${matches.length}`);
  const base = `data/raw/results/${matches[0]}`;
  const paths = [`public/datasets/macaque_snrna/track_${id}.js`, `${base}/de/DE_all.csv`, `${base}/de/normcpm.csv`, `${base}/qc/group_sizes.csv`];
  const audit = auditMacaqueTrack({ id, bundle: parseMacaqueBundle(read(paths[0])), datasetMeta: meta,
    de: parseMacaqueCsv(read(paths[1])).rows, cpm: parseMacaqueCsv(read(paths[2])), groupRows: parseMacaqueCsv(read(paths[3])).rows,
    composition, runRows, protocol, evidence: [MACAQUE_SOURCE_PATHS[0], MACAQUE_SOURCE_PATHS[10], MACAQUE_SOURCE_PATHS[11], ...paths] });
  return { ...audit, paths };
});
const excluded = runRows.filter((row) => !trackIds.includes(row.cluster)).map((row) => ({ trackId: row.cluster, status: row.status, message: row.message,
  hasSavedDe: folders.filter((folder) => folder.startsWith(`${row.cluster}__`)).some((folder) => existsSync(resolve(ROOT, 'data/raw/results', folder, 'de/DE_all.csv'))) }));
if (excluded.some((entry) => entry.status === 'ok' || entry.hasSavedDe)) throw new Error('An undisplayed successful population needs explicit registry review');
const aggregate = aggregateMacaqueTracks(tracks);
const evidence = {
  schemaVersion: 1, auditVersion: MACAQUE_AUDIT_VERSION, fingerprintScheme: MACAQUE_HASH_SCHEME, datasetId: 'macaque_snrna', contrastId: 'obese_vs_normal',
  trackIds, fingerprints: Object.fromEntries(Object.entries(fingerprints).sort(([a], [b]) => a.localeCompare(b))),
  summary: {
    appTracks: tracks.length, deRows: tracks.reduce((sum, track) => sum + track.deRows, 0),
    cpmValues: tracks.reduce((sum, track) => sum + track.cpmValues, 0),
    threeVersusThree: tracks.filter((track) => track.normalSamples.length === 3 && track.obeseSamples.length === 3).length,
    reducedReplicationTracks: tracks.filter((track) => track.droppedSamples.length).map((track) => track.trackId),
    checks: Object.fromEntries(aggregate.checks.map((check) => [check.id, { status: check.status, passingTracks: tracks.filter((track) => track.assessment.checks.find((entry) => entry.id === check.id)?.status === 'pass').length }])),
  },
  assessment: aggregate, tracks, excluded,
  blockers: [
    'Original Seurat objects HCA_Macaque001_S001-S006 with RNA counts layer and celltype_level3_abbr metadata are absent.',
    'run_all_clusters.R only discovers preloaded objects in .GlobalEnv. It constructs and filters each pseudobulk matrix in memory; no matrix, DGEList, TMM factors, library totals or fitted model is persisted.',
    'An authoritative animal-to-object crosswalk from Lei Data S4 M1-M6 to the HCA_Macaque001_S001-S006 object names is absent. Numbering alone is not a crosswalk.',
    'Original read/nucleus quality metrics, doublet filtering and ambient-RNA evidence are absent. Saved composition totals cannot certify those upstream steps.',
    'COP, e36, e38, e39 and i43 have two retained samples in one arm. They require replication review even after source identity is established.',
  ],
};
mkdirSync(resolve(ROOT, OUT), { recursive: true });
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
const output = resolve(ROOT, OUT, 'atlas-evidence.json');
if (process.argv.includes('--check')) {
  if (!existsSync(output) || readFileSync(output, 'utf8').replace(/\r\n/g, '\n') !== serialized) throw new Error('Atlas audit is stale. Run npx tsx scripts/audit_macaque_internal_qc.mts.');
} else {
  writeFileSync(output, serialized);
  const headers = ['track', 'Normal', 'Obese', 'DE_rows', 'CPM_values', 'status', ...aggregate.checks.map((check) => check.id), 'excluded_samples'];
  const rows = tracks.map((track) => [track.trackId, track.normalSamples.length, track.obeseSamples.length, track.deRows, track.cpmValues, track.assessment.status,
    ...aggregate.checks.map((check) => track.assessment.checks.find((entry) => entry.id === check.id)!.status), track.droppedSamples.join(';')]);
  writeFileSync(resolve(ROOT, OUT, 'tracks.tsv'), `${[headers, ...rows].map((row) => row.join('\t')).join('\n')}\n`);
  const report = [
    '# Macaque atlas internal QC audit', '',
    `Audited all ${tracks.length} populations currently listed in the app metadata. Checked ${evidence.summary.deRows.toLocaleString('en-US')} DE rows and ${evidence.summary.cpmValues.toLocaleString('en-US')} retained-sample CPM values. Aggregate status: ${aggregate.status}.`, '',
    'This audit measures the saved outputs and local analysis assignments. It does not reconstruct missing count matrices or claim upstream sequencing QC passed. Every consumed input, script and current bundle is SHA-256 pinned in atlas-evidence.json. The explicitly versioned text hash scheme converts CRLF to LF before hashing, matching Git checkout conventions; all other characters and numerical values remain significant. No original scientific file is modified. The central builder rejects stale or incomplete evidence.', '',
    '| Check | Passing tracks | Aggregate |', '| --- | ---: | --- |',
    ...aggregate.checks.map((check) => `| ${check.label} | ${evidence.summary.checks[check.id].passingTracks}/${tracks.length} | ${check.status} |`), '',
    '## Sample support', '',
    `${evidence.summary.threeVersusThree} tracks retain all three Normal and three Obese samples. The five smaller tracks have two samples in one arm. CPM values use six canonical display slots; absent samples must be null, never zero-filled or counted as retained replicates.`, '',
    '| Track | Normal | Obese | Excluded sample | Recorded nuclei |', '| --- | ---: | ---: | --- | ---: |',
    ...tracks.filter((track) => track.droppedSamples.length).map((track) => `| ${track.trackId} | ${track.normalSamples.length} | ${track.obeseSamples.length} | ${track.droppedSamples.join(', ')} | ${track.droppedSamples.map((sample) => track.cells[sample]).join(', ')} |`), '',
    'The sample support check uses the recorded composition totals and the declared 15-nucleus minimum. Independent animal replication stays unassessed until the six object names are linked to source animal identifiers.', '',
    '## Failed populations outside the app', '',
    ...excluded.map((entry) => `- ${entry.trackId}: ${entry.message}. No DE output exists and this population is not one of the ${tracks.length} app tracks.`), '',
    '## Remaining evidence needed', '', ...evidence.blockers.map((blocker) => `- ${blocker}`), '',
    '## Reproduce', '', '```powershell', 'npx tsx scripts/audit_macaque_internal_qc.mts', 'npx tsx scripts/audit_macaque_internal_qc.mts --check', 'npx tsx scripts/build_internal_qc.mts', '```', '',
    'The complete per-track results and source paths are in atlas-evidence.json and tracks.tsv. The original counts search and primary-source lookup are documented in INPUT_SEARCH.md.', '',
  ].join('\n');
  writeFileSync(resolve(ROOT, OUT, 'README.md'), report);
}
process.stdout.write(`${JSON.stringify(evidence.summary)}\n`);
