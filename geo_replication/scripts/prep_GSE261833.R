#!/usr/bin/env Rscript

# Prepare GSE261833 PVN FPKM values for the normalized-matrix limma path.
# The GEO supplement contains documented FPKM, not raw counts; no rounding or
# count reconstruction is performed.

script_arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
if (length(script_arg) != 1L) stop("cannot resolve this script's path")
script_dir <- dirname(normalizePath(sub("^--file=", "", script_arg)))
root <- normalizePath(file.path(script_dir, ".."))
dataset_dir <- file.path(root, "datasets", "GSE261833_rnor_pvn_stress")
source_path <- file.path(dataset_dir, "raw", "GSE261833_gene_fpkm.txt.gz")
soft_path <- file.path(dataset_dir, "metadata", "GSE261833_family.soft.gz")

assert <- function(ok, message) if (!isTRUE(ok)) stop(message, call. = FALSE)
assert(file.exists(source_path) && file.info(source_path)$size == 1922583,
       "GSE261833 FPKM file is missing or its byte size changed")
assert(file.exists(soft_path) && file.info(soft_path)$size == 3731,
       "GSE261833 family SOFT is missing or its byte size changed")

samples <- data.frame(
  sample = c(paste0("C", 1:5, "brain"), paste0("M", 1:5, "brain")),
  group = c(rep("control", 5L), rep("case", 5L)),
  gsm = c(sprintf("GSM%d", 8152685:8152689), sprintf("GSM%d", 8152695:8152699)),
  title = c(paste0("C", 1:5, "brain, Control"), paste0("M", 1:5, "brain,Model")),
  condition = c(rep("no_treatment", 5L), rep("immobilization_stress", 5L)),
  stringsAsFactors = FALSE
)
assert(identical(as.integer(table(samples$group)[c("control", "case")]), c(5L, 5L)),
       "contrast is no longer five control versus five stressed rats")

soft <- readLines(gzfile(soft_path), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft)
ends <- c(starts[-1L] - 1L, length(soft))
assert(length(starts) == 15L, "family SOFT no longer contains 15 samples")
for (i in seq_len(nrow(samples))) {
  j <- which(soft[starts] == paste0("^SAMPLE = ", samples$gsm[i]))
  assert(length(j) == 1L, paste("missing SOFT block for", samples$gsm[i]))
  block <- soft[starts[j]:ends[j]]
  required <- c(
    paste0("!Sample_title = ", samples$title[i]),
    "!Sample_source_name_ch1 = Paraventricular hypothalamic nucleus",
    "!Sample_characteristics_ch1 = tissue: Paraventricular hypothalamic nucleus",
    "!Sample_characteristics_ch1 = genotype: WT",
    paste0("!Sample_characteristics_ch1 = treatment: ",
           if (samples$group[i] == "case") "Immobilized stress" else "No treatment"),
    "!Sample_library_strategy = RNA-Seq"
  )
  assert(all(required %in% block), paste("SOFT metadata changed for", samples$gsm[i]))
}

d <- read.delim(gzfile(source_path), check.names = FALSE, stringsAsFactors = FALSE)
assert(nrow(d) == 24160L && ncol(d) == 18L,
       "unexpected dimensions in GSE261833 FPKM table")
assert(all(c("Gene_ID", samples$sample, "entrez_ID", "symbol") %in% colnames(d)),
       "required FPKM columns are missing")
ids <- as.character(d[["Gene_ID"]])
assert(!anyDuplicated(ids) &&
         all(grepl("^(ENSRNOG[0-9]+|XLOC_[0-9]+)$", ids)) &&
         sum(startsWith(ids, "ENSRNOG")) == 23760L &&
         sum(startsWith(ids, "XLOC_")) == 400L,
       "rat Ensembl/XLOC feature inventory is not unique or changed")

M <- as.matrix(d[, samples$sample, drop = FALSE])
storage.mode(M) <- "double"
assert(!anyNA(M) && all(is.finite(M)) && all(M >= 0),
       "FPKM matrix contains missing, non-finite, or negative values")
fraction_integer <- mean(M == round(M))
assert(fraction_integer < 0.5 && max(M) < 1e6 && max(colSums(M)) < 1e6,
       "matrix no longer has the expected normalized FPKM scale")

expected_sums <- c(481802.780663634, 488142.041004176, 488076.814199914,
                   487036.327366304, 478326.752871345, 489962.570071161,
                   533081.955792942, 495135.905385934, 488727.531835315,
                   482245.155466907)
expected_detected <- c(19006L, 19025L, 18972L, 19021L, 19237L,
                       19093L, 18966L, 18974L, 19253L, 18724L)
assert(max(abs(colSums(M) - expected_sums)) < 1e-6 &&
         identical(as.integer(colSums(M > 0)), expected_detected),
       "pinned FPKM totals or detection counts changed")

L <- log2(M + 1)
rownames(L) <- ids
delta <- apply(abs(2^L - 1 - M), 2L, max)
assert(all(is.finite(L)) && all(L >= 0) && max(delta) < 1e-10,
       "log2(FPKM+1) transformation failed reversibility/finite-value checks")

out <- data.frame(Gene_ID = rownames(L), L, check.names = FALSE,
                  stringsAsFactors = FALSE)
out_path <- file.path(dataset_dir, "raw", "GSE261833_model_vs_control_log2fpkm.tsv.gz")
con <- gzfile(out_path, "wt")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)

write.table(samples,
            file.path(dataset_dir, "metadata", "GSE261833_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)

qc <- data.frame(
  sample = samples$sample,
  group = samples$group,
  gsm = samples$gsm,
  source_gene_rows = nrow(M),
  fpkm_sum = colSums(M),
  detected_genes = colSums(M > 0),
  log2_expression_sum = colSums(L),
  min_log2_expression = apply(L, 2L, min),
  max_log2_expression = apply(L, 2L, max),
  nonfinite_values = colSums(!is.finite(L)),
  negative_values = colSums(L < 0),
  transform_max_abs_delta = delta,
  metadata_match = TRUE,
  analysis_keep = TRUE,
  stringsAsFactors = FALSE
)
write.table(qc,
            file.path(dataset_dir, "processed", "GSE261833_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)

cat(sprintf(
  "GSE261833 prepared: %d genes x %d independent rats; control=%d stress=%d; FPKM sums %.0f-%.0f; limma matrix\n",
  nrow(L), ncol(L), sum(samples$group == "control"), sum(samples$group == "case"),
  min(colSums(M)), max(colSums(M))
))
