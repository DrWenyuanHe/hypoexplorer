#!/usr/bin/env Rscript
# Prepare the WT scheduled-voluntary-exercise contrast in laser-microdissected
# mouse SCN from GSE207992. GEO supplies DESeq2-normalized counts, not raw
# counts, so the reviewed matrix route applies only log2(normalized + 1).

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE207992_mmus_scn_exercise")
SRC <- file.path(DS, "raw", "GSE207992_DESeq2_normcounts.xlsx")
SOFT <- file.path(DS, "metadata", "GSE207992_family.soft.gz")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
pins <- data.frame(
  path = c(SRC, SOFT), bytes = c(8415462, 4866),
  sha256 = c("6794bfadc8fd2f2a81f8e3719926899cc9430679a7c3f5563094defe55027d28",
             "2c0ee4291e01191f1fb2e4787fea41a2f08caf3436fdf6f1fd3ee62e534f1564"),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE207nnn/GSE207992/suppl/GSE207992_DESeq2_normcounts.xlsx",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE207nnn/GSE207992/soft/GSE207992_family.soft.gz"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(pins$path))) stop("required official GEO workbook or family SOFT is missing")
observed_bytes <- as.numeric(file.info(pins$path)$size)
observed_sha <- unname(vapply(pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, pins$bytes) || !identical(observed_sha, pins$sha256)) stop("source bytes/SHA-256 differ from reviewed inputs")
if (!requireNamespace("readxl", quietly = TRUE)) stop("readxl is required to read the reviewed GEO workbook")
if (!identical(readxl::excel_sheets(SRC), c("Sheet1", "Sheet2"))) stop("official workbook sheet structure changed")

samples <- data.frame(
  gsm = paste0("GSM63296", 30:37),
  source_column = c(paste0("WT non-SVE AH", 1:4, " Gene counts"), paste0("WT SVE AH", 5:8, " Gene counts")),
  sample = c(paste0("WT_nonSVE_AH", 1:4), paste0("WT_SVE_AH", 5:8)),
  group = rep(c("control", "case"), each = 4L),
  treatment = rep(c("non-SVE", "scheduled voluntary exercise"), each = 4L),
  genotype = "Vipr2+/+", stringsAsFactors = FALSE
)

soft <- readLines(gzfile(SOFT), warn = FALSE)
design_text <- sub("^!Series_overall_design = ", "", grep("^!Series_overall_design = ", soft, value = TRUE))
processing <- sub("^!Sample_data_processing = ", "", grep("^!Sample_data_processing = ", soft, value = TRUE))
if (length(design_text) != 1L || !grepl("Vipr2+/+ nSVE CT14 (n=4)", design_text, fixed = TRUE) ||
    !grepl("Vipr2+/+ SVE ZT14/CT24 (n=4)", design_text, fixed = TRUE) ||
    !any(grepl("tabular file containing normalised counts for all genes", processing, fixed = TRUE))) {
  stop("GEO no longer documents the reviewed WT exercise contrast or DESeq2-normalized scale")
}
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft)); names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
block <- function(gsm) { i <- match(gsm, names(starts)); if (is.na(i)) stop("GSM absent from SOFT: ", gsm); soft[starts[i]:ends[i]] }
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
samples$biosample <- samples$sra <- samples$title <- NA_character_
for (i in seq_len(nrow(samples))) {
  b <- block(samples$gsm[i]); rel <- tag(b, "!Sample_relation"); chars <- tag(b, "!Sample_characteristics_ch1")
  expected_treatment <- if (samples$group[i] == "control") "treatment: non-SVE" else "treatment: SVE"
  if (!"genotype: wildtype" %in% chars || !expected_treatment %in% chars ||
      !identical(tag(b, "!Sample_source_name_ch1"), "Suprachiasmatic nucleus") ||
      !identical(tag(b, "!Sample_library_strategy"), "RNA-Seq")) stop(samples$gsm[i], ": SOFT metadata changed")
  samples$title[i] <- tag(b, "!Sample_title")
  samples$biosample[i] <- sub(".*biosample/", "", rel[grepl("BioSample:", rel, fixed = TRUE)])
  samples$sra[i] <- sub(".*term=", "", rel[grepl("SRA:", rel, fixed = TRUE)])
}
if (anyDuplicated(samples$biosample) || any(table(samples$group) != 4L)) stop("selected contrast lacks four independent BioSamples per arm")

d <- as.data.frame(readxl::read_excel(SRC, sheet = "Sheet1", .name_repair = "minimal"), check.names = FALSE, stringsAsFactors = FALSE)
expected_names <- c("", "KO SVE AH14 Gene counts", "KO SVE AH15 Gene counts", "KO SVE AH16 Gene counts",
                    "KO nonSVE AH9 Gene counts", "KO nonSVE AH10 Gene counts", "KO nonSVE AH11 Gene counts",
                    "WT SVE AH5 Gene counts", "WT SVE AH6 Gene counts", "WT SVE AH7 Gene counts", "WT SVE AH8 Gene counts",
                    "WT non-SVE AH1 Gene counts", "WT non-SVE AH2 Gene counts", "WT non-SVE AH3 Gene counts", "WT non-SVE AH4 Gene counts",
                    "Chromosome", "Start", "End", "Strand", "Gene_ID")
if (!identical(dim(d), c(55401L, 20L)) || !identical(names(d), expected_names) || any(!samples$source_column %in% names(d))) stop("official normalized-count workbook schema/dimensions changed")
ids <- as.character(d[[1L]])
if (anyNA(ids) || any(!grepl("^ENSMUSG[0-9]+([.][0-9]+)?$", ids)) || anyDuplicated(ids)) stop("blank, duplicate, or invalid mouse Ensembl ID")
M0 <- as.matrix(d[, samples$source_column, drop = FALSE]); storage.mode(M0) <- "double"; colnames(M0) <- samples$sample
if (any(!is.finite(M0)) || any(M0 < 0) || sum(M0 != round(M0)) == 0L) stop("reviewed fractional DESeq2-normalized count semantics changed")
L <- log2(M0 + 1)
if (any(!is.finite(L)) || max(abs((2^L - 1) - M0)) > 1e-8) stop("log2(normalized count + 1) reconstruction failed")
rownames(L) <- ids

suppressPackageStartupMessages({library(AnnotationDbi); library(org.Mm.eg.db); library(limma)})
mapped <- mapIds(org.Mm.eg.db, keys = sub("[.].*", "", ids), keytype = "ENSEMBL", column = "SYMBOL", multiVals = "first")
mapping_coverage <- mean(!is.na(mapped))
modeled_candidate <- apply(L, 1L, var) > 1e-8
modeled_mapping_coverage <- mean(!is.na(mapped[modeled_candidate]))
if (modeled_mapping_coverage < 0.70) stop("expressed mouse Ensembl matrix fails the existing mapping-coverage gate")
out <- data.frame(Ensembl_gene_id = ids, L, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE207992_WT_SVE_vs_nonSVE_log2norm.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$Ensembl_gene_id, ids) || !identical(names(roundtrip)[-1L], samples$sample) ||
    max(abs(as.matrix(roundtrip[-1L]) - L)) > 1e-12) stop("written log2-normalized matrix failed round-trip validation")

samples$geo_accession <- samples$gsm; samples$tissue <- "laser-microdissected suprachiasmatic nucleus"
samples$source_scale <- "DESeq2 normalized counts"; samples$analysis_scale <- "log2(normalized count + 1)"
write.table(samples[, c("sample", "group", "geo_accession", "biosample", "sra", "source_column", "treatment", "genotype", "tissue", "source_scale", "analysis_scale", "title")],
            file.path(DS, "metadata", "GSE207992_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

rv <- apply(L, 1L, var); keep <- is.finite(rv) & rv > 1e-8
design <- model.matrix(~ factor(group, levels = c("control", "case")), data = samples)
fit <- eBayes(lmFit(L[keep, , drop = FALSE], design))
if (sum(keep) < 5000L || any(!is.finite(fit$t[, 2L]))) stop("normalized-matrix preprocessing QC failed")
qc <- data.frame(
  sample = samples$sample, group = samples$group, source_rows = nrow(M0), output_rows = nrow(L),
  source_nonfinite_values = colSums(!is.finite(M0)), source_negative_values = colSums(M0 < 0),
  source_fractional_values = colSums(M0 != round(M0)), source_column_sum = colSums(M0), source_detected_features = colSums(M0 > 0),
  analysis_min = apply(L, 2L, min), analysis_max = apply(L, 2L, max), nonconstant_features = sum(keep),
  mapped_mouse_symbols = sum(!is.na(mapped)), mouse_symbol_mapping_coverage = mapping_coverage,
  modeled_symbol_mapping_coverage = modeled_mapping_coverage,
  accepted_input_class = "DESeq2-normalized counts", explicit_transform = "log2(normalized count + 1)",
  shared_route = "input_kind=matrix -> canonical limma", written_delta_max = apply(abs(as.matrix(roundtrip[-1L]) - L), 2L, max),
  stringsAsFactors = FALSE
)
write.table(qc, file.path(DS, "processed", "GSE207992_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
manifest <- data.frame(file = basename(pins$path), bytes = observed_bytes, sha256 = observed_sha, source = pins$url, fetched = "2026-09-01", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE207992_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE207992] wrote %d mouse Ensembl genes x %d WT SCN samples; non-SVE=4, SVE=4; log2(normalized+1); modeled-feature mapping coverage %.1f%%; %d nonconstant features\n",
            nrow(L), ncol(L), 100 * modeled_mapping_coverage, sum(keep)))
