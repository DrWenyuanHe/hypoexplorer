#!/usr/bin/env Rscript
# Prepare whole hypothalamus from SHAM-operated male rats exposed for four hours
# to 0.8 ppm ozone versus filtered air. GEO deposits DESeq2 normalized counts;
# they remain fractional and are log2(value+1)-transformed for limma.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE133293_rnor_hypothalamus_ozone")
SRC <- file.path(DS, "raw", "source", "GSE133293_GRC341_GEO_Brain.Hypo.NormCounts.csv.gz")
SOFT <- file.path(DS, "metadata", "GSE133293_family.soft.gz")

samples <- data.frame(
  gsm = paste0("GSM390", 5188:5195),
  source_column = c("GRC341.H1B_S15", "GRC341.H2_S8", "GRC341.H3_S12", "GRC341.H4_S16",
                    "GRC341.H17_S24", "GRC341.H18_S15", "GRC341.H19_S21", "GRC341.H20_S24"),
  geo_title = c(paste0("Hypo_T_SHAM_Air_", 1:4), paste0("Hypo_T_SHAM_Ozone_", 17:20)),
  sample = c(paste0("Hypo_SHAM_Air_", 1:4), paste0("Hypo_SHAM_Ozone_", 1:4)),
  group = rep(c("control", "case"), each = 4L),
  exposure = rep(c("Air (4 hours)", "Ozone (0.8 ppm, 4 hours)"), each = 4L),
  biological_replicate = rep(1:4, 2L), stringsAsFactors = FALSE
)
if (!file.exists(SRC) || !file.exists(SOFT)) stop("required GEO source or family SOFT is missing")
if (any(table(samples$group) < 3L) || anyDuplicated(samples$gsm)) stop("contrast lacks independent >=3/arm biological samples")

soft <- readLines(gzfile(SOFT), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft)); names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
block <- function(gsm) { i <- match(gsm, names(starts)); if (is.na(i)) stop("GSM absent from SOFT: ", gsm); soft[starts[i]:ends[i]] }
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
biosample <- character(nrow(samples))
for (i in seq_len(nrow(samples))) {
  b <- block(samples$gsm[i]); title <- tag(b, "!Sample_title"); desc <- tag(b, "!Sample_description"); source_name <- tag(b, "!Sample_source_name_ch1"); chars <- tag(b, "!Sample_characteristics_ch1")
  required <- c("strain: Wistar Kyoto", "tissue: Hypothalamus", "surgery: SHAM", paste0("exposure: ", samples$exposure[i]), "developmental stage: 13 weeks old")
  if (!identical(title, samples$geo_title[i]) || !identical(desc, samples$source_column[i]) || !identical(source_name, "Hypothalamus") || !all(required %in% chars)) {
    stop(samples$gsm[i], ": GEO metadata no longer matches the fixed SHAM hypothalamus contrast")
  }
  rel <- grep("^BioSample: ", tag(b, "!Sample_relation"), value = TRUE); if (length(rel) != 1L) stop("expected one BioSample for ", samples$gsm[i])
  biosample[i] <- sub("^.*/", "", rel)
}
if (anyDuplicated(biosample)) stop("selected libraries share a BioSample")
samples$biosample <- biosample

d <- read.csv(gzfile(SRC), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(names(d)[1L], "Gene") || nrow(d) != 22587L || ncol(d) != 33L) stop("deposited normalized-count matrix structure changed")
miss <- setdiff(samples$source_column, names(d)); if (length(miss)) stop("missing hypothalamus normalized-count columns: ", paste(miss, collapse = ", "))
symbols <- as.character(d$Gene); if (anyNA(symbols) || any(!nzchar(symbols))) stop("blank gene symbol in deposited matrix")
M0 <- as.matrix(d[, samples$source_column, drop = FALSE]); storage.mode(M0) <- "double"; colnames(M0) <- samples$sample
if (any(!is.finite(M0)) || any(M0 < 0)) stop("DESeq2 normalized counts must be finite and non-negative")
if (!any(M0 != round(M0)) || max(M0) < 100 || min(colSums(M0)) < 1e6) stop("source no longer has a linear normalized-count signature")
M <- rowsum(M0, group = symbols, reorder = TRUE)
if (max(abs(colSums(M) - colSums(M0))) > 1e-7) stop("gene-symbol aggregation did not conserve normalized counts")
L <- log2(M + 1)
if (max(abs((2^L - 1) - M)) > 1e-8) stop("log2(normalized count+1) reconstruction failed")

out <- data.frame(symbol = rownames(M), L, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE133293_hypothalamus_SHAM_ozone_vs_air_log2norm.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)

ss <- data.frame(sample = samples$sample, group = samples$group, geo_accession = samples$gsm, biosample = samples$biosample,
                 source_column = samples$source_column, tissue = "whole hypothalamus", strain = "Wistar Kyoto",
                 sex = "male", age = "13 weeks", surgery = "SHAM", exposure = samples$exposure,
                 biological_replicate = samples$biological_replicate, stringsAsFactors = FALSE)
write.table(ss, file.path(DS, "metadata", "GSE133293_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

qc <- data.frame(sample = samples$sample, group = samples$group, geo_accession = samples$gsm,
                 source_rows = nrow(M0), unique_output_symbols = nrow(M), duplicate_symbol_rows_collapsed = nrow(M0) - nrow(M),
                 source_nonfinite_values = colSums(!is.finite(M0)), source_negative_values = colSums(M0 < 0),
                 source_fractional_values = colSums(M0 != round(M0)), source_normalized_count_sum = colSums(M0),
                 aggregated_normalized_count_sum = colSums(M), count_conservation_delta = colSums(M) - colSums(M0),
                 count_conserved = abs(colSums(M) - colSums(M0)) < 1e-7, detected_genes = colSums(M > 0),
                 log2_expression_sum = colSums(L), transform_max_abs_delta = apply(abs((2^L - 1) - M), 2L, max), stringsAsFactors = FALSE)
if (any(!qc$count_conserved) || any(qc$transform_max_abs_delta > 1e-8)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE133293_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]; if (length(z) != 1L) stop("could not calculate SHA-256 for ", path); tolower(z)
}
paths <- c(SRC, SOFT)
urls <- c("https://ftp.ncbi.nlm.nih.gov/geo/series/GSE133nnn/GSE133293/suppl/GSE133293_GRC341_GEO_Brain.Hypo.NormCounts.csv.gz",
          "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE133nnn/GSE133293/soft/GSE133293_family.soft.gz")
manifest <- data.frame(file = basename(paths), bytes = as.numeric(file.info(paths)$size), sha256 = vapply(paths, sha256_file, character(1)),
                       source = urls, fetched = "2026-08-31", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE133293_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE133293] wrote %d genes x 8 hypothalamus samples (control=4, case=4); normalized counts were not rounded\n", nrow(L)))
