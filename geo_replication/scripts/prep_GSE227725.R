#!/usr/bin/env Rscript
# Prepare the nursed piglet hypothalamus MIA versus control contrast, adjusting
# for sex, from the official Kallisto TPM matrix. Fractional TPM values are
# preserved and transformed exactly as log2(TPM + 1); they are never rounded or
# misrouted as counts. One incomplete source row is quarantined with a written
# reason rather than imputed.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE227725_sscr_hypothalamus_mia")
TPM <- file.path(DS, "raw", "GSE227725_RodriguezZas_Pig_D22_Hypothalamus_pig_GEO_counts.csv.gz")
SOFT <- file.path(DS, "metadata", "GSE227725_family.soft.gz")
if (!requireNamespace("data.table", quietly = TRUE)) stop("the data.table R package is required")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
pins <- data.frame(
  path = c(TPM, SOFT), bytes = c(8345843, 5676),
  sha256 = c("492274ab0e223f3b10bf0c30abe63e48bfebe9792e8536ac6f2226e1bc642855", "711dce59d4ebd7076ee028bb76de97902619f5e0be1ba26428fd3dec4cdf6b04"),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE227nnn/GSE227725/suppl/GSE227725_RodriguezZas_Pig_D22_Hypothalamus_pig_GEO_counts.csv.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE227nnn/GSE227725/soft/GSE227725_family.soft.gz"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(pins$path))) stop("required official source is missing")
observed_bytes <- as.numeric(file.info(pins$path)$size); observed_sha <- unname(vapply(pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, pins$bytes) || !identical(observed_sha, pins$sha256)) stop("source bytes/SHA-256 differ from reviewed inputs")

soft <- readLines(gzfile(SOFT), warn = FALSE)
if (!any(grepl("maternal immune activation and weaning on hypothalamus", soft, fixed = TRUE)) ||
    !any(grepl("transcripts per million (TPM) values", soft, fixed = TRUE)) ||
    !any(grepl("!Series_pubmed_id = 38431234", soft, fixed = TRUE))) stop("GEO experiment/TPM/citation metadata changed")
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft))
tag <- function(b, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), b, value = TRUE))
meta <- lapply(seq_along(starts), function(i) {
  b <- soft[starts[i]:ends[i]]; ch <- tag(b, "!Sample_characteristics_ch1"); rel <- tag(b, "!Sample_relation")
  title <- tag(b, "!Sample_title")
  data.frame(
    gsm = tag(b, "!Sample_geo_accession"), title = title,
    source_column = sub(".*\\[([^]]+)\\].*", "\\1", title),
    animal_id = sub("^sampleID: ", "", ch[grepl("^sampleID: ", ch)]),
    age = sub("^age: ", "", ch[grepl("^age: ", ch)]),
    mia = sub("^mia: ", "", ch[grepl("^mia: ", ch)]),
    sex = sub("^Sex: ", "", ch[grepl("^Sex: ", ch)]),
    treatment = sub("^treatment: ", "", ch[grepl("^treatment: ", ch)]),
    tissue = sub("^tissue: ", "", ch[grepl("^tissue: ", ch)]),
    biosample = sub(".*biosample/", "", rel[grepl("biosample/", rel, fixed = TRUE)]),
    srx = sub(".*term=", "", rel[grepl("sra[?]term=", rel)]), strategy = tag(b, "!Sample_library_strategy"),
    stringsAsFactors = FALSE
  )
})
meta <- do.call(rbind, meta); meta <- meta[meta$treatment == "Nursed", , drop = FALSE]
meta$group <- ifelse(meta$mia == "Control", "control", "case")
if (nrow(meta) != 35L || !identical(as.integer(table(meta$group)[c("control", "case")]), c(20L, 15L)) ||
    !identical(as.integer(table(meta$group, meta$sex)[c("control", "case"), c("Female", "Male")]), c(10L, 7L, 10L, 8L)) ||
    any(tolower(meta$tissue) != "hypothalamus") || any(meta$strategy != "RNA-Seq") ||
    anyDuplicated(meta$gsm) || anyDuplicated(meta$biosample) || anyDuplicated(meta$source_column)) stop("reviewed nursed 20+15 independent hypothalamus roster changed")

d <- data.table::fread(TPM, data.table = FALSE, check.names = FALSE, showProgress = FALSE)
if (!identical(dim(d), c(25187L, 74L)) || !identical(names(d)[1L], "Symbol")) stop("official TPM-table dimensions/schema changed")
ids <- as.character(d[["Symbol"]])
if (anyNA(ids) || any(!nzchar(ids)) || anyDuplicated(ids)) stop("blank or duplicate source symbols")
if (!all(meta$source_column %in% names(d))) stop("reviewed source columns are absent")
M_all <- as.matrix(d[, meta$source_column, drop = FALSE]); storage.mode(M_all) <- "double"; colnames(M_all) <- meta$gsm
bad <- rowSums(!is.finite(M_all)) > 0L
if (sum(bad) != 1L || !identical(ids[bad], "TRIM23") || sum(!is.finite(M_all[bad, ])) != 25L) stop("reviewed incomplete-row signature changed")
row_exclusions <- data.frame(
  source_symbol = ids[bad], reason = "incomplete official TPM row: 25/35 selected nursed samples are missing; no imputation permitted",
  selected_samples = ncol(M_all), missing_selected_values = rowSums(!is.finite(M_all))[bad], action = "quarantined before log2(TPM+1)",
  stringsAsFactors = FALSE
)
write.table(row_exclusions, file.path(DS, "metadata", "GSE227725_row_exclusions.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
quarantine <- data.frame(source_symbol = ids[bad], reason = row_exclusions$reason, M_all[bad, , drop = FALSE], check.names = FALSE, stringsAsFactors = FALSE)
write.table(quarantine, file.path(DS, "metadata", "GSE227725_quarantined_rows.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, na = "NA", eol = "\n")

source_ids <- ids[!bad]; M_source <- M_all[!bad, , drop = FALSE]
if (any(!is.finite(M_source)) || any(M_source < 0)) stop("TPM matrix contains nonfinite or negative values after reviewed quarantine")
valid_symbol <- grepl("^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._-]*$", source_ids, perl = TRUE)
if (sum(!valid_symbol) != 1L || !identical(source_ids[!valid_symbol], "ISG12(A)")) stop("reviewed symbol-syntax signature changed")
labels <- source_ids; labels[!valid_symbol] <- paste0("__UNMAPPED_SSCR_", sprintf("%05d", which(!valid_symbol)))
if (anyDuplicated(labels)) stop("output labels are not unique")
L <- log2(M_source + 1); rownames(L) <- labels

out <- data.frame(symbol = labels, L, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE227725_nursed_MIA_vs_control_log2tpm.tsv.gz")
old_digits <- getOption("digits"); options(digits = 17)
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)
options(digits = old_digits)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
written_delta <- max(abs(as.matrix(roundtrip[-1L]) - L))
if (!identical(roundtrip$symbol, labels) || !identical(names(roundtrip)[-1L], meta$gsm) || !is.finite(written_delta) || written_delta > 1e-12) stop("written matrix failed precision round-trip validation")

ss <- data.frame(
  sample = meta$gsm, group = meta$group, sex = meta$sex, geo_accession = meta$gsm, biosample = meta$biosample, sra = meta$srx,
  source_column = meta$source_column, animal_id = meta$animal_id, maternal_immune_activation = meta$mia,
  nursing_status = meta$treatment, tissue = meta$tissue, age = meta$age, stringsAsFactors = FALSE
)
write.table(ss, file.path(DS, "metadata", "GSE227725_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
map_audit <- data.frame(
  source_symbol = ids, output_label = c(labels, NA_character_)[match(seq_along(ids), c(which(!bad), which(bad)))],
  mapping_status = ifelse(bad, "quarantined_incomplete_TPM_row", ifelse(grepl("^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._-]*$", ids, perl = TRUE), "source_symbol_passthrough", "reserved_invalid_source_symbol_syntax")),
  stringsAsFactors = FALSE
)
# Fill output labels by original row position explicitly; quarantined rows have no output label.
map_audit$output_label <- NA_character_; map_audit$output_label[!bad] <- labels
write.table(map_audit, file.path(DS, "metadata", "GSE227725_identifier_mapping.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, na = "NA", eol = "\n")
cor_mat <- cor(L); pairwise_cor <- cor_mat[upper.tri(cor_mat)]
qc <- data.frame(
  sample = meta$gsm, group = meta$group, sex = meta$sex, source_column = meta$source_column,
  source_gene_rows = nrow(M_all), quarantined_incomplete_rows = sum(bad), output_rows = nrow(L),
  source_TPM_sum_after_quarantine = colSums(M_source), detected_features = colSums(M_source > 0),
  source_fractional_values = colSums(M_source != round(M_source)), source_nonfinite_values_after_quarantine = colSums(!is.finite(M_source)),
  source_negative_values = colSums(M_source < 0), min_pairwise_log2TPM_correlation = min(pairwise_cor),
  median_pairwise_log2TPM_correlation = median(pairwise_cor), written_max_abs_delta = written_delta,
  accepted_input_class = "Kallisto TPM (fractional normalized expression)", explicit_transform = "log2(TPM + 1)",
  shared_route = "input_kind=matrix -> canonical limma; batch_var=sex", stringsAsFactors = FALSE
)
if (any(qc$source_TPM_sum_after_quarantine < 1e5) || any(qc$detected_features < 10000L) ||
    any(qc$source_nonfinite_values_after_quarantine != 0L) || any(qc$source_negative_values != 0L)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE227725_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
manifest <- data.frame(file = basename(pins$path), bytes = observed_bytes, sha256 = observed_sha, source = pins$url, fetched = "2026-09-01", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE227725_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE227725] wrote %d log2(TPM+1) rows x %d samples; control=20, MIA=15; quarantined=%d; reserved-symbol=%d; correlation range=%.3f..%.3f\n",
            nrow(L), ncol(L), sum(bad), sum(!valid_symbol), min(pairwise_cor), max(pairwise_cor)))
