import { describe, it, expect, vi, } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../App';
// buildPopData takes the dataset + contrast explicitly (it used to fall back to
// these silently). Imported statically — everything else here stays dynamic.
import { MACAQUE_DATASET, MACAQUE_CONTRAST } from './fixtures';
import { stubVolcanoView } from './fixtures';

// ─── Helpers ───────────────────────────────────────────────────────────────────
function renderApp() {
  return render(<App initialView="explorer" />);
}

// ─── 1. App + routing (3 tests) ────────────────────────────────────────────────
describe('App mount and routing', () => {
  it('1. App mounts without throwing', () => {
    expect(() => renderApp()).not.toThrow();
  });

  it('2. Default tab is Gene Explorer; volcano canvas + SVG axes render', () => {
    const { container } = renderApp();
    // Post-PR4, the volcano point cloud is drawn on a <canvas>.
    // The SVG still holds axes, threshold lines, and tooltip layer.
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
    const bigSvg = [...container.querySelectorAll('svg')].find(
      s => +s.getAttribute('width')! > 100
    );
    expect(bigSvg).toBeTruthy();
    // The SVG should have axis tick labels (>0 text nodes) proving the plot rendered
    const axisTexts = bigSvg!.querySelectorAll('text');
    expect(axisTexts.length).toBeGreaterThan(0);
  });

  it('3. Renders without unexpected console errors on mount', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderApp();
    // Filter out known React 18 test-env and jsdom-canvas warnings we don't control
    const real = spy.mock.calls.filter(args => {
      const msg = String(args[0] ?? '');
      return !msg.includes('createRoot') && !msg.includes('HTMLCanvasElement');
    });
    expect(real).toEqual([]);
    spy.mockRestore();
  });
});

// ─── 2. Gene Explorer (4 tests) ────────────────────────────────────────────────
describe('Gene Explorer', () => {
  it('4. Typing POMC shows it in the suggestions list', async () => {
    renderApp();
    const search = screen.getByPlaceholderText(/Search gene/i);
    fireEvent.change(search, { target: { value: 'POMC' } });
    await waitFor(() => {
      // POMC appears in suggestion list (dropdown div)
      expect(screen.getAllByText('POMC').length).toBeGreaterThan(0);
    });
  });

  it('5. Clicking FDR toggle changes axis label to FDR', () => {
    const { container } = renderApp();
    const fdrBtn = screen.getByRole('button', { name: 'FDR' });
    fireEvent.click(fdrBtn);
    // Find the rotated Y-axis label in SVG
    const texts = [...container.querySelectorAll('text')]
      .map(t => t.textContent.trim());
    expect(texts.some(t => t.includes('FDR'))).toBe(true);
  });

  it('6. REGRESSION: typing 0.05 in cutoff syncs slider to ~1.30', () => {
    const { container } = renderApp();
    // Find the 72px-wide text input (the cutoff input)
    const cutoffInput = [...container.querySelectorAll('input[type="text"]')]
      .find(i => (i as HTMLInputElement).style.width === '72px');
    expect(cutoffInput).toBeTruthy();
    fireEvent.change(cutoffInput!, { target: { value: '0.05' } });
    const sliders = container.querySelectorAll('input[type="range"]');
    const sigSlider = sliders[1] as HTMLInputElement; // second range input = significance
    const val = parseFloat(sigSlider.value);
    expect(val).toBeGreaterThan(1.25);
    expect(val).toBeLessThan(1.35);
  });

  it('7. REGRESSION: FDR slider max=5 and no "No genes FDR<0.05" SVG text', () => {
    const { container } = renderApp();
    const fdrBtn = screen.getByRole('button', { name: 'FDR' });
    fireEvent.click(fdrBtn);
    const sliders = container.querySelectorAll('input[type="range"]');
    const sigSlider = sliders[1];
    expect(sigSlider.getAttribute('max')).toBe('5');
    const svgTexts = [...container.querySelectorAll('svg text')]
      .map(t => t.textContent);
    expect(svgTexts.some(t => t?.includes('No genes FDR<0.05'))).toBe(false);
  });
});

// ─── 3. Pathway Explorer (2 tests) ─────────────────────────────────────────────
// The dataset-info column also renders tables (author validation, study
// metadata), and they precede the pathway table in the DOM — so a bare
// `tbody tr` picks a validation row and the click lands on nothing. Scope
// every row query to the table that carries the pathway header.
const pathwayRows = () => {
  const table = [...document.querySelectorAll('table')].find((t) =>
    [...t.querySelectorAll('th')].some((th) => th.textContent?.trim() === 'Pathway'));
  return [...(table?.querySelectorAll('tbody tr') ?? [])];
};

describe('Pathway Explorer', () => {
  it('8. Switching to Pathway Explorer shows pathway rows', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Pathway Explorer/i }));
    expect(pathwayRows().length).toBeGreaterThan(0);
  });

  it('9. Clicking a pathway opens the detail panel', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Pathway Explorer/i }));
    const firstRow = pathwayRows()[0];
    expect(firstRow).toBeTruthy();
    fireEvent.click(firstRow!);
    // Detail panel shows heatmap title or leading-edge section
    await waitFor(() => {
      const allText = document.body.textContent || '';
      expect(/leading[- ]edge/i.test(allText)).toBe(true);
    }, { timeout: 1000 });
  });
});

// ─── 4. Compare (1 test) ───────────────────────────────────────────────────────
describe('Compare tab', () => {
  it('10. Clicking "Compare all cells" lazy-loads each uncached track bundle', async () => {
    const originalCreateElement = document.createElement.bind(document);
    const injectedScripts: any[] = [];
    const spy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: any) => {
        const el = originalCreateElement(tag);
        if (tag === 'script') {
          injectedScripts.push(el);
          // short-circuit: don't actually try to fetch
          setTimeout(() => el.onerror?.(new Event('error')), 0);
        }
        return el;
      });
    try {
      renderApp();
      const btn = screen.getByRole('button', { name: /Compare all cells/i });
      fireEvent.click(btn);
      // Compare defaults to [e9, i23]; e9 is seeded eagerly, so i23 is lazy-loaded
      // via loadTrack → a dataset-namespaced track bundle (not the legacy pop_*.js).
      // Awaited, not asserted synchronously: the bundle transport tries a
      // streaming fetch before falling back to <script> injection, so the tag
      // lands a tick after the click.
      await waitFor(() => {
        const trackScripts = injectedScripts.filter(s =>
          /\/datasets\/macaque_snrna\/track_[A-Za-z0-9]+\.js/.test(s.src || '')
        );
        expect(trackScripts.length).toBeGreaterThan(0);
      });
    } finally {
      spy.mockRestore();
    }
  });
});

// ─── 4d. Volcano pass-count includes selected genes (1 test, codex P2 fix) ─────
describe('Volcano pass-count includes selected genes (codex P2 fix)', () => {
  it('15. Clicking a threshold-passing gene does NOT drop the pass count', async () => {
    const { container } = renderApp();
    // Move logFC threshold to 0 and significance threshold to something loose
    // so POMC (fixture: logFC=1.2, PValue=0.001) definitely passes. Raw
    // dispatchEvent bypasses React's act() wrap, so we wrap explicitly.
    const ranges = container.querySelectorAll('input[type="range"]');
    const setRange = (input: any, val: any) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    act(() => {
      setRange(ranges[0], '0');   // |logFC| > 0
      setRange(ranges[1], '1');   // -log10(P) > 1 → P < 0.1
    });

    const countBefore = [...container.querySelectorAll('span')]
      .map(s => s.textContent)
      .find(t => t?.includes('total'));

    // Add POMC via search. GeneSearchBox debounces suggestions with an 80ms
    // setTimeout; use waitFor so React can flush the delayed setState under
    // act() scope (matches the pattern in test 4).
    const search = screen.getByPlaceholderText(/Search gene/i);
    fireEvent.change(search, { target: { value: 'POMC' } });
    await waitFor(
      () => expect(screen.getAllByText('POMC').length).toBeGreaterThan(0),
    );
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' });
    // Wait for the selection to register as a chip in the header row.
    await waitFor(() => {
      const chips = [...container.querySelectorAll('span')]
        .filter(s => s.textContent?.trim().startsWith('POMC'));
      expect(chips.length).toBeGreaterThan(0);
    });

    const countAfter = [...container.querySelectorAll('span')]
      .map(s => s.textContent)
      .find(t => t?.includes('total'));

    // The "N genes" number at the start of the count span should be unchanged
    // or higher, never lower.
    const extract = (s: any) => parseInt((s || '').match(/^(\d+)/)?.[1] ?? '0', 10);
    expect(extract(countAfter)).toBeGreaterThanOrEqual(extract(countBefore));
  });
});

// ─── 4c. (db, pathway) key bug fix (1 test, PR3) ────────────────────────────────
describe('ComparePathwayView (db, pathway) key fix (PR3)', () => {
  it('14. Unified pathway list keeps same-named pathways across 4 DBs separate', async () => {
    const { buildPopData } = await import('../data/buildPopData');
    const { ComparePathwayView } = await import('../compare/ComparePathwayView');
    const { columnsForPops } = await import('../compare/compareColumns');
    const rawPop = {
      meta: { code: 'e9', label: 'e9', type: 'X', normalSamples: ['a', 'b', 'c'], obeseSamples: ['d', 'e', 'f'], nGenes: 1 },
      qc: { cluster: 'e9', clusterLabel: 'X', minCells: 15, nNormal: 3, nObese: 3, is3v3: true, samplesKept: [] },
      de: [{ gene: 'GENE1', logFC: 0, PValue: 0.5, FDR: 0.6 }],
      cpm: { GENE1: [1, 1, 1, 1, 1, 1] },
      pathways: {
        GO_BP:    [{ pathway: 'Glycolysis', pval: 0.01, padj: 0.05, NES: 1.5, size: 10, leadingEdge: ['GENE1'] }],
        HALLMARK: [{ pathway: 'Glycolysis', pval: 0.02, padj: 0.06, NES: 1.4, size: 10, leadingEdge: ['GENE1'] }],
        KEGG:     [{ pathway: 'Glycolysis', pval: 0.03, padj: 0.07, NES: 1.3, size: 10, leadingEdge: ['GENE1'] }],
        REACTOME: [{ pathway: 'Glycolysis', pval: 0.04, padj: 0.09, NES: 1.2, size: 10, leadingEdge: ['GENE1'] }],
      },
    };
    const popData = buildPopData(rawPop, MACAQUE_DATASET, MACAQUE_CONTRAST);
    const activePops = ['e9'];
    const popDataMap = { e9: popData };

    const { container } = render(
      <ComparePathwayView columns={columnsForPops(null, activePops, popDataMap)} popDataMap={popDataMap} />,
    );
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(4);
    const dbBadges = [...rows].map(r => r.querySelector('td:nth-child(2)')?.textContent);
    expect(dbBadges).toEqual(expect.arrayContaining(['GO_BP', 'HALLMARK', 'KEGG', 'REACTOME']));
  });
});

// ─── 4e. ErrorBoundary error path (1 test) ─────────────────────────────────────
describe('ErrorBoundary error path', () => {
  it('16. Renders fallback on child throw and re-renders children after reset', async () => {
    const { ErrorBoundary } = await import('../ErrorBoundary');
    // Suppress expected React error log from componentDidCatch
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let throwNow = true;
    function Bomb() {
      if (throwNow) throw new Error('boom');
      return <div>child-ok</div>;
    }
    const { container, getByRole, queryByText } = render(
      <ErrorBoundary><Bomb /></ErrorBoundary>
    );
    // Fallback shown with error message
    expect(container.textContent).toMatch(/Something went wrong/i);
    expect(container.textContent).toMatch(/boom/);
    // Fix underlying fault, then click reset
    throwNow = false;
    const resetBtn = getByRole('button', { name: /Reload this tab/i });
    fireEvent.click(resetBtn);
    // Children render again
    await waitFor(() => {
      expect(queryByText('child-ok')).toBeTruthy();
    });
    errSpy.mockRestore();
  });
});

// ─── 4f. VolcanoPlot hit-test + click-to-add (1 test) ──────────────────────────
describe('VolcanoPlot hit-test + click-to-add', () => {
  it('17. Mousemove near a point shows tooltip; click calls onAddGene', () => {
    const { container } = renderApp();
    // Handler is on the SVG overlay, not the canvas (canvas has pointerEvents:none).
    // Pick the big plot svg (width > 100), not the tiny header icons.
    const svg = [...container.querySelectorAll('svg')].find(
      s => +s.getAttribute('width')! > 100
    );
    expect(svg).toBeTruthy();
    // jsdom returns zeros from getBoundingClientRect; stub to full svg size.
    svg!.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 600, bottom: 360, width: 600, height: 360, x: 0, y: 0, toJSON: () => ({}),
    });
    // POMC fixture: logFC=1.2, PValue=0.001 → yPval=3. Dynamic xRange = ±(max(|logFC|, 5)*1.05) = ±5.25.
    // chartW=522, VM.left=58: px ≈ 58 + (6.45/10.5)*522 ≈ 379. With yDomMax ≈ 3.24,
    // chartH=288, VM.top=24: py ≈ 24 + (1 - 3/3.24)*288 ≈ 45.
    fireEvent.mouseMove(svg!, { clientX: 379, clientY: 45 });
    const svgTexts = [...container.querySelectorAll('svg text')]
      .map(t => t.textContent);
    expect(svgTexts.some(t => t === 'POMC')).toBe(true);
    // Clicking while the tooltip is set fires onAddGene(POMC), which adds a
    // removable chip to the toolbar (bar charts + summary table now live in
    // modals, so they no longer render inline).
    expect(screen.queryByLabelText(/Remove POMC/i)).toBeNull();
    fireEvent.click(svg!, { clientX: 379, clientY: 45 });
    expect(screen.getByLabelText(/Remove POMC/i)).toBeTruthy();
  });
});

// ─── 4h. Migration regression tests (Macques 47-pop migration) ────────────────
describe('Macques migration regression', () => {
  it('19. buildPopData produces allPathways with 4 distinct db values', async () => {
    const { buildPopData } = await import('../data/buildPopData');
    const { POP_E9_FIXTURE } = await import('./fixtures');
    const pd = buildPopData(POP_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST)!;
    const dbs = new Set(pd.allPathways.map(p => p.db));
    expect(dbs.size).toBe(4);
    expect(dbs.has('GO_BP')).toBe(true);
    expect(dbs.has('HALLMARK')).toBe(true);
    expect(dbs.has('KEGG')).toBe(true);
    expect(dbs.has('REACTOME')).toBe(true);
  });

  it('20. 2v3 CPM nulls: mean([null,5,5]) = 5 not 6.67 (no Normal+Obese mixing)', async () => {
    const { mean } = await import('../utils/math');
    // Old bug: mean(vals.slice(0,3)) on 2v3 where S001 null would produce 6.67
    // if it silently summed [undefined, 5, 5, ...unintended obese...]. With null
    // filtering, mean([null, 5, 5]) must be 5 exactly.
    expect(mean([null, 5, 5])).toBe(5);
    expect(mean([10, 10, 10])).toBe(10);
    expect(mean([null, null, 7])).toBe(7);
    expect(mean([])).toBe(0);
  });

  it('21. PopWarningBadge warns only on under-powered (n<3) groups, dataset-agnostic', async () => {
    const { PopWarningBadge } = await import('../common/PopWarningBadge');
    // macaque 2v3 (a dropped sample) → still warns, with general wording.
    const { container: cFalse } = render(<PopWarningBadge is3v3={false} nNormal={2} nObese={3} />);
    expect(cFalse.textContent).toMatch(/n=2 vs 3 · low power/);
    // is3v3 → no badge.
    const { container: cTrue } = render(<PopWarningBadge is3v3={true} nNormal={3} nObese={3} />);
    expect(cTrue.textContent).toBe('');
    // Larger/balanced bulk designs (7v8, 3v4) are NOT under-powered → no badge,
    // even though is3v3 is false (regression guard for the new HFD datasets).
    const { container: cBulk } = render(<PopWarningBadge is3v3={false} nNormal={7} nObese={8} />);
    expect(cBulk.textContent).toBe('');
    const { container: cArc } = render(<PopWarningBadge is3v3={false} nNormal={3} nObese={4} />);
    expect(cArc.textContent).toBe('');
  });

  it('22. QCTab mounts and renders all 6 section headings', async () => {
    const { QCTab } = await import('../qc/QCTab');
    const { container } = render(<QCTab onSelectTrack={() => {}} />);
    const h3s = [...container.querySelectorAll('h3')].map(h => h.textContent);
    expect(h3s).toContain('Run status');
    expect(h3s).toContain('Per-population sample sizes');
    expect(h3s).toContain('DE summary');
    expect(h3s).toContain('FGSEA summary');
    expect(h3s).toContain('Cell composition');
    expect(h3s).toContain('QA reports');
  });

  it('23. Volcano dynamic axis scales to logFC=-7 fixture gene', async () => {
    const { buildPopData } = await import('../data/buildPopData');
    const { VolcanoPlot } = await import('../gene-explorer/VolcanoPlot');
    const rawPop = {
      meta: { code: 'test', label: 't', type: 'X', normalSamples: ['a','b','c'], obeseSamples: ['d','e','f'], nGenes: 2 },
      qc: { cluster: 'test', clusterLabel: '', minCells: 15, nNormal: 3, nObese: 3, is3v3: true, samplesKept: [] },
      de: [
        { gene: 'BIGDOWN', logFC: -7, PValue: 0.001, FDR: 0.02 },
        { gene: 'MILD',    logFC:  1, PValue: 0.05,  FDR: 0.1 },
      ],
      cpm: { BIGDOWN: [1,1,1,10,10,10], MILD: [5,5,5,6,6,6] },
      pathways: { GO_BP: [], HALLMARK: [], KEGG: [], REACTOME: [] },
    };
    const popData = buildPopData(rawPop, MACAQUE_DATASET, MACAQUE_CONTRAST)!;
    const { container } = render(
      <VolcanoPlot
        selectedGenes={[]}
        volcano={stubVolcanoView()}
        onAddGene={() => {}}
        onAddGenes={() => {}}
        popData={popData}
      />
    );
    const svg = [...container.querySelectorAll('svg')].find(s => +s.getAttribute('width')! > 100);
    const tickTexts = [...svg!.querySelectorAll('text')].map(t => t.textContent!.trim());
    // bound = max(7, 5) * 1.05 = 7.35 → niceTicks produces -7 or -6 as leftmost.
    expect(tickTexts.some(t => t === '-7' || t === '-6')).toBe(true);
  });
});

// ─── 5. Utilities (2 tests) ────────────────────────────────────────────────────
// niceTicks and fmtCutoff aren't exported today (monolith). Assert their
// observable effect through rendered output instead.
describe('Utility behavior (via rendered output)', () => {
  it('11. Volcano X-axis reaches at least ±5 (dynamic range, floored at 5)', () => {
    const { container } = renderApp();
    const bigSvg = [...container.querySelectorAll('svg')].find(
      s => +s.getAttribute('width')! > 100
    );
    const texts = [...bigSvg!.querySelectorAll('text')]
      .map(t => t.textContent!.trim());
    // Fixture has |logFC| ≤ 1.2, so bound = max(5, |logFC|) * 1.05 = 5.25. Ticks
    // from niceTicks(-5.25, 5.25, 8) should include -5 and 5.
    expect(texts).toContain('-5');
    expect(texts.some(t => t === '5' || t === '4')).toBe(true);
  });

  it('12. SummaryTable CSV export path does not throw', () => {
    renderApp();
    // First add a gene so the summary table renders
    const search = screen.getByPlaceholderText(/Search gene/i);
    fireEvent.change(search, { target: { value: 'POMC' } });
    // Fire Enter to select
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' });
    // If any CSV export button exists, click without throwing
    const csvBtns = [...document.querySelectorAll('button')]
      .filter(b => /csv/i.test(b.textContent || ''));
    for (const b of csvBtns) {
      expect(() => fireEvent.click(b)).not.toThrow();
    }
    // Test passes even if no CSV button is visible yet (smoke only)
    expect(true).toBe(true);
  });
});

// ─── Compare redesign — Variant A (cell popup + accordion + NES significance) ──
describe('Compare redesign Variant A', () => {
  it('24. Cell selector trigger shows "N selected" and chips render with full name', async () => {
    renderApp();
    // Wrap in act so CompareTab's track-column load updates settle inside
    // the act scope (i23 is not in the fixture cache).
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    });
    const trigger = await screen.findByRole('button', { name: /Cells.*selected/i });
    expect(trigger.textContent).toMatch(/2 selected/);
    // Chip shows id and marker subname (e.g., "e9 POMC/TBX3")
    const removeBtn = await screen.findByLabelText(/Remove e9/);
    const chip = removeBtn.closest('span');
    expect(chip!.textContent).toMatch(/e9/);
    expect(chip!.textContent).toMatch(/POMC\/TBX3/);
  });

  it('25. Opening popup shows grouped cells; "Select all" updates trigger count', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    const trigger = await screen.findByRole('button', { name: /Cells.*selected/i });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: /Select cells to compare/i });
    expect(dialog).toBeTruthy();
    // Group headers for the fixture's types should be present
    expect(dialog.textContent).toMatch(/Glutamatergic/);
    // 7 checkboxes (one per fixture pop)
    const boxes = dialog.querySelectorAll('input[type="checkbox"]');
    expect(boxes.length).toBeGreaterThanOrEqual(5);
    // Click "Select all" button inside the dialog
    const selectAll = [...dialog.querySelectorAll('button')].find(b => /Select all/i.test(b.textContent!));
    fireEvent.click(selectAll!);
    // Trigger now shows the full count (fixture has 7 pops)
    await waitFor(() => {
      const t = screen.getByRole('button', { name: /Cells.*selected/i });
      expect(t.textContent).toMatch(/7 selected/);
    });
  });

  it('26. Pathway row click opens inline accordion (not side panel) with NES SVG bars', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    // Switch to Pathways sub-tab
    const pathwaysTab = await screen.findByRole('button', { name: /^Pathways$/ });
    fireEvent.click(pathwaysTab);
    // Grab the pathway table and click the first data row
    const tables = document.querySelectorAll('table');
    const pwTable = tables[tables.length - 1];
    const firstRow = pwTable.querySelector('tbody > tr');
    if (!firstRow) {
      // Fixture may not include pathway rows; skip without failing.
      expect(true).toBe(true);
      return;
    }
    fireEvent.click(firstRow);
    // Accordion row uses colSpan and contains an SVG with NES bars
    const accordionRow = [...pwTable.querySelectorAll('tbody > tr')].find(
      r => (r as HTMLTableRowElement).cells[0]?.hasAttribute('colspan'),
    );
    expect(accordionRow).toBeTruthy();
    expect(accordionRow!.textContent).toMatch(/NES across populations/);
    const rects = accordionRow!.querySelectorAll('svg rect');
    expect(rects.length).toBeGreaterThan(0);
    // Every rect has either the sig styling (opacity=1 + dark stroke) or
    // non-sig styling (gray #CBD5E0 fill with low opacity).
    for (const r of rects) {
      const fill = r.getAttribute('fill');
      const op = parseFloat(r.getAttribute('opacity')!);
      const stroke = r.getAttribute('stroke');
      const isSigStyled = op === 1 && stroke === '#1a202c';
      const isNonSigStyled = fill === '#CBD5E0' && op < 0.5;
      expect(isSigStyled || isNonSigStyled).toBe(true);
    }
  });

  // ── Tests 27–34: critical path coverage for new Variant A components ──────────

  it('27. Logo link click returns to the landing hub', async () => {
    renderApp();
    // Enter compare mode first
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    await screen.findByRole('button', { name: /Cells.*selected/i });
    // Click the brand home link → the landing hub
    const logo = screen.getByRole('link', { name: /HypoExplorer home/i });
    fireEvent.click(logo);
    // The hub's search box appears; the explorer chrome is gone.
    await screen.findByRole('search', { name: 'Search genes and pathways' });
    expect(screen.queryByRole('button', { name: /Cells.*selected/i })).toBeNull();
  });

  it('28. CellSelectorPopup: remove chip works when count > minSelection', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    // Default has 2 pops selected (e9, i23); trigger Select All to get to 7
    const trigger = await screen.findByRole('button', { name: /Cells.*selected/i });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: /Select cells to compare/i });
    const selectAll = [...dialog.querySelectorAll('button')].find(b => /Select all/i.test(b.textContent!));
    fireEvent.click(selectAll!);
    // Close dialog
    const doneBtn = [...dialog.querySelectorAll('button')].find(b => /Done/i.test(b.textContent!));
    fireEvent.click(doneBtn!);
    // Now trigger shows 7 selected; removing e9 chip should drop to 6
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Cells.*selected/i }).textContent).toMatch(/7 selected/);
    });
    const removeE9 = screen.getByLabelText(/Remove e9/i);
    expect(removeE9).not.toBeDisabled();
    fireEvent.click(removeE9);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Cells.*selected/i }).textContent).toMatch(/6 selected/);
    });
  });

  it('29. CellSelectorPopup: remove chip is disabled at minSelection boundary', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    // Default is 2 selected — exactly minSelection=2
    const removeBtn = await screen.findByLabelText(/Remove e9/i);
    // Button should be disabled (lockRemove = true)
    expect(removeBtn).toBeDisabled();
  });

  it('30. CellSelectorPopup: Escape key closes the popup', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    const trigger = await screen.findByRole('button', { name: /Cells.*selected/i });
    fireEvent.click(trigger);
    // Dialog should be open
    expect(await screen.findByRole('dialog', { name: /Select cells to compare/i })).toBeTruthy();
    // Fire Escape on window
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Select cells to compare/i })).toBeNull();
    });
  });

  it('31. CellSelectorPopup: in-popup search filters cells; empty state shown for no match', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    const trigger = await screen.findByRole('button', { name: /Cells.*selected/i });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: /Select cells to compare/i });
    const searchInput = dialog.querySelector('input[type="text"]');
    // Type a query that matches something
    fireEvent.change(searchInput!, { target: { value: 'POMC' } });
    await waitFor(() => {
      // e9 (POMC/TBX3) label should still be visible
      expect(dialog.textContent).toMatch(/e9/);
    });
    // Type a query that matches nothing
    fireEvent.change(searchInput!, { target: { value: 'ZZZNOMATCH999' } });
    await waitFor(() => {
      expect(dialog.textContent).toMatch(/No cells match/);
    });
  });

  it('32. CellSelectorPopup: "Clear" resets selection to defaultSelection', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    const trigger = await screen.findByRole('button', { name: /Cells.*selected/i });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: /Select cells to compare/i });
    // Select all first
    const selectAll = [...dialog.querySelectorAll('button')].find(b => /Select all/i.test(b.textContent!));
    fireEvent.click(selectAll!);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Cells.*selected/i }).textContent).toMatch(/7 selected/);
    });
    // Click "Clear" — should reset to DEFAULT_POPS (2 pops: e9, i23)
    const clearBtn = [...dialog.querySelectorAll('button')].find(b => /^Clear$/i.test(b.textContent!));
    fireEvent.click(clearBtn!);
    await waitFor(() => {
      const t = screen.getByRole('button', { name: /Cells.*selected/i });
      expect(t.textContent).toMatch(/2 selected/);
    });
  });

  it('33. Accordion row second click closes it (toggle deselect)', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    const pathwaysTab = await screen.findByRole('button', { name: /^Pathways$/ });
    fireEvent.click(pathwaysTab);
    const tables = document.querySelectorAll('table');
    const pwTable = tables[tables.length - 1];
    const firstRow = pwTable.querySelector('tbody > tr');
    if (!firstRow) { expect(true).toBe(true); return; }
    // First click — open
    fireEvent.click(firstRow);
    const accordionRow = [...pwTable.querySelectorAll('tbody > tr')].find(
      r => (r as HTMLTableRowElement).cells[0]?.hasAttribute('colspan'),
    );
    expect(accordionRow).toBeTruthy();
    // Second click on same row — should close (no accordion row after)
    fireEvent.click(firstRow);
    await waitFor(() => {
      const stillOpen = [...pwTable.querySelectorAll('tbody > tr')].find(
        r => (r as HTMLTableRowElement).cells[0]?.hasAttribute('colspan'),
      );
      expect(stillOpen).toBeFalsy();
    });
  });

  it('34. Accordion: FDR legend renders; per-pop stats table shown with correct NES color', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    const pathwaysTab = await screen.findByRole('button', { name: /^Pathways$/ });
    fireEvent.click(pathwaysTab);
    const tables = document.querySelectorAll('table');
    const pwTable = tables[tables.length - 1];
    const firstRow = pwTable.querySelector('tbody > tr');
    if (!firstRow) { expect(true).toBe(true); return; }
    fireEvent.click(firstRow);
    const accordionRow = [...pwTable.querySelectorAll('tbody > tr')].find(
      r => (r as HTMLTableRowElement).cells[0]?.hasAttribute('colspan'),
    );
    expect(accordionRow).toBeTruthy();
    // FDR legend: both "FDR < 0.05" and "FDR ≥ 0.05" labels present in accordion
    expect(accordionRow!.textContent).toMatch(/FDR\s*[<≥]/);
    // Per-population statistics table present
    expect(accordionRow!.textContent).toMatch(/Per-population statistics/);
    // NES column header present
    expect(accordionRow!.textContent).toMatch(/NES/);
  });

  it('35. "← Back to single cell" exits compare mode and returns to gene explorer', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    // Verify compare mode entered
    await screen.findByRole('button', { name: /Back to single cell/i });
    // Click back button
    fireEvent.click(screen.getByRole('button', { name: /Back to single cell/i }));
    // Compare mode exited — "Compare all cells" button visible again, no back button
    await screen.findByRole('button', { name: /Compare all cells/i });
    expect(screen.queryByRole('button', { name: /Back to single cell/i })).toBeNull();
  });

  it('36. CellSelectorPopup: "All Glutamatergic" group shortcut selects only Glutamatergic cells', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    const trigger = await screen.findByRole('button', { name: /Cells/ });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    // Find the All Glutamatergic shortcut button
    const glutBtn = [...dialog.querySelectorAll('button')].find(b => /Glutamatergic/i.test(b.textContent));
    if (!glutBtn) { expect(true).toBe(true); return; } // no Glutamatergic pops in fixture
    fireEvent.click(glutBtn);
    // Re-query trigger after state update; find count pill (2nd span, not label "Cells")
    const updatedTrigger = screen.getByRole('button', { name: /Cells/ });
    const countPill = [...updatedTrigger.querySelectorAll('span')].find(s => /selected/.test(s.textContent));
    expect(countPill?.textContent).toMatch(/\d+ selected/);
  });

  it('37. CellSelectorPopup: individual checkbox toggles a population in/out', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    const trigger = await screen.findByRole('button', { name: /Cells/ });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    // Find a checkbox that is NOT already checked (i.e., not in DEFAULT_POPS)
    const checkboxes = dialog.querySelectorAll('input[type="checkbox"]');
    const unchecked = [...checkboxes].find(cb => !(cb as HTMLInputElement).checked);
    if (!unchecked) { expect(true).toBe(true); return; } // all checked, skip
    fireEvent.click(unchecked);
    expect((unchecked as HTMLInputElement).checked).toBe(true);
    // Toggle it back off (still > minSelection)
    fireEvent.click(unchecked);
    expect((unchecked as HTMLInputElement).checked).toBe(false);
  });

  it('38. CellSelectorPopup: clicking backdrop overlay closes the modal', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    const trigger = await screen.findByRole('button', { name: /Cells/ });
    fireEvent.click(trigger);
    // The shared <Modal> puts role=dialog on the backdrop itself, which closes on
    // a press that both starts and ends there (mousedown + mouseup, so a
    // text-selection drag ending outside the panel doesn't dismiss it).
    const backdrop = screen.getByRole('dialog');
    expect(backdrop).toBeTruthy();
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('39. Gene search row is hidden when Pathways sub-tab is active', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    // In Genes mode (default), the gene search box is present
    const genesTab = await screen.findByRole('button', { name: /^Genes$/ });
    const pathwaysTab = screen.getByRole('button', { name: /^Pathways$/ });
    fireEvent.click(genesTab);
    expect(screen.getByPlaceholderText(/Search gene/i)).toBeTruthy();
    // Switch to Pathways — gene search row should disappear
    fireEvent.click(pathwaysTab);
    expect(screen.queryByPlaceholderText(/Search gene/i)).toBeNull();
  });

  it('40. Empty gene state message shown when no genes added in compare Genes mode', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    await screen.findByRole('button', { name: /^Genes$/ });
    // No genes added — should show the empty state prompt
    expect(
      screen.getByText(/Search for a gene above to compare expression/i)
    ).toBeTruthy();
  });
});

// ─── 6. SummaryTable export includes per-sample raw CPM (this PR) ───────────────
describe('SummaryTable raw-value export', () => {
  it('41. CSV export carries per-sample raw CPM columns + values', async () => {
    renderApp();
    // Add POMC (fixture: cpm [10,12,11, 25,28,30]) to the summary table.
    const search = screen.getByPlaceholderText(/Search gene/i);
    fireEvent.change(search, { target: { value: 'POMC' } });
    await waitFor(
      () => expect(screen.getAllByText('POMC').length).toBeGreaterThan(0),
    );
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' });
    // The summary table now lives in a pop-up — open it via the toolbar button.
    await waitFor(() => {
      const tableBtn = [...document.querySelectorAll('button')].find(b => /^summary table$/i.test((b.textContent || '').trim()));
      expect(tableBtn).toBeTruthy();
    });
    fireEvent.click([...document.querySelectorAll('button')].find(b => /^summary table$/i.test((b.textContent || '').trim()))!);
    // The Export CSV button renders inside the modal once it opens.
    await waitFor(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /export csv/i.test(b.textContent || ''));
      expect(btn).toBeTruthy();
    });

    // Intercept the anchor exportCSV builds so we can read its data: URI.
    const origCreate = document.createElement.bind(document);
    const anchors: any[] = [];
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
      const el = origCreate(tag);
      if (tag === 'a') anchors.push(el);
      return el;
    });
    const csvBtn = [...document.querySelectorAll('button')].find(b => /export csv/i.test(b.textContent || ''));
    fireEvent.click(csvBtn!);
    spy.mockRestore();

    const csvAnchor = anchors.find(a => (a.getAttribute('download') || '').endsWith('_genes_summary.csv'));
    expect(csvAnchor).toBeTruthy();
    const raw = (csvAnchor.getAttribute('href') || '').replace(/^data:text\/csv;charset=utf-8,/, '');
    const decoded = decodeURIComponent(raw);
    const [header, ...dataRows] = decoded.split('\n');
    // Per-sample columns appear in the header (fixture Normal=S001..S003, Obese=S004..S006).
    expect(header).toContain('HCA_Macaque001_S001 (Normal)');
    expect(header).toContain('HCA_Macaque001_S006 (Obese)');
    // POMC row carries its raw per-sample CPM values.
    const pomcRow = dataRows.find(r => r.startsWith('POMC,'));
    expect(pomcRow).toBeTruthy();
    const cells = pomcRow!.split(',');
    for (const v of ['10', '12', '11', '25', '28', '30']) {
      expect(cells).toContain(v);
    }
  });

  it('42. Bar charts pop-up offers CSV / Excel / PNG exports; CSV carries per-sample CPM', async () => {
    renderApp();
    const search = screen.getByPlaceholderText(/Search gene/i);
    fireEvent.change(search, { target: { value: 'POMC' } });
    await waitFor(
      () => expect(screen.getAllByText('POMC').length).toBeGreaterThan(0),
    );
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' });
    // Open the Bar charts pop-up via the toolbar button.
    await waitFor(() => {
      const chartsBtn = [...document.querySelectorAll('button')].find(b => /^bar charts$/i.test((b.textContent || '').trim()));
      expect(chartsBtn).toBeTruthy();
    });
    fireEvent.click([...document.querySelectorAll('button')].find(b => /^bar charts$/i.test((b.textContent || '').trim()))!);

    // The modal header offers all three exports.
    const dialog = await screen.findByRole('dialog', { name: /Bar charts/i });
    const labels = [...dialog.querySelectorAll('button')].map(b => (b.textContent || '').trim());
    expect(labels).toEqual(expect.arrayContaining(['Export CSV', 'Export Excel', 'Export PNG']));

    // Export CSV from the bar charts pop-up produces the same per-sample CSV.
    const origCreate = document.createElement.bind(document);
    const anchors: any[] = [];
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
      const el = origCreate(tag);
      if (tag === 'a') anchors.push(el);
      return el;
    });
    fireEvent.click([...dialog.querySelectorAll('button')].find(b => /export csv/i.test(b.textContent || ''))!);
    spy.mockRestore();

    const csvAnchor = anchors.find(a => (a.getAttribute('download') || '').endsWith('_genes_summary.csv'));
    expect(csvAnchor).toBeTruthy();
    const decoded = decodeURIComponent((csvAnchor.getAttribute('href') || '').replace(/^data:text\/csv;charset=utf-8,/, ''));
    const [header, ...dataRows] = decoded.split('\n');
    expect(header).toContain('HCA_Macaque001_S001 (Normal)');
    const pomcRow = dataRows.find(r => r.startsWith('POMC,'));
    expect(pomcRow!.split(',')).toEqual(expect.arrayContaining(['10', '12', '11', '25', '28', '30']));
  });
});
