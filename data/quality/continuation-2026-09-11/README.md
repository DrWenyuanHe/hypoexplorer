# Dataset validation continuation — September 11, 2026

The subsequent [QC separation](../pipeline-separation-2026-09-11/README.md) introduces separate Pipeline QC and Experimental design badges. All `internalQc` counts in this continuation report retain the original combined definition; author-concordance counts are unchanged by the separation.

This document records the first completed September 11 round. Its figures and validation results below are that round's snapshot. The [second round](../continuation-round2-2026-09-11/README.md) records subsequent work. The generated [current report](ADVANCEMENT_REPORT.md) and [complete record](continuation-report.json) continue comparing all 159 datasets with the original 75-QC/25-author baseline, including subsequent evidence. Every remaining required check and all 51 intake track/comparison assessments are recorded.

At completion of the first round, internal-QC passes increased from **75 to 81** and author-concordance passes from **25 to 26**. All 14 intake studies had an internal-QC assessment: three passed and eleven required review. Across the complete collection, internal QC had 81 passes, 58 reviews and 20 not assessed; author concordance had 26 passes, 28 reviews, 104 not assessed and one not applicable.

## Evidence added

- Three original inputs are completely reconstructed from authenticated deposits: E-MTAB-6929, GSE132308 and GSE95243. The comparison covers 1,552,080 count cells. The unchanged GSE95243 preparation explicitly excludes 24 ENSGR and 92 ERCC rows; every excluded value is accounted for. See the [source reconstruction package](../../internal-qc/source-recovery-2026-09-11/README.md).
- All 14 intake studies, 22 tracks and 51 comparisons receive complete source, normalization and model-output replays. Fifty numerical comparisons reproduce within the existing tolerances. GSE135007 remains under review because its serialized count input changes TMM factors and downstream statistics slightly. Its original pre-serialization recipe independently reproduces the results, but that does not erase the saved-input discrepancy. See the [numerical package](../../internal-qc/intake-numeric-2026-09-11/README.md).
- The complete intake replication review maps 488 selected profiles across comparisons to primary sources. Reused profiles are not counted as additional animals. Four comparisons pass the replication assessment; 47 retain unresolved cage, litter, exposure, pool or pairing questions. See the [replication package](../../internal-qc/intake-replication-2026-09-11/README.md).
- GSE278158 now has a direct comparison against the complete publisher-selected 499-gene list. The explicit `log2(src1KO/wt)` column fixes orientation. All 498 matched genes agree in direction, with Pearson 0.999498 and Spearman 0.999921; the remaining gene fails the unchanged expression filter. The unchanged policy supports selected-result author concordance. Only 98 matched genes retain current FDR below 0.05, so full statistical reproduction is not claimed. See the [complete author comparison](../../internal-qc/source-recovery-2026-09-11/author-GSE278158/README.md).

The GSE314184 display metadata now correctly identifies **Rhabdomys pumilio**, the African striped mouse. Its historical Mus musculus annotation/pathway configuration is retained and requires an explicit feature-mapping review. The dam-versus-sire comparison also retains a required pairing-model review. No orthology or mating-pair assignments were invented.

GSE314184 also advances from an incomplete author-table search to a documented, scoped **not located / not tested** review. The primary paper, all 31 supplementary pages and the complete 12-file author repository do not provide a matching result table for the four current whole-MPOA comparisons. Other reported comparisons and cluster markers cannot substitute for those results. Uninspected attachments and repositories are explicitly listed, so this is not a claim that no matching data exist anywhere. This source-availability review grants no author-concordance pass. See the [independent availability review](../../internal-qc/source-recovery-2026-09-11/review-continuation/author-availability-review.json).

The pathway provenance validator distinguishes that biological species from the retained mouse-reference annotation. The exception is limited to the four exact reviewed GSE314184 bindings and requires the unresolved species-mapping review; mismatches for other studies remain errors. The [independent review](../../internal-qc/source-recovery-2026-09-11/review-continuation/fgsea-final/README.md) verifies unchanged pathway artifacts and rejects source or binding substitutions.

## What the badges mean

Internal QC and author concordance remain separate. A dataset-wide internal-QC pass requires every applicable required check across every audited intake track and comparison to pass. Runtime validation rejects missing tracks, borrowed track records, incomplete comparisons and inconsistent aggregates. Missing evidence cannot inherit a passing badge.

Author concordance requires reviewed cohort, contrast and effect compatibility, enough matched genes and coverage, then either high correlation or matched-gene directional agreement under the existing policy. Significance differences remain visible context. A published selected list supports a selected-list claim; it does not establish agreement over the unavailable complete author-tested universe. Biological replication remains an independent internal-QC check.

## Preservation and history

The captured scientific corpus comprises 2,332 files and 5,097,897,642 bytes. [Scientific preservation](scientific-files.after.json) compares every current file with its original SHA-256 and size. Counts, sheets, group membership, models, normalization, DE and pathway outputs are retained. The report separately verifies that all 54 pre-existing author comparisons, all 142 original replication records and the acceptance policy remain unchanged.

The September 5 report described 27 author passes. Intervening effect-definition reviews had reduced the current baseline to 25 before this continuation began. Both facts are retained. The historical report now reproduces from 17 exact recovered dependencies in a closed archive; see [recovery provenance](remaining-history-recovery.json) and the [historical report](../remaining-2026-09-05/README.md).

The two earliest reports are explicitly cumulative and now summarize current evidence for the original 145 datasets: 78 internal-QC passes and 25 author passes. Their unchanged producers exclude the 14 intake datasets. The previous report bytes and all 12 required historical inputs are preserved in a [separate replay archive](../../internal-qc/source-recovery-2026-09-11/review-continuation/cumulative-history/README.md), with 15 tests proving historical replay and absence of intake credit. Round two through the final September 5 report remain closed historical snapshots.

## Reproduction

Run from the repository root with the documented Python and R dependencies:

```text
npm run check:validation-replays
npm run check:validation-continuation
npm run check:quality
npm run check:author-validation
npm run check:query-index
npm run check:verification-advancement
```

The replay command recomputes complete raw-source transformations and R analyses in isolated directories. The continuation gate checks sealed evidence against current sources and scientific files, source mappings, current matrices and the complete author/filter comparison. The quality gate includes that continuation gate before validating the generated assessments. The advancement gate separately verifies all scientific-file hashes and the current report, alongside closed historical reports. Rebuilding evidence does not update an independently reviewed reader seal automatically.

Executed checks and browser observations are recorded in [VALIDATION.md](VALIDATION.md). Independent review is recorded in [REVIEW.md](REVIEW.md). The report records unresolved required checks rather than treating an exhausted source search or successful arithmetic replay as a scientific pass.
