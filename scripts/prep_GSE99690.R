#!/usr/bin/env Rscript

# Extract the raw-count sheet and the paired 3-hour orexin-A versus vehicle
# contrast from the GSE99690 workbook. The 8-hour arm is a separate timepoint.

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 5L) {
  stop("usage: prep_GSE99690.R <family.soft.gz> <results.xlsx> <samplesheet.tsv> <clean-counts.tsv.gz> <qc.tsv>")
}

soft_path <- args[[1]]
workbook_path <- args[[2]]
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
    title = field(block, "^!Sample_title = "),
    sample = field(block, "^!Sample_description = "),
    biosample = field(block, "^!Sample_relation = BioSample: https://www.ncbi.nlm.nih.gov/biosample/"),
    srx = field(block, "^!Sample_relation = SRA: https://www.ncbi.nlm.nih.gov/sra\\?term="),
    stringsAsFactors = FALSE
  )
}))

selected <- metadata[grepl("^Rep_[123]_(Negative|OxA_3h)$", metadata$title), , drop = FALSE]
selected$group <- ifelse(grepl("_Negative$", selected$title), "control", "case")
selected$pair <- sub("^Rep_([123])_.*$", "rep\\1", selected$title)
if (nrow(selected) != 6L || sum(selected$group == "control") != 3L ||
    sum(selected$group == "case") != 3L || any(table(selected$pair) != 2L) ||
    anyDuplicated(selected$sample) || anyDuplicated(selected$gsm) ||
    anyDuplicated(selected$biosample) || anyDuplicated(selected$srx)) {
  stop("expected three matched vehicle and three 3-hour orexin-A libraries")
}

source <- data.table::as.data.table(readxl::read_excel(workbook_path, sheet = "RawGeneCounts"))
data.table::setnames(source, 1L, "symbol")
expected_columns <- c("symbol", selected$sample)
if (!all(expected_columns %in% names(source))) {
  stop("RawGeneCounts sheet does not contain every selected GEO sample")
}
clean <- source[, ..expected_columns]
symbols <- trimws(as.character(clean$symbol))
values <- as.matrix(clean[, -1])
storage.mode(values) <- "numeric"
valid_symbol <- !is.na(symbols) & nzchar(symbols) & !grepl("[|;,]", symbols)
invalid_feature_rows <- sum(!valid_symbol)
clean <- clean[valid_symbol]
symbols <- symbols[valid_symbol]
values <- values[valid_symbol, , drop = FALSE]
if (anyDuplicated(symbols)) {
  stop("RawGeneCounts contains duplicate gene symbols; no collapse rule is documented")
}
if (any(!is.finite(values)) || any(values < 0) || any(values != round(values))) {
  stop("selected RawGeneCounts cells must be finite nonnegative integers")
}
clean$symbol <- symbols

selected <- selected[match(names(clean)[-1], selected$sample), , drop = FALSE]
samplesheet <- selected[, c("sample", "group", "pair", "title", "gsm", "biosample", "srx")]
write.table(samplesheet, samplesheet_path, sep = "\t", quote = FALSE, row.names = FALSE)
data.table::fwrite(clean, counts_path, sep = "\t", compress = "gzip")

qc <- data.frame(
  metric = c(
    "source_rows", "unique_gene_symbols", "samples", "control_samples", "case_samples",
    "matched_pairs", "invalid_feature_rows_excluded", "duplicate_symbols", "nonfinite_cells",
    "negative_cells", "fractional_cells", "minimum_library_size", "maximum_library_size"
  ),
  value = c(
    nrow(source), nrow(clean), ncol(values), sum(selected$group == "control"),
    sum(selected$group == "case"), length(unique(selected$pair)), invalid_feature_rows,
    sum(duplicated(symbols)), sum(!is.finite(values)), sum(values < 0),
    sum(values != round(values)), min(colSums(values)), max(colSums(values))
  ),
  stringsAsFactors = FALSE
)
write.table(qc, qc_path, sep = "\t", quote = FALSE, row.names = FALSE)

cat(sprintf(
  "prepared %d unique gene symbols x %d matched GT1-7 libraries (%d vehicle, %d orexin-A 3h); library sizes %.0f..%.0f\n",
  nrow(clean), ncol(values), sum(selected$group == "control"), sum(selected$group == "case"),
  min(colSums(values)), max(colSums(values))
))
