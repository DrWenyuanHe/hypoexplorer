#!/usr/bin/env Rscript

# Reconstruct the 391-animal GSE330152 VMH design from the authoritative GEO
# SOFT record and validate the deposited variance-stabilized expression matrix.
# The normalized values remain untouched; downstream DE therefore takes the
# standard `input_kind=matrix` limma path with sex as an additive covariate.

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 4L) {
  stop(paste0(
    "usage: prep_GSE330152.R <family.soft.gz> <vst.csv.gz> ",
    "<samplesheet.tsv> <qc.tsv>"
  ))
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
  data.frame(
    gsm = sub("^SAMPLE = ", "", block[[1]], fixed = TRUE),
    sample = field(block, "^!Sample_title = "),
    tissue = field(block, "^!Sample_characteristics_ch1 = tissue: "),
    sex = field(block, "^!Sample_characteristics_ch1 = Sex: "),
    diet = field(block, "^!Sample_characteristics_ch1 = diet: "),
    genotype = field(block, "^!Sample_characteristics_ch1 = genotype: "),
    biosample = field(block, "^!Sample_relation = BioSample: https://www.ncbi.nlm.nih.gov/biosample/"),
    srx = field(block, "^!Sample_relation = SRA: https://www.ncbi.nlm.nih.gov/sra\\?term="),
    stringsAsFactors = FALSE
  )
}))

if (nrow(metadata) != 391L || anyDuplicated(metadata$gsm) ||
    anyDuplicated(metadata$sample) || anyDuplicated(metadata$genotype)) {
  stop("expected 391 unique GEO samples, matrix sample names, and animal genotypes")
}
if (any(tolower(metadata$tissue) != "ventromedial hypothalamus")) {
  stop("GEO SOFT includes a non-VMH sample")
}
if (!setequal(unique(metadata$sex), c("F", "M")) ||
    !setequal(unique(metadata$diet), c("LOW.FAT", "HIGH.FAT"))) {
  stop("unexpected sex or diet labels in GEO SOFT")
}

expression <- data.table::fread(matrix_path, header = TRUE, check.names = FALSE)
data.table::setnames(expression, names(expression)[[1]], "Ensembl_ID")
matrix_samples <- setdiff(names(expression), "Ensembl_ID")
if (length(matrix_samples) != 391L || anyDuplicated(matrix_samples) ||
    !setequal(matrix_samples, metadata$sample)) {
  stop("the VST matrix columns do not match the 391 GEO sample titles exactly")
}
if (anyNA(expression$Ensembl_ID) || any(!nzchar(expression$Ensembl_ID)) ||
    anyDuplicated(expression$Ensembl_ID) ||
    any(!grepl("^ENSRNOG[0-9]+(?:\\.[0-9]+)?$", expression$Ensembl_ID))) {
  stop("the VST matrix does not contain unique rat Ensembl gene identifiers")
}

values <- as.matrix(expression[, ..matrix_samples])
storage.mode(values) <- "double"
if (any(!is.finite(values))) stop("the VST matrix contains non-finite values")
row_variance <- apply(values, 1L, stats::var)

metadata <- metadata[match(matrix_samples, metadata$sample), , drop = FALSE]
metadata$group <- ifelse(metadata$diet == "LOW.FAT", "control", "case")
samplesheet <- metadata[, c(
  "sample", "group", "sex", "diet", "gsm", "biosample", "srx", "genotype"
)]
if (sum(samplesheet$group == "control") < 3L ||
    sum(samplesheet$group == "case") < 3L ||
    any(table(samplesheet$sex, samplesheet$group) < 3L)) {
  stop("diet arms are not independently replicated within sex")
}
write.table(samplesheet, samplesheet_path, sep = "\t", quote = FALSE, row.names = FALSE)

group_counts <- table(samplesheet$group)
sex_group_counts <- table(samplesheet$sex, samplesheet$group)
qc <- data.frame(
  metric = c(
    "genes", "samples", "control_samples", "case_samples",
    "female_control", "female_case", "male_control", "male_case",
    "duplicate_gene_ids", "nonfinite_cells", "constant_gene_rows",
    "minimum_value", "maximum_value", "fractional_cells"
  ),
  value = c(
    nrow(expression), length(matrix_samples),
    unname(group_counts[["control"]]), unname(group_counts[["case"]]),
    unname(sex_group_counts["F", "control"]), unname(sex_group_counts["F", "case"]),
    unname(sex_group_counts["M", "control"]), unname(sex_group_counts["M", "case"]),
    sum(duplicated(expression$Ensembl_ID)), sum(!is.finite(values)),
    sum(is.finite(row_variance) & row_variance <= 1e-8),
    min(values), max(values), sum(values != round(values))
  ),
  stringsAsFactors = FALSE
)
write.table(qc, qc_path, sep = "\t", quote = FALSE, row.names = FALSE)

cat(sprintf(
  paste0(
    "validated %d unique rat Ensembl genes x %d independent VMH animals; ",
    "LOW.FAT=%d, HIGH.FAT=%d; sex cells F=%d/%d, M=%d/%d; ",
    "VST range %.4f..%.4f; %d constant rows\n"
  ),
  nrow(expression), length(matrix_samples),
  unname(group_counts[["control"]]), unname(group_counts[["case"]]),
  unname(sex_group_counts["F", "control"]), unname(sex_group_counts["F", "case"]),
  unname(sex_group_counts["M", "control"]), unname(sex_group_counts["M", "case"]),
  min(values), max(values), sum(is.finite(row_variance) & row_variance <= 1e-8)
))
