#!/usr/bin/env Rscript

# Regression validator for the author-documented L13 condition override and
# exact count conservation in the committed GSE174085 source-batch pseudobulk.

suppressPackageStartupMessages(library(data.table))

dir <- file.path(
  "geo_replication", "datasets", "GSE174085_mmus_pvn_crh_ela_scrna"
)
supplement_path <- file.path(dir, "raw", "GSE174085_author_Supplement.pdf")
manifest_path <- file.path(dir, "metadata", "GSE174085_source_files.tsv")
samplesheet_path <- file.path(dir, "metadata", "GSE174085_samplesheet.tsv")
counts_path <- file.path(dir, "raw", "GSE174085_animal_pseudobulk_counts.tsv.gz")
qc_path <- file.path(dir, "processed", "GSE174085_preprocessing_qc.tsv")

required <- c(supplement_path, manifest_path, samplesheet_path, counts_path, qc_path)
if (any(!file.exists(required))) {
  stop("GSE174085 validator inputs are incomplete")
}
if (!requireNamespace("openssl", quietly = TRUE)) {
  stop("the openssl R package is required to authenticate the author supplement")
}

supplement_connection <- file(supplement_path, "rb")
supplement_sha256 <- tryCatch(
  unclass(as.character(openssl::sha256(supplement_connection))),
  finally = close(supplement_connection)
)
expected_sha256 <-
  "7627060f875b87ca8a0fd94fb0952bdff0d81c4257fea80d1509759d1217f14a"
manifest <- fread(manifest_path)
manifest_row <- manifest[file == basename(supplement_path)]
if (nrow(manifest_row) != 1L || supplement_sha256 != expected_sha256 ||
    manifest_row$sha256 != expected_sha256 ||
    manifest_row$bytes != file.info(supplement_path)$size) {
  stop("pinned author supplement does not match its source-manifest provenance")
}

samples <- fread(samplesheet_path)
qc <- fread(qc_path)
counts <- fread(counts_path)
needed_sample_fields <- c(
  "sample", "group", "deposited_condition", "condition", "condition_source"
)
if (!all(needed_sample_fields %in% names(samples))) {
  stop("samplesheet lacks author-override provenance fields")
}
l13 <- samples[sample == "L13"]
if (nrow(samples) != 24L || sum(samples$group == "control") != 14L ||
    sum(samples$group == "case") != 10L || nrow(l13) != 1L ||
    l13$deposited_condition != "CTL" || l13$condition != "ELA" ||
    l13$group != "case" ||
    !grepl("Supplementary Table S1", l13$condition_source, fixed = TRUE)) {
  stop("L13 is not the provenance-documented case assignment in a 14/10 design")
}

sample_columns <- names(counts)[-1L]
if (!identical(sample_columns, samples$sample) ||
    !identical(sample_columns, qc$sample)) {
  stop("pseudobulk, samplesheet, and QC sample order differ")
}
count_matrix <- as.matrix(counts[, -1L])
storage.mode(count_matrix) <- "double"
library_sizes <- colSums(count_matrix)
if (!identical(as.numeric(library_sizes), as.numeric(qc$library_size)) ||
    any(qc$count_conservation_delta != 0) ||
    !identical(as.numeric(sum(library_sizes)), as.numeric(sum(qc$library_size)))) {
  stop("pseudobulk counts are not exactly conserved in preprocessing QC")
}

cat(sprintf(
  paste0(
    "validated GSE174085: L13 deposited=CTL, author=LBN/ELA, group=case; ",
    "control=14 case=10; %s total pseudobulk counts conserved exactly\n"
  ),
  format(sum(library_sizes), big.mark = ",", scientific = FALSE)
))
