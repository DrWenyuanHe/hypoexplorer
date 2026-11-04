/**
 * Coverage checks for the HFD intake replays after the R 4.6.0 regeneration.
 *
 * data/intake/hfd-2026-09-12/analyses.json is byte-preserved and records the
 * September 12 fits. GSE104709's regenerated tables differ only in line endings; its
 * rerun replay (scripts/verify_hfd_104709_r460.R) is checked by validateHfdReplays. GSE107324's tables
 * changed (rule A2 withholds the unassigned workbook rows from publication), so
 * its model replay is data/internal-qc/advancement-r460-2026-09-25/hfd/107324-independent.json
 * and its fit sizes come from each table's provenance record.
 */
import assert from 'node:assert/strict';
import { validateHfdReplays } from './hfdReplayValidation.mjs';

export const HFD_R460_104709_REPLAY = 'data/internal-qc/advancement-r460-2026-09-25/hfd/104709-independent.json';
export const HFD_R460_MODEL_REPLAY = 'data/internal-qc/advancement-r460-2026-09-25/hfd/107324-independent.json';
const small = (value: unknown, label: string): void => {
  assert(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e-6, `Replay numerical mismatch: ${label}`);
};
const differences = (values: any, keys: string[], label: string): void => {
  assert.deepEqual(Object.keys(values ?? {}).sort(), [...keys].sort(), `Replay statistics incomplete: ${label}`);
  for (const key of keys) small(values[key], `${label}/${key}`);
};
const dependencies = (report: any, paths: string[], label: string): void => {
  assert(Array.isArray(report.dependencies), `Replay dependencies missing: ${label}`);
  const pins = new Map(report.dependencies.map((pin: any) => [pin.path, pin.sha256]));
  assert.equal(pins.size, report.dependencies.length, `Duplicate replay dependency: ${label}`);
  for (const path of paths) assert(/^[a-f0-9]{64}$/.test(String(pins.get(path) ?? '')), `Replay dependency missing: ${path}`);
};

/** `provenance` maps each analysis ID to its <analysisId>_provenance.tsv record. */
export function validateHfdReplaysR460(study: any, analyses: any[], reports: Map<string, any>, provenance: Map<string, Record<string, string>>): void {
  if (study.accession === 'GSE104709') { validateHfdReplays(study, analyses, reports); return; }
  assert.equal(study.accession, 'GSE107324', 'Unknown independent replay schema');
  const fits = analyses.filter(row => row.accession === study.accession);
  assert.equal(fits.length, study.tracks.length, 'Independent replay expects one reviewed contrast per track');
  const source = reports.get('107324-source-independent.json'), model = reports.get('107324-independent.json');
  assert(source && model, 'Rat independent reports missing');
  for (const replay of [source, model]) { assert.equal(replay.accession, study.accession); assert.equal(replay.status, 'passed'); }
  for (const report of [source, model]) assert.deepEqual(report.tracks.map((row: any) => row.track).sort(), study.tracks.map((row: any) => row.id).sort(), 'Replay track coverage differs from intake');
  assert.equal(model.supersedes, 'data/internal-qc/hfd-intake-2026-09-12/107324-independent.json');
  assert.equal(model.sourceReconstruction?.path, 'data/internal-qc/hfd-intake-2026-09-12/107324-source-independent.json');
  assert(/^[a-f0-9]{64}$/.test(model.sourceReconstruction.sha256));
  assert(String(model.packages?.R).startsWith('R version 4.6.0'), 'The rat model replay must run under R 4.6.0');
  for (const track of study.tracks) {
    const fit = fits.find(row => row.track === track.id); assert(fit);
    const record = provenance.get(fit.analysisId); assert(record, `${fit.analysisId}: provenance record missing`);
    const raw = source.tracks.find((row: any) => row.track === track.id);
    const replay = model.tracks.find((row: any) => row.track === track.id);
    assert.equal(raw.status, 'passed'); assert.equal(replay.status, 'passed');
    assert.equal(replay.analysisId, fit.analysisId);
    assert.equal(raw.sourceRows, fit.fullInputRows);
    assert.equal(raw.everyCountCellCompared, fit.fullInputRows * fit.samples.length);
    assert.equal(raw.allPreparedValuesExact, true); assert.equal(raw.allRowTotalsMatch, true);
    assert.deepEqual(raw.missingSymbolsPreserved, replay.inputUnassignedFeatures);
    assert.equal(replay.sourceRows, Number(record.n_features_raw));
    assert.equal(replay.aggregationRows, Number(record.n_features_raw));
    assert.equal(replay.inputUnassignedFeatures.length, Number(record.n_unmapped_in_fit));
    assert.equal(replay.aggregationCountsExact, true); assert.equal(replay.libraryConservation, true);
    assert.deepEqual(replay.samples, fit.samples);
    for (const key of ['control', 'case', 'designRank', 'residualDf']) assert.equal(replay[key], fit[key], `Rat model design changed: ${track.id}/${key}`);
    assert.equal(replay.filteredRows, Number(record.n_features_tested));
    assert.equal(replay.unassignedWithheldFromPublication, Number(record.n_unmapped_tested));
    assert.equal(replay.publishedRows, Number(record.n_de_rows));
    assert.equal(replay.fdr05, Number(record.n_fdr_lt_0_05 ?? record['n_fdr_lt_0.05']));
    assert.equal(replay.allDERowsCompared, true);
    assert.equal(replay.qlStandardErrorsCompared, Number(record.n_de_rows));
    differences(replay.maxDEDifferences, ['logFC', 'stat', 'pvalue', 'padj'], `${track.id}/model`);
    differences(replay.maxNormalizationDifferences, ['sourceLibrary', 'filteredLibrary', 'tmm', 'effectiveLibrary'], `${track.id}/normalization`);
    small(replay.maxSEDifference, `${track.id}/SE`);
    dependencies(raw, [`${study.dir}/raw/source/GSE107324_${track.id}DifferentialCounts0_50_topTable_edgeR_tabular_processed_data.xlsx`, track.matrix, track.samplesheet], `${track.id}/source`);
    dependencies(replay, [track.matrix, track.samplesheet, fit.counts, `${study.dir}/metadata/${fit.analysisId}_gene_map.tsv`,
      `${study.dir}/processed/${fit.analysisId}_DE.tsv`, `${study.dir}/processed/${fit.analysisId}_SE.tsv`,
      `${study.dir}/processed/${fit.analysisId}_sample_qc.tsv`, 'scripts/regen-r460/run_hfd_r460.R', 'scripts/lib/de_common.R'], `${track.id}/model`);
  }
}
