#!/usr/bin/env Rscript
# Prepare the adult male-rat rostral posterior hypothalamus endpoint contrast
# from GSE229159: no stress (control, n=6) versus seven daily loud-noise
# exposures (case, n=6). The official featureCounts header contains extra tab
# runs, so sample labels are extracted as tokens and data rows are parsed as
# whitespace-delimited fields to prevent a silent column shift.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE229159_rnor_rph_noise_stress")
SRC <- file.path(DS, "raw", "GSE229159_featurecounttrim24.txt.gz")
SOFT <- file.path(DS, "metadata", "GSE229159_family.soft.gz")

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
  path = c(SRC, SOFT), bytes = c(915095, 5380),
  sha256 = c("23063e4af5b88f9b23fe45ef5789c043761cde6f1d3bf91cdbfa031590dba36e",
             "6bdeb00da79d51db59fd038b8926bda3b749f5e63ad090b21f5d247faeb5ec3f"),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE229nnn/GSE229159/suppl/GSE229159_featurecounttrim24.txt.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE229nnn/GSE229159/soft/GSE229159_family.soft.gz"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(pins$path))) stop("required official GEO source or family SOFT is missing")
observed_bytes <- as.numeric(file.info(pins$path)$size); observed_sha <- unname(vapply(pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, pins$bytes) || !identical(observed_sha, pins$sha256)) stop("source bytes/SHA-256 differ from reviewed inputs")

samples <- data.frame(
  rat = c(19:24, 1:6),
  gsm = c(paste0("GSM71561", 22:27), paste0("GSM715610", 4:9)),
  biosample = c(paste0("SAMN341055", 85:80), paste0("SAMN34105", 603:598)),
  sra = c(paste0("SRX199003", 53:58), paste0("SRX199003", 35:40)),
  source_column = c(paste0("PH", 19:24), sprintf("PH%02d", 1:6)),
  sample = c(sprintf("control_rat%02d", 19:24), sprintf("stress7d_rat%02d", 1:6)),
  group = rep(c("control", "case"), each = 6L),
  treatment = rep(c("no stress", "7 days repeated stress"), each = 6L), stringsAsFactors = FALSE
)
if (any(table(samples$group) < 3L) || anyDuplicated(samples$gsm) || anyDuplicated(samples$biosample)) stop("contrast lacks >=3 independent BioSamples per arm")

soft <- readLines(gzfile(SOFT), warn = FALSE)
design <- sub("^!Series_overall_design = ", "", grep("^!Series_overall_design = ", soft, value = TRUE))
processing <- sub("^!Sample_data_processing = ", "", grep("^!Sample_data_processing = ", soft, value = TRUE))
if (length(design) != 1L || !grepl("4 groups (n=6/group) of independent rat brains", design, fixed = TRUE) ||
    !any(grepl("Gene expression was estimated using the featureCount routine", processing, fixed = TRUE)) ||
    !any(grepl("featurecounttrim24.txt", processing, fixed = TRUE))) stop("GEO no longer documents the reviewed independent featureCounts experiment")
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft)); names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
block <- function(gsm) { i <- match(gsm, names(starts)); if (is.na(i)) stop("GSM absent from SOFT: ", gsm); soft[starts[i]:ends[i]] }
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
for (i in seq_len(nrow(samples))) {
  b <- block(samples$gsm[i]); rel <- tag(b, "!Sample_relation")
  if (!identical(tag(b, "!Sample_title"), paste0("Rat #", samples$rat[i], " - ", samples$treatment[i])) ||
      !paste0("treatment: ", samples$treatment[i]) %in% tag(b, "!Sample_characteristics_ch1") ||
      !"brain region: rostral posterior hypothalamus" %in% tag(b, "!Sample_characteristics_ch1") ||
      !any(grepl(samples$biosample[i], rel, fixed = TRUE)) || !any(grepl(samples$sra[i], rel, fixed = TRUE)) ||
      !identical(tag(b, "!Sample_library_strategy"), "RNA-Seq")) stop(samples$gsm[i], ": SOFT metadata changed")
}

header <- readLines(gzfile(SRC), n = 1L, warn = FALSE)
source_samples <- regmatches(header, gregexpr("PH[0-9]{2}", header))[[1L]]
expected_source_samples <- c(sprintf("PH%02d", 19:24), sprintf("PH%02d", 13:18), sprintf("PH%02d", 7:12), sprintf("PH%02d", 1:6))
if (!identical(source_samples, expected_source_samples)) stop("featureCounts header token order changed")
d <- read.table(gzfile(SRC), header = FALSE, skip = 1L, sep = "", quote = "", comment.char = "", stringsAsFactors = FALSE, check.names = FALSE)
if (!identical(dim(d), c(32883L, 25L))) stop("official featureCounts table dimensions changed")
names(d) <- c("Geneid", source_samples)
ids <- as.character(d$Geneid)
if (anyNA(ids) || any(!nzchar(ids)) || anyDuplicated(ids) || any(!grepl("^ENSRNOG[0-9]+([.][0-9]+)?$", ids))) stop("blank, duplicate, or invalid rat Ensembl Geneid")
M <- as.matrix(d[, samples$source_column, drop = FALSE]); storage.mode(M) <- "double"; colnames(M) <- samples$sample
if (any(!is.finite(M)) || any(M < 0) || any(M != round(M))) stop("reviewed raw integer featureCounts semantics no longer hold")
expected_lib <- c(12741548, 10227122, 8087697, 10393286, 14602689, 11298078, 14299345, 14189794, 12479489, 16538531, 16208973, 12806794)
expected_detected <- c(20752, 19947, 19809, 20113, 20963, 20329, 19917, 20613, 20518, 20758, 20777, 20398)
if (!identical(unname(colSums(M)), expected_lib) || !identical(unname(colSums(M > 0)), expected_detected)) stop("featureCounts numeric signature changed")

out <- data.frame(Geneid = ids, M, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE229159_rPH_7d_stress_vs_control_counts.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$Geneid, ids) || !identical(names(roundtrip)[-1L], samples$sample) || any(as.matrix(roundtrip[-1L]) != M)) stop("written count matrix failed exact round-trip validation")

ss <- samples[, c("sample", "group", "gsm", "biosample", "sra", "source_column", "rat", "treatment")]
names(ss)[names(ss) == "gsm"] <- "geo_accession"; ss$tissue <- "rostral posterior hypothalamus"; ss$sex <- "male"; ss$strain <- "Sprague-Dawley, Envigo"
write.table(ss, file.path(DS, "metadata", "GSE229159_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
qc <- data.frame(
  sample = samples$sample, group = samples$group, geo_accession = samples$gsm,
  source_rows = nrow(M), output_rows = nrow(M), blank_ids = 0L, duplicate_ids = 0L,
  invalid_ids_quarantined = 0L, nonfinite_values = colSums(!is.finite(M)), negative_values = colSums(M < 0),
  fractional_values = colSums(M != round(M)), library_size = colSums(M), detected_features = colSums(M > 0),
  accepted_input_class = "Subread featureCounts raw gene counts", shared_route = "input_kind=counts -> canonical edgeR-QL",
  written_exact = TRUE, stringsAsFactors = FALSE
)
if (any(qc$nonfinite_values != 0L) || any(qc$negative_values != 0L) || any(qc$fractional_values != 0L)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE229159_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
manifest <- data.frame(file = basename(pins$path), bytes = observed_bytes, sha256 = observed_sha, source = pins$url, fetched = "2026-09-01", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE229159_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE229159] wrote %d Ensembl genes x %d samples; control=6, seven-day stress=6; raw integer featureCounts\n", nrow(M), ncol(M)))
print(setNames(colSums(M), samples$sample))
