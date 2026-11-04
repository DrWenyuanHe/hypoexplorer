import { describe, it, expect } from 'vitest';
import { isLowPower } from '../utils/qcFlags';

// isLowPower is the ONE definition of "low power" shared by the QC KPI (QCTab),
// the sidebar 2v3 badge (App), and PopWarningBadge. A past divergence here —
// the QC KPI used `is3v3 === false` while the others used min(n) < 3 — falsely
// counted a balanced 7v8 bulk track as a dropped-sample 2v3 (ISSUE-001). These
// tests pin the boundary directly on the pure function (the KPI render test in
// qcLowPowerKpi.test.jsx covers it only through QCTab), so any future drift in
// the rule is caught at the source rather than only through a component.

describe('isLowPower — min(nNormal, nObese) < 3', () => {
  it('is false for null / undefined flags (no flags ⇒ not low power)', () => {
    expect(isLowPower(null)).toBe(false);
    expect(isLowPower(undefined)).toBe(false);
  });

  it('flags a genuine dropped-sample 2v3 (either arm < 3)', () => {
    expect(isLowPower({ nNormal: 2, nObese: 3 })).toBe(true);
    expect(isLowPower({ nNormal: 3, nObese: 2 })).toBe(true);
    expect(isLowPower({ nNormal: 1, nObese: 5 })).toBe(true);
  });

  it('does NOT flag a balanced 3v3 macaque-style track', () => {
    expect(isLowPower({ nNormal: 3, nObese: 3 })).toBe(false);
  });

  it('does NOT flag a balanced/larger bulk design (ISSUE-001 regression: 7v8, 3v4)', () => {
    // is3v3 is false for these (not exactly 3v3) but both arms have >= 3
    // replicates, so they are full power. The old is3v3===false rule wrongly
    // flagged them.
    expect(isLowPower({ is3v3: false, nNormal: 7, nObese: 8 })).toBe(false);
    expect(isLowPower({ is3v3: false, nNormal: 3, nObese: 4 })).toBe(false);
  });

  it('treats exactly-3 as the inclusive full-power boundary (strict <)', () => {
    expect(isLowPower({ nNormal: 3, nObese: 100 })).toBe(false);
    expect(isLowPower({ nNormal: 100, nObese: 3 })).toBe(false);
  });

  it('defaults missing counts to 3 (unrecorded sizes are not falsely warned)', () => {
    expect(isLowPower({})).toBe(false);
    expect(isLowPower({ nNormal: 5 })).toBe(false);        // nObese ?? 3
    expect(isLowPower({ nObese: 5 })).toBe(false);         // nNormal ?? 3
    // ...but an explicit low count still flags even when the other is missing.
    expect(isLowPower({ nNormal: 2 })).toBe(true);         // nObese defaults to 3
    expect(isLowPower({ nObese: 1 })).toBe(true);          // nNormal defaults to 3
  });

  it('does not coerce an explicit 0 to the default (0 < 3 ⇒ low power)', () => {
    // ?? only falls back on null/undefined, so a real 0-replicate arm is caught.
    expect(isLowPower({ nNormal: 0, nObese: 3 })).toBe(true);
  });
});
