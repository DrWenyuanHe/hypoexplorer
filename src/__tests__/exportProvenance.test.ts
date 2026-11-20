import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import * as XLSX from 'xlsx';
import {
  columnsSubject, exportName, exportProvenance, provenanceRows,
} from '../utils/exportProvenance';
import { leadingEdgeWorkbook, pathwayDetailWorkbook, pathwayTableWorkbook } from '../pathway-explorer/pathwayExport';
import { compareGenesWorkbook } from '../compare/compareSummary';
import { exportRawCSV, exportResultsCSV, exportWorkbook } from '../circadian/circadianExport';
import { exportGenesExcel } from '../gene-explorer/geneExport';
import { DATASETS } from '../data/datasets';
import { listContrasts } from '../data/contrasts';
import { RELEASE_IDENTITY } from '../data/releaseIdentity';
import { csvDownloadTable } from './csvDownload';
import { makePopData, MACAQUE_DATASET } from './fixtures';
import type { WorkbookSheet } from '../utils/workbook';
import type { PathwayRecordWithDb, PopData, TimeSeriesBundle } from '../types';
import type { RhythmRow } from '../circadian/scan';
import { loadExportEvidence } from '../utils/lazyExport';

// Export snapshots record the internal QC ledger, which the app loads on the
// first export (utils/lazyExport.ts); load it before any export runs.
beforeAll(() => loadExportEvidence());

// Every export kind answers "what is this file evidence of" through one module:
// the filename names the dataset, track, contrast and kind, and the Metadata
// sheet (or the CSV's provenance columns) records the dataset, contrast,
// release and kind. These tests drive each kind through the interface its view
// calls, and hold the one honesty rule for local data: no registry or release
// evidence is ever claimed for results the user imported.

const downloadFile = vi.hoisted(() => vi.fn());
const writeWorkbook = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../utils/workbook', () => ({ writeWorkbook }));
vi.mock('../utils/exportAction', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  downloadFile,
}));

const dataset = (id: string) => {
  const found = DATASETS.find((d) => d.id === id);
  if (!found) throw new Error(`fixture dataset ${id} is not registered`);
  return found;
};

const GSE135639 = dataset('mouse_pomc_maternal_hfd_gse135639');
const GSE135639_CONTRASTS = listContrasts(GSE135639);

const PATHWAY: PathwayRecordWithDb = {
  pathway: 'HALLMARK_GLYCOLYSIS', db: 'HALLMARK', NES: 1.8, pval: 0.001, padj: 0.02, size: 120, leadingEdge: ['POMC', 'AGRP'],
};

const gsePop = (contrastIndex: number) => makePopData({
  dataset: GSE135639, meta: { code: 'pomc', label: 'POMC neurons' },
  contrast: GSE135639_CONTRASTS[contrastIndex], allPathways: [PATHWAY],
});

const macaquePop = (code: string) => makePopData({ dataset: MACAQUE_DATASET, meta: { code }, allPathways: [PATHWAY] });

/** Field → Value for a Metadata sheet. */
function fields(sheet: WorkbookSheet | undefined): Record<string, unknown> {
  expect(sheet?.name).toBe('Metadata');
  return Object.fromEntries((sheet?.rows ?? []).map((row) => [row.Field, row.Value]));
}

const lastSheet = (sheets: WorkbookSheet[]) => sheets[sheets.length - 1];

/** The four claims every registered-track Metadata sheet must make. */
function expectTrackIdentity(meta: Record<string, unknown>, kind: string, datasetId: string, contrastId: string, prefix = '') {
  expect(meta.exportKind).toBe(kind);
  expect(meta[`${prefix}dataset.id`]).toBe(datasetId);
  expect(meta[`${prefix}contrasts.0.id`]).toBe(contrastId);
  expect(meta['release.appVersion']).toBe(RELEASE_IDENTITY.appVersion);
  expect(meta['release.releaseId']).toBe(RELEASE_IDENTITY.releaseId);
}

describe('pathway exports', () => {
  it('names the pathway table by dataset, track, contrast and kind, and records them in a Metadata sheet', () => {
    const filters = { search: 'glyco', dbFilter: { HALLMARK: true }, fdrThresh: 0.1, sortKey: 'nes' };
    const { filename, sheets } = pathwayTableWorkbook(gsePop(0), [PATHWAY], filters);
    expect(filename).toBe(`mouse_pomc_maternal_hfd_gse135639_pomc_${GSE135639_CONTRASTS[0].id}_pathways_export.xlsx`);
    expect(sheets.map((sheet) => sheet.name)).toEqual(['Pathways', 'Metadata']);
    const meta = fields(lastSheet(sheets));
    expectTrackIdentity(meta, 'pathways_export', GSE135639.id, GSE135639_CONTRASTS[0].id);
    expect(meta['dataset.accession']).toBe('GSE135639');
    expect(meta['settings.pathwayFilters.fdrThresh']).toBe('0.1');
    expect(meta['settings.rowCount']).toBe('1');
    expect(String(meta.sourceUrl)).toContain('pathway');
  });

  it('gives two contrasts of GSE135639 different pathway export filenames', () => {
    expect(GSE135639_CONTRASTS.length).toBeGreaterThan(1);
    const filters = { search: '', dbFilter: {}, fdrThresh: 0.05, sortKey: 'nes' };
    const names = GSE135639_CONTRASTS.map((_, i) => pathwayTableWorkbook(gsePop(i), [PATHWAY], filters).filename);
    expect(new Set(names).size).toBe(GSE135639_CONTRASTS.length);
  });

  it('names and records the pathway detail export', () => {
    const { filename, sheets } = pathwayDetailWorkbook(PATHWAY, gsePop(1));
    expect(filename).toBe(`mouse_pomc_maternal_hfd_gse135639_pomc_${GSE135639_CONTRASTS[1].id}_pathway_detail_HALLMARK_GLYCOLYSIS.xlsx`);
    const meta = fields(lastSheet(sheets));
    expectTrackIdentity(meta, 'pathway_detail', GSE135639.id, GSE135639_CONTRASTS[1].id);
    expect(meta['settings.selectedPathway.pathway']).toBe('HALLMARK_GLYCOLYSIS');
    expect(meta['settings.selectedPathway.database']).toBe('HALLMARK');
  });

  it('names a multi-contrast leading-edge export by every slice it covers', () => {
    const slices = GSE135639_CONTRASTS.slice(0, 2).map((contrast, i) => ({ contrast, popData: gsePop(i) }));
    const { filename, sheets } = leadingEdgeWorkbook(PATHWAY, gsePop(0), ['POMC', 'AGRP'], slices);
    expect(filename).toBe(`mouse_pomc_maternal_hfd_gse135639_pomc_${GSE135639_CONTRASTS[0].id}+${GSE135639_CONTRASTS[1].id}_leadingedge_HALLMARK_GLYCOLYSIS.xlsx`);
    const meta = fields(lastSheet(sheets));
    expectTrackIdentity(meta, 'leadingedge', GSE135639.id, GSE135639_CONTRASTS[0].id);
    expect(meta['contrasts.1.id']).toBe(GSE135639_CONTRASTS[1].id);
    expect(meta['settings.leadingEdgeGenes']).toBe('2');
  });
});

describe('compare exports', () => {
  const columns = [{ key: 'e9', label: 'e9' }, { key: 'i23', label: 'i23' }];
  const popDataMap: Record<string, PopData | null> = { e9: macaquePop('e9'), i23: macaquePop('i23') };

  it('replaces the fixed hypoexplorer_compare.xlsx with an identifying name and a Metadata sheet', () => {
    const { filename, sheets } = compareGenesWorkbook(
      columns.map((c) => ({ ...c, color: '#000', qc: null })), popDataMap, ['POMC'],
    );
    expect(filename).toBe('macaque_snrna_e9+i23_obese_vs_normal_compare.xlsx');
    expect(sheets.map((sheet) => sheet.name)).toEqual(['Compare', 'Values', 'Metadata']);
    const meta = fields(lastSheet(sheets));
    expectTrackIdentity(meta, 'compare', 'macaque_snrna', 'obese_vs_normal', 'columns.0.');
    expect(meta['columns.1.track.id']).toBe('i23');
    expect(meta['columns.0.dataset.accession']).toBe('CNP0003785');
    expect(meta['settings.geneCount']).toBe('1');
  });

  it('names and records the compare pathway and compare leading-edge exports', () => {
    const subject = columnsSubject(columns, popDataMap);
    expect(exportName(subject, ['pathway_compare'], 'xlsx')).toBe('macaque_snrna_e9+i23_obese_vs_normal_pathway_compare.xlsx');
    expect(exportName(subject, ['compare_leadingedge', 'GO: a/b'], 'xlsx'))
      .toBe('macaque_snrna_e9+i23_obese_vs_normal_compare_leadingedge_GO_ a_b.xlsx');
    for (const kind of ['pathway_compare', 'compare_leadingedge'] as const) {
      const meta = Object.fromEntries(provenanceRows(exportProvenance(kind, subject, {})).map((row) => [row.Field, row.Value]));
      expectTrackIdentity(meta, kind, 'macaque_snrna', 'obese_vs_normal', 'columns.0.');
    }
  });

  it('keeps a cross-study compare set filename bounded and its metadata complete', () => {
    const studies = DATASETS.filter((d) => listContrasts(d).length).slice(0, 5);
    const map: Record<string, PopData | null> = Object.fromEntries(studies.map((d) => [d.id,
      makePopData({ dataset: d, meta: { code: d.defaultTrack }, contrast: listContrasts(d)[0] })]));
    const subject = columnsSubject(studies.map((d) => ({ key: d.id, label: d.name })), map);
    expect(exportName(subject, ['compare_set'], 'xlsx')).toMatch(/^5-datasets_.+_compare_set\.xlsx$/);
    const meta = Object.fromEntries(provenanceRows(exportProvenance('compare_set', subject, {})).map((row) => [row.Field, row.Value]));
    expectTrackIdentity(meta, 'compare_set', studies[0].id, listContrasts(studies[0])[0].id, 'columns.0.');
    expect(meta['columns.4.dataset.id']).toBe(studies[4].id);
  });

  it('records a column with no loaded data as unrecorded instead of dropping it', () => {
    const subject = columnsSubject(columns, { e9: macaquePop('e9'), i23: null });
    const meta = Object.fromEntries(provenanceRows(exportProvenance('compare', subject, {})).map((row) => [row.Field, row.Value]));
    expect(meta['columns.1.key']).toBe('i23');
    expect(meta['columns.1.dataset.id']).toBe('Unrecorded');
    expect(meta['columns.1.contrasts']).toBe('[]');
  });
});

describe('circadian exports', () => {
  beforeEach(() => { downloadFile.mockClear(); writeWorkbook.mockClear(); });

  const SCN = dataset('mouse_scn_hfd_gse157077');
  const bundle: TimeSeriesBundle = {
    meta: {
      trackId: 'scn', label: 'SCN', cycleHours: 24, timeUnit: 'ZT', expressionUnit: 'CPM',
      arms: [{ key: 'chow', label: 'Chow', color: '#000' }],
      samples: [{ id: 'A1', arm: 'chow', time: 0, replicate: 1 }, { id: 'A2', arm: 'chow', time: 12, replicate: 1 }],
      timepoints: [0, 12], nGenes: 1,
    },
    values: { Per2: [1, 5] },
  };
  const ctx = { bundle, dataset: SCN, method: 'cosinor' as const, adjust: 'bh' as const, armLabel: 'Chow', periods: [24] };
  const row: RhythmRow = {
    gene: 'Per2', method: 'cosinor', p: 0.01, q: 0.02, period: 24, acrophase: 6, amplitude: 2, mesor: 3, stat: 9, n: 2, nTimepoints: 2,
  } as RhythmRow;

  it('adopts the shared schema in a Metadata sheet and keeps every circadian setting', async () => {
    // The circadian workbook writes dense sheets itself (whole-transcriptome raw
    // values), so read back the actual file handed to the browser.
    let blob: Blob | undefined;
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { blob = b as Blob; return 'blob:test/1'; });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      await exportWorkbook([row], ['Per2'], ctx);
    } finally {
      create.mockRestore();
      revoke.mockRestore();
    }
    const [filename] = downloadFile.mock.calls[0] as [string, string];
    expect(filename).toBe(`${SCN.id}_scn_circadian.xlsx`);
    expect(blob).toBeDefined();
    const wb = XLSX.read(new Uint8Array(await (blob as Blob).arrayBuffer()));
    expect(wb.SheetNames).toEqual(['Rhythmicity', 'RawValues', 'Metadata']);
    const meta = fields({
      name: 'Metadata',
      rows: XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Metadata),
    } as WorkbookSheet);
    expect(meta.exportKind).toBe('circadian');
    expect(meta['dataset.id']).toBe(SCN.id);
    expect(meta['dataset.name']).toBe(SCN.name);
    expect(meta['track.label']).toBe('SCN');
    expect(meta['expression.unit']).toBe('CPM');
    expect(meta['release.appVersion']).toBe(RELEASE_IDENTITY.appVersion);
    // No baseline/case contrast exists for a rhythm test; the record says so.
    expect(meta.contrasts).toMatch(/^Not applicable/);
    expect(meta['settings.period']).toBe('24 h (pinned)');
    expect(meta['settings.armTested']).toBe('Chow');
    expect(meta['settings.samplingTimes']).toBe('ZT0, ZT12');
    expect(meta['settings.libraries']).toBe('2');
    expect(meta['settings.genesInBundle']).toBe('1');
    expect(meta['settings.effectiveCandidatePeriodsHours']).toBe('24');
    expect(meta['settings.effectiveCandidatePeriodsScope']).toMatch(/^COSINOR: the requested candidate periods\./);
    expect(meta['settings.note']).toContain('Acrophase');
    expect(meta['groups.0.samples.1']).toBe('A2');
    expect(String(meta.trackBundleUrl)).toContain('timeseries_');
  });

  it('appends the provenance columns to both CSVs, with the JSON once', async () => {
    exportResultsCSV([row], ctx);
    // The raw CSV is written a block at a time and settles once handed over.
    await exportRawCSV(bundle, ['Per2'], ctx);
    const [[resultsName, resultsUrl], [rawName, rawUrl]] = downloadFile.mock.calls as Array<[string, string]>;
    expect(resultsName).toBe(`${SCN.id}_scn_rhythmicity_cosinor.csv`);
    expect(rawName).toBe(`${SCN.id}_scn_timecourse_values.csv`);
    const table = csvDownloadTable;
    const [header, first] = table(resultsUrl);
    expect(header.slice(0, 2)).toEqual(['Gene', 'Method']);
    expect(first[header.indexOf('DatasetID')]).toBe(SCN.id);
    expect(first[header.indexOf('ContrastID')]).toBe('Not applicable');
    expect(JSON.parse(first[header.indexOf('ExportMetadataJSON')]).exportKind).toBe('rhythmicity');
    const [rawHeader, ...rawRows] = table(rawUrl);
    expect(rawRows).toHaveLength(2);
    expect(rawRows[1][rawHeader.indexOf('ExportMetadataJSON')]).toBe('');
    expect(JSON.parse(rawRows[0][rawHeader.indexOf('ExportMetadataJSON')]).settings.rhythmTest).toBeTruthy();
  });
});

describe('gene exports', () => {
  beforeEach(() => writeWorkbook.mockClear());

  it('records the kind beside the unchanged dataset, contrast and release fields', async () => {
    await exportGenesExcel(['POMC'], macaquePop('e9'));
    const [filename, sheets] = writeWorkbook.mock.calls[0] as unknown as [string, WorkbookSheet[]];
    expect(filename).toBe('macaque_snrna_e9_obese_vs_normal_genes_export.xlsx');
    expectTrackIdentity(fields(lastSheet(sheets)), 'genes_export', 'macaque_snrna', 'obese_vs_normal');
  });
});
