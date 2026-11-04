#!/usr/bin/env Rscript
# Cross-check the explorer's 72-hour-fasted versus fed effect against the
# author-deposited adjacent edgeR contrasts. GEO does not provide a direct
# 72h-vs-fed table, but the coefficient is exactly reconstructable:
#
#   (72h - fed) = -(fed - 24h) + (72h - 24h)
#
# P-values/FDR are NOT reconstructable from two separately fitted contrasts,
# so this script intentionally validates only the effect coefficient.

script <- grep("^--file=", commandArgs(FALSE), value = TRUE)
ROOT <- normalizePath(file.path(dirname(sub("^--file=", "", script[1L])), ".."))
mine <- read.delim(file.path(
  ROOT, "datasets/GSE294478_mmus_hypothalamus_fasting/processed/GSE294478_DE.tsv"
), stringsAsFactors = FALSE)
fed24 <- read.delim(gzfile(file.path(
  ROOT, "datasets/_author_de/GSE294478_Fedvs24hrFD_EdgeR.txt.gz"
)), stringsAsFactors = FALSE)
day24to72 <- read.delim(gzfile(file.path(
  ROOT, "datasets/_author_de/GSE294478_24hrFDvs72hrFD_EdgeR.txt.gz"
)), stringsAsFactors = FALSE)

author <- merge(
  fed24[, c("ensembl_gene_id", "logFC")],
  day24to72[, c("ensembl_gene_id", "logFC")],
  by = "ensembl_gene_id", suffixes = c("_fed_minus_24h", "_72h_minus_24h")
)
author$logFC_72h_minus_fed <- -author$logFC_fed_minus_24h + author$logFC_72h_minus_24h
m <- merge(
  mine[, c("id", "symbol", "logFC")], author,
  by.x = "id", by.y = "ensembl_gene_id"
)
m <- m[is.finite(m$logFC) & is.finite(m$logFC_72h_minus_fed), ]

cat(sprintf("shared genes: %d\n", nrow(m)))
cat(sprintf(
  "reconstructed logFC Pearson=%.6f Spearman=%.6f\n",
  cor(m$logFC, m$logFC_72h_minus_fed),
  cor(m$logFC, m$logFC_72h_minus_fed, method = "spearman")
))
strong <- m[abs(m$logFC_72h_minus_fed) >= 0.5, ]
cat(sprintf(
  "direction concordance for reconstructed |author logFC|>=0.5 (n=%d): %.2f%%\n",
  nrow(strong),
  100 * mean(sign(strong$logFC) == sign(strong$logFC_72h_minus_fed))
))
cat("P-values and adjusted p-values cannot be reconstructed from adjacent contrasts.\n")
