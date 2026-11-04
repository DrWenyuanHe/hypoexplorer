#!/usr/bin/env Rscript

# Regression validator for the corrected GSE252779 integer-count adapter and
# its reconciled author DESeq2 result sheet.

suppressPackageStartupMessages(library(data.table))
suppressPackageStartupMessages(library(readxl))
suppressPackageStartupMessages(library(DESeq2))

script_flag <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
if (length(script_flag) != 1L) stop("cannot resolve validator script path")
script_path <- normalizePath(sub("^--file=", "", script_flag), winslash = "/")
root <- normalizePath(file.path(dirname(script_path), ".."), winslash = "/")
dataset <- file.path(
  root,
  "geo_replication", "datasets", "GSE252779_mmus_hypo_celastrol"
)
workbook_path <- file.path(dataset, "raw", "GSE252779_Gene-count.xlsx")
author_path <- file.path(dataset, "raw", "GSE252779_Expression_data.xlsx")
soft_path <- file.path(dataset, "metadata", "GSE252779_family.soft.gz")
manifest_path <- file.path(dataset, "metadata", "GSE252779_source_files.tsv")
counts_path <- file.path(dataset, "raw", "GSE252779_hypo_CS_vs_Veh_counts.tsv.gz")
samplesheet_path <- file.path(dataset, "metadata", "GSE252779_samplesheet.tsv")
qc_path <- file.path(dataset, "processed", "GSE252779_preprocessing_qc.tsv")
de_path <- file.path(dataset, "processed", "GSE252779_DE.tsv")
se_path <- file.path(dataset, "processed", "GSE252779_SE.tsv")
public_dir <- file.path(root, "public", "datasets", "mouse_hypo_celastrol_gse252779")
public_meta_path <- file.path(public_dir, "meta.js")
public_track_path <- file.path(public_dir, "track_hypothalamus.js")
prep_script <- file.path(root, "scripts", "prep_GSE252779.R")

required <- c(
  workbook_path, author_path, soft_path, manifest_path, counts_path,
  samplesheet_path, qc_path, de_path, se_path, public_meta_path,
  public_track_path, prep_script
)
if (any(!file.exists(required))) {
  stop("GSE252779 validator inputs are incomplete")
}
if (!requireNamespace("openssl", quietly = TRUE)) {
  stop("the openssl R package is required to authenticate GSE252779 sources")
}

sha256_file <- function(path) {
  connection <- file(path, "rb")
  tryCatch(
    unclass(as.character(openssl::sha256(connection))),
    finally = close(connection)
  )
}
read_raw <- function(path) {
  connection <- file(path, "rb")
  tryCatch(
    readBin(connection, what = "raw", n = file.info(path)$size),
    finally = close(connection)
  )
}
read_gzip_raw <- function(path) {
  connection <- gzfile(path, "rb")
  tryCatch(
    readBin(connection, what = "raw", n = 100000000L),
    finally = close(connection)
  )
}

manifest <- fread(manifest_path, check.names = FALSE)
expected_sources <- data.table(
  file = c("GSE252779_Gene-count.xlsx", "GSE252779_Expression_data.xlsx"),
  bytes = c(5516076, 8806518),
  sha256 = c(
    "b4f3566c8f83f1f7e606604d5424dccfcd2568fa8fd9fc5bed4470b11dc46c3c",
    "a743d81d37391d0b889c9569779d5cf6feee0f69299caa537f9072fdf5b51575"
  )
)
for (index in seq_len(nrow(expected_sources))) {
  expected <- expected_sources[index]
  path <- file.path(dataset, "raw", expected$file)
  row <- manifest[file == expected$file]
  if (nrow(row) != 1L || row$bytes != expected$bytes ||
      row$sha256 != expected$sha256 ||
      file.info(path)$size != expected$bytes ||
      sha256_file(path) != expected$sha256) {
    stop(sprintf("%s fails pinned manifest authentication", expected$file))
  }
}

registry <- fread(file.path(root, "geo_replication", "config", "datasets.tsv"))
registered <- registry[id == "GSE252779"]
if (nrow(registered) != 1L || registered$input_kind != "counts" ||
    registered$id_col != "Gene_ID" ||
    registered$input_path != paste0(
      "datasets/GSE252779_mmus_hypo_celastrol/raw/",
      "GSE252779_hypo_CS_vs_Veh_counts.tsv.gz"
    ) ||
    registered$samplesheet != paste0(
      "datasets/GSE252779_mmus_hypo_celastrol/metadata/",
      "GSE252779_samplesheet.tsv"
    )) {
  stop("GSE252779 registry route no longer targets the corrected count adapter")
}

# Re-run the adapter into an isolated tree and compare every decompressed/text
# byte to the registered artifacts. Gzip container bytes are intentionally not
# compared because compressor metadata may differ. The function scope is
# intentional: top-level on.exit() does not reliably clean up on Windows.
validate_prep_reproduction <- function() {
temporary_root <- tempfile("GSE252779-validation-")
dir.create(file.path(temporary_root, "raw"), recursive = TRUE)
dir.create(file.path(temporary_root, "metadata"), recursive = TRUE)
dir.create(file.path(temporary_root, "processed"), recursive = TRUE)
on.exit(unlink(temporary_root, recursive = TRUE, force = TRUE), add = TRUE)
temporary_counts <- file.path(temporary_root, "raw", basename(counts_path))
temporary_samples <- file.path(temporary_root, "metadata", basename(samplesheet_path))
temporary_qc <- file.path(temporary_root, "processed", basename(qc_path))
rscript <- file.path(R.home("bin"), "Rscript.exe")
if (!file.exists(rscript)) rscript <- file.path(R.home("bin"), "Rscript")
prep_output <- system2(
  rscript,
  shQuote(c(
    prep_script, workbook_path, soft_path,
    temporary_counts, temporary_samples, temporary_qc
  )),
  stdout = TRUE,
  stderr = TRUE
)
prep_status <- attr(prep_output, "status")
if (!is.null(prep_status) && prep_status != 0L) {
  stop(paste(c("isolated GSE252779 prep failed", prep_output), collapse = "\n"))
}
if (!identical(read_gzip_raw(temporary_counts), read_gzip_raw(counts_path)) ||
    !identical(read_raw(temporary_samples), read_raw(samplesheet_path)) ||
    !identical(read_raw(temporary_qc), read_raw(qc_path))) {
  stop("isolated prep does not reproduce registered decompressed/text outputs")
}
temporary_leftovers <- list.files(
  temporary_root,
  pattern = "^GSE252779-(counts|samples|qc)-",
  recursive = TRUE,
  full.names = TRUE
)
if (length(temporary_leftovers)) {
  stop("isolated prep left temporary installation files behind")
}
}
validate_prep_reproduction()

samples <- fread(samplesheet_path)
qc <- fread(qc_path)
counts <- fread(counts_path)
expected_samples <- c(paste0("Hypo-Veh-", 1:4), paste0("Hypo-CS-", 1:4))
if (nrow(samples) != 8L ||
    !identical(samples$sample, expected_samples) ||
    !identical(samples$group, rep(c("control", "case"), each = 4L)) ||
    !identical(names(counts), c("Gene_ID", expected_samples)) ||
    !identical(qc$sample, expected_samples) ||
    any(qc$conservation_delta != 0) || any(qc$integral_fraction != 1)) {
  stop("registered cohort, count columns, or preprocessing QC changed")
}
count_matrix <- as.matrix(counts[, -1L])
storage.mode(count_matrix) <- "double"
expected_totals <- c(
  7597173, 9291704, 12880459, 9817703,
  8109525, 8326479, 10458750, 11567422
)
recovered_ids <- c(
  "Marc1", "Marc2", paste0("March", 1:11), paste0("Sept", 1:12),
  "Sept14", "Sep15"
)
if (nrow(counts) != 24047L || anyDuplicated(counts$Gene_ID) ||
    any(grepl("^[0-9]+$", counts$Gene_ID)) ||
    !all(recovered_ids %in% counts$Gene_ID) ||
    any(as.numeric(unlist(
      counts[Gene_ID == "Sept12", ..expected_samples],
      use.names = FALSE
    )) != 0) ||
    !identical(as.numeric(colSums(count_matrix)), expected_totals) ||
    !identical(as.numeric(qc$output_count_sum), expected_totals) ||
    !identical(
      as.integer(qc$detected_genes),
      c(17561L, 17721L, 17853L, 17739L, 17508L, 17490L, 17790L, 17961L)
    )) {
  stop("registered count identifiers, dimensions, or QC invariants changed")
}

expected_author_sheets <- c(
  "Veh_v_CS.deseq", "PF_v_Veh.deseq", "PF_v_CS.deseq",
  "PF_v_PF+CS.deseq", "PF+CS_v_Veh.deseq"
)
if (!identical(excel_sheets(author_path), expected_author_sheets)) {
  stop("GSE252779 author-result workbook sheet names or order changed")
}
expected_author_columns <- c(
  "id", "baseMean", "log2FoldChange", "lfcSE", "stat", "pvalue", "padj"
)
author_results <- lapply(expected_author_sheets, function(sheet) {
  result <- as.data.table(read_excel(
    author_path,
    sheet = sheet,
    col_types = "text",
    .name_repair = "minimal"
  ))
  if (!identical(names(result), expected_author_columns) ||
      anyDuplicated(result$id)) {
    stop(sprintf("author-result sheet %s changed schema or gene keys", sheet))
  }
  result
})
names(author_results) <- expected_author_sheets
author <- copy(author_results[["PF_v_Veh.deseq"]])
if (any(vapply(
  author_results,
  function(result) "Sept12" %in% result$id,
  logical(1)
))) {
  stop("all-zero Sept12 unexpectedly entered an author result sheet")
}

# Reproduce the independent evidence used to separate the duplicated Excel
# dates. The author sheets are systematically shifted relative to their labels;
# these are the five deposited count contrasts in workbook order.
source <- as.data.table(read_excel(
  workbook_path,
  sheet = "STRA-gee-count",
  col_types = c("text", rep("numeric", 16L)),
  .name_repair = "minimal"
))
source_ids <- source$Gene_ID
source_matrix <- as.matrix(source[, -1L])
storage.mode(source_matrix) <- "integer"
rownames(source_matrix) <- paste0("source_row_", seq_len(nrow(source_matrix)))
source_group <- factor(
  rep(c("Veh", "PF", "CS", "PFCS"), each = 4L),
  levels = c("Veh", "PF", "CS", "PFCS")
)
source_design <- data.frame(group = source_group, row.names = colnames(source_matrix))
dds <- DESeqDataSetFromMatrix(source_matrix, source_design, ~ group)
dds <- DESeq(dds, quiet = TRUE)
contrast_numerator <- c("PF", "CS", "CS", "PFCS", "PFCS")
contrast_denominator <- c("Veh", "Veh", "PF", "CS", "Veh")
local_effects <- sapply(seq_along(expected_author_sheets), function(index) {
  as.numeric(results(
    dds,
    contrast = c(
      "group", contrast_numerator[[index]], contrast_denominator[[index]]
    )
  )$log2FoldChange)
})
duplicate_rows <- c(which(source_ids == "44986"), which(source_ids == "44987"))
duplicate_symbols <- c("Marc1", "March1", "Marc2", "March2")
wrong_symbols <- c("March1", "Marc1", "March2", "Marc2")
if (!identical(duplicate_rows + 1L, c(281L, 10860L, 3756L, 20571L))) {
  stop("duplicated Excel-date rows moved")
}
effect_correlations <- vapply(seq_along(duplicate_rows), function(index) {
  author_effect <- vapply(author_results, function(result) {
    as.numeric(result$log2FoldChange[
      match(duplicate_symbols[[index]], result$id)
    ])
  }, numeric(1))
  cor(local_effects[duplicate_rows[[index]], ], author_effect)
}, numeric(1))
wrong_correlations <- vapply(seq_along(duplicate_rows), function(index) {
  author_effect <- vapply(author_results, function(result) {
    as.numeric(result$log2FoldChange[
      match(wrong_symbols[[index]], result$id)
    ])
  }, numeric(1))
  cor(local_effects[duplicate_rows[[index]], ], author_effect)
}, numeric(1))
if (any(effect_correlations < 0.997) ||
    any(effect_correlations - wrong_correlations < c(0.20, 0.20, 0.05, 0.05))) {
  stop("multi-contrast author effects no longer resolve duplicate date serials")
}

source_means <- rowMeans(source_matrix)
base_mean_ratio <- function(serial, low_symbol, high_symbol) {
  rows <- which(source_ids == serial)
  low_author <- vapply(author_results, function(result) {
    as.numeric(result$baseMean[match(low_symbol, result$id)])
  }, numeric(1))
  high_author <- vapply(author_results, function(result) {
    as.numeric(result$baseMean[match(high_symbol, result$id)])
  }, numeric(1))
  assigned <- sum((source_means[rows[[1L]]] - low_author)^2) +
    sum((source_means[rows[[2L]]] - high_author)^2)
  swapped <- sum((source_means[rows[[1L]]] - high_author)^2) +
    sum((source_means[rows[[2L]]] - low_author)^2)
  swapped / assigned
}
base_mean_ratios <- c(
  base_mean_ratio("44986", "Marc1", "March1"),
  base_mean_ratio("44987", "Marc2", "March2")
)
if (base_mean_ratios[[1L]] < 800 || base_mean_ratios[[2L]] < 80) {
  stop("author baseMean separation no longer supports duplicate-date repair")
}

# Sept12 is all-zero and therefore absent from author DE; its source display
# (12-Sep) is independently supported by the pinned MGI-backed nomenclature.
nomenclature <- fread(file.path(root, "data", "nomenclature", "nomenclature.tsv"))
sept12 <- nomenclature[
  symbol == "Septin12" & authority == "MGI" & authority_id == "MGI:1918339"
]
if (nrow(sept12) != 1L || sept12$current_symbol != "Septin12" ||
    !"Sept12" %in% strsplit(sept12$previous_symbols, "\\|", fixed = FALSE)[[1L]]) {
  stop("MGI-backed Sept12 alias evidence changed")
}
author[, author_padj := suppressWarnings(as.numeric(padj))]

# A pairwise DESeq2 refit on the exact deposited vehicle/CS cohort reproduces
# the author's shifted PF_v_Veh result sheet at the method level. This is kept
# separate from the registered edgeR analysis below.
pairwise_matrix <- count_matrix
storage.mode(pairwise_matrix) <- "integer"
rownames(pairwise_matrix) <- counts$Gene_ID
pairwise_group <- factor(
  rep(c("Veh", "CS"), each = 4L),
  levels = c("Veh", "CS")
)
pairwise_design <- data.frame(
  group = pairwise_group,
  row.names = colnames(pairwise_matrix)
)
pairwise_dds <- DESeqDataSetFromMatrix(pairwise_matrix, pairwise_design, ~ group)
pairwise_dds <- DESeq(pairwise_dds, quiet = TRUE)
pairwise_result <- as.data.table(as.data.frame(results(
  pairwise_dds,
  contrast = c("group", "CS", "Veh")
)), keep.rownames = "id")
pairwise_joined <- merge(
  pairwise_result[, .(
    id,
    local_baseMean = as.numeric(baseMean),
    local_logFC = as.numeric(log2FoldChange),
    local_padj = as.numeric(padj)
  )],
  author[, .(
    id,
    author_baseMean = as.numeric(baseMean),
    author_logFC = as.numeric(log2FoldChange),
    author_padj
  )],
  by = "id",
  all = FALSE,
  sort = FALSE
)
pairwise_author_significant <- pairwise_joined[
  !is.na(author_padj) & author_padj < 0.05
]
pairwise_local_significant <- pairwise_joined[
  !is.na(local_padj) & local_padj < 0.05
]
pairwise_both_significant <- pairwise_joined[
  !is.na(author_padj) & author_padj < 0.05 &
    !is.na(local_padj) & local_padj < 0.05
]
pairwise_union_significant <- pairwise_joined[
  (!is.na(author_padj) & author_padj < 0.05) |
    (!is.na(local_padj) & local_padj < 0.05)
]
pairwise_base_mean_cor <- cor(
  pairwise_joined$local_baseMean,
  pairwise_joined$author_baseMean
)
pairwise_jaccard <- nrow(pairwise_both_significant) /
  nrow(pairwise_union_significant)
if (nrow(pairwise_joined) != 19661L || pairwise_base_mean_cor < 0.999999999 ||
    nrow(pairwise_author_significant) != 298L ||
    nrow(pairwise_local_significant) != 304L ||
    nrow(pairwise_both_significant) != 287L ||
    abs(pairwise_jaccard - 0.911111111111) > 5e-10 ||
    mean(
      sign(pairwise_both_significant$local_logFC) ==
        sign(pairwise_both_significant$author_logFC)
    ) != 1) {
  stop("pairwise DESeq2 no longer reproduces the deposited author result")
}
mine <- fread(de_path)
se <- fread(se_path)
public_meta <- paste(readLines(public_meta_path, warn = FALSE), collapse = "\n")
public_track <- paste(readLines(public_track_path, warn = FALSE), collapse = "\n")
public_gene_hits <- gregexpr('"gene":', public_track, fixed = TRUE)[[1L]]
public_gene_count <- if (identical(public_gene_hits, -1L)) 0L else length(public_gene_hits)
if (nrow(mine) != 14533L || anyDuplicated(mine$id) ||
    any(grepl("^[0-9]+$", mine$id)) ||
    !identical(names(se), c("id", "se")) ||
    nrow(se) != nrow(mine) || anyDuplicated(se$id) ||
    !setequal(se$id, mine$id) ||
    public_gene_count != nrow(mine) ||
    !grepl('"nGenes":\\{"hypothalamus":14533\\}', public_meta) ||
    grepl('"gene":"[0-9]+"', public_track)) {
  stop("DE, SE, and public bundle identifier closure changed")
}
joined <- merge(
  mine[, .(
    id,
    local_logFC = as.numeric(logFC),
    local_padj = as.numeric(padj)
  )],
  author[, .(
    id,
    author_logFC = as.numeric(log2FoldChange),
    author_padj
  )],
  by = "id",
  all = FALSE,
  sort = FALSE
)
author_significant <- joined[!is.na(author_padj) & author_padj < 0.05]
local_significant <- joined[!is.na(local_padj) & local_padj < 0.05]
both_significant <- joined[
  !is.na(author_padj) & author_padj < 0.05 &
    !is.na(local_padj) & local_padj < 0.05
]
union_significant <- joined[
  (!is.na(author_padj) & author_padj < 0.05) |
    (!is.na(local_padj) & local_padj < 0.05)
]
pearson <- cor(joined$local_logFC, joined$author_logFC)
spearman <- cor(joined$local_logFC, joined$author_logFC, method = "spearman")
median_delta <- median(abs(joined$local_logFC - joined$author_logFC))
author_direction <- mean(
  sign(author_significant$local_logFC) == sign(author_significant$author_logFC)
)
jaccard <- nrow(both_significant) / nrow(union_significant)
if (nrow(joined) != 14533L ||
    abs(pearson - 0.795014640961) > 5e-10 ||
    abs(spearman - 0.941955938091) > 5e-10 ||
    abs(median_delta - 0.021575031858) > 5e-10 ||
    nrow(author_significant) != 298L ||
    nrow(local_significant) != 93L ||
    nrow(both_significant) != 83L ||
    abs(jaccard - 0.26948052) > 5e-9 ||
    author_direction != 1) {
  stop("corrected local DE no longer reproduces the matching author result sheet")
}

decompressed_hash <- unclass(as.character(openssl::sha256(
  read_gzip_raw(counts_path)
)))
cat(sprintf(
  paste0(
    "validated GSE252779: prep output identical; 24047 unique source genes; vehicle=4 ",
    "celastrol=4; decompressed counts sha256=%s; author PF_v_Veh.deseq ",
    "shared=14533 Pearson=%.8f Spearman=%.8f FDR=298/93/83 Jaccard=%.8f; ",
    "duplicate-map r=%.8f/%.8f/%.8f/%.8f baseMean-ratio=%.2f/%.2f\n"
  ),
  decompressed_hash, pearson, spearman, jaccard,
  effect_correlations[[1L]], effect_correlations[[2L]],
  effect_correlations[[3L]], effect_correlations[[4L]],
  base_mean_ratios[[1L]], base_mean_ratios[[2L]]
))
cat(sprintf(
  paste0(
    "method-matched DESeq2: shared=19661 baseMean Pearson=%.12f ",
    "FDR=298/304/287 Jaccard=%.8f direction=100%%\n"
  ),
  pairwise_base_mean_cor, pairwise_jaccard
))
