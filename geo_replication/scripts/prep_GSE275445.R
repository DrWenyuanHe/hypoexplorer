#!/usr/bin/env Rscript
# Prepare the bulk Oxford Nanopore full-length hypothalamus transcriptome arm
# of GSE275445: low-reproduction Wadi sheep (control, n=3 independent
# BioSamples) versus high-reproduction small-tailed Han sheep (case, n=3).
# GEO names the supplied values gene counts; they are fractional software
# estimates and are preserved exactly, never rounded. Rows named only as
# novel transcripts have no honest gene-symbol mapping and are quarantined.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE275445_oari_hypothalamus_breed")
SRC <- file.path(DS, "raw", "GSE275445_gene.counts.matrix.xls.gz")
SOFT <- file.path(DS, "metadata", "GSE275445_family.soft.gz")
if (!requireNamespace("data.table", quietly = TRUE)) stop("the data.table R package is required")

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
  path = c(SRC, SOFT), bytes = c(364157, 3197),
  sha256 = c("a52fe75a1ed1271061673295178c1332ae4f1062444cd51c05404ec828ecce59",
             "d390e813bdb92eeedbfdec57b0e99d5f3a8dbff7e1b753f0d235b1deedcd0635"),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE275nnn/GSE275445/suppl/GSE275445_gene.counts.matrix.xls.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE275nnn/GSE275445/soft/GSE275445_family.soft.gz"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(pins$path))) stop("required official GEO source or family SOFT is missing")
observed_bytes <- as.numeric(file.info(pins$path)$size); observed_sha <- unname(vapply(pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, pins$bytes) || !identical(observed_sha, pins$sha256)) stop("source bytes/SHA-256 differ from reviewed inputs")

samples <- data.frame(
  gsm = c("GSM8477059", "GSM8477060", "GSM8477061", "GSM8477056", "GSM8477057", "GSM8477058"),
  biosample = c("SAMN43297766", "SAMN43297765", "SAMN43297764", "SAMN43297769", "SAMN43297768", "SAMN43297767"),
  sra = c("SRX25798276", "SRX25798277", "SRX25798278", "SRX25798273", "SRX25798274", "SRX25798275"),
  source_column = c("C4", "C5", "C6", "C1", "C2", "C3"), sample = c("LP_1", "LP_2", "LP_3", "HP_1", "HP_2", "HP_3"),
  title = c("x4", "x5", "x6", "x1", "x2", "x3"), group = rep(c("control", "case"), each = 3L),
  reproduction_group = rep(c("LP group", "HP group"), each = 3L), breed = rep(c("Wadi sheep", "small-tailed Han sheep"), each = 3L),
  stringsAsFactors = FALSE
)
if (any(table(samples$group) < 3L) || anyDuplicated(samples$gsm) || anyDuplicated(samples$biosample)) stop("contrast lacks >=3 independent BioSamples per arm")

soft <- readLines(gzfile(SOFT), warn = FALSE)
design <- sub("^!Series_overall_design = ", "", grep("^!Series_overall_design = ", soft, value = TRUE))
processing <- sub("^!Sample_data_processing = ", "", grep("^!Sample_data_processing = ", soft, value = TRUE))
if (length(design) != 1L || !grepl("three healthy small-tailed Han sheep and three healthy Wadi sheep", design, fixed = TRUE) ||
    !grepl("full-length transcriptome sequencing", paste(soft, collapse = " "), fixed = TRUE) ||
    !any(grepl("Library strategy: ONT-seq", processing, fixed = TRUE))) stop("GEO no longer documents the reviewed bulk ONT transcriptome experiment")

# Stop before producing any pipeline input. The repository's unchanged
# standardized run_dataset.R requires an msigdbr Reactome collection for the
# configured organism, and the installed/current msigdbr authority does not
# support Ovis aries. Relabeling the samples Homo sapiens/Bos taurus or choosing
# an unreviewed ortholog projection would be biologically dishonest. This
# accession can be reconsidered only after an explicit sheep pathway/mapping
# route is added to the shared pipeline.
stop(paste(
  "GSE275445 excluded by the existing-pipeline gate:",
  "bulk ONT count estimates are public and the 3-vs-3 contrast is valid,",
  "but run_dataset.R cannot obtain Ovis aries pathways from msigdbr;",
  "a substitute-species/ortholog route would require guessing."
))
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft)); names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
block <- function(gsm) { i <- match(gsm, names(starts)); if (is.na(i)) stop("GSM absent from SOFT: ", gsm); soft[starts[i]:ends[i]] }
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
for (i in seq_len(nrow(samples))) {
  b <- block(samples$gsm[i]); rel <- tag(b, "!Sample_relation")
  if (!identical(tag(b, "!Sample_title"), samples$title[i]) || !"tissue: hypothalamus" %in% tag(b, "!Sample_characteristics_ch1") ||
      !paste0("group: ", samples$reproduction_group[i]) %in% tag(b, "!Sample_characteristics_ch1") ||
      !any(grepl(samples$biosample[i], rel, fixed = TRUE)) || !any(grepl(samples$sra[i], rel, fixed = TRUE)) ||
      !identical(tag(b, "!Sample_library_strategy"), "OTHER")) stop(samples$gsm[i], ": SOFT metadata changed")
}

d <- data.table::fread(SRC, data.table = FALSE, check.names = FALSE, showProgress = FALSE)
if (!identical(dim(d), c(26067L, 7L)) || !identical(names(d), c("ID", paste0("C", 1:6)))) stop("official gene-count table schema/dimensions changed")
source_ids <- as.character(d$ID)
if (anyNA(source_ids) || any(!nzchar(source_ids)) || anyDuplicated(source_ids)) stop("source feature IDs are blank or duplicated")
M_source <- as.matrix(d[, samples$source_column, drop = FALSE]); storage.mode(M_source) <- "double"; colnames(M_source) <- samples$sample
if (any(!is.finite(M_source)) || any(M_source < 0) || sum(M_source != round(M_source)) != 41674L) stop("reviewed non-negative fractional count-estimate semantics no longer hold")
expected_sums <- c(2284658.021, 2419570.123, 1981702.767, 2332167.906, 2732996.066, 2642786.048)
if (any(abs(colSums(M_source) - expected_sums) > 1e-7)) stop("count-estimate numeric signature changed")

gene_row <- grepl("^gene-", source_ids)
symbols <- sub("^gene-", "", source_ids[gene_row])
valid_symbol <- grepl("^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._-]*$", symbols, perl = TRUE)
if (sum(gene_row) != 21444L || sum(!gene_row) != 4623L || any(!valid_symbol) || anyDuplicated(symbols)) stop("reviewed gene-symbol/quarantine partition changed")
keep <- which(gene_row)
M <- M_source[keep, , drop = FALSE]; rownames(M) <- symbols
M_quarantine <- M_source[-keep, , drop = FALSE]
conservation_delta <- colSums(M) + colSums(M_quarantine) - colSums(M_source)
if (any(abs(conservation_delta) > 1e-8)) stop("retained/quarantined count partition did not conserve source estimates")

out <- data.frame(symbol = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE275445_HP_vs_LP_count_estimates.tsv.gz")
old_options <- options(digits = 17, scipen = 999); con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con); options(old_options)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
written_delta <- apply(abs(as.matrix(roundtrip[-1L]) - M), 2L, max)
if (!identical(roundtrip$symbol, rownames(M)) || !identical(names(roundtrip)[-1L], samples$sample) || any(written_delta > 1e-12)) stop("written count-estimate matrix failed round-trip validation")

quarantine <- data.frame(source_id = source_ids[-keep], reason = "novel transcript feature lacks a deposited gene-symbol mapping", M_quarantine, check.names = FALSE, stringsAsFactors = FALSE)
qcon <- gzfile(file.path(DS, "metadata", "GSE275445_quarantined_features.tsv.gz"), "w"); write.table(quarantine, qcon, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(qcon)
ss <- samples[, c("sample", "group", "gsm", "biosample", "sra", "source_column", "title", "reproduction_group", "breed")]
names(ss)[names(ss) == "gsm"] <- "geo_accession"; ss$tissue <- "hypothalamus"; ss$sequencing <- "bulk Oxford Nanopore full-length transcriptome"
write.table(ss, file.path(DS, "metadata", "GSE275445_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
qc <- data.frame(
  sample = samples$sample, group = samples$group, geo_accession = samples$gsm,
  source_rows = nrow(M_source), output_gene_rows = nrow(M), quarantined_novel_transcript_rows = nrow(M_quarantine),
  source_nonfinite_values = colSums(!is.finite(M_source)), source_negative_values = colSums(M_source < 0), source_fractional_values = colSums(M_source != round(M_source)),
  source_count_estimate_sum = colSums(M_source), retained_count_estimate_sum = colSums(M), quarantined_count_estimate_sum = colSums(M_quarantine),
  count_partition_conservation_delta = conservation_delta, detected_retained_features = colSums(M > 0), written_matrix_max_abs_delta = written_delta,
  accepted_input_class = "bulk ONT gene count estimates; fractional values preserved unrounded",
  provenance_caveat = "GEO library_strategy=OTHER; SOFT explicitly documents ONT-seq full-length transcriptome sequencing",
  shared_route = "input_kind=counts -> canonical edgeR-QL", stringsAsFactors = FALSE
)
if (any(qc$source_nonfinite_values != 0L) || any(qc$source_negative_values != 0L) || any(abs(qc$count_partition_conservation_delta) > 1e-8) || any(qc$written_matrix_max_abs_delta > 1e-12)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE275445_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
manifest <- data.frame(file = basename(pins$path), bytes = observed_bytes, sha256 = observed_sha, source = pins$url, fetched = "2026-09-01", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE275445_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE275445] wrote %d gene symbols x %d samples; LP=3, HP=3; fractional count estimates unrounded; quarantined %d novel transcript features\n", nrow(M), ncol(M), nrow(M_quarantine)))
print(setNames(colSums(M), samples$sample))
