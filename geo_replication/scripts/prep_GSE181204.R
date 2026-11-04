#!/usr/bin/env Rscript
# =============================================================================
# Assemble a gene-level count matrix for GSE181204 (VMHvl, OVX female mice).
#
# The Series ships one htseq-count tabular per GSM inside GSE181204_RAW.tar:
# two headerless tab-separated columns (mm10 gene SYMBOL, exon-aligned read count),
# 48,321 rows, no htseq "__no_feature"-style trailer rows. We merge them into one
# symbol-keyed raw-count matrix that the standardized pipeline consumes directly
# with id_type=SYMBOL (no ID mapping needed).
#
# Contrast built: VMHvl, ovariectomized C57BL/6-mixed females, subcutaneous
# estradiol benzoate 1 ug (case, n=4) vs vehicle (control, n=3), tissue collected
# 4 h after injection. That is the entire Series — no other tissue, genotype,
# timepoint, or treatment arm exists to drop.
#
# Arm assignment comes from the series matrix, not from the filenames:
#   !Sample_geo_accession        GSM5492402..GSM5492408
#   !Sample_title                "9301_VEH" "9304_VEH" "9309_VEH" "9302_EB" ...
#   !Sample_characteristics_ch1  "treatment: Vehicle" x3 | "treatment: Estradiol Benzoate (1ug)" x4
#
# Usage:  Rscript scripts/prep_GSE181204.R
# =============================================================================

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value=TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS   <- file.path(ROOT, "datasets", "GSE181204_mmus_vmhvl_estradiol")
TAR  <- file.path(DS, "raw", "GSE181204_RAW.tar")

# GSM -> (tar entry, output sample name, group); groups read off the series matrix
samples <- data.frame(
  gsm   = c("GSM5492402","GSM5492403","GSM5492404",
            "GSM5492405","GSM5492406","GSM5492407","GSM5492408"),
  entry = c("GSM5492402_VEH_9301_htseq-count.tabular.txt.gz",
            "GSM5492403_VEH_9304_htseq-count.tabular.txt.gz",
            "GSM5492404_VEH_9309_htseq-count.tabular.txt.gz",
            "GSM5492405_EB_9302_htseq-count.tabular.txt.gz",
            "GSM5492406_EB_9305_htseq-count.tabular.txt.gz",
            "GSM5492407_EB_9306_htseq-count.tabular.txt.gz",
            "GSM5492408_EB_9310_htseq-count.tabular.txt.gz"),
  name  = c("VEH_9301","VEH_9304","VEH_9309",
            "EB_9302","EB_9305","EB_9306","EB_9310"),
  group = c("control","control","control","case","case","case","case"),
  stringsAsFactors = FALSE)

tmp <- tempfile("hts181204_"); dir.create(tmp)
untar(TAR, files = samples$entry, exdir = tmp)

read_hts <- function(p) {
  d <- read.delim(gzfile(p), header = FALSE, col.names = c("symbol","count"),
                  stringsAsFactors = FALSE)
  d <- d[!grepl("^__", d$symbol), , drop = FALSE]   # defensive: htseq trailer rows
  setNames(d$count, d$symbol)
}
mats  <- lapply(file.path(tmp, samples$entry), read_hts)
genes <- Reduce(intersect, lapply(mats, names))     # identical mm10 gene model across runs
cat(sprintf("[GSE181204] %d genes common across %d libraries\n", length(genes), length(mats)))

M <- vapply(mats, function(v) as.numeric(v[genes]), numeric(length(genes)))
rownames(M) <- genes; colnames(M) <- samples$name
stopifnot(all(is.finite(M)), all(M == round(M)), all(M >= 0))   # raw integer counts
cat(sprintf("[GSE181204] integer check passed; library sizes: %s\n",
            paste(sprintf("%s=%.1fM", colnames(M), colSums(M)/1e6), collapse=" ")))

M <- M[order(rownames(M)), , drop = FALSE]
out  <- data.frame(symbol = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
outp <- file.path(DS, "raw", "GSE181204_VMHvl_counts.tsv.gz")
gz <- gzfile(outp, "w"); write.table(out, gz, sep = "\t", quote = FALSE, row.names = FALSE); close(gz)
cat(sprintf("[GSE181204] wrote %s  (%d genes x %d samples)\n", basename(outp), nrow(out), ncol(M)))

# samplesheet
ssp <- file.path(DS, "metadata", "GSE181204_samplesheet.tsv")
ssc <- file(ssp, "wb")   # binary: LF line endings, matching the rest of the corpus
write.table(samples[, c("name","group")], ssc, sep = "\t", quote = FALSE,
            row.names = FALSE, col.names = c("sample","group"))
close(ssc)
cat(sprintf("[GSE181204] wrote %s\n", basename(ssp)))

# sanity: IGF panel presence
panel <- c("Igfbp2","Igfbp5","Igfbp6","Igfbp7","Igf1r","Irs2","Igf1","Insr")
cat("[GSE181204] panel genes present: ", paste(panel[panel %in% rownames(M)], collapse=", "), "\n")
unlink(tmp, recursive = TRUE)
