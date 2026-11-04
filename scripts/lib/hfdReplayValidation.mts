import assert from 'node:assert/strict';

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
const tracks = (report: any, expected: any[]): void => {
  assert(Array.isArray(report.tracks), 'Replay tracks missing');
  assert.deepEqual(report.tracks.map((row: any) => row.track).sort(), expected.map(row => row.id).sort(), 'Replay track coverage differs from intake');
};

/** Validate report coverage before its checksums can support a numerical-QC pass. */
export function validateHfdReplays(study: any, analyses: any[], reports: Map<string, any>): void {
  const fits = analyses.filter(row => row.accession === study.accession);
  assert.equal(fits.length, study.tracks.length, 'Independent replay expects one reviewed contrast per track');
  for (const replay of reports.values()) {
    assert.equal(replay.accession, study.accession);
    assert.equal(replay.status, 'passed');
  }
  if (study.accession === 'GSE104709') {
    const replay = reports.get('104709-independent.json');
    assert(replay, 'Mouse independent replay missing');
    assert.equal(study.tracks.length, 1);
    const track = study.tracks[0], fit = fits[0];
    assert.equal(fit.track, track.id);
    assert.equal(replay.pipelineCompared, true, 'Mouse model replay did not compare pipeline outputs');
    assert.equal(replay.authorStatisticsCompared, false, 'Internal replay must not claim author concordance');
    assert.equal(replay.rawCounts, false);
    assert.equal(replay.librarySumConservation, true);
    assert.equal(replay.preparedRows, fit.fullInputRows);
    assert.equal(replay.everySelectedValueCompared, fit.fullInputRows * fit.samples.length);
    assert.deepEqual(replay.selectedSamples, fit.samples);
    assert.equal(replay.controlPools, fit.control);
    assert.equal(replay.casePools, fit.case);
    assert.equal(replay.micePerPool, 2);
    assert.equal(replay.residualDf, fit.residualDf);
    assert.equal(replay.expectedFittedRows, fit.nGenes);
    assert.equal(replay.comparedRows, fit.nGenes);
    assert.equal(replay.fdr05, fit.fdr05);
    assert.equal(replay.model, 'limma lmFit then eBayes; HFD minus chow; nonconstant genes');
    assert.equal(typeof replay.packages?.limma, 'string');
    small(replay.maxPreparedValueDifference, 'mouse preparation');
    differences(replay.maxDifferences, ['logFC', 'stat', 'pvalue', 'padj', 'se'], 'mouse model');
    dependencies(replay, [`${study.dir}/raw/GSE104709_Gene_quant.txt.gz`, track.matrix, track.samplesheet,
      `${study.dir}/processed/${fit.analysisId}_DE.tsv`, `${study.dir}/processed/${fit.analysisId}_SE.tsv`], 'mouse');
    return;
  }
  assert.equal(study.accession, 'GSE107324', 'Unknown independent replay schema');
  const source = reports.get('107324-source-independent.json'), model = reports.get('107324-independent.json');
  assert(source && model, 'Rat independent reports missing');
  tracks(source, study.tracks); tracks(model, study.tracks);
  assert.equal(model.sourceReconstruction?.path, 'data/internal-qc/hfd-intake-2026-09-12/107324-source-independent.json');
  assert(/^[a-f0-9]{64}$/.test(model.sourceReconstruction.sha256));
  assert.equal(typeof model.packages?.edgeR, 'string');
  for (const track of study.tracks) {
    const fit = fits.find(row => row.track === track.id); assert(fit);
    const raw = source.tracks.find((row: any) => row.track === track.id);
    const replay = model.tracks.find((row: any) => row.track === track.id);
    assert.equal(raw.status, 'passed'); assert.equal(replay.status, 'passed');
    assert.equal(replay.analysisId, fit.analysisId);
    assert.equal(raw.sourceRows, fit.fullInputRows);
    assert.equal(raw.everyCountCellCompared, fit.fullInputRows * fit.samples.length);
    assert.equal(raw.allPreparedValuesExact, true); assert.equal(raw.allRowTotalsMatch, true);
    assert.deepEqual(Object.keys(raw.libraryTotals).sort(), [...fit.samples].sort());
    assert.deepEqual(raw.missingSymbolsPreserved, replay.inputUnassignedFeatures);
    assert.equal(replay.sourceRows, fit.fullInputRows);
    assert.equal(replay.aggregationRows, fit.mappedRows);
    assert.equal(replay.aggregationCountsExact, true); assert.equal(replay.libraryConservation, true);
    assert.deepEqual(replay.samples, fit.samples);
    for (const key of ['control', 'case', 'designRank', 'residualDf', 'fdr05']) assert.equal(replay[key], fit[key], `Rat model design changed: ${track.id}/${key}`);
    assert.equal(replay.filteredRows, fit.nGenes);
    assert.equal(replay.allDERowsCompared, true);
    assert.equal(replay.qlStandardErrorsCompared, fit.nGenes);
    differences(replay.maxDEDifferences, ['logFC', 'stat', 'pvalue', 'padj'], `${track.id}/model`);
    differences(replay.maxNormalizationDifferences, ['sourceLibrary', 'filteredLibrary', 'tmm', 'effectiveLibrary'], `${track.id}/normalization`);
    small(replay.maxSEDifference, `${track.id}/SE`);
    dependencies(raw, [`${study.dir}/raw/source/GSE107324_${track.id}DifferentialCounts0_50_topTable_edgeR_tabular_processed_data.xlsx`, track.matrix, track.samplesheet], `${track.id}/source`);
    dependencies(replay, [track.matrix, track.samplesheet, fit.counts, `${study.dir}/processed/${fit.analysisId}_DE.tsv`,
      `${study.dir}/processed/${fit.analysisId}_SE.tsv`, `${study.dir}/processed/${fit.analysisId}_sample_qc.tsv`], `${track.id}/model`);
  }
}
