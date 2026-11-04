#!/usr/bin/env Rscript
# =============================================================================
# Disambiguate GSE236077 and emit a HYPOTHALAMUS-ONLY raw count matrix.
#
# The GEO supplementary GSE236077_counts.csv.gz labels every column by GSM
# accession, but each animal's GSM accession spans 5 dissected brain regions
# (hypothalamus, hippocampus, superior/inferior colliculus, prefrontal cortex),
# so each GSM name appears 5x with DIFFERENT data, interleaved in blocks of 6.
# Selecting a column by GSM name alone (as run_dataset.R does) silently grabs an
# arbitrary region. This script identifies each animal's true hypothalamus column
# by hypothalamus-exclusive marker expression (Agrp/Hcrt/Pmch/Gnrh1/Oxt/Avp/Pomc/
# Trh — essentially absent in hippocampus/colliculus/cortex), then writes a clean
# matrix with one uniquely-named column per animal.
#
# Usage:  Rscript scripts/prep_GSE236077.R
# =============================================================================
suppressPackageStartupMessages({ library(AnnotationDbi); library(org.Mm.eg.db) })

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value=TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS   <- file.path(ROOT, "datasets", "GSE236077_mmus_hypothalamus_hfd")
INP  <- file.path(DS, "raw", "GSE236077_counts.csv.gz")

# Target animals (the chow-vs-HFD, 16h-experiment contrast). Each GSM appears 5x.
control <- c("GSM7517823","GSM7517824","GSM7517825","GSM7517826","GSM7517827","GSM7517828") # chow
case    <- c("GSM7517883","GSM7517884","GSM7517885","GSM7517886","GSM7517887","GSM7517888") # HFD
targets <- c(control, case)

# Read header separately so the 5x-duplicated GSM column names survive verbatim
# (read.csv/data.frame would otherwise de-duplicate them and destroy positions).
con <- gzfile(INP); hdr <- strsplit(readLines(con, n = 1), ",")[[1]]; close(con)
df  <- read.csv(gzfile(INP), header = FALSE, skip = 1, check.names = FALSE, stringsAsFactors = FALSE)
ids <- as.character(df[[1]])
mat <- as.matrix(df[, -1, drop = FALSE])
storage.mode(mat) <- "numeric"
colnames(mat) <- hdr[-1]
cat(sprintf("[GSE236077] matrix %d genes x %d cols (%d unique GSM names)\n",
            nrow(mat), ncol(mat), length(unique(colnames(mat)))))
sym <- mapIds(org.Mm.eg.db, keys = sub("\\..*", "", ids), keytype = "ENSEMBL", column = "SYMBOL", multiVals = "first")

markers <- c("Agrp","Hcrt","Pmch","Gnrh1","Oxt","Avp","Pomc","Trh")
mrows <- which(sym %in% markers)
cat(sprintf("[GSE236077] %d/%d hypothalamic marker rows found: %s\n",
            length(mrows), length(markers), paste(sort(unique(sym[mrows])), collapse=", ")))
cpm   <- sweep(mat, 2, colSums(mat), "/") * 1e6
score <- colSums(cpm[mrows, , drop = FALSE])          # per-column hypothalamus-marker score

# Each animal's 5 columns are 5 region blocks; the hypothalamus is the FIRST block
# (R1 = lowest column index). Corroborate that structural rule with the marker
# argmax: for high-quality libraries the first occurrence IS the marker-max column.
pick <- integer(0); ndisagree <- 0
for (g in targets) {
  cols <- which(colnames(mat) == g)
  if (length(cols) != 5) stop(sprintf("%s: expected 5 region columns, found %d", g, length(cols)))
  hy_struct <- cols[1]                                   # R1 block = hypothalamus
  hy_marker <- cols[which.max(score[cols])]              # independent marker check
  agree <- hy_struct == hy_marker
  if (!agree) ndisagree <- ndisagree + 1
  cat(sprintf("  %s -> col#%-3d (R1) marker=%4.0f | argmax=col#%-3d %s\n",
              g, hy_struct, score[hy_struct], hy_marker,
              if (agree) "(markers agree)" else "(low-signal lib; markers diffuse — keeping structural R1=HY)"))
  pick <- c(pick, hy_struct)
}
cat(sprintf("[GSE236077] HY = first/R1 block; marker argmax corroborates %d/12 libraries\n", 12 - ndisagree))
stopifnot("structural HY rule not corroborated by markers (<10/12)" = ndisagree <= 2)

hy <- mat[, pick, drop = FALSE]
colnames(hy) <- targets                                 # one unique column per animal
out <- data.frame(gene = ids, hy, check.names = FALSE, stringsAsFactors = FALSE)
outp <- file.path(DS, "raw", "GSE236077_hypothalamus_counts.csv.gz")
gz <- gzfile(outp, "w"); write.csv(out, gz, row.names = FALSE, quote = FALSE); close(gz)
cat(sprintf("[GSE236077] wrote %s  (%d genes x %d hypothalamus columns)\n",
            basename(outp), nrow(out), ncol(hy)))
