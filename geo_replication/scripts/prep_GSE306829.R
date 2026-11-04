#!/usr/bin/env Rscript
# Prepare the paired BacTRAP contrast from GSE306829: total preoptic-area
# input RNA (control) versus PNOC-neuron ribosome IP RNA (case). Each of the
# three pairs comes from one independent pool of three female mice; animals
# within a pool are never promoted to sample replicates.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE306829_mmus_mpoa_pnoc_bactrap")
SRC <- file.path(DS, "raw", "GSE306829_IPvsInput_deg.txt.gz")
SOFT <- file.path(DS, "metadata", "GSE306829_family.soft.gz")

if (!requireNamespace("data.table", quietly = TRUE)) stop("the data.table R package is required")

sha256_file <- function(path) {
  if (.Platform$OS.type == "windows") {
    z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
    z <- tolower(trimws(z)); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  } else {
    z <- system2("sha256sum", shQuote(path), stdout = TRUE, stderr = TRUE)
    z <- sub("[[:space:]].*$", "", z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  }
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  z
}

paths <- c(SRC, SOFT)
expected_bytes <- c(4768661, 2748)
expected_sha256 <- c(
  "2f8a9797e72032e1d32776d8f766e4a170c3e34be7f1c5a0aef8ed0cb9773a74",
  "59927900d46b0c27ae3e9193b7abc5cec9d64105a9e0986fc5e3e6e2560b49b9"
)
if (any(!file.exists(paths))) stop("required official GEO source or family SOFT is missing")
observed_bytes <- as.numeric(file.info(paths)$size)
observed_sha256 <- unname(vapply(paths, sha256_file, character(1)))
if (!identical(observed_bytes, expected_bytes) || !identical(observed_sha256, expected_sha256)) {
  stop("GSE306829 source bytes or SHA-256 no longer match the reviewed inputs")
}

samples <- data.frame(
  gsm = paste0("GSM", 9210322:9210327),
  sample = c("PoA_Input1", "PoA_Input2", "PoA_Input3", "PoA_IP1", "PoA_IP2", "PoA_IP3"),
  source_column = c("PoA_Input1_count", "PoA_Input2_count", "PoA_Input3_count",
                    "PoA_IP1_count", "PoA_IP2_count", "PoA_IP3_count"),
  title = c(
    "PoA bulk tissue, input RNA, rep1", "PoA bulk tissue, input RNA, rep2",
    "PoA bulk tissue, input RNA, rep3", "PoA, PNOC neuron ribosome IP RNA, rep1",
    "PoA, PNOC neuron ribosome IP RNA, rep2", "PoA, PNOC neuron ribosome IP RNA, rep3"
  ),
  group = rep(c("control", "case"), each = 3L),
  fraction = rep(c("matched total input", "PNOC-neuron ribosome IP"), each = 3L),
  pair = rep(paste0("pool", 1:3), 2L),
  biological_replicate = rep(1:3, 2L), stringsAsFactors = FALSE
)
if (any(table(samples$group) != 3L) || anyDuplicated(samples$gsm) || anyDuplicated(samples$sample)) {
  stop("paired contrast must contain exactly three distinct libraries per arm")
}

soft <- readLines(gzfile(SOFT), warn = FALSE)
overall <- sub("^!Series_overall_design = ", "", grep("^!Series_overall_design = ", soft, value = TRUE))
if (length(overall) != 1L ||
    !grepl("POA punches were pooled (three animals per replicate, three replicates total)", overall, fixed = TRUE) ||
    !grepl("Input (total) RNA from each sample was processed in parallel as control", overall, fixed = TRUE)) {
  stop("GEO no longer documents three independent pooled replicates with paired input controls")
}
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft))
names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
block <- function(gsm) {
  i <- match(gsm, names(starts)); if (is.na(i)) stop("GSM absent from family SOFT: ", gsm)
  soft[starts[i]:ends[i]]
}
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
biosample <- character(nrow(samples))
for (i in seq_len(nrow(samples))) {
  b <- block(samples$gsm[i])
  if (!identical(tag(b, "!Sample_title"), samples$title[i]) ||
      !identical(tag(b, "!Sample_source_name_ch1"), "Preoptic area (POA) of hypothalamus, mouse brain") ||
      !identical(tag(b, "!Sample_organism_ch1"), "Mus musculus") ||
      !identical(tag(b, "!Sample_description"), paste0("Library name: ", samples$sample[i]))) {
    stop(samples$gsm[i], ": GEO metadata no longer match the fixed paired BacTRAP contrast")
  }
  rel <- grep("^BioSample: ", tag(b, "!Sample_relation"), value = TRUE)
  if (length(rel) != 1L) stop(samples$gsm[i], ": expected exactly one BioSample")
  biosample[i] <- sub("^.*/", "", rel)
}
if (anyDuplicated(biosample)) stop("selected libraries unexpectedly share a BioSample")
samples$biosample <- biosample

select_cols <- c("gene_id", "gene_name", samples$source_column)
d <- data.table::fread(SRC, select = select_cols, showProgress = FALSE)
if (nrow(d) != 27884L || ncol(d) != 8L || !identical(names(d), select_cols)) {
  stop("official GSE306829 merged table structure changed")
}
ids <- as.character(d[["gene_id"]]); source_symbols <- as.character(d[["gene_name"]])
if (anyNA(ids) || any(!nzchar(ids)) || anyDuplicated(ids) ||
    any(!grepl("^ENSMUSG[0-9]{11}$", ids))) stop("gene_id must be unique versionless mouse Ensembl genes")
if (anyNA(source_symbols) || any(!nzchar(source_symbols))) stop("official gene_name annotations contain blanks")
M <- as.matrix(d[, samples$source_column, with = FALSE]); storage.mode(M) <- "double"
colnames(M) <- samples$sample
if (any(!is.finite(M)) || any(M < 0) || any(M != round(M))) {
  stop("selected *_count columns must be finite non-negative integers; normalized/FPKM columns are forbidden")
}
source_lib <- colSums(M)
expected_lib <- c(50321600, 53056642, 49068467, 48406141, 48204567, 51380354)
if (!identical(unname(source_lib), expected_lib)) stop("source library totals changed")

out <- data.frame(gene_id = ids, M, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE306829_PNOC_IP_vs_input_counts.tsv.gz")
old_options <- options(digits = 17, scipen = 999)
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)
options(old_options)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
written <- as.matrix(roundtrip[-1L]); storage.mode(written) <- "double"
if (!identical(roundtrip$gene_id, ids) || !identical(names(roundtrip)[-1L], samples$sample) ||
    any(written != M)) stop("written integer-count matrix failed exact round-trip validation")

ss <- data.frame(
  sample = samples$sample, group = samples$group, geo_accession = samples$gsm,
  biosample = samples$biosample, source_column = samples$source_column,
  pair = samples$pair, fraction = samples$fraction,
  tissue = "medial preoptic area of hypothalamus", sex = "female",
  age_weeks = "17-18", genotype = "NuTRAP::Pnoc-Cre", pooled_animals = 3L,
  biological_replicate = samples$biological_replicate, stringsAsFactors = FALSE
)
write.table(ss, file.path(DS, "metadata", "GSE306829_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

qc <- data.frame(
  sample = samples$sample, group = samples$group, geo_accession = samples$gsm,
  pair = samples$pair, biological_units = 1L, animals_per_pool = 3L,
  source_rows = nrow(M), output_rows = nrow(written),
  source_nonfinite_values = colSums(!is.finite(M)), source_negative_values = colSums(M < 0),
  source_fractional_values = colSums(M != round(M)), source_library_size = source_lib,
  output_library_size = colSums(written), count_conservation_delta = colSums(written) - source_lib,
  count_conserved = colSums(written) == source_lib, detected_genes = colSums(M > 0),
  source_gene_name_present = sum(nzchar(source_symbols)),
  estimand = "PNOC-neuron ribosome-IP enrichment versus matched total input",
  stringsAsFactors = FALSE
)
if (any(qc$source_nonfinite_values != 0L) || any(qc$source_negative_values != 0L) ||
    any(qc$source_fractional_values != 0L) || any(!qc$count_conserved)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE306829_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

manifest <- data.frame(
  file = basename(paths), bytes = observed_bytes, sha256 = observed_sha256,
  source = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE306nnn/GSE306829/suppl/GSE306829_IPvsInput_deg.txt.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE306nnn/GSE306829/soft/GSE306829_family.soft.gz"
  ), fetched = "2026-08-31", stringsAsFactors = FALSE
)
write.table(manifest, file.path(DS, "metadata", "GSE306829_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE306829] wrote %d Ensembl genes x %d paired libraries (input=3, PNOC IP=3); animals within pools remain pooled\n", nrow(M), ncol(M)))
print(source_lib)
