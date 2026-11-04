// Build the time-series (circadian) sibling bundles: public/datasets/<id>/timeseries_<track>.js
//
// The DE bundles collapse each of these studies to ONE two-arm contrast — the
// GSE252364 SCN bundle ships CT0 alone (3 v 3 of 36 libraries) and the GSE248462
// ARC bundle pools ZT4/10/16/22 into a single 12 v 12 genotype comparison. Both
// series were downloaded whole and are sitting in geo_replication/; the time
// axis was discarded at ingestion because the bundle contract had nowhere to put
// it. This generator emits that axis as its own bundle, so the Circadian tab can
// test for rhythms without changing anything about how the DE tab reads.
//
// Since the R 4.6.0 regeneration (2026-09-25) every value source is symbol-level
// and unique per public symbol (scripts/lib/regenTables.mts), and the gene
// universe is the symbol-keyed DE table's, so the Circadian tab and the Gene
// Explorer talk about exactly the same genes:
//   - 'table': a symbol x sample table the DE run wrote, when it already covers
//     every library of the series — the fit's own TMM CPM (<id>_CPM_TMM.tsv.gz;
//     GSE248462's DE pools all 24 ARC libraries) or the deposited-scale
//     <id>_expression.tsv.gz (GSE157077, shipped as log2(value + 1)).
//   - 'rawCounts': the raw feature-level counts, for a series whose DE contrast
//     uses only some of its libraries (GSE252364: CT0 only). Features are summed
//     per public symbol through <id>_feature_map.tsv.gz — the same pre-test
//     aggregation the fit used (unmapped rows stay in the library totals) — and
//     scaled to TMM CPM with edgeR's calcNormFactors (scripts/lib/tmm.mts) over
//     ALL libraries shipped here. Those factors are the time course's own, not
//     the CT0 fit's, so a CT0 value here matches the DE bundle only closely.
//
// Usage: npx tsx scripts/build_timeseries_bundles.mts [--dry]

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRectangular } from './lib/matrixShape.mjs';
import { outDirFromArgv, requireDataset, writeTimeSeriesBundle } from './lib/bundleWriter.mjs';
import {
  CPM_TMM_UNIT, assertUniqueKeys, readFeatureMap, readSymbolDe, readText, readTsv,
} from './lib/regenTables.mjs';
import { calcNormFactorsTMM } from './lib/tmm.mjs';
import type { TimeSeriesBundle } from '../src/types';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATASETS_DIR = resolve(ROOT, 'geo_replication', 'datasets');
const DRY = process.argv.includes('--dry');
const OUT_ROOT = outDirFromArgv();

const log = (msg: string) => process.stdout.write(`${msg}\n`);

/** What one sample name decodes to; null skips the column entirely. */
interface ParsedSample {
  arm: string;
  /** Sampling time in hours on the dataset's own axis. */
  time: number;
}

type SeriesSource =
  /** A symbol x sample table written by the DE run, covering every shipped library. */
  | { kind: 'table'; file: string; transform: 'none' | 'log2' }
  /** Raw feature-level counts + the DE run's feature map → TMM CPM over the series. */
  | { kind: 'rawCounts'; file: string; delimiter: ',' | '\t'; featureMap: string };

interface SeriesSpec {
  datasetId: string;
  trackId: string;
  trackLabel: string;
  /** Paths are relative to geo_replication/datasets/. */
  source: SeriesSource;
  /** Symbol-keyed DE table — the gene universe. */
  deFile: string;
  /** Unit label carried in the bundle and shown on the figure's y axis. */
  expressionUnit: string;
  cycleHours: number;
  timeUnit: 'ZT' | 'CT' | 'h';
  design: string;
  arms: Array<{ key: string; label: string; color: string }>;
  parseSample: (name: string) => ParsedSample | null;
  /** Known quirks in the deposited header, surfaced in the run log. */
  notes?: string[];
}

// The group colours match each dataset's manifest entry, so the rhythm figure
// and the DE bar chart use one colour per arm across the whole app.
const CONTROL_BLUE = '#3775BA';
const CASE_RED = '#B64342';

const SERIES: SeriesSpec[] = [
  {
    datasetId: 'mouse_scn_mcd_gse252364',
    trackId: 'scn',
    trackLabel: 'Suprachiasmatic nucleus (SCN)',
    source: {
      kind: 'rawCounts',
      file: 'GSE252364_mmus_scn_mcd/raw/GSE252364_SCN_gene_counts.csv.gz',
      delimiter: ',',
      featureMap: 'GSE252364_mmus_scn_mcd/processed/GSE252364_feature_map.tsv.gz',
    },
    deFile: 'GSE252364_mmus_scn_mcd/processed/GSE252364_DE.tsv',
    expressionUnit: CPM_TMM_UNIT,
    cycleHours: 24,
    timeUnit: 'CT',
    design: 'SCN sampled every 4 h across one circadian day (CT0-CT20), control vs methionine/choline-deficient diet, 3 mice per arm per timepoint (2 male, 1 female).',
    arms: [
      { key: 'control', label: 'Control', color: CONTROL_BLUE },
      { key: 'case', label: 'MCD diet', color: CASE_RED },
    ],
    // e.g. "CT12 MCD F1"
    parseSample(name) {
      const m = /^CT(\d+)\s+(CTL|MCD)\s+([MF]\d+)/i.exec(name.trim());
      if (!m) return null;
      return { arm: m[2].toUpperCase() === 'CTL' ? 'control' : 'case', time: Number(m[1]) };
    },
    notes: [
      'The deposited header names two CT8 control libraries "CT8 CTL M1"; the series design is 2 male + 1 female per arm per timepoint, so the second is taken to be the mislabelled M2. Both columns are kept as distinct libraries and the duplicate is suffixed.',
      'TMM factors are computed over the 36 libraries of the time course (edgeR calcNormFactors defaults, unfiltered, raw column totals); the DE bundle uses the CT0 fit\'s own factors.',
    ],
  },
  {
    datasetId: 'mouse_arc_clock_gse248462',
    trackId: 'arcuate',
    trackLabel: 'Arcuate nucleus (ARC)',
    // The DE fit pools all 24 ARC libraries (4 timepoints x 2 arms x 3), so its
    // TMM CPM covers the whole series.
    source: { kind: 'table', file: 'GSE248462_mmus_arc_clock/processed/GSE248462_CPM_TMM.tsv.gz', transform: 'none' },
    deFile: 'GSE248462_mmus_arc_clock/processed/GSE248462_DE.tsv',
    expressionUnit: CPM_TMM_UNIT,
    cycleHours: 24,
    timeUnit: 'ZT',
    design: 'Arcuate nucleus sampled at ZT4/10/16/22 over one 24 h cycle, control vs hepatocyte Bmal1/Clock double-knockout, 3 mice per arm per timepoint.',
    arms: [
      { key: 'control', label: 'Control', color: CONTROL_BLUE },
      { key: 'case', label: 'Hep-clock DKO', color: CASE_RED },
    ],
    // e.g. "ArcCre_16_2"
    parseSample(name) {
      const m = /^Arc(GFP|Cre)_(\d+)_(\d+)$/i.exec(name.trim());
      if (!m) return null;
      return { arm: m[1].toUpperCase() === 'GFP' ? 'control' : 'case', time: Number(m[2]) };
    },
    notes: [
      'The deposited count matrix also carries 24 nodose-ganglion libraries (ND*); they are a different tissue and were excluded from the fit and from this bundle.',
    ],
  },
  {
    datasetId: 'mouse_scn_hfd_gse157077',
    trackId: 'scn',
    trackLabel: 'Suprachiasmatic nucleus (SCN)',
    // The DE run joins the two per-arm FPKM matrices, sums duplicate symbols on
    // the linear scale and names the libraries as the samplesheet does.
    source: { kind: 'table', file: 'GSE157077_mmus_scn_hfd/processed/GSE157077_expression.tsv.gz', transform: 'log2' },
    deFile: 'GSE157077_mmus_scn_hfd/processed/GSE157077_DE.tsv',
    // FPKM, not counts. Shipped on the same log2 scale the DE table was fitted
    // on, so the Circadian tab's amplitudes and the Gene Explorer's bars are the
    // same numbers.
    expressionUnit: 'log2(FPKM + 1)',
    cycleHours: 24,
    timeUnit: 'ZT',
    design: 'SCN sampled every 4 h across one 24 h light-dark cycle (ZT0-ZT20), normal chow vs high-fat diet, 3 mice per arm per timepoint. 36 libraries.',
    arms: [
      { key: 'control', label: 'Chow', color: CONTROL_BLUE },
      { key: 'case', label: 'High-fat diet', color: CASE_RED },
    ],
    // e.g. "HFD ZT12 rep3"
    parseSample(name) {
      const m = /^(Chow|HFD) ZT(\d+) rep(\d+)$/.exec(name.trim());
      return m ? { arm: m[1] === 'Chow' ? 'control' : 'case', time: Number(m[2]) } : null;
    },
    notes: [
      'Deposited values are FPKM (non-integer, column sums ~4e5), so this bundle ships log2(FPKM+1) rather than CPM, and the DE table was fitted with limma-trend rather than edgeR-QL.',
      'The series also profiled prefrontal cortex; only the SCN matrices are deposited under this accession and only the SCN is ingested.',
    ],
  },
];

/** Split one delimited line, stripping surrounding double quotes per field. */
function splitLine(line: string, delimiter: string): string[] {
  return line.split(delimiter).map((f) => f.replace(/^"(.*)"$/, '$1').trim());
}

interface BuildResult {
  file: string;
  bytes: number;
  nGenes: number;
  nSamples: number;
  timepoints: number[];
  skippedColumns: number;
}

/** One decoded column: which column it came from, and what it means. */
interface KeptColumn {
  col: number;
  id: string;
  arm: string;
  time: number;
}

/** Decode the header into kept columns, suffixing a repeated library id. */
function keptColumns(spec: SeriesSpec, header: string[]): { kept: KeptColumn[]; skipped: number } {
  const seenIds = new Map<string, number>();
  const kept: KeptColumn[] = [];
  let skipped = 0;
  header.slice(1).forEach((name, i) => {
    const parsed = spec.parseSample(name);
    if (!parsed) { skipped++; return; }
    const count = (seenIds.get(name) ?? 0) + 1;
    seenIds.set(name, count);
    kept.push({ col: i + 1, id: count === 1 ? name : `${name} (${count})`, arm: parsed.arm, time: parsed.time });
  });
  if (!kept.length) throw new Error(`${spec.datasetId}: no sample columns matched the parser`);
  // Stable, readable order: arm (manifest order), then time, then id.
  const armRank = new Map(spec.arms.map((a, i) => [a.key, i]));
  kept.sort((a, b) =>
    (armRank.get(a.arm) ?? 99) - (armRank.get(b.arm) ?? 99)
    || a.time - b.time
    || a.id.localeCompare(b.id));
  return { kept, skipped };
}

/** Symbol -> values over the kept columns, for a symbol-level table the DE run wrote. */
function tableValues(spec: SeriesSpec, source: Extract<SeriesSource, { kind: 'table' }>) {
  const { header, rows } = readTsv(resolve(DATASETS_DIR, source.file));
  assertUniqueKeys(header.slice(1), `${spec.datasetId}: ${source.file} columns`);
  const { kept, skipped } = keptColumns(spec, header);
  assertUniqueKeys(rows.map((row) => row[0]), `${spec.datasetId}: ${source.file}`);
  const values = new Map<string, number[]>();
  for (const row of rows) {
    values.set(row[0], kept.map((k) => {
      const v = Number(row[k.col]);
      if (!Number.isFinite(v)) throw new Error(`${spec.datasetId}: non-numeric ${row[0]}/${k.id}`);
      return source.transform === 'log2' ? Math.log2(v + 1) : v;
    }));
  }
  return { kept, skipped, values, note: null as string | null };
}

/**
 * Symbol -> TMM CPM over the kept columns, from raw feature counts: features are
 * summed per public symbol through the DE run's feature map (unmapped features
 * keep their own rows, so they stay in the library totals and the TMM input),
 * then counts / (column total x TMM factor) x 1e6.
 */
function rawCountValues(spec: SeriesSpec, source: Extract<SeriesSource, { kind: 'rawCounts' }>) {
  const lines = readText(resolve(DATASETS_DIR, source.file)).split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitLine(lines[0], source.delimiter);
  assertRectangular(`${spec.datasetId}: ${source.file}`, header,
    lines[1] === undefined ? undefined : splitLine(lines[1], source.delimiter));
  const { kept, skipped } = keptColumns(spec, header);
  const featureMap = readFeatureMap(resolve(DATASETS_DIR, source.featureMap), source.featureMap);
  const rowIds: string[] = [];
  const aggregated = new Map<string, number[]>();
  for (let r = 1; r < lines.length; r++) {
    const row = splitLine(lines[r], source.delimiter);
    const id = row[0];
    if (!id) continue;
    rowIds.push(id);
    const counts = kept.map((k) => {
      const v = Number(row[k.col]);
      if (!Number.isFinite(v) || v < 0) throw new Error(`${spec.datasetId}: invalid count ${id}/${k.id}`);
      return v;
    });
    const key = featureMap.get(id) ?? `\u0000unmapped:${id}`;
    const prev = aggregated.get(key);
    if (prev) for (let j = 0; j < counts.length; j++) prev[j] += counts[j];
    else aggregated.set(key, counts);
  }
  assertUniqueKeys(rowIds, `${spec.datasetId}: ${source.file} feature ids`);
  const matrix = [...aggregated.values()];
  const libSizes = kept.map((_, j) => matrix.reduce((s, row) => s + row[j], 0));
  const columns = kept.map((_, j) => matrix.map((row) => row[j]));
  const factors = calcNormFactorsTMM(columns, libSizes);
  const values = new Map<string, number[]>();
  for (const [key, counts] of aggregated) {
    if (key.startsWith('\u0000')) continue;
    values.set(key, counts.map((c, j) => (c / (libSizes[j] * factors[j])) * 1e6));
  }
  const range = `${Math.min(...factors).toFixed(4)}-${Math.max(...factors).toFixed(4)}`;
  return { kept, skipped, values, note: `TMM factors over ${kept.length} libraries: ${range}` };
}

function build(spec: SeriesSpec): BuildResult {
  const dataset = requireDataset(spec.datasetId);
  // The Circadian tab labels its axis from this bundle, not the registry, so the
  // two must agree.
  if (spec.expressionUnit !== dataset.expressionUnit) {
    throw new Error(`${spec.datasetId}: registry unit "${dataset.expressionUnit}" != series unit "${spec.expressionUnit}"`);
  }
  const { kept, skipped: skippedColumns, values: bySymbol, note } = spec.source.kind === 'table'
    ? tableValues(spec, spec.source)
    : rawCountValues(spec, spec.source);

  // Project onto the DE table's gene universe (symbol-keyed and unique).
  const universe = readSymbolDe(resolve(DATASETS_DIR, spec.deFile), spec.deFile).map((d) => d.gene);
  const missing = universe.filter((gene) => !bySymbol.has(gene));
  if (missing.length) {
    throw new Error(`${spec.datasetId}: ${missing.length} DE symbol(s) absent from the value source: ${missing.slice(0, 5).join(', ')}`);
  }
  const values: Record<string, number[]> = {};
  for (const gene of universe) values[gene] = bySymbol.get(gene)!.map((v) => +v.toFixed(4));

  // Replicate index within (arm, time) — 1-based, in the sorted order above.
  const repCounter = new Map<string, number>();
  const samples = kept.map((k) => {
    const key = `${k.arm}@${k.time}`;
    const replicate = (repCounter.get(key) ?? 0) + 1;
    repCounter.set(key, replicate);
    return { id: k.id, arm: k.arm, time: k.time, replicate };
  });

  const timepoints = [...new Set(samples.map((s) => s.time))].sort((a, b) => a - b);
  const bundle: TimeSeriesBundle = {
    meta: {
      trackId: spec.trackId,
      label: spec.trackLabel,
      cycleHours: spec.cycleHours,
      timeUnit: spec.timeUnit,
      expressionUnit: spec.expressionUnit,
      arms: spec.arms,
      samples,
      timepoints,
      nGenes: Object.keys(values).length,
    },
    values,
  };

  const { file, bytes } = writeTimeSeriesBundle(dataset, spec.trackId, bundle, {
    outRoot: OUT_ROOT,
    dry: DRY,
  });

  log(`\n[${spec.datasetId}]`);
  log(`  samples kept   : ${samples.length} (${skippedColumns} columns skipped)`);
  log(`  timepoints     : ${spec.timeUnit}${timepoints.join(`, ${spec.timeUnit}`)}`);
  for (const arm of spec.arms) {
    const n = samples.filter((s) => s.arm === arm.key).length;
    log(`  arm ${arm.label.padEnd(14)}: ${n} libraries`);
  }
  log(`  genes          : ${bundle.meta.nGenes} (the DE table's ${universe.length} symbols)`);
  if (note) log(`  normalization  : ${note}`);
  log(`  ${DRY ? 'would write' : 'wrote'}     : ${file.replace(ROOT, '.')} (${(bytes / 1e6).toFixed(2)} MB)`);
  for (const n of spec.notes ?? []) log(`  note           : ${n}`);

  return {
    file, bytes, nGenes: bundle.meta.nGenes,
    nSamples: samples.length, timepoints, skippedColumns,
  };
}

log(`Building time-series bundles${DRY ? ' (dry run)' : ''}…`);
let totalBytes = 0;
for (const spec of SERIES) totalBytes += build(spec).bytes;
log(`\nTotal: ${(totalBytes / 1e6).toFixed(2)} MB across ${SERIES.length} bundles.`);
log('These are lazy siblings — nothing downloads them until the Circadian tab is opened.');
