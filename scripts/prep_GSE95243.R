#!/usr/bin/env Rscript

# Extract the donor-level inherited-obesity contrast from GSE95243. The GEO
# workbook contains several assay populations and duplicates every raw-count
# column; both copies are required to agree exactly before one is retained.

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 5L) {
  stop(paste0(
    "usage: prep_GSE95243.R <family.soft.gz> <raw-read-counts.csv.gz> ",
    "<samplesheet.tsv> <clean-counts.tsv.gz> <qc.tsv>"
  ))
}

soft_path <- args[[1]]
source_path <- args[[2]]
samplesheet_path <- args[[3]]
counts_path <- args[[4]]
qc_path <- args[[5]]

lines <- readLines(gzfile(soft_path))
starts <- which(startsWith(lines, "^SAMPLE = "))
ends <- c(starts[-1] - 1L, length(lines))
field <- function(block, pattern) {
  hit <- grep(pattern, block, value = TRUE)
  if (length(hit)) sub(pattern, "", hit[[1]]) else NA_character_
}

metadata <- do.call(rbind, lapply(seq_along(starts), function(i) {
  block <- lines[starts[[i]]:ends[[i]]]
  data.frame(
    gsm = sub("^SAMPLE = ", "", block[[1]], fixed = TRUE),
    sample = field(block, "^!Sample_title = "),
    source = field(block, "^!Sample_source_name_ch1 = "),
    cell_type = field(block, "^!Sample_characteristics_ch1 = cell type: "),
    generation_source = field(block, "^!Sample_characteristics_ch1 = generation source: "),
    disease_state = field(block, "^!Sample_characteristics_ch1 = disease state: "),
    sex = field(block, "^!Sample_characteristics_ch1 = Sex: "),
    parent_line = field(block, "^!Sample_characteristics_ch1 = parent line: "),
    biosample = field(block, "^!Sample_relation = BioSample: https://www.ncbi.nlm.nih.gov/biosample/"),
    srx = field(block, "^!Sample_relation = SRA: https://www.ncbi.nlm.nih.gov/sra\\?term="),
    stringsAsFactors = FALSE
  )
}))

selected <- metadata[
  metadata$cell_type == "Hypothalamus neuron" &
  metadata$generation_source == "induced Pluripotent Stem Cells (iPSC)" &
  metadata$disease_state %in% c("Control", "Obese"),
  , drop = FALSE
]
selected$group <- ifelse(selected$disease_state == "Control", "control", "case")
if (nrow(selected) != 12L || sum(selected$group == "control") != 7L ||
    sum(selected$group == "case") != 5L || anyDuplicated(selected$parent_line) ||
    any(!selected$sex %in% c("F", "M"))) {
  stop("expected seven control and five obese iPSC hypothalamic-neuron donor lines")
}

source <- data.table::fread(source_path, header = TRUE, check.names = FALSE)
if (!all(c("Ensembl", "Gene") %in% names(source))) {
  stop("GEO raw-count workbook is missing Ensembl/Gene columns")
}
clean <- data.table::data.table(Ensembl_ID = as.character(source[["Ensembl"]]))
duplicate_raw_columns <- 0L
for (sample in selected$sample) {
  idx <- which(names(source) == paste0("raw-", sample))
  if (length(idx) != 2L) {
    stop(sprintf("expected two deposited raw-count columns for %s", sample))
  }
  left <- as.numeric(source[[idx[[1]]]])
  right <- as.numeric(source[[idx[[2]]]])
  if (!identical(left, right)) {
    stop(sprintf("duplicated raw-count columns disagree for %s", sample))
  }
  clean[[sample]] <- left
  duplicate_raw_columns <- duplicate_raw_columns + 1L
}

valid_ensembl <- grepl("^ENSG[0-9]+(?:\\.[0-9]+)?$", clean$Ensembl_ID)
noncanonical_feature_rows <- sum(!valid_ensembl)
grch_alt_region_rows <- sum(grepl("^ENSGR", clean$Ensembl_ID))
ercc_rows <- sum(grepl("^ERCC-", clean$Ensembl_ID))
clean <- clean[valid_ensembl]
duplicate_gene_rows <- sum(duplicated(clean$Ensembl_ID))
if (duplicate_gene_rows) {
  sample_columns <- setdiff(names(clean), "Ensembl_ID")
  clean <- clean[, lapply(.SD, sum), by = Ensembl_ID, .SDcols = sample_columns]
}
values <- as.matrix(clean[, -1])
if (any(!is.finite(values)) || any(values < 0)) {
  stop("selected source cells are not finite nonnegative deposited counts")
}
if (anyDuplicated(clean$Ensembl_ID) ||
    any(!grepl("^ENSG[0-9]+(?:\\.[0-9]+)?$", clean$Ensembl_ID))) {
  stop("cleaned matrix does not contain unique human Ensembl gene identifiers")
}

selected <- selected[match(names(clean)[-1], selected$sample), , drop = FALSE]
samplesheet <- selected[, c(
  "sample", "group", "sex", "disease_state", "gsm", "biosample", "srx", "parent_line"
)]
write.table(samplesheet, samplesheet_path, sep = "\t", quote = FALSE, row.names = FALSE)
data.table::fwrite(clean, counts_path, sep = "\t", compress = "gzip")

sex_group <- table(samplesheet$sex, samplesheet$group)
qc <- data.frame(
  metric = c(
    "source_rows", "unique_genes", "samples", "control_samples", "case_samples",
    "female_control", "female_case", "male_control", "male_case",
    "verified_duplicate_raw_columns", "duplicate_gene_rows_aggregated",
    "noncanonical_feature_rows_excluded", "grch_alt_region_rows_excluded",
    "ercc_spikein_rows_excluded",
    "nonfinite_cells", "negative_cells", "fractional_cells",
    "minimum_library_size", "maximum_library_size"
  ),
  value = c(
    nrow(source), nrow(clean), nrow(samplesheet),
    sum(samplesheet$group == "control"), sum(samplesheet$group == "case"),
    unname(sex_group["F", "control"]), unname(sex_group["F", "case"]),
    unname(sex_group["M", "control"]), unname(sex_group["M", "case"]),
    duplicate_raw_columns, duplicate_gene_rows,
    noncanonical_feature_rows, grch_alt_region_rows, ercc_rows,
    sum(!is.finite(values)), sum(values < 0), sum(values != round(values)),
    min(colSums(values)), max(colSums(values))
  ),
  stringsAsFactors = FALSE
)
write.table(qc, qc_path, sep = "\t", quote = FALSE, row.names = FALSE)

cat(sprintf(
  paste0(
    "prepared %d unique human Ensembl genes x %d independent donor lines ",
    "(%d control, %d obese); verified %d duplicated raw columns; ",
    "excluded %d noncanonical feature rows; library sizes %.0f..%.0f; ",
    "%d fractional software-estimated cells preserved\n"
  ),
  nrow(clean), nrow(samplesheet),
  sum(samplesheet$group == "control"), sum(samplesheet$group == "case"),
  duplicate_raw_columns, noncanonical_feature_rows,
  min(colSums(values)), max(colSums(values)),
  sum(values != round(values))
))
