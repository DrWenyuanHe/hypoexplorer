#!/usr/bin/env Rscript
# Prepare the sex-adjusted 3-versus-21-month whole-hypothalamus contrast from
# GSE212336. The source is a multi-region bulk RNA-seq count matrix; only the 20
# independent hypothalamus libraries in the prespecified endpoint are retained.
get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE212336_mmus_hypothalamus_aging")
SRC <- file.path(DS, "raw", "GSE212336_BulkSeq_Counttable.txt.gz")

samples <- data.frame(
  sample = paste0("BulkSeq_hy_", c(17,21,25,33,37,41,45,49,53,
                                    16,20,24,28,32,36,40,44,48,52,56)),
  gsm = c("GSM6527528","GSM6527534","GSM6527538","GSM6527548","GSM6527553",
          "GSM6527558","GSM6527563","GSM6527568","GSM6527572",
          "GSM6527527","GSM6527532","GSM6527537","GSM6527542","GSM6527547",
          "GSM6527551","GSM6527557","GSM6527562","GSM6527567","GSM6527571","GSM6527576"),
  group = c(rep("control", 9), rep("case", 11)),
  sex = c(rep("Male",4),rep("Female",5),rep("Male",6),rep("Female",5)),
  age_months = c(rep(3,9), rep(21,11)),
  mouse_id = c(17,21,25,33,37,41,45,49,53,16,20,24,28,32,36,40,44,48,52,56),
  stringsAsFactors = FALSE)
stopifnot(sum(samples$group == "control") == 9, sum(samples$group == "case") == 11)

d <- read.delim(gzfile(SRC), check.names = FALSE, stringsAsFactors = FALSE)
miss <- setdiff(samples$sample, colnames(d))
if (length(miss)) stop("missing expected source columns: ", paste(miss, collapse = ", "))
genes <- trimws(as.character(d[[1]]))
if (anyNA(genes) || any(!nzchar(genes))) stop("blank gene identifiers in source matrix")
M <- as.matrix(d[, samples$sample, drop = FALSE]); storage.mode(M) <- "double"
if (any(!is.finite(M)) || any(M < 0) || any(M != round(M)))
  stop("source matrix is not finite non-negative integer counts")
source_sums <- colSums(M); source_rows <- nrow(M)
if (anyDuplicated(genes)) M <- rowsum(M, genes, reorder = FALSE) else rownames(M) <- genes
if (any(colSums(M) != source_sums)) stop("count conservation failed during symbol aggregation")

out <- data.frame(symbol = rownames(M), M, check.names = FALSE)
outp <- file.path(DS, "raw", "GSE212336_hypothalamus_3v21_counts.tsv.gz")
con <- gzfile(outp, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE); close(con)
write.table(samples, file.path(DS, "metadata", "GSE212336_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)
qc <- data.frame(sample = samples$sample, gsm = samples$gsm, group = samples$group,
                 sex = samples$sex, age_months = samples$age_months,
                 library_size = colSums(M), detected_genes = colSums(M > 0),
                 source_gene_rows = source_rows, merged_gene_rows = nrow(M),
                 noninteger_values = colSums(M != round(M)),
                 count_conservation_delta = colSums(M) - source_sums)
if (any(qc$library_size <= 0) || any(qc$detected_genes < 5000) ||
    any(qc$noninteger_values != 0) || any(qc$count_conservation_delta != 0))
  stop("preprocessing QC gate failed")
write.table(qc, file.path(DS, "processed", "GSE212336_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)
cat(sprintf("[GSE212336] %d genes x %d mice; %.0f counts conserved\n",
            nrow(M), ncol(M), sum(M)))

