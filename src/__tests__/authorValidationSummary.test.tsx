import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthorValidationSummary } from '../common/AuthorValidation';
import { requireAuthorValidation, type AuthorValidationRecord } from '../data/authorValidation';
import { COMPARABILITY_ASSESSMENTS } from '../data/authorComparability';

// THE VISIBLE-DISCLOSURE CONTRACT.
//
// The library record collapsed its reproduction dossier behind a <details>,
// which is the right call for a 3,353px scroller but the wrong one for honesty
// if it takes the limitations down with it. This file is the contract that says
// what a reader who never opens the disclosure still leaves with. If a future
// change moves one of these five things behind the triangle, a test here fails.
//
// The corpus is being written up as a database paper and several records carry
// "Unresolved, review required", so "it's one click away" is not an acceptable
// answer for any of them.

const record = requireAuthorValidation('mouse_arc_hfd_gse284408');
const summaryOf = () => screen.getByRole('region', { name: 'Verification summary' });

describe('AuthorValidationSummary — what stays visible without opening the report', () => {
  it('shows pipeline, experimental-design and author-concordance badges', () => {
    render(<AuthorValidationSummary record={record} />);
    const summary = summaryOf();
    expect(summary.querySelector('[data-quality-badge="pipeline-qc"]')).toBeTruthy();
    expect(summary.querySelector('[data-quality-badge="experimental-design"]')).toBeTruthy();
    expect(summary.querySelector('[data-quality-badge="author-concordance"]')).toBeTruthy();
  });

  it('shows the explicit author-review claim, alongside the three quality badges', () => {
    // Passing badges apply only to their recorded checks. They do not say which
    // author-reproduction claim is being made, and only this badge does.
    render(<AuthorValidationSummary record={record} />);
    expect(summaryOf().querySelector('[data-verification-claim]')).toBeTruthy();
  });

  it('states the comparability assessment so the claim carries its scope', () => {
    render(<AuthorValidationSummary record={record} />);
    const scope = summaryOf().querySelector('[data-validation-scope]');
    expect(scope?.textContent)
      .toBe(COMPARABILITY_ASSESSMENTS[record.verification.comparability.assessment]);
  });

  it('renders review flags as visible text, not only inside a badge tooltip', () => {
    const flagged: AuthorValidationRecord = {
      ...record,
      reviewFlags: ['Author adjusted P values remain unavailable.'],
    };
    render(<AuthorValidationSummary record={flagged} />);
    expect(summaryOf().querySelector('[data-validation-limitation]')?.textContent)
      .toContain('Author adjusted P values remain unavailable.');
  });

  it('still discloses a limitation when an unresolved record carries no itemised flags', () => {
    // The old callout rendered only when reviewFlags was non-empty, so an
    // unresolved record with none displayed nothing and read as clean.
    const bare: AuthorValidationRecord = {
      ...record,
      reviewFlags: [],
      verification: { ...record.verification, state: 'unresolved' },
    };
    render(<AuthorValidationSummary record={bare} />);
    const limitation = summaryOf().querySelector('[data-validation-limitation]');
    expect(limitation?.textContent).toContain('Unresolved, review required:');
    expect(limitation?.textContent).toContain('flagged for review');
  });

  it('does not invent a limitation for a record that has none', () => {
    const clean: AuthorValidationRecord = {
      ...record,
      reviewFlags: [],
      verification: { ...record.verification, state: 'full' },
    };
    render(<AuthorValidationSummary record={clean} />);
    expect(summaryOf().querySelector('[data-validation-limitation]')).toBeNull();
  });

  it('omits the comparability line for a record outside verification scope', () => {
    // An excluded record has no author comparison to describe, and printing an
    // assessment for one would claim a check that was never run.
    const excluded = requireAuthorValidation('macaque_snrna');
    render(<AuthorValidationSummary record={excluded} />);
    expect(summaryOf().querySelector('[data-validation-scope]')).toBeNull();
  });
});
