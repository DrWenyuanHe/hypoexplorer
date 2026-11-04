import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { rankSuggestions, useSearchIndex } from '../crossdataset/searchLanding';

// The Gene Explorer's landing state: the search interface that used to be the
// hub's hero box. The query layer is never reached here — a landing page has no
// gene to query — so the real module is left alone.
const { GeneReport } = await import('../crossdataset/GeneReport');

function landing(over: Record<string, unknown> = {}) {
  const onSearchGene = vi.fn();
  const onDatasetScopeChange = vi.fn();
  render(
    <GeneReport
      gene={null}
      scope={null}
      datasetScope={null}
      onDatasetScopeChange={onDatasetScopeChange}
      onHome={() => {}}
      onSearchGene={onSearchGene}
      {...over}
    />,
  );
  return { onSearchGene, onDatasetScopeChange };
}

const box = () => screen.getByLabelText(/Search a gene across all datasets/i);

describe('GeneReport — the landing state', () => {
  it('renders the search interface rather than a spinner', () => {
    landing();
    expect(box()).toBeTruthy();
    // The regression this guards: useReportQuery initialised `loading` to true
    // and bailed out of the effect on an empty key WITHOUT clearing it, so a
    // gene-less report showed a progress bar for a query that never ran. The
    // "Search a gene to begin." branch below it was unreachable dead code.
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('submits what was typed, on Enter and on the button', () => {
    const { onSearchGene } = landing();
    fireEvent.change(box(), { target: { value: 'Pomc' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onSearchGene).toHaveBeenCalledWith('Pomc', null);

    fireEvent.change(box(), { target: { value: 'Agrp' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    expect(onSearchGene).toHaveBeenLastCalledWith('Agrp', null);
  });

  it('ignores an empty or whitespace-only query', () => {
    const { onSearchGene } = landing();
    fireEvent.change(box(), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    expect(onSearchGene).not.toHaveBeenCalled();
  });

  it('carries the category scope chosen BEFORE the search into the search', () => {
    // The trap this covers: the router's searchGene used to reset the scope on
    // every call, so a scope picked on the landing page was discarded by the
    // very act of searching under it.
    const { onSearchGene } = landing();
    fireEvent.click(screen.getByRole('button', { name: /^Circadian / }));
    fireEvent.change(box(), { target: { value: 'Pomc' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onSearchGene).toHaveBeenCalledWith('Pomc', ['Circadian']);
  });

  it('selects categories without changing the gene or starting a search', () => {
    const { onSearchGene } = landing();
    fireEvent.change(box(), { target: { value: 'LEPR' } });
    fireEvent.click(screen.getByRole('button', { name: /^Aging / }));
    fireEvent.click(screen.getByRole('button', { name: /^Feeding & fasting / }));
    expect(box()).toHaveValue('LEPR');
    expect(onSearchGene).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Aging / })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onSearchGene).toHaveBeenCalledWith('LEPR', ['Aging', 'Feeding & fasting']);
  });

  it('returns to all datasets when the last category is deselected', () => {
    const { onSearchGene } = landing();
    const aging = screen.getByRole('button', { name: /^Aging / });
    fireEvent.click(aging);
    fireEvent.click(aging);
    expect(screen.getByRole('button', { name: /^All datasets / })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(box(), { target: { value: 'IGF1' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onSearchGene).toHaveBeenCalledWith('IGF1', null);
  });

  it('keeps a single heading and omits the explanatory subheader and example genes', () => {
    landing();
    expect(screen.getByRole('heading', { name: 'Gene Explorer' })).toBeInTheDocument();
    expect(screen.queryByText('Cross-dataset gene search')).toBeNull();
    expect(screen.queryByRole('button', { name: 'POMC' })).toBeNull();
    expect(document.querySelector('.qsearch-sub')).toBeNull();
  });

  it('offers the study picker closed, and opens it on request', () => {
    landing();
    const toggle = screen.getByRole('button', { name: /^Datasets/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Closed, so no study checkbox is in the document to collide with the
    // report's own per-dataset buttons.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    act(() => { fireEvent.click(toggle); });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
  });

  it('reports a study de-selection as a function of the previous scope', () => {
    // The panel emits an updater rather than a value, so two toggles landing in
    // one React batch cannot drop each other.
    const { onDatasetScopeChange } = landing();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^Datasets/ })); });
    const boxes = screen.getAllByRole('checkbox');
    act(() => { fireEvent.click(boxes[0]); });
    expect(onDatasetScopeChange).toHaveBeenCalledTimes(1);
    const update = onDatasetScopeChange.mock.calls[0][0] as (prev: string[] | null) => string[] | null;
    expect(typeof update).toBe('function');
    // From "all", one tick drops exactly one study rather than selecting one.
    const next = update(null);
    expect(next).not.toBeNull();
    expect((next as string[]).length).toBeGreaterThan(1);
  });
});

describe('rankSuggestions', () => {
  const index = ['ABCPOMC', 'POMC', 'POMC1', 'NPY'];

  it('puts prefix matches ahead of interior ones for genes', () => {
    expect(rankSuggestions(index, 'POMC')).toEqual(['POMC', 'POMC1', 'ABCPOMC']);
  });

  it('matches anywhere, in index order, in substring mode', () => {
    expect(rankSuggestions(index, 'POMC', true)).toEqual(['ABCPOMC', 'POMC', 'POMC1']);
  });

  it('stays quiet until there is enough to go on', () => {
    expect(rankSuggestions(index, 'P')).toEqual([]);
    expect(rankSuggestions(index, '')).toEqual([]);
  });
});

describe('useSearchIndex', () => {
  // Both explorers warm their autocomplete through this hook, and neither
  // treats a failure as an error: the box still works, it just stops
  // suggesting. Every branch here fails SILENTLY by design, which is exactly
  // why none of them would be noticed regressing.
  function Probe({ load }: { load: () => Promise<string[]> }) {
    const index = useSearchIndex(load);
    return <output data-testid="idx">{index.join(',')}</output>;
  }
  const shown = () => screen.getByTestId('idx').textContent;

  it('publishes the vocabulary once it resolves', async () => {
    const load = vi.fn().mockResolvedValue(['POMC', 'AGRP']);
    render(<Probe load={load} />);
    // Empty first: the box is usable before the names file lands.
    expect(shown()).toBe('');
    await act(async () => { await Promise.resolve(); });
    expect(shown()).toBe('POMC,AGRP');
  });

  it('swallows a rejected load and leaves the box suggestion-less', async () => {
    const load = vi.fn().mockRejectedValue(new Error('names file 404'));
    render(<Probe load={load} />);
    await act(async () => { await Promise.resolve(); });
    // No throw, no error boundary, no crash — just nothing to suggest.
    expect(shown()).toBe('');
  });

  it('loads once per mount even when the caller passes a fresh closure', async () => {
    // The corpus vocabulary is one request; a hook that re-fired on every
    // render would turn the autocomplete into a request per keystroke.
    // Both call sites hand over a stable module function TODAY, so an
    // identity-stable rerender proves nothing — the empty dep array alone
    // would pass it. The realistic regression is a call site growing an
    // argument (`useSearchIndex(() => loadGeneIndex({ datasets }))`), which
    // makes `load` a new function every render. The `started` ref is what
    // holds then, so that is what this drives.
    const spy = vi.fn().mockResolvedValue(['POMC']);
    const fresh = () => spy();
    const { rerender } = render(<Probe load={() => spy()} />);
    rerender(<Probe load={fresh} />);
    rerender(<Probe load={() => spy()} />);
    await act(async () => { await Promise.resolve(); });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not publish into a component that has unmounted', async () => {
    // Navigating away from the landing before the names file lands must not
    // set state on the gone component. The guard is the cancel flag; without
    // it React logs an update-on-unmounted warning and the test would see it.
    let resolve: (v: string[]) => void = () => {};
    const load = () => new Promise<string[]>((r) => { resolve = r; });
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<Probe load={load} />);
    unmount();
    await act(async () => { resolve(['POMC']); await Promise.resolve(); });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
