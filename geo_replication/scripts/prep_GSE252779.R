#!/usr/bin/env Rscript
# =============================================================================
# Prepare the deposited raw-count matrix for GSE252779.
#
# The official GSE252779_Gene-count.xlsx workbook contains two materially
# different sheets:
#   * Cuff-gene-count: fractional, FPKM-scale normalized expression
#   * STRA-gee-count:  integer raw counts with read-scale library totals
#
# Only STRA-gee-count is valid input to the canonical edgeR count pipeline.
# Earlier versions of this adapter extracted Cuff-gene-count and routed it to
# limma; author-result validation found that error.
#
# A separate deposit inconsistency remains visible by design. GEO/SRA metadata
# and count-column headings identify Hypo-PF-* as pair-fed and Hypo-CS-* as
# celastrol. However, every one of the five author DESeq2 sheets is reproduced
# only when those two labels are exchanged. This prep keeps the GEO/SRA labels
# intact and builds the registered GEO-defined celastrol-minus-vehicle contrast
# from Hypo-CS-* versus Hypo-Veh-*. validate_GSE252779_author.R audits and
# reports the conflicting author-result permutation; it must not be silently
# converted into a biological relabeling here.
#
# Usage: Rscript scripts/prep_GSE252779.R
# =============================================================================
suppressPackageStartupMessages(library(readxl))

get_script_dir <- function() {
  args <- commandArgs(FALSE)
  file_arg <- grep("^--file=", args, value = TRUE)
  if (length(file_arg)) return(dirname(normalizePath(sub("^--file=", "", file_arg[1]))))
  getwd()
}

ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE252779_mmus_hypo_celastrol")
SRC <- file.path(DS, "raw", "GSE252779_Gene-count.xlsx")

samples <- data.frame(
  sample = c(paste0("Hypo-Veh-", 1:4), paste0("Hypo-CS-", 1:4)),
  group = rep(c("control", "case"), each = 4),
  biological_group = rep(c("vehicle", "celastrol"), each = 4),
  deposited_column_label = rep(c("Veh", "CS"), each = 4),
  stringsAsFactors = FALSE
)

if (!file.exists(SRC)) stop(sprintf("source workbook not found: %s", SRC))
sheet_names <- excel_sheets(SRC)
required_sheets <- c("Cuff-gene-count", "STRA-gee-count")
if (!all(required_sheets %in% sheet_names)) {
  stop(sprintf(
    "required workbook sheets missing: %s",
    paste(setdiff(required_sheets, sheet_names), collapse = ", ")
  ))
}

raw <- as.data.frame(
  read_excel(SRC, sheet = "STRA-gee-count", .name_repair = "minimal"),
  check.names = FALSE,
  stringsAsFactors = FALSE
)
cat(sprintf("[GSE252779] read STRA-gee-count: %d rows x %d columns\n", nrow(raw), ncol(raw)))

missing_columns <- setdiff(c("Gene_ID", samples$sample), colnames(raw))
if (length(missing_columns)) {
  stop(sprintf("source columns missing: %s", paste(missing_columns, collapse = ", ")))
}

symbols <- as.character(raw$Gene_ID)
valid_symbol <- !is.na(symbols) & nzchar(symbols) & symbols != "NA"
if (!all(valid_symbol)) {
  stop(sprintf("%d rows have missing gene symbols", sum(!valid_symbol)))
}

source_matrix <- as.matrix(raw[, samples$sample, drop = FALSE])
storage.mode(source_matrix) <- "double"
if (anyNA(source_matrix) || any(!is.finite(source_matrix))) stop("non-finite raw counts")
if (any(source_matrix < 0)) stop("negative raw counts")
if (!all(source_matrix == round(source_matrix))) stop("STRA-gee-count is not integer-valued")
if (min(colSums(source_matrix)) < 1e6) stop("STRA-gee-count library total is below read-count scale")

source_sums <- colSums(source_matrix)
count_matrix <- rowsum(source_matrix, group = symbols, reorder = FALSE)
output_sums <- colSums(count_matrix)
if (!isTRUE(all.equal(source_sums, output_sums, tolerance = 0))) {
  stop("duplicate-symbol collapse did not conserve every library total")
}

cat(sprintf(
  "[GSE252779] raw counts: 100%% integer; library totals %.0f-%.0f; %d unique genes\n",
  min(output_sums), max(output_sums), nrow(count_matrix)
))

out <- data.frame(
  Gene_ID = rownames(count_matrix),
  count_matrix,
  check.names = FALSE,
  stringsAsFactors = FALSE
)
out_path <- file.path(DS, "raw", "GSE252779_hypo_CS_vs_Veh_counts.tsv.gz")
connection <- gzfile(out_path, "w")
write.table(out, connection, sep = "\t", quote = FALSE, row.names = FALSE)
close(connection)
cat(sprintf("[GSE252779] wrote %s\n", basename(out_path)))

sample_sheet_path <- file.path(DS, "metadata", "GSE252779_samplesheet.tsv")
write.table(samples, sample_sheet_path, sep = "\t", quote = FALSE, row.names = FALSE)
cat(sprintf("[GSE252779] wrote %s\n", basename(sample_sheet_path)))

# ENA run totals independently pin each count column to its deposited SRA label.
# These are metadata-only read totals, not used for normalization or filtering.
run_accession <- c(
  "SRR27463662", "SRR27463661", "SRR27463660", "SRR27463659",
  "SRR27463654", "SRR27463653", "SRR27463652", "SRR27463651"
)
sra_read_count <- c(
  23830933, 28187053, 40162141, 30768520,
  25591585, 27218307, 33161238, 36866011
)
qc <- data.frame(
  sample = samples$sample,
  group = samples$group,
  biological_group = samples$biological_group,
  run_accession = run_accession,
  sra_read_count = sra_read_count,
  source_count_sum = source_sums,
  output_count_sum = output_sums,
  assigned_fraction_of_sra_reads = output_sums / sra_read_count,
  detected_genes = colSums(count_matrix > 0),
  integral_fraction = colMeans(count_matrix == round(count_matrix)),
  conservation_delta = output_sums - source_sums,
  stringsAsFactors = FALSE
)
if (any(qc$conservation_delta != 0)) stop("non-zero count-conservation delta")
if (any(qc$integral_fraction != 1)) stop("written matrix is not integer-valued")
if (any(qc$detected_genes < 5000)) stop("a retained library has fewer than 5,000 detected genes")
if (any(qc$assigned_fraction_of_sra_reads < 0.25 | qc$assigned_fraction_of_sra_reads > 0.40)) {
  stop("count-column totals do not plausibly map to their deposited SRA run totals")
}
qc_path <- file.path(DS, "processed", "GSE252779_preprocessing_qc.tsv")
write.table(qc, qc_path, sep = "\t", quote = FALSE, row.names = FALSE)
cat(sprintf("[GSE252779] wrote %s; all preprocessing gates passed\n", basename(qc_path)))

