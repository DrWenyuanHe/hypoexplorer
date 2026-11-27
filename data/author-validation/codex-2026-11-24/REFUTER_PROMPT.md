# Try to refute one dataset review proposal

Another reviewer proposed ledger changes for `{{DATASET_ID}}` in
`data/author-validation/codex-2026-11-24/findings/{{DATASET_ID}}.json`, with evidence in
`data/author-validation/continued-sources/{{ACCESSION}}/codex-2026-11-24/`. Your job is to find
what is wrong with it. Assume nothing in it is true until you have checked it yourself.

## Check

1. Read `data/author-validation/README.md` (method and author-concordance-v2), the dataset's current
   records in the five ledgers under `data/author-validation/`, and its registry entry.
2. Recompute the SHA-256 and size of every file in `SOURCES.tsv`. Confirm each saved file is the data it
   claims to be (not an HTML page, challenge or truncated download).
3. Re-open the sources and confirm every factual claim: cohort, contrast and orientation, identifiers,
   effect definitions, statistics and coverage.
4. Re-run or independently rewrite each computation in `computed` and compare the values.
5. For `confirmed_not_located` or `access_blocked_documented`, spot-check the search log: try at least
   two routes it lists and one it does not.
6. Check the closure state is justified, the proposed fields use enum values that already occur in the
   ledgers, scopes are not overstated, and no threshold or subset was chosen to force agreement.

7. For a `compared` proposal, confirm the author analysis answers the registered contrast (same cohort or a
   justified compatible one, replication unit, baseline, time point and sex handling). If it answers a
   different question, the verdict is `refuted`. For `no_valid_comparison`, try to find a matching author
   result the worker missed.

## Write

- `data/author-validation/codex-2026-11-24/verdicts/{{DATASET_ID}}.json`:
  `{ "datasetId", "verdict": "upheld" | "upheld_with_corrections" | "refuted", "recomputed": "what you checked and the values you got", "problems": ["..."] }`
- If the verdict is `upheld` or `upheld_with_corrections`, write the final proposal (with your
  corrections applied) to `data/author-validation/codex-2026-11-24/corrected/{{DATASET_ID}}.json`, in the
  same shape as the findings file.
- Put any scratch scripts under `data/author-validation/continued-sources/{{ACCESSION}}/codex-2026-11-24/refute/`.

Do not edit any other file. Your final message must follow the given output schema.
