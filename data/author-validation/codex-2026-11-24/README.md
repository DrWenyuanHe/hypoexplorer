# Codex review of the not-comparable datasets, 2026-11-24

Goal: re-examine the 19 datasets whose author comparison was `not_comparable` and that the
2026-11-21 pass had not queued (E-MTAB-12340 carries a 2026-11-15 lead). Each got one Codex worker (`gpt-6.2-astra`, reasoning
`xhigh`, workspace-write sandbox with network) and then one Codex refuter. The method,
file layout and merge rules are those of [the 2026-11-21 pass](../codex-2026-11-21/README.md).

The prompts differ from that pass in three ways. They add a `not_comparable` category.
Workers may not read other checkouts or other datasets' proposals. The refuter must reject
a `compared` proposal whose author result answers a different question, and for
`no_valid_comparison` must look for a missed author result. `scripts/build_prompts.cjs`
derives both prompts from the earlier ones.

| File | Content |
|---|---|
| `queue.json`, `scripts/all.txt` | The 19 datasets with category, current reason and next step |
| `WORKER_PROMPT.md`, `REFUTER_PROMPT.md`, `result.schema.json` | Prompts and the final-message schema |
| `findings/`, `verdicts/`, `corrected/` | Worker proposals, refuter verdicts, final proposals |
| `check_proposals.cjs`, `check_specs.mts`, `merge.cjs` | Proposal keys and enums, spec rules, ledger merge (`merge.cjs` is the version on main after the held-six merge) |
| `logs/` | Final messages, `progress.log` and merge output; the full Codex transcripts (`*.log`) stay with the evidence, not in git |
| `scripts/` | `run_one.sh` (worker then refuter, resumable), `run_wave.sh`, `launch.sh` (detached) |

## Results

Of 19 verdicts, 17 were `upheld_with_corrections`, 2 `upheld` and none `refuted`, so there
was no second round. Closures: 14 `no_valid_comparison` and 5 `compared`.

Compared (these move from `not_comparable` to `method_differences`; none is fully verified):

| Dataset | Scope | Finding |
|---|---|---|
| GSE314970 rat aging | 613 of 817 selected genes | 604 of 612 nonzero directions agree; Pearson 0.9325, Spearman 0.9264. Coverage 75.03% is below the 90% requirement, and one aged animal differs. |
| GSE148641 arcuate Rev-erb | 24 plotted genes | All 24 directions agree; 19 of 21 genes the authors called significant on both diets miss the registered BH 0.05. |
| GSE128537 macaque aging | 3 genes (whole published list) | 3 of 3 directions agree, within 0.028 log2. Below the 30-pair minimum. |
| GSE281701 cachexia | 3 genes | 3 of 3 directions agree. The plotted Lrg1 significance (about 24) exceeds the registered one (5.43 raw, 2.79 FDR). Below the 30-pair minimum. |
| GSE285006 POA dnFGFR | 1 gene (Gnrh1, qPCR) | Direction agrees; the registered FDR is 0.053 and the author assay is qPCR. Below the 30-pair minimum. |

No valid comparison: GSE245146, GSE266472, GSE281726, GSE227725, GSE229440,
E-MTAB-12340, GSE189945, GSE220533, GSE282067, GSE157077, GSE201207, GSE314029,
GSE143818, GSE309435. No author gene-level result for the registered contrast was found.
Two notes for later work: GSE314029's workbook and BioSample swap the labels of Gr2 and
Gr4 (the registered Gr3 and vehicle groups are explicit), and GSE309435's adjusted P values
do not fit the Bonferroni method the authors describe.

## Merge (2026-11-24)

Merged after the held-six ledger edits landed on main. `merge.cjs` changed 19
manual-review and 19 verification-review records, changed 1 and added 4 comparability
records, and added 2 comparison specs (GSE128537, GSE314970). No record outside the 19
changed, none of the 19 had changed on main since the proposals were written, no active
concordance review binds to any of them, and no existing spec was replaced.

Five `manual-review.json` statuses became `validated_with_notes`. Four were
`processed_source_match`. GSE281701 was `review_required`, so its merge lifts a warning:
the earlier flags recorded missing evidence, and the new record rests on three genes and
records the Lrg1 significance difference. The maintainer was asked whether to restore the
warning and decided on 2026-11-24 to keep it lifted; the difference stays in the record.

GSE309435 keeps its earlier `review_required` status, so its derived outcome is
`unresolved` although its verification record says `not_comparable`. The merge did not
change that.

## Evidence reconstruction (2026-11-27)

The evidence folders were not copied off the computer the pass ran on. On 2026-11-27 the
folders of the two datasets with new comparison specs were rebuilt from the Codex
transcripts (each `apply_patch` turn diff carries the full file and its git blob id) and
fresh public downloads, outside the repository:

- **GSE128537:** every reconstructed script matches its transcript blob id;
  `compare.py` also matches its spec pin. Rerun, it writes `author-effects.tsv`
  byte-identical to the pin (`726939d9…`). All six original references re-download
  with their pinned SHA-256. `SOURCES.tsv` is partial: the transcripts print only 12
  of its 85 rows in full.
- **GSE314970:** the reconstructed `compare.py` writes `selected-effects.tsv`
  byte-identical to the pin (`2126d01a…`), and five of the six original references
  re-download with their pinned SHA-256. The sixth, `supplement-export.zip`, is
  the archive Europe PMC assembles on each request, with entry dates set to the
  request time. A same-size copy downloaded on 2026-11-27 hashes to `87b49eb0…`, not
  the pinned `2b02256d…` (a 2026-11-16 copy differed too). Its member
  `sciadv.ady8401_tables_s1_to_s5.zip`, which `compare.py` reads, hashes to
  `b7cbb7e5…`, as the refuter recorded on 2026-11-24. That holds for Tables S1 and S2
  inside it as well. The spec now pins that member instead of the wrapper, at the PMC Open
  Access URL the refuter fetched it from (`pmc-oa-opendata`, `PMC13082319.1`). `SOURCES.tsv`
  keeps the 2026-11-24 wrapper row as the historical retrieval; `compare.py` still opens the
  wrapper, so replaying it needs that file and checking the pin needs the member.

Each rebuilt folder carries a `RECONSTRUCTION.md` that separates byte-verified files
from unverified ones: `SOURCES.tsv`, regenerated tables with no recorded hash, and
the retrieval logs, which cannot be recovered. The other 17 folders were not rebuilt;
their records here and their transcripts remain.

## Not yet done

- **Evidence release.** The evidence folders
  (`continued-sources/<ACCESSION>/codex-2026-11-24/`) are excluded from git and not yet in
  a data release. The two new specs pin author files there, so they validate only where
  those folders exist.
- **Generated records.** Regenerated on 2026-11-27 with the retained audit cache.
- **Author sources.** The numbers above were reproduced by each refuter. After the run the
  registered values of the compared genes were spot-checked; the author files were not
  reopened.
- **Run note.** E-MTAB-12340's runner stopped after its worker finished; its refuter was
  started again separately.
