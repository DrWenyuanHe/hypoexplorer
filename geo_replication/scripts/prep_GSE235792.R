#!/usr/bin/env Rscript
# Assemble a fail-closed raw-count matrix for GSE235792.
#
# Contrast: whole hypothalamus from 18-week-old male TallyHo/JngJ mice with high
# body weight at weaning, low blood glucose (control, n=4) versus high blood
# glucose (case, n=4). Tissue, strain, sex, age, and weaning-weight stratum are
# held constant. Every selected GSM has a distinct BioSample and a separate
# GEO-hosted two-column integer count table.

get_script_dir <- function() {
  args <- commandArgs(FALSE)
  file_arg <- grep("^--file=", args, value = TRUE)
  if (length(file_arg)) dirname(normalizePath(sub("^--file=", "", file_arg[1L]))) else getwd()
}

ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE235792_mmus_hypothalamus_diabetes")
SRC_DIR <- file.path(DS, "raw", "source")
SOFT <- file.path(DS, "metadata", "GSE235792_family.soft.gz")

samples <- data.frame(
  gsm = c(
    "GSM7509661", "GSM7509662", "GSM7509663", "GSM7509664",
    "GSM7509651", "GSM7509652", "GSM7509653", "GSM7509654"
  ),
  sample = c(
    "LBG_HBW_M_HTH_1", "LBG_HBW_M_HTH_2", "LBG_HBW_M_HTH_3", "LBG_HBW_M_HTH_4",
    "HBG_HBW_M_HTH_1", "HBG_HBW_M_HTH_2", "HBG_HBW_M_HTH_3", "HBG_HBW_M_HTH_4"
  ),
  group = rep(c("control", "case"), each = 4L),
  condition = rep(c(
    "low blood glucose, high body weight at weaning",
    "high blood glucose, high body weight at weaning"
  ), each = 4L),
  biological_replicate = rep(seq_len(4L), 2L),
  stringsAsFactors = FALSE
)
samples$file <- paste0(samples$gsm, "_", samples$sample, ".txt.gz")

stopifnot(
  identical(sort(unique(samples$group)), c("case", "control")),
  all(table(samples$group) >= 3L),
  !anyDuplicated(samples$gsm),
  !anyDuplicated(samples$sample)
)
missing_inputs <- c(file.path(SRC_DIR, samples$file), SOFT)
missing_inputs <- missing_inputs[!file.exists(missing_inputs)]
if (length(missing_inputs)) stop("missing source file(s): ", paste(missing_inputs, collapse = ", "))

# Verify the contrast assignment against the authoritative GEO family SOFT.
soft <- readLines(gzfile(SOFT), warn = FALSE)
sample_starts <- grep("^\\^SAMPLE = ", soft)
sample_ends <- c(sample_starts[-1L] - 1L, length(soft))
names(sample_starts) <- sub("^\\^SAMPLE = ", "", soft[sample_starts])

sample_block <- function(gsm) {
  i <- match(gsm, names(sample_starts))
  if (is.na(i)) stop("GSM absent from family SOFT: ", gsm)
  soft[sample_starts[i]:sample_ends[i]]
}

tag_values <- function(block, tag) {
  prefix <- paste0("^", tag, " = ")
  sub(prefix, "", grep(prefix, block, value = TRUE))
}

biosamples <- character(nrow(samples))
for (i in seq_len(nrow(samples))) {
  block <- sample_block(samples$gsm[i])
  source <- tag_values(block, "!Sample_source_name_ch1")
  chars <- tag_values(block, "!Sample_characteristics_ch1")
  expected_chars <- c(
    "tissue: hypothalamus",
    "strain: TallyHo/JngJ",
    "Sex: male",
    "age: 18 weeks",
    "development stage: adult",
    paste0("condition: ", samples$condition[i])
  )
  if (!identical(source, "hypothalamus")) stop(samples$gsm[i], ": unexpected source_name: ", paste(source, collapse = " | "))
  if (!all(expected_chars %in% chars)) stop(samples$gsm[i], ": required GEO characteristics missing")
  relation <- tag_values(block, "!Sample_relation")
  biosample <- grep("^BioSample: ", relation, value = TRUE)
  if (length(biosample) != 1L) stop(samples$gsm[i], ": expected one BioSample relation")
  biosamples[i] <- sub("^BioSample: .*/", "", biosample)
}
if (anyDuplicated(biosamples)) stop("selected GSMs do not resolve to independent BioSamples")
samples$biosample <- biosamples

read_count_file <- function(i) {
  path <- file.path(SRC_DIR, samples$file[i])
  d <- read.delim(gzfile(path), check.names = FALSE, stringsAsFactors = FALSE)
  if (ncol(d) != 2L) stop(samples$file[i], ": expected exactly two columns")
  if (!identical(colnames(d), c("Ensembl_gene_id", samples$sample[i]))) {
    stop(samples$file[i], ": source header does not match GEO sample description")
  }
  ids <- as.character(d[[1L]])
  counts <- d[[2L]]
  if (!is.numeric(counts)) stop(samples$file[i], ": count column is not numeric")
  if (anyNA(ids) || any(ids == "")) stop(samples$file[i], ": blank/NA gene ID")
  if (anyDuplicated(ids)) stop(samples$file[i], ": duplicate gene IDs")
  if (any(!is.finite(counts))) stop(samples$file[i], ": non-finite count")
  if (any(counts < 0)) stop(samples$file[i], ": negative count")
  if (any(counts != round(counts))) stop(samples$file[i], ": non-integer count")
  setNames(as.numeric(counts), ids)
}

counts <- lapply(seq_len(nrow(samples)), read_count_file)
reference_genes <- sort(names(counts[[1L]]))
for (i in seq_along(counts)) {
  if (!identical(sort(names(counts[[i]])), reference_genes)) {
    stop(samples$file[i], ": gene universe differs from the first source file")
  }
}

matrix_counts <- vapply(
  counts,
  function(x) unname(x[reference_genes]),
  numeric(length(reference_genes))
)
rownames(matrix_counts) <- reference_genes
colnames(matrix_counts) <- samples$sample
if (anyNA(matrix_counts) || any(matrix_counts != round(matrix_counts)) || any(matrix_counts < 0)) {
  stop("merged matrix failed raw non-negative integer checks")
}

source_library_sizes <- vapply(counts, sum, numeric(1))
merged_library_sizes <- colSums(matrix_counts)
if (!identical(unname(source_library_sizes), unname(merged_library_sizes))) {
  stop("library-size conservation failed after gene alignment")
}

merged_path <- file.path(DS, "raw", "GSE235792_hypothalamus_HBG_vs_LBG_counts.tsv.gz")
merged <- data.frame(Ensembl_gene_id = reference_genes, matrix_counts, check.names = FALSE)
con <- gzfile(merged_path, "w")
write.table(merged, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
close(con)

samplesheet <- data.frame(
  sample = samples$sample,
  group = samples$group,
  geo_accession = samples$gsm,
  biosample = samples$biosample,
  condition = samples$condition,
  blood_glucose = ifelse(samples$group == "case", "high", "low"),
  weaning_weight = "high",
  sex = "male",
  tissue = "hypothalamus",
  biological_replicate = samples$biological_replicate,
  stringsAsFactors = FALSE
)
samplesheet_path <- file.path(DS, "metadata", "GSE235792_samplesheet.tsv")
con <- file(samplesheet_path, "wb")
write.table(samplesheet, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
close(con)

qc <- data.frame(
  sample = samples$sample,
  group = samples$group,
  geo_accession = samples$gsm,
  source_file = samples$file,
  source_rows = vapply(counts, length, integer(1)),
  source_unique_gene_ids = vapply(counts, function(x) length(unique(names(x))), integer(1)),
  source_nonfinite_counts = vapply(counts, function(x) sum(!is.finite(x)), integer(1)),
  source_negative_counts = vapply(counts, function(x) sum(x < 0), integer(1)),
  source_noninteger_counts = vapply(counts, function(x) sum(x != round(x)), integer(1)),
  source_library_size = source_library_sizes,
  merged_library_size = merged_library_sizes,
  library_size_delta = merged_library_sizes - source_library_sizes,
  count_conserved = merged_library_sizes == source_library_sizes,
  detected_genes = colSums(matrix_counts > 0),
  stringsAsFactors = FALSE
)
qc_path <- file.path(DS, "processed", "GSE235792_preprocessing_qc.tsv")
con <- file(qc_path, "wb")
write.table(qc, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
close(con)

sha256_file <- function(path) {
  if (.Platform$OS.type == "windows") {
    output <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
    candidates <- trimws(output)
    candidates <- candidates[grepl("^[[:xdigit:]]{64}$", candidates)]
  } else if (nzchar(Sys.which("sha256sum"))) {
    output <- system2("sha256sum", shQuote(path), stdout = TRUE, stderr = TRUE)
    candidates <- sub("[[:space:]].*$", "", output)
    candidates <- candidates[grepl("^[[:xdigit:]]{64}$", candidates)]
  } else if (nzchar(Sys.which("shasum"))) {
    output <- system2("shasum", c("-a", "256", shQuote(path)), stdout = TRUE, stderr = TRUE)
    candidates <- sub("[[:space:]].*$", "", output)
    candidates <- candidates[grepl("^[[:xdigit:]]{64}$", candidates)]
  } else {
    stop("no SHA-256 utility found (need certutil, sha256sum, or shasum)")
  }
  if (length(candidates) != 1L) stop("could not parse SHA-256 for ", path)
  tolower(candidates)
}

source_paths <- c(file.path(SRC_DIR, samples$file), SOFT)
source_urls <- c(
  sprintf(
    "https://ftp.ncbi.nlm.nih.gov/geo/samples/GSM7509nnn/%s/suppl/%s",
    samples$gsm,
    samples$file
  ),
  "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE235nnn/GSE235792/soft/GSE235792_family.soft.gz"
)
source_manifest <- data.frame(
  file = basename(source_paths),
  bytes = as.numeric(file.info(source_paths)$size),
  sha256 = vapply(source_paths, sha256_file, character(1)),
  source = source_urls,
  fetched = "2026-08-31",
  stringsAsFactors = FALSE
)
manifest_path <- file.path(DS, "metadata", "GSE235792_source_files.tsv")
con <- file(manifest_path, "wb")
write.table(source_manifest, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
close(con)

cat(sprintf(
  "[GSE235792] wrote %d genes x %d samples (control=%d, case=%d)\n",
  nrow(matrix_counts), ncol(matrix_counts), sum(samples$group == "control"), sum(samples$group == "case")
))
cat("[GSE235792] library sizes:\n")
print(setNames(merged_library_sizes, samples$sample))
cat("[GSE235792] count conservation and GEO metadata checks passed\n")
