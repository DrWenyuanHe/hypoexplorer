#!/usr/bin/env Rscript
# Prepare the only complete bulk RNA-seq contrast in GSE214877:
# human pluripotent stem cells (control, n=3 independent BioSamples) versus
# hPSC-derived hypothalamic neural stem cells (case, n=3 independent
# BioSamples). The official supplementary CSV is a StringTie gene-count table.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE214877_hsap_hypothalamic_nsc")
SRC <- file.path(DS, "raw", "GSE214877_processed.csv.gz")
SOFT <- file.path(DS, "metadata", "GSE214877_family.soft.gz")

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

pins <- data.frame(
  path = c(SRC, SOFT), bytes = c(274682, 2260),
  sha256 = c("6283bb114f2d3906d2e4bae1ea0da6b6c3fc53b58d98c8176f9268843d024a58",
             "c4a31689d75a87585ea83387dfce23628d6335690770fe63501d7a0d0b545f6c"),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE214nnn/GSE214877/suppl/GSE214877_processed.csv.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE214nnn/GSE214877/soft/GSE214877_family.soft.gz"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(pins$path))) stop("required official GEO source or family SOFT is missing")
observed_bytes <- as.numeric(file.info(pins$path)$size)
observed_sha <- unname(vapply(pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, pins$bytes) || !identical(observed_sha, pins$sha256)) stop("source bytes/SHA-256 differ from reviewed inputs")

samples <- data.frame(
  gsm = c("GSM6617217", "GSM6617218", "GSM6617219", "GSM6617220", "GSM6617221", "GSM6617222"),
  biosample = c("SAMN31169554", "SAMN31169553", "SAMN31169552", "SAMN31169551", "SAMN31169550", "SAMN31169549"),
  sra = c("SRX17808410", "SRX17808411", "SRX17808412", "SRX17808413", "SRX17808414", "SRX17808415"),
  title = c("h9 hESC", "CMC11 hiPSC", "AG09908R1 hiPSC", "htNSC batch 11 DIV 34", "htNSC batch 12 DIV 27", "htNSC batch 13 DIV 20"),
  source_column = c("H9", "CMC_IPSC_11.3", "AG09908R1", "hypo_B11P2DV34", "hypo_B12P0DIV27", "hypo_B13_DIV20"),
  sample = c("hPSC_H9", "hPSC_CMC11", "hPSC_AG09908R1", "htNSC_B11_DIV34", "htNSC_B12_DIV27", "htNSC_B13_DIV20"),
  group = rep(c("control", "case"), each = 3L),
  cell_type = rep(c("hPSC", "hNSC"), each = 3L), stringsAsFactors = FALSE
)
if (any(table(samples$group) < 3L) || anyDuplicated(samples$gsm) || anyDuplicated(samples$biosample)) stop("contrast lacks >=3 independent BioSamples per arm")

soft <- readLines(gzfile(SOFT), warn = FALSE)
design <- sub("^!Series_overall_design = ", "", grep("^!Series_overall_design = ", soft, value = TRUE))
processing <- sub("^!Sample_data_processing = ", "", grep("^!Sample_data_processing = ", soft, value = TRUE))
if (length(design) != 1L || !grepl("Comparing transcriptome of hPSC and hPSC-derived hypothalamic neural stem cell", design, fixed = TRUE) ||
    !any(grepl("gene count were called using StringTie", processing, fixed = TRUE)) ||
    !any(grepl("csv file of read count matrix", processing, fixed = TRUE))) stop("GEO no longer documents the reviewed hPSC-vs-hNSC read-count experiment")
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft)); names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
block <- function(gsm) { i <- match(gsm, names(starts)); if (is.na(i)) stop("GSM absent from SOFT: ", gsm); soft[starts[i]:ends[i]] }
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
for (i in seq_len(nrow(samples))) {
  b <- block(samples$gsm[i]); rel <- tag(b, "!Sample_relation")
  if (!identical(tag(b, "!Sample_title"), samples$title[i]) ||
      !paste0("cell type: ", samples$cell_type[i]) %in% tag(b, "!Sample_characteristics_ch1") ||
      !any(grepl(samples$biosample[i], rel, fixed = TRUE)) || !any(grepl(samples$sra[i], rel, fixed = TRUE)) ||
      !identical(tag(b, "!Sample_library_strategy"), "RNA-Seq")) stop(samples$gsm[i], ": SOFT metadata changed")
}

d <- read.csv(gzfile(SRC), check.names = FALSE, stringsAsFactors = FALSE)
expected_schema <- c("", "H9", "CMC_IPSC_11.3", "AG09908R1", "hypo_B12P0DIV27", "hypo_B13_DIV20", "hypo_B11P2DV34")
if (!identical(dim(d), c(20731L, 7L)) || !identical(names(d), expected_schema)) stop("official count-table schema/dimensions changed")
ids <- as.character(d[[1L]])
if (anyNA(ids) || any(!nzchar(ids)) || anyDuplicated(ids) ||
    any(!grepl("^(?=.*[A-Za-z])[A-Za-z][A-Za-z0-9._-]*$", ids, perl = TRUE))) stop("blank, duplicate, or invalid gene symbol in official table")
M <- as.matrix(d[, samples$source_column, drop = FALSE]); storage.mode(M) <- "double"; colnames(M) <- samples$sample
if (any(!is.finite(M)) || any(M < 0) || any(M != round(M))) stop("reviewed raw integer-count semantics no longer hold")
expected_lib <- c(18930636, 56233501, 48428451, 67025922, 52735333, 55835675)
expected_detected <- c(17635, 15806, 16178, 16527, 16375, 16277)
if (!identical(unname(colSums(M)), expected_lib) || !identical(unname(colSums(M > 0)), expected_detected)) stop("count-table numeric signature changed")

out <- data.frame(symbol = ids, M, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE214877_hPSC_vs_htNSC_counts.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$symbol, ids) || !identical(names(roundtrip)[-1L], samples$sample) || any(as.matrix(roundtrip[-1L]) != M)) stop("written count matrix failed exact round-trip validation")

ss <- samples[, c("sample", "group", "gsm", "biosample", "sra", "source_column", "title", "cell_type")]
names(ss)[names(ss) == "gsm"] <- "geo_accession"
ss$tissue_model <- "hPSC-derived hypothalamic neural stem cells"
write.table(ss, file.path(DS, "metadata", "GSE214877_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

qc <- data.frame(
  sample = samples$sample, group = samples$group, geo_accession = samples$gsm,
  source_rows = nrow(M), output_rows = nrow(M), blank_ids = 0L, duplicate_ids = 0L,
  invalid_ids_quarantined = 0L, nonfinite_values = colSums(!is.finite(M)), negative_values = colSums(M < 0),
  fractional_values = colSums(M != round(M)), library_size = colSums(M), detected_features = colSums(M > 0),
  accepted_input_class = "StringTie raw gene counts", shared_route = "input_kind=counts -> canonical edgeR-QL",
  written_exact = TRUE, stringsAsFactors = FALSE
)
if (any(qc$nonfinite_values != 0L) || any(qc$negative_values != 0L) || any(qc$fractional_values != 0L)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE214877_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
manifest <- data.frame(file = basename(pins$path), bytes = observed_bytes, sha256 = observed_sha, source = pins$url, fetched = "2026-09-01", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE214877_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE214877] wrote %d genes x %d samples; hPSC=3, htNSC=3; raw integer counts\n", nrow(M), ncol(M)))
print(setNames(colSums(M), samples$sample))

