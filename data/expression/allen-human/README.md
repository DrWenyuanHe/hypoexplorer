# Allen Human Brain Atlas hypothalamus reference

Retained sources for the expression survey's Allen source
(`allen-human-hypothalamus-microarray`): normalized microarray expression (log2)
for the 102 tissue samples, across the six donors, that the atlas ontology places
under the hypothalamus (structure 4540). That is 58,692 probes × 102 samples.
It is an expression-only reference and not a registered dataset (see
[the plan](../../../docs/EXTERNAL_REFERENCE_EXPRESSION_PLAN_2026-10-29.md), Phase 2).

## Files

| File | What it is |
| --- | --- |
| `source-manifest.json` | URL, bytes and SHA-256 of each donor zip (not committed), plus each retained file's bytes and SHA-256 |
| `donorN.hypothalamus-samples.csv.gz` | Header plus the hypothalamic rows of that donor's `SampleAnnot.csv`, unmodified, in source order |
| `donorN.hypothalamus-expression.csv.gz` | `probe_id` plus the matching columns of `MicroarrayExpression.csv`, with values kept as their source text (Git LFS) |
| `probes.csv.gz` | `Probes.csv`, identical in all six zips (the build checks this) |
| `ontology.csv.gz` | `Ontology.csv`, identical in all six zips |
| `allen-api-checkpoints.json` | Allen API donor list (sex, age) and each donor's hypothalamic sample structures, retained as an independent check |

The six donor zips total 1.68 GB, with each expression member up to 966 MB
uncompressed. Only the hypothalamic extracts (47 MB) are committed.

## Commands

```bash
pnpm exec tsx scripts/build_allen_human_reference.mts           # verify sources, write products, replay every value
pnpm exec tsx scripts/build_allen_human_reference.mts --check   # byte-compare existing products instead
pnpm exec tsx scripts/build_allen_human_reference.mts --fetch   # re-download the pinned zips; refuses any byte change
pnpm exec tsx scripts/build_allen_human_reference.mts --fetch --from <dir>   # the same from zips already on disk
```

A download from `human.brain-map.org` can be slow. Fetching each zip as parallel
byte ranges and then running `--fetch --from <dir>` works. `--fetch --record` is
for a first acquisition or a deliberate release update. It rewrites the retained
files and their hashes in `source-manifest.json`. Without `--record`, a fresh API
answer must match the retained one, apart from its retrieval time.

The generated products under `public/expression/allen-human/` are gitignored
build artifacts: about 114 MB of JSON in 2,048 value shards and 1,024 lookup
shards. `pnpm run build:expression-external` builds them.

## What the build checks

- Every zip and retained file matches its pinned size and SHA-256. Each zip member
  the build reads matches its CRC.
- `Probes.csv` and `Ontology.csv` are byte-identical across the six zips.
- Every retained sample is under structure 4540. For each donor, the multiset of
  structures equals what the Allen API lists for that donor.
- Each expression extract has one row per probe, in `Probes.csv` order, and one
  column per retained sample.
- Every value is plain decimal text (log2, so it can be negative) and is parsed
  once. All 5,986,584 emitted values are read back and compared exactly.

## Interpretation limits

Each profile is one dissected tissue sample (a well). The conditions are the six
donors: five male and one female, aged 24 to 57, sampled postmortem. n counts
tissue samples within one donor, never people. The counts are 9, 22, 17, 20, 16
and 18. Feeding and circadian state are unknown, so no group is
reference-eligible.

A gene returns every probe as its own row. Probes of one gene can disagree; for
POMC, A_23_P5875 sits near 9.5 log2 and CUST_15470_PI416261804 near 2.4. No
probe is preferred or collapsed. The values are log2 intensities, so they are
never compared with, converted to or averaged with TPM.

## Attribution

Hawrylycz MJ, et al. An anatomically comprehensive atlas of the adult human brain
transcriptome. Nature 2012;489(7416):391–399, DOI 10.1038/nature11405. Allen
Institute for Brain Science. Allen Human Brain Atlas, human.brain-map.org,
retrieved 2026-10-29. Used under the Allen Institute terms of use
(https://alleninstitute.org/terms-of-use/) for noncommercial purposes, with
attribution under its citation policy.
