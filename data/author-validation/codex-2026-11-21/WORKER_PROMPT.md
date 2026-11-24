# Close one dataset's author-result review

You are reviewing exactly one HypoExplorer dataset: `{{DATASET_ID}}` (category `{{CATEGORY}}`).
Your job is to move it to an evidence-backed closed state, or to show precisely why it
cannot be closed from public sources. You propose ledger entries; you never edit ledgers.

## Read first

1. `data/author-validation/README.md` (the review method and the author-concordance-v2 policy) and `CONTEXT.md`.
2. This dataset's entry in `data/author-validation/codex-2026-11-21/queue.json`.
3. Its current records in `data/author-validation/manual-review.json`, `verification-review.json`,
   `comparability-review.json`, `additional-comparison-specs.json` and `concordance-reviews.json`.
4. Its registry entry in `src/data/datasets.ts` (or the registered JSON sidecar), and its registered
   DE table under `geo_replication/datasets/<dir>/processed/`.
5. Any prior finding named in `priorTurbo` and any existing evidence under
   `data/author-validation/continued-sources/<ACCESSION>/`. Treat a prior finding as a lead to check,
   not as established fact.

## What to do for category `{{CATEGORY}}`

- `not_located` / `partial_untested`: search for comparable author results again. Cover the
  manuscript and every supplement (PMC, publisher, Europe PMC), GEO series and sample supplementary
  files (inspect contents: normalized-count files sometimes hold DE statistics), ArrayExpress/ENA,
  Zenodo, figshare, Dryad, OSF, GitHub/GitLab repositories named in the paper, and any preprint.
  If you find a gene-level author result for a registered contrast, compare it with the registered
  output and propose the comparability record and, when the policy allows one, a comparison spec.
- `access_blocked`: retry every legitimate route the previous attempt did not (Europe PMC
  supplementary export, PMC OA package, publisher mirror, preprint server, author repository).
  Never bypass a paywall, login, CAPTCHA or bot challenge. An HTML challenge page is not data.
- `unresolved`: resolve the specific conflict in `nextStep` from the deposited sources, code and
  manuscript. Decide it, or narrow it to a concrete question only the authors can answer.

## Closure states (pick exactly one)

- `compared`: an author result was compared within a stated scope (any agreement level; a
  disagreement is a valid closed result).
- `no_valid_comparison`: author material exists but cannot answer the registered contrast; say why.
- `confirmed_not_located`: exhaustive search logged source by source, nothing comparable found.
- `access_blocked_documented`: every legitimate route tried and logged; access still blocked.
- `needs_author_contact`: a conflict that public sources cannot settle; state the exact question.
- `not_closed`: you could not finish; say what is missing.

## Rules

- Write only in `data/author-validation/continued-sources/{{ACCESSION}}/codex-2026-11-21/` (evidence) and
  `data/author-validation/codex-2026-11-21/findings/{{DATASET_ID}}.json` (your proposal). Do not edit any
  other file: no ledgers, registry, bundles, DE tables, producers, scripts or generated records.
- Evidence folder: keep the downloaded bytes you relied on, a `SOURCES.tsv`
  (`path, url, sha256, bytes, retrieved_at, note`), a `SEARCH_LOG.md` listing every source checked and what
  it held, and any script you ran with its output. Compute SHA-256 from the saved bytes. Do not copy
  registered tables or restored release files into the evidence folder; cite them by path and SHA-256.
- Follow the README's comparability dimensions (cohort, contrast, features, effects, inference,
  coverage) and author-concordance-v2 exactly. Never pick a threshold, subset or orientation to force
  agreement. Selected-gene lists stay explicitly scoped. Missing author P/FDR is unassessed, not
  nonsignificant. Unavailable data is not a mismatch. Nothing earns full verification automatically.
- Report numbers you computed, with the script that computed them. Do not report a number you did not
  compute or read from a saved source.

## Proposal file

`findings/{{DATASET_ID}}.json` must contain:

```json
{
  "datasetId": "...", "accession": "...", "category": "...", "closure": "...",
  "summary": "two or three sentences",
  "evidenceFolder": "data/author-validation/continued-sources/<ACCESSION>/codex-2026-11-21",
  "proposed": {
    "manualReview": { ...same fields as this dataset's manual-review.json record, reviewedAt "2026-11-21"... },
    "verificationReview": { "resultAvailability": "...", "comparisonOutcome": "...", "reason": "...", "nextStep": "...", "fullyVerifiedContrasts": [] },
    "comparabilityReview": { ...only if a comparison was made; same shape as comparability-review.json... },
    "additionalComparisonSpec": { ...only if the policy allows one; same shape as additional-comparison-specs.json... }
  },
  "computed": [ { "claim": "...", "value": "...", "script": "path" } ],
  "openIssues": [ "..." ]
}
```

Omit a `proposed` key when you would leave that ledger record unchanged. Use only enum values that
already occur in the ledgers. Your final message must follow the given output schema.
