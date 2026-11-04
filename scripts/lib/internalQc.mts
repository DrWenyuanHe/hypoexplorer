import { aggregateQualityChecks, type QualityAssessment, type QualityCheck, type QualityStatus } from '../../src/data/qualityChecks';

export const INTERNAL_QC_POLICY = 'internal-qc-v1';
export type EvidenceRow = Record<string, string>;
export const numeric = (value: unknown): number | null => {
  if (value == null || typeof value === 'boolean' || String(value).trim() === '' || /^(NA|NaN|null)$/i.test(String(value))) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};
export const approximatelyEqual = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 + 1e-8 * Math.max(Math.abs(a), Math.abs(b));

export function sourceHashMatches(actual: string, normalized: string | null, expected: string, expectedNormalized?: string): boolean {
  return actual === expected || normalized === expected || (normalized != null && !!expectedNormalized && normalized === expectedNormalized);
}

export function manifestRowForFile(rows: EvidenceRow[], relativePath: string): EvidenceRow | undefined {
  const path = relativePath.replace(/\\/g, '/');
  return rows.find((row) => row.local_path
    ? row.local_path.replace(/\\/g, '/') === path
    : !!row.file && (row.file.replace(/\\/g, '/') === path || path.endsWith(`/${row.file.replace(/\\/g, '/')}`)));
}

export function countConservationSampleStatus(row: EvidenceRow, currentSum: number): QualityStatus {
  const deltaKey = ['count_conservation_delta', 'merged_count_conservation_delta', 'conservation_delta', 'partition_delta', 'library_size_delta'].find((key) => numeric(row[key]) != null);
  const totalKey = ['output_library_size', 'merged_library_size', 'library_size_output', 'library_size', 'collapsed_sum', 'retained_expected_count_sum', 'output_count_estimate_sum', 'output_count_sum', 'source_library_size'].find((key) => numeric(row[key]) != null);
  if (!deltaKey || !totalKey) return 'not_assessed';
  return approximatelyEqual(numeric(row[deltaKey])!, 0) && approximatelyEqual(numeric(row[totalKey])!, currentSum) ? 'pass' : 'fail';
}

export interface NormalizationReplay {
  datasetId: string;
  contrastId: string;
  config: EvidenceRow;
  fingerprints: Record<string, string>;
  scriptSha256: string;
  replayFile: string;
  replaySha256?: string;
  evidenceId?: string;
  status: QualityStatus;
  existingRows?: number;
  matchedRows?: number;
  samples?: Record<string, string | number>[];
  note: string;
  software?: { R: string; edgeR: string; limma: string };
}

/** A saved replay is usable only against exactly the configuration and files it measured. */
export function replayIsCurrent(replay: NormalizationReplay, config: EvidenceRow, expectedPaths: string[], hashes: Record<string, string>, scriptSha256: string): boolean {
  const keys = [...new Set([...Object.keys(config), ...Object.keys(replay.config)])];
  return keys.every((key) => config[key] === replay.config[key])
    && replay.scriptSha256 === scriptSha256
    && Object.keys(replay.fingerprints).length === expectedPaths.length
    && expectedPaths.every((path) => !!hashes[path] && replay.fingerprints[path] === hashes[path]);
}

export function replayArtifactMatches(replay: NormalizationReplay, hash: string, artifact: Partial<NormalizationReplay>): boolean {
  return !!replay.replaySha256 && hash === replay.replaySha256 && !!replay.evidenceId && artifact.evidenceId === replay.evidenceId
    && ['status', 'existingRows', 'matchedRows', 'samples', 'software'].every((key) => JSON.stringify(artifact[key as keyof NormalizationReplay]) === JSON.stringify(replay[key as keyof NormalizationReplay]));
}

export function normalizationSampleStatus(row: EvidenceRow, inputKind: string | undefined, currentSum: number): QualityStatus {
  if (inputKind === 'counts') {
    const factor = numeric(row.tmm_norm_factor);
    const library = numeric(row.library_size);
    if (factor == null || library == null) return 'not_assessed';
    // Effective sizes use a filtered library universe in canonical edgeR.
    const effective = numeric(row.effective_library_size);
    const normalizationLibrary = numeric(row.normalization_library_size);
    const provided = (key: string): boolean => row[key] != null && row[key].trim() !== '' && !/^NA$/i.test(row[key]);
    const invalidLibrary = (provided('effective_library_size') && (effective == null || effective <= 0))
      || (provided('normalization_library_size') && (normalizationLibrary == null || normalizationLibrary <= 0));
    return factor <= 0 || library <= 0 || !approximatelyEqual(library, currentSum)
      || invalidLibrary
      || (effective != null && normalizationLibrary != null && !approximatelyEqual(normalizationLibrary * factor, effective)) ? 'fail' : 'pass';
  }
  if (inputKind === 'matrix') {
    const delta = numeric(row.transform_max_abs_delta ?? row.identity_transform_delta);
    const total = numeric(row.log2_expression_sum ?? row.log_expression_sum);
    if (delta == null || total == null) return 'not_assessed';
    return Math.abs(delta) > 1e-6 || !approximatelyEqual(total, currentSum) ? 'fail' : 'pass';
  }
  return 'not_assessed';
}

export function qualityCheck(id: string, label: string, status: QualityStatus, note: string, evidence: string[] = []): QualityCheck {
  return { id, label, status, note, ...(evidence.length ? { evidence } : {}) };
}

export function assessment(checks: QualityCheck[], scope: string): QualityAssessment {
  return { status: aggregateQualityChecks(checks), checks, scope, policyVersion: INTERNAL_QC_POLICY };
}

/** RFC-style quoting also handles GEO's quoted TSV headers. Multiline cells are not matrix data. */
export function splitCells(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { cells.push(value); value = ''; }
    else value += char;
  }
  if (quoted) throw new Error('Unclosed quoted matrix cell');
  cells.push(value);
  return cells;
}

export function parseTsv(text: string): EvidenceRow[] {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitCells(lines[0], '\t');
  return lines.slice(1).map((line) => {
    const cells = splitCells(line, '\t');
    return Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']));
  });
}

export interface MatrixMeasurement {
  rows: number;
  samples: string[];
  missingSamples: string[];
  duplicateSamples: number;
  malformedRows: number;
  invalidValues: number;
  negativeValues: number;
  fractionalValues: number;
  sums: Record<string, number>;
  detected: Record<string, number>;
}

/** Inspect only analysis sample columns; annotations and explicitly excluded samples are not values. */
export function measureMatrix(text: string, samples: string[]): MatrixMeasurement {
  let lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const begin = lines.findIndex((line) => line.startsWith('!series_matrix_table_begin'));
  if (begin >= 0) {
    const end = lines.findIndex((line) => line.startsWith('!series_matrix_table_end'));
    if (end <= begin) throw new Error('Missing series matrix end marker');
    lines = lines.slice(begin + 1, end);
  }
  lines = lines.filter((line) => line.trim() && !line.startsWith('#'));
  if (!lines.length) throw new Error('Empty expression matrix');
  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : null;
  const cellsFor = (line: string): string[] => delimiter ? splitCells(line, delimiter) : line.trim().split(/\s+/);
  const header = cellsFor(lines[0]);
  const positions = samples.map((sample) => header.indexOf(sample));
  const result: MatrixMeasurement = {
    rows: 0, samples, missingSamples: samples.filter((_, i) => positions[i] < 0),
    duplicateSamples: samples.filter((sample) => header.filter((column) => column === sample).length > 1).length,
    malformedRows: 0, invalidValues: 0, negativeValues: 0, fractionalValues: 0,
    sums: Object.fromEntries(samples.map((sample) => [sample, 0])),
    detected: Object.fromEntries(samples.map((sample) => [sample, 0])),
  };
  for (const line of lines.slice(1)) {
    const cells = cellsFor(line);
    result.rows++;
    if (cells.length !== header.length) result.malformedRows++;
    for (let i = 0; i < samples.length; i++) {
      if (positions[i] < 0) continue;
      const value = numeric(cells[positions[i]]);
      if (value == null) { result.invalidValues++; continue; }
      result.sums[samples[i]] += value;
      if (value > 0) result.detected[samples[i]]++;
      if (value < 0) result.negativeValues++;
      if (!Number.isInteger(value)) result.fractionalValues++;
    }
  }
  return result;
}

export function matrixValueCheck(matrix: MatrixMeasurement | null, inputKind: string | undefined, evidence: string[]): QualityCheck {
  if (!matrix) return qualityCheck('matrix_values', 'Input matrix values', 'not_assessed', 'The analysis input matrix could not be measured locally.', evidence);
  const invalid = !matrix.rows || matrix.missingSamples.length || matrix.duplicateSamples || matrix.malformedRows || matrix.invalidValues || (inputKind === 'counts' && matrix.negativeValues);
  return qualityCheck('matrix_values', 'Input matrix values', invalid ? 'fail' : 'pass', invalid
    ? `Matrix has ${matrix.missingSamples.length} missing sample columns, ${matrix.duplicateSamples} duplicate columns, ${matrix.malformedRows} malformed rows, ${matrix.invalidValues} invalid values and ${matrix.negativeValues} negative values.`
    : `${matrix.rows.toLocaleString('en-US')} rows across ${matrix.samples.length} analysis samples have finite values and valid dimensions.${inputKind === 'counts' ? ' Counts are nonnegative; fractional count estimates are preserved.' : ' Negative normalized log-expression values are allowed.'}`, evidence);
}

export function replicationCheck(samples: EvidenceRow[], baseline: string[], cases: string[], evidence: string[]): QualityCheck {
  const selected = samples.filter((row) => baseline.includes(row.sample) || cases.includes(row.sample));
  const keys = ['donor', 'donor_id', 'subject_id', 'animal', 'animal_id', 'mouse', 'mouse_id', 'rat', 'rat_id', 'pig_id', 'biological_unit', 'biological_replicate', 'culture_replicate'];
  // A partial donor column must not be bypassed by complete specimen/library IDs.
  // BioSample IDs alone identify specimens, which may share an animal or donor.
  const declared = keys.find((name) => selected.some((row) => name in row));
  const key = declared ?? (selected.every((row) => /^true$/i.test(row.independent_biosample ?? '')) ? 'biosample' : undefined);
  const complete = key && selected.length > 0 && selected.length === baseline.length + cases.length && selected.every((row) => row[key]?.trim() && !/^(NA|unknown)$/i.test(row[key]));
  if (!complete || !key) return qualityCheck('independent_replication', 'Independent biological replication', 'not_assessed', 'Independent donor, animal or biological-unit identifiers are not recorded for every selected sample. BioSample or library identifiers alone are insufficient.', evidence);
  if (key === 'biological_unit' && selected.every((row) => /\b(pool of|one bird|from .*rats|from .*birds)\b/i.test(row[key]))) {
    return qualityCheck('independent_replication', 'Independent biological replication', 'not_assessed', 'The biological-unit field describes pooled specimens rather than identifying their constituent animals or independent pools. Pool independence needs explicit identifiers.', evidence);
  }
  const bySample = new Map(selected.map((row) => [row.sample, row[key]]));
  const a = new Set(baseline.map((sample) => bySample.get(sample)));
  const b = new Set(cases.map((sample) => bySample.get(sample)));
  const repeated = a.size !== baseline.length || b.size !== cases.length;
  const paired = [...a].some((unit) => b.has(unit));
  const minimum = Math.min(a.size, b.size);
  const status = minimum < 2 ? 'fail' : minimum < 3 || repeated || paired ? 'review' : 'pass';
  return qualityCheck('independent_replication', 'Independent biological replication', status,
    `${a.size} baseline and ${b.size} case units, identified by ${key}. ${repeated ? 'Repeated units within an arm need aggregation or a repeated-measures model.' : paired ? 'Units repeated across arms require review of the paired model.' : minimum < 3 ? 'Fewer than three independent units in an arm require review.' : 'At least three distinct units in each arm, with no reused units.'}`, evidence);
}

export function designRank(matrix: number[][]): number {
  if (!matrix.length) return 0;
  const rows = matrix.map((row) => [...row]);
  let rank = 0;
  for (let column = 0; column < rows[0].length && rank < rows.length; column++) {
    const pivot = rows.findIndex((row, index) => index >= rank && Math.abs(row[column]) > 1e-10);
    if (pivot < 0) continue;
    [rows[rank], rows[pivot]] = [rows[pivot], rows[rank]];
    const scale = rows[rank][column];
    for (let j = column; j < rows[rank].length; j++) rows[rank][j] /= scale;
    for (let i = rank + 1; i < rows.length; i++) {
      const coefficient = rows[i][column];
      for (let j = column; j < rows[i].length; j++) rows[i][j] -= coefficient * rows[rank][j];
    }
    rank++;
  }
  return rank;
}

export function modelCheck(samples: EvidenceRow[], inputKind: string | undefined, batch: string | undefined, methods: string[], evidence: string[]): QualityCheck {
  const expected = inputKind === 'counts' ? 'edgeR-QL' : inputKind === 'matrix' ? 'limma' : null;
  if (!expected || !samples.length || !methods.length) return qualityCheck('model_validity', 'Model design and input scale', 'not_assessed', 'The analysis configuration, sample design or fitted method is not available.', evidence);
  if (methods.some((method) => method !== expected)) return qualityCheck('model_validity', 'Model design and input scale', 'review', `Recorded method ${methods.join(', ')} needs review against the configured ${inputKind} route.`, evidence);
  const hasBatch = batch && batch !== 'NA';
  if (hasBatch && samples.some((row) => !row[batch] || row[batch] === 'NA')) return qualityCheck('model_validity', 'Model design and input scale', 'fail', `The configured ${batch} covariate is missing from the analysis samples.`, evidence);
  if (samples.some((row) => !['control', 'case'].includes(row.group))) return qualityCheck('model_validity', 'Model design and input scale', 'not_assessed', 'This design does not use the canonical control/case model and needs a dedicated design audit.', evidence);
  const levels = hasBatch ? [...new Set(samples.map((row) => row[batch]))].sort().slice(1) : [];
  const design = samples.map((row) => [1, ...levels.map((level) => +(row[batch!] === level)), +(row.group === 'case')]);
  const columns = design[0].length;
  const rank = designRank(design);
  return qualityCheck('model_validity', 'Model design and input scale', rank < columns || samples.length <= rank ? 'fail' : 'pass',
    `${expected} matches the configured ${inputKind} input. Recomputed ${hasBatch ? `${batch} + group` : 'group'} design rank is ${rank}/${columns}, with ${samples.length - rank} residual degrees of freedom. This checks identifiability and the declared route, not every biological confounder.`, evidence);
}
