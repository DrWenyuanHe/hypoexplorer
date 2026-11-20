import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ArmCount, CHANCE_EXPECTATION_ID, DesignCaveats, type DesignCaveatsProps, MethodFootnote,
  NoRhythmicGenes, type NoRhythmicGenesProps, librariesPerTimepoint,
} from '../circadian/CircadianNotes';
import {
  ADJUSTMENT_NOTES, adjustPValues, harmonicNumber, thresholdReachability,
} from '../circadian/multipleTesting';

afterEach(cleanup);

/** Smallest adjusted value when `k` genes sit at the floor and the rest at p = 1. */
function bestAdjusted(floor: number, m: number, k: number, method: 'bh' | 'by' | 'holm' | 'bonferroni') {
  const p = Array.from({ length: m }, (_, i) => (i < k ? floor : 1));
  return Math.min(...(adjustPValues(p, method) as number[]));
}

describe('thresholdReachability', () => {
  const m = 14644;
  const f = 3e-3;

  it('uses the floor itself without correction', () => {
    expect(thresholdReachability(f, m, 'none', 0.05)).toEqual({ minAdjusted: f, reachable: true, minGenes: 1 });
    expect(thresholdReachability(0.06, m, 'none', 0.05)).toMatchObject({ reachable: false, minGenes: null });
  });

  it('charges m times the floor under Bonferroni and Holm', () => {
    for (const method of ['bonferroni', 'holm'] as const) {
      const r = thresholdReachability(f, m, method, 0.05);
      expect(r).toEqual({ minAdjusted: 1, reachable: false, minGenes: null });
      // Agrees with the real adjustment: even every gene at the floor cannot pass.
      expect(bestAdjusted(f, m, m, method)).toBeGreaterThanOrEqual(0.05);
      const small = thresholdReachability(1e-7, m, method, 0.05);
      expect(small.reachable).toBe(true);
      expect(small.minGenes).toBe(1);
      expect(small.minAdjusted).toBeCloseTo(m * 1e-7, 12);
      expect(bestAdjusted(1e-7, m, 1, method)).toBeCloseTo(small.minAdjusted, 12);
    }
  });

  it('does not call BH impossible while the floor is below the threshold', () => {
    const r = thresholdReachability(f, m, 'bh', 0.05);
    expect(r.reachable).toBe(true);
    expect(r.minAdjusted).toBe(f);
    expect(r.minGenes).toBe(879);
    // The bound is tight against the real BH adjustment.
    expect(bestAdjusted(f, m, 879, 'bh')).toBeLessThan(0.05);
    expect(bestAdjusted(f, m, 878, 'bh')).toBeGreaterThanOrEqual(0.05);
    expect(thresholdReachability(0.05, m, 'bh', 0.05).reachable).toBe(false);
  });

  it('inflates BH by the harmonic number for BY', () => {
    const c = harmonicNumber(m);
    expect(c).toBeCloseTo(10.17, 2);
    const r = thresholdReachability(f, m, 'by', 0.05);
    expect(r.reachable).toBe(true);
    expect(r.minAdjusted).toBeCloseTo(f * c, 12);
    const k = r.minGenes as number;
    expect(k).toBeGreaterThan(8000);
    expect(bestAdjusted(f, m, k, 'by')).toBeLessThan(0.05);
    expect(bestAdjusted(f, m, k - 1, 'by')).toBeGreaterThanOrEqual(0.05);
    expect(thresholdReachability(0.005, m, 'by', 0.05)).toMatchObject({ reachable: false, minGenes: null });
  });

  it('puts no limit on a zero or non-finite floor', () => {
    for (const method of ['none', 'bh', 'by', 'holm', 'bonferroni'] as const) {
      expect(thresholdReachability(0, m, method, 0.05)).toEqual({ minAdjusted: 0, reachable: true, minGenes: 1 });
      // A failed floor computation must never turn into an impossibility claim.
      expect(thresholdReachability(Number.NaN, m, method, 0.05)).toEqual({ minAdjusted: 0, reachable: true, minGenes: 1 });
    }
  });

  it('stays sound when the floor is only a common lower bound over per-gene floors', () => {
    // Genes have different floors (per-gene n differs); the helper is given the
    // smallest. Deterministic LCG so the check is reproducible.
    let seed = 12345;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const lower = 1e-4;
    const mm = 2000;
    for (const method of ['none', 'bh', 'by', 'holm', 'bonferroni'] as const) {
      for (const threshold of [0.001, 0.01, 0.05, 0.1]) {
        for (let trial = 0; trial < 5; trial++) {
          // Each gene's own floor is at or above `lower`; most p sit at that floor.
          const p = Array.from({ length: mm }, () => {
            const own = lower * (1 + 9 * rand());
            return rand() < 0.7 ? own : own + (1 - own) * rand();
          });
          const adj = adjustPValues(p, method) as number[];
          const bound = thresholdReachability(lower, mm, method, threshold);
          expect(Math.min(...adj)).toBeGreaterThanOrEqual(bound.minAdjusted - 1e-12);
          const passing = adj.filter((q) => q < threshold).length;
          if (!bound.reachable) expect(passing).toBe(0);
          else if (passing > 0) expect(passing).toBeGreaterThanOrEqual(bound.minGenes as number);
        }
      }
    }
  });

  it('calls a threshold unreachable only when even the smallest floor fails', () => {
    // Codex repro: LS period scan, 18 libraries, floor 0.003048.
    const f18 = 0.003048;
    expect(thresholdReachability(f18, m, 'none', 0.001).reachable).toBe(false);
    expect(thresholdReachability(f18, m, 'none', 0.01).reachable).toBe(true);
    expect(thresholdReachability(f18, m, 'bh', 0.001).reachable).toBe(false);
    expect(thresholdReachability(f18, m, 'bh', 0.01).minGenes).toBe(Math.floor((m * f18) / 0.01) + 1);
  });
});

const base: DesignCaveatsProps = {
  method: 'ls', adjust: 'bh', threshold: 0.05, nPerArm: 18, lsCeiling: 3e-3,
  jtkDesign: null, tested: 14644, rhythmicCount: 0, running: false,
};

describe('DesignCaveats', () => {
  it('says plainly when the Lomb–Scargle floor makes the threshold unreachable', () => {
    const onSwitchMethod = vi.fn();
    const { container } = render(<DesignCaveats {...base} adjust="bonferroni" onSwitchMethod={onSwitchMethod} />);
    const text = container.textContent ?? '';
    expect(text).toContain('No gene can reach q < 0.05 with Lomb–Scargle in this arm (n = 18 libraries).');
    expect(text).toContain(
      'The smallest p any gene in this arm can reach is 3.0e-3, and even that p is not below 0.05 after Bonferroni across 14,644 tested genes.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Switch to COSINOR' }));
    expect(onSwitchMethod).toHaveBeenCalledWith('cosinor');
  });

  it('states the joint requirement under BH instead of claiming impossibility', () => {
    const { container } = render(<DesignCaveats {...base} onSwitchMethod={vi.fn()} />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('No gene can reach');
    expect(text).toContain('the smallest p any gene in this arm can reach is 3.0e-3');
    expect(text).toContain('After BH across 14,644 tested genes, a gene can reach q < 0.05 only if at least 879 genes pass together');
  });

  it('compares an uncorrected floor with the threshold directly', () => {
    const { container } = render(<DesignCaveats {...base} adjust="none" lsCeiling={0.06} nPerArm={5} />);
    expect(container.textContent).toContain('The smallest p any gene in this arm can reach is 6.0e-2, which is not below 0.05.');
  });

  it('makes no impossibility claim before the scan has counted the genes', () => {
    const { container } = render(<DesignCaveats {...base} adjust="bonferroni" running />);
    expect(container.textContent).not.toContain('No gene can reach');
    expect(container.textContent).toContain('the smallest p any gene in this arm can reach is 3.0e-3');
  });

  it('renders caveats as a glyph and normal ink, never a filled amber box', () => {
    render(<DesignCaveats {...base} adjust="bonferroni" />);
    const note = screen.getByRole('note');
    expect(note.style.background).toBe('');
    expect(note.style.color).toBe('var(--text-primary)');
    expect(note.querySelector('svg')).not.toBeNull();
    expect(note.outerHTML).not.toMatch(/B45309|FEF3C7/i);
  });

  it('keeps the JTK effective-period note as quiet muted text with its full content', () => {
    const { container } = render(
      <DesignCaveats {...base} method="jtk"
        jtkDesign={{ supported: true, reason: null, interval: 4, periods: [20, 24] }} />,
    );
    const note = screen.getByRole('note');
    expect(note.style.color).toBe('var(--text-muted)');
    expect(note.style.background).toBe('');
    expect(note.querySelector('svg')).toBeNull();
    const text = container.textContent ?? '';
    expect(text).toContain('JTK_CYCLE tests 20, 24 h');
    expect(text).toContain('4 h sampling interval');
    expect(text).toContain('2 h (half-interval) steps');
  });

  it('qualifies the JTK period family and phase step as full-schedule values a missing time can change', () => {
    const { container } = render(
      <DesignCaveats {...base} method="jtk"
        jtkDesign={{ supported: true, reason: null, interval: 4, periods: [20, 22, 24] }} />,
    );
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('On the full sampling schedule, JTK_CYCLE tests 20, 22, 24 h');
    expect(text).toContain('Both are full-schedule values: for a gene with missing time points, the periods tested and the phase step can change.');
    expect(text).toContain('shown under the trace');
    expect(text).toContain('CandidatePeriodsHours export column');
    // No unqualified claim that every gene gets this family or this step.
    expect(text).not.toMatch(/Missing values can narrow the periods/);
  });

  it('leaves an unsupported JTK design to the figure area, so its reason appears once', () => {
    render(<DesignCaveats {...base} method="jtk"
      jtkDesign={{ supported: false, reason: 'JTK_CYCLE needs at least four observations.', interval: null, periods: [] }} />);
    expect(screen.queryByText(/JTK_CYCLE needs at least four observations/)).toBeNull();
  });

  it('shows the count expected by chance when no correction is applied', () => {
    const { container } = render(<DesignCaveats {...base} method="cosinor" adjust="none" />);
    const note = container.querySelector(`#${CHANCE_EXPECTATION_ID}`);
    expect(note?.textContent).toContain(
      'Uncorrected benchmark: if no gene were rhythmic and null p-values were uniform, ≈ 732 of 14,644 tested genes would fall below p < 0.05.',
    );
    // Without a period mode the copy covers both: uniform for one fixed period
    // under the F test's assumptions, conservative after a within-gene scan.
    expect(note?.textContent).toContain('For one fixed 24 h period, COSINOR’s F-test p-value is uniform under the null');
    expect(note?.textContent).toContain('A period scan Bonferroni-corrects each gene’s p-value across its tested periods (within-gene)');
    expect(note?.textContent).toContain('nominal figure');
  });

  describe('qualifies the nominal benchmark per method and period mode (Codex P3)', () => {
    const chance = (props: Partial<DesignCaveatsProps>) => {
      const { container } = render(<DesignCaveats {...base} adjust="none" {...props} />);
      return container.querySelector(`#${CHANCE_EXPECTATION_ID}`)?.textContent ?? '';
    };

    it('COSINOR at a fixed 24 h: uniform under the F test’s assumptions, no within-gene Bonferroni', () => {
      const text = chance({ method: 'cosinor', periodMode: 'fixed24' });
      expect(text).toContain('≈ 732 of 14,644 tested genes would fall below p < 0.05');
      expect(text).toContain(
        'With one fixed 24 h period, COSINOR’s F-test p-value is uniform under the null when the test’s '
        + 'assumptions hold (normal, independent errors with constant variance)',
      );
      expect(text).toContain('nominal figure');
      expect(text).not.toContain('Bonferroni');
      expect(text).not.toContain('not uniform');
      expect(text).not.toContain('non-uniform');
    });

    it('COSINOR with a period scan: within-gene Bonferroni makes the null conservative', () => {
      const text = chance({ method: 'cosinor', periodMode: 'scan' });
      expect(text).toContain('Bonferroni-corrected across its tested periods (a within-gene correction');
      expect(text).toContain('separate from any gene-wise correction');
      expect(text).toContain('conservative');
      expect(text).toContain('probability at most the threshold');
      expect(text).toContain('nominal figure is an upper benchmark');
    });

    it('JTK_CYCLE: discrete permutation null and Bonferroni across its templates in either mode', () => {
      const fixed = chance({ method: 'jtk', periodMode: 'fixed24' });
      expect(fixed).toContain('JTK_CYCLE’s exact permutation null is discrete');
      expect(fixed).toContain('Bonferroni-corrected across its phase templates at the fixed 24 h period');
      const scan = chance({ method: 'jtk', periodMode: 'scan' });
      expect(scan).toContain('JTK_CYCLE’s exact permutation null is discrete');
      expect(scan).toContain('Bonferroni-corrected across its tested period × phase templates');
      expect(scan).toContain('nominal figure');
    });

    it('Lomb–Scargle: the floor, plus the frequency-count heuristic only when scanning', () => {
      const scan = chance({ method: 'ls', periodMode: 'scan', threshold: 0.01, lsCeiling: 0.003048 });
      expect(scan).toContain('Horne–Baliunas count of independent frequencies (a heuristic)');
      expect(scan).toContain('cannot fall below a floor set by the series length');
      expect(scan).toContain('nominal figure');
      const fixed = chance({ method: 'ls', periodMode: 'fixed24', threshold: 0.01, lsCeiling: 0.003048 });
      expect(fixed).toContain('approximation at the single 24 h period');
      expect(fixed).toContain('cannot fall below a floor set by the series length');
      expect(fixed).not.toContain('Horne–Baliunas');
    });
  });

  describe('a non-finite Lomb–Scargle floor states no floor or impossibility', () => {
    const unknown = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1];

    it.each(['none', 'bh', 'by', 'holm', 'bonferroni'] as const)('under %s', (adjust) => {
      for (const lsCeiling of unknown) {
        for (const threshold of [0.001, 0.05]) {
          for (const running of [false, true]) {
            const { container, unmount } = render(
              <DesignCaveats {...base} adjust={adjust} lsCeiling={lsCeiling} threshold={threshold}
                running={running} periodMode="scan" onSwitchMethod={vi.fn()} />,
            );
            const text = container.textContent ?? '';
            expect(text).not.toMatch(/floor/i);
            expect(text).not.toContain('No gene can reach');
            expect(text).not.toContain('smallest p');
            expect(text).not.toContain('Expected by chance');
            expect(text).not.toMatch(/NaN|Infinity/);
            expect(screen.queryByRole('button', { name: 'Switch to COSINOR' })).toBeNull();
            const note = container.querySelector(`#${CHANCE_EXPECTATION_ID}`);
            if (adjust === 'none' && !running) {
              // The id stays for aria-describedby, with the nominal benchmark,
              // never a "0 expected" tied to an unknown floor.
              expect(note?.textContent).toContain(`≈ ${threshold === 0.001 ? '15' : '732'} of 14,644 tested genes`);
              expect(note?.textContent).not.toMatch(/≈?\s*\b0\b of/);
            } else {
              expect(note).toBeNull();
            }
            unmount();
          }
        }
      }
    });
  });

  it('omits the chance figure while scanning or when a correction is applied', () => {
    const { container, rerender } = render(<DesignCaveats {...base} method="cosinor" adjust="none" running />);
    expect(container.querySelector(`#${CHANCE_EXPECTATION_ID}`)).toBeNull();
    rerender(<DesignCaveats {...base} method="cosinor" adjust="bh" />);
    expect(container.querySelector(`#${CHANCE_EXPECTATION_ID}`)).toBeNull();
  });

  it('never pairs an impossibility caveat with a chance figure (LS, n = 18, p < 0.001)', () => {
    const { container } = render(
      <DesignCaveats {...base} adjust="none" threshold={0.001} lsCeiling={0.003048} nPerArm={18} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('No gene can reach p < 0.001 with Lomb–Scargle in this arm (n = 18 libraries).');
    const note = container.querySelector(`#${CHANCE_EXPECTATION_ID}`);
    // The id stays in place: the rhythmic count's aria-describedby points at it.
    expect(note).not.toBeNull();
    expect(note?.textContent).toBe(
      'Expected by chance: 0 of 14,644 tested genes, because the smallest p any gene in this arm can '
      + 'reach with Lomb–Scargle (3.0e-3) is not below the 0.001 threshold.',
    );
    expect(text).not.toMatch(/≈\s*1[45]\b/);
    expect(text).not.toContain('Uncorrected benchmark');
  });

  it('keeps the nominal benchmark for Lomb–Scargle when the threshold is reachable', () => {
    const { container } = render(<DesignCaveats {...base} adjust="none" threshold={0.01} lsCeiling={0.003048} />);
    const note = container.querySelector(`#${CHANCE_EXPECTATION_ID}`);
    expect(note?.textContent).toContain('≈ 146 of 14,644 tested genes would fall below p < 0.01');
    expect(note?.textContent).toContain('Lomb–Scargle false-alarm value is an approximation');
    expect(container.textContent).not.toContain('No gene can reach');
  });

  it('names the discrete JTK null as a reason the chance figure is nominal', () => {
    const { container } = render(<DesignCaveats {...base} method="jtk" adjust="none" />);
    expect(container.querySelector(`#${CHANCE_EXPECTATION_ID}`)?.textContent)
      .toContain('JTK_CYCLE’s exact permutation null is discrete');
  });

  it('describes the uncorrected option as a nominal uniform-null benchmark', () => {
    expect(ADJUSTMENT_NOTES.none).toContain('nominal benchmark');
    expect(ADJUSTMENT_NOTES.none).toContain('non-uniform');
    expect(ADJUSTMENT_NOTES.none).toContain('rough guide');
    // Not categorical: a fixed 24 h COSINOR F test is uniform under its assumptions.
    expect(ADJUSTMENT_NOTES.none).toContain('A fixed 24 h COSINOR p-value is uniform under the null only when');
  });

  it('shows a small expectation to one decimal place', () => {
    const { container } = render(<DesignCaveats {...base} method="cosinor" adjust="none" threshold={0.001} tested={500} />);
    expect(container.textContent).toContain('≈ 0.5 of 500 tested genes');
  });
});

const zero: NoRhythmicGenesProps = {
  running: false, qLabel: 'q', threshold: 0.05, armLabel: 'HFD', arm: 'hfd',
  adjust: 'bh', method: 'jtk',
};

describe('NoRhythmicGenes', () => {
  it('reports scanning while the scan runs', () => {
    render(<NoRhythmicGenes {...zero} running />);
    expect(screen.getByRole('status').textContent).toBe('Scanning…');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('states the result and offers the next looser threshold without arm counts', () => {
    const onLoosenThreshold = vi.fn();
    render(<NoRhythmicGenes {...zero} onLoosenThreshold={onLoosenThreshold} />);
    expect(screen.getByRole('status').textContent).toBe('No gene reaches q < 0.05 in HFD.');
    fireEvent.click(screen.getByRole('button', { name: 'Show q < 0.1' }));
    expect(onLoosenThreshold).toHaveBeenCalledWith(0.1);
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('offers no looser threshold at the loosest level', () => {
    render(<NoRhythmicGenes {...zero} threshold={0.1} onLoosenThreshold={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lists the other arms at the same settings', () => {
    const armCounts: ArmCount[] = [
      { arm: 'chow', label: 'Chow', color: '#3775BA', rhythmic: 50, tested: 14000, running: false },
      { arm: 'hfd', label: 'HFD', color: '#D1495B', rhythmic: 0, tested: 14000, running: false },
      { arm: 'fast', label: 'Fasted', rhythmic: null, tested: null, running: true },
    ];
    render(<NoRhythmicGenes {...zero} armCounts={armCounts} executing="fast" />);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Chow: 50 at the same settings', 'Fasted: scanning…']);
  });

  describe('names only the executing arm as scanning (Codex P2)', () => {
    const armCounts: ArmCount[] = [
      { arm: 'chow', label: 'Chow', rhythmic: 0, tested: 14000, running: false },
      { arm: 'hfd', label: 'HFD', rhythmic: 0, tested: 14000, running: false },
      { arm: 'fast', label: 'Fasted', rhythmic: null, tested: null, running: true },
      { arm: 'refed', label: 'Refed', rhythmic: null, tested: null, running: true },
    ];
    const items = () => screen.getAllByRole('listitem').map((li) => li.textContent);

    it('marks other unfinished arms as queued', () => {
      render(<NoRhythmicGenes {...zero} armCounts={armCounts} executing="fast" />);
      expect(items()).toEqual(['Chow: 0 at the same settings', 'Fasted: scanning…', 'Refed: queued']);
    });

    it('marks every unfinished arm as queued when none is executing', () => {
      render(<NoRhythmicGenes {...zero} armCounts={armCounts} executing={null} />);
      expect(items()).toEqual(['Chow: 0 at the same settings', 'Fasted: queued', 'Refed: queued']);
    });

    it('claims no scan when which arm is executing is unknown', () => {
      render(<NoRhythmicGenes {...zero} armCounts={armCounts} />);
      expect(items()).toEqual(['Chow: 0 at the same settings', 'Fasted: pending', 'Refed: pending']);
    });

    it('says the shown arm is queued, not scanning, while another arm executes', () => {
      const { rerender } = render(<NoRhythmicGenes {...zero} running armCounts={armCounts} executing="chow" />);
      expect(screen.getByRole('status').textContent).toBe('Queued: HFD is scanned after Chow finishes.');
      rerender(<NoRhythmicGenes {...zero} running armCounts={armCounts} executing={null} />);
      expect(screen.getByRole('status').textContent).toBe('Queued: the HFD scan has not started yet.');
      rerender(<NoRhythmicGenes {...zero} running armCounts={armCounts} executing="hfd" />);
      expect(screen.getByRole('status').textContent).toBe('Scanning…');
    });
  });

  it('adds a power note only for three or fewer libraries per timepoint', () => {
    const { container, rerender } = render(<NoRhythmicGenes {...zero} perTimepoint={{ min: 3, max: 3 }} />);
    expect(container.textContent).toContain(
      'With 3 libraries per timepoint, low-amplitude rhythms are hard to detect; a zero count is not evidence of no rhythm.',
    );
    rerender(<NoRhythmicGenes {...zero} perTimepoint={{ min: 2, max: 3 }} />);
    expect(container.textContent).toContain('With 2–3 libraries per timepoint');
    rerender(<NoRhythmicGenes {...zero} perTimepoint={{ min: 4, max: 5 }} />);
    expect(container.textContent).not.toContain('per timepoint');
    rerender(<NoRhythmicGenes {...zero} />);
    expect(container.textContent).not.toContain('per timepoint');
  });
});

describe('librariesPerTimepoint', () => {
  it('reports the fewest and most libraries at one sampled time', () => {
    expect(librariesPerTimepoint([0, 0, 0, 4, 4, 8, 8, 8])).toEqual({ min: 2, max: 3 });
    expect(librariesPerTimepoint([])).toBeNull();
  });
});

describe('MethodFootnote', () => {
  it('sets the MetaCycle version in mono at a whole-pixel size', () => {
    const { container } = render(<MethodFootnote method="jtk" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.fontSize).toBe('11px');
    const version = [...root.querySelectorAll('span')].find((s) => s.textContent === '1.2.1');
    expect(version?.style.fontFamily).toContain('Geist Mono');
  });

  it('says the Lomb–Scargle period is the maximum-power period and a failed fit records amplitude 0', () => {
    const { container } = render(<MethodFootnote method="ls" />);
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('period is the candidate with the most periodogram power');
    expect(text).toContain('the period still stands, the peak shows a dash and the amplitude is recorded as 0, not fitted');
  });
});
