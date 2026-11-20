import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ArmStat, ArmStatsStrip, periodSupport } from '../circadian/ArmStatsStrip';
import { type RhythmResult, SCAN_PERIODS, runRhythmicity } from '../circadian/rhythmicity';

// The strip borrows formatting from the results table module; keep the table's
// export and provenance chain (and the dataset registry behind it) out of this test.
vi.mock('../circadian/circadianExport', () => ({
  exportResultsCSV: vi.fn(), exportRawCSV: vi.fn(), exportWorkbook: vi.fn(),
}));

afterEach(cleanup);

function rhythmFit(overrides: Partial<RhythmResult> = {}): RhythmResult {
  return {
    method: 'jtk', p: 0.001, period: 24, acrophase: 6, amplitude: 1.25, mesor: 5,
    stat: 0.8, n: 12, nTimepoints: 6, periodsTested: [20, 24], ...overrides,
  };
}

/** Real estimator output; throws if the estimator declines the series. */
function estimate(...args: Parameters<typeof runRhythmicity>): RhythmResult {
  const fit = runRhythmicity(...args);
  if (!fit) throw new Error('the estimator returned no result');
  return fit;
}

/**
 * The reviewer's Lomb–Scargle case: six libraries at 0, 12, 12, 24, 24, 24 h,
 * scanned over the 17 periods 20–28 h. The periodogram picks 24 h by maximum
 * power; the cosine fit there is singular, so amplitude and acrophase are
 * recorded as fallback zeros.
 */
const lsSingular = () => estimate('ls', { times: [0, 12, 12, 24, 24, 24], values: [2, 0, 0, 2, 2, 2] }, { periods: SCAN_PERIODS });

/**
 * The reviewer's JTK_CYCLE spike: six time points on a 4 h grid, eight
 * replicates each, values 1, 0, 0, 0, 0, 0. Canonical JTK_CYCLE scores it
 * (p ≈ 0.0215) with a Hodges–Lehmann amplitude of 0, hence period 0.
 */
function jtkSpike(): RhythmResult {
  const times: number[] = [];
  const values: number[] = [];
  for (let rep = 0; rep < 8; rep++) {
    [0, 4, 8, 12, 16, 20].forEach((t, i) => { times.push(t); values.push(i === 0 ? 1 : 0); });
  }
  return estimate('jtk', { times, values }, { periods: [24] });
}

function arm(key: string, overrides: Partial<ArmStat> = {}): ArmStat {
  return {
    key, label: key === 'chow' ? 'Chow' : 'High-fat diet', color: '#4C78A8',
    fit: rhythmFit(), q: 0.01, selected: key === 'chow', ...overrides,
  };
}

function renderStrip(arms: ArmStat[], adjust: 'bh' | 'none' = 'bh') {
  return render(
    <ArmStatsStrip gene="Per2" arms={arms} adjust={adjust} qLabel={adjust === 'none' ? 'p' : 'q'} threshold={0.05} unit="ZT" />,
  );
}

const row = (label: string) => {
  const header = screen.getByRole('rowheader', { name: new RegExp(label) });
  const tr = header.closest('tr');
  if (!tr) throw new Error(`no row for ${label}`);
  return tr;
};
const cellUnder = (label: string, column: string) => {
  const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
  const index = headers.indexOf(column);
  if (index < 0) throw new Error(`no column ${column}`);
  return row(label).children[index] as HTMLElement;
};

describe('periodSupport', () => {
  it('discloses nothing for a single tested period that is the whole family', () => {
    expect(periodSupport([24], [24])).toBeNull();
    expect(periodSupport(undefined, [20, 24])).toBeNull();
  });

  it('discloses even a single whole-family period when there is no winning period', () => {
    expect(periodSupport([20], [20], true)).toEqual({ tested: [20], untested: [] });
    expect(periodSupport(undefined, [20], true)).toBeNull();
  });

  it('lists a searched family and names any period the gene could not be tested at', () => {
    expect(periodSupport([24, 20], [20, 24])).toEqual({ tested: [20, 24], untested: [] });
    expect(periodSupport([20], [20, 24])).toEqual({ tested: [20], untested: [24] });
    expect(periodSupport([20, 24], [20, 24, 28])).toEqual({ tested: [20, 24], untested: [28] });
  });
});

describe('ArmStatsStrip', () => {
  it('shows the gene-specific JTK family when one arm loses a period to a missing value', () => {
    // On a 4 h grid, dropping this gene's last time point in the high-fat arm
    // leaves JTK_CYCLE only the 20 h template there.
    renderStrip([
      arm('chow'),
      arm('hfd', { fit: rhythmFit({ period: 20, periodsTested: [20] }) }),
    ]);
    expect(cellUnder('Chow', 'period (h)').textContent).toBe('24(of 20, 24)');
    expect(cellUnder('High-fat diet', 'period (h)').textContent).toBe('20(24 not testable)');
    expect(screen.getByText(/In High-fat diet, this gene's non-missing time points do not support every period/))
      .toBeInTheDocument();
  });

  it('compares with the arm-level family when the container supplies one', () => {
    // A single arm: nothing to compare across, so the family must come from the arm.
    renderStrip([arm('chow', { fit: rhythmFit({ period: 20, periodsTested: [20] }), periodFamily: [20, 24] })]);
    expect(cellUnder('Chow', 'period (h)').textContent).toBe('20(24 not testable)');
  });

  it('keeps a fixed period bare', () => {
    renderStrip([arm('chow', { fit: rhythmFit({ periodsTested: [24] }), periodFamily: [24] })]);
    expect(cellUnder('Chow', 'period (h)').textContent).toBe('24');
    expect(screen.queryByText(/Brackets beside the period/)).toBeNull();
  });

  it('shows the gene-specific reason in place of a bare "not tested"', () => {
    const reason = 'Per2 has values at only 3 of 6 time points in High-fat diet, too few for JTK_CYCLE.';
    renderStrip([arm('chow'), arm('hfd', { fit: null, q: null, unavailable: reason })]);
    const verdict = cellUnder('High-fat diet', 'at q < 0.05');
    expect(verdict.textContent).toBe(reason);
    expect(within(row('High-fat diet')).queryByText('not tested')).toBeNull();
    expect(within(row('High-fat diet')).queryByText('not testable')).toBeNull();
    // Once, in the row it belongs to.
    expect(screen.getAllByText(reason)).toHaveLength(1);
  });

  it('says why a fitted gene has no adjusted value', () => {
    renderStrip([arm('chow', { q: null })]);
    expect(cellUnder('Chow', 'at q < 0.05').textContent).toBe("not scored by this arm's scan");
  });

  it('keeps a small fitted amplitude distinguishable from zero', () => {
    renderStrip([
      arm('chow', { fit: rhythmFit({ method: 'cosinor', amplitude: 0.00002, periodsTested: [24] }) }),
      arm('hfd', { fit: rhythmFit({ method: 'cosinor', amplitude: 0.0123, periodsTested: [24] }) }),
    ]);
    expect(cellUnder('Chow', 'amplitude').textContent).toBe('2.00e-5');
    expect(cellUnder('High-fat diet', 'amplitude').textContent).toBe('0.0123');
  });

  it('shows an exact zero amplitude as 0, not a dash', () => {
    renderStrip([
      arm('chow', { fit: rhythmFit({ method: 'cosinor', amplitude: 0.00002, periodsTested: [24] }) }),
      arm('hfd', { fit: jtkSpike(), periodFamily: [24] }),
    ]);
    expect(cellUnder('Chow', 'amplitude').textContent).toBe('2.00e-5');
    expect(cellUnder('High-fat diet', 'amplitude').textContent).toBe('0');
  });

  it('keeps the max-power period of the six-library Lomb–Scargle case whose cosine fit fails', () => {
    const failed = lsSingular();
    // Real estimator output, pinned so the scenario cannot drift.
    expect(failed).toMatchObject({ method: 'ls', period: 24, amplitude: 0, acrophase: 0, n: 6, nTimepoints: 3 });
    renderStrip([arm('chow', { fit: failed, q: 0.01 })]);
    // 24 h was selected by maximum periodogram power before the fit failed, and
    // the results CSV records PeriodHours = 24: the strip must not deny it.
    expect(cellUnder('Chow', 'period (h, max power)').textContent).toBe('24');
    expect(row('Chow').textContent).not.toMatch(/no estimable period/);
    // No peak time: the fallback acrophase 0 must not read as ZT0.
    expect(cellUnder('Chow', 'peak (ZT)').textContent).toBe('—no estimable peak');
    // The recorded amplitude, marked as not fitted.
    const amplitude = cellUnder('Chow', 'amplitude');
    expect(amplitude.textContent).toBe('0 (recorded as 0 because the cosine fit failed; not a fitted amplitude)');
    expect(amplitude.title).toMatch(/not a fitted amplitude/);
    expect(cellUnder('Chow', 'p').textContent).not.toBe('—');
    expect(cellUnder('Chow', 'q').textContent).not.toBe('—');
    expect(cellUnder('Chow', 'at q < 0.05').textContent).toBe('rhythmic');
    expect(screen.getByText(/For Lomb–Scargle, the period is the candidate period with the most periodogram power\./))
      .toBeInTheDocument();
    expect(screen.getByText(/In Chow, the fit has no estimable peak .* so no peak time is reported; p still stands\./))
      .toBeInTheDocument();
    expect(screen.getByText(/In Chow, the cosine fit at that maximum-power period failed, so the amplitude is recorded as 0, not fitted\./))
      .toBeInTheDocument();
    expect(screen.queryByText(/no period is estimable/)).toBeNull();
  });

  it('shows the JTK_CYCLE replicate spike with amplitude 0, no period or peak, and its tested family', () => {
    const spike = jtkSpike();
    expect(spike).toMatchObject({ method: 'jtk', period: 0, amplitude: 0, periodsTested: [24] });
    expect(spike.p).toBeCloseTo(0.0215, 4);
    renderStrip([arm('chow', { fit: spike, q: 0.03, periodFamily: [24] })]);
    expect(cellUnder('Chow', 'period (h)').textContent).toBe('—no estimable period(tested 24)');
    expect(cellUnder('Chow', 'peak (ZT)').textContent).toBe('—no estimable peak');
    expect(cellUnder('Chow', 'amplitude').textContent).toBe('0');
    expect(cellUnder('Chow', 'amplitude').title).toBe('');
    expect(cellUnder('Chow', 'p').textContent).not.toBe('—');
    expect(screen.getByText(/In Chow, no period is estimable \(canonical JTK_CYCLE reports period 0 when its Hodges–Lehmann amplitude is zero\)\./))
      .toBeInTheDocument();
    expect(screen.queryByText(/max power|most periodogram power/)).toBeNull();
  });

  it('keeps the tested JTK family for a scored zero-amplitude fit with no winning period', () => {
    // Canonical JTK_CYCLE: every candidate's amplitude is zero, so period 0,
    // yet the gene was scored against the 20 h template.
    const zero = rhythmFit({ p: 0.010017, period: 0, amplitude: 0, acrophase: 0, periodsTested: [20] });
    renderStrip([arm('chow', { fit: zero, q: 0.02, periodFamily: [20] })]);
    const period = cellUnder('Chow', 'period (h)');
    expect(period.textContent).toBe('—no estimable period(tested 20)');
    expect(cellUnder('Chow', 'amplitude').textContent).toBe('0');
    expect(screen.getByText(/Brackets beside the period list the candidate periods/)).toBeInTheDocument();
  });

  it('names untested periods for a fit with no winning period', () => {
    const zero = rhythmFit({ period: 0, amplitude: 0, acrophase: 0, periodsTested: [20] });
    renderStrip([arm('chow', { fit: zero, periodFamily: [20, 24] })]);
    expect(cellUnder('Chow', 'period (h)').textContent).toBe('—no estimable period(tested 20; 24 not testable)');
  });
});
