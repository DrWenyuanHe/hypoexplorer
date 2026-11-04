// The ONE definition of "low power" for a track's QC flags.
//
// A track is low power when either experimental arm has fewer than 3 replicates
// (e.g. the macaque 2v3 case where a sample was dropped). Balanced or larger
// designs — 7v8, 3v4, 3v3 — are normal and must NOT be flagged. Missing counts
// default to 3 (treated as adequate) so a track with unrecorded sizes isn't
// falsely warned about.
//
// QC KPI (QCTab), the sidebar 2v3 badge (App), and PopWarningBadge all call
// this. A past divergence here — the QC KPI used `is3v3 === false` while the
// others used min(n)<3 — falsely counted a balanced 7v8 bulk track as a
// dropped-sample 2v3 (ISSUE-001). Keep it single-sourced.
import type { QCFlags } from '../types';

export function isLowPower(flags: QCFlags | null | undefined): boolean {
  if (!flags) return false;
  return Math.min(flags.nNormal ?? 3, flags.nObese ?? 3) < 3;
}
