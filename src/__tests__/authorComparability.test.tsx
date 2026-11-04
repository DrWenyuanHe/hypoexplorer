import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTHOR_VALIDATION_REPORT, requireAuthorValidation } from '../data/authorValidation';
import { COMPARABILITY_DIMENSIONS, validateComparisonReview } from '../data/authorComparability';
import { AuthorValidationPanel } from '../common/AuthorValidation';

afterEach(cleanup);

describe('recorded author comparability', () => {
  it('gives every numerical review an explicit target, scope and six evidence notes', () => {
    for (const record of AUTHOR_VALIDATION_REPORT.records) {
      const review = record.verification.comparability;
      expect(() => validateComparisonReview(review)).not.toThrow();
      expect(Object.keys(review.dimensions).sort()).toEqual(Object.keys(COMPARABILITY_DIMENSIONS).sort());
      if (['author_results', 'reconstructed'].includes(record.verification.evidenceLevel)) {
        expect(review.target).not.toBe('not_tested');
        expect(review.registeredContrastIds.length).toBeGreaterThan(0);
      }
      if (record.verification.evidenceLevel === 'source_only') {
        expect(review.dimensions.inference.status).toBe('not_tested');
        expect(review.assessment).not.toBe('comparable');
      }
    }
  });
  it('keeps an exact palmitate author-method reconstruction separate from Explorer inference', () => {
    const record = requireAuthorValidation('mouse_mhypoa_palmitate_gse280030');
    render(<AuthorValidationPanel record={record} />);
    expect(screen.getByRole('rowheader', { name: 'Our result being checked' }).closest('tr'))
      .toHaveTextContent('Registered seven-library edgeR-QL');
    expect(record.verification.comparability.dimensions.inference.status).toBe('different');
    expect(screen.getByRole('rowheader', { name: 'Agreement criteria and limits' }).closest('tr'))
      .toHaveTextContent('1,418-ID refit match is not an Explorer acceptance criterion');
    expect(record.verification.fullyVerifiedContrasts).toEqual([]);
  });
  it('does not replace SST registered results with its improved sensitivity analysis', () => {
    const record = requireAuthorValidation('mouse_sst_neuron_sex_gse224254');
    render(<AuthorValidationPanel record={record} />);
    expect(screen.getByRole('rowheader', { name: 'Statistical model, P values and FDR' }).closest('tr'))
      .toHaveTextContent('502/25 with 23 shared');
    expect(screen.getByRole('rowheader', { name: 'Statistical model, P values and FDR' }).closest('tr'))
      .toHaveTextContent('Refit 501/505 overlap is not Explorer agreement');
    expect(record.verification.state).toBe('unresolved');
    expect(record.verification.fullyVerifiedContrasts).toEqual([]);
  });
  it('does not turn an organoid excerpt with zero discoveries into full-universe agreement', () => {
    const record = requireAuthorValidation('human_hypo_pituitary_organoid_gse301692');
    render(<AuthorValidationPanel record={record} />);
    expect(record.verification.comparability.resultScope).toBe('selected_results');
    expect(screen.getByRole('rowheader', { name: 'Reference coverage' }).closest('tr')).toHaveTextContent('56-row excerpt');
    expect(screen.getByRole('rowheader', { name: 'Statistical model, P values and FDR' }).closest('tr'))
      .toHaveTextContent('0.992850493');
    expect(record.verification.fullyVerifiedContrasts).toEqual([]);
  });
  it('preserves reviewed SON comparisons without a legacy directComparison object and discloses missing FDR', () => {
    const record = requireAuthorValidation('rat_son_aging_gse231617');
    render(<AuthorValidationPanel record={{ ...record, directComparison: null }} />);
    expect(screen.getByRole('rowheader', { name: 'Statistical model, P values and FDR' }).closest('tr'))
      .toHaveTextContent('20,054 pairs have finite FDR');
    expect(screen.getByRole('rowheader', { name: 'Statistical model, P values and FDR' }).closest('tr'))
      .toHaveTextContent('139 local discoveries');
    expect(screen.getByText('Author results compared, limits remain')).toBeTruthy();
  });
  it('labels adjacent-contrast reconstruction as effects-only, not a recovered statistical test', () => {
    const record = requireAuthorValidation('mouse_hypo_fasting_gse294478');
    render(<AuthorValidationPanel record={record} />);
    expect(record.verification.comparability).toMatchObject({ target: 'derived_author_effect', resultScope: 'effects_only' });
    expect(record.verification.comparability.dimensions.inference.status).toBe('not_tested');
    expect(screen.getByRole('rowheader', { name: 'Effect definition and magnitude' }).closest('tr')).toHaveTextContent('3,564 strong effects');
    expect(record.directComparison?.metrics.significantSetJaccard).toBeNull();
    expect(screen.queryByText('Fully verified')).toBeNull();
  });
});
