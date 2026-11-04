#!/usr/bin/env Rscript

# Stream the eight deposited arcuate-nucleus Drop-seq DGE matrices and collapse
# each independent library to one gene-level pseudobulk sample. Dense cell-level
# matrices are never materialized in memory.

suppressPackageStartupMessages(library(data.table))

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 5L) {
  stop(paste0(
    "usage: prep_GSE289461.R <extracted-source-dir> <family.soft.gz> ",
    "<samplesheet.tsv> <pseudobulk-counts.tsv.gz> <qc.tsv>"
  ))
}

source_dir <- normalizePath(args[[1]], mustWork = TRUE)
soft_path <- normalizePath(args[[2]], mustWork = TRUE)
samplesheet_path <- args[[3]]
pseudobulk_path <- args[[4]]
qc_path <- args[[5]]

samples <- data.table(
  sample = sprintf("GSM879179%d", 1:8),
  source_file = c(
    "GSM8791791_704CTRL1.DGE.txt.gz",
    "GSM8791792_706CTRL2.DGE.txt.gz",
    "GSM8791793_715CTRL3.DGE.txt.gz",
    "GSM8791794_724CTRL4.DGE.txt.gz",
    "GSM8791795_703NM14KO1.DGE.txt.gz",
    "GSM8791796_709NM14KO2.DGE.txt.gz",
    "GSM8791797_723NM14KO4.DGE.txt.gz",
    "GSM8791798_729NM14KO3.DGE.txt.gz"
  ),
  source_label = c(
    "704CTRL1", "706CTRL2", "715CTRL3", "724CTRL4",
    "703NM14KO1", "709NM14KO2", "723NM14KO4", "729NM14KO3"
  ),
  group = c(rep("control", 4L), rep("case", 4L)),
  condition = c(rep("control", 4L), rep("mettl14_knockout", 4L)),
  genotype = c(rep("Control", 4L), rep("Mettl14 Knockout", 4L)),
  replicate = rep(1:4, 2L),
  compressed_bytes = c(
    18286554, 17188917, 24258184, 22559117,
    15028914, 16487178, 25060283, 23215841
  ),
  cells = c(22497L, 27429L, 37166L, 21482L, 21061L, 12684L, 36001L, 30391L)
)
expected_qc <- data.table(
  sample = samples$sample,
  source_gene_rows = c(27511L, 27345L, 27007L, 27995L,
                       27282L, 27802L, 27494L, 28169L),
  matrix_nnz = c(9290095, 7788483, 11581823, 12148941,
                 6996271, 9683115, 11651153, 11128829),
  library_size = c(13433168, 10284576, 14350132, 17531693,
                   10145191, 15366207, 15016525, 15155638),
  detected_genes = c(27511L, 27345L, 27007L, 27995L,
                     27282L, 27802L, 27494L, 28169L),
  min_cell_library = c(8, 25, 42, 84, 10, 12, 56, 42),
  median_cell_library = c(339, 298, 288, 447, 296, 695, 292, 335),
  max_cell_library = c(37562, 10264, 8779, 39219, 21181, 111594, 19020, 21303)
)
if (!identical(as.integer(table(samples$group)), c(4L, 4L))) {
  stop("the retained contrast must contain four independent libraries per arm")
}

deposited <- list.files(source_dir, all.files = TRUE, no.. = TRUE)
if (!setequal(deposited, samples$source_file) || length(deposited) != nrow(samples)) {
  stop("extracted source inventory differs from the eight deposited DGE files")
}
source_paths <- file.path(source_dir, samples$source_file)
source_info <- file.info(source_paths)
if (any(source_info$isdir) ||
    !identical(as.numeric(source_info$size), samples$compressed_bytes)) {
  stop("deposited DGE file types or compressed byte sizes changed")
}

# Confirm that the accession-to-condition mapping is the one deposited in GEO,
# and that every retained assay is single-cell transcriptomic RNA sequencing.
soft <- readLines(gzfile(soft_path), warn = FALSE)
sample_starts <- grep("^\\^SAMPLE = ", soft)
if (length(sample_starts) != nrow(samples)) {
  stop("family SOFT does not contain exactly eight sample blocks")
}
for (i in seq_len(nrow(samples))) {
  start <- which(soft == paste0("^SAMPLE = ", samples$sample[[i]]))
  if (length(start) != 1L) {
    stop(sprintf("SOFT sample block is missing or duplicated for %s", samples$sample[[i]]))
  }
  next_starts <- sample_starts[sample_starts > start]
  end <- if (length(next_starts)) next_starts[[1]] - 1L else length(soft)
  title <- if (samples$group[[i]] == "control") {
    sprintf("!Sample_title = Control, replicate%d, scRNAseq", samples$replicate[[i]])
  } else {
    sprintf("!Sample_title = Mettl14 knockout, replicate%d, scRNAseq", samples$replicate[[i]])
  }
  required <- c(
    title,
    "!Sample_source_name_ch1 = arcuate nucleus of hypothalamus",
    "!Sample_characteristics_ch1 = tissue: arcuate nucleus of hypothalamus",
    paste0("!Sample_characteristics_ch1 = genotype: ", samples$genotype[[i]]),
    "!Sample_library_source = transcriptomic single cell",
    "!Sample_library_strategy = RNA-Seq"
  )
  if (!all(required %in% soft[start:end])) {
    stop(sprintf("SOFT design or assay metadata changed for %s", samples$sample[[i]]))
  }
}

read_dge_pseudobulk <- function(path, sample, expected_cells) {
  con <- gzfile(path, open = "rt")
  on.exit(close(con), add = TRUE)

  header_line <- readLines(con, n = 1L, warn = FALSE)
  if (length(header_line) != 1L) {
    stop(sprintf("%s has no DGE header", sample))
  }
  header <- strsplit(header_line, "\t", fixed = TRUE)[[1]]
  barcodes <- header[-1L]
  if (header[[1]] != "GENE" || length(barcodes) != expected_cells ||
      any(!grepl("^[ACGTN]{12}$", barcodes)) || anyDuplicated(barcodes)) {
    stop(sprintf("%s has an invalid or changed DGE barcode header", sample))
  }

  capacity <- 30000L
  genes <- character(capacity)
  totals <- numeric(capacity)
  cell_totals <- numeric(expected_cells)
  gene_count <- 0L
  matrix_nnz <- 0

  repeat {
    lines <- readLines(con, n = 32L, warn = FALSE)
    if (!length(lines)) break
    for (line in lines) {
      first_tab <- regexpr("\t", line, fixed = TRUE)[[1]]
      if (first_tab <= 1L) {
        stop(sprintf("%s contains a malformed DGE row", sample))
      }
      gene <- substr(line, 1L, first_tab - 1L)
      values <- scan(
        text = substring(line, first_tab + 1L), what = double(),
        sep = "\t", quiet = TRUE
      )
      if (!nzchar(gene) || length(values) != expected_cells ||
          any(!is.finite(values)) || any(values < 0) ||
          any(values != floor(values))) {
        stop(sprintf("%s contains an invalid count row for gene '%s'", sample, gene))
      }

      gene_count <- gene_count + 1L
      if (gene_count > capacity) {
        capacity <- capacity + 10000L
        length(genes) <- capacity
        length(totals) <- capacity
      }
      genes[[gene_count]] <- gene
      totals[[gene_count]] <- sum(values)
      cell_totals <- cell_totals + values
      matrix_nnz <- matrix_nnz + sum(values > 0)
    }
    if (gene_count %% 5000L < length(lines)) {
      cat(sprintf("  %s: streamed %s genes\n", sample, format(gene_count, big.mark = ",")))
    }
  }

  genes <- genes[seq_len(gene_count)]
  totals <- totals[seq_len(gene_count)]
  if (!gene_count || any(!nzchar(genes)) || anyDuplicated(genes)) {
    stop(sprintf("%s has empty or duplicated gene rows", sample))
  }
  if (any(cell_totals <= 0) || sum(totals) != sum(cell_totals)) {
    stop(sprintf("%s does not conserve counts across gene and cell margins", sample))
  }

  list(
    counts = setNames(totals, genes),
    qc = data.table(
      sample = sample,
      source_gene_rows = gene_count,
      cells = expected_cells,
      matrix_nnz = matrix_nnz,
      library_size = sum(totals),
      detected_genes = sum(totals > 0),
      zero_count_cells = sum(cell_totals == 0),
      min_cell_library = min(cell_totals),
      median_cell_library = median(cell_totals),
      max_cell_library = max(cell_totals),
      count_conservation_delta = sum(totals) - sum(cell_totals)
    )
  )
}

results <- vector("list", nrow(samples))
for (i in seq_len(nrow(samples))) {
  cat(sprintf("[%d/%d] streaming %s\n", i, nrow(samples), samples$sample[[i]]))
  results[[i]] <- read_dge_pseudobulk(
    source_paths[[i]], samples$sample[[i]], samples$cells[[i]]
  )
}

gene_union <- sort(unique(unlist(lapply(results, function(x) names(x$counts)))))
if (!length(gene_union) || any(!nzchar(gene_union)) || anyDuplicated(gene_union)) {
  stop("merged gene-symbol universe is invalid")
}
pseudobulk <- matrix(
  0, nrow = length(gene_union), ncol = nrow(samples),
  dimnames = list(gene_union, samples$sample)
)
for (i in seq_len(nrow(samples))) {
  values <- results[[i]]$counts
  pseudobulk[match(names(values), gene_union), i] <- values
}
if (any(!is.finite(pseudobulk)) || any(pseudobulk < 0) ||
    any(pseudobulk != floor(pseudobulk))) {
  stop("merged pseudobulk is not finite, nonnegative integer counts")
}

qc <- rbindlist(lapply(results, `[[`, "qc"))
qc <- merge(
  samples[, .(sample, group, condition, genotype, replicate, source_file,
              compressed_bytes)],
  qc, by = "sample", sort = FALSE
)
if (!identical(qc$sample, samples$sample)) {
  stop("pseudobulk QC rows are not in the pinned accession order")
}
for (field in setdiff(names(expected_qc), "sample")) {
  if (!identical(as.numeric(qc[[field]]), as.numeric(expected_qc[[field]]))) {
    stop(sprintf("deposited per-library QC metric changed: %s", field))
  }
}
if (sum(qc$cells) != 208711L || nrow(pseudobulk) != 36514L ||
    sum(qc$library_size) != 111283130) {
  stop("deposited aggregate dimensions or library counts changed")
}
qc[, merged_gene_rows := nrow(pseudobulk)]
qc[, merged_count_conservation_delta :=
     as.numeric(colSums(pseudobulk[, sample, drop = FALSE])) - library_size,
   by = sample]
if (any(qc$count_conservation_delta != 0) ||
    any(qc$merged_count_conservation_delta != 0)) {
  stop("pseudobulk aggregation does not conserve each deposited library exactly")
}

samplesheet <- qc[, .(
  sample, group, condition, genotype, replicate, cells, source_file
)]
output <- data.table(GeneName = gene_union)
output <- cbind(output, as.data.table(pseudobulk))

fwrite(output, pseudobulk_path, sep = "\t", compress = "gzip")
fwrite(samplesheet, samplesheet_path, sep = "\t")
fwrite(qc, qc_path, sep = "\t")

cat(sprintf(
  paste0(
    "prepared %s genes x %d independent libraries from %s cells; ",
    "control=%d case=%d; library sizes %.1fM-%.1fM; exact count conservation\n"
  ),
  format(nrow(pseudobulk), big.mark = ","), ncol(pseudobulk),
  format(sum(qc$cells), big.mark = ","),
  sum(samples$group == "control"), sum(samples$group == "case"),
  min(qc$library_size) / 1e6, max(qc$library_size) / 1e6
))
