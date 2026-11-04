#!/usr/bin/env Rscript
# =============================================================================
# Assemble a gene-level count matrix for GSE242187 (maternal Western/hypercaloric
# diet programming of the offspring hypothalamus; Elgazzaz et al., PMID 38159883).
#
# The Series ships no per-GSM files. Instead it ships four per-comparison DESeq
# count tables, one per (sex x offspring-diet) stratum, each with the two arms of
# that stratum side by side. Columns are keyed by the submitter's internal library
# numbers ("13Mona_totalmRNAseq" ... "37Mona_totalmRNAseq"), NOT by GSM.
#
# GSM -> column mapping (derived, see notes below):
#   the 25 GSMs (GSM7754589..GSM7754613, title order 3A1..6B3) occupy library
#   numbers 13..37 contiguously, group N starting at 6N-5:
#     3A=13-15  3B=16-18 | 4A=19-21  4B=22-24 | 5A=25-27  5B=28-30 | 6A=31-34  6B=35-37
#   Confirmed three ways: (i) the blocks partition exactly into the GEO group sizes,
#   with the lone n=4 group (6A) taking the extra slot 34 that no counts file uses;
#   (ii) Xist/Ddx3y/Uty/Eif2s3y call every "A" block male and every "B" block female,
#   matching !Sample_characteristics_ch1 "Sex:" for 24/24 samples; (iii) the two
#   blocks present in each supplementary file are exactly the two groups its filename
#   names, in the order the filename names them (control first).
#
# Contrast built: whole hypothalamus, C57BL/6J, MALE offspring, both arms on
# postnatal HCD from weaning, maternal diet HCD (case, group 3A) vs maternal diet
# RD (control, group 5A), 3 vs 3. This is the Series' own male
# "control_vs_comparison" file and the paper's primary male comparison
# ("programmed male offspring fed on HCD ... vs non-programmed HCD-fed male mice").
#
# The other male file (TrtGrp6A_vs_TrtGr4A, maternal diet under postnatal RD) is
# NOT used: its control arm is depth-crippled and the imbalance is perfectly aligned
# with the contrast (6A libraries 25.2M / 5.4M / 7.3M with 17.1k / 10.6k / 11.9k genes
# detected, vs 20.9M / 24.2M / 30.9M and ~17.5k for every 4A library; the two shallow
# controls fall to Spearman 0.69-0.79 against the rest). Any DE from that file would
# be depth, not maternal diet.
#
# Usage:  Rscript scripts/prep_GSE242187.R
# =============================================================================
get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value=TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS   <- file.path(ROOT, "datasets", "GSE242187_mmus_hypo_maternal_hcd")
SRC  <- file.path(DS, "raw", "GSE242187_5A_vs_3A_control_vs_comparison.deseq.counts.csv.gz")

# library number -> (output sample name, group). Names follow the Series' own
# "maternal-offspring" convention from !Sample_source_name_ch1 ("RD-HCD Male").
samples <- data.frame(
  col   = c("25Mona_totalmRNAseq","26Mona_totalmRNAseq","27Mona_totalmRNAseq",
            "13Mona_totalmRNAseq","14Mona_totalmRNAseq","15Mona_totalmRNAseq"),
  name  = c("RD_HCD_male_25","RD_HCD_male_26","RD_HCD_male_27",
            "HCD_HCD_male_13","HCD_HCD_male_14","HCD_HCD_male_15"),
  group = c("control","control","control","case","case","case"),
  stringsAsFactors = FALSE)

M <- as.matrix(read.csv(gzfile(SRC), check.names = FALSE, row.names = 1, stringsAsFactors = FALSE))
stopifnot(all(samples$col %in% colnames(M)))
M <- M[, samples$col, drop = FALSE]
colnames(M) <- samples$name

# raw-count guarantee: edgeR-QL (filterByExpr + TMM) needs integers
stopifnot(all(is.finite(M)), all(M >= 0), all(M == round(M)))
storage.mode(M) <- "integer"
cat(sprintf("[GSE242187] %d genes x %d samples; integer counts confirmed (max %d)\n",
            nrow(M), ncol(M), max(M)))
cat("[GSE242187] library sizes:\n"); print(colSums(M))
stopifnot(!any(duplicated(rownames(M))))

out  <- data.frame(symbol = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
outp <- file.path(DS, "raw", "GSE242187_hypo_male_5Avs3A_counts.tsv.gz")
gz <- gzfile(outp, "w"); write.table(out, gz, sep = "\t", quote = FALSE, row.names = FALSE); close(gz)
cat(sprintf("[GSE242187] wrote %s\n", basename(outp)))

ssp <- file.path(DS, "metadata", "GSE242187_samplesheet.tsv")
con <- file(ssp, "wb")   # binary: LF endings, matching the rest of the corpus
write.table(samples[, c("name","group")], con, sep = "\t", quote = FALSE,
            row.names = FALSE, col.names = c("sample","group"), eol = "\n")
close(con)
cat(sprintf("[GSE242187] wrote %s\n", basename(ssp)))

panel <- c("Igfbp2","Igfbp5","Igfbp7","Igf1r","Irs2")
cat("[GSE242187] IGF panel present: ", paste(panel[panel %in% rownames(M)], collapse = ", "), "\n")
