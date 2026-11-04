// Read-only structural agreement check for the dataset registry and its emitted
// sidecars. This deliberately does not compare query-index row values with
// bundles; scripts/build_query_index.mts --check owns that stronger gate.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolvePathwayIndexUrl,
  resolvePathwayUrl,
  resolveTimeSeriesGlobalKey,
  resolveTimeSeriesUrl,
  resolveTrackGlobalKey,
  resolveTrackUrl,
  sameOriginDataset,
} from '../src/data/bundleLocators';
import { getActiveContrast } from '../src/data/contrasts';
import { listDatasets } from '../src/data/datasets';
import { manifestFreshness, REBUILD_HINT, type MetaShape } from '../src/data/indexFreshness';
import { groupSamplesOf } from '../src/data/rawTrack';
import { sourceAccession, UPSTREAM_PROCESSING } from '../src/data/upstreamProcessing';
import { TRACKER_REVERSE_INDEX } from '../src/data/tracker/reverseIndex.generated.js';
import type { Dataset, DatasetMeta, RawTrack, TimeSeriesBundle, TrackerCatalog } from '../src/types';
import { buildRegistry } from './lib/trackerIntegration.mjs';

type QueryManifest = Parameters<typeof manifestFreshness>[0] & {
  tracks: Array<{ ds: string; trackId: string }>;
  datasets?: Array<{ ds: string }>;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALL_TRACKS = process.argv.includes('--all-tracks');
const datasets = listDatasets();
const registryIds = new Set(datasets.map((dataset) => dataset.id));
const failures: string[] = [];
const warnings: string[] = [];
const notes: string[] = [];

function localPublic(locator: string): string {
  return path.join(ROOT, 'public', locator.replace(/^[/\\]+/, ''));
}

function fail(check: string, message: string): void {
  failures.push(`✗ ${check}: ${message}`);
}

function warn(check: string, message: string): void {
  warnings.push(`! ${check}: ${message}`);
}

function note(message: string): void {
  notes.push(`NOTE: ${message}`);
}

function invalidPublicGene(gene: string): string | null {
  if (/^ENS[A-Z]*G\d/i.test(gene)) return 'raw Ensembl identifier';
  if (/^__/.test(gene)) return 'reserved/quarantine sentinel';
  if (/_XLOC_/i.test(gene)) return 'ambiguous XLOC label';
  if (gene.includes(',')) return 'compound comma-delimited label';
  return null;
}

function checkGeneKeys(check: string, owner: string, genes: Iterable<string>): void {
  for (const gene of genes) {
    const reason = invalidPublicGene(gene);
    if (reason) fail(check, `${owner}: ${reason} escaped into public gene key "${gene}"`);
  }
}

function readJsonp<T>(file: string, expectedGlobal: string): T {
  const source = readFileSync(file, 'utf8');
  const equals = source.indexOf('=');
  if (equals < 0) throw new Error('has no assignment');
  const lhs = source.slice(0, equals).trim().split(/\r?\n/).at(-1)?.trim() ?? '';
  const match = /^(?:var\s+|window\.)([A-Za-z_$][\w$]*)$/.exec(lhs);
  const assigned = match?.[1];
  if (assigned !== expectedGlobal) {
    throw new Error(`assigns ${assigned ?? '(unrecognised)'}; expected ${expectedGlobal}`);
  }
  const rest = source.slice(equals + 1).trim();
  const start = Math.min(...['{', '['].map((token) => {
    const index = rest.indexOf(token);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  }));
  if (!Number.isFinite(start)) throw new Error('has no JSON object or array payload');
  return JSON.parse(rest.slice(start).replace(/;\s*$/, '')) as T;
}

function readRequiredJsonp<T>(check: string, file: string, globalName: string): T | null {
  if (!existsSync(file)) {
    fail(check, `missing ${path.relative(ROOT, file)}`);
    return null;
  }
  try {
    return readJsonp<T>(file, globalName);
  } catch (error) {
    fail(check, `${path.relative(ROOT, file)}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// Bundle names come from the shared locators — the checker must not re-derive
// by string surgery the very names whose drift it exists to catch. Locators
// prepend bundleBaseUrl, so hand them the shared same-origin projection and
// map the rooted locator path onto public/. Memoized: the sweep derives a
// handful of names per track and there is no reason to respread per call.
const locatedCache = new WeakMap<Dataset, Dataset>();
function located(dataset: Dataset): Dataset {
  let loc = locatedCache.get(dataset);
  if (!loc) {
    loc = sameOriginDataset(dataset);
    locatedCache.set(dataset, loc);
  }
  return loc;
}

function trackFile(dataset: Dataset, trackId: string): string {
  return localPublic(resolveTrackUrl(located(dataset), trackId));
}

function trackGlobal(dataset: Dataset, trackId: string): string {
  return resolveTrackGlobalKey(dataset, trackId);
}

function pathwayFile(dataset: Dataset, trackId: string): string {
  return localPublic(resolvePathwayUrl(located(dataset), trackId));
}

function pathwayIndexFile(dataset: Dataset): string {
  return localPublic(resolvePathwayIndexUrl(located(dataset)));
}

const diskMeta = new Map<string, DatasetMeta>();
let declaredTracks = 0;

for (const dataset of datasets) {
  const meta = readRequiredJsonp<DatasetMeta>('disk', localPublic(dataset.metaFile), dataset.metaGlobalKey);
  readRequiredJsonp<unknown>('disk', localPublic(dataset.qcFile), dataset.qcGlobalKey);
  if (!meta) continue;
  diskMeta.set(dataset.id, meta);

  if (!Array.isArray(meta.populations) || meta.populations.length === 0) {
    fail('disk', `${dataset.id}: meta.populations is empty`);
    continue;
  }
  declaredTracks += meta.populations.length;
  if (!meta.populations.includes(dataset.defaultTrack)) {
    fail('disk', `${dataset.id}: default track "${dataset.defaultTrack}" is absent from meta.populations`);
  }

  const declaredFiles = new Set<string>();
  for (const trackId of meta.populations) {
    const file = trackFile(dataset, trackId);
    declaredFiles.add(path.basename(file));
    if (!existsSync(file)) fail('disk', `${dataset.id}: missing ${path.relative(ROOT, file)}`);
    if (dataset.supportsPathways && !existsSync(pathwayFile(dataset, trackId))) {
      warn('disk', `${dataset.id}/${trackId}: optional pathway sibling is absent`);
    }
  }
  if (dataset.supportsPathways && !existsSync(pathwayIndexFile(dataset))) {
    warn('disk', `${dataset.id}: optional pathways_index.js is absent`);
  }

  const datasetDir = path.dirname(localPublic(dataset.metaFile));
  for (const name of readdirSync(datasetDir)) {
    if (!name.startsWith('track_') || !name.endsWith('.js') || name.endsWith('.pathways.js')) continue;
    if (!declaredFiles.has(name)) {
      warn('disk', `${dataset.id}: staged track file ${name} is not declared by meta.populations`);
    }
  }

    if (dataset.timeSeries) {
    const populations = new Set(meta.populations);
    for (const trackId of dataset.timeSeries.tracks) {
      if (!populations.has(trackId)) {
        fail('disk', `${dataset.id}: time-series track "${trackId}" is absent from meta.populations`);
      }
      const file = localPublic(resolveTimeSeriesUrl(located(dataset), trackId));
      const series = readRequiredJsonp<TimeSeriesBundle>(
        'time-series', file, resolveTimeSeriesGlobalKey(dataset, trackId),
      );
      if (!series) continue;
      const genes = Object.keys(series.values ?? {});
      checkGeneKeys('public identifiers', `${dataset.id}/${trackId} time-series`, genes);
      if (series.meta.nGenes !== genes.length) {
        fail(
          'time-series',
          `${dataset.id}/${trackId}: meta.nGenes=${series.meta.nGenes}, values has ${genes.length} keys`,
        );
      }
      for (const gene of genes) {
        if (series.values[gene].length !== series.meta.samples.length) {
          fail(
            'time-series',
            `${dataset.id}/${trackId}/${gene}: ${series.values[gene].length} values for ${series.meta.samples.length} samples`,
          );
        }
      }
    }
  }
}
console.log(`disk: ${diskMeta.size}/${datasets.length} metadata payloads parsed; ${declaredTracks} tracks declared`);

const manifestFile = path.join(ROOT, 'public', 'query', 'tracks.js');
if (!existsSync(manifestFile)) {
  note('public/query/tracks.js is absent; query-manifest checks skipped.');
} else {
  try {
    const manifest = readJsonp<QueryManifest>(manifestFile, 'HX_QUERY_TRACKS');
    const report = manifestFreshness(
      manifest,
      datasets,
      ['coverage', 'trackCounts', 'defaultTrack', 'contrast', 'exprScaffold'],
      { metaFor: (dataset): MetaShape | undefined => diskMeta.get(dataset.id) },
    );
    for (const problem of report.problems) fail('query manifest', problem);
    if (!report.ok) note(REBUILD_HINT);
    console.log(
      `query manifest: ${manifest.tracks.length} tracks; ${manifest.datasets?.length ?? 0} dataset summaries; `
      + `${report.problems.length} problem(s)`,
    );
  } catch (error) {
    fail('query manifest', error instanceof Error ? error.message : String(error));
  }
}

// Every registered study needs its depositor's upstream-processing record;
// scripts/build_upstream_processing.mts --check owns the record's contents.
for (const dataset of datasets) {
  const accession = sourceAccession(dataset);
  if (!accession) fail('upstream', `${dataset.id}: no source accession`);
  else if (!UPSTREAM_PROCESSING[accession]) fail('upstream', `${dataset.id}: no upstream-processing record for ${accession}`);
}

const reverseIndex = TRACKER_REVERSE_INDEX as Record<string, string>;
for (const datasetId of Object.keys(reverseIndex)) {
  if (!registryIds.has(datasetId)) fail('tracker', `reverse index names unregistered dataset ${datasetId}`);
}

const accessionsFile = path.join(ROOT, 'src', 'data', 'tracker', 'explorerAccessions.json');
let explorerAccessions: Record<string, unknown> = {};
try {
  explorerAccessions = JSON.parse(readFileSync(accessionsFile, 'utf8')) as Record<string, unknown>;
  for (const datasetId of Object.keys(explorerAccessions).filter((key) => key !== '_comment')) {
    if (!registryIds.has(datasetId)) fail('tracker', `explorerAccessions.json names unregistered dataset ${datasetId}`);
  }
} catch (error) {
  fail('tracker', `cannot parse explorerAccessions.json: ${error instanceof Error ? error.message : String(error)}`);
}

const allowedAccessions = new Map(
  buildRegistry(datasets, explorerAccessions).map((entry) => [entry.id, new Set(entry.accessions)]),
);
for (const [datasetId, accession] of Object.entries(reverseIndex)) {
  if (!allowedAccessions.get(datasetId)?.has(accession)) {
    fail('tracker', `reverse index maps ${datasetId} to disallowed accession ${accession}`);
  }
}

const catalogFile = path.join(ROOT, 'public', 'tracker', 'catalog.js');
if (!existsSync(catalogFile)) {
  note('public/tracker/catalog.js is absent; generated tracker-catalog checks skipped.');
} else {
  try {
    const catalog = readJsonp<TrackerCatalog>(catalogFile, 'HX_TRACKER_CATALOG');
    const explorerIds = new Set((catalog.explorer ?? []).map((entry) => entry.id));
    for (const datasetId of registryIds) {
      if (!explorerIds.has(datasetId)) fail('tracker', `catalog explorer is missing ${datasetId}`);
    }
    for (const datasetId of explorerIds) {
      if (!registryIds.has(datasetId)) fail('tracker', `catalog explorer names unregistered dataset ${datasetId}`);
    }

    const catalogReverse = new Map<string, Set<string>>();
    for (const row of catalog.rows ?? []) {
      if (!row.integrated || row.match?.tier !== 'dataset') continue;
      const allowed = allowedAccessions.get(row.match.id);
      if (!allowed?.has(row.acc)) {
        fail(
          'tracker',
          `catalog maps ${row.match.id} to disallowed accession ${row.acc}; allowed: ${[...(allowed ?? [])].join(', ') || '(none)'}`,
        );
      }
      const matches = catalogReverse.get(row.match.id) ?? new Set<string>();
      matches.add(row.acc);
      catalogReverse.set(row.match.id, matches);
    }
    for (const [datasetId, accession] of Object.entries(reverseIndex)) {
      if (!catalogReverse.get(datasetId)?.has(accession)) {
        fail(
          'tracker',
          `reverse index maps ${datasetId} to ${accession}, catalog has ${[...(catalogReverse.get(datasetId) ?? [])].join(', ') || '(missing)'}`,
        );
      }
    }
    console.log(
      `tracker: ${catalog.explorer?.length ?? 0} explorer entries; ${catalogReverse.size} integrated reverse mappings`,
    );
  } catch (error) {
    fail('tracker', error instanceof Error ? error.message : String(error));
  }
}

let bundlesParsed = 0;
for (const dataset of datasets) {
  const meta = diskMeta.get(dataset.id);
  if (!meta?.populations?.length) continue;
  const selected = ALL_TRACKS ? meta.populations : [dataset.defaultTrack];
  const contrast = getActiveContrast(dataset);
  if (!contrast) {
    fail('bundle groups', `${dataset.id}: active contrast is unresolved`);
    continue;
  }

  for (const trackId of selected) {
    const raw = readRequiredJsonp<RawTrack>('bundle groups', trackFile(dataset, trackId), trackGlobal(dataset, trackId));
    if (!raw) continue;
    bundlesParsed++;
    const owner = `${dataset.id}/${trackId}`;
    const cpmGenes = Object.keys(raw.cpm ?? {});
    checkGeneKeys('public identifiers', `${owner} expression`, cpmGenes);
    const deTables = [
      ...(raw.de ? [['default', raw.de] as const] : []),
      ...Object.entries(raw.deByContrast ?? {}),
    ];
    for (const [contrastId, table] of deTables) {
      const seen = new Set<string>();
      for (const row of table) {
        checkGeneKeys('public identifiers', `${owner}/${contrastId} DE`, [row.gene]);
        if (seen.has(row.gene)) fail('bundle genes', `${owner}/${contrastId}: duplicate DE gene "${row.gene}"`);
        seen.add(row.gene);
        if (row.se != null && (!Number.isFinite(row.se) || row.se <= 0)) {
          fail('bundle uncertainty', `${owner}/${contrastId}/${row.gene}: invalid SE ${row.se}`);
        }
      }
    }
    const sampleOrder = raw.meta?.sampleOrder;
    if (sampleOrder) {
      for (const gene of cpmGenes) {
        if (raw.cpm[gene].length !== sampleOrder.length) {
          fail(
            'bundle expression',
            `${owner}/${gene}: ${raw.cpm[gene].length} values for ${sampleOrder.length} samples`,
          );
        }
      }
    }
    const grouped = groupSamplesOf(raw);
    for (const arm of [contrast.baseline.key, contrast.caseGroup.key]) {
      if (!grouped?.[arm]?.length) {
        fail('bundle groups', `${dataset.id}/${trackId}: active arm "${arm}" has no samples`);
      }
    }
    const order = raw.meta?.sampleOrder;
    if (order) {
      const known = new Set(order);
      for (const arm of [contrast.baseline.key, contrast.caseGroup.key]) {
        const orphan = grouped?.[arm]?.find((sample) => !known.has(sample));
        if (orphan) fail('bundle groups', `${dataset.id}/${trackId}: arm sample "${orphan}" is absent from sampleOrder`);
      }
    }
  }
}
console.log(`bundle groups: ${bundlesParsed} ${ALL_TRACKS ? 'track' : 'default-track'} payload(s) parsed`);

for (const message of warnings) console.warn(message);
for (const message of notes) console.log(message);
for (const message of failures) console.error(message);
console.log(
  'NOTE: structural checks do not compare query-index row values with bundle rows; '
  + 'run `npx tsx scripts/build_query_index.mts --check` for value-level closure.',
);

if (failures.length > 0) {
  console.error(`dataset structural check failed: ${failures.length} problem(s), ${warnings.length} warning(s)`);
  process.exitCode = 1;
} else {
  console.log(`dataset structural check passed: ${datasets.length} datasets, ${warnings.length} warning(s)`);
}
