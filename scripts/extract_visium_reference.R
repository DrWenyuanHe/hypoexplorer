# Extract the donor x region tables of the human HYPOMAP Visium object for the
# expression survey's Visium reference (scripts/build_visium_reference.mts).
#
#   Rscript scripts/extract_visium_reference.R <humanHYPOMAP_spatial.rds> <out-dir>
#
# The builder runs this from `--fetch` after checking the RDS's size, MD5 and
# SHA-256; it can also be run by hand. Needs SeuratObject (to deserialize the
# Seurat V4 object) and Matrix. The output is integer sums, so it does not
# depend on the R or package version; the builder pins its SHA-256.
#
# Writes four LF-only, tab-separated files to <out-dir>:
#   cells.tsv     one row per donor x region cell (authors' grouped region label,
#                 summed across that donor's sections): cell, donor, region,
#                 spots, sections, library (sum of the cell's spot counts)
#   counts.tsv    gene, then one integer count column per cell, cells in cells.tsv
#                 order, genes in the object's panel order
#   sections.tsv  spots per donor x section x region (section coverage)
#   labels.tsv    the authors' named region label, its grouped label and spots
#
# Donors appear only as display-local labels (Donor 1-7, numbered in the C-locale
# order of the source donor codes). Source donor codes, sex, age, BMI and spot
# coordinates are not written.
suppressPackageStartupMessages({ library(SeuratObject); library(Matrix) })

args <- commandArgs(trailingOnly = TRUE)
stopifnot(length(args) == 2)
rds <- args[[1]]
out <- args[[2]]
dir.create(out, recursive = TRUE, showWarnings = FALSE)

obj <- readRDS(rds)
counts <- GetAssayData(obj, assay = "Spatial", slot = "counts")
stopifnot(inherits(counts, "dgCMatrix"), all(counts@x == round(counts@x)), all(counts@x >= 0))
md <- obj@meta.data
stopifnot(identical(rownames(md), colnames(counts)))

# Section of each spot, from the object's images.
section <- rep(NA_character_, ncol(counts))
for (im in Images(obj)) {
  hit <- match(rownames(GetTissueCoordinates(obj[[im]])), colnames(counts))
  stopifnot(!anyNA(hit))
  section[hit] <- im
}
stopifnot(!anyNA(section), !anyNA(md$donorID), !anyNA(md$regional_clusters_grouped))

codes <- sort(unique(as.character(md$donorID)), method = "radix")
donor <- paste("Donor", match(as.character(md$donorID), codes))
region <- as.character(md$regional_clusters_grouped)
named <- as.character(md$regional_clusters_named)
library_size <- Matrix::colSums(counts)

key <- paste(donor, region, sep = "\t")
cell_keys <- sort(unique(key), method = "radix")
cell_of_spot <- match(key, cell_keys)
indicator <- sparseMatrix(i = seq_len(ncol(counts)), j = cell_of_spot, x = 1, dims = c(ncol(counts), length(cell_keys)))
summed <- as.matrix(counts %*% indicator)
stopifnot(all(summed == round(summed)), max(summed) < 2^53)

parts <- do.call(rbind, strsplit(cell_keys, "\t", fixed = TRUE))
cell_id <- sprintf("c%03d", seq_along(cell_keys))
cells <- data.frame(
  cell = cell_id, donor = parts[, 1], region = parts[, 2],
  spots = as.integer(tabulate(cell_of_spot, length(cell_keys))),
  sections = as.integer(vapply(seq_along(cell_keys), function(j) length(unique(section[cell_of_spot == j])), 1L)),
  library = vapply(seq_along(cell_keys), function(j) sum(library_size[cell_of_spot == j]), 1),
  stringsAsFactors = FALSE
)
stopifnot(all(colSums(summed) == cells$library))

fmt <- function(x) formatC(x, format = "f", digits = 0, big.mark = "")
write_lines <- function(lines, file) {
  con <- file(file.path(out, file), open = "wb")
  writeLines(lines, con, sep = "\n", useBytes = TRUE)
  close(con)
}

write_lines(c(paste("cell", "donor", "region", "spots", "sections", "library", sep = "\t"),
  paste(cells$cell, cells$donor, cells$region, cells$spots, cells$sections, fmt(cells$library), sep = "\t")), "cells.tsv")

body <- apply(summed, 2, fmt)
if (is.null(dim(body))) body <- matrix(body, nrow = nrow(summed))
write_lines(c(paste(c("gene", cell_id), collapse = "\t"),
  paste(rownames(counts), apply(body, 1, paste, collapse = "\t"), sep = "\t")), "counts.tsv")

sec <- aggregate(list(spots = rep(1L, ncol(counts))), list(donor = donor, section = section, region = region), sum)
sec <- sec[order(sec$donor, sec$section, sec$region, method = "radix"), ]
write_lines(c(paste("donor", "section", "region", "spots", sep = "\t"),
  paste(sec$donor, sec$section, sec$region, sec$spots, sep = "\t")), "sections.tsv")

lab <- aggregate(list(spots = rep(1L, ncol(counts))), list(named = named, grouped = region), sum)
lab <- lab[order(lab$grouped, lab$named, method = "radix"), ]
write_lines(c(paste("named", "grouped", "spots", sep = "\t"),
  paste(lab$named, lab$grouped, lab$spots, sep = "\t")), "labels.tsv")

cat(sprintf("%d spots, %d genes, %d sections, %d donors, %d donor x region cells; library total %s\n",
  ncol(counts), nrow(counts), length(unique(section)), length(codes), nrow(cells), fmt(sum(library_size))))
