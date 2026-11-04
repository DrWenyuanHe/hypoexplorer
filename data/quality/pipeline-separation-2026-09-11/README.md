# Pipeline QC, experimental design and author concordance

The library, tracker, Explorer, verification guide and public study pages now show three separate assessments. Each badge opens its own checklist, including passed checks, review reasons and missing evidence. Filters and exported reports use the same assessments.

| Assessment | Passed | Review needed | Not assessed | Not applicable |
| --- | ---: | ---: | ---: | ---: |
| Pipeline QC | 140 | 16 | 3 | 0 |
| Experimental design | 82 | 60 | 17 | 0 |
| Author concordance | 27 | 30 | 101 | 1 |

These are dataset-level counts across 159 datasets. The change separates existing evidence and adds explicit reviews of known input/model concerns. It does not represent new experiments, repaired analyses or newly measured author agreement. No assessment is marked failed in this snapshot; review and missing evidence remain distinct nonpassing outcomes.

## What each badge means

**Pipeline QC** covers processing of the available deposited data: source integrity, sample assignments, matrix values, count accounting, normalization, model evidence and output integrity. All applicable required checks must pass. Known species-mapping, pairing, input-quality and model concerns remain here, even when a numerical replay succeeds. This workflow begins with processed deposits; it does not certify raw-read alignment, laboratory practice or every potential biological confounder.

**Experimental design** contains the original independent-biological-replication and retained-sample-support checks. Missing animal-to-cage, litter, pair or pool assignments remain visible. A design pass means these recorded checks passed for the stated scope; it is not a general certification of the experiment. A pipeline pass can coexist with a design review.

**Author concordance** is unchanged. Comparable matched-gene evidence with sufficient coverage can pass through either strong correlation or same-gene directional agreement. Matching author P values, FDR or significant-gene totals is not required. Similar overall percentages of upregulated genes alone do not establish matched-gene agreement. Missing author tables do not prevent the other badges from passing.

Dataset-wide assessments retain coverage of registered comparisons; the Explorer follows the selected comparison. Check requirements, original notes and evidence references are preserved. Unknown future check types stay in Pipeline QC. A missing or empty assessment cannot become a pass through the split.

## Keeping known processing concerns visible

An independent review read all 159 dataset replication notes and bound all 199 raw leaf assessments. Fifteen datasets have concrete source or model concerns embedded in those notes. Their original design checks remain intact, and a separate required pipeline review records the processing concern. The approved evidence covers 32 exact dataset, comparison and track scopes.

Examples include a retained library excluded for poor RNA quality, a recorded paired design analyzed without pairing, and known repeated maternal treatment units analyzed without their shared structure. Unknown cage membership alone does not automatically imply a processing defect. The review distinguishes these cases explicitly; it does not infer problems from a word search or require every author exclusion to be copied.

The [independent review](review/README.md) lists all 15 decisions and the exclusions considered. The approved companion checks are bound to their exact source/model evidence. Missing, changed, duplicate or wrongly scoped approval evidence yields a required nonpassing check. The build also checks the approved file, original review proposal and raw ledger against their recorded hashes.

For example, GSE262407 now passes Pipeline QC while the diet comparisons retain Experimental design review. GSE247825 passes the replication check but retains Pipeline QC review for a specifically reported poor-quality library. GSE314184's species-mapping and pairing problems remain explicit pipeline blockers.

## Remaining pipeline work

Internal QC can be improved internally where the input, metadata and analysis recipe are available. Separation does not repair the remaining discrepancies. Some next steps require recovering missing source information before a defensible repair is possible.

| Dataset or group | Remaining limitation and next action |
| --- | --- |
| GSE135007 | The saved, serialized input does not exactly replay normalization and downstream statistics under the existing tolerances. Preserve the original precision through preparation, rerun from the saved input, and reconcile resulting outputs. Its recorded sibling cluster also needs model review. |
| GSE185074 | Two source-to-input cells differ by at most 1.0914e-11. Recover and document the actual conversion/serialization step; do not silently relax the exact source-reconstruction check. |
| GSE205313 | Original Salmon outputs are authenticated, but the exact transcript annotation, mapping and gene summarization/rounding recipe are missing. Recover those dependencies before reconstructing registered gene counts. |
| Macaque atlas | Original Seurat objects, raw pseudobulk counts and normalization intermediates are absent. Restore those files and rerun the audit. Rounded normalized CPM cannot recover the missing raw counts. |
| GSE87544 | Derived-input provenance remains incomplete, and computational profiles mix one-mouse and two-mouse aggregates. Recover the preparation and mouse membership, then review compatible aggregation and modeling. |
| GSE314184 | Rhabdomys source features use a retained mouse-reference configuration without an accepted complete mapping. Validate the feature/orthology mapping; recover actual mating-pair membership before reviewing paired inference. |
| GSE247825, GSE229159, GSE236077 | Current inputs retain explicitly flagged or author-excluded libraries. Review source quality evidence and the effect of retaining those inputs; exclusion identities must be established before any rerun changes them. GSE236077 also requires cage-model review. |
| GSE305688, GSE289461, GSE175461, GSE227725, GSE201408, GSE245146, GSE281726 | Recorded litter, cage, dam, pen or pair structure needs compatible model review. Recover exact assignments where absent; sample names and expression similarity cannot supply genuine membership. |
| GSE298648 | Treatment is confounded with the recorded incubation/replicate grouping. The current data cannot estimate those effects separately; review the interpretation and available independent source batches. |
| GSE214877 | Cell-line and differentiation-day structure differ across conditions. Review which biological effect the available design supports; adding an unidentifiable adjustment is not a solution. |
| GSE229799 | Tissue, strain and linked-cohort fields conflict. Resolve the actual input identity from primary provenance before changing its labels or interpretation. |

The [complete separation record](separation-report.json) contains every dataset and comparison, all three assessments and the historical dataset status. The [current quality export](../assessments.generated.json) also retains the full unchanged `internalQc` objects. The [count report](SEPARATION_REPORT.md) gives the same totals in a compact form.

## History and preservation

The original combined `internalQc` assessment is retained for compatibility with earlier validation rounds: **81 passed, 60 review, 18 not assessed**. It is explicitly identified as historical in the current JSON/TSV exports. Earlier continuation reports still use that combined definition; their counts should not be compared directly with the new Pipeline QC badge.

The frozen [baseline](baseline.json.gz) captures all original dataset/comparison QC and author assessments, policies and nine file references before this report was rebuilt. The separation audit checks them unchanged. A fresh scientific byte audit also verified **2,332 files / 5,097,897,642 bytes with zero changes**. This work changes no scientific input, sample selection, analysis configuration, numerical output or author decision.

See [validation](VALIDATION.md), [browser observations](BROWSER_REVIEW.md) and the [independent reader review](review/reader-review.json). The reproducible separation gate is `npm run check:qc-separation`, also included in `npm run check:quality`.
