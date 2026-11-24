# Codex closure pass, 2026-11-21

Goal: move every open dataset to an evidence-backed closed state. A dataset is
open when its `verification-review.json` record is unresolved, access blocked, or
untested (author results not located or only partial). That is 92 datasets: 29
unresolved, 14 access blocked, 42 not located and 7 partial-untested
(`queue.json`). The other 70 datasets were already closed.

Each dataset gets one Codex worker (`gpt-6.2-astra`, reasoning `xhigh`,
workspace-write sandbox with network) and then one Codex refuter that tries to
break the worker's proposal. Workers write only their evidence folder and
`findings/<datasetId>.json`. Refuters write `verdicts/` and, when upheld,
`corrected/`. Neither edits a ledger; only upheld, corrected proposals that pass
`check_proposals.cjs` and the repository validators are merged.

| File | Content |
|---|---|
| `queue.json` | The 92 open datasets with category, current reason/next step and any Nov 15 lead |
| `WORKER_PROMPT.md`, `REFUTER_PROMPT.md`, `result.schema.json` | Prompts and the final-message schema |
| `findings/`, `verdicts/`, `corrected/` | Worker proposals, refuter verdicts, final proposals |
| `check_proposals.cjs` | Checks proposals use only keys and enum values already in the ledgers |
| `logs/` | Final messages, `progress.log` and merge output; the full Codex transcripts (about 136 MB) stay with the evidence, not in git |
| `scripts/` | `run_one.sh` (worker then refuter, resumable), `run_wave.sh`, `launch.sh` (detached) and dataset lists |
| `check_specs.mts`, `merge.cjs` | Spec rule check and the ledger merge |
| `rebuild_gse299412.py`, `check_torpor_sign.py` | Byte-exact rebuild of GSE299412's withheld inputs; GSE179663 sign check from deposited counts |
| `build_release_bundle.mts` | Builds this pass's data-release part, `sources.json` and `scrubbed.json` |
| `check_copied_text.py`, `copied-text.json` | Copied-publication-text check and the records it withholds from the release |
| `round1/`, `interrupted/` | First-round outputs of refuted datasets; partial outputs of jobs killed mid-run |

Closure states: `compared`, `no_valid_comparison`, `confirmed_not_located`,
`access_blocked_documented`, `needs_author_contact`, or `not_closed`.

## Pilot (5 datasets)

All five closed and every refuter returned `upheld_with_corrections`. Each refuter
re-hashed every saved source (21 to 55 files per dataset) and reproduced every
computed value. All five corrected proposals pass `check_proposals.cjs`.

| Dataset | Closure | Finding |
|---|---|---|
| GSE284408 ARC HFD | compared | 14,119 paired genes; both concordance-v2 routes pass. The published rule reproduces Figure 3E's 289 genes; the text says 389 and Table S1 has ten extra rows. Detailed review stays unresolved. |
| GSE153551 ob/ob FGF1 | needs_author_contact | Figure 7a matches Data 11's adjusted-P rule exactly (319 up, 68 down). The deposited day-5 analysis uses 14 vehicle mice; the paper reports 7. |
| GSE128660 heat stress | compared (7 selected genes) | Formerly access blocked; the author workbook was retrieved from BioStudies. All 7 agree in direction; below the 30-pair minimum. |
| GSE324226 pig low growth | compared (28 selected genes) | Formerly not located. Figure 7 coefficients: 28 of 28 agree in direction, Pearson 0.995; below the 30-pair minimum. |
| GSE207992 SCN exercise | compared (28 selected genes) | All agree in direction; 10 are plotted DESeq2 signs and 18 are read from heatmaps or group means. |

Cost: about 330k Codex tokens and 40 minutes per dataset (worker plus refuter).
At that rate the remaining 87 datasets use about 29M tokens and about 8 hours at
seven in parallel.

After the pilot the worker prompt gained one rule: cite registered tables and
restored release files by path and SHA-256 instead of copying them into the
evidence folder.

## Full run

The remaining 87 datasets ran seven at a time from 2026-11-21 19:26 to
2026-11-22 13:00. The first run stopped at 23:49 when its parent session ended;
the seven in-flight jobs were killed, their partial outputs moved to
`interrupted/`, and the run resumed at 08:44 as a detached process
(`scripts/launch.sh`). Interrupted jobs restarted from scratch.

Of 92 verdicts, 90 were `upheld_with_corrections` and 2 were `refuted`. All 90
corrected proposals pass `check_proposals.cjs`. They propose 22 comparison specs;
`check_specs.mts` applies the builder's spec rules (fields, pinned SHA-256,
columns, unique keys, adjusted-P range, no clash with a built-in comparison) and
passes 21. GSE179663's corrected spec cites an author file under `refute/` that was
not saved.

The two refuted datasets went to a second round with the refuter's verdict as a
lead (`round1/` keeps the first round): GSE305719, where Figure heatmap labels
support a 156-gene selected comparison the worker had ruled out, and GSE214877,
where Figure 1D supports a selected directional comparison and the GEO cell-line
annotations conflict.

Both second-round proposals were `upheld_with_corrections` and closed as
`compared`: GSE305719 (Figure 13A: 156 resolvable pairs, 147 agree, 9 opposite)
and GSE214877 (Figure 1D: 21 separating markers, all agree; sample-to-column key
and author inference unresolved).

## Merged (92 datasets)

`merge.cjs` first merged 86 upheld proposals: 86 manual-review and verification-review
records, 22 updated and 39 new comparability records, and 15 new comparison specs.
Untouched records keep their original bytes. GSE231769 (below) kept its existing
spec. The six held datasets (below) were merged on 2026-11-24.

| Started as | compared | needs author contact | no valid comparison | confirmed not located | access blocked, documented |
|---|---:|---:|---:|---:|---:|
| unresolved (29) | 10 | 18 | 1 | | |
| not located (42) | 25 | 2 | 7 | 6 | 2 |
| partial, untested (7) | 5 | | 2 | | |
| access blocked (14) | 11 | 1 | 2 | | |
| **Total (92)** | **51** | **21** | **12** | **6** | **2** |

## Held (6 datasets)

Seven upheld proposals replaced an existing reviewed comparison spec with an
author file the workers re-derived, because the originally pinned files are
withheld from the public release. Each changed the author bytes or keys, two
changed the interpretation, and GSE284408's would expire its bound concordance
review.

Every raw source those seven existing specs pin was then recovered byte-identical
to its pin: six from the workers' fresh downloads, three re-downloaded from the
original Europe PMC URLs or extracted from a pinned archive (GSE49540 MOESM1,
GSE232510 Table S1 and PMC11241292 XML), and GSE232510's registered feature map
from the restored release. They now sit at their pinned paths.

The derived author tables could be rebuilt only where the extraction script is in
the repository. GSE231769's `author-effects.tsv`, rebuilt with
`prepare_author_sources_b.mts`'s logic, is byte-identical to its pin; its existing
spec now validates here and gives the same 14,483 pairs and 14,195 same-direction
genes as the re-derived one. Its review records were merged with the existing
spec kept (`--keep-existing-spec`).

The other six were held because their extraction scripts are withheld
(`advancement-sources-a-2026-09-05/prepare_comparisons.py`, the two Nov 15-16 turbo
scripts) or, for GSE299412, because the registered
`GSE299412_identifier_mapping.tsv` is absent from the release. They were adjudicated
on 2026-11-24:

| Dataset | Spec | Reason |
|---|---|---|
| GSE299412 | kept | `rebuild_gse299412.py` reproduces the withheld mapping and author table byte-identical to their pins. The corrected proposal gives the same 157 pairs and 149 same-direction genes. |
| GSE284408 | kept | The re-derived table gives the recorded 14,119 pairs, Pearson 0.926950, Spearman 0.921351 and 12,891 same directions. Keeping the spec, and the effects dimension its 2026-09-26 concordance review binds to, leaves that review valid. |
| GSE232510 | kept | The re-derived table gives the existing spec's 406 pairs and 402 same directions, so nothing is gained by changing its bytes. |
| GSE49540 | replaced | 107 pairs instead of 102: five renamed symbols are traced through Ensembl 59 and NCBI records. Table S1 has no adjusted P, so the interpretation is `effects_compared`. All 107 agree in direction. |
| GSE179663 | replaced | The authors' full 16,195-gene worksheet replaces the 68-gene panel. Their script exports the default (normothermia minus torpor) coefficient; `check_torpor_sign.py` finds the aligned sign in 13,197 of 16,191 genes on library-size-scaled deposited counts. 12,932 of 15,099 registered directions agree; neither concordance route passes. `refute/orient.py --write` produced the pinned table (SHA-256 `8f3da057…`). |
| GSE242354 | replaced | The join now also excludes author rows whose local symbol pools several source identifiers: 16,772 pairs, 11,892 of 16,771 nonzero directions agree (was 16,798 and 70.89%). The disagreement finding is unchanged. |

The withheld scripts are still needed to re-derive the author tables that the kept
GSE284408 and GSE232510 specs pin; those two specs were not re-checked here against
their pinned bytes.

The same audit found that the 2026-11-22 merge had rewritten GSE153498's effects
dimension, which an active concordance review binds to. The bound text was restored;
the pass's newer figures remain in that dataset's manual and verification records.
All eight active concordance reviews now match the ledger text they bind to.

## Validation

The repository's ledger builders (`build_author_validation.mts`,
`audit_concordance_reviews.mts`) stop on withheld evidence in this checkout, with
or without the merge. The full test suite has the same 20 failures with and
without the merge (missing fetched catalogs), so it does not exercise these
ledgers. `check_proposals.cjs` and `check_specs.mts` are the checks applied here. The
2026-11-24 merge likewise leaves the suite's 15 failures unchanged.

## Merge rules

- Merge only `corrected/` proposals whose verdict is `upheld` or
  `upheld_with_corrections` and that pass `check_proposals.cjs`.
- Selected-gene comparisons below 30 pairs stay recorded as below the
  author-concordance-v2 minimum, never as passes, even when a comparison spec is
  added.
- A comparison that changes a reviewed concordance comparison needs a successor
  concordance review bound to the regenerated comparison. Keep the bound dimension
  text (`--keep-effects-dimension`) when the comparison itself does not change.

## Data release

The evidence folders (`continued-sources/<ACCESSION>/codex-2026-11-21/`) ship in
hypoexplorer-data release `data-2026-11-22` as the `evidence-codex-2026-11-21` part,
which `data-release.json` pins; `pnpm run fetch:data` restores them.
`build_release_bundle.mts` built the part under the data repository's rules: 1,040
of the pass's own scripts and records, scrubbed, are redistributed; 5,226
third-party inputs and derived files (7.32 GB) are listed in `sources.json` with
their URLs and SHA-256. `check_copied_text.py` compares every redistributed file
with the downloads it was built from and lists, in `copied-text.json`, the 28
records that carry 40 or more copied words of publication text or author table
rows; the builder withholds them. The release's other parts stay pinned at
`data-2026-11-06`.

## Not yet done

- **Full local evidence.** The 7.1 GB of downloads and the Codex transcripts are
  not in the release; they must join the maintainer's retained audit cache.
- **Generated records.** As with the Nov 15 pass, `compare_author_results.mts`
  cannot run from the public release, so `direct-comparisons.generated.*`,
  `validation-records.generated.*`, the tracker and `data/quality/` must be
  regenerated in the maintainer checkout.
- R is not installed on the machine that ran this pass, so author `.rds` files
  could not be read.
