#!/usr/bin/env Rscript
# Select replicated hypothalamic GFAP-RiboTag IP libraries from GSE99791 and
# compare 2-year-old versus 4-month-old mice. The n=1/age input controls are
# excluded because they are not a replicated biological contrast.
get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE99791_mmus_hypothalamus_gfap_ribotag_aging")
SRC <- file.path(DS, "raw", "GSE99791_raw.txt.gz")
samples <- data.frame(
  sample = c("4mo_HTH_rep1","4mo_HTH_rep2","4mo_HTH_rep3",
             "2yo_HTH_rep1","2yo_HTH_rep2","2yo_HTH_rep3"),
  gsm = c("GSM2652332","GSM2652333","GSM2652334","GSM2652336","GSM2652337","GSM2652338"),
  group = c(rep("control",3),rep("case",3)), age = c(rep("4 months",3),rep("2 years",3)),
  fraction = "GFAP-RiboTag IP", stringsAsFactors = FALSE)
d <- read.delim(gzfile(SRC), check.names = FALSE, stringsAsFactors = FALSE)
miss <- setdiff(samples$sample, colnames(d)); if (length(miss)) stop("missing source columns: ", paste(miss, collapse=", "))
ann_col <- "Annotation/Divergence"
if (!ann_col %in% colnames(d)) stop("source annotation column not found")
transcript <- trimws(as.character(d[[1]]))
genes <- trimws(sub("\\|.*$", "", as.character(d[[ann_col]])))
bad <- is.na(genes) | !nzchar(genes) | genes == "-"
genes[bad] <- transcript[bad]
if (anyNA(genes) || any(!nzchar(genes))) stop("unrecoverable blank gene identifiers")
M <- as.matrix(d[, samples$sample, drop = FALSE]); storage.mode(M) <- "double"
if (any(!is.finite(M)) || any(M < 0) || any(M != round(M))) stop("invalid raw counts")
source_sums <- colSums(M); source_rows <- nrow(M)
M <- rowsum(M, genes, reorder = FALSE)
if (any(colSums(M) != source_sums)) stop("count conservation failed during symbol aggregation")
out <- data.frame(symbol = rownames(M), M, check.names = FALSE)
outp <- file.path(DS, "raw", "GSE99791_hypothalamus_ip_4mo_vs_2yo_counts.tsv.gz")
con <- gzfile(outp, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE); close(con)
write.table(samples, file.path(DS, "metadata", "GSE99791_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)
qc <- data.frame(sample = samples$sample, gsm = samples$gsm, group = samples$group,
                 age = samples$age, fraction = samples$fraction, library_size = colSums(M),
                 detected_genes = colSums(M > 0), source_gene_rows = source_rows,
                 merged_gene_rows = nrow(M), noninteger_values = colSums(M != round(M)),
                 count_conservation_delta = colSums(M) - source_sums)
if (any(qc$library_size <= 0) || any(qc$detected_genes < 5000) ||
    any(qc$noninteger_values != 0) || any(qc$count_conservation_delta != 0))
  stop("preprocessing QC gate failed")
write.table(qc, file.path(DS, "processed", "GSE99791_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)
cat(sprintf("[GSE99791] %d symbols x %d IP libraries; %.0f counts conserved\n",
            nrow(M), ncol(M), sum(M)))

