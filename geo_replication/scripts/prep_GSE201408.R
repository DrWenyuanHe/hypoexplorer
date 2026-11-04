#!/usr/bin/env Rscript
# Prepare the balanced Iberian-versus-crossbred pig hypothalamus contrast from
# GSE201408. GEO explicitly describes the workbook as normalized expression,
# so its finite nonnegative values are transformed as log2(x + 1) and routed
# through limma. Integer appearance is not used to reinterpret them as counts.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE201408_sscr_hypothalamus_weaning")
SRC <- file.path(DS, "raw", "GSE201408_processed_data.xlsx")
SOFT <- file.path(DS, "metadata", "GSE201408_family.soft.gz")
GENE_INFO <- file.path(DS, "metadata", "Sus_scrofa.gene_info.gz")
if (!requireNamespace("readxl", quietly = TRUE) || !requireNamespace("data.table", quietly = TRUE)) {
  stop("readxl and data.table are required")
}

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}

pins <- data.frame(
  path = c(SRC, SOFT, GENE_INFO),
  bytes = c(2334087, 4040, 1573899),
  sha256 = c(
    "359805b1728f9f4b251d787dcca52db18191557577a1171726e7223a742ed7d3",
    "13524268318b5a20314218de08b8a7945e5292577432899eba9aafc3e274fc35",
    "804d64608ec272bfa70d9029a9098d63346af8f6882f14cddaec5c6c8a41722d"
  ),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE201nnn/GSE201408/suppl/GSE201408_processed_data.xlsx",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE201nnn/GSE201408/soft/GSE201408_family.soft.gz",
    "https://ftp.ncbi.nlm.nih.gov/gene/DATA/GENE_INFO/Mammalia/Sus_scrofa.gene_info.gz"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(pins$path))) stop("required official workbook, SOFT, or pig gene_info is missing")
observed_bytes <- as.numeric(file.info(pins$path)$size)
observed_sha <- unname(vapply(pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, pins$bytes) || !identical(observed_sha, pins$sha256)) {
  stop("source bytes/SHA-256 differ from reviewed inputs")
}

soft <- readLines(gzfile(SOFT), warn = FALSE)
if (!any(grepl("^!Sample_library_strategy = RNA-Seq$", soft)) ||
    !any(grepl("processed_data.xlsx: Processed data file includes normalized expression values for all genes in all 20 samples", soft, fixed = TRUE)) ||
    !any(grepl("HTseq-count software was used to obtain information on number of reads per gene", soft, fixed = TRUE)) ||
    !any(grepl("^!Series_overall_design = In total, 20 hypothalamus samples were analyzed, 5 coming from males and 5 coming from females within each genotype.$", soft))) {
  stop("GEO no longer documents the reviewed RNA-seq matrix scale or balanced design")
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
samples <- do.call(rbind, lapply(seq_along(starts), function(i) {
  b <- soft[starts[i]:ends[i]]
  rel <- tag(b, "!Sample_relation")
  data.frame(
    geo_accession = sub("^\\^SAMPLE = ", "", b[1L]),
    sample = tag(b, "!Sample_description"),
    title = tag(b, "!Sample_title"),
    sex = tolower(char_value(b, "Sex")),
    breed = char_value(b, "breed"),
    tissue = char_value(b, "tissue"),
    age = char_value(b, "age"),
    biosample = sub(".*biosample/", "", rel[grepl("BioSample:", rel, fixed = TRUE)]),
    sra = sub(".*term=", "", rel[grepl("SRA:", rel, fixed = TRUE)]),
    stringsAsFactors = FALSE
  )
}))
samples$group <- ifelse(samples$breed == "Iberian x Large White", "control",
                        ifelse(samples$breed == "Iberian", "case", NA_character_))
expected_balance <- table(samples$group, samples$sex)
if (nrow(samples) != 20L || anyNA(samples$group) ||
    !all(c("control", "case") %in% rownames(expected_balance)) ||
    !all(c("female", "male") %in% colnames(expected_balance)) ||
    any(expected_balance[c("control", "case"), c("female", "male")] != 5L) ||
    any(samples$tissue != "hypothalamus") || any(samples$age != "2 months") ||
    anyDuplicated(samples$sample) || anyDuplicated(samples$geo_accession) ||
    anyDuplicated(samples$biosample) || anyDuplicated(samples$sra)) {
  stop("reviewed balanced 10-crossbred/10-Iberian sample design changed")
}

if (!identical(readxl::excel_sheets(SRC), "heteros_geo")) stop("official workbook sheet structure changed")
d <- as.data.frame(readxl::read_excel(SRC, sheet = "heteros_geo"), check.names = FALSE, stringsAsFactors = FALSE)
expected_columns <- c(
  "gene", "HT011LWH", "HT017IBM", "HT021LWH", "HT027LWM", "HT035IBH",
  "HT040LWM", "HT041IBM", "HT047IBH", "HT056LWH", "HT067IBM", "HT102LWM",
  "HT103LWH", "HT108LWH", "HT109IBH", "HT116IBM", "HT125IBM", "HT130IBH",
  "HT137LWM", "HT153LWM", "HT156IBH"
)
if (!identical(dim(d), c(25885L, 21L)) || !identical(names(d), expected_columns) ||
    !setequal(samples$sample, names(d)[-1L])) {
  stop("official workbook dimensions or sample columns changed")
}
d <- d[, c("gene", samples$sample), drop = FALSE]
ids_all <- as.character(d$gene)
summary_rows <- c("__no_feature", "__ambiguous", "__too_low_aQual", "__not_aligned", "__alignment_not_unique")
if (!identical(tail(ids_all, 5L), summary_rows) || anyDuplicated(ids_all) ||
    sum(grepl("^ENSSSCG[0-9]+(?:[.][0-9]+)?$", ids_all)) != 25880L) {
  stop("reviewed pig Ensembl/HTSeq summary-row signature changed")
}
M_all <- as.matrix(d[-1L]); storage.mode(M_all) <- "double"
if (any(!is.finite(M_all)) || any(M_all < 0) || any(M_all != round(M_all))) {
  stop("official normalized workbook values are no longer finite nonnegative integers")
}

is_gene <- !ids_all %in% summary_rows
ids <- sub("[.].*$", "", ids_all[is_gene])
M_source <- M_all[is_gene, , drop = FALSE]
rownames(M_source) <- ids; colnames(M_source) <- samples$sample
quarantine <- data.frame(
  source_row = which(!is_gene),
  source_id = ids_all[!is_gene],
  reason = "HTSeq library-summary row, not a biological gene feature",
  M_all[!is_gene, , drop = FALSE],
  check.names = FALSE, stringsAsFactors = FALSE
)
qcon <- gzfile(file.path(DS, "metadata", "GSE201408_quarantined_summary_rows.tsv.gz"), "w")
write.table(quarantine, qcon, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
close(qcon)

gene_info_all <- data.table::fread(GENE_INFO, data.table = FALSE, check.names = FALSE, showProgress = FALSE)
taxa <- table(gene_info_all[["#tax_id"]])
if (!identical(dim(gene_info_all), c(54111L, 16L)) ||
    !identical(as.integer(taxa[c("9823", "9825", "309913", "310261")]), c(54048L, 13L, 37L, 13L))) {
  stop("official Sus scrofa gene_info signature changed")
}
gene_info <- gene_info_all[gene_info_all[["#tax_id"]] == 9823L, , drop = FALSE]
has_ens <- grepl("(?:^|\\|)Ensembl:", gene_info$dbXrefs, perl = TRUE)
pairs <- unique(data.frame(
  ensembl = sub(".*(?:^|\\|)Ensembl:([^|]+).*", "\\1", gene_info$dbXrefs[has_ens], perl = TRUE),
  symbol = gene_info$Symbol[has_ens], stringsAsFactors = FALSE
))
ens_count <- table(pairs$ensembl); symbol_count <- table(pairs$symbol)
strict <- pairs[ens_count[pairs$ensembl] == 1L & symbol_count[pairs$symbol] == 1L &
                  grepl("^[A-Za-z0-9][A-Za-z0-9._-]*$", pairs$symbol), , drop = FALSE]
map <- setNames(strict$symbol, strict$ensembl)
mapped <- unname(map[ids])
promote <- !is.na(mapped)
labels <- sprintf("__UNMAPPED_SSCR_ROW_%05d", seq_along(ids))
labels[promote] <- mapped[promote]
if (nrow(strict) != 17438L || sum(promote) != 15629L || anyDuplicated(labels)) {
  stop("reviewed one-to-one pig Ensembl-to-current-symbol mapping changed")
}
mapping <- data.frame(
  source_row = which(is_gene),
  source_ensembl = ids,
  output_label = labels,
  mapping_status = ifelse(promote, "mapped_one_to_one_current_NCBI_official_symbol",
                          "reserved_no_unique_current_NCBI_symbol"),
  stringsAsFactors = FALSE
)
mcon <- gzfile(file.path(DS, "metadata", "GSE201408_identifier_mapping.tsv.gz"), "w")
write.table(mapping, mcon, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
close(mcon)

M <- log2(M_source + 1)
rownames(M) <- labels
out_path <- file.path(DS, "raw", "GSE201408_Iberian_vs_crossbred_log2_normalized.tsv.gz")
out <- data.frame(symbol = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
con <- gzfile(out_path, "w")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$symbol, rownames(M)) ||
    !identical(names(roundtrip)[-1L], samples$sample) ||
    max(abs(as.matrix(roundtrip[-1L]) - M)) > 1e-12) {
  stop("written log2(normalized+1) matrix failed round-trip validation")
}

write.table(samples[, c("sample", "group", "sex", "breed", "geo_accession", "biosample", "sra", "tissue", "age", "title")],
            file.path(DS, "metadata", "GSE201408_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

suppressPackageStartupMessages(library(limma))
samples$sex <- factor(samples$sex)
samples$group <- factor(samples$group, levels = c("control", "case"))
design <- model.matrix(~ sex + group, data = samples)
if (qr(design)$rank != ncol(design)) stop("sex-adjusted design is not full rank")
rv <- apply(M, 1L, var)
keep <- is.finite(rv) & rv > 1e-8
fit <- eBayes(lmFit(M[keep, , drop = FALSE], design))
if (sum(keep) < 5000L || any(!is.finite(fit$t[, "groupcase"]))) stop("normalized-matrix preflight failed")

qc <- data.frame(
  sample = samples$sample,
  group = samples$group,
  sex = samples$sex,
  source_rows = nrow(M_all),
  quarantined_summary_rows = sum(!is_gene),
  output_gene_rows = nrow(M),
  mapped_current_official_symbols = sum(promote),
  reserved_gene_rows = sum(!promote),
  source_value_sum = colSums(M_source),
  source_detected_features = colSums(M_source > 0),
  nonfinite_values = colSums(!is.finite(M_source)),
  negative_values = colSums(M_source < 0),
  fractional_values = colSums(M_source != round(M_source)),
  limma_nonconstant_features = sum(keep),
  accepted_input_class = "author-described normalized gene expression",
  explicit_transform = "log2(author-deposited normalized expression + 1)",
  scale_guard = "integer appearance does not override GEO normalized-expression documentation",
  batch_handling = "sex modeled additively; five female and five male samples in each genotype",
  shared_route = "input_kind=matrix -> canonical limma",
  stringsAsFactors = FALSE
)
write.table(qc, file.path(DS, "processed", "GSE201408_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
manifest <- data.frame(
  file = basename(pins$path), bytes = observed_bytes, sha256 = observed_sha,
  source = pins$url, fetched = "2026-09-01", stringsAsFactors = FALSE
)
write.table(manifest, file.path(DS, "metadata", "GSE201408_source_files.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

cat(sprintf(
  "[GSE201408] wrote %d log2(normalized+1) gene rows x %d pig hypothalami; crossbred=%d, Iberian=%d; %d strict current symbols; %d nonconstant limma features\n",
  nrow(M), ncol(M), sum(samples$group == "control"), sum(samples$group == "case"),
  sum(promote), sum(keep)
))
