// Per-gene logFC standard error (log2 scale) for the 95% CI whisker the
// cross-dataset forest draws through each track's dot. Shared by the bundle
// builders (scripts/build_*.mts, scripts/add_macaque_se.mts) so the rule is
// defined once and unit-tested.
//
// WHAT THE WHISKER NEEDS is an estimate of the SAMPLING STANDARD DEVIATION of
// logFC, because it is drawn as logFC ± 1.96 · se. Not "whatever number
// reproduces the study's p-value" — those are different things unless the study
// ran a Wald test.
//
//   limma    → stat = moderated t. SE = |logFC| / |t| is EXACTLY limma's
//              moderated standard error, the same quantity topTable uses for its
//              confidence intervals. Computed here.
//
//   edgeR-QL → NOT DERIVABLE from the statistic. Must be supplied by
//              scripts/compute_edger_se.R, which refits the model and takes the
//              QL-adjusted Wald SE sqrt([(X'WX)⁻¹]ⱼⱼ · var.post) / ln2.
//
// WHY edgeR CANNOT BE DERIVED HERE
// --------------------------------
// This used to compute |logFC| / sqrt(F), justified by the claim that a 1-df QL
// F is a Wald statistic so F = (coef/SE)². That claim is false. glmQLFTest
// reports a deviance-ratio statistic over the posterior QL dispersion.
//
// The tempting defence — that for a 1-df contrast edgeR's p-value is
// pf(F, 1, df.total), so sqrt(F) is "the t it tested with" and |logFC|/sqrt(F)
// is therefore the implied SE — establishes only p-value equivalence. Backing an
// SE out of a p-value assumes the test was a Wald test; edgeR's is not, so the
// result is a test-calibrated proxy, not a sampling SD. Measured on GSE225038 it
// runs a median 0.752× the QL-adjusted Wald SE (IQR 0.674–0.887, only 21% of
// genes within ±10%), so an interval drawn from it would sit about a quarter too
// narrow — wrong in a consistent direction, which is worse than absent.
//
// A dataset with neither a persisted SE nor a limma statistic yields null, and
// its rows plot a dot with no whisker. That is the intended outcome: the macaque
// atlas cannot be refitted from this repo (its pseudobulk counts and library
// sizes are not committed), so it shows its effects without intervals rather
// than with proxy ones — see scripts/add_macaque_se.mts.

/** Round to the wire precision and reject anything not strictly positive. */
function finalize(se: number): number | null {
  if (!Number.isFinite(se) || se <= 0) return null;
  const rounded = +se.toFixed(6);
  return rounded > 0 ? rounded : null;
}

/**
 * The SE for one DE row.
 *
 * `persisted` is the SE computed by the analysis that produced `logFC`. When one
 * exists it always wins, because it came from the fit rather than from an
 * inference about the fit.
 */
export function seFromStat(
  logFC: number,
  stat: number,
  method: string,
  persisted?: number | null,
): number | null {
  if (persisted != null && Number.isFinite(persisted) && persisted > 0) return finalize(persisted);
  if (!Number.isFinite(logFC) || !Number.isFinite(stat) || stat === 0 || logFC === 0) return null;
  // Match any limma flavour (limma / limma-voom / limma-trend); every other
  // method, edgeR included, must return null rather than fall through to a
  // formula. A mislabeled dataset silently carrying a wrong SE into a plotted
  // interval is worse than one that abstains.
  if (!/limma/i.test(method)) return null;
  return finalize(Math.abs(logFC) / Math.abs(stat));
}
