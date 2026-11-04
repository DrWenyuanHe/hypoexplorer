import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LeadingEdgeHeatmap } from '../pathway-explorer/LeadingEdgeHeatmap';
import type { PopData, ResolvedContrast } from '../types';
import { makePopData } from './fixtures';

// A 4-sample dataset (2 control + 2 case) — deliberately NOT the macaque 6, and
// deliberately NOT the fixture's normal/obese arms, to prove the rewrite drives
// off popData.sampleOrder/groups instead of hardcoding 6 (or macaque labels).
// buildPopData derives groups FROM the contrast (they are the same two objects),
// so the override carries both; the legend reads its labels through the
// group-label seam on popData.contrast.
const CHOW_HFD_CONTRAST: ResolvedContrast = {
  id: 'hfd_vs_chow',
  baseline: { key: 'chow', label: 'Chow', color: '#888888' },
  caseGroup: { key: 'hfd', label: 'HFD', color: '#F0A500' },
  supportsPathways: true,
  label: 'HFD vs Chow',
};

function popData4(): PopData {
  return makePopData({
    de: [{ gene: 'Pomc', logFC: 1.2, PValue: 0.01, FDR: 0.04, se: 0.3 }],
    cpm: { Pomc: [10, 12, null, 18] }, // one dropped (null) slot
    meta: { sampleOrder: ['c1', 'c2', 'h1', 'h2'] },
    contrast: CHOW_HFD_CONTRAST,
    groups: [CHOW_HFD_CONTRAST.baseline, CHOW_HFD_CONTRAST.caseGroup],
    groupSamples: { chow: ['c1', 'c2'], hfd: ['h1', 'h2'] },
    sampleOrder: ['c1', 'c2', 'h1', 'h2'],
  });
}

describe('LeadingEdgeHeatmap (n-agnostic)', () => {
  it('renders the empty state when there are no leading-edge genes', () => {
    const { getByText } = render(<LeadingEdgeHeatmap leadingEdge={[]} popData={popData4()} />);
    expect(getByText(/No leading edge genes/i)).toBeTruthy();
  });

  it('renders the dataset’s real sample count + group structure (not a hardcoded 6/Normal-Obese)', () => {
    const { container } = render(<LeadingEdgeHeatmap leadingEdge={['Pomc']} popData={popData4()} />);
    // n reflects the single resolvable leading-edge gene, unit is the dataset's.
    // (Header is split across text nodes, so assert on the container text.)
    expect(container.textContent).toContain('Leading-edge genes, n=1');
    expect(container.textContent).toContain('CPM');
    // The group legend shows THIS dataset's labels, not Normal/Obese.
    expect(container.textContent).toContain('Chow');
    expect(container.textContent).toContain('HFD');
    expect(container.textContent).not.toContain('Obese');
    // 4 column headers (one per sample), one group-bar rect per sample (4), and
    // a header text per sample tail — driven by the 4-element sampleOrder.
    const svg = container.querySelector('svg[aria-label="Leading edge gene heatmap"]');
    expect(svg).toBeTruthy();
    const headerTexts = [...(svg?.querySelectorAll('text') ?? [])]
      .filter((t) => Number(t.getAttribute('y')) < 30)
      .map((t) => t.textContent);
    expect(headerTexts).toEqual(['c1', 'c2', 'h1', 'h2']);
  });
});

// ── Characterization golden ──────────────────────────────────────────────────
// Pins the rendered output across the move onto the sample-value seam. Two edge
// cases the seam must NOT quietly change:
//   (a) a sample present in sampleOrder but in NEITHER arm — its column is grey
//       in the group bar, and its values still take part in the z-score and the
//       cell/tooltip render (it is a rendered column, not a dropped one);
//   (b) a leading-edge gene absent from the cpm matrix — every one of its cells
//       renders as the hatched "dropped from QC" slot.
const UNASSIGNED_ORDER = ['c1', 'c2', 'x9', 'h1', 'h2'];

function popDataUnassigned(): PopData {
  return makePopData({
    de: [
      { gene: 'Pomc', logFC: 1.2, PValue: 0.01, FDR: 0.04 },
      { gene: 'Agrp', logFC: -0.5, PValue: 0.2, FDR: 0.3 },
    ],
    // Agrp is in the DE table but deliberately absent from cpm.
    cpm: { Pomc: [10, 12, 50, 18, 20] },
    meta: { sampleOrder: UNASSIGNED_ORDER },
    contrast: CHOW_HFD_CONTRAST,
    groups: [CHOW_HFD_CONTRAST.baseline, CHOW_HFD_CONTRAST.caseGroup],
    // x9 is in sampleOrder but in neither arm.
    groupSamples: { chow: ['c1', 'c2'], hfd: ['h1', 'h2'] },
    sampleOrder: UNASSIGNED_ORDER,
  });
}

describe('LeadingEdgeHeatmap (golden: unassigned sample + gene missing from cpm)', () => {
  it('renders every sampleOrder column, greys the unassigned one, and drops a cpm-less gene', () => {
    const { container } = render(
      <LeadingEdgeHeatmap leadingEdge={['Pomc', 'Agrp', 'Ghost']} popData={popDataUnassigned()} />,
    );
    const svg = container.querySelector('svg[aria-label="Leading edge gene heatmap"]');
    expect(svg).toBeTruthy();
    const rects = [...(svg?.querySelectorAll('rect') ?? [])];
    // The group bar is GROUP_H=8 tall; heatmap cells are CELL_H-1=17.
    const groupBar = rects.filter((r) => r.getAttribute('height') === '8');
    const cells = rects.filter((r) => r.getAttribute('height') === '17');

    // 'Ghost' has no DE record → dropped; the other two genes render, sorted by
    // logFC descending (Pomc +1.2 then Agrp −0.5).
    expect(container.textContent).toContain('Leading-edge genes, n=2');

    // Column headers follow sampleOrder, unassigned sample included.
    const headerTexts = [...(svg?.querySelectorAll('text') ?? [])]
      .filter((t) => Number(t.getAttribute('y')) < 30)
      .map((t) => t.textContent);
    expect(headerTexts).toEqual(['c1', 'c2', 'x9', 'h1', 'h2']);

    // Group bar: baseline grey, case gold, and the neither-arm sample's own grey.
    expect(groupBar.map((r) => r.getAttribute('fill'))).toEqual([
      '#888888', '#888888', '#cccccc', '#F0A500', '#F0A500',
    ]);

    // 2 genes × 5 columns. Fills pin the z-scoring: x9's value (50) is part of
    // the mean/sd, so every Pomc cell colour depends on the unassigned sample.
    expect(cells).toHaveLength(10);
    expect(cells.map((r) => r.getAttribute('fill'))).toEqual([
      'rgb(181,199,219)', 'rgb(193,208,225)', 'rgb(255,93,92)', 'rgb(230,236,243)', 'rgb(243,246,249)',
      '#e5e7eb', '#e5e7eb', '#e5e7eb', '#e5e7eb', '#e5e7eb',
    ]);
    // Only the cpm-less gene's row is hatched; the unassigned column is not.
    expect(cells.map((r) => r.getAttribute('stroke-dasharray'))).toEqual([
      'none', 'none', 'none', 'none', 'none',
      '2,2', '2,2', '2,2', '2,2', '2,2',
    ]);
    // Tooltips: the unassigned sample's value is rendered like any other; the
    // cpm-less gene reads "dropped from QC" in every column.
    expect(cells.map((r) => r.querySelector('title')?.textContent)).toEqual([
      'Pomc · c1 · 10.0 · z: -0.83',
      'Pomc · c2 · 12.0 · z: -0.69',
      'Pomc · x9 · 50.0 · z: 1.93',
      'Pomc · h1 · 18.0 · z: -0.28',
      'Pomc · h2 · 20.0 · z: -0.14',
      'Agrp · c1 · dropped from QC',
      'Agrp · c2 · dropped from QC',
      'Agrp · x9 · dropped from QC',
      'Agrp · h1 · dropped from QC',
      'Agrp · h2 · dropped from QC',
    ]);
  });
});
