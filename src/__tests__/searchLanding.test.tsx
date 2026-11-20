import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DatasetScopePanel, useSearchIndex } from '../crossdataset/searchLanding';
import { listDatasets } from '../data/datasets';

// The study-scope controls the gene and pathway reports share. The reports'
// own suites cover them in place; these pin the picker's contract directly.
describe('DatasetScopePanel', () => {
  function picker() {
    const onChange = vi.fn();
    render(<DatasetScopePanel datasets={listDatasets()} selected={null} onChange={onChange} />);
    return { onChange };
  }

  it('offers the study picker closed, and opens it on request', () => {
    picker();
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
    const { onChange } = picker();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^Datasets/ })); });
    const boxes = screen.getAllByRole('checkbox');
    act(() => { fireEvent.click(boxes[0]); });
    expect(onChange).toHaveBeenCalledTimes(1);
    const update = onChange.mock.calls[0][0] as (prev: string[] | null) => string[] | null;
    expect(typeof update).toBe('function');
    // From "all", one tick drops exactly one study rather than selecting one.
    const next = update(null);
    expect(next).not.toBeNull();
    expect((next as string[]).length).toBeGreaterThan(1);
  });
});

describe('useSearchIndex', () => {
  // The pathway report warms its autocomplete through this hook, and does not
  // treat a failure as an error: the box still works, it just stops
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
    // The call site hands over a stable module function TODAY, so an
    // identity-stable rerender proves nothing — the empty dep array alone
    // would pass it. The realistic regression is a call site growing an
    // argument (`useSearchIndex(() => loadPathwayIndex({ datasets }))`), which
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
    // Navigating away from the report before the names file lands must not
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
