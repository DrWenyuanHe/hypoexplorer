import { describe, it, expect } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach } from 'vitest';
import {
  axisPct, dirGlyph, directionColor, contrastLabel, SigPill, groupForestCategories,
  useCategoryScope, FilterChip,
} from '../crossdataset/forestReport';
import { listDatasets } from '../data/datasets';
import { listContrasts } from '../data/contrasts';
import { PageShell } from '../common/PageShell';
import type { ResolvedContrast } from '../types';

afterEach(cleanup);

describe('axisPct (shared zero-centered axis)', () => {
  it('maps -bound, 0, +bound to 0%, 50%, 100%', () => {
    expect(axisPct(-2, 2)).toBe(0);
    expect(axisPct(0, 2)).toBe(50);
    expect(axisPct(2, 2)).toBe(100);
  });
  it('clamps effects beyond the bound', () => {
    expect(axisPct(-5, 2)).toBe(0);
    expect(axisPct(5, 2)).toBe(100);
  });
});

describe('direction encoding (sign + arrow + text, never color alone)', () => {
  it('glyphs match direction', () => {
    expect(dirGlyph('up')).toBe('▲');
    expect(dirGlyph('down')).toBe('▼');
    expect(dirGlyph('flat')).toBe('–');
  });
  it('non-significant rows are muted regardless of direction', () => {
    expect(directionColor('up', false)).toBe('var(--text-muted)');
    expect(directionColor('up', true)).toBe('var(--color-obese)');
    expect(directionColor('down', true)).toBe('var(--color-normal)');
  });
});

describe('contrastLabel', () => {
  it('reads the resolved label and tolerates null', () => {
    const contrast = {
      label: 'HFD vs Chow',
      baseline: { key: 'chow', label: 'Chow', color: '#3775BA' },
      caseGroup: { key: 'hfd', label: 'HFD', color: '#B64342' },
    } as unknown as ResolvedContrast;
    expect(contrastLabel(contrast)).toBe('HFD vs Chow');
    expect(contrastLabel(null)).toBe('');
    expect(contrastLabel(undefined)).toBe('');
  });

  it('honours an AUTHORED label instead of recomputing "<case> vs <baseline>"', () => {
    // resolveContrast already applies the authored-label-wins rule; the report
    // header must not throw that away by re-deriving from the group labels.
    const contrast = {
      label: '24h fast (vs ad libitum)',
      baseline: { key: 'fed', label: 'Fed', color: '#3775BA' },
      caseGroup: { key: 'fast', label: 'Fasted', color: '#B64342' },
    } as unknown as ResolvedContrast;
    expect(contrastLabel(contrast)).toBe('24h fast (vs ad libitum)');
  });

  // Output-identity guard for reading `label` rather than recomputing it.
  //
  // This used to assert the derived form for EVERY shipping contrast, which held
  // only because no manifest had authored one yet. Authoring is allowed and is
  // the point of the field — GSE135639 does it, so a null volcano cannot read as
  // "the published study found nothing" — so the contract to pin is the rule,
  // not the historical fact: unauthored resolves to "<case> vs <baseline>", and
  // an authored label reaches the reports unchanged.
  it('resolves an unauthored contrast label, and passes an authored one through', () => {
    let authored = 0;
    for (const ds of listDatasets()) {
      const resolved = listContrasts(ds);
      for (const raw of ds.contrasts) {
        const c = resolved.find((r) => r.id === raw.id)!;
        expect(c, `${ds.id}/${raw.id}`).toBeTruthy();
        if (raw.label) {
          authored++;
          expect(c.label, `${ds.id}/${raw.id}`).toBe(raw.label);
        } else {
          expect(c.label, `${ds.id}/${raw.id}`).toBe(`${c.caseGroup.label} vs ${c.baseline.label}`);
        }
      }
    }
    // Guard the guard: if this hits zero the authored branch above is dead.
    expect(authored).toBeGreaterThan(0);
  });
});

describe('useCategoryScope', () => {
  function Harness({ scope }: { scope?: string[] | null }) {
    const { activeCats, setActiveCats, toggleCat } = useCategoryScope(scope);
    return (
      <div>
        <span data-testid="active">{activeCats ? [...activeCats].join('+') : 'all'}</span>
        <FilterChip label="All" count={0} active={activeCats === null} onClick={() => setActiveCats(null)} />
        {['A', 'B'].map((c) => (
          <FilterChip key={c} label={c} count={1} active={!!activeCats?.has(c)} onClick={() => toggleCat(c)} />
        ))}
      </div>
    );
  }
  const active = () => screen.getByTestId('active').textContent;

  it('seeds from the incoming scope, else null (= all)', () => {
    const { unmount } = render(<Harness scope={null} />);
    expect(active()).toBe('all');
    unmount();
    render(<Harness scope={['B']} />);
    expect(active()).toBe('B');
  });

  it('re-seeds when the scope identity changes', () => {
    const { rerender } = render(<Harness scope={['A']} />);
    expect(active()).toBe('A');
    rerender(<Harness scope={['B']} />);
    expect(active()).toBe('B');
  });

  it('collapses an emptied selection back to null (= all), never to an empty view', () => {
    render(<Harness scope={null} />);
    fireEvent.click(screen.getByRole('button', { name: /^A / }));
    expect(active()).toBe('A');
    fireEvent.click(screen.getByRole('button', { name: /^B / }));
    expect(active()).toBe('A+B');
    fireEvent.click(screen.getByRole('button', { name: /^A / }));
    expect(active()).toBe('B');
    fireEvent.click(screen.getByRole('button', { name: /^B / }));
    expect(active()).toBe('all');
  });

  it('marks the active chip with aria-pressed', () => {
    render(<Harness scope={['A']} />);
    expect(screen.getByRole('button', { name: /^A / })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^B / })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^All / })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('SigPill', () => {
  it('renders n.s. for non-significant and the direction word otherwise', () => {
    const { rerender } = render(<SigPill direction="up" significant={false} />);
    expect(screen.getByText('n.s.')).toBeInTheDocument();
    rerender(<SigPill direction="up" significant={true} />);
    expect(screen.getByText('up')).toBeInTheDocument();
    rerender(<SigPill direction="down" significant={true} />);
    expect(screen.getByText('down')).toBeInTheDocument();
  });
});

describe('groupForestCategories', () => {
  const order = ['A', 'B', 'C'] as const;
  it('orders categories canonically regardless of input order, dropping empty ones', () => {
    const groups = [
      { id: 1, cat: 'C' }, { id: 2, cat: 'A' }, { id: 3, cat: 'C' },
    ];
    const out = groupForestCategories(groups, { order, categoryOf: (g) => g.cat as 'A' | 'B' | 'C' });
    expect(out.map((c) => c.category)).toEqual(['A', 'C']);
    expect(out[1].groups.map((g) => g.id)).toEqual([1, 3]);
  });
  it('returns an empty list for no groups', () => {
    expect(groupForestCategories([], { order, categoryOf: () => 'A' as const })).toEqual([]);
  });
});

describe('PageShell', () => {
  it('renders the logo, Home crumb, breadcrumbs and children; Home fires onHome', () => {
    let homes = 0;
    render(
      <PageShell onHome={() => { homes++; }} breadcrumbs={[{ label: 'Pathway search' }, { label: 'ADIPOGENESIS', current: true }]}>
        <div>page-body</div>
      </PageShell>,
    );
    expect(screen.getByRole('link', { name: 'HypoExplorer home' })).toBeInTheDocument();
    expect(screen.getByText('Pathway search')).toBeInTheDocument();
    expect(screen.getByText('ADIPOGENESIS')).toBeInTheDocument();
    expect(screen.getByText('page-body')).toBeInTheDocument();
    screen.getByText('Home').click();
    screen.getByRole('link', { name: 'HypoExplorer home' }).click();
    expect(homes).toBe(2);
  });
});
