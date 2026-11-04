#!/usr/bin/env Rscript

script_arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
if (length(script_arg) != 1L) stop("cannot resolve this script's path")
script_dir <- dirname(normalizePath(sub("^--file=", "", script_arg)))
source(file.path(script_dir, "prep_per_sample_gene_counts.R"))
root <- normalizePath(file.path(script_dir, ".."))
dataset_dir <- file.path(root, "datasets", "GSE275887_mmus_hypothalamic_cells_mogroside")

inventory <- sprintf("GSM%d_MO%dcount.txt.gz", 8487264 + 1:24, 1:24)
selected <- c(1:3, 10:12)
samples <- data.frame(
  sample = sprintf("GSM%d", c(8487265:8487267, 8487274:8487276)),
  group = c(rep("control", 3L), rep("case", 3L)),
  condition = c(rep("normal_glucose_vehicle", 3L), rep("normal_glucose_mogrosideV_160uM", 3L)),
  replicate = rep(1:3, 2L), source_file = inventory[selected],
  expected_title = c(paste0("NGC_", 1:3), paste0("NG3_", 1:3)),
  stringsAsFactors = FALSE
)
samples$required_soft <- replicate(nrow(samples), c(
  "!Sample_source_name_ch1 = hypothalamic cells",
  "!Sample_characteristics_ch1 = cell line: hypothalamic cells"
), simplify = FALSE)

prepare_per_sample_gene_counts(list(
  accession = "GSE275887", dataset_dir = dataset_dir,
  archive_path = file.path(dataset_dir, "raw", "source", "GSE275887_RAW.tar"),
  archive_bytes = 4597760, soft_path = file.path(dataset_dir, "metadata", "GSE275887_family.soft.gz"),
  soft_bytes = 3441, expected_inventory = inventory, samples = samples, expected_rows = 56946,
  expected_library_sizes = c(5210198, 4206607, 4221399, 3945481, 4310446, 3792926),
  expected_detected_genes = c(18672, 18169, 18205, 17342, 17899, 16535),
  counts_path = file.path(dataset_dir, "raw", "GSE275887_NG3_vs_NGC_counts.tsv.gz"),
  samplesheet_path = file.path(dataset_dir, "metadata", "GSE275887_samplesheet.tsv"),
  qc_path = file.path(dataset_dir, "processed", "GSE275887_preprocessing_qc.tsv")
))
