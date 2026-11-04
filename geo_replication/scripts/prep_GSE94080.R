#!/usr/bin/env Rscript
# Audit the proposed late-proestrus-versus-P7 medial-basal-hypothalamus
# contrast from GSE94080. GEO calls the deposited values adjusted log2 CPM per
# gene after edgeR GLM/voom with batch correction, but the workbook has an
# incompatible linear-CPM-like numeric signature. This script deliberately
# stops at that contradiction: it must not manufacture a scale interpretation.

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
DS <- file.path(ROOT, "datasets", "GSE94080_rnor_mbh_puberty")
SRC <- file.path(DS, "raw", "GSE94080_ontogeny_RNA_seq_adjusted_counts.xlsx")
SOFT <- file.path(DS, "metadata", "GSE94080_family.soft.gz")

paths <- c(SRC, SOFT)
expected_bytes <- c(10261622, 3269)
expected_sha256 <- c(
  "e317091a3419bc0d0911d821fdf50903473dfd1248e98c344b097647e29c85bb",
  "8aaeaccdf2639e739bf8c67585c76e6e82b0834577a39afe141dd60d68068bae"
)
if (any(!file.exists(paths))) stop("required GEO workbook or family SOFT is missing")
observed_bytes <- as.numeric(file.info(paths)$size)
observed_sha256 <- unname(vapply(paths, sha256_file, character(1)))
if (!identical(observed_bytes, expected_bytes) ||
    !identical(observed_sha256, expected_sha256)) {
  stop("GSE94080 source bytes or SHA-256 no longer match the pinned inputs")
}

samples <- data.frame(
  sample = c(paste0("P7_", 1:4), paste0("LP_", 1:4)),
  group = c(rep("control", 4L), rep("case", 4L)),
  geo_accession = c(paste0("GSM246836", 7:9), "GSM2468370", paste0("GSM246838", 3:6)),
  geo_title = c(paste0("PND 7-", 1:4), paste0("LP ", 1:4)),
  source_name_ch1 = c(rep("MBH_7 days", 4L), "MBH_31 days", "MBH_32 days",
                      "MBH_32 days", "MBH_33 days"),
  age_days = c(rep(7L, 4L), 31L, 32L, 32L, 33L),
  biosample = c("SAMN06272696", "SAMN06272695", "SAMN06272694", "SAMN06272693",
                "SAMN06272680", "SAMN06272679", "SAMN06272678", "SAMN06272677"),
  sra_experiment = c(paste0("SRX251810", 8:9), "SRX2518110", "SRX2518111",
                     paste0("SRX251812", 4:7)),
  biological_replicate = rep(1:4, 2L),
  stringsAsFactors = FALSE
)
if (any(table(samples$group) < 3L) || anyDuplicated(samples$sample) ||
    anyDuplicated(samples$geo_accession) || anyDuplicated(samples$biosample)) {
  stop("contrast lacks independent >=3/arm samples or contains duplicate sample identifiers")
}

# Validate every selected animal against its authoritative GEO sample block.
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

required_processing <- c(
  "Differential expression and normalized read counts using edgeR GLM modeling and voom estimation with batch correction",
  "Supplementary_files_format_and_content: .xlsx file, log2 counts per million per gene"
)
for (i in seq_len(nrow(samples))) {
  b <- block(samples$geo_accession[i])
  expected_characteristics <- c(
    "strain: sprague dawley (SD)",
    "gender: female",
    paste0("age: ", samples$age_days[i], " days"),
    "tissue: MBH (Medial Basal hypothalamus)"
  )
  relations <- tag(b, "!Sample_relation")
  observed_biosample <- sub("^.*/", "", grep("BioSample: ", relations, value = TRUE))
  observed_sra <- sub("^.*term=", "", grep("SRA: ", relations, value = TRUE))
  if (!identical(tag(b, "!Sample_title"), samples$geo_title[i]) ||
      !identical(tag(b, "!Sample_description"), samples$sample[i]) ||
      !identical(tag(b, "!Sample_source_name_ch1"), samples$source_name_ch1[i]) ||
      !identical(tag(b, "!Sample_organism_ch1"), "Rattus norvegicus") ||
      !identical(tag(b, "!Sample_characteristics_ch1"), expected_characteristics) ||
      !identical(observed_biosample, samples$biosample[i]) ||
      !identical(observed_sra, samples$sra_experiment[i]) ||
      !all(required_processing %in% tag(b, "!Sample_data_processing"))) {
    stop(samples$geo_accession[i], ": GEO metadata no longer matches the fixed MBH contrast")
  }
}

# Read every row and all 20 expression columns, not a preview or selected range.
sheet_name <- "ontogeny_RNA_seq_adjusted_count"
if (!identical(excel_sheets(SRC), sheet_name)) stop("unexpected workbook sheet structure")
expression_columns <- c(
  paste0("P7_", 1:4), paste0("P14_", 1:4), paste0("P21_", 1:4),
  paste0("P28_", 1:4), paste0("LP_", 1:4)
)
expected_columns <- c("Ensembl_ID", "Gene_ID", expression_columns)
d <- as.data.frame(
  read_excel(
    SRC,
    sheet = sheet_name,
    col_types = c("text", "text", rep("numeric", length(expression_columns)))
  ),
  check.names = FALSE,
  stringsAsFactors = FALSE
)
if (nrow(d) != 32662L || ncol(d) != 22L || !identical(names(d), expected_columns)) {
  stop("deposited GSE94080 workbook structure changed")
}

ensembl <- as.character(d$Ensembl_ID)
deposited_symbol <- as.character(d$Gene_ID)
if (anyNA(ensembl) || any(!nzchar(ensembl)) || anyDuplicated(ensembl) ||
    any(!grepl("^ENSRNOG[0-9]{11}(\\.[0-9]+)?$", ensembl))) {
  stop("Ensembl_ID must be unique, nonblank rat Ensembl gene identifiers")
}

# Only one-to-one, symbol-shaped deposited labels are promoted to gene symbols.
# Missing labels, numeric-only annotations, and every member of a duplicated
# label family receive unique non-gene sentinels. This avoids guessing a current
# alias and avoids arbitrarily selecting one adjusted-expression row when values
# cannot be summed on an author-described log scale.
symbol_nonblank <- !is.na(deposited_symbol) & nzchar(deposited_symbol)
if (any(symbol_nonblank & deposited_symbol != trimws(deposited_symbol))) {
  stop("deposited Gene_ID contains unexpected surrounding whitespace")
}
symbol_shape <- symbol_nonblank & grepl("^[A-Za-z][A-Za-z0-9._-]*$", deposited_symbol)
symbol_duplicate <- symbol_nonblank &
  (duplicated(deposited_symbol) | duplicated(deposited_symbol, fromLast = TRUE))
honest_symbol <- symbol_shape & !symbol_duplicate
if (sum(symbol_nonblank) != 20974L || sum(!symbol_nonblank) != 11688L ||
    sum(symbol_shape) != 20948L || sum(symbol_nonblank & !symbol_shape) != 26L ||
    sum(symbol_duplicate) != 1572L ||
    length(unique(deposited_symbol[symbol_duplicate])) != 727L ||
    sum(symbol_shape & symbol_duplicate) != 1568L || sum(honest_symbol) != 19380L) {
  stop("deposited Gene_ID mapping signature changed")
}
mapped_symbol <- ifelse(
  honest_symbol,
  deposited_symbol,
  sprintf("__UNMAPPED_GSE94080_%05d", seq_along(ensembl))
)
id_map <- data.frame(probe = ensembl, symbol = mapped_symbol, stringsAsFactors = FALSE)
if (anyDuplicated(id_map$probe) || anyDuplicated(id_map$symbol) ||
    sum(startsWith(id_map$symbol, "__UNMAPPED_GSE94080_")) != 13282L) {
  stop("fail-closed identifier map is not one-to-one")
}

M <- as.matrix(d[, expression_columns, drop = FALSE])
storage.mode(M) <- "double"
if (any(!is.finite(M)) || any(M <= 0)) stop("adjusted-expression values must be finite and positive")
fractional_cells <- sum(M != round(M))
if (length(M) != 653240L || fractional_cells != 653240L ||
    min(M) < 0.001 || min(M) > 0.01 || max(M) < 20000 || max(M) > 40000 ||
    min(colSums(M)) < 600000 || max(colSums(M)) > 1100000) {
  stop("workbook no longer has the pinned adjusted-expression scale signature")
}

stop(sprintf(
  paste0(
    "GSE94080 excluded by the normalized-matrix scale gate: GEO labels the ",
    "workbook log2 CPM, but the observed values span %.15g to %.15g and ",
    "column sums span %.15g to %.15g. Unchanged-value limma is invalid, and ",
    "an inferred log transform is forbidden without source-authored evidence."
  ),
  min(M), max(M), min(colSums(M)), max(colSums(M))
))

selected <- samples$sample
S <- M[, selected, drop = FALSE]
if (sum(apply(S, 1L, var) > 1e-8) != 32662L) {
  stop("selected LP-versus-P7 matrix unexpectedly contains constant rows")
}

out <- data.frame(Ensembl_ID = ensembl, S, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE94080_mbh_LP_vs_P7_adjusted_expression.tsv.gz")
old_options <- options(digits = 17, scipen = 999)
con <- gzfile(out_path, "w")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
close(con)
options(old_options)

roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
written_delta <- apply(abs(as.matrix(roundtrip[, selected, drop = FALSE]) - S), 2L, max)
if (!identical(roundtrip$Ensembl_ID, ensembl) ||
    !identical(names(roundtrip), c("Ensembl_ID", selected)) ||
    any(written_delta > 1e-10)) {
  stop("written analysis matrix failed the exact-copy round-trip gate")
}

samplesheet <- data.frame(
  sample = samples$sample,
  group = samples$group,
  geo_accession = samples$geo_accession,
  biosample = samples$biosample,
  sra_experiment = samples$sra_experiment,
  source_column = samples$sample,
  tissue = "medial basal hypothalamus",
  strain = "Sprague Dawley (SD)",
  sex = "female",
  pubertal_stage = c(rep("postnatal day 7", 4L),
                     rep("late proestrus (day of first ovulation)", 4L)),
  collection_pnd = samples$age_days,
  biological_replicate = samples$biological_replicate,
  stringsAsFactors = FALSE
)
write.table(
  samplesheet,
  file.path(DS, "metadata", "GSE94080_samplesheet.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"
)

id_map_path <- file.path(DS, "metadata", "GSE94080_id_map.tsv")
write.table(id_map, id_map_path, sep = "\t", quote = FALSE, row.names = FALSE,
            col.names = FALSE, eol = "\n")
id_map_roundtrip <- read.delim(
  id_map_path,
  header = FALSE,
  col.names = c("probe", "symbol"),
  stringsAsFactors = FALSE
)
if (!identical(id_map_roundtrip, id_map)) stop("identifier map failed round-trip validation")

identifier_qc <- data.frame(
  metric = c(
    "source_features", "valid_unique_ensembl_ids", "gene_id_nonblank",
    "gene_id_blank", "gene_id_symbol_shaped", "gene_id_invalid_nonblank",
    "duplicate_gene_id_rows", "duplicate_gene_id_names",
    "duplicate_symbol_shaped_rows", "promoted_one_to_one_gene_symbols",
    "fail_closed_sentinel_rows", "id_map_rows"
  ),
  value = c(
    length(ensembl), length(unique(ensembl)), sum(symbol_nonblank),
    sum(!symbol_nonblank), sum(symbol_shape), sum(symbol_nonblank & !symbol_shape),
    sum(symbol_duplicate), length(unique(deposited_symbol[symbol_duplicate])),
    sum(symbol_shape & symbol_duplicate), sum(honest_symbol),
    sum(!honest_symbol), nrow(id_map)
  ),
  stringsAsFactors = FALSE
)
write.table(
  identifier_qc,
  file.path(DS, "processed", "GSE94080_identifier_qc.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"
)

selected_index <- match(expression_columns, samples$sample)
qc_group <- samples$group[selected_index]
qc_group[is.na(qc_group)] <- "not_selected"
qc_written_delta <- written_delta[match(expression_columns, names(written_delta))]
qc <- data.frame(
  sample = expression_columns,
  selected_for_contrast = expression_columns %in% selected,
  group = qc_group,
  source_rows = nrow(M),
  source_nonfinite_values = colSums(!is.finite(M)),
  source_nonpositive_values = colSums(M <= 0),
  source_fractional_values = colSums(M != round(M)),
  source_adjusted_expression_sum = colSums(M),
  source_min = apply(M, 2L, min),
  source_median = apply(M, 2L, median),
  source_max = apply(M, 2L, max),
  source_unique_values = apply(M, 2L, function(x) length(unique(x))),
  written_matrix_max_abs_delta = qc_written_delta,
  stringsAsFactors = FALSE
)
if (any(qc$source_nonfinite_values != 0) || any(qc$source_nonpositive_values != 0) ||
    any(qc$source_fractional_values != nrow(M)) ||
    any(qc$written_matrix_max_abs_delta > 1e-10, na.rm = TRUE)) {
  stop("preprocessing QC failed")
}
write.table(
  qc,
  file.path(DS, "processed", "GSE94080_preprocessing_qc.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"
)

manifest <- data.frame(
  file = basename(paths),
  bytes = observed_bytes,
  sha256 = observed_sha256,
  source = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE94nnn/GSE94080/suppl/GSE94080_ontogeny_RNA_seq_adjusted_counts.xlsx",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE94nnn/GSE94080/soft/GSE94080_family.soft.gz"
  ),
  fetched = "2026-08-31",
  stringsAsFactors = FALSE
)
write.table(
  manifest,
  file.path(DS, "metadata", "GSE94080_source_files.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"
)

cat(sprintf(
  paste0(
    "[GSE94080] copied %d features x %d samples (P7=4, LP=4) without transform/rounding; ",
    "%d one-to-one deposited symbols promoted and %d rows quarantined as non-gene sentinels\n"
  ),
  nrow(S), ncol(S), sum(honest_symbol), sum(!honest_symbol)
))
