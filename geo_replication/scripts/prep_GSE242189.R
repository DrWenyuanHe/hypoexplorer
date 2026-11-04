#!/usr/bin/env Rscript
# =============================================================================
# Assemble a gene-level count matrix for GSE242189 (offspring hypothalamus,
# perinatal hypercaloric-diet exposure, MALE arm).
#
# GSE242189 is a SuperSeries (Elgazzaz/Lazartigues, LSUHSC) of
#   GSE242186  RRBS / Bisulfite-Seq   (the 1.5 GB *_RAW.tar of .cov.gz files)
#   GSE242187  total mRNA-seq         <- the block replicated here
#   GSE242188  QIAseq miRNA           (xlsx only)
# The SuperSeries' own suppl/ carries ONLY the methylation .cov.gz files, and every
# RNA-seq GSM has !Sample_supplementary_file_1 = "NONE"; the processed RNA counts
# live in the GSE242187 subseries as four per-comparison DESeq exports, each holding
# the two arms of one pre-defined pairwise comparison.
#
# Each export is raw integer, symbol-keyed, 24421 genes, columns "<n>Mona_totalmRNAseq",
# and all four share one identical gene universe in identical row order.
#
# 2x2 design (dam diet - offspring-after-weaning diet), hypothalamus at 3 months:
#   3A/3B HCD-HCD   4A/4B HCD-RD   5A/5B RD-HCD   6A/6B RD-RD      (A = male, B = female)
# Column-block -> arm mapping, established from GEO metadata:
#   file 5A_vs_3A : {25,26,27}=5A RD-HCD Male   {13,14,15}=3A HCD-HCD Male
#   file 6A_vs_4A : {31,32,33}=6A RD-RD  Male   {19,20,21}=4A HCD-RD  Male
#   file 5B_vs_3B : {28,29,30}=5B RD-HCD Fem    {16,17,18}=3B HCD-HCD Fem
#   file 6B_vs_4B : {35,36,37}=6B RD-RD  Fem    {22,23,24}=4B HCD-RD  Fem
# confirmed by (a) !Sample_description, which names the export each GSM belongs to,
# (b) the monotone GEO sample order 3A,3B,4A,4B,5A,5B,6A,6B over contiguous library
# numbers 13..37, (c) Xist/Ddx3y sexing (A blocks male, B female, matching
# !Sample_source_name_ch1), and (d) cor(res$log2FoldChange, log2(2nd block / 1st
# block)) = +0.99 / +0.90, i.e. the first-named group is the DESeq reference.
#
# Contrast built: hypothalamus, C57BL/6J, WT, 3 months old, MALE offspring, all of
# them on HCD after weaning, so the single varying factor is the perinatal exposure:
#   control = 5A  "Perinatal RD and postnatal HCD"   (RD dam)
#   case    = 3A  "Perinatal and postnatal HCD"      (HCD dam)
# 3 vs 3 independent animals, libraries 23.6-34.4 M, all pairwise logCPM r >= 0.92,
# common BCV 0.30 -- the only technically sound pair in the Series.
#
# NOT USED, and why (QC on the public counts, filterByExpr + TMM + logCPM):
#   6A vs 4A male  -- the RD-RD control arm is incoherent: within-control r = 0.69
#                     (vs 0.97 within case), two of its three libraries are 5.4 M and
#                     7.3 M with only 10.6k/11.9k genes detected, and those two shallow
#                     libraries are what drives MDS dim1. Depth is confounded with
#                     group; common BCV 0.81. This kills every RD-RD-controlled male
#                     contrast, including a merged 6A-vs-3A.
#   5B vs 3B female -- library 29 is a severe outlier (8.5 M, r ~ 0.82 to all others).
#   6B vs 4B female -- usable (BCV 0.36) but the paper's effect is male-predominant.
#
# Usage:  Rscript scripts/prep_GSE242189.R
# =============================================================================

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value=TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS   <- file.path(ROOT, "datasets", "GSE242189_mmus_hypo_perinatal_hcd")
SRC  <- file.path(DS, "raw", "GSE242187_5A_vs_3A_control_vs_comparison.deseq.counts.csv.gz")

samples <- data.frame(
  col   = c("25Mona_totalmRNAseq","26Mona_totalmRNAseq","27Mona_totalmRNAseq",
            "13Mona_totalmRNAseq","14Mona_totalmRNAseq","15Mona_totalmRNAseq"),
  name  = c("PeriRD_M_25","PeriRD_M_26","PeriRD_M_27",
            "PeriHCD_M_13","PeriHCD_M_14","PeriHCD_M_15"),
  group = c("control","control","control","case","case","case"),
  stringsAsFactors = FALSE)

cts <- read.csv(gzfile(SRC), row.names = 1, check.names = FALSE)
stopifnot(all(samples$col %in% colnames(cts)), ncol(cts) == nrow(samples))
cat(sprintf("[GSE242189] %d genes x %d libraries in %s\n", nrow(cts), ncol(cts), basename(SRC)))

M <- as.matrix(cts[, samples$col, drop = FALSE]); colnames(M) <- samples$name
stopifnot(all(M == round(M)), !any(is.na(M)), all(M >= 0))     # raw integer counts
cat("[GSE242189] integer check passed; library sizes (M reads):\n")
print(round(colSums(M) / 1e6, 2))

out  <- data.frame(symbol = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
outp <- file.path(DS, "raw", "GSE242189_hypo_male_periHCD_counts.tsv.gz")
gz <- gzfile(outp, "w"); write.table(out, gz, sep = "\t", quote = FALSE, row.names = FALSE); close(gz)
cat(sprintf("[GSE242189] wrote %s  (%d genes x %d samples)\n", basename(outp), nrow(out), ncol(M)))

write.table(samples[, c("name","group")], file.path(DS, "metadata", "GSE242189_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, col.names = c("sample","group"))
cat("[GSE242189] wrote metadata/GSE242189_samplesheet.tsv\n")

panel <- c("Igfbp2","Igfbp5","Igfbp7","Igf1r","Irs2")
cat("[GSE242189] IGF panel present: ", paste(panel[panel %in% rownames(M)], collapse = ", "), "\n")
