import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CircadianControls, scanOptionLabel, type CircadianControlsProps } from '../circadian/CircadianControls';
import { PhaseMap, densestWindow, phaseLattice } from '../circadian/PhaseMap';

afterEach(cleanup);

function renderControls(overrides: Partial<CircadianControlsProps> = {}) {
  const props: CircadianControlsProps = {
    method: 'jtk', setMethod: vi.fn(), periodMode: 'scan', setPeriodMode: vi.fn(),
    arm: 'chow', setArm: vi.fn(), arms: [{ key: 'chow', label: 'Chow', color: '#4C78A8' }],
    adjust: 'bh', setAdjust: vi.fn(), threshold: 0.05, setThreshold: vi.fn(),
    qLabel: 'q', summary: <div>12 rhythmic</div>,
    ...overrides,
  };
  return render(<CircadianControls {...props} />);
}

describe('CircadianControls labels', () => {
  it('keeps the adjusted-value symbol in its true case inside the uppercased threshold label', () => {
    renderControls();
    const label = screen.getByText('Threshold', { exact: false, selector: 'label' });
    expect(label).toHaveStyle({ textTransform: 'uppercase', fontSize: '11px', fontWeight: '600' });
    const symbol = label.querySelector('span');
    expect(symbol?.textContent).toBe('q');
    expect(symbol).toHaveStyle({ textTransform: 'none' });
    expect(screen.getByLabelText('Threshold (q)')).toBeInstanceOf(HTMLSelectElement);
  });

  it('shows p, not q, when no correction is applied', () => {
    renderControls({ adjust: 'none', qLabel: 'p' });
    expect(screen.getByLabelText('Threshold (p)')).toBeInstanceOf(HTMLSelectElement);
  });

  it('describes each select with the note for its current choice', () => {
    renderControls({ method: 'cosinor', effectivePeriods: undefined });
    expect(screen.getByLabelText('Rhythm test')).toHaveAccessibleDescription(/F test/);
    expect(screen.getByLabelText('Correction')).toHaveAccessibleDescription(/false discovery rate/);
    expect(screen.getByText('About these settings')).toBeInTheDocument();
  });

  it('qualifies the Lomb–Scargle power cap by the sampled phases', () => {
    renderControls({ method: 'ls', periodMode: 'fixed24' });
    const test = screen.getByLabelText('Rhythm test');
    expect(test).toHaveAccessibleDescription(
      /When the sampled phases support both a sine and a cosine term at every tested period, normalized power is capped at \(N−1\)\/2/,
    );
    expect(test).toHaveAccessibleDescription(/states that floor only when it can verify this for the observed sampling times of every gene scored/);
    expect(test).not.toHaveAccessibleDescription(/^Computes a least-squares periodogram for unevenly sampled series\. Normalized power is capped/);
  });

  it('says the phase map shows only passing genes with an estimable peak', () => {
    renderControls();
    const note = screen.getByLabelText('Threshold (q)');
    expect(note).toHaveAccessibleDescription(/The rhythmic count includes every passing gene/);
    expect(note).toHaveAccessibleDescription(/the phase map plots those with an estimable peak time/);
    expect(note).not.toHaveAccessibleDescription(/appear in the phase map/);
  });
});

describe('period option text', () => {
  it('names the periods JTK tests on the full schedule during a scan', () => {
    renderControls({ method: 'jtk', periodMode: 'scan', effectivePeriods: [20, 24] });
    expect(screen.getByRole('option', { name: 'Scan (JTK: 20, 24 h on the full schedule)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Period')).toHaveAccessibleDescription(/full sampling schedule JTK tests 20, 24 h/);
  });

  it('says a gene with missing times can test a different family than the option names', () => {
    // A 2 h schedule over 0–20 h supports 20 and 22 h, but a gene missing some
    // time points was tested at [20, 24] and picked 24 h.
    renderControls({ method: 'jtk', periodMode: 'scan', effectivePeriods: [20, 22] });
    expect(screen.getByRole('option', { name: 'Scan (JTK: 20, 22 h on the full schedule)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /JTK tests/ })).toBeNull();
    const period = screen.getByLabelText('Period');
    expect(period).toHaveAccessibleDescription(/missing values at some time points can be tested at a different family of periods/);
    expect(period).toHaveAccessibleDescription(/periods tested for the selected gene are shown under the trace/);
  });

  it('keeps the requested 20–28 h range for COSINOR and Lomb–Scargle', () => {
    renderControls({ method: 'cosinor', periodMode: 'scan', effectivePeriods: undefined });
    expect(screen.getByRole('option', { name: '20–28 h (scan)' })).toBeInTheDocument();
    cleanup();
    renderControls({ method: 'ls', periodMode: 'fixed24', effectivePeriods: undefined });
    expect(screen.getByRole('option', { name: '20–28 h (scan)' })).toBeInTheDocument();
  });

  it('does not describe the fixed-period JTK family as the scan family', () => {
    renderControls({ method: 'jtk', periodMode: 'fixed24', effectivePeriods: [24] });
    expect(screen.queryByRole('option', { name: 'Scan (JTK: 24 h on the full schedule)' })).toBeNull();
    cleanup();
    renderControls({ method: 'jtk', periodMode: 'fixed24', effectivePeriods: [24], jtkScanPeriods: [20, 24] });
    expect(screen.getByRole('option', { name: 'Scan (JTK: 20, 24 h on the full schedule)' })).toBeInTheDocument();
  });

  it('formats single and empty JTK families', () => {
    expect(scanOptionLabel([24])).toBe('Scan (JTK: 24 h on the full schedule)');
    expect(scanOptionLabel([])).toBe('Scan (no period JTK can test on the full schedule)');
    expect(scanOptionLabel(undefined)).toBe('20–28 h (scan)');
  });
});

describe('phase lattice bins', () => {
  // A 6 h one-day grid: JTK phases are half-interval steps, every 3 h.
  const sixHourGridPhases = [0, 3, 3, 6, 9, 9, 9, 12, 15, 18, 21, 21];

  it('detects a 3 h lattice from a 6 h sampling grid', () => {
    expect(phaseLattice(sixHourGridPhases, 24, 2)).toEqual({ step: 3, offset: 0 });
  });

  it('detects an offset lattice and wraps peaks past the cycle', () => {
    expect(phaseLattice([1, 4, 7, 25, -2], 24, 2)).toEqual({ step: 3, offset: 1 });
  });

  it('returns null for continuous peaks, a single peak time, or a lattice no coarser than the bins', () => {
    expect(phaseLattice([0.37, 5.91, 13.2, 20.04], 24, 2)).toBeNull();
    expect(phaseLattice([6, 6, 6], 24, 2)).toBeNull();
    expect(phaseLattice([0, 2, 4, 10], 24, 2)).toBeNull();
    expect(phaseLattice([0, 1, 2, 3], 24, 2)).toBeNull();
    expect(phaseLattice([], 24, 2)).toBeNull();
  });

  it('bins on the lattice and says so in the caption and text alternative', () => {
    render(<PhaseMap acrophases={sixHourGridPhases} cycleHours={24} timeUnit="ZT" />);
    expect(screen.getByTestId('phase-map-bin-caption').textContent).toBe('peak times, 3 h bins (all peaks lie on a 3 h step)');
    expect(screen.getByRole('img').getAttribute('aria-label'))
      .toBe('Peak times of 12 genes; 4 (33%) peak between ZT4.5 and ZT10.5, the densest 6 h window');
  });

  it('names a lattice window by its edges, so the stated width matches the times given', () => {
    // Lattice ZT1, 4, 7, …: two 3 h bins centred on ZT22 and ZT1 span ZT20.5 to ZT2.5.
    render(<PhaseMap acrophases={[22, 22, 1, 1, 10, 16]} cycleHours={24} timeUnit="ZT" />);
    const label = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(label).toBe('Peak times of 6 genes; 4 (67%) peak between ZT20.5 and ZT2.5, the densest 6 h window');
    const [, from, to, width] = label.match(/between ZT([\d.]+) and ZT([\d.]+), the densest ([\d.]+) h window/) ?? [];
    expect((Number(to) - Number(from) + 24) % 24).toBe(Number(width));
  });

  it('names the single most common lattice point when the window is one bin', () => {
    // A 24 h cycle on a 6 h lattice: a quarter cycle is one bin, so name its point.
    render(<PhaseMap acrophases={[0, 6, 6, 12, 18]} cycleHours={24} timeUnit="ZT" binHours={4} />);
    expect(screen.getByRole('img').getAttribute('aria-label'))
      .toBe('Peak times of 5 genes; 2 (40%) peak at ZT6, the most common peak time');
  });

  it('keeps 2 h bins for continuous peaks and a neutral default fill', () => {
    const { container } = render(<PhaseMap acrophases={[6.2, 7.1, 7.9, 8.4, 19.5]} cycleHours={24} timeUnit="ZT" />);
    expect(screen.getByTestId('phase-map-bin-caption').textContent).toBe('peak times, 2 h bins');
    expect(screen.getByRole('img').getAttribute('aria-label'))
      .toBe('Peak times of 5 genes; 4 (80%) peak between ZT6.2 and ZT8.4, the most within any 6 h window');
    const fills = [...container.querySelectorAll('path[aria-label]')].map((p) => p.getAttribute('fill'));
    expect(fills.length).toBeGreaterThan(0);
    expect(new Set(fills)).toEqual(new Set(['var(--text-mono)']));
  });
});

describe('phase map densest window', () => {
  it('slides the window over the peak times rather than stepping by bins', () => {
    // Bin-aligned 6 h windows hold at most 3 of these; all 4 fit in ZT1.5–ZT7.5.
    render(<PhaseMap acrophases={[1.9, 2.1, 5.9, 7.1]} cycleHours={24} timeUnit="ZT" />);
    expect(screen.getByRole('img').getAttribute('aria-label'))
      .toBe('Peak times of 4 genes; 4 (100%) peak between ZT1.9 and ZT7.1, the most within any 6 h window');
  });

  it('wraps across the end of the cycle and treats the window as half-open', () => {
    expect(densestWindow([23, 1, 2, 12], 24, 6)).toEqual({ count: 3, first: 23, last: 2 });
    // 2 and 8 are exactly 6 h apart: a half-open 6 h window holds one or the other.
    expect(densestWindow([2, 8], 24, 6)?.count).toBe(1);
    expect(densestWindow([], 24, 6)).toBeNull();
  });

  it('names a single time when every peak in the window shares it', () => {
    render(<PhaseMap acrophases={[5.5, 5.5, 17.25]} cycleHours={24} timeUnit="CT" />);
    expect(screen.getByRole('img').getAttribute('aria-label'))
      .toBe('Peak times of 3 genes; 2 (67%) peak at CT5.5, the most within any 6 h window');
  });
});
