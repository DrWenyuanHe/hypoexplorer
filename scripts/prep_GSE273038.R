#!/usr/bin/env Rscript

# Convert the deposited IRISeq spatial matrix into animal-level hypothalamus
# pseudobulk counts. Spots and sections are nested measurements; the six mice
# (three AL and three CR) are the biological replicates used by the runner.

suppressPackageStartupMessages({
  library(Matrix)
  library(data.table)
})

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 6L) {
  stop(paste0(
    "usage: prep_GSE273038.R <gene-count.mtx.gz> <gene-metadata.gz> ",
    "<cell-metadata.gz> <samplesheet.tsv> <pseudobulk-counts.tsv.gz> <qc.tsv>"
  ))
}

count_path <- args[[1]]
genes_path <- args[[2]]
metadata_path <- args[[3]]
samplesheet_path <- args[[4]]
pseudobulk_path <- args[[5]]
qc_path <- args[[6]]

gene_lines <- readLines(gzfile(genes_path))
if (!length(gene_lines) || gene_lines[[1]] != "gene_id") {
  stop("gene metadata does not have the expected gene_id header")
}
genes <- gene_lines[-1]
if (length(genes) != 19057L || any(!nzchar(genes)) || anyDuplicated(genes)) {
  stop("expected 19057 unique, nonempty gene symbols")
}

metadata <- read.csv(gzfile(metadata_path), check.names = FALSE, stringsAsFactors = FALSE)
expected_columns <- c(
  "sample", "Size_Factor", "Condition", "Brain_ID", "Section_ID",
  "region_annotation", "Gene_expression_UMAP1", "Gene_expression_UMAP2",
  "Spatial_UMAP1", "Spatial_UMAP2"
)
if (!identical(names(metadata), expected_columns)) {
  stop("cell metadata schema differs from the deposited contract")
}
if (nrow(metadata) != 65128L || any(!nzchar(metadata$sample)) ||
    anyDuplicated(metadata$sample)) {
  stop("expected 65128 unique, nonempty spatial sample IDs")
}
identity_fields <- c(
  "sample", "Size_Factor", "Condition", "Brain_ID", "Section_ID",
  "region_annotation"
)
if (any(!complete.cases(metadata[, identity_fields, drop = FALSE]))) {
  stop("cell metadata has missing identity or design fields")
}

animal <- sub(
  "^20240529_((AL|CR)[0-9]+)_[12]_cDNA\\..+$", "\\1",
  metadata$sample, perl = TRUE
)
section <- sub(
  "^20240529_(AL|CR)[0-9]+_([12])_cDNA\\..+$", "\\2",
  metadata$sample, perl = TRUE
)
animals <- c("AL21", "AL28", "AL30", "CR17", "CR20", "CR24")
if (any(!animal %in% animals) || any(!section %in% c("1", "2"))) {
  stop("could not parse every expected animal and section from sample IDs")
}
expected_condition <- ifelse(startsWith(animal, "AL"), "AL", "CR")
if (!identical(metadata$Condition, expected_condition)) {
  stop("sample ID and deposited condition disagree")
}
expected_brain <- c(AL21 = 4L, AL28 = 5L, AL30 = 6L, CR17 = 1L, CR20 = 2L, CR24 = 3L)
if (!identical(as.integer(metadata$Brain_ID), unname(expected_brain[animal]))) {
  stop("sample ID and deposited Brain_ID disagree")
}
if (!identical(metadata$Section_ID, paste0("Section_", section))) {
  stop("sample ID and deposited Section_ID disagree")
}
if (!setequal(unique(animal), animals)) stop("not all six animals are present")
if (any(table(factor(animal, levels = animals), factor(section, levels = c("1", "2"))) == 0L)) {
  stop("each animal must contribute both spatial sections")
}

group <- ifelse(startsWith(animals, "AL"), "control", "case")
if (!identical(as.integer(table(group)), c(3L, 3L))) {
  stop("animal-level contrast must contain three AL and three CR mice")
}

header <- readLines(gzfile(count_path), n = 1L)
if (!identical(header, "%%MatrixMarket matrix coordinate integer general")) {
  stop("count matrix is not an integer Matrix Market coordinate file")
}

cat("reading deposited sparse matrix (130,362,291 nonzero entries)...\n")
connection <- gzfile(count_path, open = "rt")
counts <- readMM(connection)
close(connection)
if (!identical(dim(counts), c(length(genes), nrow(metadata)))) {
  stop(sprintf(
    "matrix dimensions %s do not match %d genes x %d metadata rows",
    paste(dim(counts), collapse = " x "), length(genes), nrow(metadata)
  ))
}
matrix_nnz <- length(counts@x)
if (matrix_nnz != 130362291L) stop("matrix nonzero-entry count changed")
if (any(!is.finite(counts@x) | counts@x <= 0 | counts@x != round(counts@x))) {
  stop("count matrix contains nonfinite, nonpositive, or noninteger stored values")
}

# GEO supplies no separate barcode sidecar. The deposited Size_Factor is the
# raw column library size divided by its geometric mean, so it independently
# verifies every matrix column against the metadata row in the same position.
matrix_spot_counts <- as.numeric(colSums(counts))
if (any(!is.finite(matrix_spot_counts) | matrix_spot_counts <= 0)) {
  stop("matrix contains an empty or invalid spatial column")
}
size_factor_scale <- exp(mean(log(matrix_spot_counts)))
normalized_library_size <- matrix_spot_counts / size_factor_scale
size_factor_max_abs_delta <- max(abs(normalized_library_size - metadata$Size_Factor))
size_factor_ratio <- matrix_spot_counts / metadata$Size_Factor
size_factor_relative_spread <- diff(range(size_factor_ratio)) / mean(size_factor_ratio)
if (!is.finite(size_factor_max_abs_delta) || size_factor_max_abs_delta >= 1e-12 ||
    !is.finite(size_factor_relative_spread) || size_factor_relative_spread >= 1e-12) {
  stop(sprintf(
    "matrix/metadata Size_Factor identity failed (max delta %.3g; relative spread %.3g)",
    size_factor_max_abs_delta, size_factor_relative_spread
  ))
}

target_annotation <- "Hypothalamus"
selected <- which(metadata$region_annotation == target_annotation)
if (length(selected) != 6124L) {
  stop(sprintf("expected 6124 hypothalamic spots, found %d", length(selected)))
}
selected_animal <- animal[selected]
selected_section <- section[selected]
section_counts <- table(
  factor(selected_animal, levels = animals),
  factor(selected_section, levels = c("1", "2"))
)
expected_section_counts <- matrix(
  c(312L, 685L, 814L, 105L, 261L, 321L,
    748L, 398L, 815L, 798L, 356L, 511L),
  nrow = 6L, byrow = TRUE,
  dimnames = list(animals, c("1", "2"))
)
if (!all(as.matrix(section_counts) == expected_section_counts)) {
  stop("hypothalamic per-animal/per-section spot counts changed")
}

hypothalamus <- counts[, selected, drop = FALSE]
rm(counts)
gc()

animal_index <- match(selected_animal, animals)
aggregator <- sparseMatrix(
  i = seq_along(animal_index), j = animal_index, x = 1,
  dims = c(length(animal_index), length(animals))
)
pseudobulk <- as.matrix(hypothalamus %*% aggregator)
colnames(pseudobulk) <- animals
rownames(pseudobulk) <- genes
if (any(!is.finite(pseudobulk)) || any(pseudobulk < 0) ||
    any(pseudobulk != round(pseudobulk))) {
  stop("animal-level pseudobulk is not finite, nonnegative integer counts")
}

pseudobulk_library_sizes <- as.numeric(colSums(pseudobulk))
selected_metadata_counts <- as.numeric(tapply(
  matrix_spot_counts[selected],
  factor(selected_animal, levels = animals),
  sum
))
count_conservation_delta <- pseudobulk_library_sizes - selected_metadata_counts
if (any(!is.finite(count_conservation_delta)) || any(count_conservation_delta != 0)) {
  stop("animal-level pseudobulk does not conserve selected spot counts exactly")
}
expected_library_sizes <- c(5556676, 4586657, 1558608, 6150255, 7601454, 2701396)
if (!identical(pseudobulk_library_sizes, expected_library_sizes)) {
  stop("animal-level hypothalamic library sizes changed")
}

samplesheet <- data.frame(
  sample = animals,
  group = group,
  condition = ifelse(group == "control", "ad_libitum", "caloric_restriction"),
  age = "24_months",
  sex = "male",
  sections = 2L,
  section_1_spots = as.integer(section_counts[, "1"]),
  section_2_spots = as.integer(section_counts[, "2"]),
  spots = as.integer(rowSums(section_counts)),
  stringsAsFactors = FALSE
)

output <- data.table(GeneName = genes)
output <- cbind(output, as.data.table(pseudobulk))
fwrite(output, pseudobulk_path, sep = "\t", compress = "gzip")
write.table(samplesheet, samplesheet_path, sep = "\t", quote = FALSE, row.names = FALSE)

qc <- data.frame(
  sample = animals,
  group = group,
  condition = samplesheet$condition,
  age = samplesheet$age,
  sex = samplesheet$sex,
  sections = samplesheet$sections,
  section_1_spots = samplesheet$section_1_spots,
  section_2_spots = samplesheet$section_2_spots,
  spots = samplesheet$spots,
  library_size = pseudobulk_library_sizes,
  detected_genes = colSums(pseudobulk > 0),
  median_spot_counts = vapply(
    animals,
    function(id) median(matrix_spot_counts[selected][selected_animal == id]),
    numeric(1)
  ),
  matrix_rows = nrow(pseudobulk),
  matrix_cols = length(matrix_spot_counts),
  matrix_nnz = matrix_nnz,
  target_annotation = target_annotation,
  selected_spot_counts = sum(matrix_spot_counts[selected]),
  size_factor_scale = size_factor_scale,
  size_factor_relative_spread = size_factor_relative_spread,
  size_factor_max_abs_delta = size_factor_max_abs_delta,
  column_alignment = "exact_size_factor_geomean_identity",
  count_conservation_delta = count_conservation_delta,
  stringsAsFactors = FALSE
)
write.table(qc, qc_path, sep = "\t", quote = FALSE, row.names = FALSE)

cat(sprintf(
  paste0(
    "prepared %d genes x %d animals from %d hypothalamic spots; ",
    "control=%d case=%d; library sizes %.1fM-%.1fM; ",
    "Size_Factor alignment max delta %.3g\n"
  ),
  nrow(pseudobulk), ncol(pseudobulk), length(selected),
  sum(group == "control"), sum(group == "case"),
  min(pseudobulk_library_sizes) / 1e6, max(pseudobulk_library_sizes) / 1e6,
  size_factor_max_abs_delta
))
