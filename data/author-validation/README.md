# Author-result verification

## Current processing-quality badges

The primary UI displays **Pipeline QC**, **Experimental design** and **Author concordance** independently. Hover, focus or tap any badge for individual checks. Passed checks show a green check mark; failed, review-needed, not-assessed and not-applicable checks have distinct symbols and text. The earlier author-reproduction classifications below are retained as detailed evidence, not used as the primary quality decision.

Pipeline QC checks matrix validity, source integrity, sample assignments, normalization, model evidence and output integrity. Experimental design separately checks independent biological replication and retained sample support. Reviewed species-mapping, input-quality and model-pairing concerns remain required pipeline checks. Neither assessment infers a pass from author agreement, a script exit or audit completion. Missing inputs or stale sidecars cannot supply a green check. `src/data/pipelineQc.ts` separates the recorded checks from `data/internal-qc/assessments.generated.json`; the original combined `internalQc` assessment remains available for historical audits. See [the separation report](../quality/pipeline-separation-2026-09-11/README.md).

Author concordance evaluates paired effects in the registered comparison. Policy `author-concordance-v2` requires at least 30 paired genes and 90% relevant reference/output coverage, plus either Pearson and Spearman at least 0.90 or at least 90% same-gene directional agreement among at least 30 nonzero pairs covering 90% of all pairs. Cohort, contrast, identifier and effect-definition compatibility must be supported whichever route passes. Magnitude differences, P values, FDR and significant-gene counts are contextual and do not gate acceptance. Every metric outcome remains visible, and invalid reported metrics cannot be hidden behind a passing alternative. These are project acceptance defaults, not universal scientific cutoffs. Selected-gene references remain explicitly scoped. The v2 change corrects the earlier requirement to pass correlation, direction and magnitude together; its effect on unchanged evidence is recorded separately in `data/quality/round2-2026-09-05/policy-only-impact.json`.

Run `npm run build:quality` after updating processing evidence or author comparisons, then `npm run check:quality`. The combined JSON, TSV and coverage report are in `data/quality/`; they include dataset and per-comparison assessments. Production builds check freshness. Missing local audit inputs require restoring those inputs or regenerating an honest reduced-coverage assessment. No saved passing result is silently carried forward.

Expected input fingerprints retained from fixed earlier evidence are recorded
separately from current availability. The input-availability sidecar marks
absent retained files `unavailable_not_verified`; this metadata supplies no
passing QC decision or fresh verification. See the
[intake policy](../intake/oxt-avp-2026-10-19/README.md#retained-qc-input-identities-and-availability).

## Retained detailed author-reproduction review

The reader-facing workflow is `#/verification`. The library, tracker, active Gene/Pathway Explorer, cross-dataset reports and comparison-set columns read the same generated verification record. A badge is a dataset-level decision with an explicit contrast scope, not a certification of every displayed gene or pathway.

## Read the detailed author-review claim

- **Fully verified:** explicit sign-off covering every registered contrast, suitable full author results, all scientific comparison requirements met, source/output integrity checks, and no unresolved limitations.
- **Author results compared, limits remain:** direct author results were compared within the recorded scope. Read the effects, statistics, coverage and limitations; this is not full sign-off.
- **Author effects reconstructed:** a derived effect or separate author-method analysis was checked. That does not verify all inference in the registered Explorer output.
- **Author results untested:** source evidence is recorded, but agreement with comparable author results has not been tested. This is not a mismatch.
- **No comparison evidence:** no source or author-result comparison supports a verification claim.
- **Unresolved, review required:** an observed result, cohort or metadata difference remains. Within this detailed author-review classification, this warning takes priority over a positive evidence label, and missing evidence cannot clear it. The separate effect-concordance assessment may pass despite unresolved inference.
- **Verification in progress:** source availability or a located/accessible result still needs review or comparison.
- **Outside verification scope:** the explicitly excluded macaque single-cell atlas; not a failed comparison.

The detailed author-review labels come from `VERIFICATION_CLAIMS` and `getVerificationClaim`. The legacy internal `partial` state is an administrative grouping, not a percentage of passed checks or a common level of scientific assurance. This historical classification remains independent of the three quality assessments; existing `partial` filter values remain compatible as a combined legacy group.

Evidence level (`author_results`, `reconstructed`, `source_only`, `none`) is independent of file availability and comparison outcome. A selected-gene table is direct evidence, but not a full tested-gene universe. `not_located` means not found in the reviewed sources, not globally absent. `located` means retrieval is not confirmed. `access_blocked` records an actual access barrier; an HTML challenge is never treated as downloaded scientific data. Paper access is separately recorded from supplement/result-file access.

## Scientific comparability is not file integrity

A checksum supports a byte-for-byte source match. A semantic or manual structure review supports a different, explicitly recorded claim. An exact output trace establishes that the deployed data matches the registered analysis tables. None proves that sample selection, the statistical model or the analysis is correct, or that the result agrees with author inference.

Every record has a detailed scientific review that names the result being assessed, the author reference, acceptance criteria, conclusion and six dimensions. The requirements below govern historical full author-result reproduction sign-off. They do not replace the current badge's alternative correlation or direction routes described above.

| Dimension | Requirement for full author-result reproduction |
|---|---|
| Samples and replication | Reconcile cohort membership, tissue, exclusions, sample labels and biological replication. Cells from one animal cannot substitute for independent animals. |
| Biological comparison and direction | Establish the same biological question, treatment, baseline, time point and direction. A pooled effect, subgroup effect and interaction are different questions. |
| Gene identifiers and tested genes | Reconcile identifiers, mapping, filtering and the tested-gene universe. Report ambiguous and unmatched genes. |
| Effect definition and magnitude | Establish the definitions first, then reconcile numerical magnitudes for full reproduction. High correlation alone does not prove identical magnitudes. The current concordance badge requires compatible definitions but reports magnitude discrepancies as context. |
| Statistical model, P values and FDR | Reconcile the replication unit, model, covariates, raw P, multiple-testing correction and calls. Missing author statistics remain unassessed. |
| Reference coverage | Account for usable gene-level author results across every registered contrast. Selected lists and figure headlines cannot establish full-universe agreement. |

Different defensible methods can answer the same biological question. Full reproduction requires documented reconciliation of effects and inference; the current concordance badge permits different inference and magnitudes when one numerical route and all shared compatibility/coverage checks pass. Different estimators can have compatible biological direction and effect units without producing identical coefficients. Explicit source-bound semantic reviews in `concordance-reviews.json` separate those definitions from legacy numerical limitations, retain the prior review, and expire when the comparison, orientation, method or concern changes. `npx tsx scripts/audit_concordance_reviews.mts` checks every cited source hash before the quality build. Neither workflow requires identical method names. The versioned badge cutoffs are project acceptance defaults, not universal scientific cutoffs. Do not choose a tolerance or threshold merely to force a match.

Name the comparison basis explicitly. A registered Explorer result is what users see. A separate author-method reconstruction or sensitivity analysis does not validate that registered result merely because the sensitivity matches the paper. Keep both outputs and their conclusions distinct. Raw-read alignment, laboratory measurements and raw sequencing quality are outside this processed-data verification workflow.

## Review and reproduce

1. Inspect PMID/DOI/accession, manuscript, official supplementary inventory and processed deposits. Inspect table contents, not just filenames: normalized-count files may also contain author DE statistics. Preserve exact file bytes, URLs and SHA-256 evidence where available.
2. Match tissue, organism, sample/cell membership, exclusions, replication unit, contrast direction and identifiers. Report unjoined or filtered genes; never resolve ambiguous identifiers by arbitrary selection.
3. Compare effects, inference and tested-gene coverage. Record the threshold, orientation and universe. A missing adjusted P is not a negative call; a significant-only list cannot establish full-universe agreement. Keep raw P distinct from adjusted P. Separate whole positive-call-list overlap from comparison on shared genes with finite statistics, and count local calls lacking an author row or usable author statistic.
4. Investigate differences using documented models, versions and predeclared sensitivity analyses. An author-compatible reconstruction remains separate from the registered standardized result. Do not tune exclusions/thresholds to reproduce a headline count. Conditional fits using the observed author testing universe must be labeled as such, not described as discovery of the original filtering algorithm.
5. Edit `manual-review.json` for scientific findings, links, status, scope and date. Edit `verification-review.json` for explicit availability, outcome, reason and next step. Record the result basis, six scientific dimensions, criteria and conclusion in `comparability-review.json`. Unfinished work must remain visible. Add numerical comparisons in `scripts/compare_author_results.mts` and/or retained reproducible dataset-specific artifacts.
6. Regenerate the shared records and tracker, then test:

```text
npx tsx scripts/compare_author_results.mts
npx tsx scripts/build_author_validation.mts
npm run build:tracker
npm run check:author-validation
npm run typecheck
npx vitest run src/__tests__/authorVerification.test.tsx src/__tests__/authorValidationPanel.test.tsx src/__tests__/verificationView.test.tsx
```

`check:author-validation` and `--require-complete` verify recorded audit coverage, integrity and freshness. **They do not assert that every dataset has passed scientific verification.** The builder separately reports incomplete and unresolved scientific reviews. An unresolved scientific review can have a completed audit record.

## Data contract and sign-off

`validation-records.generated.json` uses schema 2. Every record contains `verification.state`, `evidenceLevel`, `resultAvailability`, `comparisonOutcome`, `reason`, `nextStep`, `fullyVerifiedContrasts` and `comparability`. The comparability object records `target`, `resultScope`, `registeredContrastIds`, `basis`, `reference`, `assessment`, six `dimensions` with a status and note, `criteria`, and `conclusion`. Reviewed contrast IDs are not successful sign-offs. A requirement can be matched, compatible with recorded justification, limited, different or not established. A comparable assessment requires every dimension to be matched or compatible. JSON, TSV and the generated Markdown report carry the same decisions. Registry closure checks reject missing or extra dataset IDs; numerical comparisons require an explicit comparability profile and cannot silently fall back to an untested template.

Pathway validation records distinguish historical regeneration comparisons from
newly admitted analyses. `rebuilt_provenance_checked` retains a migration baseline
and its measured changes. `current_provenance_checked` verifies current schema-3
FGSEA provenance, source-bound intake evidence and output checksums without a
pre-migration baseline. Neither state establishes agreement with author pathway
results. The [OXT/AVP intake runbook](../intake/oxt-avp-2026-10-19/README.md)
describes the latter checks and their limits for GSE65663.

The state evaluator in `src/data/authorVerification.ts` does not infer a full badge from correlation or legacy `validated_with_notes` status. Full sign-off additionally requires `author_result_match`, direct comparison, exact output trace, verified source matching, accessible author results, a concordant outcome, a comparable scientific assessment, no review flags, and explicit registered contrast IDs covered by the comparison profile. The target must be the registered Explorer output and the scope must be full results. Selected results, effects-only evidence and separate reconstructions cannot confer full verification. Unknown/duplicate contrast IDs or conflicting evidence cause an error. Sign-off on only some contrasts cannot make a multi-contrast dataset fully verified.

Revisit verification whenever source files, cohorts, preprocessing, models, reference annotation or outputs change. Hash-pinned source evidence and old interpretations must not silently be carried into a new numerical result.

## Evidence retained in this continuation

The [2026-09-05 verification advancement report](../quality/advancement-2026-09-05/ADVANCEMENT_REPORT.md) covered the then-current 145 datasets. Numerical replay covered all 144 non-atlas datasets and their 147 registered contrasts. Complete internal-QC passes increased from 1 to 23, author-concordance passes from 10 to 19, and structured author comparisons from 28 to 50. The report links every remaining blocker, original source, reproducible extraction and independent review. Those historical combined-QC counts use the earlier definition and cannot be compared directly with the current Pipeline QC badge.

The [September 11 continuation](../quality/continuation-round2-2026-09-11/README.md) extends source, replication and author-comparison evidence to the 159-study corpus. The [September 12 HFD intake](../quality/hfd-intake-2026-09-12/README.md) adds GSE104709 and GSE107324, bringing that registry to 161 studies.

The [October 19 OXT/AVP intake](../intake/oxt-avp-2026-10-19/README.md)
adds the GSE65663 rat SON salt-loading comparison, bringing the registry to 162
studies. Its current source/model/output checks do not establish author-result
concordance. GSE30733 remains held because array acquisition is confounded with
the lactation comparison. The separate
[GSE147092 OXT cell reference](../expression/oxt-reference/README.md) preserves
descriptive single-cell expression without adding a DE registry record.
[The current quality report](../quality/QUALITY_REPORT.generated.md) records
Pipeline QC, Experimental design and Author concordance counts independently;
each count applies only to that assessment and its recorded scope.

The [ten additional reviews](continued-sources/ten-dataset-followup-2026-09-04/README.md) extend source-cohort and statistical checks to tanycyte insulin, POMC Drd2, FGF1, Lef1, MKRN3, CBD, orexin, maternal HCD, hibernation and AgRP fasting. Recovered code explains joint-group and batch-model differences in several studies. The records distinguish successful separate reconstructions from unchanged Explorer outputs, recover damaged identifiers using source evidence, and keep missing tests separate from observed disagreements.

The [five-dataset follow-up](continued-sources/five-dataset-followup-2026-09-04/README.md) advances ARC HFD, PNOC/LepR, SON dehydration, MPOA PNOC and POMC estrogen reviews. It records exact cohort mappings, separate author-method reconstructions, rounded threshold values, model-inferred missing tests and unresolved publication selection conflicts. Each dataset has an explicit tracker next step; none is automatically promoted from reconstruction agreement.

See [continued-source inventory](continued-sources/README.md), the source-review batches and dataset-specific folders. Particularly informative reconciliations are [GSE280030](continued-sources/GSE280030/README.md), [GSE128148](continued-sources/GSE128148/REVIEW_2026-09-04.md), [GSE224254](continued-sources/GSE224254/REVIEW_2026-09-04.md) and the [organoid/zebrafish comparisons](continued-sources/final-numerical-batch-d/REVIEW_2026-09-04.md). The [bounded deposited-header audit](continued-sources/HEADER_AUDIT_2026-09-04.md) documents both the files inspected and residual archive/format limitations; it does not independently establish absence.
