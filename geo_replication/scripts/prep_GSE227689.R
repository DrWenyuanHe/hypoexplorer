#!/usr/bin/env Rscript
# Prepare the female 19-month acute-dietary-restriction experiment from the
# multi-region GSE227689 bulk RNA-seq deposit. The male young-plasma experiment
# is a separate estimand and is not mixed into this contrast.
get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE227689_mmus_hypothalamus_rejuvenation_dr")
SRC <- file.path(DS, "raw", "GSE227689_BulkSeqRejuvenation_Counttable.txt.gz")
samples <- data.frame(
  sample = paste0("BulkSeq_hy_", c(63,66,68,69,62,64,65,67)),
  gsm = c("GSM7105373","GSM7105376","GSM7105378","GSM7105379",
          "GSM7105372","GSM7105374","GSM7105375","GSM7105377"),
  group = c(rep("control",4),rep("case",4)), treatment = c(rep("Ad libitum",4),rep("Acute dietary restriction",4)),
  sex = "Female", age_months = 19, mouse_id = c(63,66,68,69,62,64,65,67),
  stringsAsFactors = FALSE)
d <- read.delim(gzfile(SRC), check.names = FALSE, stringsAsFactors = FALSE)
miss <- setdiff(samples$sample, colnames(d)); if (length(miss)) stop("missing source columns: ", paste(miss, collapse=", "))
genes <- trimws(as.character(d[[1]])); if (anyNA(genes) || any(!nzchar(genes))) stop("blank gene identifiers")
M <- as.matrix(d[, samples$sample, drop = FALSE]); storage.mode(M) <- "double"
if (any(!is.finite(M)) || any(M < 0) || any(M != round(M))) stop("source matrix is not finite non-negative integer counts")
source_sums <- colSums(M); source_rows <- nrow(M)
if (anyDuplicated(genes)) M <- rowsum(M, genes, reorder = FALSE) else rownames(M) <- genes
if (any(colSums(M) != source_sums)) stop("count conservation failed during symbol aggregation")
out <- data.frame(symbol = rownames(M), M, check.names = FALSE)
outp <- file.path(DS, "raw", "GSE227689_hypothalamus_dr_counts.tsv.gz")
con <- gzfile(outp, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE); close(con)
write.table(samples, file.path(DS, "metadata", "GSE227689_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)
qc <- data.frame(sample = samples$sample, gsm = samples$gsm, group = samples$group,
                 treatment = samples$treatment, library_size = colSums(M), detected_genes = colSums(M > 0),
                 source_gene_rows = source_rows, merged_gene_rows = nrow(M),
                 noninteger_values = colSums(M != round(M)), count_conservation_delta = colSums(M) - source_sums)
if (any(qc$library_size <= 0) || any(qc$detected_genes < 5000) ||
    any(qc$noninteger_values != 0) || any(qc$count_conservation_delta != 0))
  stop("preprocessing QC gate failed")
write.table(qc, file.path(DS, "processed", "GSE227689_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)
cat(sprintf("[GSE227689] %d genes x %d mice; %.0f counts conserved\n",
            nrow(M), ncol(M), sum(M)))

