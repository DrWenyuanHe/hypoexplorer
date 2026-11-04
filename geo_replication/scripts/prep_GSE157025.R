#!/usr/bin/env Rscript
# Merge the six per-sample HTSeq tables for the adult 2-versus-24-month
# GSE157025 whole-hypothalamus bulk RNA-seq endpoint (three male mice per arm).
get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE157025_mmus_hypothalamus_aging")
samples <- data.frame(
  gsm = c("GSM4751085","GSM4751086","GSM4751087","GSM4751097","GSM4751098","GSM4751099"),
  sample = c("R_B11_2mothal","R_B12_2mothal","R_B13_2mothal",
             "R_tha_24m_B6_2","R_tha_24m_B6_4","R_tha_24m_B6_5"),
  file = c("GSM4751085_R_B11_2mothal_count.txt.gz","GSM4751086_R_B12_2mothal_count.txt.gz",
           "GSM4751087_R_B13_2mothal_count.txt.gz","GSM4751097_R_tha_24m_B6_2_count.txt.gz",
           "GSM4751098_R_tha_24m_B6_4_count.txt.gz","GSM4751099_R_tha_24m_B6_5_count.txt.gz"),
  group = c(rep("control",3), rep("case",3)), age_months = c(rep(2,3),rep(24,3)),
  sex = "Male", stringsAsFactors = FALSE)
read_one <- function(f) {
  d <- read.delim(gzfile(file.path(DS, "raw", f)), header = FALSE,
                  stringsAsFactors = FALSE, check.names = FALSE)
  if (ncol(d) != 2) stop(f, ": expected exactly gene and count columns")
  g <- trimws(as.character(d[[1]])); v <- as.numeric(d[[2]])
  if (anyNA(g) || any(!nzchar(g)) || anyDuplicated(g)) stop(f, ": invalid/duplicate gene IDs")
  if (any(!is.finite(v)) || any(v < 0) || any(v != round(v))) stop(f, ": invalid counts")
  setNames(v, g)
}
vecs <- lapply(samples$file, read_one)
genes <- names(vecs[[1]])
if (!all(vapply(vecs, function(v) identical(names(v), genes), logical(1))))
  stop("per-sample HTSeq files do not share the same ordered gene inventory")
M <- vapply(vecs, unname, numeric(length(genes)))
rownames(M) <- genes; colnames(M) <- samples$sample
out <- data.frame(symbol = genes, M, check.names = FALSE)
outp <- file.path(DS, "raw", "GSE157025_hypothalamus_2v24_counts.tsv.gz")
con <- gzfile(outp, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE); close(con)
write.table(samples[, c("sample","gsm","group","age_months","sex")],
            file.path(DS, "metadata", "GSE157025_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)
qc <- data.frame(sample = samples$sample, gsm = samples$gsm, group = samples$group,
                 age_months = samples$age_months, library_size = colSums(M),
                 detected_genes = colSums(M > 0), source_gene_rows = nrow(M),
                 merged_gene_rows = nrow(M), noninteger_values = colSums(M != round(M)),
                 count_conservation_delta = 0)
if (any(qc$library_size <= 0) || any(qc$detected_genes < 5000) || any(qc$noninteger_values != 0))
  stop("preprocessing QC gate failed")
write.table(qc, file.path(DS, "processed", "GSE157025_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)
cat(sprintf("[GSE157025] %d genes x %d mice; %.0f counts conserved\n",
            nrow(M), ncol(M), sum(M)))

