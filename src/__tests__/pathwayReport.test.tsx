import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PathwayReport } from '../crossdataset/PathwayReport';

// The search box that used to live on the landing hub now lives in each
// explorer, so the routing it used to do — guessing from the shape of what you
// typed whether you meant a gene or a pathway — is gone. Each box knows what it
// searches. These cover the pathway half of that move.
describe('PathwayReport — the landing state', () => {
  it('renders the search interface, not a spinner, when no pathway is chosen', () => {
    render(<PathwayReport pathway={null} onHome={() => {}} onSearchPathway={() => {}} />);
    expect(screen.getByLabelText(/Search a pathway across all datasets/i)).toBeTruthy();
    // The regression this guards: useReportQuery used to initialise `loading` to
    // true and bail out on an empty key without clearing it, so a term-less
    // report showed a progress bar for a query that never ran.
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps a simple heading and uses category cards without preset-pathway submissions', () => {
    const onSearchPathway = vi.fn();
    const { container } = render(<PathwayReport pathway={null} onHome={() => {}} onSearchPathway={onSearchPathway} />);
    expect(screen.getByRole('heading', { name: 'Pathway Explorer' })).toBeInTheDocument();
    expect(container.querySelector('.qsearch-sub')).toBeNull();
    expect(container.querySelector('.qsearch-examples')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Aging / }));
    fireEvent.click(screen.getByRole('button', { name: /^Circadian / }));
    expect(screen.getByRole('button', { name: /^Aging / })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Circadian / })).toHaveAttribute('aria-pressed', 'true');
    expect(onSearchPathway).not.toHaveBeenCalled();
  });

  it('uppercases what was typed on submit', () => {
    const onSearchPathway = vi.fn();
    render(<PathwayReport pathway={null} onHome={() => {}} onSearchPathway={onSearchPathway} />);
    fireEvent.change(screen.getByLabelText(/Search a pathway across all datasets/i), {
      target: { value: 'hallmark_adipogenesis' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    expect(onSearchPathway).toHaveBeenCalledWith('HALLMARK_ADIPOGENESIS');
  });

  it('offers the study picker, closed, over the pathway-capable datasets', () => {
    render(<PathwayReport pathway={null} onHome={() => {}} onSearchPathway={() => {}} />);
    const toggle = screen.getByRole('button', { name: /^Datasets/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});

// ─── PathwayReport chrome (data path verified live in the preview) ──────────────
describe('PathwayReport', () => {
  it('renders the view chrome for the requested pathway', () => {
    render(<PathwayReport pathway="HALLMARK_ADIPOGENESIS" onHome={() => {}} onSearchPathway={() => {}} />);
    expect(screen.getByText('Pathway Explorer')).toBeTruthy();
    expect(screen.getAllByText('HALLMARK_ADIPOGENESIS').length).toBeGreaterThan(0);
  });

  it('fires onHome from the nav', () => {
    const onHome = vi.fn();
    render(<PathwayReport pathway="HALLMARK_ADIPOGENESIS" onHome={onHome} onSearchPathway={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^Home$/ }));
    expect(onHome).toHaveBeenCalled();
  });
});
