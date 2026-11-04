#!/usr/bin/env Rscript
# Prepare the male 8-week whole-hypothalamus endurance-training contrast from
# GSE242354. RSEM expected counts are deliberately not rounded: they are depth
# normalized to CPM and put on log2(CPM + 1) for the pipeline's limma branch.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE242354_rnor_hypothalamus_exercise")
SRC <- file.path(DS, "raw", "source", "GSE242354_motrpac_pass1b-06_t54-hypothalamus_transcript-rna-seq_rsem-genes-count.txt.gz")
SOFT <- file.path(DS, "metadata", "GSE242354_family.soft.gz")
GTF <- file.path(DS, "metadata", "Rattus_norvegicus.Rnor_6.0.96.gtf.gz")

samples <- data.frame(
  gsm = c("GSM7759948", "GSM7759954", "GSM7759955", "GSM7759956", "GSM7759957",
          "GSM7759949", "GSM7759950", "GSM7759951", "GSM7759952", "GSM7759953"),
  source_column = c("90217015402", "90229015402", "90232015402", "90237015402", "90239015402",
                    "90218015402", "90222015402", "90223015402", "90225015402", "90227015402"),
  sample = c(paste0("Hypoth_Control_M_8w_", 1:5), paste0("Hypoth_Training_M_8w_", 1:5)),
  group = rep(c("control", "case"), each = 5L),
  treatment = rep(c("Control - 8 weeks", "Training - 8 weeks"), each = 5L),
  biological_replicate = rep(1:5, 2L),
  stringsAsFactors = FALSE
)
if (!file.exists(SRC) || !file.exists(SOFT) || !file.exists(GTF)) stop("required GEO source, family SOFT, or Ensembl release-96 GTF is missing")
if (any(table(samples$group) < 3L) || anyDuplicated(samples$gsm) || anyDuplicated(samples$source_column)) {
  stop("contrast does not contain independent >=3/arm biological samples")
}

soft <- readLines(gzfile(SOFT), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft))
names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
block <- function(gsm) {
  i <- match(gsm, names(starts)); if (is.na(i)) stop("GSM absent from SOFT: ", gsm)
  soft[starts[i]:ends[i]]
}
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
biosample <- character(nrow(samples))
for (i in seq_len(nrow(samples))) {
  b <- block(samples$gsm[i]); title <- tag(b, "!Sample_title"); chars <- tag(b, "!Sample_characteristics_ch1")
  required <- c("tissue: Hypothalamus Powder", paste0("treatment: ", samples$treatment[i]))
  if (length(title) != 1L || !grepl("hypoth_(control|training)_male_8w", title, ignore.case = TRUE) ||
      !grepl(paste0("vial_", samples$source_column[i], "$"), title) || !all(required %in% chars)) {
    stop(samples$gsm[i], ": GEO title/characteristics no longer match the prespecified contrast")
  }
  rel <- grep("^BioSample: ", tag(b, "!Sample_relation"), value = TRUE)
  if (length(rel) != 1L) stop(samples$gsm[i], ": expected exactly one BioSample")
  biosample[i] <- sub("^.*/", "", rel)
}
if (anyDuplicated(biosample)) stop("selected GSMs share a BioSample")
samples$biosample <- biosample

d <- read.delim(gzfile(SRC), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(names(d)[1L], "gene_id")) stop("unexpected RSEM gene identifier column")
miss <- setdiff(samples$source_column, names(d)); if (length(miss)) stop("missing RSEM columns: ", paste(miss, collapse = ", "))
ids <- as.character(d$gene_id)
if (nrow(d) != 32883L || anyNA(ids) || any(!nzchar(ids)) || anyDuplicated(ids)) stop("RSEM gene universe changed or is invalid")
M <- as.matrix(d[, samples$source_column, drop = FALSE]); storage.mode(M) <- "double"
colnames(M) <- samples$sample
if (any(!is.finite(M)) || any(M < 0)) stop("RSEM expected counts must be finite and non-negative")
if (!any(M != round(M))) stop("source unexpectedly became integer counts; reassess the intended front-end")
M_source <- M

# Parse only gene records from the exact Ensembl annotation named in GEO. This
# avoids depending on a mutable installed annotation package and makes the rat
# pathway identifiers usable by the shared SYMBOL-oriented downstream code.
gene_ids <- gene_names <- character()
gtf_con <- gzfile(GTF, "rt")
repeat {
  lines <- readLines(gtf_con, n = 100000L, warn = FALSE)
  if (!length(lines)) break
  lines <- lines[!startsWith(lines, "#") & grepl("\\tgene\\t", lines)]
  if (!length(lines)) next
  fields <- strsplit(lines, "\t", fixed = TRUE)
  attrs <- vapply(fields, `[`, character(1), 9L)
  gid <- sub('.*gene_id "([^"]+)".*', "\\1", attrs)
  has_name <- grepl('gene_name "[^"]+"', attrs)
  gname <- rep(NA_character_, length(attrs))
  gname[has_name] <- sub('.*gene_name "([^"]+)".*', "\\1", attrs[has_name])
  gene_ids <- c(gene_ids, gid); gene_names <- c(gene_names, gname)
}
close(gtf_con)
if (length(gene_ids) < 20000L || anyDuplicated(gene_ids)) stop("invalid or duplicate gene records in Ensembl GTF")
mapped <- gene_names[match(sub("\\..*$", "", ids), sub("\\..*$", "", gene_ids))]
symbol_key <- ifelse(is.na(mapped) | !nzchar(mapped), paste0("UNMAPPED_", ids), mapped)
source_lib <- colSums(M_source)
M <- rowsum(M_source, group = symbol_key, reorder = TRUE)
if (max(abs(colSums(M) - source_lib)) > 1e-7) stop("Ensembl-to-symbol aggregation did not conserve expected counts")
lib <- colSums(M)
if (any(lib <= 1e6)) stop("RSEM library size is implausibly small")
CPM <- sweep(M, 2L, lib, "/") * 1e6
L <- log2(CPM + 1)
if (max(abs((2^L - 1) - CPM)) > 1e-8) stop("log2(CPM+1) reconstruction failed")

out <- data.frame(symbol = rownames(M), L, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE242354_hypothalamus_male_8w_training_log2cpm.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)

ss <- data.frame(sample = samples$sample, group = samples$group, geo_accession = samples$gsm,
                 biosample = samples$biosample, source_column = samples$source_column,
                 tissue = "whole hypothalamus powder", sex = "male", duration = "8 weeks",
                 treatment = samples$treatment, biological_replicate = samples$biological_replicate,
                 stringsAsFactors = FALSE)
write.table(ss, file.path(DS, "metadata", "GSE242354_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

reconstructed_cpm <- 2^L - 1
qc <- data.frame(sample = samples$sample, group = samples$group, geo_accession = samples$gsm,
                 source_rows = nrow(d), output_symbol_rows = nrow(M), duplicate_symbol_rows_collapsed = nrow(d) - nrow(M),
                 unmapped_source_gene_ids = sum(is.na(mapped) | !nzchar(mapped)), source_nonfinite_values = colSums(!is.finite(M_source)),
                 source_negative_values = colSums(M_source < 0), source_fractional_values = colSums(M_source != round(M_source)),
                 source_expected_count_sum = source_lib, selected_expected_count_sum = colSums(M),
                 count_conservation_delta = colSums(M) - source_lib, count_conserved = abs(colSums(M) - source_lib) < 1e-7,
                 detected_genes = colSums(M > 0), cpm_sum = colSums(CPM), log2_expression_sum = colSums(L),
                 transform_max_abs_delta = apply(abs(reconstructed_cpm - CPM), 2L, max), stringsAsFactors = FALSE)
if (any(!qc$count_conserved) || any(abs(qc$cpm_sum - 1e6) > 1e-6) || any(qc$transform_max_abs_delta > 1e-8)) stop("normalization QC failed")
write.table(qc, file.path(DS, "processed", "GSE242354_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
paths <- c(SRC, SOFT, GTF)
urls <- c(
  "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE242nnn/GSE242354/suppl/GSE242354_motrpac_pass1b-06_t54-hypothalamus_transcript-rna-seq_rsem-genes-count.txt.gz",
  "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE242nnn/GSE242354/soft/GSE242354_family.soft.gz",
  "https://ftp.ensembl.org/pub/release-96/gtf/rattus_norvegicus/Rattus_norvegicus.Rnor_6.0.96.gtf.gz"
)
manifest <- data.frame(file = basename(paths), bytes = as.numeric(file.info(paths)$size),
                       sha256 = vapply(paths, sha256_file, character(1)), source = urls,
                       fetched = "2026-08-31", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE242354_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE242354] wrote %d genes x %d samples (control=5, case=5); RSEM expected counts preserved without rounding\n", nrow(L), ncol(L)))
