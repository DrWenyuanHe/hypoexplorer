# Independent review of the QC boundary

The simple two-check split would put every `independent_replication` note solely under Experimental design. Some of those notes also document a current input or model problem. The approved implementation keeps the original design check intact and adds a separately named, required pipeline review for the concrete concern. It changes no source assessment, scientific input, model, exclusion or result.

The review read all 159 dataset replication notes and binds all 199 registered leaf assessments in the current raw internal-QC ledger. Selection is an explicit reviewed list in [prepare_proposal.py](prepare_proposal.py); no word matcher, source status or sample-count label determines the decision. [source-model-proposal.json](source-model-proposal.json) preserves each selected source and model check in full, its exact scope, and canonical SHA-256 hashes. That proposal was independently reviewed, approved and integrated through the [reviewed approval file](../reviewed-pipeline-limitations.json); the original proposal remains as its evidence record.

Fifteen dataset/contrast scopes are approved and integrated as **required review**, never failure or automatic data exclusion:

| Dataset | Concrete reason |
| --- | --- |
| GSE247825 | A current control was removed by the authors for poor RNA quality; its retention requires review. |
| GSE236077 | Exact selected animal-to-cage membership, cage randomization and a missing cage term; a retained profile also has a source `qc: fail PCA` flag. |
| GSE305688 | Seven current profiles from three stated RNA-cohort litters, with a group-only model. |
| GSE289461 | Four explicitly stated control/knockout litter pairs, with no paired/litter term. |
| GSE87544 | Current computational profiles mix a two-mouse aggregate with single-mouse aggregates. |
| GSE175461 | Ten selected animals from at most four cage-randomized exposure units, with a group-only model. |
| GSE229799 | Contradictory source tissue, strain and cohort fields leave current input identity unresolved. |
| GSE214877 | Controls span three cell lines, while differentiated profiles all derive from H9 at varying days; the current condition-effect interpretation remains unresolved. |
| GSE229159 | The current arms retain the two selected-condition libraries excluded for sequencing-quality problems. |
| GSE298648 | Treatment-labelled incubators and treatment-confounded source replicate groups are not separated by the current sex-adjusted fit. |
| GSE227725 | Thirty-five current offspring from at most sixteen maternal treatment units, with no dam/litter term. |
| GSE201408 | Ten litters explicitly contribute one animal to each genotype arm; the model has no litter block. |
| GSE245146 | Thirty-eight selected offspring from at most twenty treated/control dams, with no dam/litter term. |
| GSE281726 | Twenty-three selected piglets share two pens and originate from three sow litters; the model has neither structure. Exact pen-treatment correspondence is not asserted. |
| GSE135007 | Five selected island males share one stated litter, with no litter structure in the sex-adjusted model. |

GSE314184 already has separate required source-species and source-pairing pipeline checks; the approved implementation adds no duplicate there. GSE135007's normalization review covers a different concern, so the independent litter/model review is included even though its overall pipeline status is already nonpassing.

The parent independently reviewed the first thirteen cases and requested adding GSE214877 and GSE229799 as required reviews. These two reviews leave the comparative estimand and correct source fields unresolved; they neither assert numerical failure nor mandate a potentially unidentifiable adjusted model. Ten other named boundary cases distinguish missing allocations, legitimate averaged contrasts, general observational confounding and differences from author filtering from a demonstrated current processing problem. These exclusions are not new passes.

A direct check of GSE190389 found 45 selected rows and 45 unique original library identities. Multiple sequencing accessions are already joined inside rows, so the review does not invent a technical-duplicate problem. GSE245146's current sheet contains 21 control and 17 case offspring. The retained primary methods were also checked for the explicit GSE247825/GSE229159 quality exclusions, GSE245146 twenty-dam source cohort, GSE281726 two-pen housing and GSE298648 treatment-labelled incubation protocol.

An approved companion must remain bound to its exact dataset, contrast, optional track and frozen source/model check objects. Missing or stale approval evidence must stay nonpassing; removing a companion silently would create a false pipeline pass. Dataset or contrast aggregates must incorporate every applicable leaf companion. The original raw combined assessment remains the historical compatibility record. Changes in the newly separated badge counts are classification changes, not additional experimental validation.

Reproduce the package with `python -X utf8 data/quality/pipeline-separation-2026-09-11/review/prepare_proposal.py`. Add `--check` for a read-only freshness check. The producer and the current proposal passed that check. This review did not rerun biological models or revise any scientific data.

## Final reader and integration review

The root's [reviewed approval file](../reviewed-pipeline-limitations.json) implements all fifteen cases across 32 exact dataset, contrast and track scopes. Independent [reader-review.json](reader-review.json) and [reader_review.mts](reader_review.mts) verify those current scopes and 608 in-memory mutations across 19 categories. Missing or duplicate approvals, changed source/model evidence or requirements, wrong scopes, and a companion changed to pass all return a required `not_assessed` check. None silently clears Pipeline QC.

The same independent review checked every original and companion check in all 332 dataset/contrast exports, recomputed both new aggregate statuses, and compared the separation report with the exported assessments. The final dataset counts are Pipeline QC 140 passed / 16 review / 3 not assessed; Experimental design 82 / 60 / 17; Author concordance remains 27 passed / 30 review / 101 not assessed / 1 not applicable. The historical combined assessment retains 81 passed / 60 review / 18 not assessed.

The build guard pins the exact approved-file bytes, its original proposal and the raw internal-QC ledger. Its reviewed approval SHA-256 is `5b0a393e4c6249a407983f9804804dadb9a7977b15ed922eefd535b3a50f176b`. The final proposal SHA-256 is `cad37c7f8d9420633960bd77a2c3e6b5805ca5b0cc24b16d49e02f517dd80dff`. A Windows newline/hash mismatch in the first packaging attempt was caught before integration and corrected by writing and checking exact UTF-8 bytes; the current producer and an independent file-hash command agree.

Eight focused test files passed all 63 tests, covering the split, approved limitations, badges, library/tracker consistency, verification reference, historical tracker claims and public evidence pages. The quality-report freshness check and the separation audit also passed. The latter explicitly verifies unchanged pinned ledgers and policies; this display review does not claim a new raw-science byte scan or model replay.

No blocking finding remains in the reviewed reader or integration. Recheck the independent report with `node node_modules/tsx/dist/cli.mjs data/quality/pipeline-separation-2026-09-11/review/reader_review.mts --check`.
