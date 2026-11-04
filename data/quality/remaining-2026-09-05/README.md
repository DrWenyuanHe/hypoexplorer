# Historical final source-unit integration (September 5)

This continuation completes the primary-source review of the original 145 datasets. It adds 16 reviewed mapping records, covering 229 selected profiles, to the unchanged 126 earlier records. The resulting evidence covers 142 datasets and 2,033 profiles. The macaque atlas, GSE305688 and GSE242187 retain explicit source-identity or upstream-input gaps.

The [historical report](ADVANCEMENT_REPORT.md) and [machine-readable per-dataset record](remaining-report.json) include every changed check, then-current contrast assessment and unresolved required check. At closure, original-corpus internal QC was 75 pass, 47 review and 23 not assessed. Author concordance was 27 pass, 26 review, 91 not assessed and one not applicable. The 14 concurrent intake datasets receive no progress credit.

The final 16 replication decisions are eight passes and eight reviews. All eight pass decisions strengthen existing replication approvals with original methods and source identities. Six former complete-QC passes become review. GSE324226 moves from not assessed to review; GSE227725 was already under review. A matching library name does not establish an independent animal, litter, pool, pen or exposure unit.

## Evidence and review

- [Batch A source package](../../internal-qc/replication-2026-09-05/remaining-a/README.md) and [independent scientific review](REVIEW_REPLICATION_A.md).
- [Batch B source package](../../internal-qc/replication-2026-09-05/remaining-b/README.md) and [independent scientific review](../../internal-qc/replication-2026-09-05/remaining-b/independent-review/REVIEW.md).
- [Central integration review](REVIEW_REMAINING_INTEGRATION.md), including complete source-swap and identity-substitution rejection cases.
- [Catalog UI review](REVIEW_CATALOG_UI.md), including exact current-versus-stale metadata behavior.
- [Review index](REVIEW.md) and [executed validation](VALIDATION.md).

The frozen A/B package READMEs describe their state when submitted for independent review. Their proposals are now integrated. Their original wording and source pins are preserved. `replication-integration.json` binds the exact approved fragments, and `replication-specifications.before.json` preserves all 126 prior specifications.

`baseline.json` contains the exact final round-five ledgers and original corpus IDs. The report builder checks that baseline against the [closed round-five archive](../round5-2026-09-05/CLOSED_HISTORY.md). Earlier complete source reconstructions retain their original credit and are not counted again as new work.

## Reproduction

Run from the repository root:

```text
python data/quality/remaining-2026-09-05/integrate_specifications.py --check
npm run check:quality
npm run check:author-validation
npm run check:verification-advancement
python scripts/audit_verification_remaining_preservation.py --check
python data/quality/remaining-2026-09-05/audit_remaining_preservation.py --check
```

The quality gate reparses both new source packages, rechecks the source adapters and their mutations, validates original sample identities in the central producer, reconstructs complete input relationships and independently regenerates both QC ledgers. Changing a cached hash alone is insufficient. The advancement gate reproduces current cumulative reports and closed historical reports.

The GSE189945 citation now says five independent four-mouse pools per age. The GSE174085 display label now says litter pseudobulk; its numerical source files are unchanged. Catalog consistency requires the complete expected content and build ID before measured library counts are shown. No scientific inputs, sample assignments, analysis configuration, normalization, DE or pathway outputs were changed.

## Closed historical inputs

The September 11 continuation recovered all 17 report dependencies at their exact recorded hashes. `closed-inputs.json.gz` preserves those bytes; the report builder now uses them to reproduce this historical report independently of later ledger updates. The archived 27 author passes are historical: intervening effect-definition reviews had already reduced the current count to 25 before the new continuation began. See the [September 11 continuation](../continuation-2026-09-11/README.md) for current results and the exact-source recovery record. Neither historical measurements nor later scientific decisions are overwritten.
