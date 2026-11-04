# GSE234483 author-method sensitivity analysis. This is not a declaration that
# the author's 1,407-DEG result has been reproduced. The paper specifies DESeq2
# 1.20.0 but does not supply its exact DEG rule, full results, or analysis code.
# Run: Rscript scripts/validate_GSE234483_author.R
# The primary fit uses the paper's 4-month, one-week, 5-control/4-Gly-Low cohort.
# A separate sensitivity fit estimates dispersion across all five deposited
# cohorts, still extracting the identical acute Gly-Low-minus-control contrast.

suppressPackageStartupMessages(library(DESeq2))
stopifnot(packageVersion("DESeq2") == package_version("1.52.0"))

file_arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
stopifnot(length(file_arg) == 1L)
root <- normalizePath(file.path(dirname(sub("^--file=", "", file_arg)), ".."))
dataset <- file.path(root, "geo_replication/datasets/GSE234483_mmus_hypo_glylow")
source_path <- file.path(dataset, "raw/GSE234483_GEO_rawCounts.txt.gz")
source <- read.delim(gzfile(source_path), check.names = FALSE)
clean <- read.delim(gzfile(file.path(dataset, "raw/GSE234483_counts_clean.tsv.gz")),
                   check.names = FALSE)
sheet <- read.delim(file.path(dataset, "metadata/GSE234483_samplesheet.tsv"))
# GEO's extra unlabeled row-number field becomes character row names in R;
# the cleaned TSV omits that redundant field. Gene IDs and counts must match.
rownames(source) <- NULL
rownames(clean) <- NULL
stopifnot(identical(source, clean), nrow(source) == 54532L, ncol(source) == 21L,
          !anyDuplicated(source$gene_id),
          identical(sheet$sample, c(paste0("ContHyp_", 1:5), paste0("GlyLowHyp_", 1:4))),
          identical(sheet$group, c(rep("control", 5), rep("case", 4))))

counts <- as.matrix(source[, -1L])
rownames(counts) <- source$gene_id
stopifnot(all(is.finite(counts)), all(counts >= 0), all(counts == round(counts)))
storage.mode(counts) <- "integer"
cohort <- ifelse(grepl("^YoungHyp", colnames(counts)), "young_3mo_control",
          ifelse(grepl("^ContHyp", colnames(counts)), "acute_control",
          ifelse(grepl("^GlyLowHyp", colnames(counts)), "acute_glylow",
          ifelse(grepl("^OldConHyp", colnames(counts)), "old_control", "old_glylow"))))
stopifnot(identical(as.integer(table(factor(cohort, levels = c("young_3mo_control",
          "acute_control", "acute_glylow", "old_control", "old_glylow")))),
          c(4L, 5L, 4L, 4L, 3L)))

summarize_result <- function(result, fit, filter, alpha) {
  do.call(rbind, lapply(c(0.01, 0.05, 0.1), function(fdr) {
    do.call(rbind, lapply(c(0, log2(1.5), 1), function(min_lfc) {
      sig <- !is.na(result$padj) & result$padj < fdr &
        abs(result$log2FoldChange) > min_lfc
      data.frame(fit, independent_filtering = filter, filter_alpha = alpha,
        fdr_threshold = fdr, min_abs_log2fc = min_lfc,
        n_tested = sum(!is.na(result$pvalue)), n_adjusted = sum(!is.na(result$padj)),
        n_de = sum(sig), n_up = sum(sig & result$log2FoldChange > 0),
        n_down = sum(sig & result$log2FoldChange < 0))
    }))
  }))
}

summaries <- list()
primary_result <- NULL
primary_normalized_counts <- NULL
for (fit in c("acute_9_samples", "all_20_samples_5_cohorts")) {
  selected <- if (fit == "acute_9_samples") colnames(counts) %in% sheet$sample else
    rep(TRUE, ncol(counts))
  col_data <- data.frame(cohort = factor(cohort[selected]),
                         row.names = colnames(counts)[selected])
  dds <- DESeqDataSetFromMatrix(counts[, selected], col_data, design = ~ cohort)
  dds <- DESeq(dds, quiet = TRUE)
  for (filter in c(TRUE, FALSE)) {
    for (alpha in if (filter) c(0.05, 0.1) else 0.1) {
      result <- results(dds, contrast = c("cohort", "acute_glylow", "acute_control"),
                        independentFiltering = filter, alpha = alpha)
      summaries[[length(summaries) + 1L]] <- summarize_result(result, fit, filter, alpha)
      if (fit == "acute_9_samples" && filter && alpha == 0.05) {
        primary_result <- result
        primary_normalized_counts <- counts(dds, normalized = TRUE)
      }
    }
  }
}
summary <- do.call(rbind, summaries)
cat("# DESeq2 version: ", as.character(packageVersion("DESeq2")), "\n", sep = "")
cat("# GSE234483 source and clean matrices are identical: 54,532 genes x 20 samples.\n")
cat("# Primary contrast: four-month, one-week Gly-Low minus control, 4 vs 5 mice.\n")
write.table(summary, stdout(), sep = "\t", row.names = FALSE, quote = FALSE)

# Existing explorer edgeR results give a useful independent concordance check.
edger <- read.delim(file.path(dataset, "processed/GSE234483_DE.tsv"), check.names = FALSE)
author <- read.delim(file.path(root, "data/author-validation/continued-sources/GSE234483",
                              "figure3_author_effects.generated.tsv"))
stopifnot(nrow(author) == 32L, !anyDuplicated(author$symbol))
# MGI:1353494 renamed Akr1b3 to Akr1b1; the repository's nomenclature table
# retains the old symbol as a previous symbol for that same gene.
current_symbol <- ifelse(author$symbol == "Akr1b3", "Akr1b1", author$symbol)
matched <- match(current_symbol, edger$symbol)
stopifnot(!anyNA(matched), !anyDuplicated(edger$id[matched]))
ids <- edger$id[matched]
author_values <- as.matrix(author[, paste0("GL", 1:4)])
author_mean <- rowMeans(author_values)
comparison <- data.frame(symbol = author$symbol, id = ids, figure = author$figure,
  author_mean_log2fc = author_mean, deseq2_log2fc = primary_result[ids, ]$log2FoldChange,
  edger_log2fc = edger$logFC[matched], deseq2_padj = primary_result[ids, ]$padj,
  edger_padj = edger$padj[matched])
cat("# Author Figure 3A/B mean log effects versus reanalysis (different estimands).\n")
write.table(comparison, stdout(), sep = "\t", row.names = FALSE, quote = FALSE)
cat(sprintf("# Figure3 effect concordance: DESeq2 Pearson %.9f; edgeR Pearson %.9f; directions %d/%d.\n",
  cor(comparison$author_mean_log2fc, comparison$deseq2_log2fc),
  cor(comparison$author_mean_log2fc, comparison$edger_log2fc),
  sum(sign(comparison$author_mean_log2fc) == sign(comparison$edger_log2fc)), nrow(comparison)))
normalized_effects <- log2(primary_normalized_counts[ids, paste0("GlyLowHyp_", 1:4)] /
  rowMeans(primary_normalized_counts[ids, paste0("ContHyp_", 1:5)]))
cat(sprintf("# Per-sample log2(normalized count / mean control) vs author: Pearson %.9f; max absolute delta %.9f.\n",
  cor(as.numeric(author_values), as.numeric(normalized_effects)),
  max(abs(author_values - normalized_effects))))
output_dir <- file.path(root, "data/author-validation/continued-sources/GSE234483")
write.table(summary, file.path(output_dir, "deseq2_sensitivity.generated.tsv"),
            sep = "\t", row.names = FALSE, quote = FALSE)
write.table(comparison, file.path(output_dir, "figure3_comparison.generated.tsv"),
            sep = "\t", row.names = FALSE, quote = FALSE)
cat("# Classification: REVIEW REQUIRED; count concordance requires the missing author DEG rule/table.\n")
cat("# R session\n")
print(sessionInfo())
