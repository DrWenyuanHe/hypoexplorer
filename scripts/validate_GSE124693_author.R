#!/usr/bin/env Rscript

# Fail-closed regression validator for GSE124693 identifier recovery, exact
# normalized-count conservation, and closure against author Table S2D.

suppressPackageStartupMessages(library(readxl))

get_script_dir <- function() {
  args <- commandArgs(FALSE)
  file_arg <- grep("^--file=", args, value = TRUE)
  if (length(file_arg)) return(dirname(normalizePath(sub("^--file=", "", file_arg[1L]))))
  getwd()
}

ROOT <- normalizePath(file.path(get_script_dir(), "..", "geo_replication"))
DS <- file.path(ROOT, "datasets", "GSE124693_mmus_agrp_ribotag_fasting")
SOURCE <- file.path(DS, "raw", "source", "GSE124693_agrp_normalized_counts.txt.gz")
SOFT <- file.path(DS, "metadata", "GSE124693_family.soft.gz")
MATRIX <- file.path(DS, "raw", "GSE124693_agrp_ribotag_ZT14_fast_vs_fed_log2norm.tsv.gz")
LOCAL_DE <- file.path(DS, "processed", "GSE124693_DE.tsv")
QC <- file.path(DS, "processed", "GSE124693_preprocessing_qc.tsv")
FULL_HALLMARK <- file.path(DS, "processed", "GSE124693_FGSEA_HALLMARK.tsv")
FULL_KEGG <- file.path(DS, "processed", "GSE124693_FGSEA_KEGG.tsv")
FULL_GO_BP <- file.path(DS, "processed", "GSE124693_FGSEA_GO_BP.tsv")
FULL_REACTOME <- file.path(DS, "processed", "GSE124693_FGSEA_REACTOME.tsv")
FOCAL_REACTOME <- file.path(DS, "processed", "GSE124693_fgsea.tsv")
FGSEA_PROVENANCE <- file.path(DS, "processed", "GSE124693_FGSEA_provenance.tsv")
FGSEA_GENERATOR <- file.path(get_script_dir(), "run_mouse_fgsea.R")
AUTHOR <- file.path(ROOT, "datasets", "_author_de", "GSE124693_NIHMS1022948_TableS2.xlsx")

required <- c(
  SOURCE, SOFT, MATRIX, LOCAL_DE, QC, FULL_HALLMARK, FULL_KEGG, FULL_GO_BP,
  FULL_REACTOME, FOCAL_REACTOME,
  FGSEA_PROVENANCE, FGSEA_GENERATOR, AUTHOR
)
if (any(!file.exists(required))) stop("GSE124693 validator inputs are incomplete")

sha256_file <- function(path) {
  result <- system2(
    "certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"),
    stdout = TRUE, stderr = TRUE
  )
  result <- trimws(result)
  result <- result[grepl("^[[:xdigit:]]{64}$", result)]
  if (length(result) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(result)
}

pinned <- data.frame(
  path = c(SOURCE, SOFT, AUTHOR),
  bytes = c(6298640, 6714, 1563163),
  sha256 = c(
    "6619f37a0272ac7476fd87204b8703d3853addbf2f49fa9e238cbcdff70606d6",
    "d7b8d447292250ab9e5cc0b4a0f05093741af6127bf194db4e3f34e8f4b941ab",
    "b26852f8f2ed4a3feecce01c351c3bb83443a519a2634bc932704cc7c3bf403d"
  ),
  stringsAsFactors = FALSE
)
observed_bytes <- as.numeric(file.info(pinned$path)$size)
observed_sha256 <- vapply(pinned$path, sha256_file, character(1))
if (!identical(unname(observed_bytes), pinned$bytes) ||
    !identical(unname(observed_sha256), pinned$sha256)) {
  stop("a pinned GSE124693 input no longer matches its authenticated bytes/hash")
}

selected <- c(
  paste0("AGRP.RIBO.SAMPLES.AGRP_RIBO_AL_ZT14_", 1:4),
  paste0("AGRP.RIBO.SAMPLES.AGRP_RIBO_FA_ZT14_", 1:5)
)
analysis_names <- c(
  paste0("AGRP_RIBO_AL_ZT14_", 1:4),
  paste0("AGRP_RIBO_FA_ZT14_", 1:5)
)
source <- read.delim(gzfile(SOURCE), check.names = FALSE, stringsAsFactors = FALSE)
if (nrow(source) != 23337L || ncol(source) != 81L ||
    !all(selected %in% names(source))) {
  stop("deposited normalized-count matrix shape or selected columns changed")
}
source_symbols <- as.character(source[[1L]])
expected_dates <- c(paste0(1:11, "-Mar"), paste0(1:12, "-Sep"), "14-Sep", "15-Sep")
observed_dates <- source_symbols[grepl("^[0-9]{1,2}-(Mar|Sep)$", source_symbols)]
observed_numeric <- source_symbols[grepl("^[0-9]+$", source_symbols)]
if (length(observed_dates) != 25L || !setequal(observed_dates, expected_dates) ||
    !identical(observed_numeric, "100043387")) {
  stop("source identifier corruption set changed")
}

identifier_map <- c(
  setNames(c(paste0("March", 1:11), paste0("Sept", 1:12), "Sept14", "Sep15"), expected_dates),
  "100043387" = "Gm14305"
)
mapped_symbols <- source_symbols
mapped_rows <- match(names(identifier_map), mapped_symbols)
if (anyNA(mapped_rows) || any(unname(identifier_map) %in% mapped_symbols[-mapped_rows])) {
  stop("identifier recovery is missing a source row or would create a collision")
}
mapped_symbols[mapped_rows] <- unname(identifier_map)
if (anyDuplicated(mapped_symbols) || any(grepl("^[0-9]+$|^[0-9]{1,2}-(Mar|Sep)$", mapped_symbols))) {
  stop("independent identifier recovery did not yield unique clean symbols")
}

source_matrix <- as.matrix(source[, selected, drop = FALSE])
storage.mode(source_matrix) <- "double"
colnames(source_matrix) <- analysis_names
expected_matrix <- rowsum(source_matrix, group = source_symbols, reorder = TRUE)
mapped_by_source <- setNames(mapped_symbols, source_symbols)
rownames(expected_matrix) <- unname(mapped_by_source[rownames(expected_matrix)])

analysis <- read.delim(gzfile(MATRIX), check.names = FALSE, stringsAsFactors = FALSE)
if (nrow(analysis) != nrow(source) || !identical(names(analysis)[-1L], analysis_names) ||
    anyDuplicated(analysis[[1L]]) ||
    any(grepl("^[0-9]+$|^[0-9]{1,2}-(Mar|Sep)$", analysis[[1L]]))) {
  stop("analysis matrix violates row, sample-order, uniqueness, or identifier invariants")
}
analysis_matrix <- as.matrix(analysis[, -1L, drop = FALSE])
storage.mode(analysis_matrix) <- "double"
rownames(analysis_matrix) <- analysis[[1L]]
if (!identical(rownames(analysis_matrix), rownames(expected_matrix))) {
  stop("analysis matrix row order/symbols differ from independent recovery")
}
reconstructed <- 2^analysis_matrix - 1
max_reconstruction_delta <- max(abs(reconstructed - expected_matrix))
sum_delta <- colSums(reconstructed) - colSums(source_matrix)
max_log_serialization_delta <- max(abs(analysis_matrix - log2(expected_matrix + 1)))
if (!identical(sort(as.vector(expected_matrix)), sort(as.vector(source_matrix))) ||
    any(colSums(expected_matrix) != colSums(source_matrix)) ||
    max_log_serialization_delta > 1e-12 ||
    max_reconstruction_delta > 2e-8 || any(abs(sum_delta) > 2e-8)) {
  stop("analysis matrix does not conserve every selected normalized count")
}

qc <- read.delim(QC, check.names = FALSE, stringsAsFactors = FALSE)
if (nrow(qc) != 9L || any(qc$source_rows != 23337L) ||
    any(qc$unique_output_symbols != 23337L) ||
    any(qc$duplicate_symbol_rows_collapsed != 0L) ||
    any(qc$excel_date_symbols_recovered != 25L) ||
    any(qc$remaining_excel_date_symbols != 0L) ||
    any(qc$numeric_identifiers_recovered != 1L) ||
    any(qc$remaining_numeric_identifiers != 0L) ||
    any(!qc$count_conserved) || any(abs(qc$count_conservation_delta) > 1e-7)) {
  stop("committed preprocessing QC does not attest exact recovery/conservation")
}

full_reactome <- read.delim(FULL_REACTOME, check.names = FALSE, stringsAsFactors = FALSE)
focal_reactome <- read.delim(FOCAL_REACTOME, check.names = FALSE, stringsAsFactors = FALSE)
full_schema <- c("pathway", "pval", "padj", "NES", "size", "leadingEdge")
focal_schema <- c("pathway", "pval", "padj", "log2err", "ES", "NES", "size", "leadingEdge", "dataset")
if (!identical(names(full_reactome), full_schema) ||
    !identical(names(focal_reactome), focal_schema) ||
    nrow(focal_reactome) != 2L || anyDuplicated(full_reactome$pathway) ||
    anyDuplicated(focal_reactome$pathway) ||
    any(focal_reactome$dataset != "GSE124693")) {
  stop("focused or full Reactome FGSEA schema/identity invariants changed")
}
full_focal_rows <- full_reactome[match(focal_reactome$pathway, full_reactome$pathway), , drop = FALSE]
if (anyNA(full_focal_rows$pathway) || !isTRUE(all.equal(
    focal_reactome[, full_schema], full_focal_rows[, full_schema],
    check.attributes = FALSE, tolerance = 0
))) {
  stop("focused Reactome FGSEA rows do not come from the committed full Reactome run")
}
expected_focal_sizes <- c(
  REACTOME_REGULATION_OF_INSULIN_LIKE_GROWTH_FACTOR_IGF_TRANSPORT_AND_UPTAKE_BY_INSULIN_LIKE_GROWTH_FACTOR_BINDING_PROTEINS_IGFBPS = 113L,
  REACTOME_SIGNALING_BY_TYPE_1_INSULIN_LIKE_GROWTH_FACTOR_1_RECEPTOR_IGF1R = 51L
)
observed_focal_sizes <- setNames(focal_reactome$size, focal_reactome$pathway)
if (nrow(full_reactome) != 1106L ||
    !identical(unname(observed_focal_sizes[names(expected_focal_sizes)]), unname(expected_focal_sizes))) {
  stop("Reactome output has the msigdbr collection-order cache truncation signature")
}

fgsea_provenance <- read.delim(FGSEA_PROVENANCE, check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(names(fgsea_provenance), c("key", "value")) ||
    anyDuplicated(fgsea_provenance$key) || any(!nzchar(fgsea_provenance$value))) {
  stop("FGSEA provenance is missing, duplicated, or malformed")
}
provenance <- setNames(fgsea_provenance$value, fgsea_provenance$key)
expected_provenance <- c(
  schema_version = "3",
  generator = "scripts/run_mouse_fgsea.R",
  generator_sha256 = sha256_file(FGSEA_GENERATOR),
  r_version = "R version 4.6.0 (2026-04-24 ucrt)",
  fgsea_version = "1.38.0",
  msigdbr_version = "26.1.0",
  babelgene_version = "22.9",
  msigdb_authority = "HS",
  msigdb_db_version = "2026.1.Hs",
  target_species = "Mus musculus",
  de_sha256 = sha256_file(LOCAL_DE),
  rank_gene_count = "18611",
  rank_statistic = "DE.stat",
  tie_seed = "42",
  fgsea_seed = "42",
  seed_policy = "tie seed once; FGSEA seed reset before each collection",
  tie_jitter = "runif(0,1e-7) before descending sort",
  ortholog_cache_policy = "clear target-species msigdbr ortholog cache before every collection fetch",
  output_hash_policy = "SHA-256 of exact published TSV bytes",
  min_pathway_size = "15",
  max_pathway_size = "500",
  hallmark_source_collection = "H",
  hallmark_source_subcollection = "(all)",
  hallmark_pathway_count = "50",
  hallmark_membership_sha256 = "0c27a51020925dc3a5569b2d3c6d24408ec075dd406d707e75495941d5c508e2",
  hallmark_result_rows = "50",
  hallmark_result_sha256 = sha256_file(FULL_HALLMARK),
  kegg_source_collection = "C2",
  kegg_source_subcollection = "CP:KEGG_LEGACY",
  kegg_pathway_count = "186",
  kegg_membership_sha256 = "8184e6a4b68735a0363d74c797291398ef9fa73053def71acd6f403813131f3c",
  kegg_result_rows = "170",
  kegg_result_sha256 = sha256_file(FULL_KEGG),
  go_bp_source_collection = "C5",
  go_bp_source_subcollection = "GO:BP",
  go_bp_pathway_count = "7535",
  go_bp_membership_sha256 = "a138fdc43966c89f918ef2ea359f4f96178fdb98ef83911b76e6fe683ad8086b",
  go_bp_result_rows = "3885",
  go_bp_result_sha256 = sha256_file(FULL_GO_BP),
  reactome_source_collection = "C2",
  reactome_source_subcollection = "CP:REACTOME",
  reactome_pathway_count = "1839",
  reactome_membership_sha256 = "e7259e6decd15d955a019d9450af246a5f77176153bbd952e5a6e558f01d20ef",
  reactome_result_rows = "1106",
  reactome_result_sha256 = sha256_file(FULL_REACTOME),
  focal_result_rows = "2",
  focal_result_sha256 = sha256_file(FOCAL_REACTOME)
)
if (!identical(names(provenance), names(expected_provenance)) ||
    !identical(unname(provenance), unname(expected_provenance))) {
  stop("FGSEA provenance no longer closes against its authority, generator, or ranked DE input")
}

author <- as.data.frame(
  read_excel(AUTHOR, sheet = "Table S2D", skip = 3, .name_repair = "minimal"),
  check.names = FALSE
)
author <- author[, c("Gene", "Log2 Fold Change", "P-adj")]
names(author) <- c("symbol", "author_logFC", "author_padj")
author$symbol <- as.character(author$symbol)
author$author_logFC <- as.numeric(author$author_logFC)
author$author_padj <- as.numeric(author$author_padj)
if (nrow(author) != 1950L || anyDuplicated(author$symbol) ||
    any(!is.finite(author$author_logFC)) || any(!is.finite(author$author_padj)) ||
    any(author$author_padj >= 0.05)) {
  stop("official Table S2D is no longer the 1,950-row author-significant result")
}

local <- read.delim(LOCAL_DE, check.names = FALSE, stringsAsFactors = FALSE)
if (nrow(local) != 18611L || anyDuplicated(local$symbol)) {
  stop("local modeled-gene result shape changed")
}
joined <- merge(
  author,
  local[, c("symbol", "logFC", "padj")],
  by = "symbol", all.x = TRUE, sort = FALSE
)
if (nrow(joined) != 1950L || any(!is.finite(joined$logFC)) || any(!is.finite(joined$padj))) {
  stop("not every author-significant gene closes against the repaired local result")
}

pearson <- cor(joined$logFC, joined$author_logFC, method = "pearson")
spearman <- cor(joined$logFC, joined$author_logFC, method = "spearman")
median_abs_delta <- median(abs(joined$logFC - joined$author_logFC))
rmse <- sqrt(mean((joined$logFC - joined$author_logFC)^2))
direction_agreement <- mean(sign(joined$logFC) == sign(joined$author_logFC))
local_fdr <- sum(joined$padj < 0.05)
opposite <- joined[sign(joined$logFC) != sign(joined$author_logFC), ]
expected_opposite <- c("Dlx6as1", "Gm8709", "Gstp2", "H2-Q4", "Kcnv1")
if (pearson < 0.94 || spearman < 0.94 || direction_agreement < 0.995 ||
    local_fdr != 658L || nrow(opposite) != 5L ||
    !setequal(opposite$symbol, expected_opposite) ||
    any(abs(opposite$logFC) >= 0.30) || any(opposite$padj <= 0.80)) {
  stop("author-effect agreement or documented five near-zero reversals regressed")
}

repaired_author_symbols <- c("March5", "March9", "Sept2", "Sep15", "Sept5", "March11")
if (!all(repaired_author_symbols %in% joined$symbol)) {
  stop("the six author-significant Excel-date genes did not close after repair")
}
sept12_row <- match("Sept12", rownames(expected_matrix))
if (is.na(sept12_row) || any(expected_matrix[sept12_row, ] != 0) || "Sept12" %in% local$symbol) {
  stop("the explicitly documented zero-only Sept12 invariant changed")
}

cat(sprintf(
  paste0(
    "[GSE124693] PASS: 23,337/23,337 rows and all 9 normalized-count sums conserved; ",
    "25 Excel-date identifiers + 1 numeric identifier recovered; 0 remain; ",
    "author Table S2D joined 1,950/1,950; Pearson=%.8f, Spearman=%.8f, ",
    "median|delta|=%.8f, RMSE=%.8f, direction=%.8f, local FDR<0.05=%d; ",
    "five reversals are local |logFC|<0.30/q>0.80. Sept12 is explicitly ",
    "nomenclature-backed and all-zero in the selected libraries.\n"
  ),
  pearson, spearman, median_abs_delta, rmse, direction_agreement, local_fdr
))
