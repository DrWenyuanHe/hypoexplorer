#!/usr/bin/env Rscript

# Reconstruct the seven author-defined processed units from the official
# 14,437-cell GSE87544 merged count matrix. These units are the independent
# analysis columns available in the deposited processed artifact; individual
# cells are nested observations and are summed to pseudobulk counts.

suppressPackageStartupMessages(library(data.table))

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 6L) {
  stop(paste0(
    "usage: prep_GSE87544.R <official-counts.txt.gz> <official-clusters.csv.gz> ",
    "<samplesheet.tsv> <pseudobulk-counts.tsv.gz> <sample-qc.tsv> ",
    "<cluster-qc.tsv>"
  ))
}

counts_path <- normalizePath(args[[1]], mustWork = TRUE)
clusters_path <- normalizePath(args[[2]], mustWork = TRUE)
samplesheet_path <- args[[3]]
pseudobulk_path <- args[[4]]
sample_qc_path <- args[[5]]
cluster_qc_path <- args[[6]]

samples <- data.table(
  sample = c(
    "B0_Normal", "B1_Hungry", "B1_Normal", "B2_Hungry2",
    "B2_Normal", "B3_Normal", "B4_Hungry2"
  ),
  group = c("control", "case", "control", "case", "control", "control", "case"),
  condition = c(
    "normal_fed", "food_deprived_24h", "normal_fed", "food_deprived_24h",
    "normal_fed", "normal_fed", "food_deprived_24h"
  ),
  batch = c("B0", "B1", "B1", "B2", "B2", "B3", "B4"),
  expected_cells = c(287L, 3674L, 2573L, 2970L, 1766L, 1881L, 1286L),
  expected_library_size = c(
    681456, 12637891, 9011451, 10050048, 5907741, 5354104, 3698233
  ),
  expected_detected_genes = c(14446L, 18171L, 17797L, 17557L, 17161L, 16717L, 16446L),
  expected_matrix_nnz = c(373019, 5766023, 4102976, 4582974, 2774474, 2758806, 1973431)
)

cell_to_sample <- function(cell_ids) {
  base_ids <- sub("\\.[0-9]+$", "", cell_ids)
  suffix <- sub("^.*_", "", base_ids)
  paste(substr(base_ids, 1L, 2L), suffix, sep = "_")
}

counts_con <- gzfile(counts_path, "rt")
on.exit(close(counts_con), add = TRUE)
header_line <- readLines(counts_con, n = 1L, warn = FALSE)
if (length(header_line) != 1L) stop("official processed count matrix has no header")
header <- strsplit(header_line, "\t", fixed = TRUE)[[1L]]
raw_cell_ids <- header[-1L]
cell_ids <- raw_cell_ids
cell_sample <- cell_to_sample(cell_ids)
if (header[[1L]] != "Gene" || length(raw_cell_ids) != 14437L ||
    length(unique(cell_ids)) != 14437L ||
    sum(grepl("\\.1$", cell_ids)) != 64L ||
    sum(duplicated(sub("\\.1$", "", cell_ids))) != 64L ||
    !identical(as.integer(table(factor(cell_sample, levels = samples$sample))), samples$expected_cells)) {
  stop("official GSE87544 processed-matrix cell header or seven-unit mapping changed")
}

# The author's SVM cluster table is an independent checksum of the complete
# cell inventory. Both files already contain the deposited .1 disambiguation
# used for 64 repeated base barcodes. The cluster CSV's blank row-name header
# requires explicitly skipping its first line.
clusters <- fread(
  clusters_path,
  skip = 1L,
  header = FALSE,
  col.names = c("row_id", "cell", "cluster"),
  showProgress = FALSE
)
if (nrow(clusters) != 14437L || anyNA(clusters) ||
    any(!nzchar(clusters$cell)) || any(!nzchar(clusters$cluster)) ||
    any(clusters$row_id != clusters$cell) || anyDuplicated(clusters$cell) ||
    !setequal(clusters$cell, cell_ids)) {
  stop("official cluster file does not match the processed-matrix cell inventory")
}

expected_cluster_counts <- data.table(
  cluster = c(
    "Astro", "Ependy", "Epith1", "Epith2", "GABA1", "GABA10", "GABA11",
    "GABA12", "GABA13", "GABA14", "GABA15", "GABA16", "GABA17", "GABA18",
    "GABA2", "GABA3", "GABA4", "GABA5", "GABA6", "GABA7", "GABA8", "GABA9",
    "Glu1", "Glu10", "Glu11", "Glu12", "Glu13", "Glu14", "Glu15", "Glu2",
    "Glu3", "Glu4", "Glu5", "Glu6", "Glu7", "Glu8", "Glu9", "Hista", "IMO",
    "MO", "Macro", "Micro", "OPC", "POPC", "SCO", "Tany", "zothers"
  ),
  N = c(
    1148L, 413L, 818L, 379L, 23L, 23L, 35L, 62L, 165L, 71L, 112L, 66L,
    50L, 31L, 27L, 97L, 18L, 73L, 49L, 17L, 402L, 71L, 13L, 15L, 42L, 24L,
    24L, 51L, 25L, 21L, 13L, 131L, 200L, 51L, 211L, 50L, 35L, 17L, 151L,
    3541L, 167L, 724L, 1741L, 51L, 32L, 609L, 2348L
  )
)
observed_cluster_counts <- clusters[, .N, by = cluster]
setorder(expected_cluster_counts, cluster)
setorder(observed_cluster_counts, cluster)
if (!identical(observed_cluster_counts, expected_cluster_counts) ||
    sum(observed_cluster_counts$N) != 14437L) {
  stop("official GSE87544 SVM cluster identities or counts changed")
}

clusters[, sample := cell_to_sample(cell)]
if (!identical(
  as.integer(table(factor(clusters$sample, levels = samples$sample))),
  samples$expected_cells
)) {
  stop("cluster-file cells do not reproduce the seven official processed units")
}
clusters <- merge(
  clusters,
  samples[, .(sample, group, condition, batch)],
  by = "sample",
  all.x = TRUE,
  sort = FALSE
)
if (anyNA(clusters$group)) stop("cluster-file cell mapped outside the seven processed units")
cluster_qc <- clusters[, .N, by = .(sample, group, condition, batch, cluster)]
setorder(cluster_qc, sample, cluster)

# Stream the very wide matrix in gene chunks so validation and aggregation do
# not require materializing the 23,284 x 14,437 cell matrix in memory.
gene_chunks <- list()
pseudobulk_chunks <- list()
matrix_nnz <- setNames(numeric(nrow(samples)), samples$sample)
chunk_index <- 0L
repeat {
  lines <- readLines(counts_con, n = 128L, warn = FALSE)
  if (!length(lines)) break
  fields <- strsplit(lines, "\t", fixed = TRUE)
  if (any(lengths(fields) != length(cell_ids) + 1L)) {
    stop("official processed count matrix contains a row with the wrong number of cells")
  }
  chunk_genes <- vapply(fields, `[[`, character(1), 1L)
  if (any(!nzchar(chunk_genes))) stop("official processed count matrix contains an empty gene symbol")
  values <- suppressWarnings(as.numeric(unlist(lapply(fields, `[`, -1L), use.names = FALSE)))
  if (any(!is.finite(values)) || any(values < 0) || any(values != round(values))) {
    stop("official processed count matrix contains non-integer or invalid counts")
  }
  chunk_matrix <- matrix(values, nrow = length(lines), byrow = TRUE)
  chunk_pb <- vapply(
    samples$sample,
    function(sample) rowSums(chunk_matrix[, cell_sample == sample, drop = FALSE]),
    numeric(length(lines))
  )
  for (sample in samples$sample) {
    matrix_nnz[[sample]] <- matrix_nnz[[sample]] +
      sum(chunk_matrix[, cell_sample == sample, drop = FALSE] > 0)
  }
  chunk_index <- chunk_index + 1L
  gene_chunks[[chunk_index]] <- chunk_genes
  pseudobulk_chunks[[chunk_index]] <- chunk_pb
}
close(counts_con)
on.exit(NULL, add = FALSE)

genes <- unlist(gene_chunks, use.names = FALSE)
pseudobulk <- do.call(rbind, pseudobulk_chunks)
colnames(pseudobulk) <- samples$sample
rownames(pseudobulk) <- genes
if (!identical(dim(pseudobulk), c(23284L, 7L)) || length(genes) != 23284L ||
    anyNA(genes) || any(!nzchar(genes)) || anyDuplicated(genes) ||
    genes[[1L]] != "0610005C13Rik" || tail(genes, 1L) != "Zzz3" ||
    any(grepl("^ENSMUSG", genes)) ||
    !all(c("Actb", "Gapdh", "Bdnf", "Pomc", "Agrp") %in% genes)) {
  stop("official processed count matrix gene inventory changed")
}
if (any(!is.finite(pseudobulk)) || any(pseudobulk < 0) ||
    any(pseudobulk != round(pseudobulk))) {
  stop("seven-unit pseudobulk is not finite, nonnegative integer counts")
}

sample_qc <- copy(samples)
sample_qc[, `:=`(
  source_processed_unit = sample,
  cells = expected_cells,
  matrix_nnz = as.numeric(matrix_nnz[sample]),
  library_size = as.numeric(colSums(pseudobulk)[sample]),
  detected_genes = as.integer(colSums(pseudobulk > 0)[sample]),
  gene_rows = nrow(pseudobulk),
  clusters = uniqueN(clusters$cluster),
  genome_build = "mm9",
  count_conservation_delta = 0
)]
if (!identical(sample_qc$cells, samples$expected_cells) ||
    !identical(sample_qc$matrix_nnz, samples$expected_matrix_nnz) ||
    !identical(sample_qc$library_size, samples$expected_library_size) ||
    !identical(sample_qc$detected_genes, samples$expected_detected_genes) ||
    sum(sample_qc$cells) != 14437L || sum(sample_qc$library_size) != 47340924 ||
    sum(pseudobulk) != 47340924 || any(sample_qc$count_conservation_delta != 0)) {
  stop("seven-unit dimensions, sparsity, or count totals changed")
}

design <- model.matrix(
  ~ batch + group,
  data = transform(
    samples,
    batch = factor(batch, levels = paste0("B", 0:4)),
    group = factor(group, levels = c("control", "case"))
  )
)
if (sum(samples$group == "control") != 4L || sum(samples$group == "case") != 3L ||
    qr(design)$rank != ncol(design) || nrow(design) - qr(design)$rank != 1L ||
    !"groupcase" %in% colnames(design)) {
  stop("batch-adjusted deprived-minus-fed design is not full rank with one residual df")
}

samplesheet <- sample_qc[, .(
  sample, group, condition, batch, cells, source_processed_unit, genome_build
)]
output <- data.table(GeneName = genes)
output <- cbind(output, as.data.table(pseudobulk))

for (path in c(samplesheet_path, pseudobulk_path, sample_qc_path, cluster_qc_path)) {
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
}
fwrite(output, pseudobulk_path, sep = "\t", compress = "gzip")
fwrite(samplesheet, samplesheet_path, sep = "\t")
fwrite(sample_qc, sample_qc_path, sep = "\t")
fwrite(cluster_qc, cluster_qc_path, sep = "\t")

cat(sprintf(
  paste0(
    "prepared %s genes x %d official processed units from %s cells; ",
    "fed=%d deprived=%d; 47 clusters; batch-adjusted design rank %d/%d ",
    "with one residual df; library sizes %.3fM-%.3fM; exact count conservation\n"
  ),
  format(nrow(pseudobulk), big.mark = ",", scientific = FALSE), ncol(pseudobulk),
  format(sum(sample_qc$cells), big.mark = ",", scientific = FALSE),
  sum(samples$group == "control"), sum(samples$group == "case"),
  qr(design)$rank, ncol(design),
  min(sample_qc$library_size) / 1e6, max(sample_qc$library_size) / 1e6
))
