import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthorEvidenceLabel, AuthorValidationPanel } from '../common/AuthorValidation';
import { requireAuthorValidation, type AuthorPathwayValidation } from '../data/authorValidation';

afterEach(cleanup);

const pathwayEvidence: AuthorPathwayValidation = {
  state: 'rebuilt_provenance_checked', provenanceSchemaVersion: 3,
  baselineKind: 'git_commit', baselineNote: 'Committed pre-audit result files.',
  baselineCommit: 'a'.repeat(40), contrastCount: 1,
  totals: {
    previousRows: 100, currentRows: 219, addedRows: 123, removedRows: 4, sharedRows: 96,
    nonFiniteRowsBefore: 2, nonFiniteRowsAfter: 0,
    nesDirectionChanges: 1, fdrCallsBefore: 10, fdrCallsAfter: 16,
    fdrCallsGained: 8, fdrCallsLost: 2,
  },
  provenanceFiles: ['geo_replication/datasets/GSE285906/processed/GSE285906_FGSEA_provenance.tsv'],
};

describe('AuthorValidationPanel', () => {
  it.each([
    ['method_differences', 'limited reference scope'],
    ['not_comparable', 'different contrast'],
  ] as const)('makes partial-reference limitations visible in compact labels: %s', (comparisonOutcome, label) => {
    const record = requireAuthorValidation('mouse_hypo_oxaliplatin_gse285906');
    render(<AuthorEvidenceLabel record={{ ...record, verification: {
      ...record.verification, evidenceLevel: 'author_results', resultAvailability: 'partial', comparisonOutcome,
    } }} />);
    expect(screen.getByText(`Author results compared · ${label}`)).toBeTruthy();
  });
  it('separates reported-call overlap from the paper-filtered overlap', () => {
    const record = requireAuthorValidation('mouse_hypo_oxaliplatin_gse285906');
    render(<AuthorValidationPanel record={{ ...record, directComparison: {
      contrast: 'AgRP comparison', type: 'direct_author_result', interpretation: 'effect_match_inference_differs',
      paperFilterDefinition: 'CPM >20 and |log2FC| >1, FDR <0.05',
      metrics: { significantSetJaccard: .7371, paperFilteredAuthorGenes: 826, paperFilteredLocalGenes: 551,
        paperFilteredInBoth: 528, paperFilteredSetJaccard: .6219 },
    } }} />);
    expect(screen.getByRole('rowheader', { name: 'Reported-call Jaccard (see scope)' }).closest('tr')).toHaveTextContent('0.7371');
    expect(screen.getByRole('rowheader', { name: 'Paper-rule call-list Jaccard' }).closest('tr')).toHaveTextContent('0.6219');
    expect(screen.getByRole('rowheader', { name: 'Paper-rule author / local calls' }).closest('tr')).toHaveTextContent('826 / 551');
    expect(screen.getByRole('rowheader', { name: 'Paper-rule shared calls' }).closest('tr')).toHaveTextContent('528');
  });
  it('shows publisher full-text access independently from PMC access', () => {
    render(<AuthorValidationPanel record={requireAuthorValidation('mouse_hypo_oxaliplatin_gse285906')} />);
    expect(screen.getByText('Publisher full text accessed')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open publisher full text and Figure 6D' })).toBeTruthy();
  });

  it('surfaces the expressed-gene sensitivity analysis when low-expression effects distort correlation', () => {
    render(<AuthorValidationPanel record={requireAuthorValidation('mouse_hypo_smc3_gse243287')} />);
    expect(screen.getByText('Expressed-gene Pearson logFC')).toBeTruthy();
    expect(screen.getByText('0.9629')).toBeTruthy();
    expect(screen.getByText('Expressed-gene direction agreement')).toBeTruthy();
    expect(screen.getByText('98.8%')).toBeTruthy();
  });

  it('discloses when checksum-verified source bytes are absent from the checkout', () => {
    render(<AuthorValidationPanel record={requireAuthorValidation('mouse_hypo_spatial_aging_gse270383')} />);
    expect(screen.getByText(
      'Checksum evidence includes external staging; some source files absent from checkout',
    )).toBeTruthy();
  });

  it('shows pathway rebuild changes against local pre-audit outputs without changing validation status', () => {
    const record = requireAuthorValidation('mouse_hypo_oxaliplatin_gse285906');
    render(<AuthorValidationPanel record={{
      ...record,
      pathwayValidation: pathwayEvidence,
    }} />);
    const row = screen.getByRole('rowheader', { name: 'Pathway validation' }).closest('tr');
    expect(row).toHaveTextContent('Cache-isolated rebuild; schema-3 provenance and checksums verified for 1 registered contrast.');
    expect(row).toHaveTextContent('Versus pre-audit local outputs: 123 pathway result rows added; 4 removed. FDR < 0.05 calls: 8 gained; 2 lost.');
    expect(row).toHaveTextContent('not an author pathway-result match');
    expect(screen.getByText('Validated with notes')).toBeTruthy();
    expect(screen.queryByText(/Untestable pathway rows:/)).toBeNull();
  });

  it('discloses untestable rows omitted from displayed tables without treating missing statistics as zeros', () => {
    render(<AuthorValidationPanel record={{
      ...requireAuthorValidation('mouse_hypo_oxaliplatin_gse285906'),
      pathwayValidation: {
        ...pathwayEvidence, totals: { ...pathwayEvidence.totals, nonFiniteRowsAfter: 2 },
      },
    }} />);
    const row = screen.getByRole('rowheader', { name: 'Pathway validation' }).closest('tr');
    expect(row).toHaveTextContent('Untestable pathway rows: 2 omitted from displayed tables because statistics are missing; missing values are not zeros.');
    expect(screen.getByText('Validated with notes')).toBeTruthy();
  });

  it('discloses a hash-pinned local baseline when no committed baseline exists', () => {
    const baselineNote = 'The Aug 31 processed files were absent from Git and preserved before migration.';
    render(<AuthorValidationPanel record={{
      ...requireAuthorValidation('mouse_hypo_lps_gse281503'),
      pathwayValidation: {
        ...pathwayEvidence, baselineKind: 'local_snapshot', baselineCommit: null, baselineNote,
      },
    }} />);
    expect(screen.getByText(
      'Baseline exception: hash-pinned pre-migration local snapshot; no committed baseline.',
    )).toHaveAttribute('title', baselineNote);
  });

  it('does not claim pathway validation when evidence is absent', () => {
    render(<AuthorValidationPanel record={{
      ...requireAuthorValidation('mouse_hypo_oxaliplatin_gse285906'), pathwayValidation: undefined,
    }} />);
    expect(screen.getByText('No pathway validation evidence recorded')).toBeTruthy();
    expect(screen.queryByText(/Cache-isolated rebuild/)).toBeNull();
  });

  it('shows current intake provenance without inventing a migration baseline or change', () => {
    render(<AuthorValidationPanel record={{
      ...requireAuthorValidation('mouse_hypo_oxaliplatin_gse285906'),
      pathwayValidation: {
        state: 'current_provenance_checked', provenanceSchemaVersion: 3,
        contrastCount: 1, currentRows: 500, nonFiniteRows: 2,
        provenanceFiles: ['geo_replication/datasets/GSE65663_rnor_son_salt/processed/GSE65663_FGSEA_provenance.tsv'],
        evidencePath: 'data/intake/oxt-avp-2026-10-19/audit.generated.json',
        note: 'Current output trace only.',
      },
    }} />);
    const row = screen.getByRole('rowheader', { name: 'Pathway validation' }).closest('tr');
    expect(row).toHaveTextContent('Current schema-3 pathway provenance and checksums verified for 1 registered contrast.');
    expect(row).toHaveTextContent('Newly admitted analysis; no pre-migration baseline or migration comparison.');
    expect(row).toHaveTextContent('500 raw pathway rows');
    expect(row).toHaveTextContent('does not establish author pathway-result agreement');
    expect(row).toHaveTextContent('Untestable pathway rows: 2 omitted');
    expect(row).not.toHaveTextContent('Cache-isolated rebuild');
    expect(row).not.toHaveTextContent('Versus pre-audit');
    expect(row).not.toHaveTextContent('gained');
    expect(screen.getByText('Validated with notes')).toBeTruthy();
  });

  it('keeps the macaque single-cell pathway analysis explicitly outside scope', () => {
    render(<AuthorValidationPanel record={{
      ...requireAuthorValidation('macaque_snrna'), pathwayValidation: null,
    }} />);
    const row = screen.getByRole('rowheader', { name: 'Pathway validation' }).closest('tr');
    expect(row).toHaveTextContent('Not in validation scope');
    expect(row).not.toHaveTextContent('verified');
  });
});
