import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PathwayToolbar, type PathwayToolbarProps } from '../pathway-explorer/PathwayToolbar';
import { ComparePathwayView } from '../compare/ComparePathwayView';
import { columnsForPops } from '../compare/compareColumns';
import { buildPopData } from '../data/buildPopData';
import { DB_NAMES, DB_DEFAULT_FILTER } from '../data/constants';
import { POP_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST } from './fixtures';

// The toolbar above the pathway-table seam. The single-track view's copy was
// covered through PathwayExplorerTab (pathwayExplorer.test.tsx); the Compare
// view's copy had NO coverage, which is exactly where it drifted — it never
// gained the 'All' page size, the `pageSize !== 'all'` pager guard, or the
// spaced page indicator. Both are the same component now, and these pin the
// converged behaviour at the component itself.

const dbBoxes = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
const sizeSelect = (container: HTMLElement) => container.querySelector('select')!;

function renderToolbar(overrides: Partial<PathwayToolbarProps> = {}) {
  const props: PathwayToolbarProps = {
    dbFilter: { ...DB_DEFAULT_FILTER },
    onDatabaseToggle: vi.fn(),
    pageSize: 25,
    setPageSize: vi.fn(),
    setPage: vi.fn(),
    totalPages: 1,
    safePage: 1,
    total: 0,
    ...overrides,
  };
  return { props, ...render(<PathwayToolbar {...props} />) };
}

describe('PathwayToolbar — database toggles', () => {
  it('renders one checkbox per database, in DB_NAMES order', () => {
    // Tests (and users) address these by position, so the order is contract.
    const { container } = renderToolbar();
    expect(dbBoxes(container)).toHaveLength(DB_NAMES.length);
    for (const db of DB_NAMES) {
      expect(screen.getByRole('checkbox', { name: db })).toBeTruthy();
    }
  });

  it('reflects the filter it is given rather than local state', () => {
    const { container } = renderToolbar({
      dbFilter: { GO_BP: true, HALLMARK: false, KEGG: true, REACTOME: false },
    });
    expect(dbBoxes(container).map((b) => b.checked)).toEqual([true, false, true, false]);
  });

  it('flips exactly the toggled database, leaving the rest alone', () => {
    // Driven through real state: the toolbar hands its setter an updater over
    // the previous map, so the other three keys must survive the round trip.
    function Harness() {
      const [dbFilter, setDbFilter] = useState<Record<string, boolean>>({ ...DB_DEFAULT_FILTER });
      return (
        <PathwayToolbar
          dbFilter={dbFilter}
          onDatabaseToggle={(db, enabled) => setDbFilter((prev) => ({ ...prev, [db]: enabled }))}
          pageSize={25} setPageSize={() => {}} setPage={() => {}}
          totalPages={1} safePage={1} total={0}
        />
      );
    }
    const { container } = render(<Harness />);
    fireEvent.click(dbBoxes(container)[1]); // HALLMARK
    expect(dbBoxes(container).map((b) => b.checked)).toEqual([true, false, true, true]);

    fireEvent.click(dbBoxes(container)[1]);
    expect(dbBoxes(container).map((b) => b.checked)).toEqual([true, true, true, true]);
  });
});

describe('PathwayToolbar — page size', () => {
  it('offers the paged sizes plus All', () => {
    const { container } = renderToolbar();
    expect([...sizeSelect(container).options].map((o) => o.value))
      .toEqual(['25', '50', '100', '250', 'all']);
  });

  it("reports 'all' as the sentinel, not NaN", () => {
    // The Compare copy read `Number(e.target.value)` — had it carried the All
    // option, choosing it would have set the page size to NaN and blanked the
    // table (every slice bound becomes NaN).
    const setPageSize = vi.fn();
    const { container } = renderToolbar({ setPageSize });
    fireEvent.change(sizeSelect(container), { target: { value: 'all' } });
    expect(setPageSize).toHaveBeenCalledWith('all');
  });

  it('reports a numeric size as a number', () => {
    const setPageSize = vi.fn();
    const { container } = renderToolbar({ setPageSize });
    fireEvent.change(sizeSelect(container), { target: { value: '250' } });
    expect(setPageSize).toHaveBeenCalledWith(250);
  });
});

describe('PathwayToolbar — pager', () => {
  it('hides the pager when there is only one page', () => {
    renderToolbar({ totalPages: 1, safePage: 1 });
    expect(screen.queryByRole('button', { name: '‹' })).toBeNull();
  });

  it("hides the pager for an unpaged ('all') table even if totalPages says otherwise", () => {
    renderToolbar({ pageSize: 'all', totalPages: 3, safePage: 1 });
    expect(screen.queryByRole('button', { name: '›' })).toBeNull();
  });

  it('shows the spaced page indicator and steps the page', () => {
    const setPage = vi.fn();
    renderToolbar({ pageSize: 25, totalPages: 3, safePage: 2, setPage, total: 60 });
    expect(screen.getByText('2 / 3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '›' }));
    const next = setPage.mock.calls[0][0] as (p: number) => number;
    expect(next(2)).toBe(3);
    expect(next(3)).toBe(3); // clamped at the last page

    fireEvent.click(screen.getByRole('button', { name: '‹' }));
    const prev = setPage.mock.calls[1][0] as (p: number) => number;
    expect(prev(2)).toBe(1);
    expect(prev(1)).toBe(1); // clamped at the first page
  });

  it('disables the arrow that would leave the range', () => {
    renderToolbar({ pageSize: 25, totalPages: 3, safePage: 1 });
    expect(screen.getByRole('button', { name: '‹' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '›' })).not.toBeDisabled();
  });

  it('renders the filtered row count', () => {
    renderToolbar({ total: 42 });
    expect(screen.getByText('(42 total)')).toBeTruthy();
  });
});

// The Compare view mounts standalone: it takes the active dataset's meta, the
// selected populations and their popData as plain props.
const popData = buildPopData(POP_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST)!;

describe('ComparePathwayView — toolbar wiring', () => {
  it('filters the cross-population table by the DB toggles', () => {
    // The e9 fixture has 8 pathways, 2 per database.
    const { container } = render(
      <ComparePathwayView columns={columnsForPops(null, ['e9'], { e9: popData })} popDataMap={{ e9: popData }} />,
    );
    expect(screen.getByText('(8 total)')).toBeTruthy();
    fireEvent.click(dbBoxes(container)[1]); // HALLMARK
    expect(screen.getByText('(6 total)')).toBeTruthy();
  });

  it("offers the All page size it used to lack, and takes it without blanking the table", () => {
    const { container } = render(
      <ComparePathwayView columns={columnsForPops(null, ['e9'], { e9: popData })} popDataMap={{ e9: popData }} />,
    );
    const select = sizeSelect(container);
    expect([...select.options].map((o) => o.value)).toContain('all');

    fireEvent.change(select, { target: { value: 'all' } });
    expect(select.value).toBe('all');
    expect(screen.getByText('(8 total)')).toBeTruthy();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(8);
  });
});
