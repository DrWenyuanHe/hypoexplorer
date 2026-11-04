#!/usr/bin/env Rscript
# Prepare whole-hypothalamus FPKM after peri-adolescent 55% fructose feeding.
# Deposited linear FPKM values and feature identifiers are preserved exactly,
# then transformed only as log2(FPKM + 1) for matrix-based analysis.

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
DS <- file.path(ROOT, "datasets", "GSE56238_rnor_hypothalamus_fructose")
SRC <- file.path(DS, "raw", "GSE56238_FPKM_exprs.txt.gz")
SOFT <- file.path(DS, "metadata", "GSE56238_family.soft.gz")

paths <- c(SRC, SOFT)
expected_bytes <- c(749982, 3260)
expected_sha256 <- c(
  "236653604d97aaa8bde41420a9dfee5c6d59354e9e5ec290e682ce006aea99ee",
  "717bbac787b99985b493eb54730653d025760a985055451ce5efe555b47aaa7f"
)
if (any(!file.exists(paths))) stop("required GEO source or family SOFT is missing")
observed_bytes <- as.numeric(file.info(paths)$size)
observed_sha256 <- unname(vapply(paths, sha256_file, character(1)))
if (!identical(observed_bytes, expected_bytes) || !identical(observed_sha256, expected_sha256)) {
  stop("GSE56238 source bytes or SHA-256 no longer match the pinned inputs")
}

titles <- c("Sample_HYT_1-1", "Sample_HYT_1-7", "Sample_HYT_2-5", "Sample_HYT_3-6",
            "Sample_HYT_4-5", "Sample_HYT_5-5", "Sample_HYT_7-1", "Sample_HYT_18-4",
            "Sample_HYT_19-3", "Sample_HYT_20-5", "Sample_HYT_21-7", "Sample_HYT_23-2",
            "Sample_HYT_26-2")
samples <- data.frame(
  gsm = paste0("GSM", 1357492:1357504), source_column = titles, geo_title = titles,
  group = c(rep("control", 7L), rep("case", 6L)),
  diet = c(rep("Standard Chow", 7L), rep("High Fructose Chow", 6L)),
  biological_replicate = c(1:7, 1:6), stringsAsFactors = FALSE
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
  b <- block(samples$gsm[i]); title <- tag(b, "!Sample_title")
  source_name <- tag(b, "!Sample_source_name_ch1"); organism <- tag(b, "!Sample_organism_ch1")
  chars <- tag(b, "!Sample_characteristics_ch1")
  if (!identical(title, samples$geo_title[i]) || !identical(source_name, "Hypothalamus") ||
      !identical(organism, "Rattus norvegicus") || !identical(chars, paste0("diet: ", samples$diet[i]))) {
    stop(samples$gsm[i], ": GEO metadata no longer matches the fixed whole-hypothalamus diet contrast")
  }
  rel <- grep("^BioSample: ", tag(b, "!Sample_relation"), value = TRUE)
  if (length(rel) != 1L) stop("expected one BioSample for ", samples$gsm[i])
  biosample[i] <- sub("^.*/", "", rel)
}
if (anyDuplicated(biosample)) stop("selected libraries share a BioSample")
samples$biosample <- biosample

d <- read.delim(gzfile(SRC), check.names = FALSE, stringsAsFactors = FALSE)
expected_columns <- c("ID_REF", titles)
if (nrow(d) != 17366L || ncol(d) != 14L || !identical(names(d), expected_columns)) {
  stop("deposited GSE56238 FPKM matrix structure changed")
}
ids <- as.character(d$ID_REF)
if (anyNA(ids) || any(!nzchar(ids)) || anyDuplicated(ids)) stop("ID_REF values must be nonblank and unique")

# Cufflinks can assign one assembled feature/locus to several annotated genes;
# the deposited gene_short_name-like label then contains a comma-separated list.
# It also emits multiple locus-tagged rows such as Gene_XLOC_000123, for which
# stripping the locus suffix would collapse distinct quantified features onto a
# guessed gene.  Neither form is a one-gene estimate: splitting a compound would
# copy the same FPKM value to several genes, choosing one token would be arbitrary,
# and stripping XLOC would invent a many-to-one aggregation rule.  Preserve every
# original ID_REF in the matrix and feature-level DE, but map the ambiguous union's
# symbol slot to unique, explicit non-gene sentinels.  The canonical runner cannot
# match these to a panel/MSigDB symbol and the public normalizer drops all `__*`
# identifiers, so the policy fails closed without discarding deposited rows.
compound <- grepl(",", ids, fixed = TRUE)
compound_ids <- ids[compound]
component_n <- lengths(strsplit(compound_ids, ",", fixed = TRUE))
component_distribution <- c(`2` = 111L, `3` = 10L, `4` = 1L, `5` = 1L,
                            `6` = 2L, `8` = 2L, `13` = 1L, `15` = 1L)
observed_distribution <- table(factor(component_n, levels = as.integer(names(component_distribution))))
if (length(compound_ids) != 129L ||
    !identical(unname(as.integer(observed_distribution)), unname(component_distribution)) ||
    sum(component_n) != 317L || length(unique(unlist(strsplit(compound_ids, ",", fixed = TRUE)))) != 314L) {
  stop("deposited Cufflinks compound-label signature changed")
}
xloc <- grepl("_XLOC_[0-9]+$", ids)
ambiguous <- compound | xloc
ambiguous_ids <- ids[ambiguous]
if (sum(xloc) != 940L || sum(compound & xloc) != 2L || length(ambiguous_ids) != 1067L) {
  stop("deposited Cufflinks XLOC/ambiguous-union signature changed")
}
id_map <- data.frame(
  probe = ambiguous_ids,
  symbol = sprintf("__AMBIGUOUS_CUFFLINKS_%05d", seq_along(ambiguous_ids)),
  stringsAsFactors = FALSE
)
if (anyDuplicated(id_map$probe) || anyDuplicated(id_map$symbol) ||
    any(!grepl("^__AMBIGUOUS_CUFFLINKS_[0-9]{5}$", id_map$symbol))) {
  stop("ambiguous Cufflinks sentinel map is not one-to-one")
}
M <- as.matrix(d[, samples$source_column, drop = FALSE]); storage.mode(M) <- "double"
if (any(!is.finite(M)) || any(M < 0)) stop("FPKM values must be finite and non-negative")
integer_fraction <- mean(M == round(M))
if (integer_fraction < 0.20 || integer_fraction > 0.30 || max(M) < 1e4 ||
    min(colSums(M)) < 5e5 || max(colSums(M)) > 7e5) {
  stop("source no longer has the pinned linear FPKM signature")
}

L <- log2(M + 1)
reconstructed <- 2^L - 1
transform_delta <- apply(abs(reconstructed - M), 2L, max)
conservation_delta <- colSums(reconstructed) - colSums(M)
if (any(transform_delta > 1e-9) || any(abs(conservation_delta) > 1e-7)) {
  stop("log2(FPKM+1) reversibility or conservation failed")
}

variable <- apply(L, 1L, var) > 1e-8
if (sum(compound & variable) != 91L || sum(xloc) != 940L ||
    sum(xloc & variable) != 285L || sum(compound & xloc) != 2L ||
    sum(ambiguous & variable) != 376L) {
  stop("deposited identifier/variance audit signature changed")
}

out <- data.frame(ID_REF = ids, L, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE56238_hypothalamus_fructose_vs_chow_log2fpkm.tsv.gz")
old_options <- options(digits = 17, scipen = 999)
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)
options(old_options)

roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$ID_REF, ids) || !identical(names(roundtrip)[-1L], samples$source_column) ||
    max(abs(as.matrix(roundtrip[-1L]) - L)) > 1e-12) stop("written analysis matrix failed round-trip validation")

ss <- data.frame(
  sample = samples$source_column, group = samples$group, geo_accession = samples$gsm,
  biosample = samples$biosample, source_column = samples$source_column,
  tissue = "whole hypothalamus", strain = "Wistar", sex = "male",
  stress = "non-stress", injection = "saline control", fasting_state = "fasted",
  collection_pnd = 80L, diet = samples$diet,
  fructose_content = ifelse(samples$group == "case", "55%", "0.30%"),
  biological_replicate = samples$biological_replicate, stringsAsFactors = FALSE
)
write.table(ss, file.path(DS, "metadata", "GSE56238_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
id_map_path <- file.path(DS, "metadata", "GSE56238_id_map.tsv")
write.table(id_map, id_map_path, sep = "\t", quote = FALSE, row.names = FALSE,
            col.names = FALSE, eol = "\n")
id_map_roundtrip <- read.delim(id_map_path, header = FALSE,
                               col.names = c("probe", "symbol"), stringsAsFactors = FALSE)
if (!identical(id_map_roundtrip, id_map)) stop("compound-label ID map failed round-trip validation")

identifier_qc <- data.frame(
  metric = c(
    "source_features", "compound_feature_labels", "compound_components",
    "unique_compound_components", "compound_nonconstant_features",
    "xloc_suffixed_features", "xloc_nonconstant_features",
    "compound_xloc_overlap", "ambiguous_union_features", "ambiguous_union_nonconstant_features",
    "id_map_rows", paste0("compound_labels_with_", names(component_distribution), "_components")
  ),
  value = c(
    length(ids), length(compound_ids), sum(component_n),
    length(unique(unlist(strsplit(compound_ids, ",", fixed = TRUE)))), sum(compound & variable),
    sum(xloc), sum(xloc & variable), sum(compound & xloc), sum(ambiguous),
    sum(ambiguous & variable), nrow(id_map), unname(component_distribution)
  ),
  stringsAsFactors = FALSE
)
write.table(identifier_qc, file.path(DS, "processed", "GSE56238_identifier_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

qc <- data.frame(
  sample = samples$source_column, group = samples$group, geo_accession = samples$gsm,
  source_rows = nrow(M), output_rows = nrow(L), source_nonfinite_values = colSums(!is.finite(M)),
  source_negative_values = colSums(M < 0), source_fractional_values = colSums(M != round(M)),
  source_fpkm_sum = colSums(M), reconstructed_linear_fpkm_sum = colSums(reconstructed),
  fpkm_conservation_delta = conservation_delta, fpkm_conserved = abs(conservation_delta) <= 1e-7,
  detected_features = colSums(M > 0), log2_expression_sum = colSums(L),
  transform_max_abs_delta = transform_delta, written_matrix_max_abs_delta = apply(abs(as.matrix(roundtrip[-1L]) - L), 2L, max),
  stringsAsFactors = FALSE
)
if (any(!qc$fpkm_conserved) || any(qc$transform_max_abs_delta > 1e-9) ||
    any(qc$written_matrix_max_abs_delta > 1e-12)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE56238_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

manifest <- data.frame(
  file = basename(paths), bytes = observed_bytes, sha256 = observed_sha256,
  source = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE56nnn/GSE56238/suppl/GSE56238_FPKM_exprs.txt.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE56nnn/GSE56238/soft/GSE56238_family.soft.gz"
  ), fetched = "2026-08-31", stringsAsFactors = FALSE
)
write.table(manifest, file.path(DS, "metadata", "GSE56238_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf(paste0("[GSE56238] wrote %d features x %d samples (control=7, case=6); ",
                   "FPKM values were not rounded; %d ambiguous Cufflinks labels map to non-gene sentinels ",
                   "(%d nonconstant; %d compound and %d XLOC source labels)\n"),
            nrow(L), ncol(L), length(ambiguous_ids), sum(ambiguous & variable),
            sum(compound), sum(xloc)))
