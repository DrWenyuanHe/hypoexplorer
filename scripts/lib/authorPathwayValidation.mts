import type {
  AuthorPathwayValidation,
  AuthorPathwayValidationTotals,
  CurrentAuthorPathwayValidation,
} from '../../src/data/authorValidation';

const TOTAL_KEYS = [
  'previousRows', 'currentRows', 'addedRows', 'removedRows', 'sharedRows',
  'nonFiniteRowsBefore', 'nonFiniteRowsAfter',
  'nesDirectionChanges', 'fdrCallsBefore', 'fdrCallsAfter', 'fdrCallsGained', 'fdrCallsLost',
] as const;

type RegistryEntry = { id: string; geo?: string; contrasts: readonly unknown[] };
export type CurrentIntakePathwayRecord = CurrentAuthorPathwayValidation & { datasetId: string; accession: string };
const CURRENT_INTAKE_SOURCES: Record<string, [string, string]> = {
  rat_son_lactation_gse30733: ['GSE30733', 'geo_replication/datasets/GSE30733_rnor_son_lactation/processed/'],
  rat_son_salt_gse65663: ['GSE65663', 'geo_replication/datasets/GSE65663_rnor_son_salt/processed/'],
};
const object = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

// The migration audit verifies each schema-3 provenance file and its checksums.
// This join independently rejects incomplete coverage or inconsistent summaries.
export function pathwayValidationByDataset(
  input: unknown,
  registry: readonly RegistryEntry[],
  excludedDatasetId: string,
  currentIntake: readonly CurrentIntakePathwayRecord[] = [],
): Map<string, AuthorPathwayValidation> {
  if (!object(input) || input.schemaVersion !== 1 || !Array.isArray(input.datasets)) {
    throw new Error('FGSEA migration evidence has an unsupported schema');
  }
  if (typeof input.baselineCommit !== 'string' || !/^[0-9a-f]{40}$/.test(input.baselineCommit)) {
    throw new Error('FGSEA migration evidence has no pinned pre-audit baseline commit');
  }
  const inScope = new Map(registry
    .filter((dataset) => dataset.id !== excludedDatasetId)
    .map((dataset) => [dataset.id, dataset]));
  const result = new Map<string, AuthorPathwayValidation>();
  for (const record of currentIntake) {
    const dataset = inScope.get(record.datasetId);
    const binding = CURRENT_INTAKE_SOURCES[record.datasetId];
    if (!dataset || !binding || record.accession !== binding[0] || dataset.geo !== binding[0]) {
      throw new Error('Current pathway evidence is outside the declared new-intake source identities');
    }
    if (result.has(record.datasetId)) throw new Error(`${record.datasetId}: duplicate current pathway evidence`);
    if (record.state !== 'current_provenance_checked' || record.provenanceSchemaVersion !== 3
      || record.contrastCount !== dataset.contrasts.length || record.contrastCount < 1
      || !Number.isSafeInteger(record.currentRows) || record.currentRows < 0
      || !Number.isSafeInteger(record.nonFiniteRows) || record.nonFiniteRows < 0 || record.nonFiniteRows > record.currentRows
      || record.evidencePath !== 'data/intake/oxt-avp-2026-10-19/audit.generated.json'
      || typeof record.note !== 'string' || !record.note.trim()
      || ['totals', 'baselineKind', 'baselineCommit', 'baselineNote'].some(key => key in record)) {
      throw new Error(`${record.datasetId}: invalid current pathway evidence or fabricated migration baseline`);
    }
    if (!Array.isArray(record.provenanceFiles) || record.provenanceFiles.length !== record.contrastCount
      || new Set(record.provenanceFiles).size !== record.contrastCount
      || record.provenanceFiles.some(path => typeof path !== 'string' || !path.startsWith(binding[1])
        || !path.endsWith('_FGSEA_provenance.tsv') || path.includes('\\') || path.split('/').includes('..'))) {
      throw new Error(`${record.datasetId}: current pathway provenance files differ from their source`);
    }
    const { datasetId: _datasetId, accession: _accession, ...validation } = record;
    result.set(record.datasetId, validation);
  }
  for (const record of input.datasets) {
    if (!object(record) || typeof record.datasetId !== 'string' || !inScope.has(record.datasetId)) {
      throw new Error('FGSEA migration evidence contains an unknown or excluded dataset');
    }
    const datasetId = record.datasetId;
    const dataset = inScope.get(datasetId)!;
    if (result.has(datasetId)) throw new Error(`${datasetId}: duplicate or overlapping FGSEA migration evidence`);
    if (record.accession !== (dataset.geo ?? '') || record.contrastCount !== dataset.contrasts.length) {
      throw new Error(`${datasetId}: FGSEA migration accession or contrast count differs from the registry`);
    }
    if (record.status !== 'rebuilt_validated') {
      throw new Error(`${datasetId}: FGSEA migration has not been rebuilt and validated`);
    }
    if ((record.baselineKind !== 'git_commit' && record.baselineKind !== 'local_snapshot')
      || typeof record.baselineNote !== 'string'
      || (record.baselineKind === 'local_snapshot' && !record.baselineNote.trim())) {
      throw new Error(`${datasetId}: FGSEA migration baseline kind or exception note is invalid`);
    }
    const rawTotals = record.totals;
    if (!object(rawTotals) || TOTAL_KEYS.some((key) =>
      !Number.isSafeInteger(rawTotals[key]) || Number(rawTotals[key]) < 0)) {
      throw new Error(`${datasetId}: FGSEA migration totals must be nonnegative integers`);
    }
    const totals = Object.fromEntries(TOTAL_KEYS.map((key) => [key, rawTotals[key]])) as unknown as AuthorPathwayValidationTotals;
    if (totals.previousRows !== totals.sharedRows + totals.removedRows
      || totals.currentRows !== totals.sharedRows + totals.addedRows
      || totals.nonFiniteRowsBefore > totals.previousRows
      || totals.nonFiniteRowsAfter > totals.currentRows
      || totals.nesDirectionChanges > totals.sharedRows
      || totals.fdrCallsBefore > totals.previousRows
      || totals.fdrCallsAfter > totals.currentRows
      || totals.fdrCallsGained > totals.fdrCallsAfter
      || totals.fdrCallsLost > totals.fdrCallsBefore
      || totals.fdrCallsAfter - totals.fdrCallsBefore !== totals.fdrCallsGained - totals.fdrCallsLost) {
      throw new Error(`${datasetId}: FGSEA migration totals are inconsistent`);
    }
    if (!Array.isArray(record.provenanceFiles) || record.provenanceFiles.length !== dataset.contrasts.length
      || record.provenanceFiles.some((file) => typeof file !== 'string'
        || !/^geo_replication\/.+_FGSEA_provenance\.tsv$/.test(file) || file.split('/').includes('..'))
      || new Set(record.provenanceFiles).size !== record.provenanceFiles.length) {
      throw new Error(`${datasetId}: FGSEA migration provenance files are incomplete, invalid, or duplicated`);
    }
    result.set(datasetId, {
      state: 'rebuilt_provenance_checked',
      provenanceSchemaVersion: 3,
      baselineKind: record.baselineKind,
      baselineCommit: record.baselineKind === 'git_commit' ? input.baselineCommit : null,
      baselineNote: record.baselineNote,
      contrastCount: dataset.contrasts.length,
      totals,
      provenanceFiles: [...record.provenanceFiles] as string[],
    });
  }
  if (result.size !== inScope.size) {
    const missing = [...inScope.keys()].filter((id) => !result.has(id));
    throw new Error(`FGSEA migration evidence is missing ${missing.length} dataset(s): ${missing.join(', ')}`);
  }
  return result;
}
