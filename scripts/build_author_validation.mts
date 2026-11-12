/**
 * Join the registry, official repository inventory, mechanical output trace,
 * direct author-result comparisons, pathway migration evidence, and human review overrides into the one
 * dataset-id keyed validation sidecar consumed by the library and tracker.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASETS } from '../src/data/datasets';
import SEPTEMBER5_STUDIES from '../src/data/september5Studies.generated.json';
import { assessAuthorVerification, VERIFICATION_CLAIMS, getVerificationClaim, RESULT_AVAILABILITY, type VerificationReview } from '../src/data/authorVerification';
import { COMPARABILITY_DIMENSIONS, type ComparisonReview } from '../src/data/authorComparability';
import { pathwayValidationByDataset } from './lib/authorPathwayValidation.mjs';
import { readCurrentIntakePathwayRecords } from './lib/currentIntakePathwayEvidence.mjs';
import { carriedForwardWarning, missingLocalInputs } from './lib/authorValidationAudit.mjs';
import { readScopedAuthorEvidence } from './lib/scopedAuthorEvidence.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scopedAuthorEvidence = readScopedAuthorEvidence(ROOT);
const EVIDENCE = resolve(ROOT, 'data', 'author-validation');
const OUTPUT = resolve(EVIDENCE, 'validation-records.generated.json');
const TSV_OUTPUT = resolve(EVIDENCE, 'validation-records.generated.tsv');
const MARKDOWN_OUTPUT = resolve(EVIDENCE, 'VALIDATION_REPORT.generated.md');
const OVERRIDES = resolve(EVIDENCE, 'manual-review.json');
const CHECK = process.argv.includes('--check');
const REQUIRE_COMPLETE = process.argv.includes('--require-complete');
const EXCLUDED_DATASET = 'macaque_snrna';
const VALIDATED_AT = '2026-09-03';

type Status =
  | 'author_result_match'
  | 'processed_source_match'
  | 'validated_with_notes'
  | 'review_required'
  | 'source_unavailable'
  | 'in_progress'
  | 'not_applicable';

interface EvidenceLink {
  label: string;
  url: string;
  kind: 'database' | 'processed_data' | 'paper' | 'author_result';
}

interface ManualOverride {
  verification?: VerificationReview;
  reviewedAt?: string;
  pubmedUrl?: string | null;
  pmcId?: string | null;
  pmcUrl?: string | null;
  status?: Status;
  comparisonLevel?: 'direct' | 'reconstructed' | 'processed_source' | 'unavailable' | 'excluded';
  sourceComparison?: 'checksum_match' | 'staging_checksum_match' | 'semantic_match' | 'manual_structure_match' | 'unavailable' | 'excluded';
  auditState?: 'complete' | 'in_progress' | 'excluded';
  summary?: string;
  note?: string;
  reviewFlags?: string[];
  evidenceLinks?: EvidenceLink[];
  paperAccess?: 'pmc_full_text' | 'publisher_full_text' | 'pubmed_record_only' | 'no_linked_publication';
}

interface ManualFile {
  schemaVersion: number;
  records: Record<string, ManualOverride>;
}

interface MechanicalDataset {
  datasetId: string;
  accession: string;
  directory: string | null;
  sourceIntegrity: 'pass' | 'missing_local' | 'mismatch' | 'unmanifested';
  sourceManifest: string | null;
  sourceFiles: Array<{
    sourceUrl: string | null;
    result: 'match' | 'normalized_text_match' | 'mismatch' | 'missing' | 'unverifiable';
  }>;
  bundleIntegrity: 'pass' | 'fail';
  contrasts: Array<{ contrastId: string; result: 'pass' | 'fail' }>;
}

interface InventoryDataset {
  datasetId: string;
  accession: string;
  processedDataAccession: string;
  database: 'GEO' | 'BioStudies' | 'CNGB';
  databaseRecordUrl: string;
  processedInventoryUrl: string;
  processedInventoryAccess: 'listed' | 'empty' | 'unavailable' | 'excluded';
  depositedFiles: Array<{ name: string; url: string }>;
  paperAccess: 'pmc_full_text' | 'pubmed_record_only' | 'no_linked_publication';
  pubmedUrl: string | null;
  pmcId: string | null;
  pmcUrl: string | null;
}

interface DirectComparison {
  datasetId: string;
  accession: string;
  contrast: string;
  comparisonType: 'direct_author_result' | 'reconstructed_author_effect';
  interpretation: string;
  localMethod: string;
  authorMethod: string;
  orientation: string;
  paperFilterDefinition?: string;
  metrics: Record<string, number | null>;
  references: Array<{ sourceUrl: string }>;
  note: string;
}

const mechanical = JSON.parse(readFileSync(resolve(EVIDENCE, 'mechanical-audit.generated.json'), 'utf8')) as {
  datasets: MechanicalDataset[];
};
const inventory = JSON.parse(readFileSync(resolve(EVIDENCE, 'source-inventory.generated.json'), 'utf8')) as {
  datasets: InventoryDataset[];
};
const direct = JSON.parse(readFileSync(resolve(EVIDENCE, 'direct-comparisons.generated.json'), 'utf8')) as {
  comparisons: DirectComparison[];
};
const pathwayById = pathwayValidationByDataset(
  JSON.parse(readFileSync(resolve(EVIDENCE, 'fgsea-migration.generated.json'), 'utf8')),
  DATASETS,
  EXCLUDED_DATASET,
  readCurrentIntakePathwayRecords(ROOT, DATASETS),
);
const manual: ManualFile = existsSync(OVERRIDES)
  ? JSON.parse(readFileSync(OVERRIDES, 'utf8')) as ManualFile
  : { schemaVersion: 1, records: {} };
const verificationReviews = JSON.parse(readFileSync(resolve(EVIDENCE, 'verification-review.json'), 'utf8')) as {
  schemaVersion: number; records: Record<string, VerificationReview>;
};
if (verificationReviews.schemaVersion !== 1) throw new Error('Unsupported verification review schema');
const comparabilityPath = resolve(EVIDENCE, 'comparability-review.json');
const comparabilityReviews = JSON.parse(readFileSync(comparabilityPath, 'utf8')) as {
  schemaVersion: number; records: Record<string, ComparisonReview>;
};
if (comparabilityReviews.schemaVersion !== 1) throw new Error('Unsupported comparability review schema');
for (const datasetId of Object.keys(comparabilityReviews.records)) {
  if (!DATASETS.some((dataset) => dataset.id === datasetId)) throw new Error(`Unknown comparability review: ${datasetId}`);
}
for (const [datasetId, review] of Object.entries(verificationReviews.records)) {
  if (!DATASETS.some((dataset) => dataset.id === datasetId)) throw new Error(`Unknown verification review: ${datasetId}`);
  manual.records[datasetId] = { ...manual.records[datasetId], verification: review };
}

const mechanicalById = new Map(mechanical.datasets.map((record) => [record.datasetId, record]));
const inventoryById = new Map(inventory.datasets.map((record) => [record.datasetId, record]));
const directById = new Map(direct.comparisons.map((record) => [record.datasetId, record]));

// These large inputs deliberately live in the workspace staging area rather
// than the repository. Their exact bytes and SHA-256 values were rechecked
// against the committed manifests on 2026-09-03; see the validation report.
const STAGING_CHECKSUM_VERIFIED = new Set([
  'mouse_hypo_spatial_aging_gse270383',
  'mouse_hypo_spatial_cr_gse273038',
  'mouse_hypo_akkermansia_gse212491',
  'mouse_vmh_sf1_sex_gse143818',
  'mouse_lha_hfd_gse130597',
  'mouse_pvn_crh_ela_gse174085',
  'mouse_arc_mettl14_gse289461',
  'mouse_hypo_fasting_gse87544',
]);

/** Committed preprocessing evidence for a dataset whose local inputs are incomplete on this machine. */
function committedPreprocessingEvidence(datasetId: string): string[] {
  if (!existsSync(OUTPUT)) {
    throw new Error(`${datasetId}: local inputs are incomplete and ${relative(ROOT, OUTPUT)} has no committed record to carry forward`);
  }
  const committed = JSON.parse(readFileSync(OUTPUT, 'utf8')) as {
    records: Array<{ datasetId: string; preprocessingEvidence: string[] }>;
  };
  const record = committed.records.find((entry) => entry.datasetId === datasetId);
  if (!record) throw new Error(`${datasetId}: no committed validation record to carry forward`);
  return record.preprocessingEvidence;
}

function preprocessingEvidence(record: MechanicalDataset): string[] {
  const missing = missingLocalInputs(ROOT, record.datasetId);
  if (missing.length) {
    process.stderr.write(carriedForwardWarning(record.datasetId, 'build_author_validation.mts', missing, relative(ROOT, OUTPUT).replaceAll('\\', '/')));
    return committedPreprocessingEvidence(record.datasetId);
  }
  if (!record.directory) return [];
  const processed = resolve(ROOT, record.directory, 'processed');
  if (!existsSync(processed)) return [];
  return readdirSync(processed)
    .filter((name) => /(?:preprocessing|analysis|preflight|validation)_.*\.tsv$|_(?:preprocessing_qc|analysis_qc|preflight|validation_summary)\.tsv$/i.test(name))
    .sort();
}

function directStatus(comparison: DirectComparison): Pick<ManualOverride, 'status' | 'comparisonLevel' | 'summary' | 'note' | 'reviewFlags'> {
  if (comparison.interpretation === 'effect_and_direction_match') {
    return {
      status: 'author_result_match', comparisonLevel: 'direct',
      summary: 'Author result matched', note: comparison.note, reviewFlags: [],
    };
  }
  if (comparison.interpretation === 'reconstructed_effect_match') {
    return {
      status: 'validated_with_notes', comparisonLevel: 'reconstructed',
      summary: 'Author effect reconstructed and matched', note: comparison.note,
      reviewFlags: ['Author p-values and FDR cannot be reconstructed from adjacent contrasts.'],
    };
  }
  if (comparison.interpretation === 'rank_direction_match_magnitude_review') {
    return {
      status: 'review_required', comparisonLevel: 'direct',
      summary: 'Author result differences need review', note: comparison.note,
      reviewFlags: ['Author/local effect or inference differences remain unresolved; see the comparison evidence for the cause and scope.'],
    };
  }
  return {
    status: 'validated_with_notes', comparisonLevel: 'direct',
    summary: 'Author effect matched; inferential results differ by method', note: comparison.note,
    reviewFlags: ['Author and local p/FDR calls use different statistical models.'],
  };
}

function sourceDefault(record: MechanicalDataset): ManualOverride {
  if (record.sourceIntegrity === 'pass') {
    const normalized = record.sourceFiles.some((file) => file.result === 'normalized_text_match');
    return {
      status: normalized ? 'validated_with_notes' : 'processed_source_match',
      comparisonLevel: 'processed_source',
      sourceComparison: normalized ? 'semantic_match' : 'checksum_match',
      auditState: 'complete',
      summary: normalized ? 'Processed source matched after line-ending normalization' : 'Processed source verified',
      note: normalized
        ? 'The checked-out text uses normalized line endings; normalized content matches the author-deposited bytes.'
        : 'Author-deposited processed inputs match their pinned local files by byte count and SHA-256.',
      reviewFlags: [],
    };
  }
  if (record.sourceIntegrity === 'missing_local' && STAGING_CHECKSUM_VERIFIED.has(record.datasetId)) {
    return {
      status: 'processed_source_match', comparisonLevel: 'processed_source', sourceComparison: 'staging_checksum_match',
      auditState: 'complete', summary: 'Processed source verified in workspace staging',
      note: 'The large author-deposited inputs are intentionally outside the repository checkout; every staged file matches the committed byte count and SHA-256.',
      reviewFlags: [],
    };
  }
  if (record.sourceIntegrity === 'mismatch') {
    return {
      status: 'review_required', comparisonLevel: 'processed_source', sourceComparison: 'manual_structure_match',
      auditState: 'complete', summary: 'Source provenance mismatch needs review',
      note: 'One or more pinned source artifacts differ from the checked-out file.',
      reviewFlags: ['Pinned source checksum mismatch.'],
    };
  }
  return {
    status: 'in_progress', comparisonLevel: 'processed_source', sourceComparison: 'manual_structure_match',
    auditState: 'in_progress', summary: 'Author-source comparison in progress',
    note: 'The deposited source is public, but this legacy dataset has no committed checksum manifest. Manual source/contrast review is required.',
    reviewFlags: [],
  };
}

function mergeOverride(base: ManualOverride, override: ManualOverride): ManualOverride {
  return {
    ...base,
    ...override,
    reviewFlags: override.reviewFlags ?? base.reviewFlags ?? [],
    evidenceLinks: [...(base.evidenceLinks ?? []), ...(override.evidenceLinks ?? [])],
  };
}

const records = DATASETS.map((dataset) => {
  const inv = inventoryById.get(dataset.id);
  if (!inv) throw new Error(`${dataset.id}: missing official-source inventory`);
  if (dataset.id === EXCLUDED_DATASET) {
    return {
      datasetId: dataset.id,
      verification: assessAuthorVerification({ status: 'not_applicable', comparisonLevel: 'excluded', sourceComparison: 'excluded', pipelineTrace: 'not_applicable', contrastIds: [], reviewFlags: [] }),
      accession: dataset.geo ?? '',
      status: 'not_applicable' as Status,
      auditState: 'excluded' as const,
      comparisonLevel: 'excluded' as const,
      sourceComparison: 'excluded' as const,
      pipelineTrace: 'not_applicable' as const,
      pathwayValidation: null,
      contrastCount: dataset.contrasts.length,
      summary: 'Excluded by validation scope',
      note: 'The macaque single-cell atlas was explicitly excluded from this validation goal.',
      reviewFlags: [],
      database: inv.database,
      databaseRecordUrl: inv.databaseRecordUrl,
      processedDataAccession: inv.processedDataAccession,
      processedInventoryUrl: inv.processedInventoryUrl,
      paperAccess: inv.paperAccess,
      pubmedUrl: inv.pubmedUrl,
      pmcId: inv.pmcId,
      pmcUrl: inv.pmcUrl,
      sourceManifest: null,
      sourceFileCount: 0,
      preprocessingEvidence: [],
      directComparison: null,
      evidenceLinks: [{ label: 'CNGB record', url: inv.databaseRecordUrl, kind: 'database' as const }],
      validatedAt: VALIDATED_AT,
    };
  }

  const mech = mechanicalById.get(dataset.id);
  if (!mech) throw new Error(`${dataset.id}: missing mechanical audit`);
  // Historical comparisons and manual sign-offs cannot override current source evidence.
  if (mech.sourceIntegrity === 'mismatch' || mech.sourceFiles.some((file) => file.result === 'mismatch')) {
    throw new Error(`${dataset.id}: pinned source checksum mismatch; validation output is blocked until source provenance is reconciled`);
  }
  const comparison = directById.get(dataset.id) ?? null;
  let assessment = sourceDefault(mech);
  if (comparison) assessment = mergeOverride(assessment, directStatus(comparison));
  assessment = mergeOverride(assessment, manual.records[dataset.id] ?? {});
  if (['direct', 'reconstructed'].includes(assessment.comparisonLevel ?? '')
    && !Object.keys(comparabilityReviews.records).includes(dataset.id)) {
    throw new Error(`${dataset.id}: missing explicit author-result comparability review`);
  }
  // A manual scientific assessment may refine status/notes, but it must not
  // turn an external-staging verification into an in-checkout byte match.
  if (mech.sourceIntegrity === 'missing_local' && STAGING_CHECKSUM_VERIFIED.has(dataset.id)) {
    assessment.sourceComparison = 'staging_checksum_match';
  }
  const links: EvidenceLink[] = [
    { label: `${inv.database} record`, url: inv.databaseRecordUrl, kind: 'database' },
    { label: 'Deposited files', url: inv.processedInventoryUrl, kind: 'processed_data' },
  ];
  const pmcUrl = assessment.pmcUrl ?? inv.pmcUrl;
  const pubmedUrl = assessment.pubmedUrl ?? inv.pubmedUrl;
  const paperUrl = pmcUrl ?? pubmedUrl;
  if (paperUrl) links.push({
    label: pmcUrl ? 'Open full text' : 'PubMed record',
    url: paperUrl,
    kind: 'paper',
  });
  for (const ref of comparison?.references ?? []) {
    // Local DE snapshots and extraction scripts are evidence paths, not web links.
    if (URL.canParse(ref.sourceUrl) && ['http:', 'https:'].includes(new URL(ref.sourceUrl).protocol)) {
      links.push({ label: 'Author result file', url: ref.sourceUrl, kind: 'author_result' });
    }
  }
  links.push(...(assessment.evidenceLinks ?? []));
  const uniqueLinks = links.filter((link, index, all) =>
    all.findIndex((other) => other.url === link.url && other.kind === link.kind) === index);
  const pipelineTrace = mech.bundleIntegrity === 'pass' && mech.contrasts.every((contrast) => contrast.result === 'pass')
    ? 'exact' as const : 'mismatch' as const;
  return {
    datasetId: dataset.id,
    accession: dataset.geo ?? '',
    status: assessment.status!,
    verification: assessAuthorVerification({
      status: assessment.status!, comparisonLevel: assessment.comparisonLevel!,
      sourceComparison: assessment.sourceComparison!, pipelineTrace,
      contrastIds: dataset.contrasts.map((contrast) => contrast.id),
      reviewFlags: assessment.reviewFlags ?? [], review: assessment.verification,
      comparability: comparabilityReviews.records[dataset.id],
    }),
    auditState: assessment.auditState ?? 'complete',
    comparisonLevel: assessment.comparisonLevel!,
    sourceComparison: assessment.sourceComparison!,
    pipelineTrace,
    pathwayValidation: pathwayById.get(dataset.id)!,
    contrastCount: dataset.contrasts.length,
    summary: assessment.summary!,
    note: assessment.note!,
    reviewFlags: assessment.reviewFlags ?? [],
    database: inv.database,
    databaseRecordUrl: inv.databaseRecordUrl,
    processedDataAccession: inv.processedDataAccession,
    processedInventoryUrl: inv.processedInventoryUrl,
    paperAccess: assessment.paperAccess ?? inv.paperAccess,
    pubmedUrl,
    pmcId: assessment.pmcId ?? inv.pmcId,
    pmcUrl,
    sourceManifest: mech.sourceManifest,
    sourceFileCount: mech.sourceFiles.length || inv.depositedFiles.length,
    preprocessingEvidence: preprocessingEvidence(mech),
    directComparison: comparison ? {
      evidenceFingerprint: createHash('sha256').update(JSON.stringify(comparison)).digest('hex'),
      contrast: comparison.contrast,
      type: comparison.comparisonType,
      interpretation: comparison.interpretation,
      localMethod: comparison.localMethod,
      authorMethod: comparison.authorMethod,
      orientation: comparison.orientation,
      note: comparison.note,
      ...(comparison.paperFilterDefinition ? { paperFilterDefinition: comparison.paperFilterDefinition } : {}),
      metrics: comparison.metrics,
    } : null,
    ...(scopedAuthorEvidence.has(dataset.id) ? {scopedComparisons: scopedAuthorEvidence.get(dataset.id)!} : {}),
    evidenceLinks: uniqueLinks,
    validatedAt: assessment.reviewedAt ?? (SEPTEMBER5_STUDIES.some((study) => study.id === dataset.id) ? '2026-09-05' : VALIDATED_AT),
  };
});

const ids = records.map((record) => record.datasetId);
if (new Set(ids).size !== DATASETS.length || DATASETS.some((dataset) => !ids.includes(dataset.id))) {
  throw new Error('validation sidecar does not have exact registry closure');
}
for (const key of Object.keys(manual.records)) {
  if (!DATASETS.some((dataset) => dataset.id === key)) throw new Error(`unknown manual validation override: ${key}`);
}
if (records.some((record) => record.pipelineTrace === 'mismatch')) {
  throw new Error('a published contrast no longer traces exactly to its committed DE table');
}
const incomplete = records.filter((record) => record.status === 'in_progress' || record.auditState === 'in_progress');
const scientificPending = records.filter((record) => record.verification.state === 'in_progress');
if (REQUIRE_COMPLETE && incomplete.length) {
  throw new Error(`${incomplete.length} dataset validation review(s) are still in progress: ${incomplete.map(record => record.datasetId).join(', ')}`);
}

const counts = records.reduce<Record<string, number>>((out, record) => {
  out[record.status] = (out[record.status] ?? 0) + 1;
  return out;
}, {});
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  scope: {
    registryDatasets: DATASETS.length,
    inScopeDatasets: DATASETS.length - 1,
    excludedDatasetId: EXCLUDED_DATASET,
    unit: 'dataset x registered contrast',
  },
  counts,
  records,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
const tsvCell = (value: unknown) => String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
const tsvHeaders = [
  'verification_claim', 'comparability', 'comparison_target', 'comparison_result_scope', 'reviewed_contrast_ids', 'comparison_basis', 'author_reference', 'agreement_criteria',
  ...Object.keys(COMPARABILITY_DIMENSIONS).flatMap((key) => [`${key}_comparability`, `${key}_comparison_note`]),
  'verification_state', 'evidence_level', 'author_result_availability', 'comparison_outcome', 'verification_reason', 'verification_next_step', 'fully_verified_contrasts', 'reviewed_at',
  'dataset_id', 'accession', 'status', 'summary', 'comparison_level', 'source_comparison',
  'pipeline_trace', 'contrast_count', 'paper_access', 'processed_data_accession',
  'pathway_validation', 'pathway_contrast_count', 'pathway_provenance_schema',
  'pathway_baseline_kind', 'pathway_baseline_commit', 'pathway_baseline_note',
  'pathway_rows_before', 'pathway_rows_after', 'pathway_rows_added', 'pathway_rows_removed',
  'pathway_rows_shared', 'pathway_nonfinite_rows_before', 'pathway_nonfinite_rows_after',
  'pathway_nes_direction_changes', 'pathway_fdr_calls_before',
  'pathway_fdr_calls_after', 'pathway_fdr_calls_gained', 'pathway_fdr_calls_lost', 'pathway_provenance_files',
  'source_file_count', 'direct_contrast', 'pearson_logfc', 'spearman_logfc',
  'strong_effect_sign_concordance', 'author_significant_genes', 'local_significant_genes',
  'significant_in_both', 'significant_set_jaccard', 'review_flags', 'note',
  'database_record_url', 'processed_inventory_url', 'paper_url', 'comparison_conclusion',
];
const tsvRows = records.map((record) => {
  const comparisonMetrics = record.directComparison?.metrics;
  const pathway = record.pathwayValidation;
  const migration = pathway?.state === 'rebuilt_provenance_checked' ? pathway : null;
  const publisherPaperUrl = record.paperAccess === 'publisher_full_text'
    ? record.evidenceLinks.find((link) => link.kind === 'paper' && link.url !== record.pubmedUrl)?.url
    : null;
  return [
    getVerificationClaim(record.verification), record.verification.comparability.assessment,
    record.verification.comparability.target, record.verification.comparability.resultScope,
    record.verification.comparability.registeredContrastIds.join(' | '),
    record.verification.comparability.basis, record.verification.comparability.reference,
    record.verification.comparability.criteria,
    ...Object.keys(COMPARABILITY_DIMENSIONS).flatMap((key) => {
      const dimension = record.verification.comparability.dimensions[key as keyof typeof COMPARABILITY_DIMENSIONS];
      return [dimension.status, dimension.note];
    }),
    record.verification.state, record.verification.evidenceLevel, record.verification.resultAvailability,
    record.verification.comparisonOutcome, record.verification.reason, record.verification.nextStep,
    record.verification.fullyVerifiedContrasts.join(' | '), record.validatedAt,
    record.datasetId, record.accession, record.status, record.summary, record.comparisonLevel,
    record.sourceComparison, record.pipelineTrace, record.contrastCount, record.paperAccess,
    record.processedDataAccession, pathway?.state, pathway?.contrastCount,
    pathway?.provenanceSchemaVersion, migration?.baselineKind, migration?.baselineCommit, migration?.baselineNote,
    migration?.totals.previousRows, migration?.totals.currentRows ?? (pathway?.state === 'current_provenance_checked' ? pathway.currentRows : null), migration?.totals.addedRows,
    migration?.totals.removedRows, migration?.totals.sharedRows,
    migration?.totals.nonFiniteRowsBefore, migration?.totals.nonFiniteRowsAfter ?? (pathway?.state === 'current_provenance_checked' ? pathway.nonFiniteRows : null), migration?.totals.nesDirectionChanges,
    migration?.totals.fdrCallsBefore, migration?.totals.fdrCallsAfter,
    migration?.totals.fdrCallsGained, migration?.totals.fdrCallsLost, pathway?.provenanceFiles.join(' | '),
    record.sourceFileCount, record.directComparison?.contrast,
    comparisonMetrics?.pearsonLogFC, comparisonMetrics?.spearmanLogFC,
    comparisonMetrics?.strongEffectSignConcordance, comparisonMetrics?.authorSignificantGenes,
    comparisonMetrics?.localSignificantGenes, comparisonMetrics?.significantInBoth,
    comparisonMetrics?.significantSetJaccard, record.reviewFlags.join(' | '), record.note,
    record.databaseRecordUrl, record.processedInventoryUrl,
    publisherPaperUrl ?? record.pmcUrl ?? record.pubmedUrl,
    record.verification.comparability.conclusion,
  ].map(tsvCell).join('\t');
});
const tsvSerialized = `${[tsvHeaders.join('\t'), ...tsvRows].join('\n')}\n`;
const mdCell = (value: unknown) => tsvCell(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
const mdNumber = (value: number | null | undefined, digits = 4) => (
  value == null ? 'n/a' : value.toFixed(digits)
);
const mdPercent = (value: number | null | undefined) => (
  value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`
);
const statusOrder: Status[] = [
  'author_result_match', 'processed_source_match', 'validated_with_notes',
  'review_required', 'source_unavailable', 'in_progress', 'not_applicable',
];
const statusNames: Record<Status, string> = {
  author_result_match: 'Author result match',
  processed_source_match: 'Processed source match',
  validated_with_notes: 'Validated with notes',
  review_required: 'Review required',
  source_unavailable: 'Source unavailable',
  in_progress: 'In progress',
  not_applicable: 'Not applicable',
};
const paperCounts = records
  .filter((record) => record.status !== 'not_applicable')
  .reduce<Record<string, number>>((out, record) => {
    out[record.paperAccess] = (out[record.paperAccess] ?? 0) + 1;
    return out;
  }, {});
const comparisonCounts = records.reduce<Record<string, number>>((out, record) => {
  out[record.comparisonLevel] = (out[record.comparisonLevel] ?? 0) + 1;
  return out;
}, {});
const sourceComparisonCounts = records.reduce<Record<string, number>>((out, record) => {
  out[record.sourceComparison] = (out[record.sourceComparison] ?? 0) + 1;
  return out;
}, {});
const directRecords = records.filter((record) => record.directComparison != null);
const pathwayRecords = records.flatMap(record => record.pathwayValidation?.state === 'rebuilt_provenance_checked'
  ? [{ record, pathway: record.pathwayValidation }] : []);
const currentPathwayRecords = records.flatMap(record => record.pathwayValidation?.state === 'current_provenance_checked'
  ? [{ record, pathway: record.pathwayValidation }] : []);
const gitBaselineRecords = pathwayRecords.filter(({ pathway }) => pathway.baselineKind === 'git_commit');
const snapshotBaselineRecords = pathwayRecords.filter(({ pathway }) => pathway.baselineKind === 'local_snapshot');
const pathwayContrastTotal = pathwayRecords.reduce((sum, { pathway }) => sum + pathway.contrastCount, 0);
const pathwayUntestableRows = pathwayRecords.reduce((sum, { pathway }) => sum + pathway.totals.nonFiniteRowsAfter, 0);
const pathwayUntestableDatasets = pathwayRecords.filter(({ pathway }) => pathway.totals.nonFiniteRowsAfter > 0).length;
const contrastTotal = records
  .filter((record) => record.status !== 'not_applicable')
  .reduce((sum, record) => sum + record.contrastCount, 0);
const reviewRecords = records.filter((record) =>
  record.status === 'review_required' || record.status === 'source_unavailable' || record.status === 'in_progress');
const markdown = [
  '# Author-source validation report',
  '',
  `Scope: ${report.scope.inScopeDatasets} datasets and ${contrastTotal} registered contrasts; \`${report.scope.excludedDatasetId}\` is explicitly excluded. Each ledger row carries its own review date. Completion of recorded audit checks does not imply full scientific verification.`,
  '',
  '## Scientific verification',
  '',
  'These are detailed author-reproduction classifications, retained separately from the primary internal-QC and author-concordance badges. See `../quality/QUALITY_REPORT.generated.md` and `../quality/assessments.generated.json` for the current processing-quality decisions and individual checklists.',
  '',
  '| Evidence claim | Datasets |',
  '|---|---:|',
  ...Object.entries(VERIFICATION_CLAIMS).map(([key, meta]) => `| ${meta.label} | ${records.filter((record) => getVerificationClaim(record.verification) === key).length} |`),
  '',
  '| Author-result availability | Datasets |',
  '|---|---:|',
  ...Object.entries(RESULT_AVAILABILITY).map(([key, meta]) => `| ${meta.label} | ${records.filter((record) => record.verification.resultAvailability === key).length} |`),
  '',
  'Full verification requires explicit contrast-level sign-off, byte/content source evidence, exact output trace, and comparable author results with no unresolved cohort, effect, statistical, or coverage limitations. A high correlation, a selected gene, a source checksum, or a completed checklist is insufficient. Unreviewed availability is not recorded as unavailable data. Unavailable data is not recorded as a mismatch. See the application Data verification workflow page and the per-dataset reasons/next steps in the TSV.',
  '',
  'Comparability is documented separately for samples/replication, biological contrast, gene identifiers and tested universe, effect definition, statistical inference, and reference coverage. These are mandatory scientific requirements, not weighted points. Every record identifies the result being checked, author reference, criteria, limitations and conclusion. A separate author-method reconstruction does not verify the registered Explorer output by inheritance. Missing author P/FDR values are unassessed, not nonsignificant; selected tables and empty significant sets do not establish full-universe agreement.',
  '',
  'The status levels are intentionally not interchangeable. `Processed source match` means the local processed input matches the author-deposited source. `Author result match` requires a direct comparison with an author result table. `Pipeline output trace` independently verifies that each published bundle row came from the committed local analysis table.',
  '',
  'Downloaded manuscripts, supplementary workbooks, and author notebooks used in continued manual review are byte-pinned in `continued-sources/README.md`.',
  '',
  '## Status counts',
  '',
  '| Status | Datasets |',
  '|---|---:|',
  ...statusOrder.map((status) => `| ${statusNames[status]} | ${counts[status] ?? 0} |`),
  '',
  '## Paper access',
  '',
  '| Access state | Datasets |',
  '|---|---:|',
  `| PMC full text accessed | ${paperCounts.pmc_full_text ?? 0} |`,
  `| Publisher full text accessed | ${paperCounts.publisher_full_text ?? 0} |`,
  `| PubMed record only; full text not accessed | ${paperCounts.pubmed_record_only ?? 0} |`,
  `| No linked publication | ${paperCounts.no_linked_publication ?? 0} |`,
  `| Excluded from validation scope | ${records.filter((record) => record.status === 'not_applicable').length} |`,
  '',
  '## Evidence level',
  '',
  '| Highest comparison completed | Datasets |',
  '|---|---:|',
  `| Direct author-result comparison | ${comparisonCounts.direct ?? 0} |`,
  `| Reconstructed author effect | ${comparisonCounts.reconstructed ?? 0} |`,
  `| Deposited processed-source comparison | ${comparisonCounts.processed_source ?? 0} |`,
  `| Excluded from scope | ${comparisonCounts.excluded ?? 0} |`,
  '',
  '## Processed-source evidence',
  '',
  '| Source comparison | Datasets |',
  '|---|---:|',
  `| Exact checksum match | ${sourceComparisonCounts.checksum_match ?? 0} |`,
  `| Checksum evidence includes external staging (one or more source files absent from checkout) | ${sourceComparisonCounts.staging_checksum_match ?? 0} |`,
  `| Content match after text normalization | ${sourceComparisonCounts.semantic_match ?? 0} |`,
  `| Manual structure and contrast review | ${sourceComparisonCounts.manual_structure_match ?? 0} |`,
  `| Source unavailable | ${sourceComparisonCounts.unavailable ?? 0} |`,
  `| Excluded from scope | ${sourceComparisonCounts.excluded ?? 0} |`,
  '',
  '## Pathway rebuild and provenance checks',
  '',
  `Cache-isolated FGSEA outputs were rebuilt and schema-3 provenance/checksums verified for ${pathwayRecords.length} datasets and ${pathwayContrastTotal} registered contrasts. The changes below compare with pre-audit local outputs; they are not author-result comparisons and do not change the validation statuses above.`,
  '',
  `${gitBaselineRecords.length} datasets use Git baseline commit \`${gitBaselineRecords[0]?.pathway.baselineCommit ?? 'unavailable'}\`. ${snapshotBaselineRecords.length} dataset(s) use a hash-pinned pre-migration local snapshot because no committed baseline exists.`,
  '',
  ...snapshotBaselineRecords.map(({ record, pathway }) =>
    `- [${mdCell(record.accession || record.datasetId)}](${record.databaseRecordUrl}): ${mdCell(pathway.baselineNote)}`),
  '',
  'Counts aggregate raw pathway result rows across each dataset\'s registered contrasts and collections. FDR calls use adjusted p-value < 0.05; gained/lost calls compare the complete old/new sets, including added or removed rows.',
  '',
  `${pathwayUntestableRows} current raw pathway rows across ${pathwayUntestableDatasets} datasets are untestable because FGSEA statistics are missing. These rows are omitted from displayed tables; missing values are not zeros.`,
  '',
  '| Dataset | Contrasts | Rows before/after | Rows added/removed | Untestable rows before/after | Shared-row NES sign changes | FDR calls before/after | FDR calls gained/lost |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
  ...pathwayRecords.map(({ record, pathway }) => {
    const totals = pathway.totals;
    return `| [${mdCell(record.accession || record.datasetId)}](${record.databaseRecordUrl}) | ${pathway.contrastCount} | ${totals.previousRows}/${totals.currentRows} | ${totals.addedRows}/${totals.removedRows} | ${totals.nonFiniteRowsBefore}/${totals.nonFiniteRowsAfter} | ${totals.nesDirectionChanges} | ${totals.fdrCallsBefore}/${totals.fdrCallsAfter} | ${totals.fdrCallsGained}/${totals.fdrCallsLost} |`;
  }),
  '',
  'Full per-contrast/collection changes and checksum-backed provenance are recorded in `fgsea-migration.generated.json`, `fgsea-migration.generated.tsv`, and `FGSEA_MIGRATION_REPORT.generated.md`.',
  '',
  ...(currentPathwayRecords.length ? [
    '## Current pathway provenance for new intake',
    '',
    'Newly admitted analyses have no pre-migration baseline. Their current schema-3 provenance and output hashes are checked against the dedicated source-bound intake audit. These records establish current output trace; they do not measure a migration change or author pathway-result agreement.',
    '',
    '| Dataset | Contrasts | Current raw rows | Untestable rows | Evidence |',
    '|---|---:|---:|---:|---|',
    ...currentPathwayRecords.map(({ record, pathway }) => `| [${mdCell(record.accession || record.datasetId)}](${record.databaseRecordUrl}) | ${pathway.contrastCount} | ${pathway.currentRows} | ${pathway.nonFiniteRows} | \`${pathway.evidencePath}\` |`),
    '',
  ] : []),
  '## Direct author-result comparisons',
  '',
  '| Dataset | Status | Contrast | Shared genes | Pearson logFC | Spearman logFC | Direction agreement | Author/local calls | Jaccard |',
  '|---|---|---|---:|---:|---:|---:|---:|---:|',
  ...directRecords.map((record) => {
    const comparison = record.directComparison!;
    const metrics = comparison.metrics;
    const sharedGenes = metrics.expressedGeneCount == null
      ? (metrics.sharedGenes?.toLocaleString() ?? 'n/a')
      : `${metrics.sharedGenes?.toLocaleString() ?? 'n/a'} all; ${metrics.expressedGeneCount.toLocaleString()} expressed`;
    const pearson = metrics.expressedPearsonLogFC == null
      ? mdNumber(metrics.pearsonLogFC)
      : `${mdNumber(metrics.pearsonLogFC)} all; ${mdNumber(metrics.expressedPearsonLogFC)} expressed`;
    const hasPaperFilter = metrics.paperFilteredAuthorGenes != null && metrics.paperFilteredLocalGenes != null;
    const calls = hasPaperFilter
      ? `${metrics.paperFilteredAuthorGenes}/${metrics.paperFilteredLocalGenes} (paper rule)`
      : metrics.authorSignificantGenes == null || metrics.localSignificantGenes == null
        ? 'n/a'
        : `${metrics.authorSignificantGenes}/${metrics.localSignificantGenes}`;
    const directionAgreement = hasPaperFilter
      ? metrics.paperFilteredDirectionConcordance
      : metrics.strongEffectSignConcordance ?? metrics.authorSignificantSignConcordance;
    const callJaccard = hasPaperFilter
      ? metrics.paperFilteredSetJaccard
      : metrics.significantSetJaccard;
    return `| [${mdCell(record.accession || record.datasetId)}](${record.databaseRecordUrl}) | ${statusNames[record.status]} | ${mdCell(comparison.contrast)} | ${sharedGenes} | ${pearson} | ${mdNumber(metrics.spearmanLogFC)} | ${mdPercent(directionAgreement)} | ${calls} | ${mdNumber(callJaccard)} |`;
  }),
  ...(directRecords.length ? [] : ['| None | | | | | | | | |']),
  '',
  '## Differences requiring review or unavailable evidence',
  '',
  '| Dataset | State | Difference or access limitation |',
  '|---|---|---|',
  ...reviewRecords.map((record) => {
    const detail = [...record.reviewFlags, record.note].filter(Boolean).join(' ');
    return `| [${mdCell(record.accession || record.datasetId)}](${record.databaseRecordUrl}) | ${statusNames[record.status]} | ${mdCell(detail)} |`;
  }),
  ...(reviewRecords.length ? [] : ['| None | | |']),
  '',
  '## Scientific reviews still underway',
  '',
  'These are unfinished comparisons, not failed comparisons or evidence of absent data. Follow the listed reference and next step before granting a result-verification decision.',
  '',
  '| Dataset | Author-result availability | Next step |',
  '|---|---|---|',
  ...scientificPending.map((record) => `| [${mdCell(record.accession || record.datasetId)}](${record.databaseRecordUrl}) | ${RESULT_AVAILABILITY[record.verification.resultAvailability].label} | ${mdCell(record.verification.nextStep)} |`),
  ...(scientificPending.length ? [] : ['| None | | |']),
  '',
  'The complete one-row-per-dataset ledger is in `validation-records.generated.tsv`; structured UI data and evidence links are in `validation-records.generated.json`. Direct comparison details are in `direct-comparisons.generated.tsv` and `direct-comparisons.generated.json`.',
  '',
].join('\n');

const unresolvedReviewCount = records.filter((record) => record.verification.state === 'unresolved').length;

if (CHECK) {
  if (!existsSync(OUTPUT)) throw new Error('validation records are missing');
  if (!existsSync(TSV_OUTPUT)) throw new Error('validation TSV is missing');
  if (!existsSync(MARKDOWN_OUTPUT)) throw new Error('validation Markdown report is missing');
  const current = JSON.parse(readFileSync(OUTPUT, 'utf8')) as typeof report;
  const comparable = { ...report, generatedAt: current.generatedAt };
  if (`${JSON.stringify(comparable, null, 2)}\n` !== readFileSync(OUTPUT, 'utf8')) {
    throw new Error('validation records are stale');
  }
  if (tsvSerialized !== readFileSync(TSV_OUTPUT, 'utf8')) throw new Error('validation TSV is stale');
  if (markdown !== readFileSync(MARKDOWN_OUTPUT, 'utf8')) throw new Error('validation Markdown report is stale');
  process.stdout.write(`author-validation sidecar is current: ${records.length} datasets, ${incomplete.length} audit checks in progress, ${scientificPending.length} incomplete reviews, ${unresolvedReviewCount} unresolved reviews\n`);
} else {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, serialized);
  writeFileSync(TSV_OUTPUT, tsvSerialized);
  writeFileSync(MARKDOWN_OUTPUT, markdown);
  process.stdout.write(`wrote author-validation sidecar: ${records.length} datasets, ${incomplete.length} audit checks in progress, ${scientificPending.length} incomplete reviews, ${unresolvedReviewCount} unresolved reviews\n`);
}
