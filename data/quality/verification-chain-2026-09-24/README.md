# Verification chain after later intake — September 24, 2026

`npm run check:verification-advancement` had failed on every checkout since the September 12 HFD intake. This record classifies each dated report the chain checks as live or sealed, and states how each is now checked. No scientific input, fitted result, acceptance policy, sealed producer or recorded pin was changed.

## Live: the two September 5 cumulative reports

`advancement-2026-09-05` and `continuation-2026-09-05` summarize current evidence for the original 145 datasets. Their builders say so, and they exclude later intake by construction. The [cumulative-history review](../../internal-qc/source-recovery-2026-09-11/review-continuation/cumulative-history/README.md) keeps their earlier bytes and explains why freezing them would contradict that role. Both were regenerated through their unchanged producers. Only the recorded ledger hashes changed: three in advancement and two in continuation. These came from the HFD intake and the September 14 author-validation copy rewrite. Summaries, all 145 records and both Markdown reports are byte-identical.

Current original-corpus totals are 78 internal-QC passes, 26 author-concordance passes and 56 numerical comparisons. Round two's GSE102471 comparison raised the author count from the 25 recorded on September 11. The September 11 review test `cumulative-reports.test.mts` had fixed those September 11 totals in its two totals tests, although both tests describe current totals, and no npm chain ran it. Those tests now recount every status and comparison from the live ledgers, restricted to the 145 original datasets. The other 13 tests are unchanged, and the chain now runs all 15.

## Sealed: the September 11 reports and scientific snapshot

`continuation-2026-09-11/build_report.py` and `continuation-round2-2026-09-11/build_report.py` compare against fixed 159-dataset baselines. Both assert exactly 159 datasets, so they failed once the ledgers held 161. Independent reviews pin both producers and `verify_scientific_files.py` by SHA-256, so none can be edited. `scripts/run_sealed_report_check.py` runs each unchanged producer in `--check` mode. It follows the pattern of `scripts/run_historical_check.py`. A read of a pinned input receives its recorded bytes only when the difference is proven to be one of the three below. Every other read is current, and every producer assertion still applies.

| Pinned input | Recorded SHA-256 | Served when |
| --- | --- | --- |
| `data/quality/assessments.generated.json` | `8f31a32d…` | The current ledger, restricted to the 159 baseline datasets, reproduces the pin exactly. |
| `data/internal-qc/assessments.generated.json` | `e221814d…` | The archived original in `hfd-intake-2026-09-12/preserved-inputs`, after every sealed record is proven unchanged. |
| `data/author-validation/validation-records.generated.json` | `448c6633…` | As above. Only `generatedAt`, `counts` and a growing registry scope may differ. |
| `data/author-validation/additional-comparison-specs.json` | `1e09348f…` | As above. Earlier comparisons must be unchanged; new ones may be added. |
| `geo_replication/config/datasets.tsv` | `493ce7c5…` | The archived original, after every original row is proven unchanged and only reviewed HFD rows added. |
| Any other file of the 2,332-file snapshot | its own | Its current bytes contain no CR, and its CRLF rendering hashes to the pin. |

`scripts/historical_evidence.py` now applies the same record rules as `readSealedHistoricalInput` in `scripts/lib/historicalEvidence.mts`. The TypeScript reader already accepted the validation ledger's inventory fields and the specification list's added comparisons.

The snapshot was not re-baselined. On September 11 it recorded the main checkout's working bytes. For 244 tracked files those were CRLF copies of LF blobs: 62 `-text` dataset bundles and 182 `eol=lf` result tables under `data/raw/results`. Another 20 `text=auto` files are pinned as CRLF. A Windows checkout with `core.autocrlf` writes them that way; other checkouts write LF and receive the same newline-only projection. `capture_baseline.py` refuses to overwrite its output, and the snapshot is also sealed in round two's baseline archive and in the HFD preserved inputs.

A fresh Windows checkout, with the git-ignored inputs copied from the main checkout, measured 2,087 exact files, 244 newline-only files and the configuration table. Of the 2,332 files, 240 are git-ignored and must be present.

## Line-ending gate

`check:bundle-eol` now covers `eol=lf` files as well as `-text` files. A checkout made before those attributes existed can keep CRLF copies behind a clean `git status`. The main checkout held 1,129 such copies among 3,023 `eol=lf` files, 849 of them under `data/raw/results`. Run `npm run restore:bundle-eol` once there. The scientific projection accepts both forms, so restoring them does not affect this chain. A fresh checkout has none.

## Reproduction

Run from the repository root:

```text
npm run check:bundle-eol
python scripts/test_sealed_report_check.py
npm run check:verification-advancement
```

| Command | Result on September 24 |
| --- | --- |
| `check:bundle-eol` | Passed: 5 gate tests, no drift in a fresh checkout. |
| `test_sealed_report_check.py` | Passed: 14 isolation and tamper tests. |
| `cumulative-reports.test.mts` | Passed: all 15 tests, including both recounted totals, in 5 s. |
| `test_historical_check.py` | Passed: 6 existing adapter tests with the aligned rules. |
| Sealed September 11 checks | Passed: first-round report 3 s, scientific files 309 s, round-two report 254 s. |
| `check:verification-advancement` | Passed in full in 402 s on a fresh checkout; it wrote no tracked or untracked file. |
| Other Python sealed-input callers | Both QC-separation checks and all five `run_historical_check.py` producers passed. Before the location-independence commit was included, two `compare.py` replays failed in any new worktree because the git-ignored `jobs.json` holds the main checkout's absolute paths. |
| Affected chains with the location-independence commit | Passed in a fresh worktree: `check:bundle-eol`, `check:hfd-intake`, `check:intake`, `check:author-validation`, `check:quality`, `check:validation-continuation`, `check:validation-round2` and `check:verification-advancement`. `check:validation-continuation` rewrites the tracked scratch log `author-GSE278158/fresh-check/filter-replay.log` when R prints no locale warnings; it was restored afterwards. |
