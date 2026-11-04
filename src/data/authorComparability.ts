/** Whether an author result answers the same question as the displayed analysis. */
export const COMPARABILITY_DIMENSIONS = {
  cohort: 'Samples and replication',
  contrast: 'Biological comparison and direction',
  features: 'Gene identifiers and tested genes',
  effects: 'Effect definition and magnitude',
  inference: 'Statistical model, P values and FDR',
  coverage: 'Reference coverage',
} as const;

export const COMPARABILITY_STATUS = {
  matched: 'Matched',
  compatible: 'Compatible, justification recorded',
  limited: 'Limited evidence',
  different: 'Different',
  not_tested: 'Not established',
} as const;

export const COMPARABILITY_ASSESSMENTS = {
  comparable: 'Comparable for the documented result',
  limited: 'Comparison has stated limitations',
  not_comparable: 'Not the same analysis question',
  not_established: 'Comparability not established',
} as const;

export const COMPARISON_TARGETS = {
  registered_output: 'Registered Explorer output',
  author_method_reconstruction: 'Separate author-method reconstruction',
  derived_author_effect: 'Effect derived from other author comparisons',
  not_tested: 'Author-result agreement not tested',
} as const;

export const COMPARISON_SCOPES = {
  full_results: 'Full result table, subject to the statistical coverage below',
  selected_results: 'Selected genes or results only',
  effects_only: 'Effects only, not full statistical results',
  not_tested: 'No comparable result tested',
} as const;

export interface ComparisonReview {
  target: keyof typeof COMPARISON_TARGETS;
  resultScope: keyof typeof COMPARISON_SCOPES;
  /** Comparison contexts reviewed, not successful verification sign-offs. */
  registeredContrastIds: string[];
  basis: string;
  reference: string;
  assessment: keyof typeof COMPARABILITY_ASSESSMENTS;
  dimensions: Record<keyof typeof COMPARABILITY_DIMENSIONS, {
    status: keyof typeof COMPARABILITY_STATUS;
    note: string;
  }>;
  criteria: string;
  conclusion: string;
}

export function validateComparisonReview(review: ComparisonReview): void {
  if (!review) throw new Error('Comparability review is missing');
  const owns = (map: object, key: string) => Object.keys(map).includes(key);
  if (!owns(COMPARABILITY_ASSESSMENTS, review.assessment)) throw new Error('Invalid comparability assessment');
  if (!owns(COMPARISON_TARGETS, review.target)) throw new Error('Invalid comparison target');
  if (!owns(COMPARISON_SCOPES, review.resultScope)) throw new Error('Invalid comparison result scope');
  if (!Array.isArray(review.registeredContrastIds) || review.registeredContrastIds.some((id) => typeof id !== 'string' || !id.trim())
    || new Set(review.registeredContrastIds).size !== review.registeredContrastIds.length) {
    throw new Error('Comparability review needs distinct registered contrast IDs');
  }
  for (const key of ['basis', 'reference', 'criteria', 'conclusion'] as const) {
    if (typeof review[key] !== 'string' || !review[key].trim()) throw new Error(`Comparability review needs ${key}`);
  }
  const keys = Object.keys(COMPARABILITY_DIMENSIONS) as (keyof typeof COMPARABILITY_DIMENSIONS)[];
  if (Object.keys(review.dimensions ?? {}).some((key) => !owns(COMPARABILITY_DIMENSIONS, key))) {
    throw new Error('Comparability review has an unknown scientific requirement');
  }
  for (const key of keys) {
    const dimension = review.dimensions?.[key];
    if (!dimension || !owns(COMPARABILITY_STATUS, dimension.status) || typeof dimension.note !== 'string' || !dimension.note.trim()) {
      throw new Error(`Comparability review needs a status and note for ${key}`);
    }
  }
  if (review.assessment === 'comparable' && !Object.values(review.dimensions)
    .every(({ status }) => status === 'matched' || status === 'compatible')) {
    throw new Error('Comparable assessment conflicts with an unmet scientific requirement');
  }
}

/** Absence of author evidence never implies that scientific requirements passed. */
export function unestablishedComparison(reason: string, differentContrast = false): ComparisonReview {
  return {
    target: 'not_tested', resultScope: 'not_tested', registeredContrastIds: [],
    basis: 'Registered Explorer output. Source and output-integrity checks are recorded separately; they do not establish agreement with author results.',
    reference: differentContrast
      ? 'The available author result addresses a different contrast. See the dataset review and source links for the actual reference.'
      : 'No comparable author result has been tested. See author-result availability and the source links below.',
    assessment: differentContrast ? 'not_comparable' : 'not_established',
    dimensions: {
      cohort: { status: 'not_tested', note: 'Author-result cohort equivalence is not established by this comparison. See the source and sample review for input checks.' },
      contrast: { status: differentContrast ? 'different' : 'not_tested', note: differentContrast
        ? 'The available author result addresses a different contrast. See the dataset review for the specific difference.'
        : 'No comparable author-result test establishes the same biological question and direction.' },
      features: { status: 'not_tested', note: 'A comparable author tested-gene universe has not been checked.' },
      effects: { status: 'not_tested', note: 'Agreement of registered effects with comparable author effects has not been tested.' },
      inference: { status: 'not_tested', note: 'Comparable author P values, FDR and significant-gene calls have not been tested.' },
      coverage: { status: 'not_tested', note: 'Full author-result coverage of the registered comparisons is not established.' },
    },
    criteria: 'No author-result agreement claim or numerical acceptance tolerance is established. File integrity cannot substitute for this comparison.',
    conclusion: reason,
  };
}
