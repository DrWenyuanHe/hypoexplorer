#!/usr/bin/env Rscript
# Prepare the thermoneutral broiler hypothalamus 1% L-citrulline versus basal
# diet contrast (6 independent birds per arm) from the raw read-count columns
# in the official GEO workbook. The workbook's own historical Gene_ID -> Name
# relationships are the only identifier authority used.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE202003_ggal_hypothalamus_lcitrulline")
XLSX <- file.path(DS, "raw", "GSE202003_Expression.xlsx")
SOFT <- file.path(DS, "metadata", "GSE202003_family.soft.gz")
if (!requireNamespace("readxl", quietly = TRUE)) stop("the readxl R package is required")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
pins <- data.frame(
  path = c(XLSX, SOFT), bytes = c(9390239, 4451),
  sha256 = c("9eabd31bb3b46e8b2094d441a4d119a39cd4493f1568af7efc8c67c0fd6bb674", "09f752971a91d631fdffc5fbecfbd5d3ec3433d15f9d05c035d8215e56d9745f"),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE202nnn/GSE202003/suppl/GSE202003_Expression.xlsx",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE202nnn/GSE202003/soft/GSE202003_family.soft.gz"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(pins$path))) stop("required official source is missing")
observed_bytes <- as.numeric(file.info(pins$path)$size); observed_sha <- unname(vapply(pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, pins$bytes) || !identical(observed_sha, pins$sha256)) stop("source bytes/SHA-256 differ from reviewed inputs")

soft <- readLines(gzfile(SOFT), warn = FALSE)
if (!any(grepl("hypothalamic responses of broiler chickens fed L-citrulline", soft, fixed = TRUE)) ||
    !any(grepl("!Series_pubmed_id = 37844531", soft, fixed = TRUE)) ||
    !any(grepl("GSE202003_Expression.xlsx", soft, fixed = TRUE)) ||
    !any(grepl("excel table with raw gene counts for every gene and every sample", soft, fixed = TRUE))) stop("GEO experiment/citation/raw-count metadata changed")
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft))
tag <- function(b, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), b, value = TRUE))
meta <- lapply(seq_along(starts), function(i) {
  b <- soft[starts[i]:ends[i]]; ch <- tag(b, "!Sample_characteristics_ch1"); rel <- tag(b, "!Sample_relation")
  data.frame(
    gsm = tag(b, "!Sample_geo_accession"), title = tag(b, "!Sample_title"),
    strain = sub("^strain: ", "", ch[grepl("^strain: ", ch)]),
    tissue = sub("^tissue: ", "", ch[grepl("^tissue: ", ch)]),
    age = sub("^age: ", "", ch[grepl("^age: ", ch)]),
    treatment = sub("^treatment: ", "", ch[grepl("^treatment: ", ch)]),
    biosample = sub(".*biosample/", "", rel[grepl("biosample/", rel, fixed = TRUE)]),
    srx = sub(".*term=", "", rel[grepl("sra[?]term=", rel)]), strategy = tag(b, "!Sample_library_strategy"),
    stringsAsFactors = FALSE
  )
})
meta <- do.call(rbind, meta)
meta <- meta[grepl("24oC", meta$treatment, fixed = TRUE), , drop = FALSE]
meta$group <- ifelse(grepl("^Basal diet", meta$treatment), "control", "case")
meta$source_prefix <- gsub("[[:space:]]+", "", meta$title)
meta$source_column <- paste0(meta$source_prefix, ":read count")
if (nrow(meta) != 12L || !identical(as.integer(table(meta$group)[c("control", "case")]), c(6L, 6L)) ||
    any(!grepl("^(Basal diet|L-Citrulline diet)", meta$treatment)) || any(tolower(meta$tissue) != "hypothalamus") ||
    any(meta$strategy != "RNA-Seq") || anyDuplicated(meta$gsm) || anyDuplicated(meta$biosample) || anyDuplicated(meta$source_column)) stop("reviewed 6+6 thermoneutral hypothalamus roster changed")

d <- as.data.frame(readxl::read_excel(XLSX, sheet = "Sheet1", .name_repair = "minimal"), check.names = FALSE)
if (!identical(dim(d), c(16779L, 65L)) || !all(c("Gene_ID", "Name") %in% names(d))) stop("official workbook dimensions/schema changed")
ids <- as.character(d[["Gene_ID"]]); symbols <- as.character(d[["Name"]])
if (anyNA(ids) || any(!nzchar(ids)) || anyDuplicated(ids) || any(!grepl("^ENSGALG[0-9]+$", ids))) stop("blank, duplicate, or malformed chicken Ensembl IDs")
if (!all(meta$source_column %in% names(d))) stop("reviewed read-count columns are absent")
M_source <- as.matrix(d[, meta$source_column, drop = FALSE]); storage.mode(M_source) <- "double"; colnames(M_source) <- meta$gsm
if (any(!is.finite(M_source)) || any(M_source < 0) || any(M_source != round(M_source))) stop("workbook raw read-count semantics no longer hold")

pairs <- unique(data.frame(ensembl = ids, symbol = symbols, stringsAsFactors = FALSE))
pairs <- pairs[!is.na(pairs$symbol) & nzchar(pairs$symbol) &
               grepl("^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._-]*$", pairs$symbol, perl = TRUE), , drop = FALSE]
id_cardinality <- vapply(split(pairs$symbol, pairs$ensembl), function(v) length(unique(v)), integer(1))
pairs <- pairs[pairs$ensembl %in% names(id_cardinality)[id_cardinality == 1L], , drop = FALSE]
symbol_cardinality <- vapply(split(pairs$ensembl, pairs$symbol), function(v) length(unique(v)), integer(1))
pairs <- pairs[symbol_cardinality[pairs$symbol] == 1L, , drop = FALSE]
if (nrow(pairs) != 12412L || anyDuplicated(pairs$ensembl) || anyDuplicated(pairs$symbol)) stop("reviewed workbook identifier-map signature changed")
mapped <- setNames(pairs$symbol, pairs$ensembl)
labels <- paste0("__UNMAPPED_GALG_", ids); hit <- ids %in% names(mapped); labels[hit] <- unname(mapped[ids[hit]])
if (anyDuplicated(labels)) stop("output labels are not unique")
rownames(M_source) <- labels

out <- data.frame(symbol = labels, M_source, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE202003_hypothalamus_LCit_vs_basal_24C_counts.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$symbol, labels) || !identical(names(roundtrip)[-1L], meta$gsm) || any(as.matrix(roundtrip[-1L]) != M_source)) stop("written matrix failed exact round-trip validation")

ss <- data.frame(
  sample = meta$gsm, group = meta$group, geo_accession = meta$gsm, biosample = meta$biosample, sra = meta$srx,
  source_column = meta$source_column, treatment = meta$treatment, temperature = "24 C thermoneutral",
  tissue = meta$tissue, age = meta$age, strain = meta$strain, biological_unit = "one bird selected from each independent replicate",
  stringsAsFactors = FALSE
)
write.table(ss, file.path(DS, "metadata", "GSE202003_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
map_audit <- data.frame(source_ensembl_id = ids, source_name = symbols, output_label = labels,
                        mapping_status = ifelse(hit, "official_workbook_unique_symbol", "reserved_unnamed_or_ambiguous"), stringsAsFactors = FALSE)
write.table(map_audit, file.path(DS, "metadata", "GSE202003_identifier_mapping.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
qc <- data.frame(
  sample = meta$gsm, group = meta$group, source_column = meta$source_column,
  source_gene_rows = nrow(M_source), mapped_official_symbols = sum(hit), reserved_source_ids = sum(!hit),
  source_library_size = colSums(M_source), detected_features = colSums(M_source > 0),
  nonfinite_values = colSums(!is.finite(M_source)), negative_values = colSums(M_source < 0), fractional_values = colSums(M_source != round(M_source)),
  accepted_input_class = "official workbook raw read counts", shared_route = "input_kind=counts -> canonical edgeR-QL", written_exact = TRUE,
  stringsAsFactors = FALSE
)
if (any(qc$source_library_size < 1e6) || any(qc$detected_features < 10000L)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE202003_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
manifest <- data.frame(file = basename(pins$path), bytes = observed_bytes, sha256 = observed_sha, source = pins$url, fetched = "2026-09-01", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE202003_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE202003] wrote %d count rows x %d samples; basal=6, L-citrulline=6; mapped=%d; reserved=%d\n",
            nrow(M_source), ncol(M_source), sum(hit), sum(!hit)))
