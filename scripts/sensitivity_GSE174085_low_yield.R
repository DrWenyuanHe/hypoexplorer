#!/usr/bin/env Rscript

# Sensitivity check for the four source-batch pseudobulks carrying a relative
# low-cell-yield watch flag. The primary analysis keeps them because the shared
# pipeline has no cell-count exclusion cutoff; this script verifies that their
# inclusion does not determine the fitted ELA effect.

suppressPackageStartupMessages({
  library(data.table)
  library(edgeR)
})

root <- "geo_replication"
dir <- file.path(root, "datasets", "GSE174085_mmus_pvn_crh_ela_scrna")
counts <- fread(file.path(dir, "raw", "GSE174085_animal_pseudobulk_counts.tsv.gz"))
samples <- fread(file.path(dir, "metadata", "GSE174085_samplesheet.tsv"))
primary <- fread(file.path(dir, "processed", "GSE174085_DE.tsv"))

l13 <- samples[sample == "L13"]
if (nrow(samples[group == "control"]) != 14L ||
    nrow(samples[group == "case"]) != 10L ||
    nrow(l13) != 1L || l13$deposited_condition != "CTL" ||
    l13$condition != "ELA" || l13$group != "case") {
  stop("author-corrected 14 control / 10 ELA metadata invariant failed")
}

fit <- function(ss) {
  genes <- counts$GeneName
  sample_cols <- ss$sample
  m <- as.matrix(counts[, ..sample_cols])
  rownames(m) <- genes
  storage.mode(m) <- "double"
  ss <- copy(ss)
  ss[, group := factor(group, levels = c("control", "case"))]
  ss[, age := factor(age, levels = c("P10", "P11", "P12"))]
  design <- model.matrix(~ age + group, data = ss)
  if (qr(design)$rank != ncol(design)) stop("sensitivity design is not full rank")
  y <- DGEList(m)
  y <- y[filterByExpr(y, design), , keep.lib.sizes = FALSE]
  y <- calcNormFactors(y)
  y <- estimateDisp(y, design)
  qlf <- glmQLFTest(glmQLFit(y, design), coef = "groupcase")
  tt <- as.data.table(topTags(qlf, n = Inf, sort.by = "none")$table, keep.rownames = "id")
  tt[, .(id, logFC, PValue)]
}

full <- fit(samples)
reduced_samples <- samples[low_cell_yield == FALSE]
if (nrow(reduced_samples[group == "control"]) != 13L ||
    nrow(reduced_samples[group == "case"]) != 7L) {
  stop("low-yield exclusion no longer leaves the pinned 13 control / 7 ELA batches")
}
reduced <- fit(reduced_samples)

primary_join <- merge(primary[, .(id, primary_logFC = logFC)], full, by = "id")
if (nrow(primary_join) < 0.99 * nrow(primary) ||
    max(abs(primary_join$primary_logFC - primary_join$logFC)) > 0.01) {
  stop("full sensitivity refit does not reproduce the committed primary effect")
}

joined <- merge(
  full,
  reduced,
  by = "id",
  suffixes = c("_full", "_without_low_yield")
)
focused <- joined[abs(logFC_full) >= 0.5 | PValue_full < 0.05]
summary <- data.table(
  metric = c(
    "primary_animals", "reduced_animals", "primary_control", "primary_case",
    "reduced_control", "reduced_case", "common_genes", "pearson_logFC",
    "spearman_logFC", "focused_genes", "focused_sign_concordance"
  ),
  value = c(
    nrow(samples), nrow(reduced_samples), nrow(samples[group == "control"]),
    nrow(samples[group == "case"]), nrow(reduced_samples[group == "control"]),
    nrow(reduced_samples[group == "case"]), nrow(joined),
    cor(joined$logFC_full, joined$logFC_without_low_yield, method = "pearson"),
    cor(joined$logFC_full, joined$logFC_without_low_yield, method = "spearman"),
    nrow(focused),
    mean(sign(focused$logFC_full) == sign(focused$logFC_without_low_yield))
  )
)

out <- file.path(dir, "processed", "GSE174085_low_yield_sensitivity.tsv")
fwrite(summary, out, sep = "\t")
print(summary)
