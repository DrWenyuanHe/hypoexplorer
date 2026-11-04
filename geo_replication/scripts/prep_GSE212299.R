#!/usr/bin/env Rscript
# =============================================================================
# Assemble a gene-level count matrix for GSE212299 (hypothalamus Abi3-KO arm).
#
# The Series ships one htseq-count table per GSM inside GSE212299_RAW.tar: a
# headerless 2-column TSV of ENSEMBL gene id -> raw integer count (GRCm39, STAR
# 2.7.3a + htseq-count 0.9.1 -m intersection-nonempty -s yes), with the five
# trailing htseq summary rows (__no_feature, __ambiguous, __too_low_aQual,
# __not_aligned, __alignment_not_unique) appended. We drop those rows and merge
# the per-GSM columns into one ENSEMBL-keyed raw-count matrix.
#
# Contrast built: hypothalamus, male, 15-month, Abi3 KO (case) vs Abi3 WT
# (control), 4 vs 4 independent animals. The 8 brown-adipose libraries
# (GSM6523615-622) are intentionally excluded -- tissue is the only other factor
# in the Series and it is fully crossed with genotype, so the hypothalamic
# stratum is a clean 1x1 contrast on its own.
#
# Usage:  Rscript scripts/prep_GSE212299.R
# =============================================================================

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value=TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS   <- file.path(ROOT, "datasets", "GSE212299_mmus_hypothalamus_abi3ko")
TAR  <- file.path(DS, "raw", "GSE212299_RAW.tar")

# GSM -> (tar entry, output sample name, group) for the hypothalamic stratum.
# Grouping is taken from the series matrix !Sample_title / !Sample_characteristics_ch1
# ("tissue: hypothalamus" + "genotype: ABI3 WT|KO"), not from the file names.
samples <- data.frame(
  gsm   = c("GSM6523623","GSM6523624","GSM6523625","GSM6523626",
            "GSM6523627","GSM6523628","GSM6523629","GSM6523630"),
  entry = c("GSM6523623_Hypothalamus_Abi3-WT_1.txt.gz","GSM6523624_Hypothalamus_Abi3-WT_2.txt.gz",
            "GSM6523625_Hypothalamus_Abi3-WT_3.txt.gz","GSM6523626_Hypothalamus_Abi3-WT_4.txt.gz",
            "GSM6523627_Hypothalamus_Abi3-KO_1.txt.gz","GSM6523628_Hypothalamus_Abi3-KO_2.txt.gz",
            "GSM6523629_Hypothalamus_Abi3-KO_3.txt.gz","GSM6523630_Hypothalamus_Abi3-KO_4.txt.gz"),
  name  = c("Hypo_Abi3WT_1","Hypo_Abi3WT_2","Hypo_Abi3WT_3","Hypo_Abi3WT_4",
            "Hypo_Abi3KO_1","Hypo_Abi3KO_2","Hypo_Abi3KO_3","Hypo_Abi3KO_4"),
  group = c("control","control","control","control","case","case","case","case"),
  stringsAsFactors = FALSE)

tmp <- tempfile("htseq212299_"); dir.create(tmp)
untar(TAR, files = samples$entry, exdir = tmp)

read_htseq <- function(p) {
  d <- read.delim(gzfile(p), header = FALSE, col.names = c("gene_id","count"),
                  stringsAsFactors = FALSE)
  d <- d[!grepl("^__", d$gene_id), , drop = FALSE]      # drop htseq summary rows
  setNames(d$count, d$gene_id)
}
vecs  <- lapply(file.path(tmp, samples$entry), read_htseq)
genes <- Reduce(intersect, lapply(vecs, names))          # identical GRCm39 annotation across runs
cat(sprintf("[GSE212299] %d genes common across %d libraries\n", length(genes), length(vecs)))

M <- vapply(vecs, function(v) as.numeric(v[genes]), numeric(length(genes)))
rownames(M) <- genes; colnames(M) <- samples$name
stopifnot(all(is.finite(M)), all(M == round(M)), all(M >= 0))   # raw integer counts
cat(sprintf("[GSE212299] integer check OK; library sizes: %s\n",
            paste(sprintf("%s=%s", colnames(M), format(colSums(M), big.mark=",", trim=TRUE)),
                  collapse = ", ")))

M   <- M[order(rownames(M)), , drop = FALSE]
out <- data.frame(gene_id = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
outp <- file.path(DS, "raw", "GSE212299_hypothalamus_counts.tsv.gz")
gz <- gzfile(outp, "w"); write.table(out, gz, sep = "\t", quote = FALSE, row.names = FALSE); close(gz)
cat(sprintf("[GSE212299] wrote %s  (%d genes x %d samples)\n", basename(outp), nrow(out), ncol(M)))

# samplesheet
ss <- samples[, c("name","group")]; colnames(ss) <- c("sample","group")
ssp <- file.path(DS, "metadata", "GSE212299_samplesheet.tsv")
con <- file(ssp, "wb")   # binary mode -> LF endings, matching the rest of the corpus
write.table(ss, con, sep = "\t", quote = FALSE, row.names = FALSE); close(con)
cat(sprintf("[GSE212299] wrote %s\n", basename(ssp)))

# sanity: IGF panel presence (ENSMUSG ids, GRCm39)
panel <- c(Igfbp2="ENSMUSG00000039323", Igfbp5="ENSMUSG00000026185",
           Igfbp7="ENSMUSG00000036256", Igf1r="ENSMUSG00000005533",
           Irs2="ENSMUSG00000038894")
hit <- names(panel)[panel %in% rownames(M)]
cat("[GSE212299] panel genes present: ", paste(hit, collapse=", "), "\n")
unlink(tmp, recursive = TRUE)
