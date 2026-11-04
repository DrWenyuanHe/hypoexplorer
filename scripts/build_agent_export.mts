// Agent export: the whole HypoExplorer corpus as plain CSV/JSON in one ZIP, laid
// out so a person can unpack it and point a local AI agent at the folder.
//
//   pnpm run build:agent-export                     # every registered dataset
//   pnpm run build:agent-export --datasets a,b      # a subset (tests, previews)
//   pnpm run build:agent-export --out <dir> --unpacked --kegg full|stats|omit
//
// Source of truth is the published browser bundles under public/datasets/, read
// through the same strict contrast rules the query index uses (rawTrack.ts), so
// every number in the archive is the number the site shows. Bundles round
// effect sizes and probabilities (README "Precision"); the analysis tables under
// data/raw/results/ and geo_replication/ keep full precision.
//
// Read-only with respect to the site: nothing under public/ or the bundle
// pipeline is written. Output goes to dist-export/ (git-ignored) by default.
//
// Reproducibility: entries are written in sorted order with fixed timestamps,
// and manifest.json records SHA-256 of every file's uncompressed bytes. The same
// commit and options produce the same manifest; with the same zlib build they
// also produce the same ZIP bytes.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listDatasets } from '../src/data/datasets';
import { contrastArmCounts, getActiveContrast, listContrasts } from '../src/data/contrasts';
import { groupSamplesOf, strictDeTableFor, strictSiblingPathwaysFor } from '../src/data/rawTrack';
import { datasetQuality } from '../src/data/datasetQualityR460';
import { requireAuthorValidation } from '../src/data/authorValidation';
import { sourceAccession, upstreamProcessingFor } from '../src/data/upstreamProcessing';
import { DEFAULT_FDR_CUTOFF, isFdrSignificant } from '../src/statistics/policy';
import { SITE_URL, studyPageHref } from '../src/data/siteInfo';
import type { Dataset, DatasetMeta, PathwaySibling, RawTrack, TimeSeriesBundle } from '../src/types';
import sourceMetadata from '../data/seo/studySources.json';
import { ZipWriter } from './lib/zipWriter.mjs';
import {
  CONTRAST_COLUMNS, DATASET_COLUMNS, DE_COLUMNS, FGSEA_COLUMNS, SAMPLE_COLUMNS, TRACK_COLUMNS, TRACK_CONTRAST_COLUMNS,
  agentsDoc, claudeDoc, licenseDoc, readmeDoc, type ExportSummary, type KeggMode,
} from './lib/agentExport.mjs';

const ROOT = path.resolve('.');
const DATASETS_DIR = path.join(ROOT, 'public/datasets');
const NOMENCLATURE = path.join(ROOT, 'data/nomenclature/nomenclature.tsv');

// ── CLI ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function option(name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}
const keggMode = (option('--kegg') ?? 'full') as KeggMode;
if (!['full', 'stats', 'omit'].includes(keggMode)) throw new Error(`--kegg must be full, stats or omit, not ${keggMode}`);
const subset = option('--datasets')?.split(',').map((id) => id.trim()).filter(Boolean);
const outDir = path.resolve(option('--out') ?? 'dist-export');
const writeUnpacked = argv.includes('--unpacked');
const writeZip = !argv.includes('--no-zip');

// ── Helpers ──────────────────────────────────────────────────────────────────

// Parse a `var NAME = {...};` bundle without evaluating it (as build_query_index does).
function readBundle<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  const src = readFileSync(file, 'utf8');
  const varAt = src.indexOf('var ');
  if (varAt < 0) return null;
  const objAt = src.indexOf('{', varAt);
  const arrAt = src.indexOf('[', varAt);
  const start = objAt < 0 ? arrAt : arrAt < 0 ? objAt : Math.min(objAt, arrAt);
  if (start < 0) return null;
  return JSON.parse(src.slice(start).replace(/;\s*$/, '')) as T;
}

type Cell = string | number | boolean | null | undefined;

function csvField(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number ${value} in export`);
    return String(value);
  }
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV, LF line endings, header first. */
class Csv {
  private readonly lines: string[];
  rows = 0;
  constructor(readonly columns: readonly string[]) {
    this.lines = [columns.map(csvField).join(',')];
  }
  push(row: readonly Cell[]): void {
    if (row.length !== this.columns.length) throw new Error(`CSV row has ${row.length} fields, expected ${this.columns.length}`);
    this.lines.push(row.map(csvField).join(','));
    this.rows++;
  }
  toString(): string {
    return `${this.lines.join('\n')}\n`;
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
  } catch {
    return null;
  }
}

// Path segments come from registry ids and bundle track codes; refuse anything
// that could escape its folder or confuse an unzip tool.
function safeSegment(segment: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)) throw new Error(`Unsafe path segment ${JSON.stringify(segment)}`);
  return segment;
}

// ── Source metadata ──────────────────────────────────────────────────────────

interface SourcePublication {
  paperTitle?: string;
  paperDoi?: string;
  paperPmid?: string;
  paperAuthors?: string[];
  paperRelationship?: string;
  sourceUrl?: string;
}
const sources = sourceMetadata as Record<string, SourcePublication>;

/** Publication record for a dataset, matched on PMID exactly as seoGuides does. */
function publicationFor(dataset: Dataset): SourcePublication | undefined {
  const source = sources[dataset.id] ?? (dataset.geo ? sources[dataset.geo] : undefined);
  return source && source.paperPmid === dataset.pmid ? source : undefined;
}

function repositoryUrl(dataset: Dataset): string | undefined {
  const source = sources[dataset.id] ?? (dataset.geo ? sources[dataset.geo] : undefined);
  try {
    const url = new URL(source?.sourceUrl ?? '');
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function qualityOf(datasetId: string, contrastId?: string): [string, string, string] {
  const q = datasetQuality(requireAuthorValidation(datasetId), contrastId);
  return [q.pipelineQc.status, q.experimentalDesign.status, q.authorConcordance.status];
}

// ── Build ────────────────────────────────────────────────────────────────────

const registry = listDatasets();
const known = new Set(registry.map((d) => d.id));
for (const id of subset ?? []) if (!known.has(id)) throw new Error(`--datasets: ${id} is not a registered dataset`);
const selected = registry.filter((d) => !subset || subset.includes(d.id)).sort((a, b) => (a.id < b.id ? -1 : 1));

const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string;
const stem = `hypoexplorer-data-v${version}${subset ? '-subset' : ''}`;
mkdirSync(outDir, { recursive: true });
const unpackedRoot = path.join(outDir, stem);
const zipFile = path.join(outDir, `${stem}.zip`);
if (writeUnpacked && existsSync(unpackedRoot)) throw new Error(`Refusing to overwrite ${unpackedRoot}`);
const zip = writeZip ? new ZipWriter(zipFile) : null;

// Files are written as they are produced, in a fixed order (datasets by id,
// then the top-level tables and documents), so the corpus never sits in memory.
const written: Array<{ path: string; bytes: number; sha256: string }> = [];
const seen = new Set<string>();
function emit(file: string, content: string | Buffer): void {
  if (seen.has(file)) throw new Error(`Duplicate export file ${file}`);
  seen.add(file);
  const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  if (file !== 'manifest.json') written.push({ path: file, bytes: data.length, sha256: sha256(data) });
  zip?.add(`${stem}/${file}`, data);
  if (writeUnpacked) {
    const target = path.join(unpackedRoot, ...file.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data, { flag: 'wx' });
  }
}

const datasetsCsv = new Csv(DATASET_COLUMNS);
const contrastsCsv = new Csv(CONTRAST_COLUMNS);
const tracksCsv = new Csv(TRACK_COLUMNS);
const trackContrastsCsv = new Csv(TRACK_CONTRAST_COLUMNS);
const totals = { deRows: 0, fgseaRows: 0, keggRows: 0, expressionFiles: 0, timeSeriesFiles: 0, tracks: 0 };
const collections = new Set<string>();

for (const dataset of selected) {
  const id = safeSegment(dataset.id);
  const dir = path.join(DATASETS_DIR, id);
  const meta = readBundle<DatasetMeta>(path.join(dir, 'meta.js'));
  if (!meta?.populations?.length) throw new Error(`${id}: meta.js missing or declares no tracks`);
  const qcGlobal = readBundle<Record<string, unknown>>(path.join(dir, 'qc_global.js'));
  const contrasts = listContrasts(dataset);
  const defaultContrast = getActiveContrast(dataset);
  if (!defaultContrast) throw new Error(`${id}: no registered contrast`);

  const samplesCsv = new Csv(SAMPLE_COLUMNS);
  const deCsv = new Csv(DE_COLUMNS);
  const fgseaCsv = new Csv(FGSEA_COLUMNS);
  const trackMeta: Record<string, unknown>[] = [];
  const groupLabel = new Map(dataset.groups.map((g) => [g.key, g.label]));

  for (const trackCode of meta.populations) {
    const trackId = safeSegment(trackCode);
    const raw = readBundle<RawTrack>(path.join(dir, `track_${trackId}.js`));
    if (!raw) throw new Error(`${id}/${trackId}: track bundle missing or unparseable`);
    totals.tracks++;
    const sampleOrder = raw.meta?.sampleOrder ?? raw.meta?.sampleNames ?? [];
    const groupSamples = groupSamplesOf(raw) ?? {};
    const kept = new Set(raw.qc?.samplesKept ?? raw.meta?.samplesKept ?? sampleOrder);
    // Factorial designs declare a sample in a pooled arm and a design cell, so
    // a sample can carry several arms.
    const groupsOf = new Map<string, string[]>();
    for (const [key, ids] of Object.entries(groupSamples)) {
      for (const s of ids) groupsOf.set(s, [...(groupsOf.get(s) ?? []), key]);
    }
    sampleOrder.forEach((sample, index) => {
      const keys = groupsOf.get(sample) ?? [];
      samplesCsv.push([
        id, trackId, sample, index + 1, keys.join(';') || undefined,
        keys.map((k) => groupLabel.get(k) ?? k).join(';') || undefined, kept.has(sample),
      ]);
    });

    const unit = raw.meta?.expressionUnit ?? dataset.expressionUnit ?? 'CPM';
    const flags = meta.qcFlags?.[trackId];
    const lowPower = flags ? Math.min(flags.nNormal ?? 3, flags.nObese ?? 3) < 3 : false;
    tracksCsv.push([
      id, trackId, meta.labels?.[trackId] ?? trackId, meta.types?.[trackId], trackId === dataset.defaultTrack,
      meta.nGenes?.[trackId] ?? raw.de?.length, sampleOrder.length, unit, flags?.status, flags?.minCells, lowPower,
    ]);
    trackMeta.push({
      track_id: trackId, label: meta.labels?.[trackId] ?? trackId, type: meta.types?.[trackId],
      expression_unit: unit, qc_flags: flags ?? null, sample_order: sampleOrder, group_samples: groupSamples,
      samples_kept: raw.qc?.samplesKept ?? null,
    });

    // Expression matrix: one row per feature, one column per sample, in the
    // track's own unit. Only samples the bundle orders are columns.
    const cpm = raw.cpm ?? {};
    const genes = Object.keys(cpm);
    if (genes.length) {
      const matrix = new Csv(['gene', ...sampleOrder]);
      for (const gene of genes) {
        const values = cpm[gene];
        if (values.length !== sampleOrder.length) {
          throw new Error(`${id}/${trackId}: ${gene} has ${values.length} values for ${sampleOrder.length} samples`);
        }
        matrix.push([gene, ...values]);
      }
      emit(`datasets/${id}/expression/${trackId}.csv`, matrix.toString());
      totals.expressionFiles++;
    }

    const sibling = readBundle<PathwaySibling>(path.join(dir, `track_${trackId}.pathways.js`));
    for (const contrast of contrasts) {
      const de = strictDeTableFor(raw, contrast.id, defaultContrast.id);
      let up = 0;
      let down = 0;
      let sig = 0;
      for (const r of de) {
        deCsv.push([id, trackId, contrast.id, r.gene, r.logFC, r.se, r.PValue, r.FDR, r.logCPM]);
        if (isFdrSignificant(r.FDR)) {
          sig++;
          if (r.logFC > 0) up++;
          else if (r.logFC < 0) down++;
        }
      }
      const resolved = strictSiblingPathwaysFor(sibling, contrast.id, defaultContrast.id);
      let fgseaRows = 0;
      for (const [collection, records] of Object.entries(resolved.db ?? {})) {
        if (!Array.isArray(records)) continue;
        const kegg = collection === 'KEGG';
        if (kegg && keggMode === 'omit') continue;
        collections.add(collection);
        for (const p of records) {
          const edge = kegg && keggMode === 'stats' ? undefined : p.leadingEdge;
          if (edge?.some((g) => g.includes(';'))) throw new Error(`${id}/${trackId}: leading-edge gene contains ';'`);
          fgseaCsv.push([id, trackId, contrast.id, collection, p.pathway, p.NES, p.pval, p.padj, p.size, edge?.join(';')]);
          fgseaRows++;
          if (kegg) totals.keggRows++;
        }
      }
      const arms = contrastArmCounts(contrast, { groupSamples, qc: raw.qc }, meta, trackId);
      trackContrastsCsv.push([
        id, trackId, contrast.id, arms.nBaseline, arms.nCase, de.length, sig, up, down, fgseaRows,
        resolved.db ? resolved.source : 'none',
      ]);
    }
  }

  // Sampled time courses (circadian datasets) ship as their own matrices.
  if (dataset.timeSeries) {
    for (const trackCode of meta.populations) {
      const ts = readBundle<TimeSeriesBundle>(path.join(dir, `timeseries_${trackCode}.js`));
      if (!ts) continue;
      const tsSamples = ts.meta.samples as unknown as Record<string, Cell>[];
      const sampleKeys = [...new Set(tsSamples.flatMap((s) => Object.keys(s)))];
      const tsSampleCsv = new Csv(sampleKeys);
      for (const s of tsSamples) tsSampleCsv.push(sampleKeys.map((k) => s[k]));
      const ids = tsSamples.map((s) => String(s.id));
      const matrix = new Csv(['gene', ...ids]);
      for (const [gene, values] of Object.entries(ts.values)) matrix.push([gene, ...values]);
      emit(`datasets/${id}/timeseries/${safeSegment(trackCode)}_samples.csv`, tsSampleCsv.toString());
      emit(`datasets/${id}/timeseries/${safeSegment(trackCode)}.csv`, matrix.toString());
      totals.timeSeriesFiles++;
    }
  }

  emit(`datasets/${id}/samples.csv`, samplesCsv.toString());
  emit(`datasets/${id}/de.csv`, deCsv.toString());
  if (fgseaCsv.rows) emit(`datasets/${id}/fgsea.csv`, fgseaCsv.toString());
  totals.deRows += deCsv.rows;
  totals.fgseaRows += fgseaCsv.rows;

  const publication = publicationFor(dataset);
  const upstream = upstreamProcessingFor(dataset);
  const { bundleBaseUrl: _b, metaFile: _m, metaGlobalKey: _mg, qcFile: _q, qcGlobalKey: _qg,
    bundleFileTemplate: _bf, globalKeyTemplate: _gk, isDefault: _d, ...registryEntry } = dataset;
  emit(`datasets/${id}/meta.json`, json({
    registry: registryEntry,
    accession: sourceAccession(dataset) ?? null,
    publication: publication ?? null,
    upstream_processing: upstream ?? null,
    quality: datasetQuality(requireAuthorValidation(dataset.id)),
    tracks: trackMeta,
    qc_global: qcGlobal,
    explorer_url: `${SITE_URL}${studyPageHref(dataset.id)}`,
  }));

  datasetsCsv.push([
    id, dataset.name, dataset.category, dataset.organism, dataset.modality, dataset.region, dataset.perturbation,
    dataset.preparation, dataset.featureType, dataset.featureLabel, dataset.expressionUnit ?? 'CPM',
    dataset.supportsPathways, meta.populations.length, contrasts.length, dataset.defaultTrack, defaultContrast.id,
    sourceAccession(dataset), dataset.geo, dataset.doi, dataset.pmid, dataset.citation, publication?.paperTitle,
    publication?.paperAuthors?.[0], publication?.paperRelationship, repositoryUrl(dataset), upstream?.aligner,
    upstream?.genome, upstream?.annotation, ...qualityOf(dataset.id), `${SITE_URL}${studyPageHref(dataset.id)}`,
  ]);
  for (const c of contrasts) {
    const authored = dataset.contrasts.find((d) => d.id === c.id);
    contrastsCsv.push([
      id, c.id, c.id === defaultContrast.id, c.label, c.baseline.key, c.baseline.label, c.caseGroup.key,
      c.caseGroup.label, Boolean(c.exploratory), c.group, authored?.description, ...qualityOf(dataset.id, c.id),
    ]);
  }
  console.log(`  ${id}: ${meta.populations.length} track(s), ${deCsv.rows} DE rows, ${fgseaCsv.rows} FGSEA rows`);
}

emit('datasets.csv', datasetsCsv.toString());
emit('contrasts.csv', contrastsCsv.toString());
emit('tracks.csv', tracksCsv.toString());
emit('track_contrasts.csv', trackContrastsCsv.toString());
emit('reference/nomenclature.tsv', readFileSync(NOMENCLATURE));

const commit = git(['rev-parse', 'HEAD']);
const dirty = Boolean(git(['status', '--porcelain', '--', 'public/datasets', 'src/data', 'data/seo', 'data/nomenclature']));
const summary: ExportSummary = {
  version, commit, dirty, keggMode, datasets: selected.length, tracks: totals.tracks,
  contrasts: contrastsCsv.rows, trackContrasts: trackContrastsCsv.rows, deRows: totals.deRows,
  fgseaRows: totals.fgseaRows, keggRows: totals.keggRows, expressionFiles: totals.expressionFiles,
  timeSeriesFiles: totals.timeSeriesFiles, collections: [...collections].sort(),
  fdrCutoff: DEFAULT_FDR_CUTOFF, subset: Boolean(subset),
  organisms: [...new Set(selected.map((d) => d.organism))].sort(),
  perturbations: [...new Set(selected.map((d) => d.perturbation))].sort(),
};
emit('README.md', readmeDoc(summary));
emit('AGENTS.md', agentsDoc(summary));
emit('CLAUDE.md', claudeDoc());
emit('LICENSE-DATA.md', licenseDoc(summary));
emit('CITATION.cff', readFileSync(path.join(ROOT, 'CITATION.cff')));
emit('manifest.json', json({
  name: 'HypoExplorer agent export',
  version, source_commit: commit, source_dirty: dirty, kegg_leading_edges: keggMode,
  counts: {
    datasets: summary.datasets, tracks: summary.tracks, contrasts: summary.contrasts,
    track_contrasts: summary.trackContrasts, de_rows: summary.deRows, fgsea_rows: summary.fgseaRows,
  },
  files: written,
}));

if (writeUnpacked) console.log(`Unpacked: ${unpackedRoot}`);
if (zip) {
  zip.close();
  const digest = sha256(readFileSync(zipFile));
  writeFileSync(`${zipFile}.sha256`, `${digest}  ${path.basename(zipFile)}\n`, { flag: 'wx' });
  console.log(`Archive: ${zipFile}\nSHA-256: ${digest}`);
}
console.log(`${summary.datasets} datasets, ${summary.tracks} tracks, ${summary.deRows} DE rows, ${summary.fgseaRows} FGSEA rows`);
