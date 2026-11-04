#!/usr/bin/env Rscript
# Prepare the GSE104255 6-week versus 3-week broiler hypothalamus contrast.
# GEO supplies per-sample RSEM integer gene counts. The submitter did not key
# the compact count-column labels to individual GSMs, so this script preserves
# group-level (not invented individual-level) provenance. The s_4 - s_2 age
# direction is independently checked against the submitter's hypothalamus
# DESeq2 table; those DE statistics are not used in the new analysis.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE104255_ggal_hypothalamus")
COUNTS <- file.path(DS, "raw", "GSE104255_raw.genes.csv.gz")
AUTHOR_DE <- file.path(DS, "raw", "GSE104255_res.pod.csv.gz")
SOFT <- file.path(DS, "metadata", "GSE104255_family.soft.gz")
RUNINFO <- file.path(DS, "metadata", "SRP118888_RunInfo.csv")
if (!requireNamespace("data.table", quietly = TRUE)) stop("the data.table R package is required")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
pins <- data.frame(
  path = c(COUNTS, AUTHOR_DE, SOFT, RUNINFO),
  bytes = c(1000532, 587228, 5069, 14981),
  sha256 = c(
    "cd2fc12f0d84c5b1b3945fc62a0dc95c1edc15359aa2d39eaad2bb5cfdc00ef1",
    "fa67eecaaae432aeecb4135520f3a369fb4bb2dabfaab3d180889d815765ac71",
    "b6ac94178a621ad629cb51a7c1144b77e9119e2121bef93b3d55843268d9ccff",
    "59ec217ec896f87e99be07e0326e3455a575d442e35304641de0d948d969bea4"
  ),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE104nnn/GSE104255/suppl/GSE104255_raw.genes.csv.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE104nnn/GSE104255/suppl/GSE104255_res.pod.csv.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE104nnn/GSE104255/soft/GSE104255_family.soft.gz",
    "https://trace.ncbi.nlm.nih.gov/Traces/sra-db-be/runinfo?acc=SRP118888"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(pins$path))) stop("required official source is missing")
observed_bytes <- as.numeric(file.info(pins$path)$size)
observed_sha <- unname(vapply(pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, pins$bytes) || !identical(observed_sha, pins$sha256)) stop("source bytes/SHA-256 differ from reviewed inputs")

soft <- readLines(gzfile(SOFT), warn = FALSE)
if (!any(grepl("Transcriptomic changes in broiler chicken hypothalamus", soft, fixed = TRUE)) ||
    !any(grepl("raw.genes.csv.gz:  raw genes counts", soft, fixed = TRUE)) ||
    !any(grepl("Genome_build: Gallus_gallus-5.0", soft, fixed = TRUE))) stop("GEO experiment or raw-count semantics changed")
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft))
tag <- function(b, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), b, value = TRUE))
meta <- lapply(seq_along(starts), function(i) {
  b <- soft[starts[i]:ends[i]]; ch <- tag(b, "!Sample_characteristics_ch1")
  data.frame(
    gsm = tag(b, "!Sample_geo_accession"), title = tag(b, "!Sample_title"),
    day = sub("^day: ", "", ch[grepl("^day: ", ch)]),
    tissue = sub("^tissue: ", "", ch[grepl("^tissue: ", ch)]),
    biosample = sub(".*biosample/", "", tag(b, "!Sample_relation")[grepl("biosample/", tag(b, "!Sample_relation"), fixed = TRUE)]),
    srx = sub(".*term=", "", tag(b, "!Sample_relation")[grepl("sra[?]term=", tag(b, "!Sample_relation"))]),
    strategy = tag(b, "!Sample_library_strategy"), stringsAsFactors = FALSE
  )
})
meta <- do.call(rbind, meta); meta <- meta[tolower(meta$tissue) == "hypothalamus", , drop = FALSE]
if (nrow(meta) != 16L || !identical(as.integer(table(meta$day)[c("22", "42")]), c(8L, 8L)) ||
    any(meta$strategy != "RNA-Seq") || anyDuplicated(meta$gsm) || anyDuplicated(meta$biosample)) stop("reviewed 8+8 hypothalamus BioSample roster changed")
runinfo <- data.table::fread(RUNINFO, data.table = FALSE, check.names = FALSE)
if (nrow(runinfo) != 32L || any(!meta$gsm %in% runinfo$SampleName) || any(!meta$biosample %in% runinfo$BioSample)) stop("SRA RunInfo no longer reconciles to GEO BioSamples")

d <- data.table::fread(COUNTS, data.table = FALSE, check.names = FALSE, showProgress = FALSE)
if (!identical(dim(d), c(24881L, 33L)) || !identical(names(d)[1L], "gene_id")) stop("official count-table dimensions/schema changed")
ids <- as.character(d$gene_id)
if (anyNA(ids) || any(!nzchar(ids)) || anyDuplicated(ids) || any(!grepl("^ENSGALG[0-9]+$", ids))) stop("blank, duplicate, or invalid chicken Ensembl IDs")
young_cols <- grep("^s_2_.*pod$", names(d), value = TRUE)
older_cols <- grep("^s_4_.*pod$", names(d), value = TRUE)
if (length(young_cols) != 8L || length(older_cols) != 8L) stop("reviewed 8+8 hypothalamus source-column roster changed")
source_cols <- c(young_cols, older_cols)
samples <- data.frame(
  source_column = source_cols,
  sample = c(paste0("week3_", seq_along(young_cols)), paste0("week6_", seq_along(older_cols))),
  group = rep(c("control", "case"), each = 8L),
  age_group = rep(c("3-week / GEO day 22", "6-week / GEO day 42; hypothalamus paper reports day 45"), each = 8L),
  stringsAsFactors = FALSE
)
M_source <- as.matrix(d[, source_cols, drop = FALSE]); storage.mode(M_source) <- "double"; colnames(M_source) <- samples$sample
if (any(!is.finite(M_source)) || any(M_source < 0) || any(M_source != round(M_source))) stop("raw integer-count semantics no longer hold")

# Resolve the compact s_2/s_4 convention without assigning unreported GSMs:
# s_4-minus-s_2 mean log-ratios must agree with the submitter's independent
# hypothalamus DESeq2 log2 fold changes.
author <- data.table::fread(AUTHOR_DE, data.table = FALSE, check.names = FALSE, showProgress = FALSE)
if (!identical(dim(author), c(14371L, 13L)) || !all(c("ensembl_gene_id", "gene_id", "log2FoldChange") %in% names(author))) stop("author mapping/DE table schema changed")
simple_logfc <- log2((rowMeans(M_source[, samples$group == "case", drop = FALSE]) + 0.5) /
                     (rowMeans(M_source[, samples$group == "control", drop = FALSE]) + 0.5))
author_logfc <- author$log2FoldChange[match(ids, author$ensembl_gene_id)]
direction_rho <- suppressWarnings(cor(simple_logfc, author_logfc, use = "complete.obs", method = "spearman"))
if (!is.finite(direction_rho) || direction_rho < 0.90) stop("s_4 - s_2 count contrast no longer agrees with author age contrast")

# The official author table supplies a historical Galgal-5 Ensembl-to-symbol
# map. Promote only one-ID/one-symbol relationships with conservative syntax;
# reserve every other source ID so counts are preserved without guessed names.
pairs <- unique(data.frame(ensembl = as.character(author$ensembl_gene_id), symbol = as.character(author$gene_id), stringsAsFactors = FALSE))
pairs <- pairs[!is.na(pairs$ensembl) & nzchar(pairs$ensembl) & !is.na(pairs$symbol) & nzchar(pairs$symbol) &
               grepl("^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._-]*$", pairs$symbol, perl = TRUE), , drop = FALSE]
id_cardinality <- vapply(split(pairs$symbol, pairs$ensembl), function(v) length(unique(v)), integer(1))
pairs <- pairs[pairs$ensembl %in% names(id_cardinality)[id_cardinality == 1L], , drop = FALSE]
symbol_cardinality <- vapply(split(pairs$ensembl, pairs$symbol), function(v) length(unique(v)), integer(1))
pairs <- pairs[symbol_cardinality[pairs$symbol] == 1L, , drop = FALSE]
if (nrow(pairs) != 9866L || anyDuplicated(pairs$ensembl) || anyDuplicated(pairs$symbol)) stop("reviewed historical identifier-map signature changed")
mapped <- setNames(pairs$symbol, pairs$ensembl)
labels <- paste0("__UNMAPPED_GALG_", ids); hit <- ids %in% names(mapped); labels[hit] <- unname(mapped[ids[hit]])
if (anyDuplicated(labels)) stop("output labels are not unique")
rownames(M_source) <- labels

out <- data.frame(symbol = labels, M_source, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE104255_hypothalamus_6wk_vs_3wk_counts.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$symbol, labels) || any(as.matrix(roundtrip[-1L]) != M_source)) stop("written matrix failed exact round-trip validation")

group_gsms <- split(meta$gsm, ifelse(meta$day == "22", "control", "case"))
ss <- samples
ss$geo_accession <- NA_character_
ss$geo_accessions_in_age_group <- ifelse(ss$group == "control", paste(group_gsms$control, collapse = ";"), paste(group_gsms$case, collapse = ";"))
ss$source_to_gsm_provenance <- "group-level only; submitter count table does not key compact source column to individual GSM"
ss$tissue <- "hypothalamus"; ss$sex <- "male"
write.table(ss[, c("sample", "group", "source_column", "geo_accession", "geo_accessions_in_age_group", "age_group", "tissue", "sex", "source_to_gsm_provenance")],
            file.path(DS, "metadata", "GSE104255_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, na = "NA", eol = "\n")
map_audit <- data.frame(source_ensembl_id = ids, output_label = labels,
                        mapping_status = ifelse(hit, "author_Galgal5_symbol", "reserved_unmapped_or_ambiguous"), stringsAsFactors = FALSE)
write.table(map_audit, file.path(DS, "metadata", "GSE104255_identifier_mapping.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
qc <- data.frame(
  sample = samples$sample, group = samples$group, source_column = samples$source_column,
  source_rows = nrow(M_source), mapped_official_symbols = sum(hit), reserved_source_ids = sum(!hit),
  source_library_size = colSums(M_source), detected_features = colSums(M_source > 0),
  nonfinite_values = colSums(!is.finite(M_source)), negative_values = colSums(M_source < 0), fractional_values = colSums(M_source != round(M_source)),
  age_direction_spearman_vs_author_DESeq2 = direction_rho,
  accepted_input_class = "RSEM raw integer gene counts", shared_route = "input_kind=counts -> canonical edgeR-QL", written_exact = TRUE,
  stringsAsFactors = FALSE
)
if (any(qc$source_library_size < 1e6) || any(qc$detected_features < 10000L)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE104255_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
manifest <- data.frame(file = basename(pins$path), bytes = observed_bytes, sha256 = observed_sha, source = pins$url, fetched = "2026-09-01", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE104255_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE104255] wrote %d count rows x %d samples; 3-week=8, 6-week=8; mapped=%d; reserved=%d; author-direction rho=%.3f\n",
            nrow(M_source), ncol(M_source), sum(hit), sum(!hit), direction_rho))
