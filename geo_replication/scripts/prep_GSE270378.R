#!/usr/bin/env Rscript

script_arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
if (length(script_arg) != 1L) stop("cannot resolve this script's path")
script_dir <- dirname(normalizePath(sub("^--file=", "", script_arg)))
source(file.path(script_dir, "prep_per_sample_gene_counts.R"))
root <- normalizePath(file.path(script_dir, ".."))
dataset_dir <- file.path(root, "datasets", "GSE270378_mmus_mhypoa_cbd")

inventory <- sprintf("GSM%d_A%dcount.txt.gz", 8341496 + 1:30, 1:30)
selected <- c(28:30, 16:18)
samples <- data.frame(
  sample = sprintf("GSM%d", c(8341524:8341526, 8341512:8341514)),
  group = c(rep("control", 3L), rep("case", 3L)),
  condition = c(rep("vehicle_24h", 3L), rep("cbd_3uM_24h", 3L)),
  replicate = rep(1:3, 2L), source_file = inventory[selected],
  expected_title = c(paste0("A", 28:30, "_CTR_24h"), paste0("A", 16:18, "_CBD3_24h")),
  stringsAsFactors = FALSE
)
samples$required_soft <- lapply(seq_len(nrow(samples)), function(i) c(
  "!Sample_source_name_ch1 = hypothalamus",
  "!Sample_characteristics_ch1 = tissue: hypothalamus",
  "!Sample_characteristics_ch1 = cell line: Adult Mouse Hypothalamus Cell Line mHypoA-2/12",
  paste0("!Sample_characteristics_ch1 = treatment: ", if (samples$group[i] == "control") "CTR_24h" else "CBD3_24h")
))

prepare_per_sample_gene_counts(list(
  accession = "GSE270378", dataset_dir = dataset_dir,
  archive_path = file.path(dataset_dir, "raw", "source", "GSE270378_RAW.tar"),
  archive_bytes = 5703680, soft_path = file.path(dataset_dir, "metadata", "GSE270378_family.soft.gz"),
  soft_bytes = 3878, expected_inventory = inventory, samples = samples, expected_rows = 56946,
  expected_library_sizes = c(4162843, 3020841, 2942410, 2518615, 2365990, 2304492),
  expected_detected_genes = c(17971, 17858, 17902, 17382, 17091, 17155),
  counts_path = file.path(dataset_dir, "raw", "GSE270378_CBD3_24h_vs_CTR_24h_counts.tsv.gz"),
  samplesheet_path = file.path(dataset_dir, "metadata", "GSE270378_samplesheet.tsv"),
  qc_path = file.path(dataset_dir, "processed", "GSE270378_preprocessing_qc.tsv")
))
