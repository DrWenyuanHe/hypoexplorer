import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useExportAction, exportFilename, downloadFile } from '../utils/exportAction';
import { ExportButton } from '../common/ExportButton';

// The export-action seam: the busy state, the filename and the transport that
// every export click used to spell out for itself.

// The sanitizer exactly as the five call sites spelled it before extraction —
// the goldens below are written against THIS, so a change to the character
// class shows up as a filename diff rather than as a passing test.
const legacy = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_');
const NASTY = 'Signaling by NOTCH1 t(7;9) */?"<>|\\dir';

describe('exportFilename', () => {
  it('reproduces every migrated call site byte-for-byte', () => {
    // PathwayExplorerTab — `${meta.code}_${safeName}.xlsx`
    expect(exportFilename(['e9', NASTY], 'xlsx')).toBe(`e9_${legacy(NASTY)}.xlsx`);
    // GeneExplorerTab (pathway detail) — `${meta.code}_${safeGene}_${safeName}.xlsx`
    expect(exportFilename(['e9', 'POMC', NASTY], 'xlsx')).toBe(`e9_POMC_${legacy(NASTY)}.xlsx`);
    // GeneExplorerTab (pathway list) — `${meta.code}_${safeGene}_leading_pathways.xlsx`
    expect(exportFilename(['e9', 'POMC', 'leading_pathways'], 'xlsx')).toBe('e9_POMC_leading_pathways.xlsx');
    // LeadingEdgeGenesView — `${code}_${safeName}_leadingedge.xlsx`
    expect(exportFilename(['e9', NASTY, 'leadingedge'], 'xlsx')).toBe(`e9_${legacy(NASTY)}_leadingedge.xlsx`);
    // ComparePathwayView — `hypoexplorer_${safeName}_leadingedge.xlsx`
    expect(exportFilename(['hypoexplorer', NASTY, 'leadingedge'], 'xlsx'))
      .toBe(`hypoexplorer_${legacy(NASTY)}_leadingedge.xlsx`);
  });

  it('reproduces the four fixed-suffix filenames that used to skip the sanitizer', () => {
    // These four were built by template literal with no scrub at all. Every
    // registered track code is [A-Za-z0-9_], so routing them through the
    // sanitizer is a no-op TODAY — these goldens are what keeps it one.
    // geneExport — `${popData.meta?.code}_genes_summary.csv`
    expect(exportFilename(['e9', 'genes_summary'], 'csv')).toBe('e9_genes_summary.csv');
    // geneExport — `${meta?.code}_genes_export.xlsx`
    expect(exportFilename(['e9', 'genes_export'], 'xlsx')).toBe('e9_genes_export.xlsx');
    // PathwayExplorerTab — `${popData.meta?.code}_pathways_export.xlsx`
    expect(exportFilename(['whole', 'pathways_export'], 'xlsx')).toBe('whole_pathways_export.xlsx');
    // GeneExplorerTab — `${popData.meta?.code}_bar_charts.png`
    expect(exportFilename(['Ependy1', 'bar_charts'], 'png')).toBe('Ependy1_bar_charts.png');
    // …and a missing track code still stringifies exactly as the templates did.
    expect(exportFilename([undefined, 'bar_charts'], 'png')).toBe('undefined_bar_charts.png');
  });

  it('replaces every character a filesystem rejects, and nothing else', () => {
    expect(exportFilename(['a\\b/c:d*e?f"g<h>i|j'], 'xlsx')).toBe('a_b_c_d_e_f_g_h_i_j.xlsx');
    // Spaces, parentheses, dots and dashes are legal and must survive.
    expect(exportFilename(['GO (2.1) alpha-beta'], 'xlsx')).toBe('GO (2.1) alpha-beta.xlsx');
  });

  it('keeps the literal "undefined" a missing track code stringified to', () => {
    // The templates this replaces read `${popData.meta?.code}` — a track loaded
    // without meta produced "undefined_…", and the filenames are user-visible
    // artifacts, so the move is byte-for-byte rather than a cleanup.
    expect(exportFilename([undefined, 'GO Glycolysis', 'leadingedge'], 'xlsx'))
      .toBe('undefined_GO Glycolysis_leadingedge.xlsx');
  });
});

describe('downloadFile', () => {
  it('hands the href to an anchor carrying the filename and clicks it', () => {
    const anchors: HTMLAnchorElement[] = [];
    const orig = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
      const el = orig(tag);
      if (tag === 'a') anchors.push(el as HTMLAnchorElement);
      return el;
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    downloadFile('e9_genes_summary.csv', 'data:text/csv;charset=utf-8,Gene%2ClogFC');
    spy.mockRestore();

    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute('download')).toBe('e9_genes_summary.csv');
    expect(anchors[0].getAttribute('href')).toBe('data:text/csv;charset=utf-8,Gene%2ClogFC');
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
});

describe('useExportAction', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('holds busy until the export settles, THEN starts the settle delay', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const { result } = renderHook(() => useExportAction(500));

    act(() => { result.current.run(() => pending); });
    expect(result.current.busy).toBe(true);

    // The defect this seam fixes: the delay is not a parallel animation. Even
    // long past it, a still-running export keeps the button busy.
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(result.current.busy).toBe(true);

    await act(async () => { finish(); await Promise.resolve(); });
    expect(result.current.busy).toBe(true);

    await act(async () => { vi.advanceTimersByTime(500); });
    expect(result.current.busy).toBe(false);
  });

  it('clears a synchronous export after the delay it was given', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useExportAction(1000));
    act(() => { result.current.run(() => {}); });
    expect(result.current.busy).toBe(true);
    // The settle is scheduled off the export's own promise — let that microtask
    // land before moving the clock, or the delay would be measured from before
    // the export finished (the very defect this seam removes).
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(999); });
    expect(result.current.busy).toBe(true);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(result.current.busy).toBe(false);
  });

  it('ignores a second click while an export is running', async () => {
    vi.useFakeTimers();
    const start = vi.fn(() => new Promise<void>(() => {}));
    const { result } = renderHook(() => useExportAction());
    act(() => { result.current.run(start); });
    act(() => { result.current.run(start); });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('clears busy even when the export body throws', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useExportAction(100));
    act(() => {
      expect(() => result.current.run(() => { throw new Error('boom'); })).toThrow('boom');
    });
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(result.current.busy).toBe(false);
  });

  it('does not fire a pending settle after unmount', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useExportAction(1000));
    act(() => { result.current.run(() => {}); });
    unmount();
    await act(async () => { vi.advanceTimersByTime(2000); });
    // No "update on an unmounted component" fallout — the cleanup cleared it.
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ExportButton', () => {
  afterEach(() => { cleanup(); });

  it('shows the idle label and runs the export on click', () => {
    const onClick = vi.fn();
    render(<ExportButton onClick={onClick} busy={false} busyLabel="Exporting…" spinnerSize={11}>Export Excel</ExportButton>);
    const btn = screen.getByRole('button', { name: 'Export Excel' });
    expect(btn.querySelector('.spinner')).toBeNull();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables itself and swaps in the busy label while busy', () => {
    render(<ExportButton onClick={() => {}} busy={true} busyLabel="Exporting…" spinnerSize={11}>Export Excel</ExportButton>);
    const btn = screen.getByRole('button', { name: 'Exporting…' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    // The spinner is decorative (aria-hidden), so the accessible name above is
    // the busy TEXT alone — which is what every test in the suite queries by.
    const ring = btn.querySelector('.spinner') as HTMLElement;
    expect(ring.style.width).toBe('11px');
    expect(ring.style.height).toBe('11px');
  });

  it('renders a text-only busy label when no spinner size is given', () => {
    render(<ExportButton onClick={() => {}} busy={true} busyLabel="Downloading…">Export Excel</ExportButton>);
    const btn = screen.getByRole('button', { name: 'Downloading…' });
    expect(btn.querySelector('.spinner')).toBeNull();
    // …and no inline-flex row either: the layout exists only for the spinner.
    expect(btn.style.display).toBe('');
  });

  it('stays disabled for a caller-supplied reason while idle', () => {
    render(<ExportButton onClick={() => {}} busy={false} busyLabel="Exporting…" disabled>Export pathway list</ExportButton>);
    expect((screen.getByRole('button', { name: 'Export pathway list' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps each site\'s busy wording verbatim — the drift is deliberate', () => {
    // Three vocabularies and two spinner sizes are what the nine call sites
    // render TODAY. Consolidating the structure must not reword any of them, so
    // the words stay props and this table pins them.
    const sites: Array<[string, number | undefined]> = [
      ['Downloading…', undefined],   // SummaryTable, LeadingEdgeGenesView
      ['Downloading...', undefined], // ComparePathwayView ×2 (ASCII ellipsis)
      ['Exporting…', 10],            // CompareTab
      ['Exporting…', 11],            // PathwayExplorerTab, GeneExplorerTab ×2, PathwayDetailPanel
    ];
    for (const [busyLabel, spinnerSize] of sites) {
      const { container, unmount } = render(
        <ExportButton onClick={() => {}} busy={true} busyLabel={busyLabel} spinnerSize={spinnerSize}>Export Excel</ExportButton>,
      );
      const btn = container.querySelector('button') as HTMLButtonElement;
      expect(btn.textContent).toBe(busyLabel);
      expect((btn.querySelector('.spinner') as HTMLElement | null)?.style.width)
        .toBe(spinnerSize == null ? undefined : `${spinnerSize}px`);
      unmount();
    }
  });
});
