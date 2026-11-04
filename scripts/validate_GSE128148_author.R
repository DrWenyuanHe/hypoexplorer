# Author-result audit for GSE128148. Does not edit the registered edgeR pipeline.
# The official normalized_outliers_excluded file includes gene-wide DESeq2 results.
# Author DESeq2 version is not specified in the inspected paper; report current version.
# Run from any directory: Rscript scripts/validate_GSE128148_author.R
suppressPackageStartupMessages(library(DESeq2))
file_arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
root <- normalizePath(file.path(dirname(sub("^--file=", "", file_arg)), ".."))
dataset <- file.path(root, "geo_replication/datasets/GSE128148_mmus_arc_corticosterone")
out <- file.path(root, "data/author-validation/continued-sources/GSE128148")
dir.create(out, recursive = TRUE, showWarnings = FALSE)
raw <- read.delim(gzfile(file.path(dataset, "raw/GSE128148_2019_Wray_4week_raw_counts.txt.gz")), check.names = FALSE, row.names = 1)
author <- read.delim(gzfile(file.path(dataset, "metadata/GSE128148_2019_Wray_4week_normalised_outliers_excluded.txt.gz")), check.names = FALSE)
sheet <- read.delim(file.path(dataset, "metadata/GSE128148_samplesheet.tsv"))
prepared <- read.delim(gzfile(file.path(dataset, "processed/GSE128148_analysis_matrix.tsv.gz")), check.names = FALSE)
local <- read.delim(file.path(dataset, "processed/GSE128148_DE.tsv"))
stopifnot(all(c("gene_id", "symbol", "baseMean", "log2FoldChange", "pvalue", "padj") %in% names(author)),
          !anyDuplicated(author$gene_id), !anyDuplicated(rownames(raw)), !anyDuplicated(local$id))
samples <- sheet$sample[sheet$analysis_keep]
stopifnot(identical(samples, grep("^SLX", names(author), value = TRUE)),
          identical(sheet$group[sheet$analysis_keep], c(rep("control", 3), rep("case", 4))),
          identical(prepared$gene_id, rownames(raw)), identical(author$gene_id, rownames(raw)))
counts <- as.matrix(raw[, samples])
stopifnot(all(counts >= 0), all(counts == round(counts)), all(is.finite(counts)),
          identical(unname(counts), unname(as.matrix(prepared[, samples]))))
storage.mode(counts) <- "integer"
coldata <- data.frame(group = factor(c(rep("control", 3), rep("case", 4)), levels = c("control", "case")), row.names = samples)
published <- data.frame(symbol = c("Fam43a", "Fam107a", "Fam13a", "Scly", "Npy", "Gpr12"),
                        figure_padj = c(9.54e-8, 4.63e-4, .0073, .014, 1.75e-7, .071))
cat("DESeq2 version:", as.character(packageVersion("DESeq2")), "\n")
cat("Exact source/prepared count equality:", nrow(counts), "genes x", ncol(counts), "samples\n")
cat("Author FDR<0.1:", sum(author$padj < .1, na.rm = TRUE), "up", sum(author$padj < .1 & author$log2FoldChange > 0, na.rm = TRUE),
    "down", sum(author$padj < .1 & author$log2FoldChange < 0, na.rm = TRUE), "\n")
cat("Local edgeR FDR<0.1:", sum(local$padj < .1, na.rm = TRUE), "of", nrow(local), "tested\n")

metric <- function(a, b) {
  ok <- is.finite(a) & is.finite(b)
  c(n = sum(ok), pearson = cor(a[ok], b[ok]), spearman = cor(a[ok], b[ok], method = "spearman"),
    median_absolute_difference = median(abs(a[ok]-b[ok])), max_absolute_difference = max(abs(a[ok]-b[ok])))
}
source_local <- merge(author[, c("gene_id", "symbol", "log2FoldChange", "pvalue", "padj")],
                      local, by.x = "gene_id", by.y = "id", suffixes = c("_author", "_local"), all.x = TRUE)
source_local$local_tested <- !is.na(source_local$logFC)
source_local$direction_match <- sign(source_local$log2FoldChange) == sign(source_local$logFC)
write.table(source_local, file.path(out, "author_vs_local.generated.tsv"), sep = "\t", row.names = FALSE, quote = FALSE)
cat("Author-vs-local effects:"); print(metric(source_local$log2FoldChange, source_local$logFC))
author_sig <- subset(source_local, !is.na(padj_author) & padj_author < .1)
cat("Author significant rows:", nrow(author_sig), "locally tested", sum(author_sig$local_tested),
    "direction agreements", sum(author_sig$direction_match, na.rm = TRUE),
    "also local FDR<.1", sum(author_sig$padj_local < .1, na.rm = TRUE), "\n")

summaries <- list()
comparisons <- list()
for (scope in c("all_source_genes", "local_tested_universe_sensitivity", "all_source_beta_prior_sensitivity")) {
  # Primary uses all author-deposited genes; no undocumented low-count threshold.
  # The second fit controls for the registered pipeline's gene universe only.
  selected <- if (scope == "local_tested_universe_sensitivity") rownames(counts) %in% local$id else rep(TRUE, nrow(counts))
  dds <- DESeqDataSetFromMatrix(counts[selected, , drop = FALSE], coldata, ~group)
  # The author version/settings are unknown. This explicitly labelled sensitivity
  # tests prior-shrunk Wald coefficients, not an assertion that authors enabled it.
  dds <- DESeq(dds, quiet = TRUE, betaPrior = scope == "all_source_beta_prior_sensitivity")
  for (filter in c(TRUE, FALSE)) {
    r <- as.data.frame(results(dds, contrast = c("group", "case", "control"), alpha = .1, independentFiltering = filter))
    r$gene_id <- rownames(r)
    comp <- merge(author[, c("gene_id", "symbol", "baseMean", "log2FoldChange", "pvalue", "padj")], r,
                  by = "gene_id", suffixes = c("_author", "_refit"))
    comp$scope <- scope
    comp$independentFiltering <- filter
    comparisons[[paste(scope, filter)]] <- comp
    summary <- data.frame(scope = scope, independentFiltering = filter,
        DESeq2_version = as.character(packageVersion("DESeq2")), genes_in_fit = nrow(r),
        nonNA_padj = sum(!is.na(r$padj)), FDR_lt_01 = sum(r$padj < .1, na.rm = TRUE),
        FDR_lt_01_up = sum(r$padj < .1 & r$log2FoldChange > 0, na.rm = TRUE),
        FDR_lt_01_down = sum(r$padj < .1 & r$log2FoldChange < 0, na.rm = TRUE),
        FDR_lt_005 = sum(r$padj < .05, na.rm = TRUE),
        effect_pearson = cor(comp$log2FoldChange_author, comp$log2FoldChange_refit, use = "complete.obs"),
        effect_max_absolute_difference = max(abs(comp$log2FoldChange_author - comp$log2FoldChange_refit), na.rm = TRUE),
        padj_max_absolute_difference = max(abs(comp$padj_author - comp$padj_refit), na.rm = TRUE))
    summaries[[paste(scope, filter)]] <- summary
    print(summary)
  }
  if (scope == "all_source_genes") {
    normalized <- counts(dds, normalized = TRUE)
    normalization <- data.frame(sample = samples, current_DESeq2_size_factor = sizeFactors(dds))
    for (i in seq_along(samples)) {
      good <- counts[, i] > 0 & author[[samples[i]]] > 0
      inferred <- counts[good, i] / author[[samples[i]]][good]
      normalization$author_inferred_size_factor[i] <- median(inferred)
      normalization$ratio_range[i] <- diff(range(inferred))
      normalization$max_normalized_count_difference[i] <- max(abs(normalized[, i] - author[[samples[i]]]))
    }
    write.table(normalization, file.path(out, "normalization_comparison.generated.tsv"), sep = "\t", row.names = FALSE, quote = FALSE)
    print(normalization)
  }
}
all_comparisons <- do.call(rbind, comparisons)
write.table(all_comparisons, file.path(out, "author_vs_DESeq2.generated.tsv"), sep = "\t", row.names = FALSE, quote = FALSE)
write.table(do.call(rbind, summaries), file.path(out, "DESeq2_sensitivity.generated.tsv"), sep = "\t", row.names = FALSE, quote = FALSE)
six <- merge(published, all_comparisons, by = "symbol")
six <- merge(six, local[, c("id", "logFC", "padj")], by.x = "gene_id", by.y = "id", all.x = TRUE)
write.table(six, file.path(out, "figure2_six_genes.generated.tsv"), sep = "\t", row.names = FALSE, quote = FALSE)
print(six[, c("symbol", "scope", "independentFiltering", "figure_padj", "padj_author", "padj_refit", "padj")], row.names = FALSE)
writeLines(capture.output(sessionInfo()), file.path(out, "sessionInfo.txt"))
cat("No analysis pipeline or verification status changed. Interpret full table and figure separately.\n")
