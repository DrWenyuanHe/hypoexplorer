#!/usr/bin/env Rscript

# Prepare the mature-mouse (P22) Lef1 conditional-knockout contrast from
# GSE98519. The accession also contains zebrafish 3-dpf and mouse E14.5 arms;
# those distinct species/developmental contrasts are intentionally not mixed.

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 5L) {
  stop("usage: prep_GSE98519.R <family.soft.gz> <P22-counts.txt.gz> <samplesheet.tsv> <clean-counts.tsv.gz> <qc.tsv>")
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
    title = field(block, "^!Sample_title = "),
    source = field(block, "^!Sample_source_name_ch1 = "),
    genotype = field(block, "^!Sample_characteristics_ch1 = genotype: "),
    biosample = field(block, "^!Sample_relation = BioSample: https://www.ncbi.nlm.nih.gov/biosample/"),
    srx = field(block, "^!Sample_relation = SRA: https://www.ncbi.nlm.nih.gov/sra\\?term="),
    stringsAsFactors = FALSE
  )
}))

selected <- metadata[grepl("_P22 rep[123] \\(12400X[1-6]\\)$", metadata$title), , drop = FALSE]
selected$sample <- sub("^.*\\((12400X[1-6])\\)$", "\\1", selected$title)
selected$group <- ifelse(grepl("^Lef1-CON_", selected$title), "control", "case")
if (nrow(selected) != 6L || sum(selected$group == "control") != 3L ||
    sum(selected$group == "case") != 3L || anyDuplicated(selected$sample) ||
    anyDuplicated(selected$gsm) || anyDuplicated(selected$biosample) ||
    anyDuplicated(selected$srx)) {
  stop("expected three independent P22 Lef1-CON and three P22 Lef1-CKO libraries")
}

source <- data.table::fread(source_path, header = TRUE, check.names = FALSE)
expected_columns <- c("id", selected$sample)
if (!all(expected_columns %in% names(source))) {
  stop("P22 count table does not contain every selected SOFT sample")
}
clean <- source[, ..expected_columns]
ids <- as.character(clean$id)
values <- as.matrix(clean[, -1])
storage.mode(values) <- "numeric"
if (anyDuplicated(ids) || any(!grepl("^ENSMUSG[0-9]+(?:\\.[0-9]+)?$", ids))) {
  stop("P22 matrix must contain unique mouse Ensembl gene identifiers")
}
if (any(!is.finite(values)) || any(values < 0) || any(values != round(values))) {
  stop("P22 matrix must contain finite nonnegative integer counts")
}

selected <- selected[match(names(clean)[-1], selected$sample), , drop = FALSE]
samplesheet <- selected[, c("sample", "group", "title", "gsm", "biosample", "srx", "genotype")]
write.table(samplesheet, samplesheet_path, sep = "\t", quote = FALSE, row.names = FALSE)
data.table::fwrite(clean, counts_path, sep = "\t", compress = "gzip")

qc <- data.frame(
  metric = c(
    "source_rows", "unique_genes", "samples", "control_samples", "case_samples",
    "duplicate_gene_ids", "invalid_gene_ids", "nonfinite_cells", "negative_cells",
    "fractional_cells", "minimum_library_size", "maximum_library_size"
  ),
  value = c(
    nrow(source), nrow(clean), ncol(values), sum(selected$group == "control"),
    sum(selected$group == "case"), sum(duplicated(ids)),
    sum(!grepl("^ENSMUSG[0-9]+(?:\\.[0-9]+)?$", ids)), sum(!is.finite(values)),
    sum(values < 0), sum(values != round(values)), min(colSums(values)), max(colSums(values))
  ),
  stringsAsFactors = FALSE
)
write.table(qc, qc_path, sep = "\t", quote = FALSE, row.names = FALSE)

cat(sprintf(
  "prepared %d unique mouse Ensembl genes x %d P22 libraries (%d control, %d Lef1-CKO); library sizes %.0f..%.0f\n",
  nrow(clean), ncol(values), sum(selected$group == "control"), sum(selected$group == "case"),
  min(colSums(values)), max(colSums(values))
))
