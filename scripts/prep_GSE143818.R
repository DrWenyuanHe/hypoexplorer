#!/usr/bin/env Rscript

# Aggregate the author-selected VMH cells from the deposited plate-based
# scRNA-seq matrices to mouse-level pseudobulk counts. The six mice are the
# biological replicates; cells are nested observations. The official Source
# Data Figure 2 table identifies the 467 cells in the six retained VMH clusters.

suppressPackageStartupMessages(library(data.table))

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 5L) {
  stop(paste0(
    "usage: prep_GSE143818.R <extracted-source-dir> <source-fig2.csv> ",
    "<samplesheet.tsv> <pseudobulk-counts.tsv.gz> <qc.tsv>"
  ))
}

source_dir <- normalizePath(args[[1]], mustWork = TRUE)
author_cells_path <- normalizePath(args[[2]], mustWork = TRUE)
samplesheet_path <- args[[3]]
pseudobulk_path <- args[[4]]
qc_path <- args[[5]]

design <- data.table(
  file = c(
    "GSM4274984_female1.csv.gz",
    "GSM4274985_female2.csv.gz",
    "GSM4274986_female3.csv.gz",
    "GSM4274987_male1.csv.gz",
    "GSM4274988_male2.csv.gz",
    "GSM4274989_male3.csv.gz"
  ),
  sample = paste0("GSM427498", 4:9),
  group = c(rep("control", 3L), rep("case", 3L)),
  condition = c(rep("female", 3L), rep("male", 3L)),
  sex = c(rep("female", 3L), rep("male", 3L)),
  mouse = c("female_1", "female_2", "female_3", "male_1", "male_2", "male_3"),
  author_prefix = c("female_f2", "female_f3", "female_f4", "male_m1", "male_m2", "male_m3")
)

deposited_files <- basename(list.files(
  source_dir,
  pattern = "\\.csv\\.gz$",
  full.names = TRUE
))
if (!identical(sort(deposited_files), sort(design$file))) {
  stop("source inventory differs from the six deposited GSE143818 UMI matrices")
}
if (sum(design$group == "control") != 3L || sum(design$group == "case") != 3L) {
  stop("sex contrast must contain three independent mice per arm")
}

expected_wells <- unlist(lapply(
  LETTERS[1:8],
  function(row) paste0(row, sprintf("%02d", 1:12))
), use.names = FALSE)
expected_paper_qc_cells <- c(88L, 87L, 86L, 93L, 84L, 92L)
expected_author_cells <- c(75L, 85L, 77L, 78L, 74L, 78L)
expected_library_sizes <- c(420176, 180039, 530784, 649182, 467209, 662604)
expected_matrix_nnz <- c(186976L, 104601L, 218157L, 228812L, 189705L, 239558L)
expected_detected_genes <- c(12392L, 10821L, 12829L, 12842L, 12436L, 12947L)
expected_min_cell_counts <- c(1500, 661, 2421, 1992, 1320, 1437)
expected_median_cell_counts <- c(5588, 2097, 6684, 7871.5, 5945, 7970)
expected_max_cell_counts <- c(8921, 4269, 22385, 18794, 15294, 16016)

expected_author_columns <- c(
  "cell", "ident", "Hpcal1", "Fezf1", "Pcp4", "Tac1", "Ifi27l2a",
  "Serpine2", "Pdyn", "Tmem35a", "Mt1", "Gal", "Penk", "Synpr",
  "Sst", "Cartpt", "Nts", "Rprm", "Crym", "Syp"
)
author <- fread(author_cells_path, check.names = FALSE, showProgress = FALSE)
if (!identical(names(author), expected_author_columns) || nrow(author) != 467L ||
    anyNA(author$cell) || any(!nzchar(author$cell)) || anyDuplicated(author$cell) ||
    !all(grepl("^(female_f[2-4]|male_m[1-3])_[A-H][0-9]{2}$", author$cell))) {
  stop("official GSE143818 Source Data Figure 2 cell inventory changed")
}
if (!identical(
  as.integer(table(factor(author$ident, levels = 0:5))),
  c(105L, 94L, 93L, 80L, 48L, 47L)
)) {
  stop("official GSE143818 six-cluster membership changed")
}
author_prefixes <- sub("_[A-H][0-9]{2}$", "", author$cell)
if (!identical(
  as.integer(table(factor(author_prefixes, levels = design$author_prefix))),
  expected_author_cells
)) {
  stop("official GSE143818 Source Data Figure 2 mouse-cell counts changed")
}

pseudobulk <- NULL
genes <- NULL
qc_rows <- vector("list", nrow(design))
matched_author_cells <- character()

for (i in seq_len(nrow(design))) {
  path <- file.path(source_dir, design$file[[i]])
  deposited <- fread(path, check.names = FALSE, showProgress = FALSE)
  if (!identical(names(deposited), c("Gene", expected_wells))) {
    stop(sprintf("%s does not contain Gene plus the expected 96 plate wells", design$file[[i]]))
  }
  sample_genes <- deposited[["Gene"]]
  if (length(sample_genes) != 21926L || anyNA(sample_genes) ||
      any(!nzchar(sample_genes)) || anyDuplicated(sample_genes)) {
    stop(sprintf("%s does not contain 21,926 unique nonempty gene symbols", design$file[[i]]))
  }
  if (is.null(genes)) {
    genes <- sample_genes
    pseudobulk <- matrix(
      0,
      nrow = length(genes),
      ncol = nrow(design),
      dimnames = list(genes, design$sample)
    )
  } else if (!identical(sample_genes, genes)) {
    stop(sprintf("%s gene symbols or ordering differ from the first mouse", design$file[[i]]))
  }

  counts <- as.matrix(deposited[, ..expected_wells])
  storage.mode(counts) <- "numeric"
  if (!identical(dim(counts), c(21926L, 96L)) || any(!is.finite(counts)) ||
      any(counts < 0) || any(counts != round(counts))) {
    stop(sprintf("%s is not a 21,926 x 96 nonnegative-integer UMI matrix", design$file[[i]]))
  }

  cell_counts <- colSums(counts)
  cell_detected_genes <- colSums(counts > 0)
  mitochondrial <- grepl("^mt-", sample_genes, ignore.case = TRUE)
  if (!any(mitochondrial) || any(cell_counts <= 0)) {
    stop(sprintf("%s lacks mitochondrial rows or contains an empty cell", design$file[[i]]))
  }
  mitochondrial_fraction <- colSums(counts[mitochondrial, , drop = FALSE]) / cell_counts
  paper_qc_keep <- cell_detected_genes >= 500L & mitochondrial_fraction < 0.17

  author_cell_ids <- paste(design$author_prefix[[i]], expected_wells, sep = "_")
  author_keep <- author_cell_ids %in% author$cell
  if (sum(paper_qc_keep) != expected_paper_qc_cells[[i]] ||
      sum(author_keep) != expected_author_cells[[i]] ||
      any(author_keep & !paper_qc_keep)) {
    stop(sprintf("%s no longer reproduces the published QC/VMH-cell selection", design$file[[i]]))
  }
  matched_author_cells <- c(matched_author_cells, author_cell_ids[author_keep])

  retained_counts <- counts[, author_keep, drop = FALSE]
  retained_cell_counts <- cell_counts[author_keep]
  mouse_counts <- rowSums(retained_counts)
  source_total <- sum(retained_counts)
  if (!is.finite(source_total) || source_total <= 0 || sum(mouse_counts) != source_total) {
    stop(sprintf("%s retained-cell aggregation does not conserve counts", design$file[[i]]))
  }
  pseudobulk[, i] <- mouse_counts

  qc_rows[[i]] <- data.table(
    sample = design$sample[[i]],
    group = design$group[[i]],
    condition = design$condition[[i]],
    sex = design$sex[[i]],
    mouse = design$mouse[[i]],
    age = "P10",
    genotype = "Ai14f/+;Sf1-Cre",
    deposited_cells = ncol(counts),
    paper_qc_cells = sum(paper_qc_keep),
    author_vm_cells = sum(author_keep),
    paper_qc_removed = sum(!paper_qc_keep),
    divergent_or_non_vmh_removed = sum(paper_qc_keep & !author_keep),
    source_gene_rows = nrow(counts),
    matrix_nnz = sum(retained_counts > 0),
    library_size = source_total,
    detected_genes = sum(mouse_counts > 0),
    min_cell_counts = min(retained_cell_counts),
    median_cell_counts = median(retained_cell_counts),
    max_cell_counts = max(retained_cell_counts),
    min_detected_genes_per_cell = min(cell_detected_genes[author_keep]),
    median_detected_genes_per_cell = median(cell_detected_genes[author_keep]),
    max_detected_genes_per_cell = max(cell_detected_genes[author_keep]),
    max_mitochondrial_fraction = max(mitochondrial_fraction[author_keep]),
    count_conservation_delta = sum(mouse_counts) - source_total
  )
}

qc <- rbindlist(qc_rows)
if (!identical(sort(matched_author_cells), sort(author$cell)) ||
    anyDuplicated(matched_author_cells) ||
    !identical(qc$paper_qc_cells, expected_paper_qc_cells) ||
    !identical(qc$author_vm_cells, expected_author_cells) ||
    !identical(as.numeric(qc$library_size), expected_library_sizes) ||
    !identical(qc$matrix_nnz, expected_matrix_nnz) ||
    !identical(qc$detected_genes, expected_detected_genes) ||
    !identical(as.numeric(qc$min_cell_counts), expected_min_cell_counts) ||
    !identical(as.numeric(qc$median_cell_counts), expected_median_cell_counts) ||
    !identical(as.numeric(qc$max_cell_counts), expected_max_cell_counts) ||
    sum(qc$paper_qc_cells) != 530L || sum(qc$author_vm_cells) != 467L ||
    sum(qc$library_size) != 2909994 || sum(rowSums(pseudobulk) > 0) != 14943L ||
    any(qc$count_conservation_delta != 0)) {
  stop("published-cell GSE143818 dimensions or count summaries changed")
}
if (any(!is.finite(pseudobulk)) || any(pseudobulk < 0) ||
    any(pseudobulk != round(pseudobulk)) ||
    any(colSums(pseudobulk) != qc$library_size)) {
  stop("final mouse pseudobulk is invalid or does not conserve source counts")
}

samplesheet <- qc[, .(
  sample, group, condition, sex, mouse, age, genotype, cells = author_vm_cells
)]
output <- data.table(GeneName = genes)
output <- cbind(output, as.data.table(pseudobulk))

fwrite(output, pseudobulk_path, sep = "\t", compress = "gzip")
fwrite(samplesheet, samplesheet_path, sep = "\t")
fwrite(qc, qc_path, sep = "\t")

cat(sprintf(
  paste0(
    "prepared %s genes x %d mice from %d author-selected VMH cells ",
    "(%d passed published QC); ",
    "female=%d male=%d; library sizes %.3fM-%.3fM; exact count conservation\n"
  ),
  format(nrow(pseudobulk), big.mark = ",", scientific = FALSE), ncol(pseudobulk),
  sum(qc$author_vm_cells), sum(qc$paper_qc_cells),
  sum(design$condition == "female"), sum(design$condition == "male"),
  min(qc$library_size) / 1e6, max(qc$library_size) / 1e6
))
