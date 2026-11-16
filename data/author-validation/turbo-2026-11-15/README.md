# Parallel author-validation pass, 2026-11-15

Nine agents re-examined 106 dataset slots: 2 with accessible but unassessed author
results, 39 with partial author results, 48 with author results not located, and
17 with experimental design not assessed. Access-blocked datasets and datasets
already in concordance review were out of scope. 93 datasets were reached.

| File | Content |
|---|---|
| `quick.json`, `partial1-4.json`, `notloc1-3.json`, `design.json` | Per-agent findings and the entries each agent proposed, unreviewed |
| `VERIFY_VERDICTS.json` | Independent refutation pass over the 13 datasets reported as advanced; none refuted, all needed corrections |
| `corrected/<datasetId>.json` | Final entries after those corrections; these were merged into the ledgers |

## What was merged

Only the 13 verified datasets changed `manual-review.json`,
`verification-review.json`, `comparability-review.json` and
`additional-comparison-specs.json`. The 80 other datasets' proposals remain here
as unreviewed findings; most record why no valid comparison exists.

Integration decisions:

- One additional comparison per dataset, as `compare_author_results.mts` requires.
  GSE135639 ledgers only its chow P21-vs-P0 contrast; the HFD contrast's agreement
  is retained in its evidence folder. GSE262407's three per-track comparisons are
  held until the builders support per-track selected-scope records.
- No `concordance-reviews.json` entries: each proposed review failed
  `validateConcordanceReviews`.
- No experimental-design changes. The design ledger
  (`data/internal-qc/replication-2026-09-05/reviewed-specifications.json`) is bound
  by an integration manifest, and no design status changed; findings are recorded
  in manual-review notes and flags.
- GSE235479 was downgraded from advanced: its only new item is an unconfirmed
  preprint lead.

## Not yet done

- **Evidence.** Each dataset's sources, hashes and scripts are in
  `continued-sources/<ACCESSION>/turbo-2026-11-15-<agent>/`. That tree ships in the
  data release, not in git, so those folders must enter the next data release
  before a clean checkout can verify the cited hashes.
- **Generated records.** `compare_author_results.mts` cannot run in a checkout
  restored from the public release (GSE68177 and other originals are absent), so
  `direct-comparisons.generated.*`, `validation-records.generated.*`, the tracker
  and `data/quality/` were not regenerated. Run the regeneration sequence in
  `../README.md` in the maintainer checkout.
- The five new comparison specs were checked against the builder's validation
  rules (pins, columns, unique keys, snapshots) and their paired metrics reproduce:
  GSE314817 241 pairs, Pearson 0.996; GSE135639 chow 223 pairs, 0.998; GSE123983
  188 pairs, 0.999; GSE242354 16,798 pairs, 0.305 and GSE330152 97 pairs, 0.323,
  both recorded as disagreements, not passes.
