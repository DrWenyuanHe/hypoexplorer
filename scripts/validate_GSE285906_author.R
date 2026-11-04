# Reproduce the only quantitative hypothalamus result reported for GSE285906
# with the manuscript's median-ratio/DESeq2 method. The explorer intentionally
# remains edgeR-QL; this check establishes that its different Npy FDR is a
# method difference rather than a cohort, orientation, or source-data defect.

suppressPackageStartupMessages(library(DESeq2))
stopifnot(packageVersion("DESeq2") == package_version("1.52.0"))

get_script_dir <- function() {
  args <- commandArgs(FALSE)
  file_arg <- grep("^--file=", args, value = TRUE)
  if (length(file_arg)) return(dirname(normalizePath(sub("^--file=", "", file_arg[1L]))))
  getwd()
}

root <- normalizePath(file.path(get_script_dir(), ".."))

dataset_dir <- file.path(
  root, "geo_replication", "datasets", "GSE285906_mmus_hypo_oxaliplatin"
)
source_path <- file.path(dataset_dir, "raw", "GSE285906_Hypothalamus_raw_counts.txt.gz")
sample_sheet_path <- file.path(dataset_dir, "metadata", "GSE285906_samplesheet.tsv")

source <- read.delim(gzfile(source_path), check.names = FALSE)
sample_sheet <- read.delim(sample_sheet_path, check.names = FALSE)
stopifnot(
  sum(sample_sheet$group == "case") == 4L,
  sum(sample_sheet$group == "control") == 3L,
  all(sample_sheet$sample %in% names(source)),
  !anyDuplicated(source$gene_id)
)

counts <- as.matrix(source[, sample_sheet$sample, drop = FALSE])
storage.mode(counts) <- "numeric"
stopifnot(all(is.finite(counts)), all(counts >= 0))

# The deposited count values are fractional. DESeq2 requires integers,
# so the method-matched sensitivity analysis uses nearest-integer gene counts.
integer_counts <- round(counts)
storage.mode(integer_counts) <- "integer"
rownames(integer_counts) <- source$gene_id
condition <- factor(sample_sheet$group, levels = c("control", "case"))
col_data <- data.frame(condition = condition, row.names = sample_sheet$sample)

dds <- DESeqDataSetFromMatrix(
  countData = integer_counts,
  colData = col_data,
  design = ~ condition
)
dds <- DESeq(dds, quiet = TRUE)
result <- results(dds, contrast = c("condition", "case", "control"))

npy_rows <- which(source[["Gene symbol"]] == "Npy")
stopifnot(length(npy_rows) == 1L)
npy <- result[npy_rows, ]
npy_fold <- 2^npy$log2FoldChange
finite_padj <- !is.na(result$padj)
paper_rule <- finite_padj & result$padj < 0.05 &
  abs(result$log2FoldChange) > log2(1.5)

# These tight checks detect input, cohort, orientation, or method drift. The
# author reports Npy fold change 5.88 and FDR 0.0024; the small remaining delta
# is compatible with Partek/DESeq2 version and hidden count-rounding details.
stopifnot(
  abs(npy_fold - 5.875328398) < 1e-6,
  abs(npy$pvalue - 1.26925661155e-05) < 1e-10,
  abs(npy$padj - 0.00273420190727) < 1e-8,
  abs(npy_fold - 5.88) / 5.88 < 0.001,
  abs(npy$padj - 0.0024) < 0.0004,
  sum(finite_padj & result$padj < 0.05) == 254L,
  sum(paper_rule) == 226L
)

cat(sprintf(
  paste0(
    "[GSE285906] PASS: DESeq2 %s method match; Npy fold=%.9f ",
    "(author 5.88), p=%.12g, FDR=%.12g (author 0.0024); ",
    "254 FDR<0.05 genes and 226 also pass |fold change|>1.5.\n"
  ),
  as.character(packageVersion("DESeq2")), npy_fold, npy$pvalue, npy$padj
))
