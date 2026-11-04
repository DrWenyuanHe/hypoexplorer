# Evidence-only, predeclared two-input sensitivity. See the adjacent PLAN.md.
suppressPackageStartupMessages({library(DESeq2); library(jsonlite)})
options(stringsAsFactors = FALSE, digits = 17)
root <- normalizePath(getwd(), winslash = "/", mustWork = TRUE)
out <- file.path(root, "data/author-validation/continued-sources/five-dataset-followup-2026-09-04/GSE292416")
stopifnot(dir.exists(out))
inputs <- c(
  raw = file.path(root, "geo_replication/datasets/GSE292416_mmus_arc_pnoc_bactrap/raw/GSE292416_salmon.merged.gene_counts.tsv.gz"),
  scaled = file.path(out, "GSE292416_salmon.merged.gene_counts_scaled.tsv.gz")
)
samples <- c(paste0("Pnoc_LepR_WT_Pulldown_", 1:4), paste0("Pnoc_LepR_KO_Pulldown_", 5:8))
meta <- data.frame(row.names = samples, genotype = factor(rep(c("WT", "KO"), each = 4), levels = c("WT", "KO")))
write.table(data.frame(sample = samples, genotype = meta$genotype, biological_pool = 1:8, animals_per_pool = 4),
            file.path(out, "fit-samples.tsv"), sep = "\t", quote = FALSE, row.names = FALSE)
fitMeta <- list()
for (label in names(inputs)) {
  cat("Fitting", label, "IP-only DESeq2 ~ genotype\n")
  x <- read.delim(gzfile(inputs[[label]]), check.names = FALSE)
  stopifnot(all(c("gene_id", "gene_name", samples) %in% colnames(x)), !anyDuplicated(x$gene_id))
  counts <- as.matrix(x[, samples, drop = FALSE])
  stopifnot(all(is.finite(counts)), all(counts >= 0))
  rownames(counts) <- x$gene_id
  rounded <- round(counts)
  active <- rowSums(rounded) > 0
  dds <- DESeqDataSetFromMatrix(rounded[active, , drop = FALSE], meta, ~ genotype)
  dds <- DESeq(dds, test = "Wald", fitType = "parametric", betaPrior = FALSE, quiet = TRUE)
  exported <- data.frame(ensembl_gene_id = x$gene_id, external_gene_name = x$gene_name)
  runMeta <- list(source_rows = nrow(x), model_rows = sum(active), all_zero_rows = sum(!active),
                  fractional_source_values = sum(abs(counts - round(counts)) > 1e-8),
                  design = "~ genotype", contrast = "KO minus WT within IP", sample_order = samples,
                  normalization = "median ratio", LFC_shrinkage = "none", count_transform = "round once to integer",
                  length_offsets = "not supplied", size_factors = as.list(sizeFactors(dds)), filters = list())
  for (alpha in c(.1, .05, .01)) {
    suffix <- gsub("\\.", "p", as.character(alpha))
    res <- results(dds, contrast = c("genotype", "KO", "WT"), alpha = alpha, independentFiltering = TRUE)
    if (alpha == .1) {
      for (col in c("baseMean", "log2FoldChange", "lfcSE", "stat", "pvalue"))
        exported[[col]] <- res[[col]][match(x$gene_id, rownames(res))]
      exported$dispersion <- dispersions(dds)[match(x$gene_id, rownames(dds))]
    }
    exported[[paste0("padj_alpha_", suffix)]] <- res$padj[match(x$gene_id, rownames(res))]
    runMeta$filters[[suffix]] <- list(alpha = alpha, finite_padj = sum(is.finite(res$padj)),
      calls_0p05 = sum(res$padj <= .05, na.rm = TRUE), calls_0p01 = sum(res$padj <= .01, na.rm = TRUE),
      filter_threshold = unname(metadata(res)$filterThreshold), filter_theta = unname(metadata(res)$filterTheta))
  }
  write.table(exported, file.path(out, paste0("refit-", label, "-IP-only.tsv")),
              sep = "\t", quote = FALSE, row.names = FALSE, na = "NA")
  fitMeta[[label]] <- runMeta
}
write_json(list(schemaVersion = 1, date = "2026-09-04", R_version = R.version.string,
  DESeq2_version = as.character(packageVersion("DESeq2")), historical_author_DESeq2 = "1.38.3",
  warning = "Separate evidence-only models; the registered edgeR-QL result is unchanged. Historical formula/filter/offset/shrinkage choices are not established.",
  fits = fitMeta), file.path(out, "fit-metadata.json"), pretty = TRUE, auto_unbox = TRUE, digits = NA, na = "null")
writeLines(capture.output(sessionInfo()), file.path(out, "R-sessionInfo.txt"))
