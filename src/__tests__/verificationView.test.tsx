import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { VerificationView } from '../verification/VerificationView';
import { DatasetVerificationContext, DatasetVerificationLink } from '../common/DatasetVerificationContext';
import { AUTHOR_VALIDATION_REPORT, requireAuthorValidation } from '../data/authorValidation';
import { datasetQuality, QUALITY_STATUS } from '../data/datasetQualityR460';
import { MethodologyView } from '../methodology/MethodologyView';
import { parseRoute, routeHref, libraryHref } from '../utils/appLinks';
import { useAppRouter } from '../appRouter';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '#/'); });

describe('verification reference page', () => {
  it('reports all three badges from the same live assessments as the rest of the app', () => {
    render(<VerificationView onHome={vi.fn()} />);
    const coverage = screen.getByRole('table', { name: 'Current quality-control coverage' });
    const qualities = AUTHOR_VALIDATION_REPORT.records.map(r => datasetQuality(r));
    for (const [key, meta] of Object.entries(QUALITY_STATUS)) {
      const row = within(coverage).getByRole('rowheader', { name: meta.label }).closest('tr')!;
      expect(within(row).getAllByRole('cell').map(c => c.textContent)).toEqual([
        String(qualities.filter(q => q.pipelineQc.status === key).length),
        String(qualities.filter(q => q.experimentalDesign.status === key).length),
        String(qualities.filter(q => q.authorConcordance.status === key).length),
      ]);
    }
    expect(screen.getByText(/Missing reference data is an evidence gap/)).toBeTruthy();
  });
  it('states gene-level direction, project thresholds and independent internal checks', () => {
    render(<VerificationView onHome={vi.fn()} />);
    const criteria = screen.getByRole('table', { name: 'Author concordance acceptance criteria' });
    expect(within(criteria).getByRole('rowheader', { name: 'Direction route' }).closest('tr')).toHaveTextContent('90%');
    expect(within(criteria).getByRole('rowheader', { name: 'Correlation route' }).closest('tr')).toHaveTextContent('this route or the direction route is sufficient');
    expect(screen.getByText(/Matching author magnitudes, P values, FDR and significant-gene counts is not required/)).toBeTruthy();
    expect(screen.getByText(/versioned project acceptance defaults/)).toBeTruthy();
    expect(screen.getByText(/Stale reports and missing evidence cannot provide a passing check/)).toBeTruthy();
  });
  it('retains observed discrepancies with links and next steps', () => {
    render(<VerificationView onHome={vi.fn()} />);
    for (const record of AUTHOR_VALIDATION_REPORT.records.filter(r => r.verification.state === 'unresolved')) {
      const link = screen.getByRole('link', { name: record.accession });
      expect(link).toHaveAttribute('href', libraryHref(record.datasetId));
      expect(within(link.closest('li')!).getByText(record.verification.reason)).toBeTruthy();
    }
  });
  it('is linked from methodology and preserves unfinished reviews separately', () => {
    const { unmount } = render(<MethodologyView onHome={vi.fn()} />);
    expect(screen.getByRole('link', { name: /Read the verification process/ })).toHaveAttribute('href', '#/verification');
    unmount(); render(<VerificationView onHome={vi.fn()} />);
    expect(screen.getByText(`Reviews still underway (${AUTHOR_VALIDATION_REPORT.records.filter(r => r.verification.state === 'in_progress').length})`)).toBeTruthy();
  });
});

describe('verification follows the selected dataset', () => {
  it('keeps badge controls outside the evidence disclosure and scopes unknown comparisons', () => {
    const record = requireAuthorValidation('mouse_hypo_oxaliplatin_gse285906');
    const { container } = render(<DatasetVerificationContext datasetId={record.datasetId} contrastId="unverified-contrast" />);
    const summary = container.querySelector('summary')!;
    expect(summary.querySelector('button')).toBeNull();
    fireEvent.click(summary);
    expect(container.querySelector('details')!.open).toBe(true);
    expect(screen.getByText(/Each badge applies to the selected comparison/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Author validation' })).toBeTruthy();
  });
  it('links cross-dataset evidence without nesting badge buttons inside a link', () => {
    const record = requireAuthorValidation('mouse_hypo_oxaliplatin_gse285906');
    const { container } = render(<DatasetVerificationLink datasetId={record.datasetId} />);
    expect(screen.getByRole('link', { name: `Verification evidence for ${record.accession}: ${record.verification.reason}` })).toHaveAttribute('href', libraryHref(record.datasetId));
    expect(container.querySelector('a button')).toBeNull();
  });
  it('does not invent evidence for an unknown dataset', () => {
    render(<DatasetVerificationContext datasetId="unknown-study" />);
    expect(screen.getByText(/Verification not assessed/)).toBeTruthy();
  });
});

describe('verification route', () => {
  it('round-trips bookmarks and accepts a trailing slash', () => {
    expect(routeHref({ view: 'verification' })).toBe('#/verification');
    expect(parseRoute('#/verification')).toEqual({ view: 'verification' });
    expect(parseRoute('#/verification/')).toEqual({ view: 'verification' });
  });
  it('opens without changing the selected dataset and supports a deep link', () => {
    const explorer = { navigate: vi.fn() };
    const first = renderHook(() => useAppRouter('hub', explorer));
    act(() => first.result.current.openVerification());
    expect(first.result.current.view).toBe('verification'); expect(explorer.navigate).not.toHaveBeenCalled(); first.unmount();
    window.history.replaceState(null, '', '#/verification');
    expect(renderHook(() => useAppRouter('hub', explorer)).result.current.view).toBe('verification');
  });
});
