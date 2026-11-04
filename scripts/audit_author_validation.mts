/**
 * Corpus-wide, read-only evidence audit for author-processed dataset validation.
 *
 * This does not decide the scientific validation label. It establishes the two
 * mechanical facts those labels rely on:
 *   1. checksummed deposited/source artifacts still match the local files; and
 *   2. every public default-track/contrast DE row came from the committed
 *      analysis table without a value or direction change.
 *
 * Usage:
 *   npx tsx scripts/audit_author_validation.mts
 *   npx tsx scripts/audit_author_validation.mts --check
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { DATASETS } from '../src/data/datasets';
import type { Dataset, GeneDERecord, RawTrack } from '../src/types';
import { roundProb } from './lib/bundleSlim.mjs';
import {
  bindContrastDeTables,
  carriedForwardWarning,
  compareNullableNumber,
  isExactContrastMatch,
  missingLocalInputs,
} from './lib/authorValidationAudit.mjs';
import { normalizeGene } from './lib/geneSymbol.mjs';
import SEPTEMBER5_STUDIES from '../src/data/september5Studies.generated.json';
import SEPTEMBER5_ANALYSES from '../data/intake/september5-2026/analyses.json';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEO = resolve(ROOT, 'geo_replication');
const REPORT = resolve(ROOT, 'data', 'author-validation', 'mechanical-audit.generated.json');
const CHECK = process.argv.includes('--check');
const EXCLUDED_DATASET = 'macaque_snrna';
const hfdStudiesPath = resolve(ROOT, 'data/intake/hfd-2026-09-12/studies.json');
const hfdAnalysesPath = resolve(ROOT, 'data/intake/hfd-2026-09-12/analyses.json');
const HFD_STUDIES = existsSync(hfdStudiesPath) ? JSON.parse(readFileSync(hfdStudiesPath, 'utf8')) : [];
const HFD_ANALYSES = existsSync(hfdAnalysesPath) ? JSON.parse(readFileSync(hfdAnalysesPath, 'utf8')) : [];
const oxtAvpStudiesPath = resolve(ROOT, 'data/intake/oxt-avp-2026-10-19/studies.json');
const oxtAvpAnalysesPath = resolve(ROOT, 'data/intake/oxt-avp-2026-10-19/analyses.json');
const OXT_AVP_STUDIES = existsSync(oxtAvpStudiesPath) ? JSON.parse(readFileSync(oxtAvpStudiesPath, 'utf8')) : [];
const OXT_AVP_ANALYSES = existsSync(oxtAvpAnalysesPath) ? JSON.parse(readFileSync(oxtAvpAnalysesPath, 'utf8')) : [];

interface ConfigRow {
  id: string;
  dir: string;
  input_kind: string;
  input_path: string;
  samplesheet: string;
  batch_var: string;
  status: string;
  [key: string]: string;
}

interface SourceFileAudit {
  file: string;
  sourceUrl: string | null;
  expectedBytes: number | null;
  observedBytes: number | null;
  expectedSha256: string | null;
  observedSha256: string | null;
  normalizedTextSha256: string | null;
  result: 'match' | 'normalized_text_match' | 'mismatch' | 'missing' | 'unverifiable';
}

interface DeTable {
  path: string;
  rows: Map<string, { logFC: number; pvalue: number; padj: number | null }>;
  duplicateSymbols: number;
}

interface ContrastAudit {
  contrastId: string;
  bundleRows: number;
  table: string;
  sharedRows: number;
  bundleCoverage: number;
  maxAbsLogFcDelta: number | null;
  maxAbsPValueDelta: number | null;
  maxAbsFdrDelta: number | null;
  fdrNullnessMismatches: number;
  directionMismatches: number;
  duplicateSourceSymbols: number;
  result: 'pass' | 'fail';
}

interface DatasetAudit {
  datasetId: string;
  accession: string;
  directory: string | null;
  configId: string | null;
  inputKind: string | null;
  inputPath: string | null;
  sourceManifest: string | null;
  sourceFiles: SourceFileAudit[];
  sourceIntegrity: 'pass' | 'missing_local' | 'mismatch' | 'unmanifested';
  trackId: string;
  sampleCount: number | null;
  groupCounts: Record<string, number>;
  deTableMapping: 'sole_table' | 'explicit';
  contrasts: ContrastAudit[];
  bundleIntegrity: 'pass' | 'fail';
}

const EXPLICIT_CONTRAST_DE_TABLES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  mouse_pomc_maternal_hfd_gse135639: {
    hfd_vs_chow_p21: 'GSE135639_dietP21_DE.tsv',
    hfd_vs_chow_p0: 'GSE135639_dietP0_DE.tsv',
    p21_vs_p0_chow: 'GSE135639_ageChow_DE.tsv',
    p21_vs_p0_hfd: 'GSE135639_ageHFD_DE.tsv',
  },
};

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const normalizedTextSha256 = (path: string): string => createHash('sha256')
  .update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'))
  .digest('hex');

const readTsv = (path: string): Record<string, string>[] => {
  const lines = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split('\t');
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(head.map((key, i) => [key, cells[i] ?? '']));
  });
};

const configRows = readTsv(resolve(GEO, 'config', 'datasets.tsv')) as ConfigRow[];

const datasetDirs = ['datasets', 'archive'].flatMap((root) => {
  const absoluteRoot = resolve(GEO, root);
  return readdirSync(absoluteRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '_author_de')
    .map((entry) => resolve(absoluteRoot, entry.name));
});

function normalizedAccession(value: string): string {
  return value.replace(/-/g, '').toUpperCase();
}

function findDatasetDir(dataset: Dataset): string | null {
  const accession = dataset.geo ?? '';
  const normalized = normalizedAccession(accession);
  let matches = datasetDirs.filter((path) => {
    const upper = path.toUpperCase();
    return upper.includes(accession.toUpperCase()) || upper.includes(normalized);
  });
  if (accession === 'GSE68177') {
    const token = dataset.id.includes('pomc_') ? 'POMC' : 'AGRP';
    matches = matches.filter((path) => path.toUpperCase().includes(token));
  }
  return matches.length === 1 ? matches[0] : matches[0] ?? null;
}

function configIdFor(dataset: Dataset): string {
  const hfd = [...HFD_ANALYSES, ...OXT_AVP_ANALYSES].filter((row: any) => row.studyId === dataset.id && row.track === dataset.defaultTrack);
  if (hfd.length) return hfd.find((row: any) => row.contrast === (dataset.contrasts.find(co => co.isDefault) ?? dataset.contrasts[0]).id)!.analysisId;
  if (dataset.id === 'mouse_pomc_fedfast_gse68177') return 'GSE68177_POMC';
  if (dataset.id === 'mouse_hypo_aging_gse314817') return 'GSE314817_6v27mo';
  if (dataset.id === 'mouse_hypo_circadian_aging_gse201207') return 'GSE201207_young_vs_old';
  return dataset.geo ?? '';
}

function findFileRecursive(root: string, target: string): string | null {
  const queue = [root];
  while (queue.length) {
    const current = queue.shift()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) queue.push(path);
      else if (entry.name === target) return path;
    }
  }
  return null;
}

function resolveManifestFile(datasetDir: string, value: string): string | null {
  if (!value) return null;
  const normalized = value.replaceAll('\\', '/');
  const rooted = resolve(ROOT, normalized);
  if (existsSync(rooted)) return rooted;
  const local = resolve(datasetDir, normalized);
  if (existsSync(local)) return local;
  return findFileRecursive(datasetDir, basename(normalized));
}

function sourceManifestAudit(datasetDir: string): {
  manifest: string | null;
  files: SourceFileAudit[];
  status: DatasetAudit['sourceIntegrity'];
} {
  const metadata = resolve(datasetDir, 'metadata');
  if (!existsSync(metadata)) return { manifest: null, files: [], status: 'unmanifested' };
  const name = readdirSync(metadata).find((file) => file.endsWith('_source_files.tsv'));
  if (!name) return { manifest: null, files: [], status: 'unmanifested' };
  const manifest = resolve(metadata, name);
  const rows = readTsv(manifest);
  const files = rows.map((row): SourceFileAudit => {
    const fileValue = row.local_path || row.file || '';
    const path = resolveManifestFile(datasetDir, fileValue);
    const expectedBytes = Number.isFinite(Number(row.bytes)) && row.bytes !== ''
      ? Number(row.bytes)
      : null;
    const expectedSha256 = (row.sha256 || '').toLowerCase() || null;
    const sourceUrl = row.source_url || row.source || null;
    if (!path || !existsSync(path)) {
      return {
        file: fileValue,
        sourceUrl,
        expectedBytes,
        observedBytes: null,
        expectedSha256,
        observedSha256: null,
        normalizedTextSha256: null,
        result: 'missing',
      };
    }
    const observedBytes = statSync(path).size;
    const observedSha256 = sha256(path);
    const textLike = /\.(?:csv|tsv|txt|xml|json|ipynb|html|r)$/i.test(path);
    const normalizedSha256 = textLike ? normalizedTextSha256(path) : null;
    const expectedNormalizedSha256 = (row.normalized_sha256 || '').toLowerCase() || expectedSha256;
    const bytesMatch = expectedBytes == null || expectedBytes === observedBytes;
    const hashMatch = expectedSha256 == null || expectedSha256 === observedSha256;
    const verifiable = expectedBytes != null || expectedSha256 != null;
    const normalizedMatch = Boolean(
      expectedSha256 && normalizedSha256 && expectedNormalizedSha256 === normalizedSha256,
    );
    return {
      file: relative(ROOT, path).replaceAll('\\', '/'),
      sourceUrl,
      expectedBytes,
      observedBytes,
      expectedSha256,
      observedSha256,
      normalizedTextSha256: normalizedSha256,
      result: !verifiable
        ? 'unverifiable'
        : bytesMatch && hashMatch
          ? 'match'
          : normalizedMatch
            ? 'normalized_text_match'
            : 'mismatch',
    };
  });
  const status = files.some((file) => file.result === 'mismatch')
    ? 'mismatch'
    : files.some((file) => file.result === 'missing')
      ? 'missing_local'
      : 'pass';
  return {
    manifest: relative(ROOT, manifest).replaceAll('\\', '/'),
    files,
    status,
  };
}

function parseJsGlobal<T>(path: string, key: string): T {
  const context: Record<string, unknown> = {};
  vm.runInNewContext(readFileSync(path, 'utf8'), context, { filename: path });
  if (!(key in context)) throw new Error(`${relative(ROOT, path)} did not set ${key}`);
  return context[key] as T;
}

function globalKey(dataset: Dataset, trackId: string): string {
  return dataset.globalKeyTemplate.replace('{TRACKID}', trackId.toUpperCase());
}

function bundlePath(dataset: Dataset, trackId: string): string {
  const relativePath = dataset.bundleFileTemplate.replace('{trackId}', trackId).replace(/^\//, '');
  return resolve(ROOT, 'public', relativePath.replace(/^datasets\//, 'datasets/'));
}

function numberCell(value: string): number {
  const trimmed = value.trim();
  return trimmed === '' || trimmed === 'NA' || trimmed === 'NaN' ? Number.NaN : Number(trimmed);
}

function readDeTable(path: string): DeTable {
  const lines = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const header = lines[0].split('\t');
  const index = (name: string) => header.indexOf(name);
  const symbolIndex = index('symbol') >= 0 ? index('symbol') : index('gene');
  const logFcIndex = index('logFC');
  const pIndex = index('pvalue') >= 0 ? index('pvalue') : index('PValue');
  const fdrIndex = index('padj') >= 0 ? index('padj') : index('FDR');
  if ([symbolIndex, logFcIndex, pIndex, fdrIndex].some((i) => i < 0)) {
    throw new Error(`${relative(ROOT, path)} does not have the canonical DE columns`);
  }
  const candidates = new Map<string, Array<{ logFC: number; pvalue: number; padj: number | null }>>();
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    const symbol = normalizeGene(cells[symbolIndex]?.trim());
    if (!symbol) continue;
    const fdr = numberCell(cells[fdrIndex]);
    const row = {
      logFC: numberCell(cells[logFcIndex]),
      pvalue: numberCell(cells[pIndex]),
      padj: Number.isFinite(fdr) ? fdr : null,
    };
    const prior = candidates.get(symbol);
    if (prior) prior.push(row);
    else candidates.set(symbol, [row]);
  }
  // Every bulk bundle builder resolves duplicate public symbols the same way:
  // retain the row with the lowest p-value. Mirroring that rule here is
  // essential. Comparing a bundle against the first raw row instead produces
  // false discrepancies whenever multiple Ensembl ids map to one symbol.
  const rows = new Map<string, { logFC: number; pvalue: number; padj: number | null }>();
  let duplicateSymbols = 0;
  for (const [symbol, choices] of candidates) {
    if (choices.length > 1) duplicateSymbols += 1;
    rows.set(symbol, choices.reduce((best, row) => row.pvalue < best.pvalue ? row : best));
  }
  return { path, rows, duplicateSymbols };
}

function candidateDeTables(datasetDir: string): DeTable[] {
  const processed = resolve(datasetDir, 'processed');
  if (!existsSync(processed)) return [];
  return readdirSync(processed)
    .filter((name) => name.endsWith('_DE.tsv'))
    .map((name) => readDeTable(resolve(processed, name)));
}

function compareBundleRows(
  contrastId: string,
  bundleRows: GeneDERecord[],
  table: DeTable,
): ContrastAudit {
  let shared = 0;
  for (const row of bundleRows) {
    const source = table.rows.get(normalizeGene(row.gene) ?? row.gene);
    if (source && Number.isFinite(source.logFC)) shared += 1;
  }
  let maxAbsLogFcDelta = 0;
  let maxAbsPValueDelta = 0;
  let maxAbsFdrDelta = 0;
  let fdrNullnessMismatches = 0;
  let directionMismatches = 0;
  for (const row of bundleRows) {
    const source = table.rows.get(normalizeGene(row.gene) ?? row.gene);
    if (!source) continue;
    const expectedLogFc = +source.logFC.toFixed(4);
    const expectedPValue = roundProb(source.pvalue) as number;
    const expectedFdr = roundProb(source.padj) as number | null;
    maxAbsLogFcDelta = Math.max(maxAbsLogFcDelta, Math.abs(row.logFC - expectedLogFc));
    maxAbsPValueDelta = Math.max(maxAbsPValueDelta, Math.abs(row.PValue - expectedPValue));
    const fdrComparison = compareNullableNumber(row.FDR, expectedFdr);
    if (fdrComparison.delta != null) {
      maxAbsFdrDelta = Math.max(maxAbsFdrDelta, fdrComparison.delta);
    }
    if (fdrComparison.nullnessMismatch) fdrNullnessMismatches += 1;
    if (Math.sign(row.logFC) !== Math.sign(expectedLogFc)) directionMismatches += 1;
  }
  const bundleCoverage = bundleRows.length ? shared / bundleRows.length : 1;
  const result = isExactContrastMatch({
    bundleCoverage,
    directionMismatches,
    maxAbsLogFcDelta,
    maxAbsPValueDelta,
    maxAbsFdrDelta,
    fdrNullnessMismatches,
  }) ? 'pass' : 'fail';
  return {
    contrastId,
    bundleRows: bundleRows.length,
    table: relative(ROOT, table.path).replaceAll('\\', '/'),
    sharedRows: shared,
    bundleCoverage,
    maxAbsLogFcDelta,
    maxAbsPValueDelta,
    maxAbsFdrDelta,
    fdrNullnessMismatches,
    directionMismatches,
    duplicateSourceSymbols: table.duplicateSymbols,
    result,
  };
}

/** The committed audit record for a dataset whose local inputs are incomplete on this machine. */
function committedAudit(datasetId: string): DatasetAudit {
  if (!existsSync(REPORT)) {
    throw new Error(`${datasetId}: local inputs are incomplete and ${relative(ROOT, REPORT)} has no committed record to carry forward`);
  }
  const committed = JSON.parse(readFileSync(REPORT, 'utf8')) as { datasets: DatasetAudit[] };
  const record = committed.datasets.find((entry) => entry.datasetId === datasetId);
  if (!record) throw new Error(`${datasetId}: no committed audit record to carry forward`);
  return record;
}

function auditDataset(dataset: Dataset): DatasetAudit {
  const missing = missingLocalInputs(ROOT, dataset.id);
  if (missing.length) {
    process.stderr.write(carriedForwardWarning(dataset.id, 'audit_author_validation.mts', missing, relative(ROOT, REPORT).replaceAll('\\', '/')));
    return committedAudit(dataset.id);
  }
  const datasetDir = findDatasetDir(dataset);
  if (!datasetDir) throw new Error(`${dataset.id}: no geo_replication directory`);
  const configId = configIdFor(dataset);
  const config = configRows.find((row) => row.id === configId) ?? null;
  const source = sourceManifestAudit(datasetDir);
  const trackId = dataset.defaultTrack;
  const path = bundlePath(dataset, trackId);
  const raw = parseJsGlobal<RawTrack>(path, globalKey(dataset, trackId));
  let candidates = candidateDeTables(datasetDir);
  const defaultContrast = dataset.contrasts.find((contrast) => contrast.isDefault)
    ?? dataset.contrasts[0];
  let explicitMapping = EXPLICIT_CONTRAST_DE_TABLES[dataset.id];
  if ([...SEPTEMBER5_STUDIES, ...HFD_STUDIES, ...OXT_AVP_STUDIES].some((study) => study.id === dataset.id)) {
    const intake = [...SEPTEMBER5_ANALYSES, ...HFD_ANALYSES, ...OXT_AVP_ANALYSES].filter((analysis) => analysis.studyId === dataset.id);
    const claimed = new Set(intake.map((analysis) => `${analysis.analysisId}_DE.tsv`));
    const unclaimed = candidates.filter((table) => !claimed.has(basename(table.path)));
    if (unclaimed.length) throw new Error(`${dataset.id}: unclaimed intake DE tables: ${unclaimed.map((table) => table.path).join(', ')}`);
    const selected = intake.filter((analysis) => analysis.track === dataset.defaultTrack);
    explicitMapping = Object.fromEntries(selected.map((analysis) => [analysis.contrast, `${analysis.analysisId}_DE.tsv`]));
    const defaults = new Set(Object.values(explicitMapping));
    candidates = candidates.filter((table) => defaults.has(basename(table.path)));
  }
  const tableByContrast = bindContrastDeTables(
    dataset.id,
    dataset.contrasts.map((contrast) => contrast.id),
    candidates,
    explicitMapping,
  );
  const nondefaultContrastIds = new Set(
    dataset.contrasts.filter((contrast) => contrast.id !== defaultContrast.id).map((contrast) => contrast.id),
  );
  const extraBundleContrasts = Object.keys(raw.deByContrast ?? {})
    .filter((id) => !nondefaultContrastIds.has(id));
  if (extraBundleContrasts.length) {
    throw new Error(`${dataset.id}: bundle has unregistered contrasts: ${extraBundleContrasts.join(', ')}`);
  }
  const contrasts = dataset.contrasts.map((contrast) => {
    const rows = contrast.id === defaultContrast.id
      ? raw.de ?? []
      : raw.deByContrast?.[contrast.id];
    if (!rows) throw new Error(`${dataset.id}: bundle is missing contrast ${contrast.id}`);
    return compareBundleRows(contrast.id, rows, tableByContrast.get(contrast.id)!);
  });
  const sampleOrder = raw.meta?.sampleOrder ?? raw.meta?.sampleNames ?? null;
  const groupCounts = Object.fromEntries(
    Object.entries(raw.meta?.groupSamples ?? {}).map(([key, samples]) => [key, samples.length]),
  );
  return {
    datasetId: dataset.id,
    accession: dataset.geo ?? '',
    directory: relative(ROOT, datasetDir).replaceAll('\\', '/'),
    configId: config?.id ?? null,
    inputKind: config?.input_kind ?? null,
    inputPath: config?.input_path ?? null,
    sourceManifest: source.manifest,
    sourceFiles: source.files,
    sourceIntegrity: source.status,
    trackId,
    sampleCount: sampleOrder?.length ?? null,
    groupCounts,
    deTableMapping: explicitMapping ? 'explicit' : 'sole_table',
    contrasts,
    bundleIntegrity: contrasts.every((contrast) => contrast.result === 'pass') ? 'pass' : 'fail',
  };
}

const datasets = DATASETS.filter((dataset) => dataset.id !== EXCLUDED_DATASET).map(auditDataset);
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  excludedDataset: EXCLUDED_DATASET,
  datasetCount: datasets.length,
  contrastCount: datasets.reduce((sum, dataset) => sum + dataset.contrasts.length, 0),
  summary: {
    sourceManifestPass: datasets.filter((dataset) => dataset.sourceIntegrity === 'pass').length,
    sourceManifestMismatch: datasets.filter((dataset) => dataset.sourceIntegrity === 'mismatch').length,
    sourceManifestMissingLocal: datasets.filter((dataset) => dataset.sourceIntegrity === 'missing_local').length,
    sourceManifestMissing: datasets.filter((dataset) => dataset.sourceIntegrity === 'unmanifested').length,
    bundlePass: datasets.filter((dataset) => dataset.bundleIntegrity === 'pass').length,
    bundleFail: datasets.filter((dataset) => dataset.bundleIntegrity === 'fail').length,
  },
  datasets,
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (CHECK) {
  if (!existsSync(REPORT)) throw new Error(`${relative(ROOT, REPORT)} is missing; run without --check`);
  const current = JSON.parse(readFileSync(REPORT, 'utf8')) as typeof report;
  const comparable = { ...report, generatedAt: current.generatedAt };
  if (`${JSON.stringify(comparable, null, 2)}\n` !== readFileSync(REPORT, 'utf8')) {
    throw new Error(`${relative(ROOT, REPORT)} is stale; regenerate it`);
  }
  process.stdout.write(`author-validation audit is current: ${datasets.length} datasets, ${report.contrastCount} contrasts\n`);
} else {
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, serialized);
  process.stdout.write(
    `wrote ${relative(ROOT, REPORT)}: ${datasets.length} datasets, ${report.contrastCount} contrasts, `
      + `${report.summary.bundlePass} bundle-pass, ${report.summary.sourceManifestPass} source-manifest-pass\n`,
  );
}

if (report.summary.sourceManifestMismatch || report.summary.bundleFail) process.exitCode = 1;
