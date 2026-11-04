#!/usr/bin/env Rscript
# Prepare the SCN time-restricted-feeding contrast from GSE190389. GEO calls
# the deposited table raw counts after technical resequencings were collapsed.
# The resulting half-integer estimates are preserved exactly, never rounded.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE190389_mmus_scn_trf")
SRC <- file.path(DS, "raw", "GSE190389_raw.csv.gz")
SOFT <- file.path(DS, "metadata", "GSE190389_family.soft.gz")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
pins <- data.frame(
  path = c(SRC, SOFT), bytes = c(31682911, 75062),
  sha256 = c("fb595d00aac0860a8921f53b26ad7ea817abb80f27517321017d5a6340f172f6",
             "58e1d1e10b480557777f1894acf70570bc54c813a8bb92140e5400eaa17a2e94"),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE190nnn/GSE190389/suppl/GSE190389_raw.csv.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE190nnn/GSE190389/soft/GSE190389_family.soft.gz"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(pins$path))) stop("required official GEO matrix or family SOFT is missing")
observed_bytes <- as.numeric(file.info(pins$path)$size)
observed_sha <- unname(vapply(pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, pins$bytes) || !identical(observed_sha, pins$sha256)) stop("source bytes/SHA-256 differ from reviewed inputs")

soft <- readLines(gzfile(SOFT), warn = FALSE)
design_text <- sub("^!Series_overall_design = ", "", grep("^!Series_overall_design = ", soft, value = TRUE))
processing <- sub("^!Sample_data_processing = ", "", grep("^!Sample_data_processing = ", soft, value = TRUE))
if (!any(grepl("ad-libitum feeding (ALF) or 9 hr time-restricted feeding (TRF)", design_text, fixed = TRUE)) ||
    !any(grepl("raw counts for each library (the sample resequencings are collapsed)", processing, fixed = TRUE))) {
  stop("GEO no longer documents the reviewed ALF/TRF collapsed raw-count experiment")
}
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft))
tag <- function(block, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), block, value = TRUE))
records <- lapply(seq_along(starts), function(i) {
  b <- soft[starts[i]:ends[i]]
  if (!identical(tag(b, "!Sample_source_name_ch1"), "SCN")) return(NULL)
  rel <- tag(b, "!Sample_relation")
  data.frame(
    gsm = tag(b, "\\^SAMPLE"), title = tag(b, "!Sample_title"),
    library = sub("^Library name: ", "", tag(b, "!Sample_description")),
    biosample = sub(".*biosample/", "", rel[grepl("BioSample:", rel, fixed = TRUE)]),
    sra = sub(".*term=", "", rel[grepl("SRA:", rel, fixed = TRUE)]), stringsAsFactors = FALSE
  )
})
records <- do.call(rbind, Filter(Negate(is.null), records))
if (nrow(records) != 83L || length(unique(records$library)) != 45L) stop("SCN SOFT library/resequencing structure changed")

d <- read.csv(gzfile(SRC), check.names = FALSE, stringsAsFactors = FALSE)
source_columns <- grep("^SCN_ZT[0-9]+_(ALF|TRF)_[12]_1$", names(d), value = TRUE)
if (!identical(dim(d), c(24537L, 1036L)) || length(source_columns) != 45L) stop("official raw-count matrix dimensions or SCN schema changed")
parsed <- regexec("^SCN_ZT([0-9]+)_(ALF|TRF)_([12])_1$", source_columns)
p <- do.call(rbind, regmatches(source_columns, parsed))
if (ncol(p) != 4L || any(p[, 1L] != source_columns)) stop("could not parse SCN library labels")

samples <- data.frame(
  sample = source_columns,
  group = ifelse(p[, 3L] == "ALF", "control", "case"),
  zt = paste0("ZT", p[, 2L]), feeding = p[, 3L], replicate = as.integer(p[, 4L]),
  stringsAsFactors = FALSE
)
matched <- match(samples$sample, records$title)
if (anyNA(matched)) stop("matrix SCN library is absent from GEO sample blocks")
samples$library <- records$library[matched]
if (anyDuplicated(samples$library)) stop("collapsed matrix columns are not one-to-one with biological libraries")
samples$geo_accessions <- vapply(samples$library, function(x) paste(records$gsm[records$library == x], collapse = ";"), character(1))
samples$biosample_records <- vapply(samples$library, function(x) paste(records$biosample[records$library == x], collapse = ";"), character(1))
samples$sra_runs <- vapply(samples$library, function(x) paste(records$sra[records$library == x], collapse = ";"), character(1))
samples$n_resequencings <- vapply(samples$library, function(x) sum(records$library == x), integer(1))
if (sum(samples$group == "control") != 23L || sum(samples$group == "case") != 22L ||
    length(unique(samples$zt)) != 12L) stop("reviewed SCN ALF/TRF time-course counts changed")

ids <- as.character(d[[1L]])
if (anyNA(ids) || any(!nzchar(ids))) stop("blank source gene symbol")
M0 <- as.matrix(d[, source_columns, drop = FALSE]); storage.mode(M0) <- "double"
if (any(!is.finite(M0)) || any(M0 < 0)) stop("raw-count estimates must be finite and non-negative")
fractional_source <- sum(M0 != round(M0))
if (fractional_source == 0L) stop("reviewed collapsed half-integer count semantics changed")

# Two source symbols occur twice. Sum duplicate rows without changing any
# library total; this is the only transformation applied to the count scale.
M <- rowsum(M0, group = ids, reorder = FALSE)
if (nrow(M) != 24535L || any(abs(colSums(M) - colSums(M0)) > 1e-8)) stop("duplicate-symbol aggregation failed conservation")
out <- data.frame(symbol = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE190389_SCN_TRF_vs_ALF_count_estimates.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$symbol, rownames(M)) || !identical(names(roundtrip)[-1L], source_columns) ||
    any(abs(as.matrix(roundtrip[-1L]) - M) > 0)) stop("written count-estimate matrix failed exact round-trip validation")

samples$tissue <- "suprachiasmatic nucleus"
samples$contrast <- "9-hour Western-diet TRF versus isocaloric Western-diet ALF"
write.table(samples, file.path(DS, "metadata", "GSE190389_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

design <- model.matrix(~ factor(zt) + factor(group, levels = c("control", "case")), data = samples)
if (qr(design)$rank != ncol(design)) stop("ZT-adjusted feeding design is rank-deficient")
suppressPackageStartupMessages(library(edgeR))
y <- DGEList(counts = M); keep <- filterByExpr(y, design); y <- calcNormFactors(y[keep, , keep.lib.sizes = FALSE])
if (sum(keep) < 5000L || any(!is.finite(y$samples$norm.factors))) stop("count-level preprocessing QC failed")
qc <- data.frame(
  sample = samples$sample, group = samples$group, zt = samples$zt, library = samples$library,
  source_rows = nrow(M0), output_rows = nrow(M), duplicate_rows_collapsed = nrow(M0) - nrow(M),
  nonfinite_values = colSums(!is.finite(M)), negative_values = colSums(M < 0),
  fractional_values = colSums(M != round(M)), library_size = colSums(M), detected_features = colSums(M > 0),
  filterByExpr_features = sum(keep), tmm_norm_factor = y$samples$norm.factors,
  accepted_input_class = "GEO raw counts with technical resequencings collapsed; fractional estimates preserved",
  shared_route = "input_kind=counts -> canonical edgeR-QL; batch_var=zt", written_exact = TRUE,
  stringsAsFactors = FALSE
)
write.table(qc, file.path(DS, "processed", "GSE190389_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
manifest <- data.frame(file = basename(pins$path), bytes = observed_bytes, sha256 = observed_sha, source = pins$url, fetched = "2026-09-01", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE190389_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE190389] wrote %d symbols x %d SCN libraries; ALF=23, TRF=22; %d fractional cells preserved; %d filterByExpr features\n",
            nrow(M), ncol(M), fractional_source, sum(keep)))
