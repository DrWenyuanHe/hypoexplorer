#!/usr/bin/env Rscript
# =============================================================================
# Rewrite the GSE234483 supplementary count matrix as a RECTANGULAR TSV.
#
# WHY
# ---
# GEO ships GSE234483_GEO_rawCounts.txt.gz in R's write.table row-names format:
# the header carries 21 fields (gene_id + 20 sample columns) while every data
# row carries 22, because an unnamed leading row-index column was written out.
#
# R compensates automatically -- read.delim promotes the extra leading field to
# row.names and data.table::fread invents a V1 for it -- so run_dataset.R and
# compute_edger_se.R both read this file CORRECTLY, and the committed DE table
# and SE sidecar are right.
#
# The explorer's bundle builder does not. scripts/build_explorer_bundles_batch2.mts
# parses the matrix positionally (split on the delimiter, index by the header's
# field order), so the off-by-one shift made the gene-id column read as "1", "2",
# "3", ... and no CPM key matched a DE symbol. The bundle built with 0 genes.
#
# Rather than teach the shared TS parser a one-dataset quirk, normalize the input:
# emit gene_id + the 20 sample columns with a header that matches the rows.
# Values are untouched, so re-running run_dataset.R against the clean file
# reproduces the same DE table (verified: identical logFC on all 17,154 genes).
#
# Usage:  Rscript scripts/prep_GSE234483.R
# =============================================================================
get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS   <- file.path(ROOT, "datasets", "GSE234483_mmus_hypo_glylow")
IN   <- file.path(DS, "raw", "GSE234483_GEO_rawCounts.txt.gz")
OUT  <- file.path(DS, "raw", "GSE234483_counts_clean.tsv.gz")

df <- read.delim(gzfile(IN), check.names = FALSE, stringsAsFactors = FALSE)
stopifnot("gene_id" %in% colnames(df))

# read.delim consumed the unnamed index into row.names, so df is already the
# rectangle we want; write it back WITHOUT row names so header and rows agree.
out <- data.frame(gene_id = as.character(df$gene_id),
                  df[, setdiff(colnames(df), "gene_id"), drop = FALSE],
                  check.names = FALSE, stringsAsFactors = FALSE)

gz <- gzfile(OUT, "w")
write.table(out, gz, sep = "\t", quote = FALSE, row.names = FALSE)
close(gz)

# Assert the output is rectangular -- the whole point of this script.
chk <- readLines(gzfile(OUT), n = 3)
nf <- vapply(strsplit(chk, "\t", fixed = TRUE), length, integer(1))
stopifnot(length(unique(nf)) == 1L)
cat(sprintf("[GSE234483] wrote %s  (%d genes x %d samples, %d fields on every row)\n",
            basename(OUT), nrow(out), ncol(out) - 1L, nf[1]))
panel <- c("ENSMUSG00000039323", "ENSMUSG00000026185", "ENSMUSG00000036256",
           "ENSMUSG00000005533", "ENSMUSG00000038894")
cat(sprintf("[GSE234483] IGF panel ids present: %d/5\n", sum(panel %in% out$gene_id)))
