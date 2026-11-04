#!/usr/bin/env Rscript

# Aggregate the 14 deposited per-mouse Drop-seq DGE matrices to lateral-
# hypothalamus pseudobulk counts. Each GEO sample is one biological mouse.

suppressPackageStartupMessages(library(data.table))

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 5L) {
  stop(paste0(
    "usage: prep_GSE130597.R <extracted-source-dir> <family.soft.gz> ",
    "<samplesheet.tsv> <pseudobulk-counts.tsv.gz> <qc.tsv>"
  ))
}

source_dir <- normalizePath(args[[1]], mustWork = TRUE)
soft_path <- normalizePath(args[[2]], mustWork = TRUE)
samplesheet_path <- args[[3]]
pseudobulk_path <- args[[4]]
qc_path <- args[[5]]

expected <- data.table(
  sample = sprintf("GSM%d", 3744476:3744489),
  mouse = paste("Mouse", 1:14),
  deposited_group = rep(c("control", "high fat diet"), 7L),
  group = rep(c("control", "case"), 7L),
  condition = rep(c("control_chow", "high_fat_diet"), 7L),
  sequencing_pool = c(
    "pool1", "pool1", "pool1", "pool2", "pool1", "pool1", "pool2",
    "pool1", "pool2", "pool2", "pool2", "pool2", "pool1", "pool1"
  ),
  expected_cells = c(
    1920L, 2280L, 2640L, 3750L, 2160L, 2580L, 3360L,
    1770L, 3360L, 2310L, 300L, 1020L, 690L, 270L
  ),
  source_file = c(
    "GSM3744476_MLB003_AJP1-N701_merged_GE_clean.bam.dge_1920.txt.gz",
    "GSM3744477_MLB003_AKP1-N702_merged_GE_clean.bam.dge_2280.txt.gz",
    "GSM3744478_MLB003_ALP1-N703_merged_GE_clean.bam.dge_2640.txt.gz",
    "GSM3744479_MLB004_ANP1-N701_merged_GE_clean.bam.dge_3750.txt.gz",
    "GSM3744480_MLB003_AOP1-N704_merged_GE_clean.bam.dge_2160.txt.gz",
    "GSM3744481_MLB003_APP1-N705_merged_GE_clean.bam.dge_2580.txt.gz",
    "GSM3744482_MLB004_AQP1-N702_merged_GE_clean.bam.dge_3360.txt.gz",
    "GSM3744483_MLB003_ASP1-N706_merged_GE_clean.bam.dge_1770.txt.gz",
    "GSM3744484_MLB004_AZP1-N703_merged_GE_clean.bam.dge_3360.txt.gz",
    "GSM3744485_MLB004_BAP1-N704_merged_GE_clean.bam.dge_2310.txt.gz",
    "GSM3744486_MLB004_BBP1-N705_merged_GE_clean.bam.dge_0300.txt.gz",
    "GSM3744487_MLB004_BCP1-N706_merged_GE_clean.bam.dge_1020.txt.gz",
    "GSM3744488_MLB003_BDP1-N707_merged_GE_clean.bam.dge_0690.txt.gz",
    "GSM3744489_MLB003_BEP1-N708_merged_GE_clean.bam.dge_0270.txt.gz"
  )
)

deposited_files <- list.files(source_dir, pattern = "\\.txt\\.gz$", full.names = FALSE)
if (!setequal(deposited_files, expected$source_file) || length(deposited_files) != 14L) {
  stop("source inventory differs from the 14 expected per-mouse DGE matrices")
}

soft <- readLines(gzfile(soft_path), warn = FALSE)
sample_starts <- grep("^\\^SAMPLE = ", soft)
if (length(sample_starts) != 14L) {
  stop("family SOFT does not contain exactly 14 sample blocks")
}
sample_ends <- c(sample_starts[-1L] - 1L, length(soft))

soft_value <- function(block, prefix) {
  hit <- block[startsWith(block, prefix)]
  if (length(hit) != 1L) {
    stop(sprintf("SOFT sample block does not have exactly one '%s' field", prefix))
  }
  sub(prefix, "", hit, fixed = TRUE)
}

for (i in seq_len(nrow(expected))) {
  block <- soft[sample_starts[[i]]:sample_ends[[i]]]
  accession <- soft_value(block, "^SAMPLE = ")
  title <- soft_value(block, "!Sample_title = ")
  group_line <- soft_value(block, "!Sample_characteristics_ch1 = group: ")
  pool_line <- soft_value(block, "!Sample_description = sequencing pool: ")
  supplementary <- basename(soft_value(block, "!Sample_supplementary_file_1 = "))

  observed <- c(
    accession, title, group_line, paste0("pool", pool_line), supplementary
  )
  wanted <- unlist(expected[i, .(
    sample, mouse, deposited_group, sequencing_pool, source_file
  )], use.names = FALSE)
  if (!identical(observed, wanted)) {
    stop(sprintf("SOFT metadata changed for %s", expected$sample[[i]]))
  }
  required_lines <- c(
    "!Sample_source_name_ch1 = lateral hypothalamus tissue punch",
    "!Sample_characteristics_ch1 = tissue: lateral hypothalamus",
    "!Sample_characteristics_ch1 = Sex: male",
    "!Sample_molecule_ch1 = total RNA",
    "!Sample_library_source = transcriptomic",
    "!Sample_library_strategy = RNA-Seq"
  )
  if (!all(required_lines %in% block)) {
    stop(sprintf("SOFT RNA/tissue metadata changed for %s", expected$sample[[i]]))
  }
}

if (!identical(as.integer(table(expected$group)), c(7L, 7L)) ||
    !identical(
      as.integer(table(expected$group, expected$sequencing_pool)),
      c(4L, 4L, 3L, 3L)
    )) {
  stop("expected diet groups or sequencing pools are not balanced as 7/7 and 4:3/4:3")
}
design <- model.matrix(
  ~ sequencing_pool + group,
  data = transform(expected, sequencing_pool = factor(sequencing_pool), group = factor(group))
)
if (qr(design)$rank != ncol(design)) {
  stop("sequencing-pool-adjusted diet design is not estimable")
}

read_dge_pseudobulk <- function(path, expected_cell_count) {
  con <- gzfile(path, "rt")
  on.exit(close(con), add = TRUE)

  header_line <- readLines(con, n = 1L, warn = FALSE)
  if (length(header_line) != 1L) {
    stop(sprintf("%s has no header", basename(path)))
  }
  header <- strsplit(header_line, "\t", fixed = TRUE)[[1L]]
  if (length(header) != expected_cell_count + 1L || header[[1L]] != "GENE" ||
      any(!nzchar(header[-1L])) || anyDuplicated(header[-1L])) {
    stop(sprintf("%s has an invalid gene-by-cell header", basename(path)))
  }

  genes <- character()
  gene_totals <- numeric()
  matrix_nnz <- 0
  library_size <- 0
  repeat {
    lines <- readLines(con, n = 128L, warn = FALSE)
    if (!length(lines)) {
      break
    }
    fields <- strsplit(lines, "\t", fixed = TRUE)
    field_lengths <- lengths(fields)
    if (any(field_lengths != expected_cell_count + 1L)) {
      stop(sprintf("%s contains a row with the wrong number of cells", basename(path)))
    }

    chunk_genes <- vapply(fields, `[[`, character(1), 1L)
    if (any(!nzchar(chunk_genes))) {
      stop(sprintf("%s contains an empty gene symbol", basename(path)))
    }
    values <- suppressWarnings(as.numeric(unlist(
      lapply(fields, `[`, -1L), use.names = FALSE
    )))
    if (any(!is.finite(values)) || any(values < 0) || any(values != round(values))) {
      stop(sprintf("%s contains non-integer or invalid counts", basename(path)))
    }
    chunk_matrix <- matrix(values, nrow = length(lines), byrow = TRUE)
    chunk_totals <- rowSums(chunk_matrix)

    genes <- c(genes, chunk_genes)
    gene_totals <- c(gene_totals, chunk_totals)
    matrix_nnz <- matrix_nnz + sum(values > 0)
    library_size <- library_size + sum(values)
  }

  if (!length(genes) || anyDuplicated(genes) || length(genes) != length(gene_totals)) {
    stop(sprintf("%s has empty or duplicated gene rows", basename(path)))
  }
  if (!is.finite(library_size) || library_size <= 0 ||
      !identical(sum(gene_totals), library_size)) {
    stop(sprintf("%s row aggregation does not conserve counts", basename(path)))
  }
  names(gene_totals) <- genes
  list(
    counts = gene_totals,
    cells = expected_cell_count,
    source_gene_rows = length(genes),
    matrix_nnz = matrix_nnz,
    library_size = library_size,
    detected_genes = sum(gene_totals > 0)
  )
}

sample_counts <- vector("list", nrow(expected))
names(sample_counts) <- expected$sample
qc_rows <- vector("list", nrow(expected))
for (i in seq_len(nrow(expected))) {
  row <- expected[i]
  parsed <- read_dge_pseudobulk(
    file.path(source_dir, row$source_file), row$expected_cells
  )
  sample_counts[[row$sample]] <- parsed$counts
  qc_rows[[i]] <- data.table(
    sample = row$sample,
    mouse = row$mouse,
    group = row$group,
    condition = row$condition,
    sequencing_pool = row$sequencing_pool,
    source_file = row$source_file,
    cells = parsed$cells,
    source_gene_rows = parsed$source_gene_rows,
    matrix_nnz = parsed$matrix_nnz,
    library_size = parsed$library_size,
    detected_genes = parsed$detected_genes
  )
}
qc <- rbindlist(qc_rows)

expected_gene_rows <- c(
  17009L, 16863L, 16803L, 17830L, 17135L, 17055L, 17880L,
  16761L, 17623L, 16753L, 12908L, 15696L, 14894L, 11526L
)
expected_nnz <- c(
  1536742, 1928213, 1475613, 2721530, 1982860, 2227129, 2650239,
  1963455, 2431145, 1320344, 197870, 838958, 377816, 80532
)
expected_library_sizes <- c(
  2881914, 3419774, 2608795, 5611524, 3755330, 3864038, 5160475,
  3560537, 4905808, 2465648, 350386, 1584171, 845097, 147470
)
if (!identical(qc$cells, expected$expected_cells) ||
    !identical(qc$source_gene_rows, expected_gene_rows) ||
    !identical(qc$detected_genes, expected_gene_rows) ||
    !identical(as.numeric(qc$matrix_nnz), expected_nnz) ||
    !identical(as.numeric(qc$library_size), expected_library_sizes)) {
  stop("deposited DGE dimensions or count totals changed")
}

gene_union <- sort(unique(unlist(lapply(sample_counts, names), use.names = FALSE)))
if (!length(gene_union) || any(!nzchar(gene_union)) || anyDuplicated(gene_union)) {
  stop("merged gene-symbol universe is invalid")
}
if (length(gene_union) != 21568L) {
  stop("merged gene-symbol universe changed from 21,568 rows")
}
pseudobulk <- matrix(
  0, nrow = length(gene_union), ncol = nrow(expected),
  dimnames = list(gene_union, expected$sample)
)
for (sample in expected$sample) {
  values <- sample_counts[[sample]]
  pseudobulk[match(names(values), gene_union), sample] <- values
}
if (any(!is.finite(pseudobulk)) || any(pseudobulk < 0) ||
    any(pseudobulk != round(pseudobulk))) {
  stop("merged pseudobulk is not finite, nonnegative integer counts")
}

count_delta <- as.numeric(colSums(pseudobulk)) - qc$library_size
if (any(!is.finite(count_delta)) || any(count_delta != 0)) {
  stop("merged pseudobulk does not conserve each mouse library exactly")
}
qc[, `:=`(
  counts_per_cell = library_size / cells,
  low_cell_yield = cells < 0.25 * median(cells),
  analysis_keep = TRUE,
  count_conservation_delta = count_delta,
  merged_gene_rows = nrow(pseudobulk)
)]
if (!identical(qc[low_cell_yield == TRUE, mouse], c("Mouse 11", "Mouse 14"))) {
  stop("relative cell-yield watch list changed from Mouse 11 and Mouse 14")
}
if (any(table(qc[analysis_keep == TRUE, group]) < 3L)) {
  stop("library QC leaves fewer than three independent mice in one diet arm")
}

samplesheet <- qc[analysis_keep == TRUE, .(
  sample, group, condition, sequencing_pool, mouse, cells, low_cell_yield
)]
output <- data.table(GeneName = gene_union)
output <- cbind(output, as.data.table(pseudobulk))

dir.create(dirname(samplesheet_path), recursive = TRUE, showWarnings = FALSE)
dir.create(dirname(pseudobulk_path), recursive = TRUE, showWarnings = FALSE)
dir.create(dirname(qc_path), recursive = TRUE, showWarnings = FALSE)
fwrite(output, pseudobulk_path, sep = "\t", compress = "gzip")
fwrite(samplesheet, samplesheet_path, sep = "\t")
fwrite(qc, qc_path, sep = "\t")

cat(sprintf(
  paste0(
    "prepared %d genes x %d mice from %s author-called cells; control=%d case=%d; ",
    "pool-adjusted design estimable; library sizes %.1fM-%.1fM; exact count conservation\n"
  ),
  nrow(pseudobulk), ncol(pseudobulk),
  format(sum(qc$cells), big.mark = ",", scientific = FALSE),
  sum(qc$group == "control"), sum(qc$group == "case"),
  min(qc$library_size) / 1e6, max(qc$library_size) / 1e6
))
