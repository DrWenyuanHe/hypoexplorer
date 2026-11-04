#!/usr/bin/env Rscript

# Verify the official author-deposited log2-CPM matrix and construct the
# animal-level VMH Thrb-knockdown samplesheet for GSE98690.

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 4L) {
  stop("usage: prep_GSE98690.R <family.soft.gz> <log2cpm.tsv.gz> <samplesheet.tsv> <qc.tsv>")
}

soft_path <- args[[1]]
matrix_path <- args[[2]]
samplesheet_path <- args[[3]]
qc_path <- args[[4]]

lines <- readLines(gzfile(soft_path))
starts <- which(startsWith(lines, "^SAMPLE = "))
ends <- c(starts[-1] - 1L, length(lines))
field <- function(block, pattern) {
  hit <- grep(pattern, block, value = TRUE)
  if (length(hit)) sub(pattern, "", hit[[1]]) else NA_character_
}
metadata <- do.call(rbind, lapply(seq_along(starts), function(i) {
  block <- lines[starts[[i]]:ends[[i]]]
  descriptions <- sub("^!Sample_description = ", "", grep("^!Sample_description = ", block, value = TRUE))
  data.frame(
    gsm = sub("^SAMPLE = ", "", block[[1]], fixed = TRUE),
    title = field(block, "^!Sample_title = "),
    treatment = field(block, "^!Sample_characteristics_ch1 = treatment: "),
    sample = descriptions[[length(descriptions)]],
    biosample = field(block, "^!Sample_relation = BioSample: https://www.ncbi.nlm.nih.gov/biosample/"),
    srx = field(block, "^!Sample_relation = SRA: https://www.ncbi.nlm.nih.gov/sra\\?term="),
    stringsAsFactors = FALSE
  )
}))
metadata$group <- ifelse(metadata$treatment == "AAV-GFP", "control", "case")
if (nrow(metadata) != 7L || sum(metadata$group == "control") != 3L ||
    sum(metadata$group == "case") != 4L || anyDuplicated(metadata$sample) ||
    anyDuplicated(metadata$gsm) || anyDuplicated(metadata$biosample) ||
    anyDuplicated(metadata$srx)) {
  stop("expected three independent AAV-GFP and four independent AAV-CRE animals")
}

matrix <- data.table::fread(matrix_path, header = TRUE, check.names = FALSE)
if (!identical(names(matrix), c("Ens_ID", metadata$sample))) {
  stop("log2-CPM columns do not match the ordered GEO sample blocks")
}
ids <- as.character(matrix$Ens_ID)
values <- as.matrix(matrix[, -1])
storage.mode(values) <- "numeric"
if (anyDuplicated(ids) || any(!grepl("^ENSMUSG[0-9]+(?:\\.[0-9]+)?$", ids))) {
  stop("matrix must contain unique mouse Ensembl gene identifiers")
}
if (any(!is.finite(values))) {
  stop("matrix contains missing or non-finite log2-CPM values")
}

samplesheet <- metadata[, c("sample", "group", "title", "treatment", "gsm", "biosample", "srx")]
write.table(samplesheet, samplesheet_path, sep = "\t", quote = FALSE, row.names = FALSE)
qc <- data.frame(
  metric = c(
    "genes", "samples", "control_samples", "case_samples", "duplicate_gene_ids",
    "invalid_gene_ids", "nonfinite_cells", "constant_gene_rows", "minimum_log2cpm",
    "maximum_log2cpm"
  ),
  value = c(
    nrow(matrix), ncol(values), sum(metadata$group == "control"), sum(metadata$group == "case"),
    sum(duplicated(ids)), sum(!grepl("^ENSMUSG[0-9]+(?:\\.[0-9]+)?$", ids)),
    sum(!is.finite(values)), sum(apply(values, 1, function(x) length(unique(x)) == 1L)),
    min(values), max(values)
  ),
  stringsAsFactors = FALSE
)
write.table(qc, qc_path, sep = "\t", quote = FALSE, row.names = FALSE)

cat(sprintf(
  "verified %d unique mouse Ensembl genes x %d animals (%d control, %d VMH-Thrb knockout); log2CPM %.4f..%.4f\n",
  nrow(matrix), ncol(values), sum(metadata$group == "control"), sum(metadata$group == "case"),
  min(values), max(values)
))
