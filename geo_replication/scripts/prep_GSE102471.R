#!/usr/bin/env Rscript
# Prepare the fixed EED-overexpression-versus-GFP-control contrast from the
# GSE102471 rat medial-basal-hypothalamus raw-count workbook.

suppressPackageStartupMessages(library(readxl))

get_script_dir <- function() {
  a <- commandArgs(FALSE)
  f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}

sha256_file <- function(path) {
  z <- system2(
    "certutil",
    c("-hashfile", shQuote(normalizePath(path)), "SHA256"),
    stdout = TRUE,
    stderr = TRUE
  )
  z <- tolower(trimws(z))
  z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  z
}

ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE102471_rnor_mbh_eed_overexpression")
SRC <- file.path(DS, "raw", "GSE102471_EED_raw_counts.xlsx")
SOFT <- file.path(DS, "metadata", "GSE102471_family.soft.gz")

paths <- c(SRC, SOFT)
expected_bytes <- c(1694843, 2489)
expected_sha256 <- c(
  "dd2ab59826ea27871bcbe56a6e06b1c82f551a65763454dbc31f57b55722d05d",
  "44704c00e1dba110fab7f6d2584adbe590a22761377d8a062675ba3ed4911907"
)
if (any(!file.exists(paths))) stop("required GEO workbook or family SOFT is missing")
observed_bytes <- as.numeric(file.info(paths)$size)
observed_sha256 <- unname(vapply(paths, sha256_file, character(1)))
if (!identical(observed_bytes, expected_bytes) ||
    !identical(observed_sha256, expected_sha256)) {
  stop("GSE102471 source bytes or SHA-256 no longer match the pinned inputs")
}

samples <- data.frame(
  sample = c("C2", "C3", "C5", "C7", "E4", "E5", "E7", "E8"),
  group = c(rep("control", 4L), rep("case", 4L)),
  geo_accession = paste0("GSM273834", 2:9),
  geo_title = c("Control 2", "Control 3", "Control 5", "Control 7",
                "EED 4", "EED 5", "EED 7", "EED 8"),
  treatment = c(rep("GFP (control)", 4L), rep("EED", 4L)),
  source_name_ch1 = c(rep("MBH, control", 4L), rep("MBH, EED", 4L)),
  biosample = paste0("SAMN074881", 97:90),
  sra_experiment = paste0("SRX308", 3287:3294),
  animal_label = c("2", "3", "5", "7", "4", "5", "7", "8"),
  biological_replicate = rep(1:4, 2L),
  stringsAsFactors = FALSE
)
if (any(table(samples$group) < 3L) || anyDuplicated(samples$sample) ||
    anyDuplicated(samples$geo_accession) || anyDuplicated(samples$biosample)) {
  stop("contrast lacks independent >=3/arm samples or contains duplicate sample identifiers")
}

soft <- readLines(gzfile(SOFT), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft)
ends <- c(starts[-1L] - 1L, length(soft))
names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
block <- function(gsm) {
  i <- match(gsm, names(starts))
  if (is.na(i)) stop("GSM absent from SOFT: ", gsm)
  soft[starts[i]:ends[i]]
}
tag <- function(x, key) {
  sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
}

expected_characteristics_fixed <- c(
  "strain/background: Sprague Dawley",
  "gender: Female",
  "age: 28 days"
)
expected_processing <- c(
  "Mapping to Ensembl build 83 using Bioconductor Rsubread package using default parameters except countMultiMappingReads = TRUE, AllowMultiOverlaps = TRUE.",
  "Genome_build: rat rn6 (Rnor_6.0), Ensembl build 83 annotation",
  "Supplementary_files_format_and_content: EED_raw_counts.xlsx: Excel file includes raw counts."
)
for (i in seq_len(nrow(samples))) {
  b <- block(samples$geo_accession[i])
  chars <- tag(b, "!Sample_characteristics_ch1")
  relations <- tag(b, "!Sample_relation")
  observed_biosample <- sub("^.*/", "", grep("BioSample: ", relations, value = TRUE))
  observed_sra <- sub("^.*term=", "", grep("SRA: ", relations, value = TRUE))
  descriptions <- tag(b, "!Sample_description")
  if (!identical(tag(b, "!Sample_title"), samples$geo_title[i]) ||
      !identical(tag(b, "!Sample_source_name_ch1"), samples$source_name_ch1[i]) ||
      !identical(tag(b, "!Sample_organism_ch1"), "Rattus norvegicus") ||
      !identical(chars[1:3], expected_characteristics_fixed) ||
      !identical(chars[4], paste0("treatment: ", samples$treatment[i])) ||
      !identical(chars[5], "tissue: MBH (medial basal hypothalamus)") ||
      !identical(descriptions[1], samples$sample[i]) ||
      !identical(observed_biosample, samples$biosample[i]) ||
      !identical(observed_sra, samples$sra_experiment[i]) ||
      !all(expected_processing %in% tag(b, "!Sample_data_processing"))) {
    stop(samples$geo_accession[i], ": GEO metadata no longer matches the fixed MBH contrast")
  }
}

sheet_name <- "Raw Counts"
if (!identical(excel_sheets(SRC), sheet_name)) stop("unexpected workbook sheet structure")
expected_columns <- c("Ensembl_ID", samples$sample)
d <- as.data.frame(
  read_excel(SRC, sheet = sheet_name,
             col_types = c("text", rep("numeric", nrow(samples)))),
  check.names = FALSE,
  stringsAsFactors = FALSE
)
if (nrow(d) != 32662L || ncol(d) != 9L || !identical(names(d), expected_columns)) {
  stop("deposited GSE102471 raw-count workbook structure changed")
}

ids <- as.character(d$Ensembl_ID)
if (anyNA(ids) || any(!nzchar(ids)) || anyDuplicated(ids) ||
    any(!grepl("^ENSRNOG[0-9]{11}(\\.[0-9]+)?$", ids))) {
  stop("Ensembl_ID must be unique, nonblank rat Ensembl gene identifiers")
}

M <- as.matrix(d[, samples$sample, drop = FALSE])
storage.mode(M) <- "double"
expected_library_sizes <- c(16530334, 17916853, 16547868, 20441235,
                            19082468, 15906832, 18822727, 17524911)
expected_detected <- c(23912L, 23641L, 23906L, 24786L,
                       24483L, 24791L, 24835L, 24921L)
if (length(M) != 261296L || any(!is.finite(M)) || any(M < 0) ||
    any(M != round(M)) || min(M) != 0 || max(M) != 985632 ||
    !identical(as.numeric(colSums(M)), expected_library_sizes) ||
    !identical(as.integer(colSums(M > 0)), expected_detected) ||
    sum(rowSums(M) == 0) != 2271L) {
  stop("workbook no longer has the pinned nonnegative integer count signature")
}

out <- data.frame(Ensembl_ID = ids, M, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE102471_mbh_EED_vs_GFP_counts.tsv.gz")
old_options <- options(digits = 17, scipen = 999)
con <- gzfile(out_path, "w")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
close(con)
options(old_options)

roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
roundtrip_M <- as.matrix(roundtrip[, samples$sample, drop = FALSE])
storage.mode(roundtrip_M) <- "double"
if (!identical(roundtrip$Ensembl_ID, ids) ||
    !identical(names(roundtrip), expected_columns) ||
    !identical(roundtrip_M, M)) {
  stop("written analysis count matrix failed exact round-trip validation")
}

samplesheet <- data.frame(
  sample = samples$sample,
  group = samples$group,
  geo_accession = samples$geo_accession,
  biosample = samples$biosample,
  sra_experiment = samples$sra_experiment,
  source_column = samples$sample,
  tissue = "medial basal hypothalamus",
  strain = "Sprague Dawley",
  sex = "female",
  injection_pnd = 21L,
  collection_pnd = 28L,
  lentiviral_construct = ifelse(samples$group == "case", "EED-overexpressing", "GFP-expressing control"),
  animal_label = samples$animal_label,
  biological_replicate = samples$biological_replicate,
  stringsAsFactors = FALSE
)
write.table(
  samplesheet,
  file.path(DS, "metadata", "GSE102471_samplesheet.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"
)

qc <- data.frame(
  sample = samples$sample,
  group = samples$group,
  geo_accession = samples$geo_accession,
  source_rows = nrow(M),
  source_nonfinite_values = colSums(!is.finite(M)),
  source_negative_values = colSums(M < 0),
  source_fractional_values = colSums(M != round(M)),
  source_library_size = colSums(M),
  detected_genes = colSums(M > 0),
  output_rows = nrow(roundtrip_M),
  output_library_size = colSums(roundtrip_M),
  count_conservation_delta = colSums(roundtrip_M) - colSums(M),
  output_integer_counts = colSums(roundtrip_M != round(roundtrip_M)) == 0,
  metadata_match = TRUE,
  stringsAsFactors = FALSE
)
if (any(qc$source_nonfinite_values != 0) || any(qc$source_negative_values != 0) ||
    any(qc$source_fractional_values != 0) || any(qc$count_conservation_delta != 0) ||
    any(!qc$output_integer_counts)) {
  stop("preprocessing QC failed")
}
write.table(
  qc,
  file.path(DS, "processed", "GSE102471_preprocessing_qc.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"
)

identifier_qc <- data.frame(
  metric = c("source_features", "unique_ensembl_ids", "valid_rat_ensembl_ids",
             "all_zero_features", "nonzero_count_cells", "fractional_count_cells"),
  value = c(length(ids), length(unique(ids)), sum(grepl("^ENSRNOG[0-9]{11}(\\.[0-9]+)?$", ids)),
            sum(rowSums(M) == 0), sum(M > 0), sum(M != round(M))),
  stringsAsFactors = FALSE
)
write.table(
  identifier_qc,
  file.path(DS, "processed", "GSE102471_identifier_qc.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"
)

manifest <- data.frame(
  file = basename(paths),
  bytes = observed_bytes,
  sha256 = observed_sha256,
  source = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE102nnn/GSE102471/suppl/GSE102471_EED_raw_counts.xlsx",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE102nnn/GSE102471/soft/GSE102471_family.soft.gz"
  ),
  fetched = "2026-08-31",
  stringsAsFactors = FALSE
)
write.table(
  manifest,
  file.path(DS, "metadata", "GSE102471_source_files.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"
)

cat(sprintf(
  paste0("[GSE102471] wrote %d unique Ensembl genes x %d independent MBH libraries ",
         "(GFP=4, EED=4); integer libraries %.2fM-%.2fM, exact conservation\n"),
  nrow(M), ncol(M), min(colSums(M)) / 1e6, max(colSums(M)) / 1e6
))
