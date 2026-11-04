# Circadian calculations and validation

The circadian tab computes statistics from time-series sibling bundles, without
refitting differential expression. Registry units are authoritative: GSE248462
ARC and GSE252364 SCN use TMM CPM; GSE157077 SCN uses log2(FPKM + 1). Libraries
remain separate observations; missing values are omitted, never zero-filled.
These terminal-tissue courses are not longitudinal repeated-animal series.

## Methods and supported designs

`src/circadian/rhythmicity.ts` dispatches cosine regression, canonical JTK_CYCLE
and classic mean-centred Lomb–Scargle. The minimum is four observations at three
distinct times. Statistical interpretation additionally requires an appropriate
sampling design and error assumptions.

Cosinor fits intercept, cosine and sine by least squares and compares the two
oscillating coefficients with an intercept-only model using an F test. Searching
several periods applies Bonferroni across the unique estimable periods before
the independent gene-wise adjustment. A fixed 24-hour fit needs no period search
correction. Gene-wise BH, BY, Holm, Bonferroni or no correction is a separate
choice. A zero residual sum of squares with nonzero explained variance has
infinite F and p = 0, rather than being classified as no rhythm.

`src/circadian/jtkCycle.ts` independently implements canonical JTK_CYCLE
(Hughes et al., 2010, doi:10.1177/0748730410379711), benchmarked against unchanged
CRAN MetaCycle 1.2.1 `JTKv3.1p.R`. BigInt coefficients of the grouped
multiset-inversion polynomial provide the exact permutation null, including
unequal replication and missing observations. The estimator uses canonical
rounded-pi cosine ranks, half-sampling-interval phases, Bonferroni over supported
period/phase templates, Hodges–Lehmann amplitude and amplitude-based selection
among equally significant templates. The displayed mesor is the Hodges–Lehmann
location of the observations, an explicit addition not returned by MetaCycle.

JTK requires a regular sampling lattice. Missing scheduled times can leave gaps;
genuinely irregular times are unsupported. Periods must be explicitly requested
integer multiples of the sampling interval, contain at least two intervals and
fit one full cycle into the scheduled duration (last time minus first time plus
one interval). Thus a four-hour one-day course tests 20 and 24 hours from the
20–28-hour request; a six-hour one-day course tests only 24 hours. The UI reports
the effective family, and exports retain the actual family per gene. Periods
are not silently rounded to different hypotheses. Zero canonical amplitude is
represented by period/phase zero: no peak is displayed and the curve is finite
and flat. Its rhythmicity p-value remains valid; its peak is undefined.

JTK accepts at most 160 observations and 160 scheduled times per series. Before
allocating templates, it rejects families exceeding 8 MiB of estimated payload
or 500,000 template-by-observation-squared work units, with an explicit reason.
These limits cover every registered course and prevent an oversized uncached
plan being rebuilt for each gene. The LRU cache holds at most 16 plans and
8 MiB of numeric/template payload. JTK scans yield to the browser every 32 genes.
The other estimators remain available for unsupported JTK designs.

Completed scan results are bound to the exact bundle, method, arm and requested
period identity. A settings change immediately hides previous statistics and
trace selection, including the render before the replacement effect starts.
CSV, raw-value and workbook exports remain disabled until the current request
completes; cancelled requests cannot repopulate the current result set.

Lomb–Scargle is the classic fixed-mean, sample-variance-normalized periodogram.
Its false-alarm value uses the documented Horne–Baliunas frequency-count
heuristic. Arithmetic agreement does not establish exact calibration for every
short or irregular design. The approximation is conservative in the retained
null experiment; a generalized floating-mean periodogram is a different method.

## Validation evidence

The original audit remains unchanged under
`output/methods-validation-2026-10-23/circadian/`; it detected the former
Kendall-template implementation's JTK discrepancy. The repair evidence is under
`output/methods-validation-2026-10-23-r2/circadian/`:

- `benchmark.mts` reruns the original 4,257 series plus twelve missingness,
  tie, origin, scale and resource-bound cases under fixed/scanned settings.
- `canonical_reference.R` sources unchanged frozen MetaCycle code. Supported
  period families and missing lattice positions are explicit. All **6,502**
  matched JTK case/grid combinations agree at raw p < 0.05, including **388**
  public gene/arm/grid profiles and 22 added edge comparisons. Maximum absolute
  p difference is 5.0e-16, period/phase agree exactly, and maximum amplitude
  difference is 4.0e-13.
- `reference.R` provides independent R QR cosine fits/F tests, corrected
  period-search p-values, classic Lomb–Scargle projection and p.adjust checks.
  There are 17,059 paired cosinor/LS outputs; nondegenerate maximum p differences
  are 1.30e-13 and 6.44e-15, respectively.
- `null_calibration.csv` records all denominators and Wilson intervals. After
  Bonferroni, scanned cosinor rejects 0.1–1.8% at nominal 5% in the four tested
  independent Gaussian designs, versus the former 8.0–13.2%. Fixed cosinor
  remains 4.1–5.9%. JTK and LS are conservative in this experiment. These
  simulations do not establish calibration under every RNA error model.
- `performance.mts` tests every gene in the control arm of all three courses
  under both period settings. Arithmetic takes 0.58–3.68 s per workload, with a
  maximum measured 32-gene block of 12.4 ms on the recorded host. Browser/device
  scheduling is not inferred from Node timings.
- `summary.json`, paired CSV files, source hashes and session records retain
  exact numerical and software evidence.

`src/__tests__/fixtures/jtkCanonical.json` contains independent R expectations
generated by `build_fixtures.py`. `jtkCanonical.test.ts` checks 66 JTK profiles,
eight cosinor profiles, irregular-design rejection, explicit supported periods,
zero amplitude and resource/cache limits. Together with the existing rhythm and
time-series tests and two deferred request/export identity regressions, the
focused suite contains 128 tests:

```powershell
node node_modules/vitest/vitest.mjs run src/__tests__/jtkCanonical.test.ts src/__tests__/rhythmicity.test.ts src/__tests__/circadianTimeSeries.test.ts src/__tests__/rhythmScanIdentity.test.tsx --maxWorkers=2
```

GSE157077's embedded unit was regenerated through the current time-series
builder. All 527,184 expression entries, gene order and other metadata remain
identical. The September supersession manifest remains historical evidence.
The bounded successor, preserved prior bytes and read-only verifier are under
`data/quality/gse157077-timeseries-unit-2026-10-23/`; verify with:

```powershell
python data/quality/gse157077-timeseries-unit-2026-10-23/verify.py --check
```

The retained MetaCycle reference is GPL >= 2 and remains in validation evidence
with attribution/license. Application code implements the published mathematics
independently and imports no third-party R source.
