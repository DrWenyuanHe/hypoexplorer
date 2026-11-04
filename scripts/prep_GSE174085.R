#!/usr/bin/env Rscript

# Aggregate deposited single-cell RNA counts from PVN CRH-expressing neurons
# to source-batch pseudobulk. Cells are nested observations and are never
# treated as biological replicates. GEO labels every L13 cell CTL, but the
# author Supplementary Table S1 identifies Batch-L13 as LBN. The pinned author
# supplement therefore supplies one explicit condition override after the GEO
# labels have been checked verbatim.

suppressPackageStartupMessages(library(data.table))

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 6L) {
  stop(paste0(
    "usage: prep_GSE174085.R <all-cells-matrix.txt.gz> <family.soft.gz> ",
    "<author-supplement.pdf> <samplesheet.tsv> <pseudobulk-counts.tsv.gz> <qc.tsv>"
  ))
}

matrix_path <- normalizePath(args[[1]], mustWork = TRUE)
soft_path <- normalizePath(args[[2]], mustWork = TRUE)
supplement_path <- normalizePath(args[[3]], mustWork = TRUE)
samplesheet_path <- args[[4]]
pseudobulk_path <- args[[5]]
qc_path <- args[[6]]

if (basename(matrix_path) != "GSE174085_new_allcells111620.matrix.txt.gz") {
  stop("unexpected GSE174085 source-matrix filename")
}
if (basename(soft_path) != "GSE174085_family.soft.gz") {
  stop("unexpected GSE174085 family-SOFT filename")
}
if (basename(supplement_path) != "GSE174085_author_Supplement.pdf") {
  stop("unexpected GSE174085 author-supplement filename")
}
if (!requireNamespace("openssl", quietly = TRUE)) {
  stop("the openssl R package is required to authenticate the author supplement")
}
supplement_connection <- file(supplement_path, "rb")
supplement_sha256 <- tryCatch(
  unclass(as.character(openssl::sha256(supplement_connection))),
  finally = close(supplement_connection)
)
expected_supplement_sha256 <-
  "7627060f875b87ca8a0fd94fb0952bdff0d81c4257fea80d1509759d1217f14a"
if (!identical(supplement_sha256, expected_supplement_sha256)) {
  stop("author supplement does not match the pinned PMC Supplementary Information")
}

deposited <- fread(matrix_path, check.names = FALSE, showProgress = FALSE)
if (ncol(deposited) < 3L || names(deposited)[[1L]] != "name") {
  stop("source matrix must contain name plus deposited single-cell columns")
}

source_ids <- as.character(deposited[[1L]])
id_match <- regexec("^(ENSMUSG[0-9]+(?:\\.[0-9]+)?)-(.+)$", source_ids)
id_parts <- regmatches(source_ids, id_match)
if (any(lengths(id_parts) != 3L)) {
  stop("source gene identifiers are not versioned Ensembl-symbol pairs")
}
symbols <- vapply(id_parts, `[[`, character(1), 3L)
if (anyNA(symbols) || any(!nzchar(symbols))) {
  stop("source matrix contains an empty gene symbol")
}

cell_ids <- names(deposited)[-1L]
cell_match <- regexec("^[^_]+_([BL][0-9]+)_(CTL|ELA)$", cell_ids)
cell_parts <- regmatches(cell_ids, cell_match)
if (any(lengths(cell_parts) != 3L) || anyDuplicated(cell_ids)) {
  stop("cell headers do not uniquely encode source animal and condition")
}
animals <- vapply(cell_parts, `[[`, character(1), 2L)
deposited_conditions <- vapply(cell_parts, `[[`, character(1), 3L)

# Cross-check every matrix cell against the official GEO sample records and
# recover age at collection for the animal-level adjustment.
soft <- readLines(gzfile(soft_path), warn = FALSE)
sample_starts <- grep("^\\^SAMPLE = ", soft)
sample_ends <- c(sample_starts[-1L] - 1L, length(soft))
soft_rows <- rbindlist(lapply(seq_along(sample_starts), function(i) {
  block <- soft[sample_starts[[i]]:sample_ends[[i]]]
  one <- function(pattern, label) {
    hit <- grep(pattern, block, value = TRUE)
    if (length(hit) != 1L) stop(sprintf("SOFT sample has %d %s fields", length(hit), label))
    sub(pattern, "", hit)
  }
  data.table(
    gsm = one("^\\^SAMPLE = ", "accession"),
    cell = one("^!Sample_title = ", "title"),
    condition = one("^!Sample_characteristics_ch1 = condition: ", "condition"),
    age = one("^!Sample_characteristics_ch1 = age at collection: ", "age")
  )
}))
if (nrow(soft_rows) != length(cell_ids) || anyDuplicated(soft_rows$gsm) ||
    anyDuplicated(soft_rows$cell) || !setequal(soft_rows$cell, cell_ids)) {
  stop("family SOFT does not map exactly one official record to every matrix cell")
}
soft_rows <- soft_rows[match(cell_ids, cell)]
if (!identical(soft_rows$condition, deposited_conditions) ||
    any(!soft_rows$age %in% c("P10", "P11", "P12"))) {
  stop("matrix header condition or age disagrees with official GEO metadata")
}

# Supplementary Table S1, page 5, row "Batch-L13" lists Condition=LBN,
# Postnatal Day=11, and 21 cells. LBN is the paper's name for the ELA paradigm.
# The table contains 511 post-QC cells rather than a recoverable cell whitelist,
# so only its deterministic batch-condition metadata is applied here.
condition_overrides <- data.table(
  animal = "L13",
  deposited_condition = "CTL",
  author_condition = "ELA",
  author_cell_count = 21L,
  condition_source = paste0(
    "Short et al. Supplementary Table S1 p.5, Batch-L13: ",
    "LBN (normalized to ELA)"
  )
)

animal_design <- unique(data.table(
  animal = animals,
  deposited_condition = deposited_conditions,
  age = soft_rows$age
))
if (anyDuplicated(animal_design$animal) || nrow(animal_design) != 24L) {
  stop("deposited columns do not resolve to one condition and age per source batch")
}
animal_design[, `:=`(
  condition = deposited_condition,
  condition_source = "GEO matrix header and family SOFT"
)]
for (i in seq_len(nrow(condition_overrides))) {
  override <- condition_overrides[i]
  target <- which(animal_design$animal == override$animal)
  if (length(target) != 1L ||
      animal_design$deposited_condition[target] != override$deposited_condition ||
      sum(animals == override$animal) != override$author_cell_count) {
    stop("L13 deposited metadata no longer matches the pinned author override preconditions")
  }
  animal_design$condition[target] <- override$author_condition
  animal_design$condition_source[target] <- override$condition_source
}
if (sum(animal_design$condition == "CTL") != 14L ||
    sum(animal_design$condition == "ELA") != 10L ||
    nrow(animal_design) != 24L) {
  stop("author-corrected metadata do not resolve to 14 CTL and 10 ELA batches")
}
animal_design[, group := fifelse(condition == "CTL", "control", "case")]
animal_design[, group_order := match(group, c("control", "case"))]
setorder(animal_design, group_order, animal)
animal_design[, group_order := NULL]

counts <- as.matrix(deposited[, -1L])
storage.mode(counts) <- "numeric"
if (any(!is.finite(counts)) || any(counts < 0) ||
    any(counts != round(counts))) {
  stop("source matrix is not finite nonnegative integer counts")
}

# First aggregate cells to animals, then duplicate source rows to gene symbols.
animal_counts <- vapply(
  animal_design$animal,
  function(animal) rowSums(counts[, animals == animal, drop = FALSE]),
  numeric(nrow(counts))
)
dimnames(animal_counts) <- list(symbols, animal_design$animal)
source_total <- sum(counts)
if (!identical(as.numeric(sum(animal_counts)), as.numeric(source_total))) {
  stop("cell-to-animal aggregation does not conserve counts")
}

pseudobulk <- rowsum(animal_counts, group = symbols, reorder = TRUE)
if (any(!is.finite(pseudobulk)) || any(pseudobulk < 0) ||
    any(pseudobulk != round(pseudobulk)) ||
    !identical(as.numeric(sum(pseudobulk)), as.numeric(source_total))) {
  stop("symbol-level pseudobulk is invalid or loses source counts")
}

cell_library_sizes <- colSums(counts)
cells_by_animal <- as.integer(table(factor(animals, levels = animal_design$animal)))
animal_library_sizes <- colSums(pseudobulk)
qc <- data.table(
  sample = animal_design$animal,
  group = animal_design$group,
  deposited_condition = animal_design$deposited_condition,
  condition = animal_design$condition,
  condition_source = animal_design$condition_source,
  age = animal_design$age,
  animal = animal_design$animal,
  cells = cells_by_animal,
  source_gene_rows = nrow(counts),
  merged_gene_rows = nrow(pseudobulk),
  library_size = as.numeric(animal_library_sizes),
  detected_genes = colSums(pseudobulk > 0),
  zero_count_cells = vapply(
    animal_design$animal,
    function(animal) sum(cell_library_sizes[animals == animal] == 0),
    integer(1)
  ),
  min_cell_counts = vapply(
    animal_design$animal,
    function(animal) min(cell_library_sizes[animals == animal]),
    numeric(1)
  ),
  median_cell_counts = vapply(
    animal_design$animal,
    function(animal) median(cell_library_sizes[animals == animal]),
    numeric(1)
  ),
  count_conservation_delta = as.numeric(animal_library_sizes) -
    vapply(
      animal_design$animal,
      function(animal) sum(cell_library_sizes[animals == animal]),
      numeric(1)
    )
)
qc[, low_cell_yield := cells < 0.25 * median(cells)]

if (any(qc$cells <= 0L) || any(qc$library_size <= 0) ||
    any(qc$detected_genes <= 0L) || any(qc$count_conservation_delta != 0)) {
  stop("source-batch pseudobulk fails positive-library or count-conservation QC")
}

l13 <- qc[sample == "L13"]
if (nrow(l13) != 1L || l13$deposited_condition != "CTL" ||
    l13$condition != "ELA" || l13$group != "case" ||
    l13$cells != 21L || l13$count_conservation_delta != 0) {
  stop("L13 author override or count-conservation assertion failed")
}

expected_cells <- c(12L, 8L, 27L, 7L, 22L, 15L, 9L, 13L, 3L, 25L,
                    23L, 22L, 20L, 57L, 26L, 88L, 28L, 21L, 4L, 5L,
                    80L, 70L, 15L, 2L)
expected_library_sizes <- c(
  15368729, 12203915, 39585773, 3977093, 20315450, 20317011,
  10005638, 15105828, 3666068, 21993474, 26533598, 30829213,
  16628438, 54021667, 44414787, 100454179, 29141086, 27974971,
  3760121, 8659938, 103530095, 116172070, 46558465, 4656360
)
if (nrow(counts) != 35849L || ncol(counts) != 602L ||
    nrow(pseudobulk) != 35805L ||
    !identical(qc$cells, expected_cells) ||
    !identical(as.numeric(qc$library_size), expected_library_sizes) ||
    sum(qc$zero_count_cells) != 3L ||
    !identical(qc[low_cell_yield == TRUE, animal], c("B31", "L14", "L15", "L9"))) {
  stop("deposited GSE174085 dimensions, library totals, or low-yield watch list changed")
}

samplesheet <- qc[, .(
  sample, group, deposited_condition, condition, condition_source,
  age, animal, cells, low_cell_yield
)]
output <- data.table(GeneName = rownames(pseudobulk))
output <- cbind(output, as.data.table(pseudobulk))

dir.create(dirname(samplesheet_path), recursive = TRUE, showWarnings = FALSE)
dir.create(dirname(pseudobulk_path), recursive = TRUE, showWarnings = FALSE)
dir.create(dirname(qc_path), recursive = TRUE, showWarnings = FALSE)
fwrite(output, pseudobulk_path, sep = "\t", compress = "gzip")
fwrite(samplesheet, samplesheet_path, sep = "\t")
fwrite(qc, qc_path, sep = "\t")

cat(sprintf(
  paste0(
    "prepared %s merged genes x %d source batches from %d deposited cells; ",
    "CTL=%d ELA=%d; batch cells %d-%d; library sizes %.3fM-%.3fM; ",
    "exact count conservation\n"
  ),
  format(nrow(pseudobulk), big.mark = ",", scientific = FALSE),
  ncol(pseudobulk), ncol(counts),
  sum(animal_design$condition == "CTL"),
  sum(animal_design$condition == "ELA"),
  min(qc$cells), max(qc$cells),
  min(qc$library_size) / 1e6, max(qc$library_size) / 1e6
))
