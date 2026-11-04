#!/usr/bin/env Rscript
# Prepare male medial-preoptic-area RNA-seq, early-life limited bedding/nesting
# (LBN) versus control. GEO deposits transcript-level log2 FPKM. Transcript
# values are inverted, summed by gene on the additive FPKM scale, and re-logged.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE174753_rnor_mpoa_lbn")
SRC <- file.path(DS, "raw", "source", "GSE174753_Final_Male_log2.txt.gz")
SOFT <- file.path(DS, "metadata", "GSE174753_family.soft.gz")

samples <- data.frame(
  gsm = c("GSM5325940", "GSM5325942", "GSM5325944", "GSM5325945", "GSM5325948", "GSM5325950",
          "GSM5325941", "GSM5325943", "GSM5325946", "GSM5325947", "GSM5325949", "GSM5325951"),
  source_column = as.character(c(1, 3, 5, 6, 9, 11, 2, 4, 7, 8, 10, 12)),
  animal_id = as.character(c(552, 230, 582, 583, 709, 710, 95, 11, 590, 591, 724, 725)),
  sample = c(paste0("Male_Control_", c(552,230,582,583,709,710)), paste0("Male_LBN_", c(95,11,590,591,724,725))),
  group = rep(c("control", "case"), each = 6L), treatment = rep(c("Control", "LBN"), each = 6L),
  biological_replicate = rep(1:6, 2L), stringsAsFactors = FALSE
)
if (!file.exists(SRC) || !file.exists(SOFT)) stop("required GEO source or family SOFT is missing")
if (any(table(samples$group) < 3L) || anyDuplicated(samples$gsm) || anyDuplicated(samples$animal_id)) stop("contrast lacks independent >=3/arm animals")

soft <- readLines(gzfile(SOFT), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft)); names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
block <- function(gsm) { i <- match(gsm, names(starts)); if (is.na(i)) stop("GSM absent from SOFT: ", gsm); soft[starts[i]:ends[i]] }
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
biosample <- character(nrow(samples))
for (i in seq_len(nrow(samples))) {
  b <- block(samples$gsm[i]); title <- tag(b, "!Sample_title"); desc <- tag(b, "!Sample_description"); src_name <- tag(b, "!Sample_source_name_ch1"); chars <- tag(b, "!Sample_characteristics_ch1")
  required <- c("strain: Long evans", "Sex: Male", paste0("treatment: ", samples$treatment[i]))
  if (!identical(title, samples$animal_id[i]) || !identical(desc, samples$source_column[i]) ||
      !identical(src_name, "Medial preoptic area brain tissue") || !all(required %in% chars)) {
    stop(samples$gsm[i], ": GEO metadata no longer matches the fixed male mPOA contrast")
  }
  rel <- grep("^BioSample: ", tag(b, "!Sample_relation"), value = TRUE); if (length(rel) != 1L) stop("expected one BioSample for ", samples$gsm[i])
  biosample[i] <- sub("^.*/", "", rel)
}
if (anyDuplicated(biosample)) stop("selected libraries share a BioSample")
samples$biosample <- biosample

d <- read.delim(gzfile(SRC), check.names = FALSE, stringsAsFactors = FALSE, na.strings = character())
if (!all(c("t_name", "gene_name") %in% names(d)) || nrow(d) < 10000L) stop("unexpected transcript matrix structure")
miss <- setdiff(samples$source_column, names(d)); if (length(miss)) stop("missing male log2-FPKM columns: ", paste(miss, collapse = ", "))
T <- as.matrix(d[, samples$source_column, drop = FALSE]); storage.mode(T) <- "double"; colnames(T) <- samples$sample
if (any(!is.finite(T)) || any(T < 0)) stop("deposited log2(FPKM+1) values must be finite and non-negative")
if (!any(T != round(T)) || max(T) > 30) stop("source no longer has the documented log2-FPKM scale")
linear <- 2^T - 1
if (any(linear < -1e-12)) stop("inverse log2(FPKM+1) produced negative values")
linear[linear < 0] <- 0
gene_name <- as.character(d$gene_name); transcript <- as.character(d$t_name)
good <- !is.na(gene_name) & nzchar(gene_name) & !gene_name %in% c("-", "NA")
key <- ifelse(good, gene_name, paste0("UNANNOT_", transcript))
if (anyDuplicated(paste(key, transcript, sep = "|"))) stop("duplicate transcript annotations in source")
M <- rowsum(linear, group = key, reorder = TRUE)
if (max(abs(colSums(M) - colSums(linear))) > 1e-7) stop("transcript-to-gene aggregation failed FPKM conservation")
L <- log2(M + 1)
if (max(abs((2^L - 1) - M)) > 1e-9) stop("gene-level log2(FPKM+1) reconstruction failed")

out <- data.frame(symbol = rownames(M), L, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE174753_male_mpoa_LBN_vs_control_log2fpkm.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)

ss <- data.frame(sample = samples$sample, group = samples$group, geo_accession = samples$gsm, biosample = samples$biosample,
                 source_column = samples$source_column, animal_id = samples$animal_id, tissue = "medial preoptic area",
                 strain = "Long Evans", sex = "male", treatment = samples$treatment,
                 biological_replicate = samples$biological_replicate, stringsAsFactors = FALSE)
write.table(ss, file.path(DS, "metadata", "GSE174753_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

qc <- data.frame(sample = samples$sample, group = samples$group, geo_accession = samples$gsm,
                 source_transcript_rows = nrow(T), output_gene_rows = nrow(M), transcript_rows_collapsed = nrow(T) - nrow(M),
                 unannotated_transcript_rows = sum(!good), source_nonfinite_values = colSums(!is.finite(T)),
                 source_negative_values = colSums(T < 0), source_fractional_values = colSums(T != round(T)),
                 reconstructed_transcript_fpkm_sum = colSums(linear), aggregated_gene_fpkm_sum = colSums(M),
                 fpkm_conservation_delta = colSums(M) - colSums(linear), normalized_values_conserved = abs(colSums(M)-colSums(linear)) < 1e-7,
                 detected_genes = colSums(M > 0), log2_expression_sum = colSums(L),
                 transform_max_abs_delta = apply(abs((2^L - 1) - M), 2L, max), stringsAsFactors = FALSE)
if (any(!qc$normalized_values_conserved) || any(qc$transform_max_abs_delta > 1e-9)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE174753_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]; if (length(z) != 1L) stop("could not calculate SHA-256 for ", path); tolower(z)
}
paths <- c(SRC, SOFT)
urls <- c("https://ftp.ncbi.nlm.nih.gov/geo/series/GSE174nnn/GSE174753/suppl/GSE174753_Final_Male_log2.txt.gz",
          "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE174nnn/GSE174753/soft/GSE174753_family.soft.gz")
manifest <- data.frame(file = basename(paths), bytes = as.numeric(file.info(paths)$size), sha256 = vapply(paths, sha256_file, character(1)),
                       source = urls, fetched = "2026-08-31", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE174753_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE174753] wrote %d genes x 12 male mPOA samples (control=6, case=6); transcript FPKM conserved\n", nrow(L)))
