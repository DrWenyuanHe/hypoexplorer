#!/usr/bin/env Rscript

# Aggregate deposited per-animal Drop-seq matrices to whole-hypothalamus
# pseudobulk counts. The retained contrast is Akkermansia versus control within
# fructose-fed mice; the water-fed arm is a separate biological context.

suppressPackageStartupMessages({
  library(Matrix)
  library(data.table)
})

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 4L) {
  stop(paste0(
    "usage: prep_GSE212491.R <extracted-source-dir> <samplesheet.tsv> ",
    "<pseudobulk-counts.tsv.gz> <qc.tsv>"
  ))
}

source_dir <- normalizePath(args[[1]], mustWork = TRUE)
samplesheet_path <- args[[2]]
pseudobulk_path <- args[[3]]
qc_path <- args[[4]]

all_expected <- c(
  "hypoABF5-1_S12_L002", "hypoABF5-2_S10_L002", "hypoABF5-3_S4_L002",
  "hypoABW3-1_S11_L002", "hypoABW4-2_S3_L002", "hypoABW4-3_S5_L002",
  "hypoAkkF10-2_S9_L002", "hypoAkkF10-3_S7_L002", "hypoAkkF10-4_S6_L002",
  "hypoAkkW7-1_S1_L002", "hypoAkkW7-2_S2_L002", "hypoAkkW7-4_S8_L002"
)
deposited_dirs <- basename(list.dirs(source_dir, recursive = FALSE, full.names = TRUE))
if (!setequal(deposited_dirs, all_expected)) {
  stop("extracted source directories differ from the 12 deposited libraries")
}

samples <- c(
  "hypoABF5-1_S12_L002", "hypoABF5-2_S10_L002", "hypoABF5-3_S4_L002",
  "hypoAkkF10-2_S9_L002", "hypoAkkF10-3_S7_L002", "hypoAkkF10-4_S6_L002"
)
group <- c(rep("control", 3L), rep("case", 3L))
if (!identical(as.integer(table(group)), c(3L, 3L))) {
  stop("retained fructose-fed contrast must contain three animals per arm")
}

sample_counts <- vector("list", length(samples))
names(sample_counts) <- samples
qc_rows <- vector("list", length(samples))

for (i in seq_along(samples)) {
  sample <- samples[[i]]
  sample_dir <- file.path(source_dir, sample)
  matrix_path <- file.path(sample_dir, "matrix.mtx")
  genes_path <- file.path(sample_dir, "genes.tsv")
  barcodes_path <- file.path(sample_dir, "barcodes.tsv")
  if (!all(file.exists(c(matrix_path, genes_path, barcodes_path)))) {
    stop(sprintf("%s is missing a deposited matrix sidecar", sample))
  }

  genes <- fread(
    genes_path, header = FALSE, sep = "\t", colClasses = "character",
    showProgress = FALSE
  )
  if (ncol(genes) != 2L || !identical(genes[[1]], genes[[2]]) ||
      any(!nzchar(genes[[1]])) || anyDuplicated(genes[[1]])) {
    stop(sprintf("%s genes.tsv is not two identical, unique symbol columns", sample))
  }
  symbols <- genes[[1]]

  barcodes <- readLines(barcodes_path, warn = FALSE)
  if (!length(barcodes) || any(!nzchar(barcodes)) || anyDuplicated(barcodes)) {
    stop(sprintf("%s barcodes.tsv is empty, missing, or duplicated", sample))
  }

  header <- readLines(matrix_path, n = 1L, warn = FALSE)
  if (!identical(header, "%%MatrixMarket matrix coordinate integer general")) {
    stop(sprintf("%s matrix is not integer Matrix Market", sample))
  }
  counts <- readMM(matrix_path)
  if (!identical(dim(counts), c(length(symbols), length(barcodes)))) {
    stop(sprintf("%s matrix dimensions disagree with gene/barcode sidecars", sample))
  }
  if (any(!is.finite(counts@x) | counts@x <= 0 | counts@x != round(counts@x))) {
    stop(sprintf("%s matrix has invalid stored counts", sample))
  }

  totals <- as.numeric(rowSums(counts))
  names(totals) <- symbols
  library_size <- sum(counts@x)
  if (!is.finite(library_size) || library_size <= 0 ||
      !identical(sum(totals), library_size)) {
    stop(sprintf("%s row aggregation does not conserve counts", sample))
  }
  sample_counts[[sample]] <- totals
  qc_rows[[i]] <- data.frame(
    sample = sample,
    group = group[[i]],
    condition = ifelse(group[[i]] == "case", "fructose_akkermansia", "fructose_control"),
    diet = "fructose",
    cells = length(barcodes),
    source_gene_rows = length(symbols),
    matrix_nnz = length(counts@x),
    library_size = library_size,
    detected_genes = sum(totals > 0),
    stringsAsFactors = FALSE
  )
}

gene_union <- sort(unique(unlist(lapply(sample_counts, names), use.names = FALSE)))
if (!length(gene_union) || any(!nzchar(gene_union)) || anyDuplicated(gene_union)) {
  stop("merged gene-symbol universe is invalid")
}
pseudobulk <- matrix(
  0, nrow = length(gene_union), ncol = length(samples),
  dimnames = list(gene_union, samples)
)
for (sample in samples) {
  values <- sample_counts[[sample]]
  pseudobulk[match(names(values), gene_union), sample] <- values
}
if (any(!is.finite(pseudobulk)) || any(pseudobulk < 0) ||
    any(pseudobulk != round(pseudobulk))) {
  stop("merged pseudobulk is not finite, nonnegative integer counts")
}

qc <- rbindlist(qc_rows)
expected_cells <- c(6794L, 7555L, 8072L, 10897L, 6411L, 7763L)
expected_gene_rows <- c(21400L, 22433L, 22708L, 22526L, 22061L, 22112L)
expected_nnz <- c(1841448L, 2763065L, 2681705L, 3045089L, 2295693L, 2533422L)
expected_library_sizes <- c(3697600, 4655950, 4435080, 5113455, 4012546, 3985074)
if (!identical(qc$cells, expected_cells) ||
    !identical(qc$source_gene_rows, expected_gene_rows) ||
    !identical(qc$matrix_nnz, expected_nnz) ||
    !identical(as.numeric(qc$library_size), expected_library_sizes) ||
    nrow(pseudobulk) != 25676L) {
  stop("deposited selected-library dimensions or counts changed")
}
count_delta <- as.numeric(colSums(pseudobulk)) - qc$library_size
if (any(!is.finite(count_delta)) || any(count_delta != 0)) {
  stop("merged pseudobulk does not conserve each animal library exactly")
}
qc[, count_conservation_delta := count_delta]
qc[, merged_gene_rows := nrow(pseudobulk)]

samplesheet <- qc[, .(sample, group, condition, diet, cells)]
output <- data.table(GeneName = gene_union)
output <- cbind(output, as.data.table(pseudobulk))

fwrite(output, pseudobulk_path, sep = "\t", compress = "gzip")
fwrite(samplesheet, samplesheet_path, sep = "\t")
fwrite(qc, qc_path, sep = "\t")

cat(sprintf(
  paste0(
    "prepared %d genes x %d animals from %s cells; control=%d case=%d; ",
    "library sizes %.1fM-%.1fM; exact count conservation\n"
  ),
  nrow(pseudobulk), ncol(pseudobulk),
  format(sum(qc$cells), big.mark = ",", scientific = FALSE),
  sum(group == "control"), sum(group == "case"),
  min(qc$library_size) / 1e6, max(qc$library_size) / 1e6
))
