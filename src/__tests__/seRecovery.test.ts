import { describe, it, expect } from 'vitest';
import { seFromStat } from '../utils/seRecovery';

describe('seFromStat', () => {
  it('limma: SE = |logFC| / |t| (exact moderated SE)', () => {
    expect(seFromStat(1.5, 6, 'limma')).toBeCloseTo(0.25, 6);
    // sign of t is irrelevant (down-regulated gene)
    expect(seFromStat(-1.2, -6, 'limma')).toBeCloseTo(0.2, 6);
  });

  it('edgeR-QL: NOT derivable from the statistic — the QL F is not a Wald statistic', () => {
    // This used to return |logFC|/sqrt(F) = 0.25 here. That number reproduces
    // edgeR's p-value but is not a sampling SD; measured against the QL-adjusted
    // Wald SE it runs a median 0.752x, which over-weighted every edgeR study in
    // the inverse-variance pooling. It must abstain instead.
    expect(seFromStat(1.5, 36, 'edgeR-QL')).toBeNull();
    expect(seFromStat(-1.5, -36, 'edgeR-QL')).toBeNull();
  });

  it('edgeR-QL: uses the SE persisted by scripts/compute_edger_se.R when present', () => {
    expect(seFromStat(1.5, 36, 'edgeR-QL', 0.3312)).toBeCloseTo(0.3312, 6);
    // A persisted SE wins over anything derivable, for limma too: it came from
    // the fit rather than from an inference about the fit.
    expect(seFromStat(1.5, 6, 'limma', 0.4)).toBeCloseTo(0.4, 6);
    // ...but only when it is usable.
    expect(seFromStat(1.5, 6, 'limma', 0)).toBeCloseTo(0.25, 6);
    expect(seFromStat(1.5, 36, 'edgeR-QL', Number.NaN)).toBeNull();
  });

  it('the macaque atlas abstains — its counts are not committed, so no SE exists', () => {
    // MAFA-F, stored logFC 1.7438 and F 72.4108, used to yield se 0.204925.
    // scripts/add_macaque_se.mts now writes null for every macaque row.
    expect(seFromStat(1.7438, 72.4108233302824, 'edgeR-QL')).toBeNull();
  });
  it('returns null for a zero effect (logFC === 0) — no usable SE', () => {
    expect(seFromStat(0, 50, 'edgeR-QL')).toBeNull();
    expect(seFromStat(0, 3.2, 'limma')).toBeNull();
  });

  it('returns null for stat === 0 (no divide-by-zero)', () => {
    expect(seFromStat(1.5, 0, 'limma')).toBeNull();
    expect(seFromStat(1.5, 0, 'edgeR-QL')).toBeNull();
  });

  it('returns null for non-finite inputs', () => {
    expect(seFromStat(Number.NaN, 6, 'limma')).toBeNull();
    expect(seFromStat(1.5, Number.NaN, 'limma')).toBeNull();
    expect(seFromStat(Number.POSITIVE_INFINITY, 6, 'edgeR-QL')).toBeNull();
  });

  it('never returns a negative or zero SE', () => {
    for (const [lfc, stat, m] of [[2, 9, 'edgeR-QL'], [-3, 5, 'limma'], [0.27, 5.172, 'limma']] as const) {
      const se = seFromStat(lfc, stat, m);
      expect(se === null || se > 0).toBe(true);
    }
  });

  it('returns null for an unrecognized or empty method — no silent fall-through to the F formula', () => {
    // Only limma (moderated t) and edgeR-QL (signed QL F) have a known logFC↔SE
    // map; an unknown or blank method must be dropped, not guessed.
    expect(seFromStat(1.5, 6, '')).toBeNull();
    expect(seFromStat(1.5, 6, 'DESeq2-Wald')).toBeNull();
    expect(seFromStat(1.5, 6, 'unknown')).toBeNull();
    // Recognized methods still compute (regression guard for the new gate).
    expect(seFromStat(1.5, 6, 'limma')).toBeCloseTo(0.25, 6);
    // edgeR derives nothing; it only passes through a persisted SE.
    expect(seFromStat(1.5, 36, 'edgeR-QL')).toBeNull();
    expect(seFromStat(1.5, 36, 'edgeR-QL', 0.25)).toBeCloseTo(0.25, 6);
  });
});

// The corrected contract, after codex held its ground on the SE question.
//
// The forest's 95% CI whisker needs an estimate of the SAMPLING SD of logFC,
// because it is drawn as logFC +/- 1.96 * se. limma's |logFC|/|t| is one. edgeR's
// |logFC|/sqrt(F) is not — it reproduces edgeR's p-value, but backing an SE out
// of a p-value assumes a Wald test and edgeR's QL F is a deviance ratio. The
// two are not interchangeable, so edgeR must be supplied a refitted SE.
describe('seRecovery — sampling SD, not test calibration', () => {
  it('computes limma from the statistic and requires edgeR to be supplied', () => {
    const seL = seFromStat(1.4, 3.5, 'limma-trend')!;
    expect(1.4 / seL).toBeCloseTo(3.5, 6);   // t = logFC / se, exactly
    expect(seFromStat(1.4, 12.25, 'edgeR-QL')).toBeNull();
    expect(seFromStat(1.4, 12.25, 'edgeR-QL', 0.53)).toBeCloseTo(0.53, 6);
  });

  it('does not treat sqrt(F) as if it were a t', () => {
    // The old code made these equal. They are not the same quantity, and the
    // equality was the bug: it gave edgeR ~1.77x its earned pooling weight.
    const t = 3.5;
    expect(seFromStat(2, t * t, 'edgeR-QL')).toBeNull();
    expect(seFromStat(2, t, 'limma')).toBeCloseTo(2 / t, 6);
  });

  it('rejects edgeR-LRT rather than treating its statistic as a QL F', () => {
    // The gate used to be /edger/i, so an LRT chi-square would have taken the
    // sqrt path. No dataset ships edgeR-LRT today; this keeps it that way.
    expect(seFromStat(1.4, 12.25, 'edgeR-LRT')).toBeNull();
    expect(seFromStat(1.4, 12.25, 'edgeR-LRT', 0.4)).toBeCloseTo(0.4, 6);
  });
  it('refuses a method whose statistic has no known relation to the effect', () => {
    expect(seFromStat(1.4, 3.5, 'DESeq2')).toBeNull();
    expect(seFromStat(1.4, 3.5, '')).toBeNull();
  });
});
