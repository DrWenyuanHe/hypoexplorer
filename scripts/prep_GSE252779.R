#!/usr/bin/env Rscript

# Deterministically extract the registered GSE252779 vehicle-versus-celastrol
# count matrix from the authenticated integer sheet. Every source assumption is
# asserted before any output is installed.

suppressPackageStartupMessages(library(data.table))
suppressPackageStartupMessages(library(readxl))

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 5L) {
  stop(paste0(
    "usage: prep_GSE252779.R <GSE252779_Gene-count.xlsx> <GSE252779_family.soft.gz> ",
    "<counts.tsv.gz> <samplesheet.tsv> <preprocessing_qc.tsv>"
  ))
}

workbook_path <- normalizePath(args[[1L]], mustWork = TRUE)
soft_path <- normalizePath(args[[2L]], mustWork = TRUE)
author_path <- file.path(dirname(workbook_path), "GSE252779_Expression_data.xlsx")
counts_path <- args[[3L]]
samplesheet_path <- args[[4L]]
qc_path <- args[[5L]]
manifest_path <- file.path(dirname(soft_path), "GSE252779_source_files.tsv")

if (basename(workbook_path) != "GSE252779_Gene-count.xlsx" ||
    basename(soft_path) != "GSE252779_family.soft.gz" ||
    !file.exists(author_path) ||
    !file.exists(manifest_path)) {
  stop("unexpected or incomplete pinned GSE252779 source paths")
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

expected_workbook_size <- 5516076
expected_workbook_sha256 <-
  "b4f3566c8f83f1f7e606604d5424dccfcd2568fa8fd9fc5bed4470b11dc46c3c"
expected_workbook_url <- paste0(
  "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE252nnn/GSE252779/suppl/",
  "GSE252779_Gene-count.xlsx"
)
expected_author_size <- 8806518
expected_author_sha256 <-
  "a743d81d37391d0b889c9569779d5cf6feee0f69299caa537f9072fdf5b51575"
expected_author_url <- paste0(
  "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE252nnn/GSE252779/suppl/",
  "GSE252779_Expression_data.xlsx"
)
expected_soft_size <- 3670
expected_soft_sha256 <-
  "6a3ae53327dfe22e3dfcbf4a89eaffb1dbb03bb04668c98944b487a184c34fee"

manifest <- fread(manifest_path, check.names = FALSE)
if (!identical(
  names(manifest),
  c("file", "bytes", "sha256", "source", "fetched")
)) {
  stop("GSE252779 source manifest schema changed")
}
workbook_manifest <- manifest[file == basename(workbook_path)]
author_manifest <- manifest[file == basename(author_path)]
soft_manifest <- manifest[file == basename(soft_path)]
if (nrow(workbook_manifest) != 1L ||
    workbook_manifest$bytes != expected_workbook_size ||
    workbook_manifest$sha256 != expected_workbook_sha256 ||
    workbook_manifest$source != expected_workbook_url ||
    file.info(workbook_path)$size != expected_workbook_size ||
    sha256_file(workbook_path) != expected_workbook_sha256) {
  stop("GSE252779 Gene-count workbook fails its pinned size/hash/URL manifest")
}
if (nrow(author_manifest) != 1L ||
    author_manifest$bytes != expected_author_size ||
    author_manifest$sha256 != expected_author_sha256 ||
    author_manifest$source != expected_author_url ||
    file.info(author_path)$size != expected_author_size ||
    sha256_file(author_path) != expected_author_sha256) {
  stop("GSE252779 author-result workbook fails its pinned size/hash/URL manifest")
}
if (nrow(soft_manifest) != 1L ||
    soft_manifest$bytes != expected_soft_size ||
    soft_manifest$sha256 != expected_soft_sha256 ||
    file.info(soft_path)$size != expected_soft_size ||
    sha256_file(soft_path) != expected_soft_sha256) {
  stop("GSE252779 family SOFT fails its pinned size/hash manifest")
}

expected_sheets <- c("Cuff-gene-count", "STRA-gee-count")
if (!identical(excel_sheets(workbook_path), expected_sheets)) {
  stop("GSE252779 Gene-count workbook sheet names or order changed")
}
expected_columns <- c(
  "Gene_ID",
  paste0("Hypo-Veh-", 1:4),
  paste0("Hypo-PF-", 1:4),
  paste0("Hypo-CS-", 1:4),
  paste0("Hypo-PF/CS-", 1:4)
)
source <- as.data.table(read_excel(
  workbook_path,
  sheet = "STRA-gee-count",
  col_types = c("text", rep("numeric", 16L)),
  .name_repair = "minimal"
))
if (nrow(source) != 24047L ||
    !identical(names(source), expected_columns) ||
    anyNA(source$Gene_ID) || any(!nzchar(source$Gene_ID))) {
  stop("STRA-gee-count dimensions, columns, or gene identifiers changed")
}

all_sample_columns <- expected_columns[-1L]
source_counts <- as.matrix(source[, ..all_sample_columns])
storage.mode(source_counts) <- "double"
if (any(!is.finite(source_counts)) || any(source_counts < 0) ||
    any(source_counts != round(source_counts))) {
  stop("STRA-gee-count is not finite nonnegative integer counts")
}
expected_source_totals <- c(
  7597173, 9291704, 12880459, 9817703,
  6008564, 9205631, 6710037, 10899099,
  8109525, 8326479, 10458750, 11567422,
  9470447, 8823282, 11116425, 7862917
)
names(expected_source_totals) <- all_sample_columns
if (!identical(
  as.numeric(colSums(source_counts)),
  as.numeric(expected_source_totals)
)) {
  stop("STRA-gee-count library totals changed")
}

# Excel converted 27 historical mouse symbols into date cells. Recover them
# before any uniqueness check; summing the duplicate 1-Mar/2-Mar serials would
# merge Marc1 with March1 and Marc2 with March2. Excel rows include the header.
date_repairs <- data.table(
  excel_row = c(
    281L, 1120L, 1958L, 2103L, 3756L, 4233L, 4272L, 5760L, 5848L,
    5932L, 6414L, 6697L, 7351L, 9767L, 10638L, 10860L, 11175L,
    11480L, 14281L, 15996L, 17642L, 19740L, 20571L, 20572L,
    20959L, 21314L, 23670L
  ),
  serial = c(
    "44986", "45172", "45181", "45174", "44987", "45175", "44993",
    "45173", "44989", "44991", "45177", "45171", "45178", "44996",
    "45183", "44986", "45184", "44992", "45180", "44990", "45170",
    "44995", "44987", "45176", "44988", "44994", "45179"
  ),
  repaired_id = c(
    "Marc1", "Sept3", "Sept12", "Sept5", "Marc2", "Sept6", "March8",
    "Sept4", "March4", "March6", "Sept8", "Sept2", "Sept9", "March11",
    "Sept14", "March1", "Sep15", "March7", "Sept11", "March5", "Sept1",
    "March10", "March2", "Sept7", "March3", "March9", "Sept10"
  )
)
date_rows <- which(grepl("^[0-9]+$", source$Gene_ID))
expected_date_rows <- date_repairs$excel_row - 1L
if (!identical(date_rows, expected_date_rows) ||
    !identical(source$Gene_ID[date_rows], date_repairs$serial)) {
  stop("STRA-gee-count date-coerced identifier cells changed")
}

# The author workbook independently restores every nonzero damaged symbol.
# Its five baseMean columns distinguish both duplicated Excel serials by wide
# margins, so the row-level assignment is evidence-based rather than guessed.
expected_author_sheets <- c(
  "Veh_v_CS.deseq", "PF_v_Veh.deseq", "PF_v_CS.deseq",
  "PF_v_PF+CS.deseq", "PF+CS_v_Veh.deseq"
)
if (!identical(excel_sheets(author_path), expected_author_sheets)) {
  stop("GSE252779 author-result workbook sheet names or order changed")
}
author_base_means <- lapply(expected_author_sheets, function(sheet) {
  author <- as.data.table(read_excel(
    author_path, sheet = sheet, col_types = "text", .name_repair = "minimal"
  ))
  if (!identical(
    names(author),
    c("id", "baseMean", "log2FoldChange", "lfcSE", "stat", "pvalue", "padj")
  ) || anyDuplicated(author$id)) {
    stop(sprintf("author result sheet %s changed schema or gene keys", sheet))
  }
  author
})
names(author_base_means) <- expected_author_sheets
author_recovered_ids <- setdiff(date_repairs$repaired_id, "Sept12")
if (!all(vapply(
  author_recovered_ids,
  function(identifier) any(vapply(
    author_base_means,
    function(author) identifier %in% author$id,
    logical(1)
  )),
  logical(1)
)) || any(vapply(
  author_base_means,
  function(author) "Sept12" %in% author$id,
  logical(1)
))) {
  stop("author workbook no longer supports the date-cell recovery map")
}
source_row_means <- rowMeans(source_counts)
assignment_ratio <- function(serial, low_id, high_id) {
  rows <- which(source$Gene_ID == serial)
  if (length(rows) != 2L || source_row_means[rows[[1L]]] >= source_row_means[rows[[2L]]]) {
    stop(sprintf("unexpected source-row ordering for duplicated serial %s", serial))
  }
  low_author <- vapply(
    author_base_means,
    function(author) as.numeric(author$baseMean[match(low_id, author$id)]),
    numeric(1)
  )
  high_author <- vapply(
    author_base_means,
    function(author) as.numeric(author$baseMean[match(high_id, author$id)]),
    numeric(1)
  )
  assigned <- sum((source_row_means[rows[[1L]]] - low_author)^2) +
    sum((source_row_means[rows[[2L]]] - high_author)^2)
  swapped <- sum((source_row_means[rows[[1L]]] - high_author)^2) +
    sum((source_row_means[rows[[2L]]] - low_author)^2)
  swapped / assigned
}
if (assignment_ratio("44986", "Marc1", "March1") < 800 ||
    assignment_ratio("44987", "Marc2", "March2") < 80) {
  stop("author baseMean evidence no longer resolves duplicated date serials")
}

source[date_rows, Gene_ID := date_repairs$repaired_id]
if (nrow(source) != 24047L || anyDuplicated(source$Gene_ID) ||
    any(grepl("^[0-9]+$", source$Gene_ID)) ||
    source$Gene_ID[[1L]] != "1700001K19Rik" ||
    source$Gene_ID[[nrow(source)]] != "Olfr272" ||
    !identical(
      as.numeric(colSums(as.matrix(source[, ..all_sample_columns]))),
      as.numeric(expected_source_totals)
    )) {
  stop("recovered STRA identifiers are not unique or counts were not conserved")
}

# Cross-check the selected count columns against the official GEO sample
# titles and treatments. PF and PF/CS are deliberately not selected.
soft <- readLines(gzfile(soft_path), warn = FALSE)
sample_starts <- grep("^\\^SAMPLE = ", soft)
sample_ends <- c(sample_starts[-1L] - 1L, length(soft))
soft_rows <- rbindlist(lapply(seq_along(sample_starts), function(index) {
  block <- soft[sample_starts[[index]]:sample_ends[[index]]]
  one <- function(pattern, label) {
    hit <- grep(pattern, block, value = TRUE)
    if (length(hit) != 1L) {
      stop(sprintf("SOFT sample has %d %s fields", length(hit), label))
    }
    sub(pattern, "", hit)
  }
  data.table(
    gsm = one("^\\^SAMPLE = ", "accession"),
    title = one("^!Sample_title = ", "title"),
    treatment = one(
      "^!Sample_characteristics_ch1 = treatment: ",
      "treatment"
    )
  )
}))
if (nrow(soft_rows) != 16L || anyDuplicated(soft_rows$gsm) ||
    anyDuplicated(soft_rows$title)) {
  stop("family SOFT no longer contains exactly 16 unique sample records")
}

cohort <- data.table(
  sample = c(paste0("Hypo-Veh-", 1:4), paste0("Hypo-CS-", 1:4)),
  group = rep(c("control", "case"), each = 4L),
  biological_group = rep(c("vehicle", "celastrol"), each = 4L),
  deposited_column_label = rep(c("Veh", "CS"), each = 4L),
  gsm = c(paste0("GSM800723", 5:8), paste0("GSM800724", 3:6)),
  soft_title = c(
    paste0("DIO-Hypothelamus-Veh ", 1:4),
    paste0("DIO-Hypothelamus-CS ", 1:4)
  ),
  soft_treatment = rep(c("Vehicle", "Celastrol"), each = 4L),
  run_accession = c(
    "SRR27463662", "SRR27463661", "SRR27463660", "SRR27463659",
    "SRR27463654", "SRR27463653", "SRR27463652", "SRR27463651"
  ),
  sra_read_count = c(
    23830933, 28187053, 40162141, 30768520,
    25591585, 27218307, 33161238, 36866011
  )
)
official <- soft_rows[match(cohort$gsm, gsm)]
if (anyNA(official$gsm) ||
    !identical(official$title, cohort$soft_title) ||
    !identical(official$treatment, cohort$soft_treatment) ||
    !identical(
      cohort$sample,
      c(paste0("Hypo-Veh-", 1:4), paste0("Hypo-CS-", 1:4))
    )) {
  stop("registered vehicle/celastrol cohort disagrees with official GEO metadata")
}

selected_columns <- cohort$sample
output <- source[, c("Gene_ID", selected_columns), with = FALSE]
output_counts <- as.matrix(output[, ..selected_columns])
storage.mode(output_counts) <- "double"
source_selected <- source_counts[, selected_columns, drop = FALSE]
source_totals <- colSums(source_selected)
output_totals <- colSums(output_counts)
expected_selected_totals <- expected_source_totals[selected_columns]
expected_detected_genes <- c(17561L, 17721L, 17853L, 17739L,
                             17508L, 17490L, 17790L, 17961L)
if (!identical(as.numeric(source_totals), as.numeric(expected_selected_totals)) ||
    !identical(as.numeric(output_totals), as.numeric(expected_selected_totals)) ||
    !identical(as.integer(colSums(output_counts > 0)), expected_detected_genes)) {
  stop("selected cohort totals or detected-gene counts changed")
}

samplesheet <- cohort[, .(
  sample, group, biological_group, deposited_column_label
)]
qc <- data.table(
  sample = cohort$sample,
  group = cohort$group,
  biological_group = cohort$biological_group,
  run_accession = cohort$run_accession,
  sra_read_count = cohort$sra_read_count,
  source_count_sum = as.numeric(source_totals),
  output_count_sum = as.numeric(output_totals),
  assigned_fraction_of_sra_reads = as.numeric(output_totals) /
    cohort$sra_read_count,
  detected_genes = as.integer(colSums(output_counts > 0)),
  integral_fraction = vapply(
    seq_along(selected_columns),
    function(index) mean(output_counts[, index] == round(output_counts[, index])),
    numeric(1)
  ),
  conservation_delta = as.numeric(output_totals - source_totals)
)
if (any(qc$integral_fraction != 1) || any(qc$conservation_delta != 0) ||
    any(qc$assigned_fraction_of_sra_reads <= 0) ||
    any(qc$assigned_fraction_of_sra_reads >= 1)) {
  stop("selected cohort fails integer, conservation, or SRA-fraction QC")
}

targets <- c(counts_path, samplesheet_path, qc_path)
for (target in targets) {
  dir.create(dirname(target), recursive = TRUE, showWarnings = FALSE)
}
write_outputs <- function() {
  temporary <- c(
    tempfile("GSE252779-counts-", tmpdir = dirname(counts_path), fileext = ".tsv.gz"),
    tempfile("GSE252779-samples-", tmpdir = dirname(samplesheet_path), fileext = ".tsv"),
    tempfile("GSE252779-qc-", tmpdir = dirname(qc_path), fileext = ".tsv")
  )
  on.exit(unlink(temporary, force = TRUE), add = TRUE)
  fwrite(
    output,
    temporary[[1L]],
    sep = "\t",
    quote = FALSE,
    eol = "\n",
    compress = "gzip"
  )
  fwrite(samplesheet, temporary[[2L]], sep = "\t", quote = FALSE)
  fwrite(qc, temporary[[3L]], sep = "\t", quote = FALSE)

  # All three files are fully materialized before installation so
  # source/schema failures cannot leave a partially refreshed dataset.
  for (index in seq_along(targets)) {
    if (!file.copy(temporary[[index]], targets[[index]], overwrite = TRUE)) {
      stop(sprintf("failed to install deterministic output %s", targets[[index]]))
    }
  }
}
write_outputs()

cat(sprintf(
  paste0(
    "prepared GSE252779: 24047 STRA rows -> 24047 recovered unique genes; ",
    "vehicle=4 celastrol=4; %s selected counts conserved exactly\n"
  ),
  format(sum(output_totals), big.mark = ",", scientific = FALSE)
))
