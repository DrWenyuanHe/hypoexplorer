#!/usr/bin/env Rscript
# Prepare the adult-male whole-hypothalamus diet-induced-obesity contrast from
# GSE100349. The official WTTS-seq table contains integer mapped-read counts at
# poly(A)-site resolution. Sites with a deposited gene symbol are summed on the
# linear count scale; unannotated sites retain unique source-derived IDs.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE100349_rnor_hypothalamus_hfd_wtts")
SRC <- file.path(DS, "raw", "GSE100349_Expression_table_WTTS-seq_rat.txt.gz")
SOFT <- file.path(DS, "metadata", "GSE100349_family.soft.gz")

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
  path = c(SRC, SOFT),
  bytes = c(1879353, 2499),
  sha256 = c(
    "f6a0a87010c458c33f6e4b0811a44004fb56c909938b7500a471935e3ffcc534",
    "098149f9b25d5cbe59baf43dcc3896bf9d3d9562d79456a038e9e962a51f8b94"
  ),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE100nnn/GSE100349/suppl/GSE100349_Expression_table_WTTS-seq_rat.txt.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE100nnn/GSE100349/soft/GSE100349_family.soft.gz"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(source_pins$path))) stop("required official GEO source or family SOFT is missing")
observed_bytes <- as.numeric(file.info(source_pins$path)$size)
observed_sha <- unname(vapply(source_pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, source_pins$bytes) || !identical(observed_sha, source_pins$sha256)) {
  stop("source bytes/SHA-256 differ from the reviewed GEO inputs")
}

samples <- data.frame(
  gsm = c("GSM2679011", "GSM2679012", "GSM2679013", "GSM2679014",
          "GSM2679007", "GSM2679008", "GSM2679009", "GSM2679010"),
  source_column = paste0(c("Rat-Control1", "Rat-Control2", "Rat-Control3", "Rat-Control4",
                           "Rat-OB1", "Rat-OB2", "Rat-OB3", "Rat-OB4"), "-WTTS mapped reads"),
  sample = c(paste0("Chow_", 1:4), paste0("HFD_DIO_", 1:4)),
  group = rep(c("control", "case"), each = 4L),
  disease_state = rep(c("control", "diet-induced obesity"), each = 4L),
  biological_replicate = rep(1:4, 2L), stringsAsFactors = FALSE
)
if (any(table(samples$group) < 3L) || anyDuplicated(samples$gsm) || anyDuplicated(samples$source_column)) {
  stop("contrast lacks >=3 independent biological replicates per arm")
}

# Resolve every selected library to a distinct GEO BioSample, and verify the
# contrast labels plus the series-level male/diet design in the family SOFT.
soft <- readLines(gzfile(SOFT), warn = FALSE)
design <- sub("^!Series_overall_design = ", "", grep("^!Series_overall_design = ", soft, value = TRUE))
if (length(design) != 1L || !grepl("Eight adult male Long-Evans rats", design, fixed = TRUE) ||
    !grepl("Following 36 days of diet exposure", design, fixed = TRUE)) {
  stop("GEO series design no longer documents eight adult male rats and 36-day diet exposure")
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
  b <- block(samples$gsm[i]); title <- tag(b, "!Sample_title")
  chars <- tag(b, "!Sample_characteristics_ch1")
  expected_title <- sub(" mapped reads$", "", samples$source_column[i])
  required <- c("strain: Long-Evans", "tissue: Hypothalamus", "developmental stage: Adult",
                paste0("disease state: ", samples$disease_state[i]))
  if (!identical(title, expected_title) || !identical(tag(b, "!Sample_source_name_ch1"), "Hypothalamus") ||
      !all(required %in% chars)) stop(samples$gsm[i], ": GEO metadata no longer match the selected contrast")
  rel <- grep("^BioSample: ", tag(b, "!Sample_relation"), value = TRUE)
  if (length(rel) != 1L) stop(samples$gsm[i], ": expected exactly one BioSample")
  biosample[i] <- sub("^.*/", "", rel)
}
if (anyDuplicated(biosample)) stop("selected libraries share a BioSample")
samples$biosample <- biosample

d <- read.delim(gzfile(SRC), check.names = FALSE, stringsAsFactors = FALSE)
if (nrow(d) != 73923L || ncol(d) != 19L || !identical(names(d)[1L], "ID")) stop("official WTTS table dimensions/schema changed")
missing_columns <- setdiff(samples$source_column, names(d)); if (length(missing_columns)) stop("missing WTTS sample columns")
is_feature <- grepl("^APSs_ID_[0-9]+$", d$ID)
if (sum(is_feature) != 73922L || sum(!is_feature) != 1L || nzchar(trimws(d$ID[!is_feature]))) {
  stop("expected exactly 73,922 APS features plus one blank-ID footer")
}
feature <- d[is_feature, , drop = FALSE]
if (anyNA(feature$ID) || anyDuplicated(feature$ID)) stop("invalid or duplicate APS IDs")
M_site <- as.matrix(feature[, samples$source_column, drop = FALSE]); storage.mode(M_site) <- "double"
colnames(M_site) <- samples$sample
if (any(!is.finite(M_site)) || any(M_site < 0) || any(M_site != round(M_site))) {
  stop("WTTS mapped-read values are not finite non-negative integers")
}

symbol <- trimws(as.character(feature$Symbol))
gene_id <- trimws(as.character(feature$Gene_id))
valid_symbol <- !is.na(symbol) & nzchar(symbol) & symbol != "-"
valid_gene_id <- !is.na(gene_id) & nzchar(gene_id) & gene_id != "-"
# The submitter's Symbol column also contains 273 analysis/selection labels
# (UP<0.05, UP<0.05top, UP<0.05top10) whose Gene_id is explicitly "-".
# They are not genes and must never be rowsummed into three pseudo-genes.
placeholder_symbol <- valid_symbol & !valid_gene_id
if (sum(placeholder_symbol) != 273L ||
    !setequal(unique(symbol[placeholder_symbol]), c("UP<0.05", "UP<0.05top", "UP<0.05top10"))) {
  stop("unexpected non-gene Symbol labels among Gene_id='-' APS rows")
}
annotated <- valid_symbol & valid_gene_id
# Preserve every unannotated APS for exact count conservation, but give it a
# unique, explicitly non-gene identifier. The shared symbol normalizer drops
# the reserved '__' namespace from public gene panels/bundles.
key <- ifelse(annotated, symbol, paste0("__UNANNOTATED_", feature$ID))
# reorder=FALSE fixes output order to first source occurrence, avoiding locale-
# dependent symbol sorting while preserving exact integer sums.
M_gene <- rowsum(M_site, group = key, reorder = FALSE)
source_lib <- colSums(M_site); gene_lib <- colSums(M_gene)
if (any(gene_lib != source_lib)) stop("site-to-gene aggregation failed exact library-size conservation")
if (any(M_gene != round(M_gene)) || any(M_gene < 0)) stop("aggregated matrix lost integer-count semantics")

out <- data.frame(symbol = rownames(M_gene), M_gene, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE100349_gene_counts.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)

ss <- data.frame(
  sample = samples$sample, group = samples$group, geo_accession = samples$gsm,
  biosample = samples$biosample, source_column = samples$source_column,
  condition = ifelse(samples$group == "control", "standard rodent chow", "high-fat diet; diet-induced obesity"),
  tissue = "whole hypothalamus", strain = "Long-Evans", sex = "male", age = "adult",
  exposure_days = 36L, biological_replicate = samples$biological_replicate,
  stringsAsFactors = FALSE
)
write.table(ss, file.path(DS, "metadata", "GSE100349_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

qc <- data.frame(
  sample = samples$sample, group = samples$group, geo_accession = samples$gsm,
  source_rows_total = nrow(d), source_feature_rows = nrow(feature), source_footer_rows_excluded = sum(!is_feature),
  source_unique_aps_ids = length(unique(feature$ID)), source_annotated_sites = sum(annotated),
  source_unannotated_sites = sum(!annotated), source_placeholder_symbol_sites = sum(placeholder_symbol),
  output_rows = nrow(M_gene),
  source_nonfinite_counts = colSums(!is.finite(M_site)), source_negative_counts = colSums(M_site < 0),
  source_noninteger_counts = colSums(M_site != round(M_site)), source_library_size = source_lib,
  output_library_size = gene_lib, count_conservation_delta = gene_lib - source_lib,
  count_conserved = gene_lib == source_lib, detected_source_sites = colSums(M_site > 0),
  detected_output_features = colSums(M_gene > 0), stringsAsFactors = FALSE
)
if (any(!qc$count_conserved) || any(qc$source_nonfinite_counts != 0L) || any(qc$source_noninteger_counts != 0L)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE100349_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

manifest <- data.frame(file = basename(source_pins$path), bytes = observed_bytes, sha256 = observed_sha,
                       source = source_pins$url, fetched = "2026-08-31", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE100349_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE100349] wrote %d features x %d samples (control=4, case=4); all WTTS mapped reads conserved\n", nrow(M_gene), ncol(M_gene)))
print(setNames(gene_lib, samples$sample))
