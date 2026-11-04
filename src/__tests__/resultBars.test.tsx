import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ResultBars, ResultScaleLegend, ResultSummaryRows, barFraction, discoveryScaleMax } from '../library/ResultBars';
import { cardGlobalName, type DiscoverySummary } from '../data/queryIndex';
import { getDataset } from '../data/datasets';
import { _resetBundleCache, _setBundleTransport } from '../data/bundleSource';

// The library card's result bars. These pin the one thing the feature can get
// scientifically wrong: conflating "this index does not carry the number" with
// "this study found nothing". Both render, and they must never render alike —
// 62 of the corpus's 161 default tracks genuinely find zero genes at FDR 0.05,
// so zero is a common ANSWER here, not an empty state.

afterEach(() => {
  _setBundleTransport(null);
  _resetBundleCache();
});

const DATASET = getDataset('mouse_arc_agrp_trap_gse240484')!;

function discoveries(over: Partial<DiscoverySummary> = {}): DiscoverySummary {
  return {
    genes: 491, genesUp: 339, genesDown: 152, genesTested: 15242,
    paths: 121, pathsUp: 116, pathsDown: 5, pathsTested: 4866,
    pathsByDb: {
      GO_BP: { up: 36, down: 4, tested: 3629 },
      REACTOME: { up: 62, down: 0, tested: 1030 },
    },
    tracksWithGenes: 1,
    ...over,
  };
}

const renderBars = (d: DiscoverySummary | null) => render(
  <ResultBars dataset={DATASET} discoveries={d} scaleMax={10154} trackNoun="track" />,
);

describe('barFraction', () => {
  it('maps zero to zero, so a null result cannot occupy the bar', () => {
    expect(barFraction(0, 10154)).toBe(0);
  });

  it('separates the small counts a linear axis would collapse', () => {
    // The corpus median is 1 and its maximum is 10,154. On a linear axis both 1
    // and 491 round to a hairline; the whole reason for log1p is that they do
    // not here.
    const one = barFraction(1, 10154);
    const many = barFraction(491, 10154);
    expect(one).toBeGreaterThan(0);
    expect(many / one).toBeGreaterThan(5);
  });

  it('never exceeds the track', () => {
    expect(barFraction(99999, 10154)).toBe(1);
  });
});

describe('discoveryScaleMax', () => {
  it('spans genes and pathways together, so the two bars share one axis', () => {
    expect(discoveryScaleMax([
      { discoveries: discoveries({ genes: 10, paths: 900 }) },
      { discoveries: discoveries({ genes: 40, paths: 2 }) },
    ])).toBe(900);
  });

  it('ignores cards the index has no counts for', () => {
    expect(discoveryScaleMax([
      { discoveries: null },
      { discoveries: discoveries({ genes: 7, paths: 0 }) },
    ])).toBe(7);
  });
});

describe('ResultBars', () => {
  it('prints the count and its direction split', () => {
    renderBars(discoveries());
    expect(screen.getByText('491')).toBeTruthy();
    expect(screen.getByRole('button', { name: /491 of 15,242 genes at FDR 0.05/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /339 up, 152 down/ })).toBeTruthy();
  });

  it('says none in words when the study found nothing', () => {
    // The state 38% of the corpus is in. A stub bar would read as "a few".
    renderBars(discoveries({ genes: 0, genesUp: 0, genesDown: 0, tracksWithGenes: 0 }));
    expect(screen.getByText(/none at FDR/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /No genes reach FDR 0.05 of 15,242 tested/ })).toBeTruthy();
  });

  it('renders nothing at all when the index carries no counts', () => {
    // NOT a pair of empty bars. An index older than this feature has no claim
    // to make, and zeroes here would invent one.
    const { container } = renderBars(null);
    expect(container.textContent).toBe('');
  });

  it('distinguishes a pathway count that was never computed from one of zero', () => {
    const { rerender } = renderBars(discoveries({ paths: 0, pathsUp: 0, pathsDown: 0, pathsByDb: {} }));
    expect(screen.getAllByText(/none at FDR/).length).toBe(1);

    rerender(<ResultBars dataset={DATASET} scaleMax={10154} trackNoun="track"
      discoveries={discoveries({ paths: null, pathsUp: null, pathsDown: null, pathsTested: null, pathsByDb: null })} />);
    // A dash, and no popover to open: there is nothing to say about it.
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /pathways/ })).toBeNull();
  });

  it('opens a detail panel on hover and closes it on Escape', async () => {
    renderBars(discoveries());
    const bar = screen.getByRole('button', { name: /genes at FDR/ });
    fireEvent.mouseEnter(bar);
    const panel = await screen.findByRole('tooltip', { name: 'Differential expression detail' });
    expect(within(panel).getByText(/of 15,242 genes at FDR 0.05/)).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('breaks the pathway panel down by database, with each direction split', () => {
    // GO:BP and Reactome disagree about direction often enough that a single
    // pooled up/down would hide the interesting half of the result.
    renderBars(discoveries());
    fireEvent.mouseEnter(screen.getByRole('button', { name: /terms at FDR|pathways at FDR/ }));
    const panel = screen.getByRole('tooltip', { name: 'Pathway enrichment detail' });
    expect(within(panel).getByText('GO:BP')).toBeTruthy();
    expect(within(panel).getByText('Reactome')).toBeTruthy();
    expect(within(panel).getByText(/of 4,866 terms at FDR 0.05/)).toBeTruthy();
  });

  it('keeps one panel on screen when a second card opens its own', async () => {
    // Each card owns its open state, so nothing stops two floating panels over
    // the grid when a pointer jumps straight from one card to another.
    render(<>
      <ResultBars dataset={DATASET} discoveries={discoveries()} scaleMax={10154} trackNoun="track" />
      <ResultBars dataset={DATASET} discoveries={discoveries()} scaleMax={10154} trackNoun="track" />
    </>);
    const bars = screen.getAllByRole('button', { name: /genes at FDR/ });
    fireEvent.mouseEnter(bars[0]);
    expect(screen.getAllByRole('tooltip').length).toBe(1);
    fireEvent.mouseEnter(bars[1]);
    expect(screen.getAllByRole('tooltip').length).toBe(1);
  });

  it('degrades to its counts when the volcano cloud is unavailable', async () => {
    // The cloud is a separate ~7 KB file; a deploy that predates it must still
    // show the numbers, which came from the manifest and are still true.
    _setBundleTransport(async () => ({ status: 'load-failed' }));
    renderBars(discoveries());
    fireEvent.mouseEnter(screen.getByRole('button', { name: /genes at FDR/ }));
    const panel = await screen.findByRole('tooltip', { name: 'Differential expression detail' });
    await waitFor(() => expect(within(panel).getByText('plot unavailable')).toBeTruthy());
    expect(within(panel).getByText(/of 15,242 genes at FDR 0.05/)).toBeTruthy();
  });
});

describe('ResultScaleLegend', () => {
  it('describes the axis the bars are actually drawing', () => {
    // The legend is one of the three things that make a log bar readable, with
    // the decade ticks and the printed count. A legend naming decades the grid
    // does not draw would be worse than none.
    const { container } = render(<ResultScaleLegend scaleMax={10154} />);
    const text = container.textContent ?? '';
    expect(text).toContain('10 \u00b7 100 \u00b7 1,000 \u00b7 10,000');
    expect(text).toContain('full width at 10,154');
    expect(text).toContain('FDR 0.05');
  });

  it('drops decades past the corpus maximum', () => {
    const { container } = render(<ResultScaleLegend scaleMax={40} />);
    expect(container.textContent).toContain('ticks at 10,');
    expect(container.textContent).not.toContain('100 \u00b7');
  });
});

describe('ResultSummaryRows', () => {
  it('keeps the counts in the study record the card came from', () => {
    render(<ResultSummaryRows discoveries={discoveries()} />);
    expect(screen.getByText('Genes')).toBeTruthy();
    expect(screen.getByText('491')).toBeTruthy();
    expect(screen.getByText(/339 up/)).toBeTruthy();
  });

  it('writes a measured zero as none, not as a blank', () => {
    render(<ResultSummaryRows discoveries={discoveries({ genes: 0, genesUp: 0, genesDown: 0 })} />);
    expect(screen.getByText('none')).toBeTruthy();
    expect(screen.getByText(/of 15,242 tested/)).toBeTruthy();
  });

  it('says so when the default track does not speak for the study', () => {
    render(<ResultSummaryRows discoveries={discoveries({ genes: 0, tracksWithGenes: 20 })} />);
    expect(screen.getByText(/20 tracks in this study find genes/)).toBeTruthy();
  });

  it('renders nothing when the index carries no counts', () => {
    const { container } = render(<ResultSummaryRows discoveries={null} />);
    expect(container.textContent).toBe('');
  });
});

describe('the card-detail wire contract', () => {
  it('derives the same JSONP global the builder writes', () => {
    // scripts/build_query_index.mts has its own copy of this function. The two
    // are a wire contract: if they drift, every popover silently loses its plot
    // and nothing else fails.
    expect(cardGlobalName('mouse_arc_hfd_gse225038')).toBe('HX_QUERY_CARD_MOUSE_ARC_HFD_GSE225038');
    expect(cardGlobalName('emtab-15488')).toBe('HX_QUERY_CARD_EMTAB_15488');
  });
});
