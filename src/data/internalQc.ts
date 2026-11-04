// Named imports, not the default object: the bundler keeps only the ledger
// fields the app reads, so its ~600 KB `inputs` fingerprint table stays out of
// the evidence chunk every visitor precaches.
import {
  policyVersion as ledgerPolicyVersion, records as ledgerRecords, schemaVersion as ledgerSchemaVersion,
} from '../../data/internal-qc/assessments.generated.json';
import { DATASETS } from './datasets';
import { aggregateQualityChecks, type QualityAssessment, type QualityStatus } from './qualityChecks';
import intakeStudies from '../../data/intake/september5-2026/studies.json';

export interface InternalQcTrackRecord {
  trackId: string;
  assessment: QualityAssessment;
  contrasts: Record<string, QualityAssessment>;
}

export interface InternalQcRecord {
  datasetId: string;
  assessment: QualityAssessment;
  contrasts: Record<string, QualityAssessment>;
  tracks?: Record<string, InternalQcTrackRecord>;
}

const statuses = new Set<QualityStatus>(['pass', 'review', 'fail', 'not_assessed', 'not_applicable']);
const intakeTracks = new Map(intakeStudies.map(study => [study.id, study.tracks.map(track => track.id)]));

function validateAssessment(value: QualityAssessment): void {
  if (!value || !statuses.has(value.status) || !Array.isArray(value.checks) || typeof value.scope !== 'string' || value.policyVersion !== ledgerPolicyVersion) {
    throw new Error('Invalid internal QC assessment');
  }
  const ids = new Set<string>();
  for (const check of value.checks) {
    if (!check || typeof check.id !== 'string' || ids.has(check.id) || typeof check.label !== 'string' || typeof check.note !== 'string' || !statuses.has(check.status)) throw new Error('Invalid internal QC check');
    ids.add(check.id);
  }
  if (aggregateQualityChecks(value.checks) !== value.status) throw new Error('Internal QC aggregate disagrees with its checks');
}

function validateAggregate(parent: QualityAssessment, children: QualityAssessment[], message: string): void {
  const ids = new Set(children.flatMap(child => child.checks.map(check => check.id)));
  if (!children.length || parent.checks.length !== ids.size || parent.checks.some(check => !ids.has(check.id))) throw new Error(message);
  for (const check of parent.checks) {
    const entries = children.map(child => child.checks.find(item => item.id === check.id));
    if (entries.some(item => !item)) throw new Error(message);
    const present = entries.filter(item => item !== undefined);
    if (aggregateQualityChecks(present) !== check.status || (check.required !== false) !== present.some(item => item.required !== false)) throw new Error(message);
  }
}

function validateIntakeTracks(record: InternalQcRecord, contrastIds: string[], trackIds: string[]): void {
  const tracks = record.tracks;
  if (!tracks || Array.isArray(tracks) || Object.keys(tracks).length !== trackIds.length || trackIds.some(id => !Object.prototype.hasOwnProperty.call(tracks, id))) {
    throw new Error('Internal QC intake track coverage disagrees with the registry');
  }
  for (const id of trackIds) {
    const track = tracks[id];
    if (!track || track.trackId !== id) throw new Error('Internal QC intake track identity differs');
    validateAssessment(track.assessment);
    const actual = Object.keys(track.contrasts ?? {});
    if (actual.length !== contrastIds.length || contrastIds.some(contrast => !actual.includes(contrast))) throw new Error('Internal QC intake track contrast coverage differs');
    for (const result of Object.values(track.contrasts)) {
      validateAssessment(result);
      // These checks cannot be made optional by a saved assessment.
      const required = ['independent_replication', 'count_conservation', 'normalization', 'source_reconstruction',
        ...(record.datasetId === 'gse314184' ? ['source_species_feature_mapping', 'source_pairing_model'] : [])];
      for (const id of required) if (!result.checks.some(check => check.id === id && check.required !== false)) {
        throw new Error('Internal QC intake source and scientific checks must remain required');
      }
    }
    validateAggregate(track.assessment, Object.values(track.contrasts), 'Internal QC track checks disagree with its contrasts');
  }
  for (const id of contrastIds) validateAggregate(record.contrasts[id], trackIds.map(track => tracks[track].contrasts[id]), 'Internal QC comparison checks disagree with its tracks');
  validateAggregate(record.assessment, trackIds.flatMap(track => Object.values(tracks[track].contrasts)), 'Internal QC dataset checks disagree with its tracks');
}

/** Reject stale registry coverage instead of showing a partial dataset-wide pass. */
export function validateInternalQcRecords(value: unknown): InternalQcRecord[] {
  if (!Array.isArray(value)) throw new Error('Missing internal QC records');
  const records = value as InternalQcRecord[];
  const expected = new Map(DATASETS.map((dataset) => [dataset.id, dataset]));
  for (const record of records) {
    const dataset = expected.get(record?.datasetId);
    if (!dataset) throw new Error('Unknown or duplicate internal QC dataset');
    expected.delete(record.datasetId);
    validateAssessment(record.assessment);
    const contrastIds = Object.keys(record.contrasts ?? {});
    if (contrastIds.length !== dataset.contrasts.length || dataset.contrasts.some((contrast) => !contrastIds.includes(contrast.id))) throw new Error('Internal QC contrast coverage disagrees with the registry');
    for (const result of Object.values(record.contrasts)) validateAssessment(result);
    validateAggregate(record.assessment, Object.values(record.contrasts), 'Internal QC dataset checks disagree with its contrasts');
    const trackIds = intakeTracks.get(record.datasetId);
    if (trackIds) validateIntakeTracks(record, contrastIds, trackIds);
  }
  if (expected.size) throw new Error('Internal QC is missing registered datasets');
  return records;
}

if (ledgerSchemaVersion !== 1) throw new Error('Unsupported internal QC ledger schema');
const records = new Map(validateInternalQcRecords(ledgerRecords).map((record) => [record.datasetId, record]));

/** A missing contrast is never allowed to inherit the dataset's passing badge. */
export function getInternalQc(datasetId: string, contrastId?: string): QualityAssessment | undefined {
  const record = records.get(datasetId);
  return contrastId === undefined ? record?.assessment : record?.contrasts[contrastId];
}
