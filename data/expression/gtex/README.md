# GTEx V10 hypothalamus reference

Retained sources for the expression survey's GTEx source
(`gtex-v10-brain-hypothalamus`): per-sample gene TPM for GTEx Analysis Release V10,
tissue "Brain - Hypothalamus", 59,033 GENCODE v39 features × 257 donors.
It is an expression-only reference and not a registered dataset. The tracker's
`GTEx-v11` rejection governs differential-expression intake only (see its review
note and [the plan](../../../docs/EXTERNAL_REFERENCE_EXPRESSION_PLAN_2026-10-29.md)).

## Files

| File | What it is |
| --- | --- |
| `source-manifest.json` | URL, bytes and SHA-256 of each original, plus the retained file's rule, bytes and SHA-256 |
| `gene_tpm_v10_brain_hypothalamus.gct.gz` | Original GCT bytes (Git LFS) |
| `sample-attributes-hypothalamus.tsv.gz` | Header plus the 257 rows of `GTEx_Analysis_v10_Annotations_SampleAttributesDS.txt` whose `SAMPID` is a GCT column, unmodified, in source order |
| `subject-phenotypes.tsv.gz` | `GTEx_Analysis_v10_Annotations_SubjectPhenotypesDS.txt` (sex, age decade, Hardy scale), gzipped |
| `portal-api-medians.json` | GTEx Portal API v2 median TPM for POMC, AGRP, HCRT and NPY, retained as an independent check |

## Commands

```bash
pnpm exec tsx scripts/build_gtex_reference.mts           # verify sources, write products, replay every value
pnpm exec tsx scripts/build_gtex_reference.mts --check   # byte-compare existing products instead
pnpm exec tsx scripts/build_gtex_reference.mts --fetch   # re-download pinned originals; refuses any byte change
```

`--fetch --record` is for a first acquisition or a deliberate release update. It
rewrites the retained files and their hashes in `source-manifest.json`. The
generated products under `public/expression/gtex/` are gitignored build artifacts
(about 100 MB of JSON in 2,048 value shards and 1,024 lookup shards).
`pnpm run build:expression-external` builds them. `prebuild` and the CI
artifact step run it, and a dev server needs it run once.

A clean clone needs Git LFS for the GCT. Without it the retained-hash check fails
closed on the LFS pointer file.

## What the build checks

- Every retained file matches its pinned size and SHA-256, and every source file is
  LF-only.
- The GCT has `#1.2`, `59033\t257` and 257 unique samples. Every sample is
  `Brain - Hypothalamus` in the `RNASEQ` freeze, with one sample per donor.
- Every value is plain non-negative decimal text and is parsed once. The emitted
  products are read back from disk and compared with the parsed value for all
  15,171,481 cells.
- The median of the imported values for each checkpoint gene agrees with the
  retained Portal API median to six significant figures (POMC 7.79063 TPM).

## Interpretation limits

Donors are postmortem adults, mostly 50–69 years old, and 193 of the 257 are
male. Feeding and circadian state are unknown, so no group is reference-eligible.
The 45 `_PAR_Y` features share a symbol and Ensembl ID with their X copies; those
queries report both as ambiguous rather than merging them. Values are human
bulk-tissue TPM and are never averaged with rodent or other-study values.

## Attribution

GTEx Consortium, Science 2020;369(6509):1318–1330, DOI 10.1126/science.aaz1776.
The Genotype-Tissue Expression (GTEx) Project was supported by the Common Fund of
the Office of the Director of the National Institutes of Health, and by NCI, NHGRI,
NHLBI, NIDA, NIMH, and NINDS. The data were obtained from the GTEx Portal on
2026-10-29. Terms: https://gtexportal.org/home/license (open-access tier).
