#!/usr/bin/env Rscript
# Prepare hypothalamus after choroid-plexus Ins2 overexpression versus control.
# GEO deposits DESeq2-normalized values on a linear scale. Fractional values
# are preserved and transformed only as log2(normalized expression + 1).

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- tolower(trimws(z)); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  z
}

ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE218188_mmus_hypothalamus_cp_ins2")
SRC <- file.path(DS, "raw", "GSE218188_HT_Normalized_counts_file_DESeq2.tabular.txt.gz")
SOFT <- file.path(DS, "metadata", "GSE218188_family.soft.gz")

paths <- c(SRC, SOFT)
expected_bytes <- c(1121150, 4335)
expected_sha256 <- c(
  "c4f55b15846cc52d7e3e028267f49e67c3f38d1a04227e849938394ef0a4f14a",
  "9b1dde02a12abf7c788aae28c5f3dfafe0cbde7a16ed998d238661f16293405c"
)
if (any(!file.exists(paths))) stop("required GEO source or family SOFT is missing")
observed_bytes <- as.numeric(file.info(paths)$size)
observed_sha256 <- unname(vapply(paths, sha256_file, character(1)))
if (!identical(observed_bytes, expected_bytes) || !identical(observed_sha256, expected_sha256)) {
  stop("GSE218188 source bytes or SHA-256 no longer match the pinned inputs")
}

samples <- data.frame(
  gsm = c(paste0("GSM673", 6292:6296), paste0("GSM673", 6287:6291)),
  source_column = c(paste0("GFP_HT_G", 1:5), "Ins2_Over_HT_F1", "Ins2_Over_HT_F2",
                    "Ins2_Over_HT_F3", "Ins2_Over_HT_F5", "Ins2_Over_HT_F6"),
  geo_title = c(
    "Hypothalamus tissue, control, rep1 [G1]",
    "Hypothalamus tissue, control, rep2 [G2]",
    "Hypothalamus tissue, control, rep3 [G3]",
    "Hypothalamus tissue, control, rep4 [G4]",
    "Hypothalamus tissue, control, rep6 [G5]",
    "Hypothalamus tissue, Ins2 overexpressed in the choroid plexus, rep1 [F1]",
    "Hypothalamus tissue, Ins2 overexpressed in the choroid plexus, rep2 [F2]",
    "Hypothalamus tissue, Ins2 overexpressed in the choroid plexus, rep3 [F3]",
    "Hypothalamus tissue, Ins2 overexpressed in the choroid plexus, rep4 [F5]",
    "Hypothalamus tissue, Ins2 overexpressed in the choroid plexus, rep5 [F6]"
  ),
  group = rep(c("control", "case"), each = 5L),
  treatment = rep(c("no treatment control", "Ins2 overexpression in the choroid plexus"), each = 5L),
  biological_replicate = c(1:4, 6L, 1:5), stringsAsFactors = FALSE
)
if (any(table(samples$group) < 3L) || anyDuplicated(samples$gsm) || anyDuplicated(samples$source_column)) {
  stop("contrast lacks independent >=3/arm samples or has duplicate identifiers")
}

soft <- readLines(gzfile(SOFT), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft))
names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
block <- function(gsm) {
  i <- match(gsm, names(starts)); if (is.na(i)) stop("GSM absent from SOFT: ", gsm)
  soft[starts[i]:ends[i]]
}
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
biosample <- character(nrow(samples))
for (i in seq_len(nrow(samples))) {
  b <- block(samples$gsm[i])
  title <- tag(b, "!Sample_title"); source_name <- tag(b, "!Sample_source_name_ch1")
  desc <- tag(b, "!Sample_description"); organism <- tag(b, "!Sample_organism_ch1")
  chars <- tag(b, "!Sample_characteristics_ch1")
  required <- c("tissue: Hypothalamus", "genotype: WT", "strain background: C57BL/6J",
                paste0("treatment: ", samples$treatment[i]))
  if (!identical(title, samples$geo_title[i]) || !identical(source_name, "Hypothalamus") ||
      !identical(desc, "HT_Normalized_counts_file_DESeq2.tabular") ||
      !identical(organism, "Mus musculus") || !all(required %in% chars)) {
    stop(samples$gsm[i], ": GEO metadata no longer matches the fixed hypothalamus/Ins2 contrast")
  }
  rel <- grep("^BioSample: ", tag(b, "!Sample_relation"), value = TRUE)
  if (length(rel) != 1L) stop("expected one BioSample for ", samples$gsm[i])
  biosample[i] <- sub("^.*/", "", rel)
}
if (anyDuplicated(biosample)) stop("selected libraries share a BioSample")
samples$biosample <- biosample

d <- read.delim(gzfile(SRC), check.names = FALSE, stringsAsFactors = FALSE)
if (nrow(d) != 25239L || ncol(d) != 11L || !identical(names(d)[1L], "GeneID")) {
  stop("deposited GSE218188 matrix structure changed")
}
if (!identical(names(d)[-1L], c(paste0("GFP_HT_G", 1:5), "Ins2_Over_HT_F1", "Ins2_Over_HT_F2",
                                "Ins2_Over_HT_F3", "Ins2_Over_HT_F5", "Ins2_Over_HT_F6"))) {
  stop("deposited GSE218188 sample columns changed")
}
ids <- as.character(d$GeneID)
if (anyNA(ids) || any(!nzchar(ids)) || anyDuplicated(ids)) stop("GeneID values must be nonblank and unique")
M <- as.matrix(d[, samples$source_column, drop = FALSE]); storage.mode(M) <- "double"
if (any(!is.finite(M)) || any(M < 0)) stop("normalized expression must be finite and non-negative")
integer_fraction <- mean(M == round(M))
if (integer_fraction < 0.20 || integer_fraction > 0.35 || max(M) < 1e5 || min(colSums(M)) < 3e7) {
  stop("source no longer has the pinned linear DESeq2-normalized expression signature")
}

L <- log2(M + 1)
reconstructed <- 2^L - 1
transform_delta <- apply(abs(reconstructed - M), 2L, max)
conservation_delta <- colSums(reconstructed) - colSums(M)
if (any(transform_delta > 1e-8) || any(abs(conservation_delta) > 1e-6)) {
  stop("log2(normalized expression+1) reversibility or conservation failed")
}

out <- data.frame(GeneID = ids, L, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE218188_HT_Ins2OE_vs_control_log2norm.tsv.gz")
old_options <- options(digits = 17, scipen = 999)
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)
options(old_options)

roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$GeneID, ids) || !identical(names(roundtrip)[-1L], samples$source_column) ||
    max(abs(as.matrix(roundtrip[-1L]) - L)) > 1e-12) stop("written analysis matrix failed round-trip validation")

ss <- data.frame(
  sample = samples$source_column, group = samples$group, geo_accession = samples$gsm,
  biosample = samples$biosample, source_column = samples$source_column,
  tissue = "hypothalamus", genotype = "WT", strain_background = "C57BL/6J",
  choroid_plexus_treatment = samples$treatment, biological_replicate = samples$biological_replicate,
  stringsAsFactors = FALSE
)
write.table(ss, file.path(DS, "metadata", "GSE218188_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

qc <- data.frame(
  sample = samples$source_column, group = samples$group, geo_accession = samples$gsm,
  source_rows = nrow(M), output_rows = nrow(L), source_nonfinite_values = colSums(!is.finite(M)),
  source_negative_values = colSums(M < 0), source_fractional_values = colSums(M != round(M)),
  source_normalized_expression_sum = colSums(M), reconstructed_linear_expression_sum = colSums(reconstructed),
  expression_conservation_delta = conservation_delta, expression_conserved = abs(conservation_delta) <= 1e-6,
  detected_features = colSums(M > 0), log2_expression_sum = colSums(L),
  transform_max_abs_delta = transform_delta, written_matrix_max_abs_delta = apply(abs(as.matrix(roundtrip[-1L]) - L), 2L, max),
  stringsAsFactors = FALSE
)
if (any(!qc$expression_conserved) || any(qc$transform_max_abs_delta > 1e-8) ||
    any(qc$written_matrix_max_abs_delta > 1e-12)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE218188_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

manifest <- data.frame(
  file = basename(paths), bytes = observed_bytes, sha256 = observed_sha256,
  source = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE218nnn/GSE218188/suppl/GSE218188_HT_Normalized_counts_file_DESeq2.tabular.txt.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE218nnn/GSE218188/soft/GSE218188_family.soft.gz"
  ), fetched = "2026-08-31", stringsAsFactors = FALSE
)
write.table(manifest, file.path(DS, "metadata", "GSE218188_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE218188] wrote %d features x %d samples (control=5, case=5); normalized values were not rounded\n", nrow(L), ncol(L)))
