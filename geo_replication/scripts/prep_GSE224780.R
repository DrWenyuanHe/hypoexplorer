#!/usr/bin/env Rscript
# =============================================================================
# Assemble a gene-level count matrix for GSE224780 (hypothalamus COX10-KO arm).
#
# The Series ships one HTSeq-count .txt.gz per GSM ("Gene<TAB><sample>" header,
# versioned ENSEMBL ids, raw integer counts) inside GSE224780_RAW.tar, covering
# three tissues: Liver (6+6), Muscle (6+6) and Hypothalamus (4+4). Only the
# hypothalamus block is kept here; liver and muscle are dropped.
#
# Contrast built: hypothalamus, C57BL/6, male, age 200 d,
#   COX10 KO (case, GSM7032019-22) vs Ctrl (control, GSM7032015-18), 4 vs 4.
# There is a single timepoint (200 d) in the Series, so no timepoint choice
# is needed, and every hypothalamus library is male -> no sex covariate.
#
# Usage:  Rscript scripts/prep_GSE224780.R
# =============================================================================
get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value=TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS   <- file.path(ROOT, "datasets", "GSE224780_mmus_hypothalamus_cox10ko")
TAR  <- file.path(DS, "raw", "GSE224780_RAW.tar")

samples <- data.frame(
  gsm   = c("GSM7032015","GSM7032016","GSM7032017","GSM7032018",
            "GSM7032019","GSM7032020","GSM7032021","GSM7032022"),
  entry = c("GSM7032015_200dCtrlHypothalamus_1.txt.gz","GSM7032016_200dCtrlHypothalamus_2.txt.gz",
            "GSM7032017_200dCtrlHypothalamus_3.txt.gz","GSM7032018_200dCtrlHypothalamus_4.txt.gz",
            "GSM7032019_200dKOHypothalamus_1.txt.gz","GSM7032020_200dKOHypothalamus_2.txt.gz",
            "GSM7032021_200dKOHypothalamus_3.txt.gz","GSM7032022_200dKOHypothalamus_4.txt.gz"),
  name  = c("Ctrl_Hypo_1","Ctrl_Hypo_2","Ctrl_Hypo_3","Ctrl_Hypo_4",
            "KO_Hypo_1","KO_Hypo_2","KO_Hypo_3","KO_Hypo_4"),
  group = c("control","control","control","control","case","case","case","case"),
  stringsAsFactors = FALSE)

tmp <- tempfile("ht224780_"); dir.create(tmp)
untar(TAR, files = samples$entry, exdir = tmp)

read_ht <- function(p) {
  d <- read.delim(gzfile(p), header = TRUE, check.names = FALSE, stringsAsFactors = FALSE)
  stopifnot(ncol(d) == 2L, names(d)[1] == "Gene")
  setNames(d[[2]], d[[1]])
}
vecs  <- lapply(file.path(tmp, samples$entry), read_ht)
genes <- Reduce(intersect, lapply(vecs, names))
cat(sprintf("[GSE224780] %d genes common across %d libraries\n", length(genes), length(vecs)))

M <- vapply(vecs, function(v) as.numeric(v[genes]), numeric(length(genes)))
rownames(M) <- genes; colnames(M) <- samples$name
stopifnot(!anyNA(M), all(M >= 0), all(M == round(M)))   # raw integer counts
cat(sprintf("[GSE224780] integer check ok; library sizes: %s\n",
            paste(sprintf("%s=%s", colnames(M), format(colSums(M), big.mark=",", trim=TRUE)), collapse=", ")))

out  <- data.frame(gene_id = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
outp <- file.path(DS, "raw", "GSE224780_hypothalamus_counts.tsv.gz")
gz <- gzfile(outp, "w"); write.table(out, gz, sep = "\t", quote = FALSE, row.names = FALSE); close(gz)
cat(sprintf("[GSE224780] wrote %s  (%d genes x %d samples)\n", basename(outp), nrow(out), ncol(M)))

ss <- samples[, c("name","group")]; names(ss) <- c("sample","group")
ssp <- file.path(DS, "metadata", "GSE224780_samplesheet.tsv")
write.table(ss, ssp, sep = "\t", quote = FALSE, row.names = FALSE)
cat(sprintf("[GSE224780] wrote %s\n", basename(ssp)))

# sanity: IGF panel presence (ids are versioned ENSEMBL -> map to symbol)
suppressPackageStartupMessages({ library(AnnotationDbi); library(org.Mm.eg.db) })
sym <- mapIds(org.Mm.eg.db, keys = sub("\\..*", "", rownames(M)),
              keytype = "ENSEMBL", column = "SYMBOL", multiVals = "first")
panel <- c("Igfbp2","Igfbp5","Igfbp7","Igf1r","Irs2")
cat("[GSE224780] panel genes present: ", paste(panel[panel %in% sym], collapse=", "), "\n")
unlink(tmp, recursive = TRUE)
