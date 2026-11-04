// The export-provenance module — what a downloaded file is EVIDENCE OF.
//
// Beside the workbook seam (utils/workbook.ts, what an export writes) and the
// export-action seam (utils/exportAction.ts, what an export click does), this
// module answers the question a reader asks of a file months after it left the
// screen: which dataset, track and contrast, in which unit, from which release,
// under which retained processing and replication evidence, and with which
// on-screen settings. It owns four things every export kind needs:
//
//  1. Filename identity (`exportName`): dataset, track, contrast and the kind,
//     so two contrasts of one track can never download identically named
//     files. Only the gene exports used to do this. The pathway table named
//     itself `${track}_pathways_export.xlsx`, so the four contrasts of
//     GSE135639's `pomc` track saved over one another with no record of which
//     was which.
//  2. The provenance snapshot (`exportProvenance`): one object per file, which
//     both formats serialize.
//  3. The Metadata sheet rows (`provenanceRows` / `metadataSheet`) for XLSX.
//  4. The appended provenance columns (`provenanceColumns`) for CSV.
//
// A view supplies only its own kind and settings (thresholds, filters, the
// selected pathway, the compared columns) plus the subject it already holds:
//
//   trackSubject           one loaded track of a registered dataset (popData)
//   timeSeriesSubject      one registered time course (no contrast exists)
//   columnsSubject         side-by-side columns, each its own track: the
//                          Compare tab's populations or the compare set's studies
//   localExportProvenance  a user-imported result, which has NO registry entry
//
// The snapshot never upgrades an absence into a claim: missing evidence is
// recorded as missing ("Unrecorded" in the sheet, null in the JSON), and a
// local dataset says it has no release or evidence rather than borrowing the
// public build's.
import { RELEASE_IDENTITY } from '../data/releaseIdentity';
import { getInternalQc } from '../data/internalQc';
import { resolveTimeSeriesUrl, resolveTrackUrl } from '../data/bundleLocators';
import { DB_DEFAULT_FILTER } from '../data/constants';
import { sourceAccession } from '../data/upstreamProcessing';
import { METRIC_DEFAULT_SIG_THRESH, PATHWAY_FDR_DEFAULT, PATHWAY_SORT_DEFAULT } from '../explorer/explorerSession';
import { datasetExternalLinks } from './datasetLinks';
import { routeHref } from './appLinks';
import { unitProvenance } from './sampleValues';
import { exportFilename } from './exportAction';
import type { Dataset, Group, PopData, ResolvedContrast, TimeSeriesBundle } from '../types';
import type { WorkbookRow, WorkbookSheet } from './workbook';
import type { ChartScale } from './chartScale';

/**
 * Every kind of file the app writes with provenance. The id is recorded in the
 * metadata as `exportKind`, so a renamed file still says what it is.
 */
export type ExportKind =
  // Gene Explorer
  | 'genes_summary' | 'genes_export' | 'contrast_matrix' | 'gene_pathway_detail' | 'gene_leading_pathways'
  // Pathway Explorer
  | 'pathways_export' | 'pathway_detail' | 'leadingedge'
  // Compare tab and compare set
  | 'compare' | 'compare_set' | 'pathway_compare' | 'compare_leadingedge'
  // Circadian tab
  | 'rhythmicity' | 'timecourse_values' | 'circadian';

/**
 * The view state an export records. The named fields are the ones this module
 * also reads, to rebuild the source link; anything else a view records (a
 * selected pathway, row counts, rhythm-test settings) rides along as-is.
 */
export interface ExportSettings {
  volcano?: { metric: 'pval' | 'fdr'; logFCThresh: number; sigThresh: number };
  chartMode?: string;
  chartScale?: ChartScale;
  sort?: { key: string; direction: string };
  /** The Pathway Explorer's filter state, recorded and replayed by the link. */
  pathwayFilters?: { search: string; dbFilter: Record<string, boolean>; fdrThresh: number; sortKey: string };
  [setting: string]: unknown;
}

/** One track of one registered dataset, as an export sees it. */
export interface TrackSubject {
  shape: 'track';
  dataset: Dataset | undefined;
  trackId: string | null;
  trackLabel: string | null;
  /**
   * The contrasts the file's statistics come from. `null` means the kind has
   * no contrast at all (a time course), which is different from `[]`: a
   * contrast that should exist but did not resolve.
   */
  contrasts: readonly ResolvedContrast[] | null;
  /** The contrast the source link reopens: the active one, not every slice. */
  linkContrastId: string | null;
  expressionUnit: string;
  normalization: string;
  groups: Array<{ key: string; label: string; samples: string[] }>;
  bundleUrl: string | null;
}

/** Side-by-side columns; each is its own track with its own identity. */
export interface ColumnsSubject {
  shape: 'columns';
  columns: Array<{ key: string; label: string; track: TrackSubject }>;
}

export type ExportSubject = TrackSubject | ColumnsSubject;

/**
 * A loaded track. Contrasts default to the active one and groups to its two
 * arms; a view that draws every design cell or every contrast slice passes
 * those instead, so the record covers exactly what the file covers.
 */
export function trackSubject(
  popData: PopData,
  options: { contrasts?: readonly ResolvedContrast[]; groups?: readonly Group[] } = {},
): TrackSubject {
  const dataset = popData.dataset;
  const trackId = popData.meta?.code ?? null;
  const groups = options.groups ?? popData.groups;
  return {
    shape: 'track',
    dataset,
    trackId,
    trackLabel: popData.meta?.label ?? null,
    contrasts: options.contrasts ?? (popData.contrast ? [popData.contrast] : []),
    linkContrastId: popData.contrast?.id ?? null,
    expressionUnit: popData.expressionUnit,
    normalization: unitProvenance(popData),
    groups: groups.map((group) => ({ key: group.key, label: group.label, samples: popData.groupSamples[group.key] ?? [] })),
    bundleUrl: dataset && trackId ? resolveTrackUrl(dataset, trackId) : null,
  };
}

/** A registered time course. Its bundle is the time-series sibling, not the DE track. */
export function timeSeriesSubject(dataset: Dataset, bundle: TimeSeriesBundle): TrackSubject {
  const { meta } = bundle;
  return {
    shape: 'track',
    dataset,
    trackId: meta.trackId,
    trackLabel: meta.label,
    contrasts: null,
    linkContrastId: null,
    expressionUnit: meta.expressionUnit,
    normalization: unitProvenance(meta),
    groups: meta.arms.map((arm) => ({
      key: arm.key, label: arm.label,
      samples: meta.samples.filter((sample) => sample.arm === arm.key).map((sample) => sample.id),
    })),
    bundleUrl: resolveTimeSeriesUrl(dataset, meta.trackId),
  };
}

/**
 * Compare columns. A column without popData still appears, with every
 * identity field unrecorded, because silently dropping it would misstate which
 * columns the file was exported from.
 */
export function columnsSubject(
  columns: ReadonlyArray<{ key: string; label: string }>,
  popDataMap: Record<string, PopData | null | undefined>,
): ColumnsSubject {
  return {
    shape: 'columns',
    columns: columns.map((column) => {
      const popData = popDataMap[column.key];
      return {
        key: column.key,
        label: column.label,
        track: popData ? trackSubject(popData) : {
          shape: 'track', dataset: undefined, trackId: null, trackLabel: null, contrasts: [], linkContrastId: null,
          expressionUnit: 'Unrecorded', normalization: 'Unrecorded: no data was loaded for this column.',
          groups: [], bundleUrl: null,
        },
      };
    }),
  };
}

// A compare export can span many populations or studies. Up to this many
// distinct ids are spelled out in the filename; beyond it the name carries a
// count and the Metadata sheet carries the full list, so a 20-population
// selection cannot push the name past what a filesystem accepts.
const MAX_NAMED_IDS = 3;

function namedIds(ids: Array<string | null | undefined>, unknown: string, plural: string): string {
  const distinct = [...new Set(ids.map((id) => id ?? unknown))];
  if (!distinct.length) return unknown;
  return distinct.length <= MAX_NAMED_IDS ? distinct.join('+') : `${distinct.length}-${plural}`;
}

function contrastIds(track: TrackSubject): string[] {
  return track.contrasts?.length ? track.contrasts.map((contrast) => contrast.id) : ['unresolved-contrast'];
}

/**
 * The filename for one export: the subject's identity (dataset, track,
 * contrast), then the view's own parts — its kind label, and qualifiers such
 * as a pathway name. Sanitized by the export-action seam's `exportFilename`.
 *
 * Every resolved contrast is named, even on a single-contrast dataset. One
 * rule for every kind is what keeps the gene filenames unchanged, and an
 * explicit contrast costs a few characters where a missing one costs a
 * misattributed file. A kind with no contrast (a time course) omits the part.
 */
export function exportName(subject: ExportSubject, parts: Array<string | undefined>, extension: string): string {
  if (subject.shape === 'track') {
    return exportFilename([
      subject.dataset?.id ?? 'unknown-dataset', subject.trackId ?? 'unknown-track',
      ...(subject.contrasts === null ? [] : [contrastIds(subject).join('+')]),
      ...parts,
    ], extension);
  }
  const tracks = subject.columns.map((column) => column.track);
  return exportFilename([
    namedIds(tracks.map((track) => track.dataset?.id), 'unknown-dataset', 'datasets'),
    namedIds(tracks.map((track) => track.trackId), 'unknown-track', 'tracks'),
    namedIds(tracks.flatMap(contrastIds), 'unresolved-contrast', 'contrasts'),
    ...parts,
  ], extension);
}

type LinkTab = 'gene' | 'pathway' | 'circadian';

// Which explorer tab a kind's source link opens.
const LINK_TAB: Record<ExportKind, LinkTab> = {
  genes_summary: 'gene', genes_export: 'gene', contrast_matrix: 'gene', gene_pathway_detail: 'gene', gene_leading_pathways: 'gene',
  compare: 'gene', compare_set: 'gene',
  pathways_export: 'pathway', pathway_detail: 'pathway', leadingedge: 'pathway', pathway_compare: 'pathway', compare_leadingedge: 'pathway',
  rhythmicity: 'circadian', timecourse_values: 'circadian', circadian: 'circadian',
};

// What that link restores, and what it leaves to the file.
const LINK_SCOPE: Record<LinkTab | 'columns', string> = {
  gene: 'Opens this dataset, track and active contrast; selected genes are recorded in the export rows.',
  pathway: 'Opens this dataset, track and active contrast in the Pathway Explorer with the pathway filters recorded in settings; a selected pathway is recorded in settings, not in the link.',
  circadian: 'Opens this dataset and track in the Circadian tab; the rhythm-test settings are recorded in settings, not in the link.',
  columns: "Each column's sourceUrl opens that column's dataset, track and contrast; the comparison itself is recorded in settings and the export rows.",
};

function sourceUrl(track: TrackSubject, tab: LinkTab, settings: ExportSettings): string | null {
  const dataset = track.dataset;
  if (!dataset || !track.trackId) return null;
  if (tab === 'circadian') return `https://hypoexplorer.com/${routeHref({ view: 'explorer', datasetId: dataset.id, trackId: track.trackId, tab })}`;
  return `https://hypoexplorer.com/${routeHref({
    view: 'explorer', datasetId: dataset.id, trackId: track.trackId, tab,
    analysis: {
      version: 1, contrastId: track.linkContrastId, genes: [],
      ...(settings.chartScale ? { chartScale: settings.chartScale } : {}),
      volcano: settings.volcano ?? { metric: 'pval', logFCThresh: 0, sigThresh: METRIC_DEFAULT_SIG_THRESH.pval },
      pathway: settings.pathwayFilters
        ?? { search: '', dbFilter: { ...DB_DEFAULT_FILTER }, fdrThresh: PATHWAY_FDR_DEFAULT, sortKey: PATHWAY_SORT_DEFAULT },
    },
  })}`;
}

// Retained replicate-unit statements, keyed by registry id. The macaque atlas
// is the one dataset whose library unit is a pseudobulk this project built:
// its tracks are animal-level pseudobulks of nuclei (the Lei et al. 2024
// re-analysis), so a reader counting nuclei or rows as animals would be wrong
// in a specific, recorded way. Every other dataset gets the generic statement,
// which defers to the replication evidence and citation instead of guessing
// from assay or species: several mouse single-cell studies are litter or pool
// pseudobulks, and a modality rule would mislabel them. This belongs on the
// registry `Dataset` as a `replicateUnit` field; it lives here, named once,
// until a registry change can regenerate the dataset maps alongside it.
const RECORDED_REPLICATE_UNITS: Readonly<Record<string, string>> = {
  macaque_snrna: 'One animal-level pseudobulk per cell population; individual nuclei are not biological replicates.',
};

const GENERIC_REPLICATE_UNIT = 'Exported sample identifiers are the measured library/profile units. Their biological independence and any pooling are recorded in the replication evidence and study citation; do not count pooled animals as separate replicates.';

const REPLICATION_CHECKS = new Set(['independent_replication', 'retained_sample_support']);

function datasetBlock(dataset: Dataset | undefined) {
  return {
    // The non-GEO accession (the macaque atlas's CNGB project) resolves through
    // the registry-side table in upstreamProcessing, not a literal here.
    id: dataset?.id ?? null, name: dataset?.name ?? null, accession: dataset ? sourceAccession(dataset) ?? null : null,
    organism: dataset?.organism ?? null, modality: dataset?.modality ?? null, citation: dataset?.citation ?? null,
    sources: dataset ? datasetExternalLinks(dataset).map(({ label, href }) => ({ label, url: href })) : [],
  };
}

/** The replication/model notes are retained evidence, not guesses from species or assay. */
function evidenceBlock(track: TrackSubject) {
  const dataset = track.dataset;
  return dataset && track.contrasts ? track.contrasts.map((contrast) => {
    const assessment = getInternalQc(dataset.id, contrast.id);
    return {
      contrastId: contrast.id,
      policyVersion: assessment?.policyVersion ?? null,
      replication: assessment?.checks.filter((check) => REPLICATION_CHECKS.has(check.id))
        .map(({ id, status, note }) => ({ id, status, note })) ?? [],
      processing: assessment?.checks.filter((check) => !REPLICATION_CHECKS.has(check.id))
        .map(({ id, status, note }) => ({ id, status, note })) ?? [],
    };
  }) : [];
}

interface ContrastRecord { id: string; direction: string }

function contrastsBlock(track: TrackSubject) {
  if (track.contrasts === null) return 'Not applicable: this export has no baseline/case contrast.';
  return track.contrasts.map((contrast) => ({
    id: contrast.id, label: contrast.label,
    baseline: { key: contrast.baseline.key, label: contrast.baseline.label },
    case: { key: contrast.caseGroup.key, label: contrast.caseGroup.label },
    direction: `${contrast.caseGroup.label} minus ${contrast.baseline.label}; positive logFC means higher in ${contrast.caseGroup.label}`,
    description: contrast.description ?? null, exploratory: contrast.exploratory ?? false,
  }));
}

function expressionBlock(track: TrackSubject) {
  return { unit: track.expressionUnit, normalization: track.normalization,
    exportScale: 'Stored values; chart display transforms are not applied to exported values or means.' };
}

function replicateUnit(track: TrackSubject): string {
  return (track.dataset && RECORDED_REPLICATE_UNITS[track.dataset.id]) || GENERIC_REPLICATE_UNIT;
}

const EVIDENCE_NOTE = 'Missing evidence is unrecorded, not a passing assessment. Study-specific processing and replication notes retain their recorded status.';
const CSV_METADATA_PLACEMENT = 'ExportMetadataJSON is file-level provenance stored once in the first data row. Blank cells in later rows refer to that same metadata; identifiers and units remain on every row.';
const METHODS_URL = 'https://hypoexplorer.com/methods';
const REUSE = {
  applicationCodeLicense: 'MIT',
  originalDerivedContributionsLicense: 'CC BY 4.0',
  attribution: 'Wenyuan He / HypoExplorer; cite source publications and accessions separately.',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  termsUrl: 'https://hypoexplorer.com/REUSE.md',
  thirdPartyTerms: 'Source data, gene-set membership, annotations and other third-party content retain their original terms. This grant covers only rights held by the HypoExplorer author.',
};

/**
 * One snapshot for both formats. A track subject keeps the historical gene
 * layout (dataset, track, contrasts, … at the top level); a columns subject
 * carries the same per-track block once per column. Selected genes live in the
 * exported rows, avoiding quadratic metadata growth when a large selection is
 * exported to CSV.
 */
export function exportProvenance(kind: ExportKind, subject: ExportSubject, settings: ExportSettings = {}) {
  const head = {
    schemaVersion: 1 as const,
    exportKind: kind,
    exportedAt: new Date().toISOString(),
    release: RELEASE_IDENTITY,
  };
  const tab = LINK_TAB[kind];
  if (subject.shape === 'columns') {
    return {
      ...head,
      columns: subject.columns.map(({ key, label, track }) => ({
        key, label,
        dataset: datasetBlock(track.dataset),
        track: { id: track.trackId, label: track.trackLabel },
        contrasts: contrastsBlock(track),
        expression: expressionBlock(track),
        biologicalReplicateUnit: replicateUnit(track),
        evidence: evidenceBlock(track),
        groups: track.groups,
        sourceUrl: sourceUrl(track, tab, settings),
        trackBundleUrl: track.bundleUrl,
      })),
      evidenceNote: EVIDENCE_NOTE,
      settings,
      sourceUrlScope: LINK_SCOPE.columns,
      csvMetadataPlacement: CSV_METADATA_PLACEMENT,
      methodsUrl: METHODS_URL,
      reuse: REUSE,
    };
  }
  // Key order is the Metadata sheet's row order and the CSV JSON's byte order;
  // it is the gene snapshot's order, which this generalizes.
  return {
    ...head,
    dataset: datasetBlock(subject.dataset),
    track: { id: subject.trackId, label: subject.trackLabel },
    contrasts: contrastsBlock(subject),
    expression: expressionBlock(subject),
    biologicalReplicateUnit: replicateUnit(subject),
    evidence: evidenceBlock(subject),
    evidenceNote: EVIDENCE_NOTE,
    groups: subject.groups,
    settings,
    sourceUrl: sourceUrl(subject, tab, settings),
    sourceUrlScope: LINK_SCOPE[tab],
    csvMetadataPlacement: CSV_METADATA_PLACEMENT,
    trackBundleUrl: subject.bundleUrl,
    methodsUrl: METHODS_URL,
    reuse: REUSE,
  };
}

export type ExportProvenance = ReturnType<typeof exportProvenance>;

/** The structural shape of a user-imported dataset; no registry type is involved. */
export interface LocalExportSource {
  /** The workspace id; `public:<dataset>:<track>:<contrast>` marks a copy of public results. */
  id?: string;
  name: string;
  organism: string;
  createdAt: string;
  updatedAt: string;
  genes: readonly unknown[];
  pathways: readonly unknown[];
  sources: ReadonlyArray<{ fileName: string; sheetName: string; kind: string; rowCount: number; importedAt: string }>;
}

/**
 * A local dataset is named by the user's own label and marked `local`, never
 * given a registry id it does not have.
 */
export function localExportName(dataset: Pick<LocalExportSource, 'name'>, parts: string[], extension: string): string {
  return exportFilename(['local', dataset.name, ...parts], extension);
}

/**
 * How the public reference picker names the source of a copied public result.
 * Provenance reads it back to tell copied rows from the user's own imports.
 */
export const PUBLIC_COPY_SOURCE_PREFIX = 'Public: ';

/**
 * The public study a local copy was taken from, read off the id the public
 * reference picker gives it (`public:<dataset>:<track>:<contrast>`); null for a
 * user import.
 */
function publicCopyOrigin(id: string | undefined): { datasetId: string; trackId: string; contrastId: string } | null {
  const parts = id?.split(':');
  return parts && parts.length === 4 && parts[0] === 'public'
    ? { datasetId: parts[1], trackId: parts[2], contrastId: parts[3] }
    : null;
}

/**
 * Provenance for a local, user-imported dataset. It records what the browser
 * actually holds (name, organism, source files, timestamps) and states plainly
 * that there is no release, evidence, source link, bundle or reuse grant: the
 * public build's identity and the HypoExplorer licence describe data this file
 * does not contain, so borrowing them would be a false claim.
 */
export function localExportProvenance(dataset: LocalExportSource) {
  // A copy of PUBLIC results is not a user import: its values are the public
  // study's, so "HypoExplorer did not compute these" would be false in the
  // other direction. The copy keeps the values but not the release identity or
  // evidence record of the build it came from, and says exactly that.
  const copiedFrom = publicCopyOrigin(dataset.id);
  if (copiedFrom) {
    const study = `${copiedFrom.datasetId} (track ${copiedFrom.trackId}, comparison ${copiedFrom.contrastId})`;
    // "Add to dataset" can append the user's own files to a saved public copy,
    // and the copy keeps its `public:` id. Its sources still tell the two
    // apart (the picker names its own with PUBLIC_COPY_SOURCE_PREFIX), so a mixed dataset says it
    // is mixed rather than handing the user's rows to the public study.
    const imported = dataset.sources.filter((source) => !source.fileName.startsWith(PUBLIC_COPY_SOURCE_PREFIX));
    if (imported.length > 0) {
      const files = [...new Set(imported.map((source) => source.fileName))].join(', ');
      return {
        schemaVersion: 1 as const,
        exportKind: 'local_dataset' as const,
        exportedAt: new Date().toISOString(),
        exportedByAppVersion: RELEASE_IDENTITY.appVersion,
        origin: `Combines a copy of HypoExplorer public results for ${study}, saved in this browser on ${dataset.createdAt}, with results the user imported (${files}). The copied values are the public study's; HypoExplorer did not compute, review or release the imported values. Neither part retains a HypoExplorer release identity or evidence record.`,
        dataset: {
          name: dataset.name, organism: dataset.organism || null, createdAt: dataset.createdAt, savedAt: dataset.updatedAt,
          copiedFrom,
          sources: dataset.sources.map(({ fileName, sheetName, kind, rowCount, importedAt }) => ({ fileName, sheetName, kind, rowCount, importedAt })),
        },
        release: `Not retained for the values copied from ${copiedFrom.datasetId}; not applicable to the user-imported values.`,
        evidence: `Not retained for the copied values (see the HypoExplorer study record for ${copiedFrom.datasetId}); none recorded for the user-imported values.`,
        settings: { geneRows: dataset.genes.length, pathwayRows: dataset.pathways.length },
        reuse: `The terms of the public study apply to the values copied from ${copiedFrom.datasetId}; the importing user holds the rights and obligations for the imported values.`,
      };
    }
    return {
      schemaVersion: 1 as const,
      exportKind: 'local_dataset' as const,
      exportedAt: new Date().toISOString(),
      exportedByAppVersion: RELEASE_IDENTITY.appVersion,
      origin: `A copy of HypoExplorer public results for ${study}, saved in this browser's local workspace on ${dataset.createdAt}. The values are the public study's; this copy does not retain the release identity or evidence record of the build it was copied from.`,
      dataset: {
        name: dataset.name, organism: dataset.organism || null, createdAt: dataset.createdAt, savedAt: dataset.updatedAt,
        copiedFrom,
        sources: dataset.sources.map(({ fileName, sheetName, kind, rowCount, importedAt }) => ({ fileName, sheetName, kind, rowCount, importedAt })),
      },
      release: `Not retained with the local copy. The values came from the public study ${copiedFrom.datasetId} in the HypoExplorer release that was current when it was copied.`,
      evidence: `Not retained with the local copy. See the HypoExplorer study record for ${copiedFrom.datasetId} for its processing and replication evidence.`,
      settings: { geneRows: dataset.genes.length, pathwayRows: dataset.pathways.length },
      reuse: `The terms of the public study it was copied from apply; see the HypoExplorer study record for ${copiedFrom.datasetId}.`,
    };
  }
  return {
    schemaVersion: 1 as const,
    exportKind: 'local_dataset' as const,
    exportedAt: new Date().toISOString(),
    exportedByAppVersion: RELEASE_IDENTITY.appVersion,
    origin: 'User-imported results stored in this browser. They have no HypoExplorer registry entry; HypoExplorer did not compute, review or release these values.',
    dataset: {
      name: dataset.name, organism: dataset.organism || null, createdAt: dataset.createdAt, savedAt: dataset.updatedAt,
      sources: dataset.sources.map(({ fileName, sheetName, kind, rowCount, importedAt }) => ({ fileName, sheetName, kind, rowCount, importedAt })),
    },
    release: 'Not applicable: user-imported results are not part of any HypoExplorer data release.',
    evidence: 'None recorded: HypoExplorer holds no processing or replication assessment for user-imported results.',
    settings: { geneRows: dataset.genes.length, pathwayRows: dataset.pathways.length },
    reuse: 'The importing user holds the rights and obligations for these results; HypoExplorer grants no licence over them.',
  };
}

export type LocalExportProvenance = ReturnType<typeof localExportProvenance>;

interface TrackRecord {
  dataset: { id: string | null; accession: string | null };
  track: { id: string | null };
  contrasts: string | ContrastRecord[];
  expression: { unit: string };
}

/**
 * Appended CSV columns preserve existing scientific column names and order.
 * A columns subject joins one value per column with ' | ', in column order.
 */
export function provenanceColumns(metadata: ExportProvenance): WorkbookRow {
  const tracks: TrackRecord[] = 'columns' in metadata ? metadata.columns : [metadata];
  const value = (read: (track: TrackRecord) => string | null) =>
    (tracks.length === 1 ? read(tracks[0]) : tracks.map(read).join(' | '));
  const contrasts = (track: TrackRecord, spell: (contrast: ContrastRecord) => string) =>
    (typeof track.contrasts === 'string' ? 'Not applicable' : track.contrasts.map(spell).join(' | '));
  return {
    DatasetID: value((track) => track.dataset.id),
    SourceAccession: value((track) => track.dataset.accession),
    TrackID: value((track) => track.track.id),
    ContrastID: value((track) => contrasts(track, (contrast) => contrast.id)),
    ContrastDirection: value((track) => contrasts(track, (contrast) => `${contrast.id}: ${contrast.direction}`)),
    ExpressionUnit: value((track) => track.expression.unit),
    ExportMetadataJSON: JSON.stringify(metadata),
  };
}

/** Keep file-level JSON once; stable dataset/contrast/unit columns stay per row. */
export function provenanceColumnValues(columns: WorkbookRow, rowIndex: number): WorkbookRow[string][] {
  return Object.entries(columns).map(([key, value]) => key === 'ExportMetadataJSON' && rowIndex > 0 ? '' : value);
}

export function provenanceRows(metadata: ExportProvenance | LocalExportProvenance): WorkbookRow[] {
  // One field per row makes the sheet readable and avoids Excel's per-cell
  // text limit when a factorial design carries many evidence records.
  const rows: WorkbookRow[] = [];
  const append = (Field: string, value: unknown): void => {
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length) {
        for (const [key, item] of entries) append(Field ? `${Field}.${key}` : key, item);
      } else rows.push({ Field, Value: Array.isArray(value) ? '[]' : '{}' });
    } else rows.push({ Field, Value: value == null ? 'Unrecorded' : String(value) });
  };
  append('', metadata);
  return rows;
}

/** The Metadata sheet every provenance-carrying workbook ends with. */
export function metadataSheet(metadata: ExportProvenance | LocalExportProvenance): WorkbookSheet {
  return { name: 'Metadata', rows: provenanceRows(metadata) };
}

/** Escape scientific identifiers and structured metadata using the same CSV rule. */
export function exportCsvCell(value: string | number | boolean | null | undefined): string {
  const text = value == null ? '' : String(value);
  return /[,"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
