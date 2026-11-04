#!/usr/bin/env Rscript
# Prepare the arcuate-nucleus 24-hour fasting contrast from GSE96627. The GEO
# supplementary matrix is documented RPKM, so it is transformed to log2(RPKM+1)
# and routed to limma without rounding or pretending normalized values are reads.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE96627_mmus_arc_fasting")
SRC <- file.path(DS, "raw", "source", "GSE96627_rpkm.csv.gz")
SOFT <- file.path(DS, "metadata", "GSE96627_family.soft.gz")

samples <- data.frame(
  gsm = c(paste0("GSM253", 6786:6790), paste0("GSM253", 6781:6785)),
  sample = c(paste0("ARC-Fed-", 1:5), paste0("ARC-Fast-", 1:5)),
  group = rep(c("control", "case"), each = 5L),
  nutritional_state = rep(c("Ad libitum fed", "24 hour fasted"), each = 5L),
  biological_replicate = rep(1:5, 2L), stringsAsFactors = FALSE
)
if (!file.exists(SRC) || !file.exists(SOFT)) stop("required GEO source or family SOFT is missing")
if (any(table(samples$group) < 3L) || anyDuplicated(samples$gsm)) stop("contrast lacks independent >=3/arm biological samples")

soft <- readLines(gzfile(SOFT), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft)); names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
block <- function(gsm) { i <- match(gsm, names(starts)); if (is.na(i)) stop("GSM absent from SOFT: ", gsm); soft[starts[i]:ends[i]] }
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
biosample <- character(nrow(samples))
for (i in seq_len(nrow(samples))) {
  b <- block(samples$gsm[i]); title <- tag(b, "!Sample_title"); source_name <- tag(b, "!Sample_source_name_ch1"); chars <- tag(b, "!Sample_characteristics_ch1")
  required <- c("strain: C57/BL6", paste0("nutritional state: ", samples$nutritional_state[i]), "tissue: arcuate nucleus", "gender: male")
  if (!identical(title, samples$sample[i]) || !identical(source_name, "laser-captured hypothalamic nucleus (region)") || !all(required %in% chars)) {
    stop(samples$gsm[i], ": GEO metadata no longer matches the fixed ARC contrast")
  }
  rel <- grep("^BioSample: ", tag(b, "!Sample_relation"), value = TRUE); if (length(rel) != 1L) stop("expected one BioSample for ", samples$gsm[i])
  biosample[i] <- sub("^.*/", "", rel)
}
if (anyDuplicated(biosample)) stop("selected libraries share a BioSample")
samples$biosample <- biosample

d <- read.csv(gzfile(SRC), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(names(d)[1L], "Ensembl_ID")) stop("unexpected RPKM gene identifier column")
miss <- setdiff(samples$sample, names(d)); if (length(miss)) stop("missing ARC RPKM columns: ", paste(miss, collapse = ", "))
ids <- as.character(d$Ensembl_ID)
if (nrow(d) < 10000L || anyNA(ids) || any(!nzchar(ids)) || anyDuplicated(ids)) stop("invalid or duplicate Ensembl gene identifiers")
M <- as.matrix(d[, samples$sample, drop = FALSE]); storage.mode(M) <- "double"
if (any(!is.finite(M)) || any(M < 0)) stop("RPKM values must be finite and non-negative")
if (!any(M != round(M)) || max(M) < 1) stop("source no longer has an RPKM-like fractional scale")
L <- log2(M + 1)
if (max(abs((2^L - 1) - M)) > 1e-10) stop("log2(RPKM+1) reconstruction failed")

out <- data.frame(Ensembl_ID = ids, L, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE96627_ARC_fast_vs_fed_log2rpkm.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)

ss <- data.frame(sample = samples$sample, group = samples$group, geo_accession = samples$gsm, biosample = samples$biosample,
                 tissue = "arcuate nucleus", dissection = "laser-capture microdissection", strain = "C57/BL6", sex = "male",
                 nutritional_state = samples$nutritional_state, biological_replicate = samples$biological_replicate,
                 stringsAsFactors = FALSE)
write.table(ss, file.path(DS, "metadata", "GSE96627_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

qc <- data.frame(sample = samples$sample, group = samples$group, geo_accession = samples$gsm,
                 source_rows = nrow(M), source_unique_gene_ids = length(unique(ids)), source_nonfinite_values = colSums(!is.finite(M)),
                 source_negative_values = colSums(M < 0), source_fractional_values = colSums(M != round(M)),
                 source_rpkm_sum = colSums(M), selected_rpkm_sum = colSums(M), rpkm_conservation_delta = 0,
                 normalized_values_conserved = TRUE, detected_genes = colSums(M > 0), log2_expression_sum = colSums(L),
                 transform_max_abs_delta = apply(abs((2^L - 1) - M), 2L, max), stringsAsFactors = FALSE)
if (any(qc$transform_max_abs_delta > 1e-10)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE96627_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]; if (length(z) != 1L) stop("could not calculate SHA-256 for ", path); tolower(z)
}
paths <- c(SRC, SOFT)
urls <- c("https://ftp.ncbi.nlm.nih.gov/geo/series/GSE96nnn/GSE96627/suppl/GSE96627_rpkm.csv.gz",
          "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE96nnn/GSE96627/soft/GSE96627_family.soft.gz")
manifest <- data.frame(file = basename(paths), bytes = as.numeric(file.info(paths)$size), sha256 = vapply(paths, sha256_file, character(1)),
                       source = urls, fetched = "2026-08-31", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE96627_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE96627] wrote %d genes x 10 ARC samples (control=5, case=5); RPKM values were not rounded\n", nrow(L)))
