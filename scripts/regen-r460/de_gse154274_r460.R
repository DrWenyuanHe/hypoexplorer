#!/usr/bin/env Rscript
# GSE154274 — rat hypothalamus, offspring of PCOS-model dams versus control
# offspring, 3 versus 3 independent rats.
#
# R port of geo_replication/scripts/prep_GSE154274.py plus the limma step that
# produced processed/GSE154274_DE.tsv, so the whole route runs in the single R
# environment and follows the shared rules in scripts/lib/de_common.R.
#
# 1. Preparation (was the Python script): the official workbook stores
#    log-scale per-sample expression (its G1/G2 means and reported log2 fold
#    change are exactly reconstructible). Every pin the Python script checked is
#    checked here — byte sizes, SOFT metadata, sheet shape and header, finite
#    non-negative values, the deposited means and fold changes, unique Ensembl
#    ids, the log scale, and the pinned per-sample sums and detection counts.
#    Values are preserved as deposited; no counts are invented or rounded. It
#    writes raw/GSE154274_hypothalamus_log_expression.tsv.gz,
#    metadata/GSE154274_samplesheet.tsv and processed/GSE154274_preprocessing_qc.tsv.
# 2. DE: the registry's matrix route (run_dataset.R) for a row with
#    organism=Rattus norvegicus, id_type=ENSEMBL, id_col=Gene_ID,
#    input_kind=matrix: Ensembl ids mapped with org.Rn.eg.db, then to the final
#    public symbol, log values averaged per symbol (limma::avereps), variance
#    filter, limma lmFit/eBayes, moderated t.
#
# Run from anywhere: Rscript scripts/regen-r460/de_gse154274_r460.R
# HYPO_OUT_ROOT=<dir> writes to <dir>/GSE154274_rnor_hypo_pcos_offspring/ instead.

suppressPackageStartupMessages({ library(data.table); library(readxl); library(limma); library(edgeR) })
local({
  f <- grep("^--file=", commandArgs(FALSE), value = TRUE)
  repo <- if (length(f)) dirname(dirname(dirname(normalizePath(sub("^--file=", "", f[[1L]]))))) else getwd()
  source(file.path(repo, "scripts", "lib", "de_common.R"), local = globalenv())
  de_init(repo)
})

require_that <- function(ok, message) if (!isTRUE(ok)) stop(message, call. = FALSE)

DS <- "datasets/GSE154274_rnor_hypo_pcos_offspring"
source_path <- repo_path(file.path(DS, "raw", "GSE154274_hypothalamus_RNA-seq.xlsx"))
soft_path <- repo_path(file.path(DS, "metadata", "GSE154274_family.soft.gz"))

require_that(file.exists(source_path) && file.size(source_path) == 3974731,
             "GSE154274 hypothalamus workbook is missing or its byte size changed")
require_that(file.exists(soft_path) && file.size(soft_path) == 3720,
             "GSE154274 family SOFT is missing or its byte size changed")

samples <- data.table(
  sample = c("C10", "C11", "C12", "P10", "P11", "P12"),
  group = c("control", "control", "control", "case", "case", "case"),
  gsm = c("GSM4668275", "GSM4668276", "GSM4668277", "GSM4668278", "GSM4668279", "GSM4668280"),
  condition = c(rep("control_offspring", 3), rep("PCOS_dam_offspring", 3))
)
require_that(sum(samples$group == "control") == 3 && sum(samples$group == "case") == 3,
             "contrast is no longer three versus three independent offspring")

soft <- readLines(gzfile(soft_path), encoding = "UTF-8", warn = FALSE)
starts <- which(startsWith(soft, "^SAMPLE = "))
require_that(length(starts) == 24, "family SOFT no longer contains 24 samples")
ends <- c(starts[-1] - 1L, length(soft))
blocks <- setNames(lapply(seq_along(starts), function(i) soft[starts[i]:ends[i]]),
                   sub("^\\^SAMPLE = ", "", soft[starts]))
for (i in seq_len(nrow(samples))) {
  gsm <- samples$gsm[i]
  require_that(gsm %in% names(blocks), paste("missing SOFT block for", gsm))
  required <- c(paste0("!Sample_title = ", samples$sample[i]),
                "!Sample_source_name_ch1 = hypothalamus",
                "!Sample_characteristics_ch1 = strain background: Sprague-Dawley",
                "!Sample_characteristics_ch1 = tissue: hypothalamus",
                "!Sample_library_strategy = RNA-Seq")
  if (samples$group[i] == "case") required <- c(required, "!Sample_characteristics_ch1 = sample group: born to PCOS rats")
  require_that(all(required %in% blocks[[gsm]]), paste("SOFT metadata changed for", gsm))
}

sheets <- excel_sheets(source_path)
require_that(length(sheets) == 1, "hypothalamus workbook sheet inventory changed")
wb <- read_excel(source_path, sheet = 1, col_names = TRUE, .name_repair = "minimal")
expected_header <- c("Gene_ID", "Symbol", "description", "C10", "C11", "C12",
                     "P10", "P11", "P12", "G1", "G2", "G2_vs_G1_log2FoldChange",
                     "G2_vs_G1_Pvalue", "G2_vs_G1_FDR")
require_that(identical(names(wb), expected_header), "hypothalamus workbook header changed")
require_that(nrow(wb) == 22744 && ncol(wb) == 14, "hypothalamus workbook dimensions changed")

gene_ids <- as.character(wb$Gene_ID)
require_that(all(!is.na(gene_ids) & startsWith(gene_ids, "ENSRNOG")), "invalid Ensembl ID in workbook")
M <- as.matrix(as.data.frame(wb[, samples$sample]))
storage.mode(M) <- "double"
require_that(all(is.finite(M)) && all(M >= 0), "invalid normalized expression in workbook")
g1 <- rowMeans(M[, 1:3]); g2 <- rowMeans(M[, 4:6])
max_group_mean_delta <- max(abs(g1 - as.numeric(wb$G1)), abs(g2 - as.numeric(wb$G2)))
max_logfc_delta <- max(abs((g2 - g1) - as.numeric(wb$G2_vs_G1_log2FoldChange)))
require_that(!anyDuplicated(gene_ids), "workbook gene IDs are duplicated or row count changed")
require_that(max_group_mean_delta < 1e-10 && max_logfc_delta < 1e-10,
             "deposited G1/G2 means or log2 fold changes no longer reconstruct")
require_that(max(M) < 30, "workbook no longer has the expected log-expression scale")

expected_sums <- c(154924.20020400337, 153029.45933394608, 154390.4491857358,
                   154874.95768105963, 154213.59750029887, 154332.62728526065)
expected_detected <- c(19877, 19394, 19957, 19623, 19924, 19806)
observed_sums <- colSums(M); observed_detected <- colSums(M > 0)
require_that(max(abs(observed_sums - expected_sums)) < 1e-8 && all(observed_detected == expected_detected),
             "pinned log-expression sums or detection counts changed")

matrix_path <- overlay_output_path(file.path(DS, "raw", "GSE154274_hypothalamus_log_expression.tsv.gz"))
write_tsv_lf(data.table(Gene_ID = gene_ids, as.data.table(M)), matrix_path, compress = "gzip")
ss_path <- overlay_output_path(file.path(DS, "metadata", "GSE154274_samplesheet.tsv"))
write_tsv_lf(samples, ss_path)
proc <- dataset_output_dir(DS, "processed")
write_tsv_lf(data.table(sample = samples$sample, group = samples$group, gsm = samples$gsm,
                  source_gene_rows = length(gene_ids), log_expression_sum = observed_sums,
                  detected_genes = observed_detected, min_log_expression = apply(M, 2, min),
                  max_log_expression = apply(M, 2, max), nonfinite_values = colSums(!is.finite(M)),
                  negative_values = colSums(M < 0), identity_transform_delta = 0,
                  group_mean_max_abs_delta = max_group_mean_delta, logfc_max_abs_delta = max_logfc_delta,
                  metadata_match = TRUE, analysis_keep = TRUE),
       file.path(proc, "GSE154274_preprocessing_qc.tsv"))
cat(sprintf("GSE154274 prepared: %d genes x %d independent rats; control=3 PCOS-offspring=3; limma matrix\n",
            length(gene_ids), nrow(samples)))

# ---- DE: the registry matrix route (run_dataset.R) ---------------------------
r <- data.frame(id = "GSE154274", dir = DS, organism = "Rattus norvegicus", id_type = "ENSEMBL",
                id_col = "Gene_ID", id_map = "NA", input_kind = "matrix",
                input_path = file.path(DS, "raw", "GSE154274_hypothalamus_log_expression.tsv.gz"),
                samplesheet = file.path(DS, "metadata", "GSE154274_samplesheet.tsv"),
                batch_var = "NA", status = "ready", stringsAsFactors = FALSE)
prep <- prepare_config_dataset(r)
res <- run_config_de(prep)
out <- write_config_outputs(prep, res, "GSE154274", proc, generators = de_script_path(),
                            extra_inputs = c(workbook = source_path, soft = soft_path))
cat(sprintf("  features: %d raw -> %d symbols (%d unmapped, kept in the fit); DE: %d genes, %d FDR<0.05\n",
            prep$agg$n_features_raw, prep$agg$n_symbols_after_aggregation, prep$agg$n_unmapped_in_fit,
            nrow(out$de), sum(out$de$padj < 0.05)))
