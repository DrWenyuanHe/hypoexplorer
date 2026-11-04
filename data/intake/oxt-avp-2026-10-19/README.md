# OXT/AVP intake — October 19, 2026

This intake admits **GSE65663**, a bulk rat supraoptic-nucleus salt-loading
microarray study. The manifest is the admission boundary: only source-reviewed
studies with resolved independent replication belong in `studies.json`.
GSE30733 is held: retained CEL headers place the control scans in August 2006
and lactation scans in July 2007, on different instruments. Complete CEL
normalization alone cannot resolve that acquisition confound. It has no admitted
analysis or public dataset in this intake. `GSE30733-held.json` records that source decision;
retained discovery sources live under `sources/`. Discovery does not grant
analysis or QC approval.

## Admitted comparison and scope

GSE65663 compares seven-day 2% saline loading with euhydrated controls in male
Sprague-Dawley rats. Five independent RNA pools per arm were measured on ten
arrays; the source reports five rats per pool. Each pool supplies one replicate.
Individual rats and unidentified pool members are not additional samples.
This is bulk SON tissue relevant to OXT/AVP physiology, without purified OXT or
AVP neurons. The separate GSE3110 water-deprivation experiment is excluded
because the paper documents different amplification procedures.

The original source matrix contains 31,099 probes and deposited GeneSpring
GX12 RMA values that have already been median-baselined on the log2 scale.
The exact display unit is `log2 RMA (GeneSpring median-baselined)`. Negative
values are valid relative expression. Preparation preserves every probe and
every selected sample value. Only a single source symbol paired with a single
Entrez identifier is admitted as a labelled probe; missing and ambiguous
annotations remain unlabelled fit rows. Shared `de_common.R` rules normalize
symbols, resolve supported ambiguity and average unambiguous same-symbol
log-expression rows before fitting. Unlabelled rows remain in model fitting
and the multiple-testing family, then are omitted from published gene tables.

The registered `salt_vs_control` contrast is salt loading minus control using
unpaired limma empirical-Bayes inference, R **4.6.0**, limma **3.68.4**, design
`(Intercept) + groupcase`, with five measured pools in each arm. The producer
does not re-log the deposited values or normalize CEL files. This relative
median-baselined assay cannot establish absolute transcript abundance.

The authors used GeneSpring Welch tests with BH correction. The three shared
review JSON files record `not_located` / `not_tested`, with no fully verified
contrasts and no measured author concordance. A direct author comparison must
first obtain the matching full salt-loading result table and reconcile cohort,
probe identifiers, tested universe, direction and effect definition. Source
checks and successful local replay do not substitute for that comparison.

## Retained inputs and outputs

The source directory is
`geo_replication/datasets/GSE65663_rnor_son_salt`. Its metadata retains the
original-source SHA-256/byte inventory, ten-sample map, source review,
preparation QC and preparation code. The canonical mechanical-audit inventory
is `metadata/GSE65663_source_files.tsv`; it must identify the exact original
normalized matrix and GPL1355 annotation. Input paths in the manifest remain
inside this source directory.

`scripts/regen-r460/run_oxt_avp_r460.R` writes DE, coefficient SE, model input,
public-symbol expression, source-feature map, selected analysis sample sheet,
QC, session information and per-analysis provenance under `processed/`.
`analyses.json` and `config.generated.tsv` are dedicated registration outputs.
The producer never edits the shared configuration. Merge only their declared
new rows into `geo_replication/config/datasets.tsv`, preserving every older
row. `scripts/build_oxt_avp_bundles_r460.mts` builds the public SON track,
pathway sibling and `src/data/oxtAvpStudies.generated.json` directly from the
new analyses and current provenance.

`audit.generated.json` is produced only after the actual analysis, schema-3
FGSEA and public bundles exist. It independently extracts the original matrix
and annotation; checks every prepared value, pre-fit log average and published
expression value; verifies the declared independent pools; recomputes every
unadjusted group effect; checks moderated t = logFC/SE; and traces public
DE, SE and pathways to their source files. It checks current code, model,
source and output hashes. It does not independently re-estimate empirical-Bayes
hyperparameters, replay raw CEL normalization or establish author concordance.
A missing, stale or incomplete audit cannot supply passing live QC evidence.

The historical FGSEA migration report keeps its original corpus. This new
analysis has no pre-migration result. Its author-validation pathway field is
`current_provenance_checked`, with current raw/untestable row counts and a
reference to this intake audit. It has no fabricated baseline, rows gained/lost
or author-pathway agreement. The join requires the fresh source audit and
independently verifies schema-3 FGSEA hashes and species again.

## Analysis and bundle commands

Run commands from the repository root. Use an R 4.6.0 library containing the
pinned analysis packages and the packages listed by `de_common.R` and the FGSEA
producer. The local task runtime is shown below; another machine may use its
own exact-version executable and library paths.

```powershell
$oxtR = '.tmp/oxt-avp-intake/runtime/R-4.6.0/bin/Rscript.exe'
$env:R_LIBS_USER = (Resolve-Path '.tmp/oxt-avp-intake/runtime/library').Path
$env:R_USER_CACHE_DIR = (Resolve-Path '.tmp/oxt-avp-intake/runtime').Path
python geo_replication/datasets/GSE65663_rnor_son_salt/metadata/GSE65663_prepare_inputs.py
& $oxtR scripts/regen-r460/run_oxt_avp_r460.R --validate-inputs
& $oxtR scripts/regen-r460/run_oxt_avp_r460.R
```

Review and merge `config.generated.tsv` before FGSEA. Its analysis ID is
`GSE65663`; no held GSE30733 row belongs in the configuration or registry.
Then:

```powershell
$env:LC_ALL = 'C'
& $oxtR scripts/regen-r460/run_fgsea_r460.R GSE65663 --force
npx tsx scripts/build_oxt_avp_bundles_r460.mts
npx tsx scripts/check_datasets.mts --all-tracks
npm run check:bundle-eol
npx tsx scripts/audit_oxt_avp_intake_r460.mts
& $oxtR scripts/regen-r460/run_oxt_avp_r460.R --check
npm run check:oxt-avp
```

The R producer supports `HYPO_OUT_ROOT` for staging. It writes staged
registration under `_registry/oxt-avp-2026-10-19`; the bundle builder consumes
the final repository registration. Its `--check` builds into a temporary
workspace directory and compares bytes without publishing new bundles.

The task-local MSigDB cache uses the official msigdbr 26.1.0 archive
`msigdb.2026.1.zip` (44,335,790 bytes, published MD5
`512ba99c6827141a9d471972b812d4ac`). A fresh environment may download it through
msigdbr; the cache is a runtime prerequisite and is not a scientific output.

## Evidence and repository closure

Close the shared evidence in this dependency order, after the new numerical
outputs are final:

1. Add the source inventory row with
   `npx tsx scripts/refresh_author_source_inventory.mts --dataset=rat_son_salt_gse65663`.
   This contacts only the selected study's repository/publication sources and
   preserves unrelated rows and top-level report metadata. Its `--check`
   checks offline full-registry coverage. An unscoped refresh contacts the
   entire corpus and requires review of every changed existing row.
2. Run `npx tsx scripts/audit_author_validation.mts` for the explicit DE/source
   mechanical trace, then `npx tsx scripts/compare_author_results.mts` for the
   existing direct comparisons. This intake has no direct comparison to add.
3. Run `npx tsx scripts/audit_fgsea_migration.mts`, then
   `npx tsx scripts/build_author_validation.mts --require-complete`. The first
   retains original migration scope; the second joins the new current-output
   pathway evidence and the honest author review.
4. Refresh the live HFD successor audit with
   `npx tsx scripts/audit_hfd_intake_r460.mts`: it pins the shared configuration
   and must revalidate its original analyses after the append. For this intake,
   only its configuration fingerprint changes. Then run
   `npx tsx scripts/build_internal_qc_r460.mts`.
   The live R4.6 QC reader requires the current dedicated intake audit. Review
   all statuses and limitations; do not infer a pass from command success.
5. Finalize the successor fingerprint inventory with
   `npx tsx scripts/regen-r460/build_successor_inventory.mts --finalize`, review
   its reported changes, then run the same script with `--check`. Use
   `--ledger=<path>` only when intentionally changing its existing ledger scope.
   The default preserves the already declared scope.
   Finally run `npx tsx scripts/build_quality_report_r460.mts`. A changed QC
   input inventory must be declared before this report can read its historical
   pipeline review; the combined `npm run build:quality` is appropriate once
   that declaration is current.
6. Refresh the two live cumulative reports with
   `npx tsx scripts/build_verification_advancement.mts` and
   `npx tsx scripts/build_verification_continuation.mts`. They summarize the
   original baseline corpus; new intake changes their dependency hashes, not
   their original-corpus interpretation. Do not regenerate sealed reports.
7. Rebuild upstream processing and its reviewed record, query and expression
   indexes, nomenclature and tracker through their existing builders. Run
   `npm run check:upstream`, `npm run check:query-index`,
   `npm run check:expression-index`, `npm run check:oxt-avp`,
   `npm run check:author-validation`, `npm run check:quality` and
   `npm run check:verification-advancement`.
8. Complete TypeScript, lint, relevant tests, application build and the context
   maintenance procedure in `docs/agent-context/README.md`. Validate the final
   combined checkout after all registry, evidence and documentation edits.

Historical producers, source snapshots and supersession pins remain sealed.
Only the narrowly bound new IDs and their source-declared configuration rows
are projected away when a historical check reads an old corpus. The historical
adapters must still reject edits to original rows, policy, model or output
semantics. A pin failure is investigated through the verified compatibility
reader; it is not repaired by rewriting a historical producer or baseline.

Focused regression commands:

```text
python scripts/test_historical_check.py
python scripts/test_sealed_report_check.py
npx tsx --test scripts/lib/historicalEvidence.test.mts scripts/lib/oxtAvpIntakeEvidence.test.mts
npx vitest run src/__tests__/authorPathwayValidation.test.ts src/__tests__/currentIntakePathwayEvidence.test.ts src/__tests__/authorValidationPanel.test.tsx src/__tests__/authorValidationBuilderSourceGate.test.ts src/__tests__/authorValidation.test.ts
npm run typecheck
```

These are reproduction instructions. Generated audit files and current check
results, rather than this runbook, establish which numerical outputs have
actually passed.

## Bounded rat nomenclature refresh

This intake adds rat symbols. When the other authority caches are absent, refresh
only RGD while retaining the reviewed classifications and source metadata for
all other authorities:

```text
npm run build:nomenclature -- --refresh-authority=RGD --fetch
npm run build:nomenclature -- --refresh-authority=RGD --check
npx tsx --test scripts/lib/nomenclatureRetained.test.mts scripts/lib/rgdRecords.test.mts
```

The fetch downloads only RGD's official `GENES_RAT.txt` and
`GENES_OBSOLETE_IDS.txt` concurrently, into atomic cache files. Omit `--fetch`
to reuse those cached exports. Every rat symbol across the current corpus is
reclassified; every dataset count is recomputed. Non-RGD decision fields and
source metadata remain unchanged. A new non-RGD stored symbol without a retained
decision stops the rebuild and requires the normal full authority rebuild.
The bounded command writes the same retained TSV, source inventory and public
search/reference bundles as the full builder. Its `--check` uses local inputs
without fetching unless `--fetch` is explicitly supplied. The normal full
`npm run build:nomenclature` and `--fetch` behavior remain available.

The current RGD export includes multiple active IDs sharing some symbols.
The parser distinguishes `NOMENCLATURE_STATUS` from NCBI RefSeq status: one
explicit `APPROVED` record takes precedence only when all other same-symbol
records are `PROVISIONAL`. Multiple approved records or exclusively provisional
collisions remain `ambiguous`, retaining candidate RGD IDs without selecting a
gene record, locus type or alias redirect. Retired-ID chains that end at an
unselected colliding record also remain ambiguous. The wire status is appended
after the existing four codes, preserving their numeric meanings.

## Retained QC input identities and availability

The live QC input inventory distinguishes expected source identity from a file
being available and checked now. `scripts/lib/qcInputAvailability.mts` reads the
exact pre-intake QC artifact retained as `qc-input-baseline.json.gz`, verifies
its fixed expanded byte count and SHA-256, and uses only its expected input
fingerprints. The baseline is the original artifact from Git commit
`1879fe04b7ec0d951a2ec93660389485c50e132e`: 5,525,396 expanded bytes with SHA-256
`2de856378a45fb833e19437673448f2b3c9f552fe4b0a3aaa725bae56d13cb84`.
Its saved checks and dataset statuses are not copied into current decisions.

Current readers' measured fingerprints take precedence. Retained dependencies
that are present must match their expected identities. Those absent locally
are marked `unavailable_not_verified` in
`data/internal-qc/input-availability.generated.json`. Preserving an expected
fingerprint does not read a missing file, verify it again or grant a passing
QC check. The report separately identifies dependencies checked for identity
and dependencies still unavailable. Current missing-source checks remain
unassessed.

The successor inventory also records already sealed retirement identities
that remain unavailable as `previously_retired_unavailable_not_reverified`.
Available retired inputs must still match their expected fingerprints; a newly
retired missing input is rejected. This metadata preserves the old declaration
without changing historical producer behavior: an attempted read of an absent
source file still fails. Run the focused availability tests with
`npx tsx --test scripts/lib/qcInputAvailability.test.mts`.

An already declared successor addition may remain unavailable only when its
path and expected fingerprint match both the previous sealed addition set and
the fixed QC baseline. It is qualified separately as
`previously_added_unavailable_not_verified`. A new missing successor input is
rejected; this rule cannot admit an absent new analysis input.

## Sealed-auditor reader refresh

Six sealed auditors write the fingerprint of the whole current
`geo_replication/config/datasets.tsv` into their derived reports. Adding the
GSE65663 row changed that file from SHA-256
`2b89ca7d8231622817b5fec41d32d76ec746088f56029319b1d20d54973ebaeb` (53,320 bytes)
to `c2463a8d08af93a8f28c772540b263f4dd0334b68f36d26f44c80b9f3780f9da`
(53,559 bytes), so those reports no longer reproduced. This follows the HFD
intake's `data/quality/hfd-intake-2026-09-12/review_reader_refresh.mts`.
[`reader-refresh/review_reader_refresh.mts`](reader-refresh/review_reader_refresh.mts)
works as follows:

1. It checks that the auditor's bytes still match its pin in
   `scripts/run_sealed_ts_check.mts`.
2. It runs the auditor under the same R 4.6.0 supersession projection as that
   auditor's `--check`, with writes allowed only to its own report.
3. It accepts the candidate only if every value other than the current
   `datasets.tsv` reference is unchanged. Historical configuration pins must stay
   exactly as sealed.
4. The scoped source validation may also append `GSE65663` to
   `newConfigRowsWithoutHistoricalScope`.

The reviewer saves each report's before, candidate and review files beside it.
`--summary` confirms each report equals its reviewed candidate.

| Key | Report | References moved |
|---|---|---:|
| `scoped` | `data/internal-qc/source-authenticity-2026-09-05/scoped-source-validation.json` | 83 (+ GSE65663 listed) |
| `round2` | `.../round2/reader-evaluations.json` | 10 |
| `round4` | `.../round4/reader-evaluations.json` | 10 |
| `round5` | `.../round5/reader-evaluations.json` | 12 |
| `round5-keyed` | `.../round5-keyed/reader-evaluations.json` | 1 |
| `source-recovery` | `data/internal-qc/source-recovery-2026-09-11/reader-evaluations.json` | 3 |

Every status is unchanged, and all six `run_sealed_ts_check.mts ... --check`
runs pass. The R 4.6.0 source-relationship evidence
(`data/internal-qc/advancement-r460-2026-09-25/source-relationship-evidence.json`)
changes only its four `datasets.tsv` pins; all six relationships still pass.

Sealed producers read the internal-QC, quality and author ledgers in their
archived pre-regeneration form, which cannot list GSE65663. The sealed module
hooks therefore remove this intake's bounded datasets from the projected
registry as well (`withoutAdditiveIntake` in `scripts/lib/registryEdits.mts`).
Without this, the pipeline-separation audit rejected the internal-QC ledger as
missing a registered dataset.

## Final local validation and historical cache prerequisites

The earlier full Vitest run on October 20, 2026 recorded **2,131 passed, 19 failed
and 4 skipped tests** across 190 passing and 8 failing files (2,154 tests total).
Eighteen failures concern missing historical caches or QC assertions that require
those inputs to be available, across `keyedSourceRelationship`, `pipelineQc`,
`qualityBadges`, `qualityConsistency`, `replicationEvidence`,
`reviewedPipelineLimitations` and `sealedEvidenceProjection`. The remaining
`analysisCorpusIntegrity` failure required the newly generated GSE65663 DE file
to appear in Git's tracked-file inventory. After those task files were staged,
that test file passed 10/10. A later focused historical run recorded 64 passed
and 11 failed tests across three files; this does not replace a complete suite
result. The fresh complete four-worker run after the accepted cache restorations
recorded **2,132 passed, 18 failed and 4 skipped tests**, across 191 passing and
7 failing files (2,154 tests total). All 18 remaining failures concern the
historical-cache or QC-availability expectations in the seven files named above.
Neither complete run establishes a passing full test suite.

Fresh checks of all three TypeScript configurations and Biome lint pass. The
isolated application compile passed in 44.23 seconds with prebuild skipped;
this does not clear the normal-build gates. Browser checks loaded the GSE65663
study record with Pipeline QC and Experimental design passing and Author
concordance unassessed, the 14,604-gene SON track with five pools per arm, a
signed Oxt mean/SEM chart, and 5,003 pathway rows. The OXT cell reference also
loaded its two populations with the deposited CENSUS units. These checks cover
the admitted products and their display; they do not establish author-result
agreement or clear the historical-cache failures.

Remaining historical prerequisites include ignored archives such as
`data/internal-qc/source-authenticity-2026-09-05/round2/downloads/GSE254155/GSE254155_RAW.tar`
and `round5/region-code/dmb-zenodo_0.9.2.zip` under the same audit directory.
The bundle-EOL guard passed after the intended tracked-file declarations were
normalized in Git. Historical scientific pins stay intact.

The audits also pin the original `*.download.json` retrieval logs, including
their timestamps. Fresh downloads cannot replace those sealed log bytes. Restore
an exact original cache backup to reproduce these historical checks; do not
recreate old timestamps or rewrite seals. Current OXT/AVP intake validation is
reported separately by `npm run check:oxt-avp` and the exact R producer's
`--check`; these historical cache failures do not establish their outcome.

The durable [cache recovery handoff](../../quality/cache-recovery-2026-10-20/README.md)
contains the tested standalone collector, original-computer steps, expected
file identities, 71 exact source restorations and commands to rerun after
restoration.

**Closed on October 25, 2026, on the original computer.** That computer already
held the retained cache. The live reports were refreshed and the six sealed
reports above were refreshed through review. The full suite then passed with
**2,253 passed, 0 failed and 4 skipped** tests across 203/203 files, and the
normal `npm run build` passed with all prebuild gates. The
[handoff outcome](../../quality/cache-recovery-2026-10-20/README.md#outcome-on-the-original-computer--october-2425-2026)
records the details.
