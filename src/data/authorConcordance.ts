import type { ComparisonReview } from './authorComparability';
import type { AuthorValidationRecord } from './authorValidation';
import { getDataset } from './datasets';
import { aggregateQualityChecks, type QualityAssessment, type QualityCheck, type QualityStatus } from './qualityChecks';
import effectDefinitionReviews from '../../data/author-validation/concordance-reviews.json';
import intakeStudies from '../../data/intake/september5-2026/studies.json';

/** Project acceptance defaults for biological-effect agreement, not universal scientific cutoffs. */
export const AUTHOR_CONCORDANCE_POLICY = {
  version: 'author-concordance-v2',
  minimumSharedGenes: 30,
  minimumDirectionalGenes: 30,
  minimumCoverage: 0.9,
  minimumDirectionalCoverage: 0.9,
  minimumCorrelation: 0.9,
  minimumDirectionAgreement: 0.9,
  maximumMedianLogFCDelta: 0.25,
  minimumEffectScale: 2 / 3,
  maximumEffectScale: 1.5,
} as const;

const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const count = (value: number | null | undefined): value is number =>
  finite(value) && Number.isInteger(value) && value >= 0;
const fraction = (value: number | null | undefined): value is number =>
  finite(value) && value >= 0 && value <= 1;
const invalidReported = (value: number | null | undefined, valid: (value: number | null | undefined) => boolean): boolean =>
  value != null && !valid(value);
const display = (value: number | null | undefined, digits = 3): string =>
  finite(value) ? value.toFixed(digits) : 'not recorded';
const displayCorrelation = (value: number | null | undefined): string => {
  const rounded = display(value);
  return finite(value) && value < AUTHOR_CONCORDANCE_POLICY.minimumCorrelation
    && Number(rounded) >= AUTHOR_CONCORDANCE_POLICY.minimumCorrelation ? String(value) : rounded;
};
const percent = (value: number): string => {
  const rounded = (value * 100).toFixed(1);
  // A below-threshold measurement must not appear to meet the coverage cutoff.
  if (value < AUTHOR_CONCORDANCE_POLICY.minimumCoverage
    && Number(rounded) >= AUTHOR_CONCORDANCE_POLICY.minimumCoverage * 100) return `${value * 100}%`;
  return `${rounded}%`;
};

function dimensionCheck(
  review: ComparisonReview,
  dimension: 'cohort' | 'contrast' | 'features' | 'effects',
  label: string,
): QualityCheck {
  const evidence = review.dimensions[dimension];
  const status: QualityStatus = !evidence || evidence.status === 'not_tested'
    ? 'not_assessed'
    : evidence.status === 'matched' || evidence.status === 'compatible' ? 'pass' : 'review';
  return {
    id: `author_${dimension}`,
    label,
    status,
    note: evidence?.note || 'No scientific comparison review is recorded.',
  };
}

export type EffectDefinitionReviews = typeof effectDefinitionReviews;

function assessScopedComparisons(record: AuthorValidationRecord, contrastId: string | undefined,
  definitions: EffectDefinitionReviews): QualityAssessment {
  const dataset = getDataset(record.datasetId);
  const entries = record.scopedComparisons!;
  const incomplete = (note: string): QualityAssessment => ({status: 'not_assessed',
    policyVersion: AUTHOR_CONCORDANCE_POLICY.version, scope: 'Separate author comparisons require complete, explicit coverage',
    checks: [{id: 'author_contrast_scope', label: 'Evidence covers this comparison', status: 'not_assessed', note}]});
  if (!dataset || !Array.isArray(entries) || !entries.length) return incomplete('No complete scoped author evidence is recorded.');
  // Scoped result support currently covers the explicit intake track registry.
  // Do not infer a complete track inventory from a dataset's default track.
  const tracks = intakeStudies.find(study => study.id === dataset.id)?.tracks.map(track => track.id);
  if (!tracks?.length) return incomplete('No complete track registry supports these scoped author comparisons.');
  const contrasts = dataset.contrasts.map(contrast => contrast.id);
  const keys = entries.map(entry => `${entry?.trackId}/${entry?.contrastId}`);
  if (new Set(keys).size !== keys.length || entries.some(entry => !entry || entry.datasetId !== record.datasetId
    || !tracks.includes(entry.trackId) || !contrasts.includes(entry.contrastId)
    || !entry.configId || !entry.localReference?.path || !/^[a-f0-9]{64}$/.test(entry.localReference.sha256)
    || !Number.isSafeInteger(entry.localReference.bytes) || entry.localReference.bytes <= 0
    || !/^[a-f0-9]{64}$/.test(entry.comparison?.evidenceFingerprint ?? '')
    || entry.comparison.contrast !== entry.contrastId
    || !Array.isArray(entry.comparability?.registeredContrastIds)
    || entry.comparability.registeredContrastIds.length !== 1
    || entry.comparability.registeredContrastIds[0] !== entry.contrastId)) {
    return incomplete('A saved author comparison is duplicated, borrowed, malformed or outside the registered track/contrast scope.');
  }
  if (new Set(entries.map(entry => entry.configId)).size !== entries.length
    || new Set(entries.map(entry => entry.localReference.path)).size !== entries.length
    || new Set(entries.map(entry => entry.comparison.evidenceFingerprint)).size !== entries.length) {
    return incomplete('Distinct comparisons must have distinct registered outputs and independently identified result records.');
  }
  if (contrastId !== undefined && !contrasts.includes(contrastId)) return incomplete('This comparison is not registered for the dataset.');
  const requested = contrastId === undefined ? contrasts : [contrastId];
  const expected = tracks.flatMap(track => requested.map(contrast => `${track}/${contrast}`));
  const selected = entries.filter(entry => requested.includes(entry.contrastId));
  if (selected.length !== expected.length || expected.some(key => !keys.includes(key))) {
    return incomplete('Every requested track and comparison needs its own measured author results. An untested comparison cannot inherit another comparison\'s badge.');
  }
  const assessments = selected.map(entry => ({entry, assessment: assessAuthorConcordance({...record,
    scopedComparisons: undefined, directComparison: entry.comparison, contrastCount: 1,
    verification: {...record.verification, comparability: entry.comparability}}, entry.contrastId, definitions)}));
  if (assessments.length === 1) return assessments[0].assessment;
  const ids = [...new Set(assessments.flatMap(({assessment}) => assessment.checks.map(check => check.id)))];
  const checks = ids.map(id => {
    const matches = assessments.map(({entry,assessment}) => ({entry,check: assessment.checks.find(check => check.id === id)}));
    const existing = matches.find(match => match.check)?.check!;
    const required = matches.some(match => match.check?.required !== false);
    const scoped = matches.map(({check}) => check ?? {id, label: existing.label, status: 'not_assessed' as const,
      required, note: 'This check has no measured evidence in one of the required comparisons.'});
    return {id, label: existing.label, required, status: aggregateQualityChecks(scoped.map(check => ({...check, required: true}))),
      note: matches.map(({entry,check}) => `${entry.trackId}/${entry.contrastId}: ${check?.note ?? 'Not assessed.'}`).join('\n'),
      evidence: [...new Set(scoped.flatMap(check => check.evidence ?? []))]};
  });
  return {status: aggregateQualityChecks(checks), checks, policyVersion: AUTHOR_CONCORDANCE_POLICY.version,
    scope: `All ${tracks.length} track(s) and ${selected.length} separately measured comparison(s). ${assessments.map(({entry,assessment}) => `${entry.contrastId}: ${assessment.scope}`).join(' ')}`};
}

function reviewedDimensionCheck(record: AuthorValidationRecord, dimension: 'effects' | 'cohort', label: string, definitions: EffectDefinitionReviews): QualityCheck {
  const comparison = record.directComparison;
  const review = record.verification.comparability;
  const check = dimensionCheck(review, dimension, label);
  // Legacy reviews sometimes put numerical or exact-model limitations in a different dimension.
  // Re-review only explicitly documented cases, bound to the precise evidence
  // and prior review. A stale entry can never override a new scientific concern.
  // A prior finding of 'different' is a genuine estimator or model disagreement,
  // not a misfiled limitation, so no review may promote it to compatible: doing so
  // would report a different effect estimator as a verified author concordance.
  const explicit = definitions.schemaVersion === 1 && definitions.reviews.find((entry) =>
    entry.datasetId === record.datasetId && entry.dimension === dimension && entry.status === 'compatible'
    && entry.priorReview.status !== 'different'
    && review.target === 'registered_output' && review.registeredContrastIds.length === 1
    && review.registeredContrastIds[0] === entry.contrastId
    && comparison?.evidenceFingerprint === entry.evidenceFingerprint
    && comparison?.localMethod === entry.localMethod && comparison?.authorMethod === entry.authorMethod
    && comparison?.orientation === entry.orientation
    && review.dimensions[dimension].status === entry.priorReview.status && review.dimensions[dimension].note === entry.priorReview.note);
  return explicit ? { ...check, status: 'pass',
    note: `${explicit.note} Prior ${dimension === 'effects' ? 'effect-agreement' : 'cohort-review'} note: ${explicit.priorReview.note}`,
    evidence: ['data/author-validation/concordance-reviews.json', ...explicit.sources.map((source) => source.path)] } : check;
}

/** Assess the saved registered effect comparison without borrowing evidence from refits. */
export function assessAuthorConcordance(record: AuthorValidationRecord, contrastId?: string,
  definitions: EffectDefinitionReviews = effectDefinitionReviews): QualityAssessment {
  const policy = AUTHOR_CONCORDANCE_POLICY;
  const checks: QualityCheck[] = [];
  const result = (scope: string): QualityAssessment => ({
    status: aggregateQualityChecks(checks), checks, scope, policyVersion: policy.version,
  });
  if (record.auditState === 'excluded' || record.comparisonLevel === 'excluded') {
    checks.push({ id: 'author_reference', label: 'Author comparison', status: 'not_applicable',
      note: 'This dataset is outside the recorded author-validation scope.' });
    return result('Outside author-validation scope');
  }

  if (record.scopedComparisons !== undefined) return assessScopedComparisons(record, contrastId, definitions);

  const comparison = record.directComparison;
  const review = record.verification.comparability;
  if (!comparison || review.target === 'not_tested' || review.resultScope === 'not_tested') {
    checks.push({ id: 'author_reference', label: 'Comparable author effects', status: 'not_assessed',
      note: 'No structured paired-gene effect comparison supports this assessment. Source integrity and narrative reviews do not supply missing metrics.' });
    return result('Author effect concordance has not been assessed');
  }

  if (comparison.type !== 'direct_author_result' || review.target !== 'registered_output') {
    checks.push({ id: 'author_reference', label: 'Registered output compared with author results', status: 'not_assessed',
      note: 'The recorded effects are reconstructed or come from a separate author-method analysis. They do not establish concordance of the registered output.' });
    return result('Reconstructed effects only');
  }
  checks.push({ id: 'author_reference', label: 'Registered output compared with author results', status: 'pass',
    note: review.basis });

  // The legacy comparison stores one metric block. A list of reviewed contexts
  // does not establish that those same metrics measured every context separately.
  const ids = review.registeredContrastIds;
  const registeredIds = getDataset(record.datasetId)?.contrasts.map((contrast) => contrast.id) ?? [];
  const explicitContrast = contrastId !== undefined;
  const supported = ids.length === 1 && (!explicitContrast || ids[0] === contrastId)
    && registeredIds.includes(ids[0])
    && (explicitContrast || record.contrastCount === 1);
  checks.push({ id: 'author_contrast_scope', label: 'Evidence covers this comparison',
    status: supported ? 'pass' : 'not_assessed',
    note: supported ? `Paired-gene metrics are scoped to ${ids[0]}.`
      : 'A single saved metric block cannot verify an unsupported comparison or every comparison in a dataset. Separate, explicitly scoped metrics are required.' });

  const selected = review.resultScope === 'selected_results';
  const scope = `${selected ? 'Selected author genes only' : 'Matched gene effects'}; ${supported ? ids[0] : contrastId || 'comparison coverage not established'}. P values and FDR are contextual.`;
  checks.push(
    reviewedDimensionCheck(record, 'cohort', 'Samples and replication are compatible', definitions),
    dimensionCheck(review, 'contrast', 'Biological comparison and direction are compatible'),
    dimensionCheck(review, 'features', 'Gene identifiers are compatible'),
    reviewedDimensionCheck(record, 'effects', 'Effect definitions are compatible', definitions),
  );

  const m = comparison.metrics;
  const countsPresent = count(m.sharedGenes) && count(m.localGenes) && count(m.authorGenes);
  const malformedCounts = [m.sharedGenes, m.localGenes, m.authorGenes].some((value) =>
    invalidReported(value, (entry) => count(entry) && entry > 0))
    || (count(m.sharedGenes) && count(m.localGenes) && m.sharedGenes > m.localGenes)
    || (count(m.sharedGenes) && count(m.authorGenes) && m.sharedGenes > m.authorGenes);
  const countsValid = countsPresent && m.sharedGenes! > 0 && m.localGenes! > 0 && m.authorGenes! > 0
    && m.sharedGenes! <= m.localGenes! && m.sharedGenes! <= m.authorGenes!;
  checks.push({ id: 'author_paired_genes', label: 'Enough matched genes',
    status: malformedCounts ? 'fail' : !countsPresent ? 'not_assessed' : !countsValid ? 'fail'
      : m.sharedGenes! >= policy.minimumSharedGenes ? 'pass' : 'review',
    note: countsValid ? `${m.sharedGenes} paired genes; at least ${policy.minimumSharedGenes} are required.`
      : 'Finite, consistent local, author and paired-gene counts are required.' });

  // Filtering differences can leave most author genes outside the registered
  // output. Full-table coverage therefore measures our output; selected lists
  // measure the reference list and must remain explicitly labelled as selected.
  const coverage = countsValid ? m.sharedGenes! / (selected ? m.authorGenes! : m.localGenes!) : null;
  const recordedCoverage = selected ? m.authorCoverage : m.localCoverage;
  const coverageConsistent = coverage != null && fraction(recordedCoverage)
    && Math.abs(coverage - recordedCoverage) <= 1e-7;
  const malformedCoverage = invalidReported(m.localCoverage, fraction) || invalidReported(m.authorCoverage, fraction)
    || (countsValid && ((finite(m.localCoverage) && Math.abs(m.localCoverage - m.sharedGenes! / m.localGenes!) > 1e-7)
      || (finite(m.authorCoverage) && Math.abs(m.authorCoverage - m.sharedGenes! / m.authorGenes!) > 1e-7)));
  checks.push({ id: 'author_coverage', label: selected ? 'Selected reference genes are covered' : 'Registered gene effects are covered',
    status: malformedCoverage ? 'fail' : !finite(recordedCoverage) || coverage == null ? 'not_assessed'
      : !coverageConsistent ? 'fail' : coverage >= policy.minimumCoverage ? 'pass' : 'review',
    note: `${coverage == null ? 'Unrecorded coverage' : `${percent(coverage)} of ${selected ? 'selected author' : 'registered local'} genes have paired effects`}; at least ${percent(policy.minimumCoverage)} is required. ${countsValid ? `${m.sharedGenes} shared of ${m.localGenes} local and ${m.authorGenes} author genes; ${percent(m.sharedGenes! / m.authorGenes!)} of the author reference is covered. ` : ''}${review.dimensions.coverage.note}` });

  const correlationsPresent = finite(m.pearsonLogFC) && finite(m.spearmanLogFC);
  const correlationsValid = correlationsPresent && Math.abs(m.pearsonLogFC!) <= 1 && Math.abs(m.spearmanLogFC!) <= 1;
  const malformedCorrelations = [m.pearsonLogFC, m.spearmanLogFC].some((value) =>
    invalidReported(value, (entry) => finite(entry) && Math.abs(entry) <= 1));
  checks.push({ id: 'author_effect_correlation', label: 'Effect sizes and ranks agree',
    required: false,
    status: malformedCorrelations ? 'fail' : !correlationsPresent ? 'not_assessed' : !correlationsValid ? 'fail'
      : m.pearsonLogFC! >= policy.minimumCorrelation && m.spearmanLogFC! >= policy.minimumCorrelation ? 'pass' : 'review',
    note: `Pearson r ${displayCorrelation(m.pearsonLogFC)}; Spearman rho ${displayCorrelation(m.spearmanLogFC)} across the same paired genes. Both must be at least ${policy.minimumCorrelation}.` });

  const directionPresent = count(m.signComparableGenes) && finite(m.signConcordance) && countsValid;
  const directionValid = directionPresent && fraction(m.signConcordance) && m.signComparableGenes! <= m.sharedGenes!;
  const malformedDirection = invalidReported(m.signComparableGenes, count) || invalidReported(m.signConcordance, fraction)
    || (count(m.signComparableGenes) && count(m.sharedGenes) && m.signComparableGenes > m.sharedGenes)
    || (m.signComparableGenes === 0 && m.signConcordance != null);
  const directionalCoverage = directionValid ? m.signComparableGenes! / m.sharedGenes! : null;
  const directionPassed = directionValid && m.signComparableGenes! >= policy.minimumDirectionalGenes
    && directionalCoverage! >= policy.minimumDirectionalCoverage && m.signConcordance! >= policy.minimumDirectionAgreement;
  checks.push({ id: 'author_gene_direction', label: 'The same genes change in the same direction',
    required: false,
    status: malformedDirection ? 'fail' : !directionPresent ? 'not_assessed' : !directionValid ? 'fail' : directionPassed ? 'pass' : 'review',
    note: `${fraction(m.signConcordance) ? percent(m.signConcordance) : 'Unrecorded agreement'} among ${count(m.signComparableGenes) ? m.signComparableGenes : 'unrecorded'} matched genes with nonzero effects in both results. Requires at least ${policy.minimumDirectionalGenes} such genes, ${percent(policy.minimumDirectionalCoverage)} of all pairs, and ${percent(policy.minimumDirectionAgreement)} agreement. Zero effects do not establish a direction.` });

  const magnitudePresent = finite(m.medianAbsLogFCDelta) && finite(m.effectScaleRatio) && count(m.effectScaleGenes);
  const magnitudeValid = magnitudePresent && m.medianAbsLogFCDelta! >= 0 && m.effectScaleRatio! >= 0
    && countsValid && m.effectScaleGenes === m.sharedGenes;
  const malformedMagnitude = [m.medianAbsLogFCDelta, m.rootMeanSquareLogFCDelta, m.effectScaleRatio].some((value) =>
    invalidReported(value, (entry) => finite(entry) && entry >= 0))
    || invalidReported(m.effectScaleGenes, count)
    || (count(m.effectScaleGenes) && count(m.sharedGenes) && m.effectScaleGenes !== m.sharedGenes);
  checks.push({ id: 'author_effect_magnitude', label: 'Effect magnitudes are plausible',
    required: false,
    status: malformedMagnitude ? 'fail' : !magnitudePresent ? 'not_assessed' : !magnitudeValid ? 'fail'
      : m.medianAbsLogFCDelta! <= policy.maximumMedianLogFCDelta
        && m.effectScaleRatio! >= policy.minimumEffectScale && m.effectScaleRatio! <= policy.maximumEffectScale ? 'pass' : 'review',
    note: `Median absolute log2FC difference ${display(m.medianAbsLogFCDelta)} is compared with ${policy.maximumMedianLogFCDelta}; paired RMS effect ratio ${display(m.effectScaleRatio)} is compared with two-thirds to ${policy.maximumEffectScale}. The ratio must cover all paired genes. Magnitude differences are reported for context and do not prevent acceptance by correlation or matched-gene direction.` });

  const alternatives = checks.filter((check) => check.id === 'author_effect_correlation' || check.id === 'author_gene_direction');
  const malformedMetrics = checks.some((check) => check.status === 'fail');
  const accepted = alternatives.filter((check) => check.status === 'pass');
  const acceptedBy = accepted.map((check) => check.id === 'author_effect_correlation' ? 'strong correlation' : 'matched-gene direction').join(' and ');
  // The two measurements are alternative evidence of pipeline quality. Neither
  // missing magnitudes nor different P/FDR can silently restore the old AND rule.
  // Invalid reported metrics still invalidate the assessment, even on an unused route.
  checks.push({ id: 'author_concordance_route', label: 'Strong correlation or matched-gene direction',
    status: malformedMetrics ? 'fail' : !supported ? 'not_assessed' : accepted.length ? 'pass'
      : alternatives.some((check) => check.status === 'review') ? 'review' : 'not_assessed',
    note: malformedMetrics ? 'A reported metric or denominator is invalid; alternative acceptance cannot hide invalid evidence.'
      : !supported ? 'The recorded metric block does not establish this requested comparison or every registered comparison. No numerical acceptance is assigned to an unsupported scope.'
      : accepted.length ? `Acceptance criterion met by ${acceptedBy}. Cohort, contrast, effect definitions, identifiers and coverage must also pass. Other metric results remain visible; acceptance does not claim identical magnitudes or statistical reproduction.`
        : 'Requires either strong Pearson and Spearman correlation, or sufficient agreement for the same matched genes with nonzero effects. Separate overall up/down percentages are not an accepted direction comparison.' });

  checks.push({ id: 'author_inference', label: 'P values and FDR are contextual', status: 'not_applicable', required: false,
    note: `${review.dimensions.inference.note} These statistics are reported for context and do not gate biological-effect concordance.` });
  return result(`${scope} ${supported && accepted.length && !malformedMetrics ? `Numerical acceptance: ${acceptedBy}.` : 'No numerical acceptance route has passed for this scope.'}`);
}
