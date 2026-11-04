#!/usr/bin/env Rscript

# Extract the sex-balanced 6- versus 27-month hypothalamus endpoint from the
# multi-tissue aging atlas. The deposited abundance table contains fractional
# estimated counts; the standard edgeR runner accepts finite nonnegative values
# and the audit records that these are not literal integer read counts.

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 5) {
  stop(paste0(
    "usage: prep_GSE314817.R <family.soft.gz> <counts.txt.gz> <metadata.tsv> ",
    "<samplesheet.tsv> <subset-counts.tsv.gz>"
  ))
}

soft_path <- args[[1]]
counts_path <- args[[2]]
metadata_path <- args[[3]]
samplesheet_path <- args[[4]]
subset_path <- args[[5]]

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
    tissue = field(block, "^!Sample_characteristics_ch1 = tissue: "),
    sex = field(block, "^!Sample_characteristics_ch1 = Sex: "),
    age = field(block, "^!Sample_characteristics_ch1 = age: "),
    sample = field(block, "^!Sample_description = Library name: "),
    stringsAsFactors = FALSE
  )
}))

hypothalamus <- metadata[tolower(metadata$tissue) == "hypothalamus", , drop = FALSE]
if (nrow(hypothalamus) != 103L || anyDuplicated(hypothalamus$sample)) {
  stop("expected 103 unique hypothalamus libraries")
}
write.table(hypothalamus, metadata_path, sep = "\t", quote = FALSE, row.names = FALSE)

selected <- hypothalamus[hypothalamus$age %in% c("6 months", "27 months"), , drop = FALSE]
selected$group <- ifelse(selected$age == "6 months", "control", "case")
selected$library <- selected$sample
selected$sample <- paste0("LIB_", selected$library)
selected <- selected[, c("sample", "group", "age", "sex", "gsm", "library")]
if (sum(selected$group == "control") != 16L || sum(selected$group == "case") != 20L) {
  stop("expected 16 young and 20 old libraries")
}
write.table(selected, samplesheet_path, sep = "\t", quote = FALSE, row.names = FALSE)

wanted <- c("GeneName", selected$library)
header <- names(data.table::fread(counts_path, header = TRUE, nrows = 0L))
column_index <- match(wanted, header)
if (anyNA(column_index)) {
  stop(sprintf(
    "count matrix is missing selected libraries: %s",
    paste(wanted[is.na(column_index)], collapse = ", ")
  ))
}
counts <- data.table::fread(counts_path, header = TRUE, select = column_index)
data.table::setcolorder(counts, wanted)
data.table::setnames(counts, selected$library, selected$sample)
counts <- counts[!is.na(GeneName) & nzchar(GeneName)]
duplicate_rows <- sum(duplicated(counts$GeneName))
if (duplicate_rows) {
  count_columns <- setdiff(names(counts), "GeneName")
  counts <- counts[, lapply(.SD, sum), by = GeneName, .SDcols = count_columns]
}
values <- as.matrix(counts[, -1])
if (any(!is.finite(values)) || any(values < 0)) {
  stop("selected expression values are not finite, nonnegative counts")
}
fractional <- sum(values != round(values))
data.table::fwrite(counts, subset_path, sep = "\t", compress = "gzip")

cat(sprintf(
  paste0("prepared %d unique genes x %d libraries (%d control, %d case); ",
         "aggregated %d duplicate-symbol rows; %d fractional count cells\n"),
  nrow(counts), ncol(counts) - 1L,
  sum(selected$group == "control"), sum(selected$group == "case"),
  duplicate_rows, fractional
))
