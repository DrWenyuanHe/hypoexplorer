/**
 * Refresh only public pathway siblings and indexes from schema-3 FGSEA sets.
 * Expression/DE track bundles, metadata, QC, and time series are never rewritten.
 *
 * npx tsx scripts/refresh_fgsea_bundles.mts --dry
 * npx tsx scripts/refresh_fgsea_bundles.mts --only GSE124693 --check
 * npx tsx scripts/refresh_fgsea_bundles.mts
 * npx tsx scripts/refresh_fgsea_bundles.mts --check
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveTimeSeriesUrl,
  resolveTrackGlobalKey,
  resolveTrackUrl,
  sameOriginDataset,
} from '../src/data/bundleLocators';
import { DATASETS } from '../src/data/datasets';
import type { PathwayDatabase, RawTrack } from '../src/types';
import { planPathwayBundles, type PlannedBundleFile } from './lib/bundleWriter.mjs';
import { assertMechanicalAuditFresh, carriedForwardWarning, missingLocalInputs } from './lib/authorValidationAudit.mjs';
import { readVerifiedFgseaSet, resolveConfiguredFgseaSpecies } from './lib/fgseaProvenance.mjs';
import { applyPathwayBundlePlans } from './lib/pathwayBundleRefresh.mjs';
import { createReviewedFgseaSpeciesResolver } from './lib/reviewedFgseaSpecies.mjs';
import { supersession, supersessionNames } from './lib/historicalEvidence.mjs';
import SEPTEMBER5_STUDIES from '../src/data/september5Studies.generated.json';
import SEPTEMBER5_ANALYSES from '../data/intake/september5-2026/analyses.json';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hfdStudiesPath = resolve(ROOT, 'data/intake/hfd-2026-09-12/studies.json');
const hfdAnalysesPath = resolve(ROOT, 'data/intake/hfd-2026-09-12/analyses.json');
const HFD_STUDIES = existsSync(hfdStudiesPath) ? JSON.parse(readFileSync(hfdStudiesPath, 'utf8')) : [];
const HFD_ANALYSES = existsSync(hfdAnalysesPath) ? JSON.parse(readFileSync(hfdAnalysesPath, 'utf8')) as typeof SEPTEMBER5_ANALYSES : [];
const PUBLIC = resolve(ROOT, 'public');
// The GSE314184 review gate pins the evidence sealed on September 11, some of which the
// R 4.6.0 regeneration rewrote. Its reads of those paths receive the verified
// pre-regeneration bytes (supersession manifest); every other read is current.
const reviewedFgseaSpecies = createReviewedFgseaSpeciesResolver(ROOT, (path) => {
  const bytes = readFileSync(resolve(ROOT, path));
  if (!supersessionNames(ROOT, path)) return bytes;
  const state = supersession(ROOT);
  return state.records.has(path) ? state.readOutput(path, state.servedPin(path), bytes) : state.ledger(path, bytes);
});
const EXCLUDED = 'macaque_snrna';
const args = process.argv.slice(2);
const only = new Set<string>();
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--only' || args[index].startsWith('--only=')) {
    const value = args[index] === '--only' ? args[++index] : args[index].slice('--only='.length);
    if (!value || value.startsWith('--')) throw new Error('--only requires a comma-separated dataset id or accession list');
    value.split(',').filter(Boolean).forEach((id) => { only.add(id); });
  } else if (!['--check', '--dry'].includes(args[index])) throw new Error(`unknown argument: ${args[index]}`);
}
if (args.includes('--check') && args.includes('--dry')) throw new Error('choose either --check or --dry');
assertMechanicalAuditFresh(ROOT);

interface MechanicalDataset {
  datasetId: string;
  directory: string;
  trackId: string;
  bundleIntegrity: string;
  deTableMapping: string;
  contrasts: Array<{ contrastId: string; table: string; result: string }>;
}
const audit = JSON.parse(readFileSync(resolve(ROOT, 'data/author-validation/mechanical-audit.generated.json'), 'utf8')) as {
  schemaVersion: number;
  datasets: MechanicalDataset[];
};
const inScope = DATASETS.filter((dataset) => dataset.id !== EXCLUDED);
const audited = new Map(audit.datasets.map((dataset) => [dataset.datasetId, dataset]));
if (audit.schemaVersion !== 2 || audited.size !== audit.datasets.length || audited.size !== inScope.length
  || inScope.some((dataset) => !audited.has(dataset.id))) {
  throw new Error('mechanical audit must have schema-2 exact in-scope registry closure');
}
for (const id of only) {
  if (!inScope.some((dataset) => dataset.id === id || dataset.geo === id)) throw new Error(`unknown or excluded --only dataset: ${id}`);
}
const selected = inScope.filter((dataset) => !only.size || only.has(dataset.id) || only.has(dataset.geo ?? ''));

function localFile(root: string, path: string): string {
  const file = resolve(root, path.replace(/^\//, ''));
  const rel = relative(root, file);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`path escapes expected root: ${path}`);
  return file;
}

function readJsonp<T>(path: string, key: string): T {
  const text = readFileSync(path, 'utf8').trim();
  const prefix = `var ${key} = `;
  if (!text.startsWith(prefix) || !text.endsWith(';')) throw new Error(`${path}: unexpected JSONP wrapper`);
  return JSON.parse(text.slice(prefix.length, -1)) as T;
}

const plans: PlannedBundleFile[] = [];
const protectedFiles: string[] = [];
let contrastCount = 0;
let carriedForward = 0;
for (const dataset of selected) {
  const evidence = audited.get(dataset.id)!;
  // A dataset whose local FGSEA inputs are incomplete on this machine (see
  // LOCAL_INPUT_DATASETS) keeps its committed pathway bundles unverified.
  const missing = missingLocalInputs(ROOT, dataset.id);
  if (missing.length) {
    const bundleDirectory = dirname(dataset.bundleFileTemplate.replace(/^\//, ''));
    process.stderr.write(carriedForwardWarning(dataset.id, 'refresh_fgsea_bundles.mts', missing, `public/${bundleDirectory}/*.pathways.js`));
    carriedForward += 1;
    continue;
  }
  const ids = dataset.contrasts.map((contrast) => contrast.id);
  if (evidence.trackId !== dataset.defaultTrack || evidence.bundleIntegrity !== 'pass'
    || !['sole_table', 'explicit'].includes(evidence.deTableMapping)
    || evidence.contrasts.length !== ids.length
    || new Set(evidence.contrasts.map((contrast) => contrast.contrastId)).size !== ids.length
    || evidence.contrasts.some((contrast) => !ids.includes(contrast.contrastId) || contrast.result !== 'pass')
    || new Set(evidence.contrasts.map((contrast) => contrast.table)).size !== ids.length) {
    throw new Error(`${dataset.id}: mechanical audit has no exact passing contrast-to-DE mapping`);
  }
  const located = sameOriginDataset(dataset);
  if ([...SEPTEMBER5_STUDIES, ...HFD_STUDIES].some((study) => study.id === dataset.id)) {
    // New multi-population studies have an explicit per-track analysis ledger.
    // Preserve every track and form the shared pathway index from their union.
    const metaPath = localFile(PUBLIC, located.metaFile);
    const meta = readJsonp<{ populations: string[] }>(metaPath, dataset.metaGlobalKey);
    const analyses = [...SEPTEMBER5_ANALYSES, ...HFD_ANALYSES].filter((analysis) => analysis.studyId === dataset.id);
    const trackIds = [...new Set(analyses.map((analysis) => analysis.track))];
    if (JSON.stringify([...trackIds].sort()) !== JSON.stringify([...meta.populations].sort())) {
      throw new Error(`${dataset.id}: intake track ledger does not match metadata`);
    }
    protectedFiles.push(metaPath, localFile(PUBLIC, located.qcFile));
    const names = new Set<string>();
    let indexPlan: PlannedBundleFile | undefined;
    for (const trackId of trackIds) {
      const trackPath = localFile(PUBLIC, resolveTrackUrl(located, trackId));
      const track = readJsonp<RawTrack>(trackPath, resolveTrackGlobalKey(dataset, trackId));
      if (track.pathways || track.pathwaysByContrast) throw new Error(`${dataset.id}/${trackId}: embedded pathways`);
      protectedFiles.push(trackPath);
      const active = analyses.filter((analysis) => analysis.track === trackId);
      if (active.length !== ids.length || new Set(active.map((a) => a.contrast)).size !== ids.length) {
        throw new Error(`${dataset.id}/${trackId}: incomplete contrast ledger`);
      }
      const blocks: Record<string, PathwayDatabase> = {};
      for (const contrastId of ids) {
        const analysis = active.find((a) => a.contrast === contrastId);
        if (!analysis) throw new Error(`${dataset.id}/${trackId}: missing ${contrastId}`);
        const dePath = localFile(ROOT, `${evidence.directory}/processed/${analysis.analysisId}_DE.tsv`);
        blocks[contrastId] = readVerifiedFgseaSet(dePath, { expectedSpecies: reviewedFgseaSpecies({
          datasetId: dataset.id, organism: dataset.organism, trackId, contrastId, dePath,
        }) }).publicBlock;
        for (const rows of Object.values(blocks[contrastId])) for (const row of rows) names.add(row.pathway);
        contrastCount += 1;
      }
      const [sibling, index] = planPathwayBundles({ ...dataset, defaultTrack: trackId }, trackId, blocks, { outRoot: PUBLIC });
      plans.push(sibling); indexPlan = index;
    }
    if (!indexPlan) throw new Error(`${dataset.id}: no pathway index`);
    plans.push({ ...indexPlan, body: `var ${indexPlan.key} = ${JSON.stringify([...names].sort())};\n` });
    continue;
  }
  const trackPath = localFile(PUBLIC, resolveTrackUrl(located, dataset.defaultTrack));
  const raw = readJsonp<RawTrack>(trackPath, resolveTrackGlobalKey(dataset, dataset.defaultTrack));
  if (raw.pathways || raw.pathwaysByContrast) {
    throw new Error(`${dataset.id}: embedded pathways must be split before a pathway-only refresh`);
  }
  const metaPath = localFile(PUBLIC, located.metaFile);
  const meta = readJsonp<{ populations?: string[] }>(metaPath, dataset.metaGlobalKey);
  if (meta.populations?.length !== 1 || meta.populations[0] !== dataset.defaultTrack) {
    throw new Error(`${dataset.id}: refresh requires exactly the audited default track`);
  }
  protectedFiles.push(trackPath, metaPath, localFile(PUBLIC, located.qcFile));
  const timeseriesPath = localFile(PUBLIC, resolveTimeSeriesUrl(located, dataset.defaultTrack));
  if (existsSync(timeseriesPath)) protectedFiles.push(timeseriesPath);
  const processedRoot = localFile(ROOT, `${evidence.directory}/processed`);
  const blocks: Record<string, PathwayDatabase> = {};
  for (const contrast of evidence.contrasts) {
    const dePath = localFile(ROOT, contrast.table);
    if (dirname(dePath) !== processedRoot) throw new Error(`${dataset.id}: mapped DE table is outside the dataset's processed directory`);
    blocks[contrast.contrastId] = readVerifiedFgseaSet(dePath, {
      expectedSpecies: resolveConfiguredFgseaSpecies(dePath),
    }).publicBlock;
    contrastCount += 1;
  }
  plans.push(...planPathwayBundles(dataset, dataset.defaultTrack, blocks, { outRoot: PUBLIC }));
}

const result = applyPathwayBundlePlans(plans, {
  check: args.includes('--check'),
  dry: args.includes('--dry'),
  protectedFiles,
});
process.stdout.write(
  `${args.includes('--check') ? 'verified current' : args.includes('--dry') ? 'prepared (no writes)' : 'refreshed'} pathway bundles: `
  + `${selected.length - carriedForward} datasets, ${contrastCount} contrasts, ${result.files} files, ${result.changed.length} changed; `
  + `${carriedForward} dataset(s) carried forward unverified; `
  + `${protectedFiles.length} DE/expression/meta/QC/time-series files preserved\n`,
);
