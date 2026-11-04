#!/usr/bin/env Rscript
# Prepare the saline-challenged maternal immune activation contrast from
# GSE245146. GEO documents the supplied gene-by-sample matrix as TPM, so this
# dataset uses an explicit log2(TPM + 1) transform and the canonical limma route.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE245146_sscr_hypothalamus_mia")
SRC <- file.path(DS, "raw", "GSE245146_RodriguezZas_Pig_Distress_Hypothalamus_RNAseq_GEO_counts.csv.gz")
SOFT <- file.path(DS, "metadata", "GSE245146_family.soft.gz")
GENE_INFO <- file.path(DS, "metadata", "Sus_scrofa.gene_info.gz")
MANIFEST <- file.path(DS, "metadata", "GSE245146_source_files.tsv")
if (!requireNamespace("data.table", quietly = TRUE)) stop("the data.table R package is required")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
if (!file.exists(MANIFEST) ||
    sha256_file(MANIFEST) != "8b81d91525ea4918fd88f9abce7fd0ac4f609b24577ed96c23d0afefaaffc2e8") {
  stop("GSE245146 source manifest is missing or changed")
}
pins <- read.delim(MANIFEST, stringsAsFactors = FALSE, check.names = FALSE)
resolve_pin <- function(f) {
  p <- file.path(DS, c("raw", "metadata"), f); p <- p[file.exists(p)]
  if (length(p) != 1L) stop("pinned source missing or ambiguous: ", f)
  p
}
pin_paths <- vapply(pins$file, resolve_pin, character(1))
if (!identical(as.numeric(file.info(pin_paths)$size), as.numeric(pins$bytes)) ||
    !identical(unname(vapply(pin_paths, sha256_file, character(1))), pins$sha256)) {
  stop("GSE245146 source bytes/SHA-256 differ from the reviewed manifest")
}

soft <- readLines(gzfile(SOFT), warn = FALSE)
if (!any(grepl("transcripts per million \\(TPM\\) values for each sample", soft)) ||
    !any(grepl("^!Sample_library_strategy = RNA-Seq$", soft)) ||
    !any(grepl("^!Series_pubmed_id = 38189117$", soft))) {
  stop("GEO no longer documents the reviewed RNA-seq TPM experiment")
}
starts <- grep("^\\^SAMPLE = ", soft)
ends <- c(starts[-1L] - 1L, length(soft))
tag <- function(b, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), b, value = TRUE))
char_value <- function(b, key) {
  x <- tag(b, "!Sample_characteristics_ch1")
  hit <- grep(paste0("^", key, ":"), x, ignore.case = TRUE, value = TRUE)
  if (length(hit) != 1L) stop("missing/duplicate characteristic ", key)
  trimws(sub("^[^:]+:", "", hit))
}
sample_meta <- do.call(rbind, lapply(seq_along(starts), function(i) {
  b <- soft[starts[i]:ends[i]]
  rel <- tag(b, "!Sample_relation")
  biosample <- sub(".*(SAMN[0-9]+).*", "\\1", grep("biosample", rel, ignore.case = TRUE, value = TRUE))
  sra <- sub(".*term=", "", grep("sra\\?term=", rel, ignore.case = TRUE, value = TRUE))
  data.frame(
    geo_accession = sub("^\\^SAMPLE = ", "", b[1L]),
    title = tag(b, "!Sample_title"),
    sample_id = char_value(b, "sampleID"),
    mia = char_value(b, "mia"),
    sex = char_value(b, "Sex"),
    juvenile_challenge = char_value(b, "weaning"),
    biosample = biosample, sra = sra, stringsAsFactors = FALSE
  )
}))
samples <- sample_meta[sample_meta$juvenile_challenge == "Saline", , drop = FALSE]
samples$group <- ifelse(samples$mia == "Control", "control", ifelse(samples$mia == "PRRSV", "case", NA))
samples$sex_code <- ifelse(samples$sex == "Female", "F", ifelse(samples$sex == "Male", "M", NA))
samples$source_column <- paste(ifelse(samples$mia == "Control", "C", "P"),
                               samples$sex_code, "c", sub("^A", "", samples$sample_id), sep = "_")
samples$sample <- paste(samples$group, samples$sex_code, samples$sample_id, sep = "_")
expected_title <- paste(samples$mia, samples$sex, "Saline", samples$sample_id)
if (nrow(samples) != 38L || anyNA(samples[, c("group", "sex_code")]) ||
    sum(samples$group == "control" & samples$sex == "Female") != 9L ||
    sum(samples$group == "control" & samples$sex == "Male") != 12L ||
    sum(samples$group == "case" & samples$sex == "Female") != 6L ||
    sum(samples$group == "case" & samples$sex == "Male") != 11L ||
    !identical(samples$title, expected_title) ||
    anyDuplicated(samples$geo_accession) || anyDuplicated(samples$biosample) ||
    anyDuplicated(samples$sra) || anyDuplicated(samples$source_column)) {
  stop("reviewed 21-control/17-PRRSV saline design changed")
}

d <- data.table::fread(SRC, data.table = FALSE, check.names = FALSE, showProgress = FALSE)
if (!identical(dim(d), c(26673L, 113L)) || names(d)[1L] != "SampleID" ||
    length(setdiff(samples$source_column, names(d)))) {
  stop("official TPM matrix schema/dimensions changed")
}
source_ids <- as.character(d$SampleID)
dup_tab <- sort(table(source_ids)[table(source_ids) > 1L])
if (anyNA(source_ids) || any(!nzchar(source_ids)) ||
    !identical(names(dup_tab), c("1-Mar", "2-Mar")) ||
    !identical(as.integer(dup_tab), c(2L, 2L))) {
  stop("reviewed source-symbol duplication signature changed")
}
M_source <- as.matrix(d[, samples$source_column, drop = FALSE])
storage.mode(M_source) <- "double"; colnames(M_source) <- samples$sample
if (any(!is.finite(M_source)) || any(M_source < 0) ||
    sum(M_source != round(M_source)) == 0L ||
    any(abs(colSums(M_source) - 1e6) > 1)) {
  stop("reviewed nonnegative fractional TPM semantics no longer hold")
}

gene_info_all <- data.table::fread(GENE_INFO, data.table = FALSE, check.names = FALSE, showProgress = FALSE)
taxa <- table(gene_info_all[["#tax_id"]])
if (!identical(dim(gene_info_all), c(54111L, 16L)) ||
    !identical(as.integer(taxa[c("9823", "9825", "309913", "310261")]), c(54048L, 13L, 37L, 13L))) {
  stop("official Sus scrofa gene_info signature changed")
}
gene_info <- gene_info_all[gene_info_all[["#tax_id"]] == 9823L, , drop = FALSE]
symbol_gid_count <- vapply(split(gene_info$GeneID, gene_info$Symbol),
                           function(v) length(unique(v)), integer(1))
valid_official <- names(symbol_gid_count)[symbol_gid_count == 1L &
  grepl("^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._-]*$", names(symbol_gid_count), perl = TRUE)]
promote <- !duplicated(source_ids) & source_ids %in% valid_official
final_labels <- sprintf("__UNMAPPED_SSCR_ROW_%05d", seq_along(source_ids))
final_labels[promote] <- source_ids[promote]
if (sum(promote) != 21820L || anyDuplicated(final_labels)) {
  stop("reviewed pig official-symbol projection changed")
}
map_audit <- data.frame(
  source_row = seq_along(source_ids), source_symbol = source_ids,
  output_label = final_labels,
  mapping_status = ifelse(promote, "mapped_exact_current_NCBI_official_symbol",
                          "reserved_duplicate_or_noncurrent_source_symbol"),
  official_gene_id = gene_info$GeneID[match(source_ids, gene_info$Symbol)],
  stringsAsFactors = FALSE
)
write.table(map_audit, file.path(DS, "metadata", "GSE245146_identifier_mapping.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

M <- log2(M_source + 1)
rownames(M) <- final_labels
out_path <- file.path(DS, "raw", "GSE245146_saline_PRRSV_vs_control_log2tpm.tsv.gz")
out <- data.frame(symbol = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
con <- gzfile(out_path, "w")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$symbol, rownames(M)) ||
    !identical(names(roundtrip)[-1L], samples$sample) ||
    max(abs(as.matrix(roundtrip[-1L]) - M)) > 1e-12) {
  stop("written log2(TPM+1) matrix failed round-trip validation")
}

ss <- samples[, c("sample", "group", "geo_accession", "biosample", "sra",
                  "source_column", "mia", "sex", "juvenile_challenge")]
ss$tissue <- "hypothalamus"; ss$age <- "60 days"
write.table(ss, file.path(DS, "metadata", "GSE245146_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
qc <- data.frame(
  sample = samples$sample, group = samples$group, sex = samples$sex,
  source_rows = nrow(M_source), output_rows = nrow(M),
  mapped_current_official_symbols = sum(promote),
  reserved_source_rows = sum(!promote),
  source_tpm_sum = colSums(M_source),
  source_detected_features = colSums(M_source > 0),
  nonfinite_values = colSums(!is.finite(M_source)),
  negative_values = colSums(M_source < 0),
  fractional_values = colSums(M_source != round(M_source)),
  accepted_input_class = "author-supplied gene-level TPM",
  explicit_transform = "log2(TPM + 1)",
  batch_handling = "sex modeled additively; both sexes represented in both arms",
  shared_route = "input_kind=matrix -> canonical limma",
  stringsAsFactors = FALSE
)
if (any(qc$nonfinite_values != 0) || any(qc$negative_values != 0) ||
    any(qc$fractional_values == 0L) || any(qc$source_detected_features < 10000L)) {
  stop("preprocessing QC failed")
}
write.table(qc, file.path(DS, "processed", "GSE245146_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE245146] wrote %d log2(TPM+1) rows x %d samples; control=%d, PRRSV=%d; %d exact current pig symbols\n",
            nrow(M), ncol(M), sum(samples$group == "control"), sum(samples$group == "case"), sum(promote)))
