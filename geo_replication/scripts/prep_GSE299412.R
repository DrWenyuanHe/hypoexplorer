#!/usr/bin/env Rscript
# Prepare the adult male zebrafish hypothalamus cyp19a1b-mutant contrast from
# the author-supplied gene-level UMI count matrix.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE299412_drer_hypothalamus")
SRC <- file.path(DS, "raw", "GSE299412_data.txt.gz")
SOFT <- file.path(DS, "metadata", "GSE299412_family.soft.gz")
GENE_INFO <- file.path(DS, "metadata", "Danio_rerio.gene_info.gz")
MANIFEST <- file.path(DS, "metadata", "GSE299412_source_files.tsv")
if (!requireNamespace("data.table", quietly = TRUE)) stop("the data.table R package is required")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
if (!file.exists(MANIFEST) ||
    sha256_file(MANIFEST) != "73d0f017a27e69ec09705ff5f0f71d7ae49fd094bdacfd3f7ddf7d262092159e") {
  stop("GSE299412 source manifest is missing or changed")
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
  stop("GSE299412 source bytes/SHA-256 differ from the reviewed manifest")
}

soft <- readLines(gzfile(SOFT), warn = FALSE)
if (!any(grepl("number of unique umis", soft, ignore.case = TRUE)) ||
    !any(grepl("^!Sample_library_strategy = RNA-Seq$", soft)) ||
    !any(grepl("^!Series_pubmed_id = 40853063$", soft)) ||
    !any(grepl("Three zebrafish of the same genotype and sex were pooled", soft, fixed = TRUE))) {
  stop("GEO no longer documents the reviewed pooled UMI-count experiment")
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
  data.frame(
    geo_accession = sub("^\\^SAMPLE = ", "", b[1L]),
    title = tag(b, "!Sample_title"),
    tissue = char_value(b, "tissue"),
    sex = char_value(b, "Sex"),
    genotype = char_value(b, "genotype"),
    stringsAsFactors = FALSE
  )
}))
samples <- sample_meta[sample_meta$tissue == "Hypo" & sample_meta$sex == "male", , drop = FALSE]
samples$group <- ifelse(samples$genotype == "wild-type", "control",
                        ifelse(samples$genotype == "cyp19a1b mutant", "case", NA))
samples$replicate <- sub("^Hypo, male, (wt|ko), ", "", samples$title)
samples$source_column <- paste0("Adult_", gsub(", ", "_", samples$title, fixed = TRUE))
samples$sample <- paste(ifelse(samples$group == "control", "wt", "ko"), samples$replicate, sep = "_")
if (nrow(samples) != 11L || sum(samples$group == "control") != 6L ||
    sum(samples$group == "case") != 5L || anyNA(samples$group) ||
    anyDuplicated(samples$geo_accession) || anyDuplicated(samples$source_column) ||
    anyDuplicated(samples$sample)) {
  stop("reviewed six-WT/five-mutant male hypothalamus design changed")
}

d <- data.table::fread(SRC, data.table = FALSE, check.names = FALSE, showProgress = FALSE)
if (!identical(dim(d), c(15418L, 64L)) ||
    length(setdiff(samples$source_column, names(d)))) {
  stop("official UMI count-matrix schema/dimensions changed")
}
source_symbols <- as.character(d[[1L]])
if (anyNA(source_symbols) || any(!nzchar(source_symbols)) || anyDuplicated(source_symbols)) {
  stop("blank or duplicate zebrafish source symbol")
}
M_source <- as.matrix(d[, samples$source_column, drop = FALSE])
storage.mode(M_source) <- "double"; colnames(M_source) <- samples$sample
if (any(!is.finite(M_source)) || any(M_source < 0) || any(M_source != round(M_source))) {
  stop("reviewed integer UMI-count semantics no longer hold")
}

gene_info <- data.table::fread(GENE_INFO, data.table = FALSE, check.names = FALSE, showProgress = FALSE)
if (!identical(dim(gene_info), c(66792L, 16L)) ||
    !all(gene_info[["#tax_id"]] == 7955L)) {
  stop("official Danio rerio gene_info signature changed")
}
symbol_gid_count <- vapply(split(gene_info$GeneID, gene_info$Symbol),
                           function(v) length(unique(v)), integer(1))
valid_official <- names(symbol_gid_count)[symbol_gid_count == 1L &
  grepl("^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._-]*$", names(symbol_gid_count), perl = TRUE)]
promote <- source_symbols %in% valid_official
final_labels <- sprintf("__UNMAPPED_DRER_ROW_%05d", seq_along(source_symbols))
final_labels[promote] <- source_symbols[promote]
if (sum(promote) != 13170L || sum(!promote) != 2248L || anyDuplicated(final_labels)) {
  stop("reviewed zebrafish official-symbol projection changed")
}
M <- M_source; rownames(M) <- final_labels
map_audit <- data.frame(
  source_symbol = source_symbols, output_label = final_labels,
  mapping_status = ifelse(promote, "mapped_exact_current_NCBI_official_symbol",
                          "reserved_noncurrent_or_ambiguous_source_symbol"),
  official_gene_id = ifelse(promote,
    gene_info$GeneID[match(source_symbols, gene_info$Symbol)], NA_integer_),
  stringsAsFactors = FALSE
)
write.table(map_audit, file.path(DS, "metadata", "GSE299412_identifier_mapping.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

out_path <- file.path(DS, "raw", "GSE299412_male_hypothalamus_cyp19a1b_mutant_counts.tsv.gz")
out <- data.frame(symbol = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
con <- gzfile(out_path, "w")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$symbol, rownames(M)) ||
    !identical(names(roundtrip)[-1L], samples$sample) ||
    any(as.matrix(roundtrip[-1L]) != M)) {
  stop("written zebrafish UMI count matrix failed exact round-trip validation")
}

ss <- samples[, c("sample", "group", "geo_accession", "source_column",
                  "genotype", "sex", "tissue", "replicate")]
ss$biological_unit <- "pool of three zebrafish"
ss$developmental_stage <- "adult"
write.table(ss, file.path(DS, "metadata", "GSE299412_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
qc <- data.frame(
  sample = samples$sample, group = samples$group,
  source_rows = nrow(M_source), output_rows = nrow(M),
  mapped_current_official_symbols = sum(promote),
  reserved_source_rows = sum(!promote),
  library_size = colSums(M), detected_features = colSums(M > 0),
  nonfinite_values = colSums(!is.finite(M_source)),
  negative_values = colSums(M_source < 0),
  fractional_values = colSums(M_source != round(M_source)),
  accepted_input_class = "gene-level UMI counts",
  shared_route = "input_kind=counts -> canonical edgeR-QL",
  stringsAsFactors = FALSE
)
if (any(qc$nonfinite_values != 0) || any(qc$negative_values != 0) ||
    any(qc$fractional_values != 0) || any(qc$library_size < 1e5) ||
    any(qc$detected_features < 8000L)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE299412_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE299412] wrote %d UMI-count rows x %d male hypothalamus pools; WT=6, mutant=5; %d exact current zebrafish symbols\n",
            nrow(M), ncol(M), sum(promote)))
