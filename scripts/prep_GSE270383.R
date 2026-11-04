#!/usr/bin/env Rscript

# Convert the deposited IRISeq spatial matrix into animal-level hypothalamus
# pseudobulk counts. Spots and sections are nested measurements; the six mice
# (FY1-3 and FO1-3) are the biological replicates used by the standard runner.

suppressPackageStartupMessages({
  library(Matrix)
  library(data.table)
})

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 7L) {
  stop(paste0(
    "usage: prep_GSE270383.R <count.mtx.gz> <genes.tsv.gz> <barcodes.tsv.gz> ",
    "<metadata.csv.gz> <samplesheet.tsv> <pseudobulk-counts.tsv.gz> <qc.tsv>"
  ))
}

count_path <- args[[1]]
genes_path <- args[[2]]
barcodes_path <- args[[3]]
metadata_path <- args[[4]]
samplesheet_path <- args[[5]]
pseudobulk_path <- args[[6]]
qc_path <- args[[7]]

genes <- readLines(gzfile(genes_path))
barcodes <- readLines(gzfile(barcodes_path))
metadata <- read.csv(gzfile(metadata_path), check.names = FALSE, stringsAsFactors = FALSE)
spot_ids <- as.character(metadata[[1]])

if (!length(genes) || anyDuplicated(genes)) stop("gene symbols are empty or duplicated")
if (!length(barcodes) || anyDuplicated(barcodes)) stop("barcodes are empty or duplicated")
required <- c("orig.ident", "nCount_RNA", "nFeature_RNA", "Annotation")
if (length(setdiff(required, names(metadata)))) stop("metadata is missing required columns")
if (!identical(spot_ids, barcodes)) stop("deposited metadata IDs do not match barcodes")
if (nrow(metadata) != length(barcodes)) stop("metadata and barcode row counts differ")

# The deposited metadata ID column is in matrix/barcode order, but its value
# rows were serialized in an interleaved order. Barcode prefixes form 24
# contiguous sample blocks, while stable-filtering the metadata values by those
# sample IDs recovers the matrix order exactly. Keep this repair fail-closed:
# the raw nCount and nFeature values must match every matrix column after it.
barcode_sample <- sub(
  "^[0-9]+_(F[YO][1-3]_[2-5])_cDNA\\..+$", "\\1", barcodes
)
if (any(!grepl("^F[YO][1-3]_[2-5]$", barcode_sample))) {
  stop("could not parse every sample ID from deposited barcodes")
}
block_lengths <- rle(barcode_sample)
block_order <- block_lengths$values
if (length(block_order) != 24L || anyDuplicated(block_order)) {
  stop("barcodes do not form the expected 24 unique contiguous sample blocks")
}
if (!setequal(block_order, unique(metadata$orig.ident))) {
  stop("barcode and metadata sample IDs differ")
}
metadata_order <- unlist(
  lapply(block_order, function(id) which(metadata$orig.ident == id)),
  use.names = FALSE
)
if (length(metadata_order) != nrow(metadata) || anyDuplicated(metadata_order)) {
  stop("metadata sample-block reconstruction is not a complete permutation")
}
metadata_rows_reordered <- sum(metadata_order != seq_len(nrow(metadata)))
deposited_sample_matches <- sum(metadata$orig.ident == barcode_sample)
deposited_nCount <- metadata$nCount_RNA
deposited_nFeature <- metadata$nFeature_RNA
metadata <- metadata[metadata_order, , drop = FALSE]
metadata[[1]] <- barcodes
if (!identical(as.character(metadata$orig.ident), barcode_sample)) {
  stop("reconstructed metadata sample IDs do not match barcode prefixes")
}

# The deposited label is misspelled "Hypotalamus"; pin the exact value so a
# future annotation change cannot silently broaden the anatomical selection.
animals <- c("FY1", "FY2", "FY3", "FO1", "FO2", "FO3")
group <- ifelse(startsWith(animals, "FY"), "control", "case")
if (!identical(as.integer(table(group)), c(3L, 3L))) {
  stop("animal-level contrast must contain three young and three old mice")
}

header <- readLines(gzfile(count_path), n = 1L)
if (!identical(header, "%%MatrixMarket matrix coordinate integer general")) {
  stop("count matrix is not an integer Matrix Market coordinate file")
}

cat("reading deposited sparse matrix (192,438,512 nonzero entries)...\n")
connection <- gzfile(count_path, open = "rt")
counts <- readMM(connection)
close(connection)
if (!identical(dim(counts), c(length(genes), length(barcodes)))) {
  stop(sprintf(
    "matrix dimensions %s do not match %d genes x %d barcodes",
    paste(dim(counts), collapse = " x "), length(genes), length(barcodes)
  ))
}
if (length(counts@x) != 192438512L) {
  stop(sprintf(
    "matrix has %s stored nonzero entries; expected 192,438,512",
    format(length(counts@x), big.mark = ",", scientific = FALSE)
  ))
}
if (any(!is.finite(counts@x) | counts@x <= 0)) {
  stop("count matrix contains nonfinite or nonpositive stored values")
}

matrix_spot_counts <- as.numeric(colSums(counts))
matrix_spot_features <- tabulate(counts@j + 1L, nbins = ncol(counts))
deposited_nCount_matches <- sum(matrix_spot_counts == deposited_nCount)
deposited_nFeature_matches <- sum(matrix_spot_features == deposited_nFeature)
count_delta <- matrix_spot_counts - metadata$nCount_RNA
feature_delta <- matrix_spot_features - metadata$nFeature_RNA
if (any(!is.finite(count_delta)) || any(count_delta != 0)) {
  stop(sprintf(
    "reconstructed matrix/metadata nCount mismatch (%d columns; max delta %.3f)",
    sum(count_delta != 0), max(abs(count_delta))
  ))
}
if (any(!is.finite(feature_delta)) || any(feature_delta != 0)) {
  stop(sprintf(
    "reconstructed matrix/metadata nFeature mismatch (%d columns; max delta %.3f)",
    sum(feature_delta != 0), max(abs(feature_delta))
  ))
}

# The deposited label is misspelled "Hypotalamus"; pin the exact value so a
# future annotation change cannot silently broaden the anatomical selection.
target_annotation <- "Hypotalamus_section3_4"
selected <- which(metadata$Annotation == target_annotation)
if (length(selected) != 4476L) {
  stop(sprintf("expected 4476 hypothalamic spots, found %d", length(selected)))
}

selected_meta <- metadata[selected, , drop = FALSE]
selected_meta$animal <- sub("_[0-9]+$", "", selected_meta$orig.ident)
selected_meta$section <- sub("^.*_", "", selected_meta$orig.ident)
if (!setequal(unique(selected_meta$animal), animals)) stop("unexpected animal IDs")
if (!setequal(unique(selected_meta$section), c("4", "5"))) stop("unexpected section IDs")
section_table <- table(selected_meta$animal, selected_meta$section)
if (any(section_table[animals, , drop = FALSE] == 0L)) {
  stop("each animal must contribute both hypothalamic sections")
}

hypothalamus <- counts[, selected, drop = FALSE]
rm(counts)
gc()

animal_index <- match(selected_meta$animal, animals)
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
  selected_meta$nCount_RNA,
  factor(selected_meta$animal, levels = animals),
  sum
))
count_conservation_delta <- pseudobulk_library_sizes - selected_metadata_counts
if (any(!is.finite(count_conservation_delta)) || any(count_conservation_delta != 0)) {
  stop("animal-level pseudobulk does not conserve selected spot counts exactly")
}
if (sum(pseudobulk_library_sizes) != sum(matrix_spot_counts[selected])) {
  stop("total selected counts were not conserved during animal aggregation")
}

section_counts <- table(
  factor(selected_meta$animal, levels = animals),
  factor(selected_meta$section, levels = c("4", "5"))
)

samplesheet <- data.frame(
  sample = animals,
  group = group,
  age = ifelse(group == "control", "4_months", "23_months"),
  spots = as.integer(table(factor(selected_meta$animal, levels = animals))),
  sections = 2L,
  section_4_spots = as.integer(section_counts[, "4"]),
  section_5_spots = as.integer(section_counts[, "5"]),
  stringsAsFactors = FALSE
)
if (any(samplesheet$spots < 1L)) stop("an animal has no retained hypothalamic spots")

output <- data.table(GeneName = genes)
output <- cbind(output, as.data.table(pseudobulk))
fwrite(output, pseudobulk_path, sep = "\t", compress = "gzip")
write.table(samplesheet, samplesheet_path, sep = "\t", quote = FALSE, row.names = FALSE)

qc <- data.frame(
  sample = animals,
  group = group,
  age = samplesheet$age,
  sections = samplesheet$sections,
  section_4_spots = samplesheet$section_4_spots,
  section_5_spots = samplesheet$section_5_spots,
  spots = samplesheet$spots,
  library_size = pseudobulk_library_sizes,
  median_spot_counts = vapply(
    animals,
    function(id) median(selected_meta$nCount_RNA[selected_meta$animal == id]),
    numeric(1)
  ),
  median_spot_features = vapply(
    animals,
    function(id) median(selected_meta$nFeature_RNA[selected_meta$animal == id]),
    numeric(1)
  ),
  metadata_repair = "stable_sample_block_reorder",
  metadata_sample_block_order = paste(block_order, collapse = ","),
  metadata_rows_reordered = metadata_rows_reordered,
  deposited_sample_matches = deposited_sample_matches,
  deposited_nCount_matches = deposited_nCount_matches,
  deposited_nFeature_matches = deposited_nFeature_matches,
  reconstructed_sample_matches = length(barcodes),
  nCount_mismatches_after_repair = sum(count_delta != 0),
  nFeature_mismatches_after_repair = sum(feature_delta != 0),
  target_annotation = target_annotation,
  selected_spot_counts = sum(matrix_spot_counts[selected]),
  count_conservation_delta = count_conservation_delta,
  stringsAsFactors = FALSE
)
write.table(qc, qc_path, sep = "\t", quote = FALSE, row.names = FALSE)

cat(sprintf(
  paste0(
    "prepared %d genes x %d animals from %d hypothalamic spots; ",
    "control=%d case=%d; library sizes %.1fM-%.1fM; ",
    "metadata reconstruction exact for %d matrix columns\n"
  ),
  nrow(pseudobulk), ncol(pseudobulk), length(selected),
  sum(group == "control"), sum(group == "case"),
  min(colSums(pseudobulk)) / 1e6, max(colSums(pseudobulk)) / 1e6,
  length(barcodes)
))
