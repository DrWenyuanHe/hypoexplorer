#!/usr/bin/env Rscript

# Build the replicated, cycle-balanced hypothalamus endpoint used by the aging
# module. Two mice were pooled into each deposited library, so the library—not
# each mouse—is the biological unit. The 12 circadian sampling times are kept as
# an additive blocking factor by the standard runner.

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 3) {
  stop("usage: prep_GSE201207.R <count_216.csv.gz> <samplesheet.tsv> <subset-counts.tsv.gz>")
}

counts <- data.table::fread(args[[1]], header = TRUE)
data.table::setnames(counts, names(counts)[[1]], "GeneName")

pattern <- "^ct([0-9]+)-(young|old)-hypothalamus$"
selected_names <- names(counts)[grepl(pattern, names(counts))]
if (length(selected_names) != 24L) {
  stop("expected 24 young/old hypothalamus libraries")
}

samplesheet <- data.frame(
  sample = selected_names,
  group = ifelse(grepl("-young-", selected_names), "control", "case"),
  age = ifelse(grepl("-young-", selected_names), "6_months", "27_months"),
  circadian_time = sub(pattern, "ct\\1", selected_names),
  stringsAsFactors = FALSE
)
if (sum(samplesheet$group == "control") != 12L ||
    sum(samplesheet$group == "case") != 12L ||
    any(table(samplesheet$circadian_time) != 2L)) {
  stop("young/old libraries are not balanced across the 12 circadian time points")
}

subset <- counts[, c("GeneName", selected_names), with = FALSE]
subset <- subset[!is.na(GeneName) & nzchar(GeneName)]
duplicate_rows <- sum(duplicated(subset$GeneName))
if (duplicate_rows) {
  subset <- subset[, lapply(.SD, sum), by = GeneName, .SDcols = selected_names]
}
values <- as.matrix(subset[, -1])
if (any(!is.finite(values)) || any(values < 0) || any(values != round(values))) {
  stop("selected expression values are not finite, nonnegative integer counts")
}

write.table(samplesheet, args[[2]], sep = "\t", quote = FALSE, row.names = FALSE)
data.table::fwrite(subset, args[[3]], sep = "\t", compress = "gzip")
cat(sprintf(
  paste0("prepared %d unique genes x %d libraries across %d matched circadian times; ",
         "aggregated %d duplicate-symbol rows\n"),
  nrow(subset), ncol(subset) - 1L,
  length(unique(samplesheet$circadian_time)), duplicate_rows
))
