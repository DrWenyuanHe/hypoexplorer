#!/usr/bin/env Rscript
# Prepare AgRP-neuron RiboTag RNA-seq at ZT14, 24-hour fasted versus ad-lib fed.
# GEO calls the deposited file DESeq2 normalized counts. Its zeros, read-scale
# magnitudes and fractional size-factor products prove it is on the linear
# normalized-count scale, despite an imprecise GEO sentence mentioning VST.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), "..", "geo_replication"))
DS <- file.path(ROOT, "datasets", "GSE124693_mmus_agrp_ribotag_fasting")
SRC <- file.path(DS, "raw", "source", "GSE124693_agrp_normalized_counts.txt.gz")
SOFT <- file.path(DS, "metadata", "GSE124693_family.soft.gz")

short <- c(paste0("AGRP_RIBO_AL_ZT14_", 1:4), paste0("AGRP_RIBO_FA_ZT14_", 1:5))
samples <- data.frame(
  gsm = c("GSM3543468", "GSM3543469", "GSM3543470", "GSM3543471",
          "GSM3543475", "GSM3543476", "GSM3543477", "GSM3543478", "GSM3543479"),
  source_column = paste0("AGRP.RIBO.SAMPLES.", short), sample = short,
  group = c(rep("control", 4L), rep("case", 5L)),
  treatment = c(rep("Ad Lib Diet", 4L), rep("Effective 24-hr Fast", 5L)),
  biological_replicate = c(1:4, 1:5), stringsAsFactors = FALSE
)
if (!file.exists(SRC) || !file.exists(SOFT)) stop("required GEO source or family SOFT is missing")
if (any(table(samples$group) < 3L) || anyDuplicated(samples$gsm)) stop("contrast lacks independent >=3/arm samples")

soft <- readLines(gzfile(SOFT), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft)); names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
block <- function(gsm) { i <- match(gsm, names(starts)); if (is.na(i)) stop("GSM absent from SOFT: ", gsm); soft[starts[i]:ends[i]] }
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
biosample <- character(nrow(samples))
for (i in seq_len(nrow(samples))) {
  b <- block(samples$gsm[i]); desc <- tag(b, "!Sample_description"); src_name <- tag(b, "!Sample_source_name_ch1"); chars <- tag(b, "!Sample_characteristics_ch1")
  required <- c("cell type: AgRP+ ARH neurons", "time point: ZT14", "genotype: AGRP-Cre;RiboTag", paste0("treatment: ", samples$treatment[i]))
  if (!identical(desc, samples$sample[i]) || !identical(src_name, "AgRP+ ARH neurons") || !all(required %in% chars)) {
    stop(samples$gsm[i], ": GEO metadata no longer matches the fixed AgRP/RiboTag/ZT14 contrast")
  }
  rel <- grep("^BioSample: ", tag(b, "!Sample_relation"), value = TRUE); if (length(rel) != 1L) stop("expected one BioSample for ", samples$gsm[i])
  biosample[i] <- sub("^.*/", "", rel)
}
if (anyDuplicated(biosample)) stop("selected libraries share a BioSample")
samples$biosample <- biosample

d <- read.delim(gzfile(SRC), check.names = FALSE, stringsAsFactors = FALSE)
if (nrow(d) != 23337L || ncol(d) != 81L) stop("deposited matrix dimensions changed")
miss <- setdiff(samples$source_column, names(d)); if (length(miss)) stop("missing normalized-count columns: ", paste(miss, collapse = ", "))
symbols <- as.character(d[[1L]])
if (anyNA(symbols) || any(!nzchar(symbols))) stop("blank gene symbol in deposited matrix")
source_symbols <- symbols

# The submitter's tabular export passed historical MARCH/SEPT gene symbols
# through Excel: March1..March11 became 1-Mar..11-Mar, Sept1..Sept12 and
# Sept14 became 1-Sep..12-Sep/14-Sep, and Sep15 became 15-Sep. Restore only
# this exact, fail-closed set. Table S2 independently confirms the March2,
# March5, March9, March11, Sept2, Sept5 and Sep15 spellings in this source;
# MGI retains the full March*/Sept* forms as historical mouse symbols.
date_recovery <- setNames(
  c(paste0("March", 1:11), paste0("Sept", 1:12), "Sept14", "Sep15"),
  c(paste0(1:11, "-Mar"), paste0(1:12, "-Sep"), "14-Sep", "15-Sep")
)
source_date_symbols <- symbols[grepl("^[0-9]{1,2}-(Mar|Sep)$", symbols)]
if (length(source_date_symbols) != length(date_recovery) ||
    !setequal(source_date_symbols, names(date_recovery))) {
  stop("deposited Excel-date symbol set changed")
}
date_rows <- match(names(date_recovery), symbols)
if (anyNA(date_rows)) stop("expected Excel-date symbol row is missing")
if (any(unname(date_recovery) %in% symbols[-date_rows])) {
  stop("restored historical symbol collides with an existing source row")
}
symbols[date_rows] <- unname(date_recovery)

# The only numeric-only identifier is NCBI Gene 100043387. MGI sequence
# MGI:3709632 and NCBI both map it unambiguously to Gm14305; no Gm14305 row
# already exists in the deposit. Fail if either side of that invariant changes.
numeric_recovery <- c("100043387" = "Gm14305")
source_numeric_symbols <- symbols[grepl("^[0-9]+$", symbols)]
if (!identical(source_numeric_symbols, names(numeric_recovery)) ||
    unname(numeric_recovery) %in% symbols) {
  stop("deposited numeric-only identifier set or Gm14305 collision changed")
}
numeric_rows <- match(names(numeric_recovery), symbols)
symbols[numeric_rows] <- unname(numeric_recovery)
if (anyDuplicated(symbols) ||
    any(grepl("^[0-9]{1,2}-(Mar|Sep)$", symbols)) ||
    any(grepl("^[0-9]+$", symbols))) {
  stop("identifier recovery did not produce unique gene symbols")
}
M0 <- as.matrix(d[, samples$source_column, drop = FALSE]); storage.mode(M0) <- "double"; colnames(M0) <- samples$sample
if (any(!is.finite(M0)) || any(M0 < 0)) stop("normalized counts must be finite and non-negative")
integer_fraction <- mean(M0 == round(M0))
if (integer_fraction > 0.75 || max(M0) < 100 || min(colSums(M0)) < 1e6) {
  stop("source no longer has the documented linear DESeq2-normalized-count signature")
}
# Preserve the established source-label sort order so a name-only repair cannot
# perturb empirical-Bayes calculations through otherwise irrelevant row-order
# floating-point effects. Then replace the row labels through the validated map.
M <- rowsum(M0, group = source_symbols, reorder = TRUE)
restored_by_source <- setNames(symbols, source_symbols)
rownames(M) <- unname(restored_by_source[rownames(M)])
if (anyNA(rownames(M)) || anyDuplicated(rownames(M))) stop("restored matrix row labels are invalid")
if (max(abs(colSums(M) - colSums(M0))) > 1e-7) stop("gene-symbol aggregation did not conserve normalized counts")
L <- log2(M + 1)
if (max(abs((2^L - 1) - M)) > 1e-8) stop("log2(normalized count+1) reconstruction failed")

out <- data.frame(symbol = rownames(M), L, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE124693_agrp_ribotag_ZT14_fast_vs_fed_log2norm.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)

ss <- data.frame(sample = samples$sample, group = samples$group, geo_accession = samples$gsm, biosample = samples$biosample,
                 source_column = samples$source_column, cell_type = "AgRP+ ARH neurons", fraction = "RiboTag immunoprecipitate",
                 genotype = "AGRP-Cre;RiboTag", time_point = "ZT14", treatment = samples$treatment,
                 biological_replicate = samples$biological_replicate, stringsAsFactors = FALSE)
write.table(ss, file.path(DS, "metadata", "GSE124693_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

qc <- data.frame(sample = samples$sample, group = samples$group, geo_accession = samples$gsm,
                 source_rows = nrow(M0), unique_output_symbols = nrow(M), duplicate_symbol_rows_collapsed = nrow(M0) - nrow(M),
                 source_nonfinite_values = colSums(!is.finite(M0)), source_negative_values = colSums(M0 < 0),
                 source_fractional_values = colSums(M0 != round(M0)), source_normalized_count_sum = colSums(M0),
                 aggregated_normalized_count_sum = colSums(M), count_conservation_delta = colSums(M) - colSums(M0),
                 count_conserved = abs(colSums(M) - colSums(M0)) < 1e-7, detected_genes = colSums(M > 0),
                 excel_date_symbols_recovered = length(date_rows), remaining_excel_date_symbols = sum(grepl("^[0-9]{1,2}-(Mar|Sep)$", rownames(M))),
                 numeric_identifiers_recovered = length(numeric_rows), remaining_numeric_identifiers = sum(grepl("^[0-9]+$", rownames(M))),
                 log2_expression_sum = colSums(L), transform_max_abs_delta = apply(abs((2^L - 1) - M), 2L, max),
                 stringsAsFactors = FALSE)
if (any(!qc$count_conserved) || any(qc$transform_max_abs_delta > 1e-8)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE124693_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]; if (length(z) != 1L) stop("could not calculate SHA-256 for ", path); tolower(z)
}
paths <- c(SRC, SOFT)
urls <- c("https://ftp.ncbi.nlm.nih.gov/geo/series/GSE124nnn/GSE124693/suppl/GSE124693_agrp_normalized_counts.txt.gz",
          "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE124nnn/GSE124693/soft/GSE124693_family.soft.gz")
manifest <- data.frame(file = basename(paths), bytes = as.numeric(file.info(paths)$size), sha256 = vapply(paths, sha256_file, character(1)),
                       source = urls, fetched = "2026-08-31", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE124693_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE124693] wrote %d genes x 9 samples (control=4, case=5); source linear normalized counts were not rounded\n", nrow(L)))
