# Bounded SCN model sensitivities. Does not change production counts or outputs.
# No-ZT model follows the reported mean-expression comparison; legacy QL tests
# old edgeR-style fitting without asserting an exact historical version rerun.
suppressPackageStartupMessages({ library(edgeR); library(readxl) })
arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
root <- normalizePath(file.path(dirname(sub("^--file=", "", arg)), ".."))
ds <- file.path(root, "geo_replication/datasets/GSE190389_mmus_scn_trf")
out <- file.path(root, "data/author-validation/continued-sources/GSE190389")
input <- read.delim(gzfile(file.path(ds, "raw/GSE190389_SCN_TRF_vs_ALF_count_estimates.tsv.gz")), check.names = FALSE)
sheet <- read.delim(file.path(ds, "metadata/GSE190389_samplesheet.tsv"))
local <- read.delim(file.path(ds, "processed/GSE190389_DE.tsv"))
author <- as.data.frame(read_excel(file.path(root, "data/author-validation/continued-sources/GSE190389_DE_workbook.xlsx"), sheet = "SCN"))
names(author)[names(author) == "external_gene_name"] <- "symbol"
names(author)[names(author) == "logFC (TRF/ALF)"] <- "author_logFC"
names(author)[names(author) == "FDR"] <- "author_FDR"
valid <- !is.na(author$symbol) & nzchar(author$symbol)
unique <- valid & !duplicated(author$symbol) & !duplicated(author$symbol, fromLast = TRUE)
author_unique <- author[unique, ]
M <- as.matrix(input[, sheet$sample]); rownames(M) <- input$symbol
stopifnot(nrow(M) == 24535, ncol(M) == 45, !anyDuplicated(rownames(M)),
          all(is.finite(M)), all(M >= 0), !anyDuplicated(sheet$sample),
          sum(sheet$group == "control") == 23, sum(sheet$group == "case") == 22)
sheet$group <- factor(sheet$group, levels = c("control", "case"))
sheet$zt <- factor(sheet$zt)
settings <- data.frame(
  name = c("registered_ZT_currentQL", "noZT_currentQL", "noZT_legacyQL", "noZT_observed_author_universe_legacyQL"),
  adjust_zt = c(TRUE, FALSE, FALSE, FALSE),
  legacy = c(FALSE, FALSE, TRUE, TRUE),
  author_universe = c(FALSE, FALSE, FALSE, TRUE))
outputs <- list(); summaries <- list()
for (i in seq_len(nrow(settings))) {
  spec <- settings[i, ]
  design <- if (spec$adjust_zt) model.matrix(~zt + group, sheet) else model.matrix(~group, sheet)
  y <- DGEList(counts = M)
  keep <- if (spec$author_universe) rownames(M) %in% author_unique$symbol & rowSums(M) > 0 else filterByExpr(y, design)
  y <- calcNormFactors(y[keep, , keep.lib.sizes = FALSE])
  y <- estimateDisp(y, design)
  fit <- glmQLFit(y, design, legacy = spec$legacy)
  tt <- topTags(glmQLFTest(fit, coef = "groupcase"), n = Inf, sort.by = "none")$table
  tt$symbol <- rownames(tt)
  tt$fit <- spec$name
  tt$significant_author_rule <- tt$FDR <= .05 & tt$logCPM > 0
  if (spec$name == "registered_ZT_currentQL") {
    check <- merge(tt, local, by = "symbol", suffixes = c("_refit", "_local"))
    stopifnot(nrow(check) == nrow(local), nrow(tt) == nrow(local))
    baseline <- data.frame(edgeR_version = as.character(packageVersion("edgeR")),
      matched_rows = nrow(check),
      maximum_logFC_difference = max(abs(check$logFC_refit-check$logFC_local)),
      maximum_FDR_difference = max(abs(check$FDR-check$padj)),
      effect_pearson = cor(check$logFC_refit, check$logFC_local))
    write.table(baseline, file.path(out, "registered_model_reproduction.tsv"), sep = "\t", row.names = FALSE, quote = FALSE)
    print(baseline)
  }
  joined <- merge(author_unique, tt, by = "symbol", suffixes = c("_author", "_refit"))
  sig <- joined$author_FDR <= .05 & joined$logCPM_author > 0
  agreement <- sign(joined$author_logFC) == sign(joined$logFC)
  summaries[[i]] <- data.frame(fit = spec$name, edgeR_version = as.character(packageVersion("edgeR")),
      biological_samples = ncol(M), tested_genes = nrow(tt), significant_FDR_lt_005 = sum(tt$FDR <= .05),
      significant_author_rule = sum(tt$significant_author_rule), shared_exact_symbols = nrow(joined),
      effect_pearson = cor(joined$author_logFC, joined$logFC),
      effect_spearman = cor(joined$author_logFC, joined$logFC, method = "spearman"),
      effect_median_absolute_difference = median(abs(joined$logFC-joined$author_logFC)),
      effect_max_absolute_difference = max(abs(joined$logFC-joined$author_logFC)),
      shared_direction_matches = sum(agreement), shared_author_significant = sum(sig),
      author_significant_direction_matches = sum(agreement[sig]),
      both_significant_author_rule = sum(sig & joined$significant_author_rule))
  print(summaries[[i]])
  outputs[[i]] <- joined
}
write.table(do.call(rbind, summaries), file.path(out, "model_sensitivity.summary.tsv"), sep = "\t", row.names = FALSE, quote = FALSE)
write.table(do.call(rbind, outputs), file.path(out, "model_sensitivity.per-gene.tsv"), sep = "\t", row.names = FALSE, quote = FALSE)
writeLines(capture.output(sessionInfo()), file.path(out, "model_sensitivity.sessionInfo.txt"))
cat("Registered-model numerical reproduction is reported, not presumed; all sensitivities remain separate. No count scaling or invented exclusions.\n")
