# R 4.6.0 regeneration — September 25–26, 2026

Every differential-expression (DE), standard-error (SE), CPM and gene-set enrichment (FGSEA) table was recomputed under one R environment, R 4.6.0, and every browser bundle was rebuilt from the new tables. The run started on September 25; the final tables come from one clean run of the final code on September 26 (bulk tree `bulk-final3`, macaque tree `macaque-final`). This record covers why, what changed, how the old and new results compare, which evidence was re-derived, and how sealed evidence still verifies against the replaced bytes.

## Why

A review of the analysis provenance found four gaps:

1. No study recorded the depositor's aligner, genome build or annotation.
2. The macaque atlas had no record of its R, edgeR, fgsea, msigdbr or MSigDB versions. The methods draft said "to be confirmed".
3. The bulk tables came from two R environments, 4.4.1 and 4.6.0, and most outputs had no session record.
4. Duplicate gene symbols, CPM display and fractional counts were handled differently from one producer to the next. The macaque atlas displayed TMM-normalized CPM; bulk count studies displayed CPM on raw library sizes. Some producers kept the strongest row of a duplicated symbol after testing, and five rounded fractional count estimates before edgeR.

## Environments

| | Before | After |
|---|---|---|
| Macaque atlas DE | R 4.4.1, edgeR 4.2.2, limma 3.60.6 | R 4.6.0, edgeR 4.10.1, limma 3.68.4 |
| Macaque atlas FGSEA | fgsea 1.30.0, msigdbr 25.1.1, MSigDB 2025.1.Hs | fgsea 1.38.0, msigdbr 26.1.0, MSigDB 2026.1.Hs |
| Bulk DE | 142 tables R 4.4.1 / edgeR 4.2.2 / limma 3.60.6; 57 tables R 4.6.0 / edgeR 4.10.1 / limma 3.68.4 | all 202 tables R 4.6.0 / edgeR 4.10.1 / limma 3.68.4 |
| Bulk FGSEA | already R 4.6.0, fgsea 1.38.0, msigdbr 26.1.0, MSigDB 2026.1.Hs | unchanged versions, rerun on the new DE tables |
| Annotation | org.Mm.eg.db / org.Rn.eg.db 3.19.1 | org.Mm.eg.db / org.Rn.eg.db 3.23.0, AnnotationDbi 1.74.0 (Bioconductor 3.23) |

Other packages in the new environment: statmod 1.5.2, data.table 1.18.4, babelgene 22.9, SeuratObject 5.4.0 and Matrix 1.7.5 (macaque pseudobulk only). Each output's own `sessionInfo` file is the full record.

The macaque "before" row was not recorded at the time. It was established by a replay: `data/raw/scripts/run_atlas_r460.R --profile=legacy`, run under R 4.4.1 with the versions above, rebuilt the pseudobulk from the six source RDS files and reproduced 839 of the 840 committed per-population CSVs byte for byte after LF normalisation. The one exception, `e9__POMC_TBX3/fgsea/FGSEA_Reactome.csv`, was re-saved after the original run with 9 significant digits and no quotes. Its values and leading edges agree with the replay, and its `_noLE` companion is byte-identical. The replay's session records are in `macaque/validate-r441-legacy/`.

R 4.4.1 stays installed on the analysis machine for one purpose: re-verifying sealed history that was recorded under it. New outputs are produced only under R 4.6.0.

## Upstream processing

`geo_replication/config/upstream_processing.tsv` records, for each of the 160 source accessions behind the registered studies, the depositor's aligner, genome build, annotation and quantifier with the evidence file and its SHA-256. HypoExplorer does not realign reads, so these are the depositors' choices, parsed from their repository records by `scripts/build_upstream_processing.mts`. Hand corrections and review pins live in `upstream_processing.overrides.json`. `npm run check:upstream` fails when a record, the extractor or a reviewed row drifts.

| Measure | Count |
|---|---:|
| Accessions | 160 |
| Reviewed | 160 (updated September 27) |
| Needs review | 0 |
| Aligner recorded | 155 |
| Genome build recorded | 156 |
| Annotation recorded | 58 |
| Evidence: GEO data-processing field / ArrayExpress IDF protocol / paper methods | 155 / 4 / 1 |

CNP0003785 was the unresolved review at the end of regeneration because automated publisher retrieval was blocked. On September 27, the author-uploaded STAR Methods of Lei et al. 2024 (PMID 38325338) established STAR 2.5.3 and the Macaca_fascicularis_5.0 pre-mRNA reference. The annotation provider/release and snRNA-seq counting tool are not stated in the reviewed paper or author code; they remain explicitly unrecorded. The [retained review](../../upstream-processing/2026-09-27/CNP0003785-review.json) records the sources, short excerpt and author-code audit. This completed the source review without changing the scientific outputs or claiming that unstated details had been recovered.

The upstream row is shown in the study fact table (`src/common/StudyMetadata.tsx`), on the prerendered study pages and on `/methods`.

## Rules applied to every producer

The rule strings are written into every `<stem>_provenance.tsv` (`rule_duplicates`, `rule_mar_disambiguation`, `rule_fractional`, `rule_cpm`). The shared implementation is `scripts/lib/de_common.R` (`de_common_version` 2026-09-26.6).

**Symbol mapping.** Every feature is mapped to its final public symbol: the organism annotation first, then an R copy of `normalizeGene` from `scripts/lib/geneSymbol.mts`. The R copy and the TypeScript function agree on all 782,294 identifiers in the corpus. Both carry a fix made on September 26: a zero-padded Excel month number becomes its plain number, so `Sep-01` maps to Septin1 and `Mar-03` to Marchf3. Before the fix these became `Septin01` and `Marchf03`, which affected 16 labels in GSE190389.

**A3.1, duplicate symbols.** Features that share a symbol are summed before the fit only when the grouping is known to be the same gene:

- distinct stable IDs (Ensembl, Entrez) that the annotation assigns to one symbol, or
- repeats of one identical label that is not an Excel date.

Counts are summed (`rowsum`), log-scale matrices averaged (`limma::avereps`) and linear-scale normalized matrices summed on the linear scale. Other groups are not summed. Repeated Excel-date labels and distinct symbol-type labels that meet only after normalization (for example `Tcp10c` and an Ensembl ID the annotation names Tcp10c) are fitted as separate rows, and only the feature whose label is exactly the symbol is published; the others get feature-map status `ambiguous_symbol`.

**M1, 1-Mar and 2-Mar.** An Excel-date label of 1-Mar or 2-Mar, in any format, can mean MARCHF1/2 or MTARC1/2, so it is ambiguous even when it occurs once. It is fitted as a hidden `ambiguous_symbol` row unless another column of the same source row names one candidate. The columns are tried in this order:

1. a stable-ID column (Entrez or Ensembl) mapped by org.*.eg.db;
2. a gene-name column equal to one candidate's official org.*.eg.db name after normalization, or, for renamed genes, sharing at least 50% of its non-numeric words with one candidate's name and at most 20% with the other's, with the same gene number;
3. a chromosome column equal to exactly one candidate's chromosome.

The feature map records which column resolved it (`disambiguated_by_stable_id`, `disambiguated_by_name`, `disambiguated_by_chr`), and the provenance field `mar_resolution` lists each label.

**Unmapped features.** Features without a symbol stay in the fit as their own rows under their raw ID. `filterByExpr`, TMM, the dispersion and empirical-Bayes priors and the Benjamini–Hochberg family therefore see the whole library. Those rows, and the `ambiguous_symbol` rows, are left out of the published DE, SE, CPM and expression tables; `n_unmapped_in_fit` and `n_unmapped_tested` count them. Nothing is de-duplicated after testing.

**B1, fractional counts.** Count estimates go to edgeR unrounded. Five studies had been rounded: GSE235479, E-MTAB-6929, GSE229838, GSE282067 and GSE205313.

**C2, browser CPM.** Each count study now writes two matrices over the published symbols:

- `<stem>_CPM_TMM.tsv.gz`: count / (filtered library size × TMM factor) × 10^6, using the TMM factors of the DE fit itself, which includes the unmapped rows. The browser shows this matrix, labelled "CPM (TMM-normalized)".
- `<stem>_CPM_raw.tsv.gz`: count / raw input column total × 10^6, the old display's definition. It is written for comparison but kept only in the frozen staging archive; `.gitignore` excludes it from the repository.

For multi-contrast tracks (the high-fat-diet intake and the September 5 batch), `_CPM_TMM` comes from one fit over all included samples of the track. `<stem>_cpm_normalization.tsv` lists each sample's raw, fitted, published and filtered library sizes, TMM factor and effective library size. Matrix studies (limma on a deposited normalized matrix) write `<stem>_expression.tsv.gz` in the deposited unit instead. The macaque atlas already displayed TMM-normalized CPM (`de/normcpm.csv`); it now also writes `qc/library_sizes.csv`, and `de/rawcpm.csv`, which is likewise kept only in the staging archive.

**Line endings.** Every producer writes LF text on every platform, and the SHA-256 values recorded in provenance are of those LF bytes. The provenance field `text_output_policy` states this.

**Enrichment.** The msigdbr ortholog cache is cleared before every collection fetch. msigdbr 26 otherwise caches the first collection's ortholog map and silently truncates the KEGG, GO and Reactome mappings that follow. The tie-breaking jitter is seeded once, and the fgsea seed is reset to 42 before each collection, so a collection's permutations no longer depend on the collections run before it. The FGSEA phase runs with `LC_COLLATE=C`, the collation under which the committed gene-set membership hashes were computed.

## Producers

The sealed producers that made the old tables are left byte-identical, because retained evidence pins them. The regeneration uses new producers:

| Producer | Covers |
|---|---|
| `scripts/regenerate_bulk_de.R` | Runs every bulk job into a staging tree outside the repository, writes `RUN_SUMMARY.tsv`, and compares staged with committed tables |
| `scripts/lib/de_common.R` | Rules A3.1, M1, B1 and C2, annotation, LF writers, provenance and session records |
| `scripts/regen-r460/run_dataset_r460.R`, `compute_edger_se_r460.R` | Rows of `geo_replication/config/datasets.tsv`, and their SE sidecars |
| `scripts/regen-r460/run_hfd_r460.R`, `run_september5_r460.R`, `supported_matrix_r460.R` | High-fat-diet intake, September 5 batch, supported-matrix batch 1 |
| `scripts/regen-r460/de_gse135639_r460.R`, `de_gse154274_r460.R`, `de_gse157077_r460.R` | Studies with their own DE script |
| `scripts/regen-r460/prep_2026batch2_r460.R`, `prep_GSE205313_r460.R`, `prep_GSE229838_r460.R`, `prep_GSE282067_r460.R` | Preparations whose output changed under rule B |
| `scripts/regen-r460/run_fgsea_r460.R` | Bulk FGSEA; differs from `scripts/run_mouse_fgsea.R` only in honouring `HYPO_OUT_ROOT` and its generator path |
| `data/raw/scripts/run_atlas_r460.R` | Macaque atlas, self-contained: reads the six source RDS files, writes per-population pseudobulk counts, then DE and FGSEA |
| `scripts/regen-r460/audit_duplicate_groups_r460.R`, `a3_identity_check_r460.R` | The duplicate-group audit and the before/after check for the A3 changes |

`bulk/final3_code_sha256.txt` and the `code` list in `bulk/FROZEN.json` give the SHA-256 of every code file used for the final bulk run. `geo_replication/scripts/`, including `run_dataset.R`, is now tracked. It was git-ignored, so the producers of most committed bulk tables were not in the repository.

Two jobs were skipped with documented reasons (`bulk/RUN_SUMMARY.tsv`). GSE201986 is not a registered study, and its mixed Ensembl macaque, RefSeq and custom IDs have no deposited feature-to-gene map, so rule A would drop every feature. GSE113943 is an archived, unregistered microarray with no config row, prepared matrix or probe map in the repository.

## Session records

Every output now has a session record and a provenance record next to it.

| Output | Session record | Provenance |
|---|---|---|
| Bulk DE, `geo_replication/datasets/<dir>/processed/<stem>_DE.tsv` | `<stem>_sessionInfo.txt` | `<stem>_provenance.tsv`: generator and `de_common.R` SHA-256, package versions, rules, design, sample lists, feature counts, input and output SHA-256 |
| Bulk SE | `<stem>_SE_sessionInfo.txt` | `<stem>_SE_provenance.tsv` |
| Bulk FGSEA | versions in the provenance record | `<stem>_FGSEA_provenance.tsv` (schema 3: generator hash, versions, seed and cache policies, gene-set membership hashes, SHA-256 of each published table) |
| Macaque population, `data/raw/results/<population>/` | `sessionInfo.txt` | `de/DE_provenance.tsv`, `fgsea/FGSEA_provenance.tsv` |
| Macaque run | `_global/sessionInfo.txt` | `_global/RUN_provenance.tsv` |
| Macaque pseudobulk, `data/raw/pseudobulk/<population>.counts.tsv.gz` | `data/raw/pseudobulk/sessionInfo.txt` | `PSEUDOBULK_provenance.tsv`, `samples.tsv` |

The per-animal pseudobulk counts of every population are now committed under `data/raw/pseudobulk/` (12 MB), so the atlas DE can be refitted from the repository. The six source RDS files are not in the repository. Their sizes and SHA-256 are in `data/raw/pseudobulk/samples.tsv` (copied here as `macaque/pseudobulk_samples.tsv`). All six have the same 16,283 features, integer counts and no duplicated symbol.

The final macaque run records one generator, `run_atlas_r460.R` at SHA-256 `4cde3c6a…`, in `RUN_provenance.tsv` and `PSEUDOBULK_provenance.tsv`. `macaque-final` was checked against the first staging run before it was frozen (`macaque/tools/freeze.py`): every file is identical after CRLF-to-LF normalization, and provenance differs only in hashes and run times.

## Comparison method

Bulk differences are split with an environment-only control: the pre-change producers re-run under R 4.6.0 on the committed inputs.

- committed → control is the environment effect: R 4.4.1 / edgeR 4.2.2 / org.*.eg.db 3.19.1 to R 4.6.0 / edgeR 4.10.1 / org.*.eg.db 3.23.0. For tables already made under R 4.6.0 this part is zero or float noise.
- control → final is the rule effect: rules A3.1, M1 and B1.

Tables are joined on the public symbol. GSE154274 has no control because its old Python route cannot be replayed.

Both final trees were frozen before the swap:

| Tree | Manifest | Files | SHA-256 |
|---|---|---:|---|
| `bulk-final3` | `bulk/FROZEN.json` | 3,391 (1,171,722,625 bytes) | `fefb5fc164ab6b103313e894736a0e5901e434377783f743a8bb63b2460c0a1d` |
| `macaque-final` | `macaque/FROZEN.json` | 1,217 | `cf0dae9e7f693aae2557deb538ce7082554f39af27afd7ec516a69ce481cb042` |

The bulk manifest names the trees it supersedes: `bulk-final2`, `bulk-final`, v3 and v2 (`73116ba6…`, the tree the first draft of this record described). `bulk/CHANGED_VS_REPO.tsv` and `macaque/CHANGED_VS_REPO.tsv` list every final file whose bytes differ from the repository before integration.

## Bulk DE results

202 DE tables were regenerated, all with status `ok`.

| Class | Tables |
|---|---:|
| (i) environment only | 121, of which 74 are numerically identical to the committed tables |
| (ii) rule A | 76 (4 of them changed only by the symbol gate) |
| (iii) rule B only | 1 (E-MTAB-6929) |
| (ii) + (iii) | 4 (GSE235479, GSE229838, GSE282067, GSE205313) |

| Measure | Committed | Environment control | Final |
|---|---:|---:|---:|
| FDR < 0.05 calls, all tables | 129,674 | 129,313 | 129,326 |

- 137 tables have no changed call.
- Among FDR < 0.05 genes there are 22 sign flips. 18 come from the environment: org.*.eg.db 3.23 assigns the symbol to a different Ensembl gene. 4 come from rule A, and each is a symbol now summed over several features (Kctd16 in GSE294478, Cplx2 in GSE306829, Slc12a6 in GSE281503, Eno1 in GSE98690). The old tables kept only the strongest feature.
- The median staged/committed SE ratio is 1.00. The lowest ratios (down to 0.23, in GSE282067 and GSE68177) appear in the control as well, so the environment causes them.

### Duplicate groups and the A3.1 changes

`notes/duplicate_groups_audit.tsv` classifies every group of features that share a final symbol in the final tree, one row per feature map (170 maps). There are 8,298 summed groups: 7,800 of distinct stable IDs, 495 of identical non-date labels, and 3 of distinct symbol-type labels, which are not summed and publish only their exact-label feature. No repeated date-label group remains, because every 1-Mar or 2-Mar label is resolved or hidden before grouping.

Seven studies changed under A3, A3.1 or the month-number fix (`notes/a3_1_affected_vs_v2.tsv`, compared with the earlier A2 tables):

| Study | Change |
|---|---|
| GSE148641 | 1-Mar and 2-Mar resolved by the chromosome column: chr8 Marchf1, chr17 Marchf2, chr1 Mtarc1 and Mtarc2. Mtarc2 is newly published; Mtarc1 does not pass `filterByExpr`. |
| GSE167105 | Resolved by the name column: Mtarc1 and Mtarc2 by exact official name, Marchf1 and Marchf2 by word overlap with their previous official name. Mtarc1 and Mtarc2 are newly published. |
| GSE198437 | Resolved by the Entrez ID column. Mtarc1 and Mtarc2 are newly published. |
| GSE143818 | 1-Mar and 2-Mar hidden: no other column identifies them. |
| GSE190389 | Mar-01 and Mar-02 hidden. The other zero-padded labels now publish as Marchf3–9 and Septin1–9 instead of Marchf03, Septin01 and so on. |
| GSE242245 | Tcp10c: exact-label feature only. |
| GSE289461 | 4933427D14Rik and Fam90a1b: exact-label feature only. |

In GSE148641, GSE167105 and GSE198437 the published Marchf1 and Marchf2 rows are now one gene each; A2 had summed the MARCHF and MTARC features. FDR < 0.05 counts are unchanged in all seven studies, and other genes move by at most 2.8e-4 in logFC.

### Flagged tables

A table is flagged when more than 5% of its FDR < 0.05 calls changed or any FDR < 0.05 gene changed sign. 32 are flagged: 24 by the environment only, 5 by the rules only, 2 by both, and GSE154274, which has no control. The per-table rows are in `bulk/COMPARISON.md` and `bulk/COMPARISON.tsv`.

Keeping unmapped features in the fit removed every flag that an earlier version of rule A, which dropped them before the fit, had caused. Seven tables still have a rule-driven flag, and each one traces to features that share a symbol (`bulk/rule_flag_investigation.tsv`):

| Table | FDR < 0.05, control → staged | Cause |
|---|---|---|
| GSE229159 | 6 → 55 | 8 features collapsed. The control has 66 genes at FDR < 0.056, 60 of them between 0.050 and 0.055. The small change in the dispersion prior moves that block across 0.05. Median FDR ratio on shared genes 0.997, no sign flips. |
| GSE292416 | 111 → 89 | 123 collapsed features lower the prior df from 5.79 to 5.67; 22 borderline calls cross 0.05. |
| GSE252364 | 5 → 3 | 24 collapsed features; one of the two changed calls is a collapsed symbol. |
| GSE294478, GSE306829, GSE281503, GSE98690 | one sign flip each | The flipped gene is a summed multi-feature symbol (see above). |

The environment-driven flags are explained in `bulk/COMPARISON.md`. They fall into four groups: GSE87544 (below); GSE282067, whose low-count Treg libraries move under edgeR 4.10; small or borderline call sets that move under edgeR 4.10 (GSE270378, GSE190389, GSE162744, GSE132308, GSE128148, GSE261833, GSE167264, GSE270383, GSE68177_POMC, GSE240365, GSE289461, GSE305688); and symbol reassignments by org.*.eg.db 3.23 (GSE309435, GSE175461, GSE168151, GSE207992, GSE234483, GSE306829).

## Bulk FGSEA results

808 tables (202 DE tables × Hallmark, KEGG legacy, GO:BP and Reactome) were rerun. Gene-set membership hashes and the fgsea, msigdbr, MSigDB and R versions match the committed provenance on all 808 rows, so every difference comes from the DE input.

| Collection | padj < 0.05, committed → final | Gained | Lost | Significant NES sign flips |
|---|---|---:|---:|---:|
| Hallmark | 1,767 → 1,724 | 59 | 102 | 0 |
| KEGG | 2,220 → 2,171 | 125 | 174 | 5 |
| GO:BP | 33,237 → 31,597 | 1,636 | 3,276 | 21 |
| Reactome | 14,084 → 13,988 | 722 | 818 | 9 |
| All | 51,308 → 49,480 | 2,542 | 4,370 | 35 |

- 235 rows from 59 tables have unchanged DE input and unchanged results. GSE264350 GO:BP differs by at most 2.7e-4 in NES because its DE statistics differ in the 14th significant digit.
- 452 of the 572 changed rows (113 tables) changed because the ranked list changed. The old DE tables published unmapped raw-ID rows, and FGSEA ranked them although they belong to no gene set. Those rows are no longer published, so member genes move in the ranking. For example, GSE261833 ranks 16,117 genes instead of 22,348, and its significant GO:BP sets fall from 799 to 571.
- 120 rows (30 tables) changed because the DE statistics changed under the new environment. GSE153551 is environment-only: edgeR 4.10 changes its extreme F statistics by up to 45, and its significant GO:BP sets fall from 214 to 28.
- All 35 significant NES sign flips are in GSE296488 (4) and GSE306829 (31).

## Macaque atlas results

The six source RDS files were read once to build one pseudobulk for all runs. Group sizes match the original run for all 60 populations, and the same three populations fail the group-size rule (e27, e47, h46). The TMM effective library sizes implied by the committed `normcpm.csv` equal the new ones to within 1e-15, except in i43 and e36 (below). Per-population checks are in `macaque/PSEUDOBULK_VERIFICATION.tsv`.

**DE (edgeR 4.2.2 → 4.10.1).** FDR < 0.05 genes across the 60 populations fell from 763 to 613: 70 genes crossed into significance and 220 crossed out. No significant gene changed the sign of its logFC. The median per-population |ΔlogFC| is 4.5e-4, the largest 0.031 (Fibro2), and Spearman ρ of logFC is at least 0.99991 in every population. Most crossings are in TanyA (230 → 91), i40 (409 → 351), i23 (73 → 142), e33 (12 → 3) and i3 (6 → 0). The edgeR NEWS entries that explain the change are in `macaque/COMPARISON.md`: the non-legacy `glmQLFit` hyperparameter estimation (4.4.0), the `estimateDisp` span (4.8.0) and `glmQLFit` no longer reusing trended dispersions stored in the DGEList (4.10.0).

In i43 and e36, `filterByExpr` keeps 43 fewer and 32 more genes. Every affected gene has exactly 10 counts in the median-library sample, where the CPM equals the cutoff; edgeR 4.10's C++ `cpm()` rounds the last bit differently. TMM factors are then computed on a different gene set, which is the only source of `normcpm` differences above 1e-14.

The regenerated macaque bundles were slimmed with `npm run optimize:bundles`, as the committed ones had been.

**FGSEA.** padj < 0.05 sets across the 60 populations:

| Collection | Committed → new | Significant NES sign flips |
|---|---|---:|
| Hallmark | 103 → 109 | 0 |
| KEGG legacy | 166 → 166 | 0 |
| GO:BP | 1,019 → 1,154 | 3 |
| Reactome | 825 → 970 | 3 |

Each change was attributed by changing one factor at a time (`macaque/decomp/`, `macaque/tools/fgsea_decompose.R`): fgsea 1.30 → 1.38 moves multilevel p-values but barely moves NES; the per-collection seed reset gives KEGG, GO:BP and Reactome a new permutation stream; MSigDB 2026.1.Hs re-annotates GO:BP and Reactome sets (Hallmark and KEGG legacy membership is identical); and the edgeR 4.10 ranks shift a few sets across the 15–500 size window. All six significant sign flips are in re-annotated sets, for example REACTOME_MITOCHONDRIAL_TRANSLATION in i3 and i25, which grew from 71 to 84 genes. No DE or FGSEA difference is unexplained.

## GSE87544

This Drop-seq pseudobulk study has 7 processed units and the design `~ batch + group`, which leaves 1 residual degree of freedom. Batches B0, B3 and B4 hold one unit each and are fitted exactly by their batch coefficients, so the fasting effect and all residual variance come from the two within-batch pairs in B1 and B2.

| | Committed (edgeR 4.2.2) | Regenerated (edgeR 4.10.1) |
|---|---:|---:|
| Genes tested | 14,881 | 14,881 |
| FDR < 0.05 | 224 | 1 |
| FDR < 0.1 | 371 | 5 |
| Smallest FDR | 3.9e-10 | 0.032 |

logFC is essentially unchanged (correlation 1.000, largest difference 0.019), and the rules do not touch this study. The difference is edgeR 4.10's non-legacy QL fit, which no longer produces very large F statistics at 1 residual df. Because its gene-level calls depend on the edgeR version more than on the data, HypoExplorer now shows GSE87544 as exploratory: read its effect sizes and pathway ranks, not its gene-level FDR. The full analysis is in `notes/GSE87544_design.md`.

## GSE205313

The tracked counts matrix held rounded Salmon estimates. The study was re-prepared unrounded from its GEO supplementary archive (`GSE205313_RAW.tar`, 11 hypothalamic Salmon `.sf.gz` files, GSM6210140–GSM6210150) and the Ensembl GRCm38 release 102 GTF. Both files are git-ignored; their URLs, sizes and SHA-256 are in `geo_replication/datasets/GSE205313_mmus_hypo_astrocyte_hfhs/metadata/r460_sources.json`. The regenerated table has 54,285 features (54,227 with a symbol, 58 unmapped rows kept in the fit) and publishes 19,307 genes. It had no FDR < 0.05 gene before or after. The largest |ΔlogFC| against the committed table is 0.071, all from unrounding. Significant sets, committed → final: Hallmark 28 → 28, KEGG 46 → 39, GO:BP 358 → 370, Reactome 155 → 147. `notes/GSE205313_sources.md` was written before the two files were fetched and describes that earlier state.

## Evidence after the regeneration

The replaced bytes were pinned by retained evidence, so the evidence was re-derived by successor producers and checks rather than by editing the pinned ones. The internal-QC successors are described in `data/internal-qc/advancement-r460-2026-09-25/README.md`; the others are:

| Successor | Replaces or extends |
|---|---|
| `scripts/build_internal_qc_r460.mts`, `scripts/lib/internalQcR460.mts`, `scripts/advance_internal_qc_r460.mts`, `scripts/advance_internal_dedicated_r460.mts` | Internal-QC ledger build and refits |
| `scripts/audit_macaque_internal_qc_r460.mts`, `scripts/audit_macaque_normalization_r460.R` | Macaque QC, now refitted from the committed pseudobulk |
| `scripts/audit_count_conservation_r460.py` | Count conservation for the re-prepared inputs |
| `scripts/audit_source_relationship_r460.mts` | Source-relationship audit for the six studies whose sealed readers pin a replaced file |
| `scripts/audit_september5_intake_r460.mts`, `scripts/audit_hfd_intake_r460.mts`, `scripts/build_hfd_bundles_r460.mts` | Intake audits and HFD bundles |
| `scripts/audit_author_cohort_r460.py`, `scripts/audit_concordance_review_ledger.mts` | Author-cohort audit and the successor concordance ledger |
| `data/author-validation/regeneration-r460-2026-09-25/concordance-reviews-r460.json` | Re-reviews of author concordance where the regenerated tables changed |
| `registry-edits.json` (130 reviewed edits), `successor-inventory.json`, `r460-inputs.json` | Registry changes, rebuilt ledgers and re-prepared inputs, for the sealed checks (see below) |

Outcomes:

- **Internal QC.** The ledger totals are unchanged from the pre-swap commit: 83 pass, 60 review, 0 fail, 18 not assessed.
- **Macaque atlas.** The normalization, model validity, matrix values, library detection, output integrity and normalized-output checks now pass on all 60 populations, because they are refitted from the committed pseudobulk. The atlas stays at review overall: source integrity, independent replication and count conservation cannot be assessed without the source objects and an animal crosswalk, and five populations have two animals in one arm.
- **GSE205313.** Count conservation passes on the unrounded re-preparation.
- **Author concordance.** Successor re-reviews upheld the earlier decisions for GSE104255, GSE128148, GSE284408 and GSE167105, and left GSE156859 and GSE153498 unchanged. The GSE201408 coverage check and the GSE298648 magnitude check moved from pass to review, because author genes that map to unmapped features are no longer published.

## Reproduction

```text
# Upstream processing table
npx tsx scripts/build_upstream_processing.mts
npm run check:upstream

# Bulk DE, SE and CPM into a staging tree outside the repository, then compare
Rscript scripts/regenerate_bulk_de.R --out "<staging>/bulk" --workers 8 --phase run
Rscript scripts/regenerate_bulk_de.R --out "<staging>/bulk" --phase compare --control "<staging>/control"

# Bulk FGSEA over the staged DE tables (sets LC_COLLATE=C), then compare
Rscript scripts/regenerate_bulk_de.R --out "<staging>/bulk" --workers 8 --phase fgsea
Rscript scripts/regenerate_bulk_de.R --out "<staging>/bulk" --phase fgsea-compare

# Macaque atlas DE and FGSEA from the committed pseudobulk
Rscript data/raw/scripts/run_atlas_r460.R --stage=analyze --pseudobulk-dir=data/raw/pseudobulk --out-root="<staging>/macaque" --workers=8 --loo

# Macaque atlas from the six RDS files: pseudobulk, then DE and FGSEA
Rscript data/raw/scripts/run_atlas_r460.R --input-dir="<dir with HCA_Macaque001_S00[1-6].rds>" --out-root="<staging>/macaque" --workers=8 --loo

# Duplicate-group audit and A3 before/after check
Rscript scripts/regen-r460/audit_duplicate_groups_r460.R <staging root> <out dir>
Rscript scripts/regen-r460/a3_identity_check_r460.R <before dir> <staging root> <out tsv>

# The original-environment replay (run with R 4.4.1)
Rscript data/raw/scripts/run_atlas_r460.R --profile=legacy --pseudobulk-dir="<staging>/macaque/pseudobulk" --out-root="<staging>/macaque/validate-r441-legacy" --stage=analyze --workers=7 --loo
```

The environment-only control was produced by running the pre-change producers under R 4.6.0 into a separate staging tree; those runner scripts were not committed. The macaque comparison tables were produced by `macaque/tools/compare.py`. It and `macaque/tools/fgsea_decompose.R` hold the staging paths used on September 25 as constants. QA PDFs (`--qa-pdf`) were not produced, because pheatmap and gridExtra are not installed under R 4.6.0.

After a staging run the outputs are copied into `geo_replication/datasets/*/processed/` and `data/raw/results/`, the bundles, indexes and ledgers are rebuilt, and the supersession manifest is finalized (below).

## What is sealed and what is live

- **Live:** the regenerated tables, their session and provenance records, the bundles, the query and expression indexes, the ledgers and `upstream_processing.tsv`. The producers above rebuild them, and the usual `--check` modes compare against them.
- **Sealed:** retained evidence, sealed reports and ledgers that pin the pre-regeneration bytes, and the producers that made them (`geo_replication/scripts/run_dataset.R`, `scripts/run_mouse_fgsea.R`, `data/raw/scripts/run_all_clusters.R` and the other originals). None of them was edited. The sealed checks read the pre-regeneration bytes through the supersession manifest described next, and R 4.4.1 remains available to replay them.

## Comparison files in this folder

| Path | Content |
|---|---|
| `bulk/COMPARISON.md`, `bulk/COMPARISON.tsv` | Final per-table DE comparison with environment and rule parts |
| `bulk/rule_flag_investigation.tsv` | The seven rule-driven flags, one by one (from the v2 tree; the final comparison reports them unchanged) |
| `bulk/FGSEA_COMPARISON.md`, `bulk/FGSEA_COMPARISON.tsv` | Final per-table, per-collection FGSEA comparison |
| `bulk/RUN_SUMMARY.tsv` | Status, SE status and run time of each job |
| `bulk/FROZEN.json`, `bulk/final3_code_sha256.txt` | File list and SHA-256 of the final bulk tree, and of the code that produced it |
| `bulk/CHANGED_VS_REPO.tsv` | Final bulk files whose bytes differed from the repository |
| `macaque/FROZEN.json`, `macaque/CHANGED_VS_REPO.tsv` | The same for the final macaque tree |
| `notes/duplicate_groups_audit.tsv` | Duplicate-group classes per feature map |
| `notes/a3_1_affected_vs_v2.tsv` | The seven studies changed by A3, A3.1 and the month-number fix |
| `notes/GSE205313_sources.md` | Inputs of the GSE205313 re-preparation (written before they were fetched) |
| `macaque/COMPARISON.md`, `macaque/COMPARISON.tsv` | Per-population DE, CPM and FGSEA comparison, with the FGSEA attribution steps |
| `macaque/PSEUDOBULK_VERIFICATION.tsv` | Group sizes, implied library sizes and the legacy-replay result per population |
| `macaque/pseudobulk_samples.tsv`, `macaque/PSEUDOBULK_provenance.tsv` | Source RDS hashes and the pseudobulk record |
| `macaque/validate-r441-legacy/`, `macaque/decomp/` | Session records and summaries of the legacy replay and the attribution runs |
| `macaque/tools/` | `compare.py`, `fgsea_decompose.R` and `freeze.py` |
| `notes/GSE87544_design.md` | The GSE87544 design analysis |

The comparison files are copied unchanged from the staging trees, so their relative links (such as `../notes/` or `../bulk/_logs/`) and absolute paths refer to those trees. The macaque comparison was made against the first staging run, which `macaque-final` matches after newline normalization.

## Superseded outputs and sealed checks

Every analysis output was regenerated under R 4.6.0: bulk DE, SE, CPM and FGSEA tables under `geo_replication/datasets/*/processed/`, the macaque atlas under `data/raw/results/<population>/`, and then every bundle under `public/datasets/`. The R 4.4.1 bytes they replace are pinned by SHA-256, as exact bytes or as their CRLF rendering, in retained evidence, sealed reports and ledgers. Repository rule: a pin and a sealed producer are never edited. This record adds one more verified projection to the historical adapter instead: a sealed check may read the old bytes of a file only when the change is proven to be this regeneration.

The old bytes are not copied. They remain committed blobs at the pre-swap commit `83acab3059fdd8cc024702ec7c9cf7f3d6d14c3e` (main before the swap). The tag `superseded/r441-2026-09-25` names that commit so the blobs stay reachable.

### Files

| File | Role |
| --- | --- |
| `supersession.json` | The manifest. One record per tracked output in scope: `path`, `datasetId`, `oldSha256`, `oldBytes`, `oldGitBlob`, `oldPinForm` (`exact`, `crlf`, `both` or null), `pinnedBy`, `newSha256`, `newBytes`. It also lists the archived ledgers. |
| `preserved-inputs/<sha256>.json.gz` | The pre-swap bytes of each ledger the swap rewrites, named by the SHA-256 of the uncompressed bytes. |
| `scripts/regen-r460/build_supersession_manifest.mts` | `--capture` before the swap, `--finalize` after it, `--check` at any time. |
| `scripts/historical_evidence.py`, `scripts/lib/historicalEvidence.mts` | `read_superseded` / `readSupersededInput` and the ledger rule. Each pins the manifest's SHA-256 (`SUPERSESSION_SHA`, `SUPERSESSION_SHA256`). |
| `scripts/run_sealed_report_check.py`, `scripts/run_historical_check.py`, `scripts/run_sealed_ts_check.mts` | The three sealed-check runners. |

The scope is every tracked file under `geo_replication/datasets/*/processed/`, `data/raw/results/`, `public/datasets/`, `public/expression/`, `public/tracker/`, `public/nomenclature/` and `public/qc/`, plus `public/pop_meta.js`, `src/data/tracker/reverseIndex.generated.js` and `data/nomenclature/{nomenclature.tsv,sources.json}`. A record is marked pinned when its exact or CRLF-rendered SHA-256 appears in any tracked text file at the pre-swap commit, or in a tracked `.gz` evidence archive under `data/` (outside `data/raw/`). Bundles, atlas results and this folder are not searched for pins.

### When old bytes are served

An output's old bytes are served only when all of these hold:

1. The manifest's SHA-256 equals the constant pinned in the reader. Until `--finalize` writes it, the constant is unset and nothing is served.
2. The manifest lists the path, and the requested pin is `oldSha256` or the SHA-256 of its CRLF rendering.
3. The current file hashes to `newSha256` with `newBytes` bytes.
4. `git cat-file` of `<preSwapCommit>:<path>` returns the blob `oldGitBlob`, whose bytes hash to `oldSha256` with `oldBytes` bytes. A shallow or partial clone, or a missing commit, fails closed and says to fetch full history. If the tag exists, it must name the pre-swap commit.

A ledger is served as its archived pre-swap bytes only when the archive holds the recorded bytes and the current ledger differs from them in nothing but regenerated datasets:

- the key set is unchanged, and schema and policy keys (`schemaVersion`, `policy`, `scope`, `method`, `script`, fingerprint conventions, `*Policy` and similar) are equal;
- `generatedAt`, `summary`, `counts` and `totals` may follow the records;
- a record list keeps its length and order, and only records whose `datasetId` has a changed output in the manifest may differ;
- a path-to-fingerprint map (`inputs`, `fingerprints`) keeps its keys, and only regenerated outputs and archived ledgers may change;
- a single-dataset document such as the macaque atlas evidence may change only when that dataset was regenerated.

An older pin then resolves against the pre-swap ledger exactly as it did before the regeneration: the restricted quality-ledger projection, or the HFD intake archive rules. Before the swap, all four sealed-report ledger pins resolved from the current ledgers, including the quality ledger's restricted projection (`8f31a32d…`).

`read_sealed_input` and `readSealedHistoricalInput` fall back to these rules for any path the finalized manifest names, so their existing callers need no change. `run_sealed_report_check.py` applies them to the four ledgers and, after the newline rule, to the 2,332-file scientific snapshot. `run_historical_check.py` adds `project_superseded` to every producer it runs. `run_sealed_ts_check.mts` runs an allow-listed, SHA-256-pinned TypeScript producer in `--check` mode with its file reads routed through the same readers (see [Sealed TypeScript checks](#sealed-typescript-checks)). A producer that reads an output without naming a pin receives its pinned form: the CRLF rendering when only that form is pinned, otherwise the exact bytes. Every projection rejects a file that changes during the check.

### Procedure

```text
npx tsx scripts/regen-r460/build_supersession_manifest.mts --capture
git tag superseded/r441-2026-09-25 83acab3059fdd8cc024702ec7c9cf7f3d6d14c3e
(regenerate outputs, bundles, indexes and ledgers)
npx tsx scripts/regen-r460/build_supersession_manifest.mts --finalize
npx tsx scripts/regen-r460/build_supersession_manifest.mts --check
```

`--finalize` drops records whose bytes did not change (newline-only checkout differences count as unchanged), keeps removed files with a null `newSha256`, and writes the manifest SHA-256 into both readers. It refuses to finish if any other tracked file changed since the pre-swap commit while its pre-swap bytes are pinned. Such a file must be brought into scope or passed with `--accept <path>`; accepted paths are listed in `acceptedUnmanaged`.

### Capture, September 25

| Measure | Value |
| --- | ---: |
| Records in scope | 4,206 |
| Records pinned | 2,057 (exact 1,787; CRLF only 14; both 256) |
| Files holding those pins | 449 |
| Old bytes, all records | 2,425,992,178 |
| Old bytes, pinned records | 1,642,374,715 |
| Archived ledgers | 13 |

| Area | Records | Pinned |
| --- | ---: | ---: |
| `geo_replication/datasets/*/processed/` | 2,022 | 1,574 |
| `public/datasets/` | 945 | 298 |
| `data/raw/results/` | 913 | 182 |
| `public/expression/` | 259 | 3 |
| `public/qc/` | 60 | 0 |
| Tracker, nomenclature, `pop_meta.js` | 7 | 0 |

### Re-prepared inputs and finalization, September 25

The first `--finalize` refused 12 pinned outputs under `geo_replication/archive/{GSE198437,GSE329539}/processed/`, so that area joined the scope. The regeneration also re-prepared tracked inputs (gene and ID maps, source tables, re-prepared count matrices, and the GSE154274 samplesheet and expression matrix); after the final run there are 77 of them. Each was copied from the frozen staging tree (`FROZEN.json` SHA-256 `fefb5fc1…`) over its tracked path. [`r460-inputs.json`](r460-inputs.json) records each staged and stored identity. Nine `text eol=lf` maps were stored with LF endings, because Git would normalize the staged CRLF bytes on commit. `--finalize` now refuses any changed file that Git would not commit byte for byte. A re-capture then covered 4,249 records, 2,090 of them pinned by 457 files.

| Finalized | Value |
| --- | ---: |
| Changed records | 3,237 |
| Pinned changed records | 1,770 (exact 1,570; CRLF only 14; both 186) |
| Files holding those pins | 443 |
| Old bytes of changed records | 1,897,956,137 |
| Archived ledgers | 13 |
| Pinned files outside the scope accepted | 0 |
| Manifest SHA-256 | `48b10701d44588a28c16a70645f727fb554e379f6583b4df74bfd1274a4ff93d` |

| Area | Changed records | Pinned |
| --- | ---: | ---: |
| `geo_replication/datasets/*/processed/` | 1,739 | 1,339 |
| `data/raw/results/` | 703 | 121 |
| `public/datasets/` | 696 | 225 |
| Re-prepared inputs (`r460-inputs.json`) | 77 | 73 |
| `geo_replication/archive/*/processed/` | 17 | 12 |
| Nomenclature and `pop_meta.js` | 5 | 0 |

The tag `superseded/r441-2026-09-25` exists in the local repository; it has to be pushed with the branch for other clones to keep the pre-swap blobs reachable by name.

The readers accept current bytes that are either the recorded regeneration or a checkout's CRLF rendering of recorded LF bytes, as the `text=auto` files become on a Windows checkout with `core.autocrlf`.

### Sealed TypeScript checks

`run_sealed_ts_check.mts` serves the verified pre-regeneration bytes to every way a sealed producer reads a superseded path: `fs.readFileSync`, `fs.promises.readFile`, a descriptor from `fs.openSync` (`fs.readSync`, `fs.fstatSync`, `fs.readFileSync(fd)`), and the size reported by `fs.statSync`, `fs.lstatSync` and `fs.promises.stat`/`lstat`, which the source-authenticity readers compare with their pins before hashing. Two more routes cover what a file-read projection cannot reach:

- **Module imports.** Loader hooks (`scripts/lib/sealedModuleHooks.mts`) load a superseded JSON module, such as the internal-QC and author ledgers that `src/data/internalQc.ts` and `src/data/authorValidation.ts` import, from the same verified bytes. `data/quality/pipeline-separation-2026-09-11/audit.mts` compares the September 11 statuses through these imports.
- **Registry edits.** The registry changed with the regeneration: 128 count studies now display `CPM (TMM-normalized)` (rule C2), and GSE87544's contrast is exploratory with a corrected citation (seven units, 4 vs 3). [`registry-edits.json`](registry-edits.json) lists every changed field with its old value, new value and reason. `scripts/regen-r460/build_registry_edits.mts` derives it by evaluating `src/data/datasets.ts` at the pre-swap commit (copied from git objects) and in the checkout, refuses any difference without a reviewed reason, and pins its SHA-256 in `scripts/lib/registryEdits.mts`. The hooks load `src/data/datasets.ts` as the current registry with those edits reverted in place, only after each recorded new value is the current one and the reverted pre-swap records hash to the recorded pre-swap registry. Any other change to a pre-swap record fails the import; datasets added later are served as they are. The round-5 batch E fragment compares the registry with its pre-swap snapshot, so it needs this route.

A sealed Python producer that a sealed TypeScript check spawns as `<python> <producer> --check` (`SEALED_CHILDREN`, now `round4-d/build_fragment.py`) runs through `run_historical_check.py`, which pins it. Routed through the runner by `check:quality`, `check:validation-continuation`, `check:validation-round2` and `check:qc-separation`: the source-authenticity scoped, round-2, round-4 and round-5 audits, source recovery, the intake-numeric reader, recovered conservation, the pipeline-separation audit and the round-4 D and round-5 E fragments. `check:validation-continuation` also runs the September 11 GSE278158 author comparison (`data/internal-qc/source-recovery-2026-09-11/author-GSE278158/compare_author.py`) through `run_historical_check.py`, which serves the replaced GSE278158 DE table, counts and session record to it and, through `project_subprocess_superseded`, to its R filter replay. `check:validation-round2` runs the pinned round-2 `node:test` suites `conservation-round2-2026-09-11/conservation.test.mts` and `replication-round2-2026-09-11/glucoseReplication.test.mts` through `run_sealed_ts_check.mts`, which now lists them. `check:validation-replays` runs `source-recovery-2026-09-11/reconstruct_sources.py` through `run_historical_check.py`, because it compares its replay with the re-prepared E-MTAB-6929 input. Like `check:validation-continuation`, it rewrites tracked `fresh-check/run.log` scratch logs when R prints no locale warnings; restore them afterwards.

Source integrity for the six datasets whose sealed source-relationship readers pin a replaced file is re-derived from successor evidence: see `data/internal-qc/advancement-r460-2026-09-25/README.md` (`source-relationship-evidence.json`).

## Tests

`python scripts/test_sealed_report_check.py`, `python scripts/test_historical_check.py` and `npx tsx --test scripts/lib/historicalEvidence.test.mts` build a temporary git repository that commits pre-swap outputs, then the regeneration and a finalized manifest. They cover exact and CRLF pins, a changed regenerated file, a manifest naming another blob or rewritten old bytes, an edited manifest, an unset constant, a shallow clone, ledger changes to another dataset, to policy or to the record count, a corrupted archive, and a change during the check. They also cover descriptor reads and reported sizes, loader-served JSON modules, registry edits (an unrecorded change, a forged old value, a removed dataset) and the successor source-relationship reader.
