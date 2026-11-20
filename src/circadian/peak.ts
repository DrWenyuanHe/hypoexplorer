// Whether a rhythm result carries a peak time a reader can trust.
//
// Every estimator returns an acrophase, but not every acrophase means
// something: JTK_CYCLE reports period 0 and a zero Hodges–Lehmann amplitude for
// a gene with no estimable rhythm shape, and Lomb–Scargle can return the
// requested period with a fallback amplitude and acrophase of 0 when its cosine
// fit fails. Both would otherwise read as "peaks at ZT0". The rhythmicity
// statistic (p, q) stands on its own; only the peak, period and amplitude
// displays depend on this check. One definition, shared by the phase map, the
// per-arm strip, the results table and the trace.

export interface PeakFields {
  period: number;
  amplitude: number;
  acrophase: number;
}

/** True when `r` has a positive period, a positive amplitude and a finite peak time. */
export function hasEstimablePeak(r: PeakFields | null | undefined): boolean {
  return !!r
    && Number.isFinite(r.period) && r.period > 0
    && Number.isFinite(r.amplitude) && r.amplitude > 0
    && Number.isFinite(r.acrophase);
}
