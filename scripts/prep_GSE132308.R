#!/usr/bin/env Rscript

# Prepare the matched-ZT6 spontaneous-sleep versus sleep-deprivation contrast
# from GSE132308 / PRJNA547578 galaninergic VLPO neuron libraries.

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 5L) {
  stop("usage: prep_GSE132308.R <family.soft.gz> <raw-counts.txt.gz> <samplesheet.tsv> <clean-counts.tsv.gz> <qc.tsv>")
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
    behavior = field(block, "^!Sample_characteristics_ch1 = behavior: "),
    timepoint = field(block, "^!Sample_characteristics_ch1 = timepoint: "),
    biosample = field(block, "^!Sample_relation = BioSample: https://www.ncbi.nlm.nih.gov/biosample/"),
    srx = field(block, "^!Sample_relation = SRA: https://www.ncbi.nlm.nih.gov/sra\\?term="),
    stringsAsFactors = FALSE
  )
}))

selected <- metadata[metadata$timepoint == "ZT6" & metadata$behavior %in% c("SS", "SD"), , drop = FALSE]
selected$group <- ifelse(selected$behavior == "SS", "control", "case")
if (nrow(selected) != 12L || sum(selected$group == "control") != 6L ||
    sum(selected$group == "case") != 6L || anyDuplicated(selected$sample) ||
    anyDuplicated(selected$gsm) || anyDuplicated(selected$biosample) ||
    anyDuplicated(selected$srx)) {
  stop("expected six independent ZT6 spontaneous-sleep and six ZT6 sleep-deprivation libraries")
}

source <- data.table::fread(source_path, header = TRUE, check.names = FALSE)
expected_columns <- c("id", selected$sample)
if (!all(expected_columns %in% names(source))) {
  stop("raw-count matrix does not contain every selected ZT6 sample")
}
clean <- source[, ..expected_columns]
ids <- as.character(clean$id)
values <- as.matrix(clean[, -1])
storage.mode(values) <- "numeric"
valid_id <- !is.na(ids) & grepl("^ENSMUSG[0-9]+(?:\\.[0-9]+)?$", ids)
invalid_feature_rows <- sum(!valid_id)
clean <- clean[valid_id]
ids <- ids[valid_id]
values <- values[valid_id, , drop = FALSE]
if (anyDuplicated(ids)) {
  stop("selected matrix contains duplicated mouse Ensembl identifiers")
}
if (any(!is.finite(values)) || any(values < 0) || any(values != round(values))) {
  stop("selected matrix must contain finite nonnegative integer counts")
}

selected <- selected[match(names(clean)[-1], selected$sample), , drop = FALSE]
samplesheet <- selected[, c("sample", "group", "behavior", "timepoint", "gsm", "biosample", "srx")]
write.table(samplesheet, samplesheet_path, sep = "\t", quote = FALSE, row.names = FALSE)
data.table::fwrite(clean, counts_path, sep = "\t", compress = "gzip")

qc <- data.frame(
  metric = c(
    "source_rows", "unique_genes", "samples", "spontaneous_sleep_samples",
    "sleep_deprivation_samples", "invalid_feature_rows_excluded", "duplicate_gene_ids",
    "nonfinite_cells", "negative_cells", "fractional_cells", "minimum_library_size",
    "maximum_library_size"
  ),
  value = c(
    nrow(source), nrow(clean), ncol(values), sum(selected$group == "control"),
    sum(selected$group == "case"), invalid_feature_rows, sum(duplicated(ids)),
    sum(!is.finite(values)), sum(values < 0), sum(values != round(values)),
    min(colSums(values)), max(colSums(values))
  ),
  stringsAsFactors = FALSE
)
write.table(qc, qc_path, sep = "\t", quote = FALSE, row.names = FALSE)

cat(sprintf(
  "prepared %d unique mouse Ensembl genes x %d ZT6 VLPO libraries (%d spontaneous sleep, %d sleep deprivation); library sizes %.0f..%.0f\n",
  nrow(clean), ncol(values), sum(selected$group == "control"), sum(selected$group == "case"),
  min(colSums(values)), max(colSums(values))
))
