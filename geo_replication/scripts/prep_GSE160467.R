#!/usr/bin/env Rscript

script_arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
if (length(script_arg) != 1L) stop("cannot resolve this script's path")
script_dir <- dirname(normalizePath(sub("^--file=", "", script_arg)))
source(file.path(script_dir, "prep_per_sample_gene_counts.R"))
root <- normalizePath(file.path(script_dir, ".."))
dataset_dir <- file.path(root, "datasets", "GSE160467_mmus_gt17_mkrn3")

files <- c(
  "GSM4873737_control_1_counts.txt.gz", "GSM4873738_control_2_counts.txt.gz",
  "GSM4873739_control_3_counts.txt.gz", "GSM4873740_MKRN3_1_counts.txt.gz",
  "GSM4873741_MKRN3_2_counts.txt.gz", "GSM4873742_MKRN3_3_counts.txt.gz"
)
samples <- data.frame(
  sample = sprintf("GSM%d", 4873737:4873742),
  group = c(rep("control", 3L), rep("case", 3L)),
  condition = c(rep("wild_type", 3L), rep("mkrn3_overexpression", 3L)),
  replicate = rep(1:3, 2L), source_file = files,
  expected_title = c(paste0("control_", 1:3), paste0("MKRN3_", 1:3)),
  stringsAsFactors = FALSE
)
samples$required_soft <- lapply(seq_len(nrow(samples)), function(i) c(
  "!Sample_source_name_ch1 = GT1-7 cells",
  "!Sample_characteristics_ch1 = tissue: Hypothalamic neuronal cell line",
  paste0("!Sample_characteristics_ch1 = genotype: ", if (samples$group[i] == "control") "wild-type" else "MKRN3 overexpressed GT1-7")
))

prepare_per_sample_gene_counts(list(
  accession = "GSE160467", dataset_dir = dataset_dir,
  archive_path = file.path(dataset_dir, "raw", "source", "GSE160467_RAW.tar"),
  archive_bytes = 993280, soft_path = file.path(dataset_dir, "metadata", "GSE160467_family.soft.gz"),
  soft_bytes = 2685, expected_inventory = files, samples = samples, expected_rows = 55381,
  expected_library_sizes = c(9391731, 8681258, 8112006, 8817994, 6443116, 9221624),
  expected_detected_genes = c(12113, 12390, 11806, 13344, 13649, 13787),
  counts_path = file.path(dataset_dir, "raw", "GSE160467_MKRN3_vs_WT_counts.tsv.gz"),
  samplesheet_path = file.path(dataset_dir, "metadata", "GSE160467_samplesheet.tsv"),
  qc_path = file.path(dataset_dir, "processed", "GSE160467_preprocessing_qc.tsv")
))
