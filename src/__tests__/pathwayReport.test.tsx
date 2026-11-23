import { useState, type ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PathwayReport } from '../crossdataset/PathwayReport';
import { DEFAULT_STUDY_SELECTION } from '../crossdataset/studySelectionLink';

/** The report over a selection held outside it, as the router holds it. */
function Report(props: Omit<ComponentProps<typeof PathwayReport>, 'pathway' | 'selection' | 'onSelectionChange'>) {
  const [selection, setSelection] = useState(DEFAULT_STUDY_SELECTION);
  return <PathwayReport pathway="HALLMARK_ADIPOGENESIS" selection={selection} onSelectionChange={setSelection} {...props} />;
}

// The report's study filters: category cards narrow the report in place, and
// the per-dataset picker starts closed. Neither starts a new search.
describe('PathwayReport — study filters', () => {
  it('selects category cards without starting a new search', () => {
    const onSearchPathway = vi.fn();
    render(<Report onHome={() => {}} onSearchPathway={onSearchPathway} />);
    fireEvent.click(screen.getByRole('button', { name: /^Aging / }));
    fireEvent.click(screen.getByRole('button', { name: /^Circadian / }));
    expect(screen.getByRole('button', { name: /^Aging / })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Circadian / })).toHaveAttribute('aria-pressed', 'true');
    expect(onSearchPathway).not.toHaveBeenCalled();
  });

  it('offers the study picker, closed, over the pathway-capable datasets', () => {
    render(<Report onHome={() => {}} onSearchPathway={() => {}} />);
    const toggle = screen.getByRole('button', { name: /^Datasets/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});

// ─── PathwayReport chrome (data path verified live in the preview) ──────────────
describe('PathwayReport', () => {
  it('renders the view chrome for the requested pathway', () => {
    render(<Report onHome={() => {}} onSearchPathway={() => {}} />);
    expect(screen.getByText('Pathway Explorer')).toBeTruthy();
    expect(screen.getAllByText('HALLMARK_ADIPOGENESIS').length).toBeGreaterThan(0);
  });

  it('fires onHome from the nav', () => {
    const onHome = vi.fn();
    render(<Report onHome={onHome} onSearchPathway={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^Home$/ }));
    expect(onHome).toHaveBeenCalled();
  });
});
