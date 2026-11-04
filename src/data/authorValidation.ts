import validationJson from '../../data/author-validation/validation-records.generated.json';
import { VERIFICATION_STATES, type AuthorVerification } from './authorVerification';
import { validateComparisonReview, type ComparisonReview } from './authorComparability';

export const AUTHOR_VALIDATION_STATUS = {
  author_result_match: {
    label: 'Author result match',
    shortLabel: 'Author result matched',
    tone: '#2F7D4A',
    rank: 0,
  },
  processed_source_match: {
    label: 'Processed source match',
    shortLabel: 'Source matched',
    tone: '#2B6F77',
    rank: 1,
  },
  validated_with_notes: {
    label: 'Validated with notes',
    shortLabel: 'Validated with notes',
    tone: '#B45309',
    rank: 2,
  },
  review_required: {
    label: 'Review required',
    shortLabel: 'Review required',
    tone: '#B42318',
    rank: 3,
  },
  source_unavailable: {
    label: 'Source unavailable',
    shortLabel: 'Source unavailable',
    tone: '#6B7280',
    rank: 4,
  },
  in_progress: {
    label: 'Validation in progress',
    shortLabel: 'In progress',
    tone: '#4C78A8',
    rank: 5,
  },
  not_applicable: {
    label: 'Not in validation scope',
    shortLabel: 'Not applicable',
    tone: '#6B7280',
    rank: 6,
  },
} as const;

export type AuthorValidationStatus = keyof typeof AUTHOR_VALIDATION_STATUS;
export const AUTHOR_VALIDATION_STATUS_KEYS = Object.keys(
  AUTHOR_VALIDATION_STATUS,
) as AuthorValidationStatus[];

export type AuthorComparisonLevel =
  | 'direct'
  | 'reconstructed'
  | 'processed_source'
  | 'unavailable'
  | 'excluded';

export type AuthorSourceComparison =
  | 'checksum_match'
  | 'staging_checksum_match'
  | 'semantic_match'
  | 'manual_structure_match'
  | 'unavailable'
  | 'excluded';

export type AuthorPaperAccess =
  | 'pmc_full_text'
  | 'publisher_full_text'
  | 'pubmed_record_only'
  | 'no_linked_publication';

export interface AuthorValidationMetrics {
  localGenes?: number | null;
  authorGenes?: number | null;
  sharedGenes?: number | null;
  authorCoverage?: number | null;
  localCoverage?: number | null;
  pearsonLogFC?: number | null;
  spearmanLogFC?: number | null;
  medianAbsLogFCDelta?: number | null;
  rootMeanSquareLogFCDelta?: number | null;
  effectScaleRatio?: number | null;
  effectScaleGenes?: number | null;
  signComparableGenes?: number | null;
  signConcordance?: number | null;
  strongEffectGenes?: number | null;
  strongEffectSignConcordance?: number | null;
  authorSignificantGenes?: number | null;
  localSignificantGenes?: number | null;
  significantInBoth?: number | null;
  significantSetJaccard?: number | null;
  authorSignificantSignConcordance?: number | null;
  oppositeDirectionAuthorSignificant?: number | null;
  expressedGeneCount?: number | null;
  expressedPearsonLogFC?: number | null;
  expressedMedianAbsLogFCDelta?: number | null;
  expressedSignConcordance?: number | null;
  [key: string]: number | null | undefined;
}

export interface AuthorValidationDirectComparison {
  /** SHA-256 of the complete generated comparison, including source reference hashes. */
  evidenceFingerprint?: string;
  contrast: string;
  type: 'direct_author_result' | 'reconstructed_author_effect';
  interpretation: string;
  localMethod?: string;
  authorMethod?: string;
  orientation?: string;
  note?: string;
  paperFilterDefinition?: string;
  metrics: AuthorValidationMetrics;
}

export interface AuthorValidationEvidenceLink {
  label: string;
  url: string;
  kind: 'database' | 'processed_data' | 'paper' | 'author_result';
}

export interface AuthorValidationScopedComparison {
  datasetId: string;
  trackId: string;
  contrastId: string;
  configId: string;
  localReference: { path: string; sha256: string; bytes: number };
  comparison: AuthorValidationDirectComparison;
  comparability: ComparisonReview;
}

export interface AuthorPathwayValidationTotals {
  previousRows: number;
  currentRows: number;
  addedRows: number;
  removedRows: number;
  sharedRows: number;
  nonFiniteRowsBefore: number;
  nonFiniteRowsAfter: number;
  nesDirectionChanges: number;
  fdrCallsBefore: number;
  fdrCallsAfter: number;
  fdrCallsGained: number;
  fdrCallsLost: number;
}

export interface MigratedAuthorPathwayValidation {
  state: 'rebuilt_provenance_checked';
  provenanceSchemaVersion: 3;
  baselineKind: 'git_commit' | 'local_snapshot';
  baselineCommit: string | null;
  baselineNote: string;
  contrastCount: number;
  totals: AuthorPathwayValidationTotals;
  provenanceFiles: string[];
}

/** A newly admitted output has no pre-migration result to compare against. */
export interface CurrentAuthorPathwayValidation {
  state: 'current_provenance_checked';
  provenanceSchemaVersion: 3;
  contrastCount: number;
  currentRows: number;
  nonFiniteRows: number;
  provenanceFiles: string[];
  evidencePath: string;
  note: string;
}

export type AuthorPathwayValidation = MigratedAuthorPathwayValidation | CurrentAuthorPathwayValidation;

export interface AuthorValidationRecord {
  datasetId: string;
  accession: string;
  status: AuthorValidationStatus;
  verification: AuthorVerification;
  auditState: 'complete' | 'in_progress' | 'excluded';
  comparisonLevel: AuthorComparisonLevel;
  sourceComparison: AuthorSourceComparison;
  pipelineTrace: 'exact' | 'mismatch' | 'not_applicable';
  pathwayValidation?: AuthorPathwayValidation | null;
  contrastCount: number;
  summary: string;
  note: string;
  reviewFlags: string[];
  database: 'GEO' | 'BioStudies' | 'CNGB';
  databaseRecordUrl: string;
  processedDataAccession: string;
  processedInventoryUrl: string;
  paperAccess: AuthorPaperAccess;
  pubmedUrl: string | null;
  pmcId: string | null;
  pmcUrl: string | null;
  sourceManifest: string | null;
  sourceFileCount: number;
  preprocessingEvidence: string[];
  directComparison: AuthorValidationDirectComparison | null;
  /** Independently measured results for explicit track/contrast pairs. Never reuse the legacy metric block across comparisons. */
  scopedComparisons?: AuthorValidationScopedComparison[];
  evidenceLinks: AuthorValidationEvidenceLink[];
  validatedAt: string;
}

interface AuthorValidationFile {
  schemaVersion: number;
  generatedAt: string;
  scope: {
    registryDatasets: number;
    inScopeDatasets: number;
    excludedDatasetId: string;
    unit: string;
  };
  counts: Partial<Record<AuthorValidationStatus, number>>;
  records: AuthorValidationRecord[];
}

const data = validationJson as unknown as AuthorValidationFile;
const recordIds = data.records.map((record) => record.datasetId);
const uniqueRecordIds = new Set(recordIds);

if (
  data.schemaVersion !== 2
  || data.records.length !== data.scope.registryDatasets
  || uniqueRecordIds.size !== data.scope.registryDatasets
  || !uniqueRecordIds.has(data.scope.excludedDatasetId)
  || data.records.some((record) => !(record.status in AUTHOR_VALIDATION_STATUS))
  || data.records.some((record) => !record.verification || !(record.verification.state in VERIFICATION_STATES))
) {
  throw new Error('[authorValidation] generated validation records do not match the dataset registry');
}
for (const record of data.records) {
  validateComparisonReview(record.verification.comparability);
  if (record.scopedComparisons !== undefined) {
    if (!Array.isArray(record.scopedComparisons) || !record.scopedComparisons.length)
      throw new Error('[authorValidation] scoped comparisons are empty or malformed');
    for (const scoped of record.scopedComparisons) validateComparisonReview(scoped.comparability);
  }
}

const byDatasetId = new Map(data.records.map((record) => [record.datasetId, record]));

export const AUTHOR_VALIDATION_REPORT = data;

export function getAuthorValidation(datasetId: string): AuthorValidationRecord | undefined {
  return byDatasetId.get(datasetId);
}

export function requireAuthorValidation(datasetId: string): AuthorValidationRecord {
  const record = getAuthorValidation(datasetId);
  if (!record) throw new Error(`[authorValidation] no validation record for ${datasetId}`);
  return record;
}

export function authorValidationStatusLabel(status: AuthorValidationStatus): string {
  return AUTHOR_VALIDATION_STATUS[status].label;
}

export function paperAccessLabel(access: AuthorPaperAccess): string {
  if (access === 'pmc_full_text') return 'Full text accessed in PMC';
  if (access === 'publisher_full_text') return 'Publisher full text accessed';
  if (access === 'pubmed_record_only') return 'PubMed record only; full text not accessed';
  return 'No linked publication';
}

export function comparisonLevelLabel(level: AuthorComparisonLevel): string {
  if (level === 'direct') return 'Direct author-result comparison';
  if (level === 'reconstructed') return 'Author effect reconstructed';
  if (level === 'processed_source') return 'Deposited processed-source comparison';
  if (level === 'unavailable') return 'Source unavailable';
  return 'Excluded from scope';
}

export function sourceComparisonLabel(source: AuthorSourceComparison): string {
  if (source === 'checksum_match') return 'Exact checksum match';
  if (source === 'staging_checksum_match') {
    return 'Checksum evidence includes external staging; some source files absent from checkout';
  }
  if (source === 'semantic_match') return 'Content match after text normalization';
  if (source === 'manual_structure_match') return 'Manual structure and contrast review';
  if (source === 'unavailable') return 'Source unavailable';
  return 'Excluded from scope';
}
