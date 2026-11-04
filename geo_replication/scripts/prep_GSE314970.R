#!/usr/bin/env Rscript
# Prepare a fixed endpoint aging contrast from the male-rat hypothalamus arm of
# GSE314970: 6 months (control, n=12) versus 27 months (case, n=12). GEO calls
# the official ArrayStudio table raw counts, but it contains fractional count
# estimates. The authors' pinned code feeds the same source to edgeR::DGEList,
# TMM calcNormFactors, and limma::voom. That exact provenance establishes that
# the fractional values are count-like software estimates; this adapter keeps
# them unrounded for the repository's canonical counts -> edgeR-QL route.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE314970_rnor_hypothalamus_aging")
SRC <- file.path(DS, "raw", "GSE314970_rat_raw_counts_wo_muscle.txt.gz")
SOFT <- file.path(DS, "metadata", "GSE314970_family.soft.gz")
AUTHOR_PREPROCESS <- file.path(DS, "metadata", "GSE314970_author_preprocess.ipynb")
AUTHOR_UTILITIES <- file.path(DS, "metadata", "GSE314970_author_utilities.R")
RN7_GTF <- file.path(DS, "metadata", "Rattus_norvegicus.mRatBN7.2.113.gtf.gz")

if (!requireNamespace("data.table", quietly = TRUE)) stop("the data.table R package is required to select 24 columns from the 2,161-column GEO matrix")

sha256_file <- function(path) {
  if (.Platform$OS.type == "windows") {
    z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
    z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  } else if (nzchar(Sys.which("sha256sum"))) {
    z <- system2("sha256sum", shQuote(path), stdout = TRUE, stderr = TRUE)
    z <- sub("[[:space:]].*$", "", z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  } else stop("no SHA-256 utility found")
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}

source_pins <- data.frame(
  path = c(SRC, SOFT, AUTHOR_PREPROCESS, AUTHOR_UTILITIES, RN7_GTF),
  bytes = c(81454592, 99316, 58593, 14323, 18101793),
  sha256 = c(
    "1a485322e88758131af6e6c292fdc2fa695100539a763c2248f2eee05fb76e42",
    "d29c11191a15fa9c1a16fb3e36416e07f942fa4506a0675bf00037a5b489cee3",
    "2a681fac658be06a8d86e75d36c272c240924a2c6264499256f5acc56955682c",
    "708362331361631e3ebdb81c26112a01a57426b3a0f171c2e71cb667da2254fc",
    "402aefe269ecccba845a8a03137304af4356455c83b77453f799001974b4eb7c"
  ),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE314nnn/GSE314970/suppl/GSE314970_rat_raw_counts_wo_muscle.txt.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE314nnn/GSE314970/soft/GSE314970_family.soft.gz",
    "https://zenodo.org/api/records/18190271/files/preprocess.ipynb/content",
    "https://zenodo.org/api/records/18190271/files/utilities.R/content",
    "https://ftp.ensembl.org/pub/release-113/gtf/rattus_norvegicus/Rattus_norvegicus.mRatBN7.2.113.gtf.gz"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(source_pins$path))) stop("required official GEO source or family SOFT is missing")
observed_bytes <- as.numeric(file.info(source_pins$path)$size)
observed_sha <- unname(vapply(source_pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, source_pins$bytes) || !identical(observed_sha, source_pins$sha256)) stop("source bytes/SHA-256 differ from reviewed inputs")

# Fail closed on the exact author-documented handling that makes the
# fractional estimator counts admissible: raw-count import -> DGEList -> TMM ->
# voom. The shared analysis intentionally standardizes admissible count inputs
# with edgeR-QL; the author code is evidence for the input class, not a request
# to manufacture and commit a second normalized matrix.
author_preprocess <- readLines(AUTHOR_PREPROCESS, warn = FALSE)
author_utilities <- readLines(AUTHOR_UTILITIES, warn = FALSE)
if (!any(grepl("raw gene expression counts", author_preprocess, fixed = TRUE)) ||
    !any(grepl("DGEList(counts", author_utilities, fixed = TRUE)) ||
    !any(grepl("calcNormFactors", author_utilities, fixed = TRUE)) ||
    !any(grepl("voom(", author_utilities, fixed = TRUE))) {
  stop("pinned author code no longer documents raw-count DGEList/TMM/voom processing")
}

samples <- data.frame(
  gsm = c(
    "GSM9417575", "GSM9417576", "GSM9417577", "GSM9417578", "GSM9417579", "GSM9417580",
    "GSM9417581", "GSM9417582", "GSM9417596", "GSM9417598", "GSM9417599", "GSM9417600",
    "GSM9417665", "GSM9417670", "GSM9417671", "GSM9417672", "GSM9417673", "GSM9417674",
    "GSM9417675", "GSM9417677", "GSM9417678", "GSM9417679", "GSM9417680", "GSM9417681"
  ),
  source_column = c(
    "1553125", "1553126", "1553127", "1553128", "1553129", "1553130",
    "1553135", "1553136", "1553167", "1553170", "1553171", "1553172",
    "1553251", "1553257", "1553258", "1553259", "1553260", "1553261",
    "1553262", "1553264", "1553265", "1553266", "1553267", "1553268"
  ),
  sample = c(sprintf("Age6m_%02d", 1:12), sprintf("Age27m_%02d", 1:12)),
  group = rep(c("control", "case"), each = 12L), age_months = rep(c(6L, 27L), each = 12L),
  biological_replicate = rep(1:12, 2L), stringsAsFactors = FALSE
)
if (any(table(samples$group) < 3L) || anyDuplicated(samples$gsm) || anyDuplicated(samples$source_column)) stop("contrast lacks independent >=3/arm biological samples")

soft <- readLines(gzfile(SOFT), warn = FALSE)
design <- sub("^!Series_overall_design = ", "", grep("^!Series_overall_design = ", soft, value = TRUE))
if (length(design) != 1L || !grepl("Bulk RNAseq of 32 tissues of male rats at 7 age groups", design, fixed = TRUE)) {
  stop("GEO series design no longer documents the male-rat multi-age bulk RNA-seq atlas")
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
  b <- block(samples$gsm[i]); expected_title <- paste0("male_hypothalamus_", samples$age_months[i], " months_", samples$source_column[i])
  required <- c("strain: Sprague Dawley", "tissue: hypothalamus", "Sex: male",
                paste0("age: ", samples$age_months[i], " months"))
  if (!identical(tag(b, "!Sample_title"), expected_title) ||
      !identical(tag(b, "!Sample_source_name_ch1"), "hypothalamus") ||
      !identical(tag(b, "!Sample_description"), paste0("Library name: ", samples$source_column[i])) ||
      !all(required %in% tag(b, "!Sample_characteristics_ch1"))) {
    stop(samples$gsm[i], ": GEO metadata no longer match the fixed endpoint contrast")
  }
  rel <- grep("^BioSample: ", tag(b, "!Sample_relation"), value = TRUE)
  if (length(rel) != 1L) stop(samples$gsm[i], ": expected exactly one BioSample")
  biosample[i] <- sub("^.*/", "", rel)
}
if (anyDuplicated(biosample)) stop("selected libraries share a BioSample")
samples$biosample <- biosample

header <- data.table::fread(SRC, header = TRUE, nrows = 0L, showProgress = FALSE)
if (length(names(header)) != 2161L || !identical(names(header)[1L], "GeneName") || anyDuplicated(names(header))) {
  stop("official 2,161-column raw-count table schema changed")
}
if (length(setdiff(samples$source_column, names(header)))) stop("selected library column absent from GEO table")
d <- data.table::fread(SRC, header = TRUE, select = c("GeneName", samples$source_column), showProgress = FALSE)
if (nrow(d) != 30454L || ncol(d) != 25L) stop("selected GEO count-table dimensions changed")
ids <- as.character(d[["GeneName"]])
if (anyNA(ids) || any(!nzchar(ids))) stop("blank/NA GeneName identifiers")
M_source <- as.matrix(d[, samples$source_column, with = FALSE]); storage.mode(M_source) <- "double"
colnames(M_source) <- samples$sample
if (any(!is.finite(M_source)) || any(M_source < 0)) stop("raw count estimates must be finite and non-negative")
if (!any(M_source != round(M_source))) stop("source unexpectedly became integer-only; reassess the documented count-estimate caveat")

# GeneName is a mixed source field: mostly rat symbols, with Ensembl-gene IDs
# where a symbol was not supplied. First collapse exact source labels on the
# untouched linear scale. Then use the version-matched Ensembl release-113 Rn7
# GTF to map only IDs with an explicit gene_name. Rn7 genes without a deposited
# name remain unique reserved identifiers for conservation and are excluded
# from symbol-facing bundles/pathways; no name is guessed.
M_raw <- rowsum(M_source, group = ids, reorder = FALSE)
raw_labels <- rownames(M_raw)
ens_like <- grepl("^ENSRNOG[0-9]+([.][0-9]+)?$", raw_labels)
ens_ids <- sub("[.][0-9]+$", "", raw_labels[ens_like])

gtf_con <- gzfile(RN7_GTF, "rt")
gtf_header <- readLines(gtf_con, n = 5L, warn = FALSE)
gtf_gene_lines <- character()
repeat {
  chunk <- readLines(gtf_con, n = 100000L, warn = FALSE)
  if (!length(chunk)) break
  gtf_gene_lines <- c(gtf_gene_lines, chunk[grepl("\\tgene\\t", chunk)])
}
close(gtf_con)
if (!any(grepl("genome-build mRatBN7.2", gtf_header, fixed = TRUE)) || !length(gtf_gene_lines)) {
  stop("pinned Ensembl annotation is not the expected mRatBN7.2 gene GTF")
}
attrs <- sub("^([^\\t]*\\t){8}", "", gtf_gene_lines)
gtf_id <- sub('.*gene_id "([^"]+)".*', "\\1", attrs)
has_gene_name <- grepl('gene_name "', attrs, fixed = TRUE)
gtf_name <- rep(NA_character_, length(attrs))
gtf_name[has_gene_name] <- sub('.*gene_name "([^"]+)".*', "\\1", attrs[has_gene_name])
if (anyDuplicated(gtf_id)) stop("Ensembl Rn7 GTF has duplicate gene feature IDs")
ens_name <- gtf_name[match(ens_ids, gtf_id)]
ens_named <- !is.na(ens_name) & nzchar(ens_name)

final_labels <- raw_labels
final_labels[which(ens_like)[ens_named]] <- ens_name[ens_named]
final_labels[which(ens_like)[!ens_named]] <- paste0("__UNMAPPED_RN7_", ens_ids[!ens_named])
M <- rowsum(M_raw, group = final_labels, reorder = FALSE)
source_lib <- colSums(M_source); output_lib <- colSums(M)
conservation_delta <- output_lib - source_lib
if (any(abs(conservation_delta) > 1e-6)) stop("duplicate-label aggregation did not conserve count estimates")

out <- data.frame(symbol = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE314970_hypothalamus_6v27mo_count_estimates.tsv.gz")
old_options <- options(digits = 17, scipen = 999)
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)
options(old_options)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
written_delta <- apply(abs(as.matrix(roundtrip[-1L]) - M), 2L, max)
if (!identical(roundtrip$symbol, rownames(M)) || !identical(names(roundtrip)[-1L], samples$sample) || any(written_delta > 1e-6)) {
  stop("written count-estimate matrix failed identifier/column/value round-trip validation")
}

ss <- data.frame(
  sample = samples$sample, group = samples$group, geo_accession = samples$gsm,
  biosample = samples$biosample, source_column = samples$source_column,
  age_months = samples$age_months, tissue = "hypothalamus", strain = "Sprague Dawley",
  sex = "male", biological_replicate = samples$biological_replicate,
  stringsAsFactors = FALSE
)
write.table(ss, file.path(DS, "metadata", "GSE314970_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

fractional <- M_source != round(M_source)
qc <- data.frame(
  sample = samples$sample, group = samples$group, geo_accession = samples$gsm,
  source_rows = nrow(M_source), source_unique_gene_labels = length(unique(ids)),
  duplicate_gene_label_rows_collapsed = length(ids) - length(unique(ids)), output_rows = nrow(M),
  source_ensembl_like_labels = sum(grepl("^ENSRNOG[0-9]+([.][0-9]+)?$", ids)),
  unique_ensembl_labels = length(ens_ids), ensembl_named_by_rn7_gtf = sum(ens_named),
  ensembl_unnamed_or_absent = sum(!ens_named), post_mapping_label_collisions_collapsed = nrow(M_raw) - nrow(M),
  symbol_facing_rows = sum(!grepl("^__UNMAPPED_RN7_", rownames(M))),
  source_nonfinite_values = colSums(!is.finite(M_source)), source_negative_values = colSums(M_source < 0),
  source_fractional_values = colSums(fractional), source_integer_fraction = colMeans(!fractional),
  source_count_estimate_sum = source_lib, output_count_estimate_sum = output_lib,
  count_conservation_delta = conservation_delta, count_conserved = abs(conservation_delta) <= 1e-6,
  detected_output_features = colSums(M > 0), written_matrix_max_abs_delta = written_delta,
  accepted_input_class = "software-estimated raw counts; unrounded",
  author_code_evidence = "Zenodo 18190271: raw gene expression counts -> edgeR DGEList -> TMM calcNormFactors -> limma voom",
  shared_route = "input_kind=counts -> canonical edgeR-QL",
  stringsAsFactors = FALSE
)
if (any(!qc$count_conserved) || sum(qc$source_fractional_values) != 46580L ||
    any(qc$source_nonfinite_values != 0L) || any(qc$source_negative_values != 0L) ||
    any(qc$written_matrix_max_abs_delta > 1e-6)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE314970_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

manifest <- data.frame(file = basename(source_pins$path), bytes = observed_bytes, sha256 = observed_sha,
                       source = source_pins$url, fetched = "2026-08-31", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE314970_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE314970] wrote %d features x %d samples (6m=12, 27m=12); Rn7 Ensembl mapping named %d/%d IDs, %d remain reserved/non-gene-facing; 46,580 fractional estimates preserved unrounded\n",
            nrow(M), ncol(M), sum(ens_named), length(ens_ids), sum(!ens_named)))
print(setNames(output_lib, samples$sample))
