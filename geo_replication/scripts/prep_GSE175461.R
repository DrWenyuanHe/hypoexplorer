#!/usr/bin/env Rscript

# Prepare the deposited raw-count contrast for GSE175461:
# male Wistar Han rat supraoptic nucleus, 72 h water deprivation vs euhydrated.

script_dir <- function() {
  arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
  if (length(arg) != 1L) stop("cannot resolve this script's path")
  dirname(normalizePath(sub("^--file=", "", arg[[1L]]), mustWork = TRUE))
}

sha256_file <- function(path) {
  path <- normalizePath(path, mustWork = TRUE)
  if (nzchar(Sys.which("sha256sum"))) {
    out <- system2(Sys.which("sha256sum"), shQuote(path), stdout = TRUE, stderr = TRUE)
  } else if (nzchar(Sys.which("shasum"))) {
    out <- system2(Sys.which("shasum"), c("-a", "256", shQuote(path)), stdout = TRUE, stderr = TRUE)
  } else if (nzchar(Sys.which("certutil"))) {
    out <- system2(Sys.which("certutil"), c("-hashfile", shQuote(path), "SHA256"), stdout = TRUE, stderr = TRUE)
  } else {
    stop("no SHA-256 implementation found (sha256sum, shasum, or certutil)")
  }
  hits <- unique(tolower(unlist(regmatches(
    out, gregexpr("[0-9A-Fa-f]{64}", out, perl = TRUE)
  ))))
  if (length(hits) != 1L) stop("could not parse exactly one SHA-256 digest for ", path)
  hits[[1L]]
}

soft_block <- function(lines, accession) {
  starts <- grep("^\\^SAMPLE = ", lines)
  ids <- sub("^\\^SAMPLE = ", "", lines[starts])
  hit <- match(accession, ids)
  if (is.na(hit)) stop("sample absent from family SOFT: ", accession)
  ends <- c(starts[-1L] - 1L, length(lines))
  lines[starts[[hit]]:ends[[hit]]]
}

assert_integer_counts <- function(counts) {
  if (anyNA(counts) || any(!is.finite(counts)) || any(counts < 0) ||
      any(counts != round(counts))) {
    stop("count matrix contains missing, non-finite, negative, or fractional values")
  }
}

root <- normalizePath(file.path(script_dir(), ".."), mustWork = TRUE)
dataset_dir <- file.path(root, "datasets", "GSE175461_rnor_son_dehydration")
count_path <- file.path(dataset_dir, "raw", "GSE175461_Pauza_et_al_2021_J-Neuroendocrinology_Raw_read_counts.csv.gz")
soft_path <- file.path(dataset_dir, "metadata", "GSE175461_family.soft.gz")

sources <- data.frame(
  file = c(basename(count_path), basename(soft_path)),
  relative_path = c(
    "raw/GSE175461_Pauza_et_al_2021_J-Neuroendocrinology_Raw_read_counts.csv.gz",
    "metadata/GSE175461_family.soft.gz"
  ),
  bytes = c(469508, 3448),
  sha256 = c(
    "63fe5a34520d7b706bcb571ed5f091638a6d9df6d43c70527f600109f68478ae",
    "c06aa1c85bc106d33217ceaaf9b603039686950ac0c8c2bd5de4853cafbba8f0"
  ),
  source = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE175nnn/GSE175461/suppl/GSE175461_Pauza_et_al_2021_J-Neuroendocrinology_Raw_read_counts.csv.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE175nnn/GSE175461/soft/GSE175461_family.soft.gz"
  ),
  fetched = "2026-08-31",
  stringsAsFactors = FALSE
)
for (i in seq_len(nrow(sources))) {
  path <- file.path(dataset_dir, sources$relative_path[[i]])
  if (!file.exists(path)) stop("missing source file: ", path)
  if (file.info(path)$size != sources$bytes[[i]]) stop("source byte size changed: ", path)
  if (sha256_file(path) != sources$sha256[[i]]) stop("source SHA-256 changed: ", path)
}

sample <- c(paste0("Sample_C", 1:5), paste0("Sample_D", 1:5))
geo_accession <- paste0("GSM", 5334786:5334795)
group <- rep(c("control", "case"), each = 5L)
replicate <- rep(1:5, 2L)
condition <- c(rep("euhydrated", 5L), rep("water_deprived_72h", 5L))
title <- c(
  paste0("Wistar_SON_euhydrated_rep", 1:5),
  paste0("Wistar_SON_dehydrated_rep", 1:5)
)
source_library_token <- c(
  "Sample_C1_S62", "Sample_C2_S63", "Sample_C4_S64", "Sample_C5_S65", "Sample_C6_S66",
  "Sample_D1_S67", "Sample_D2_S68", "Sample_D3_S69", "Sample_D4_S70", "Sample_D5_S71"
)
treatment <- c(rep("Euhydrated (control)", 5L), rep("72h dehydrated", 5L))

soft <- readLines(gzfile(soft_path), warn = FALSE)
if (sum(grepl("^\\^SAMPLE = ", soft)) != 10L ||
    !"^SERIES = GSE175461" %in% soft ||
    !"!Series_type = Expression profiling by high throughput sequencing" %in% soft) {
  stop("GSE175461 family SOFT series structure changed")
}
for (i in seq_along(sample)) {
  block <- soft_block(soft, geo_accession[[i]])
  required <- c(
    paste0("!Sample_title = ", title[[i]]),
    "!Sample_organism_ch1 = Rattus norvegicus",
    "!Sample_source_name_ch1 = Hypothalamic supraoptic nucleus (SON)",
    "!Sample_characteristics_ch1 = brain region: Supraoptic nucleus",
    paste0("!Sample_characteristics_ch1 = treatment: ", treatment[[i]]),
    paste0("!Sample_description = ", source_library_token[[i]]),
    "!Sample_library_strategy = RNA-Seq"
  )
  if (!all(required %in% block)) stop("authoritative SOFT metadata changed for ", geo_accession[[i]])
}

raw <- read.csv(gzfile(count_path), check.names = FALSE, stringsAsFactors = FALSE)
if (ncol(raw) != 11L || !identical(names(raw)[-1L], sample) || nrow(raw) != 32402L) {
  stop("deposited count-matrix dimensions or header changed")
}
names(raw)[[1L]] <- "Ensembl_geneID"
ids <- as.character(raw$Ensembl_geneID)
if (any(!grepl("^ENSRNOG[0-9]+$", ids)) || anyDuplicated(ids)) {
  stop("Ensembl gene identifiers are empty, malformed, or duplicated")
}
counts <- as.matrix(raw[sample])
storage.mode(counts) <- "numeric"
assert_integer_counts(counts)

expected_library_size <- c(27770506, 27742844, 28491926, 25605517, 27366963,
                           27641153, 25901087, 27329709, 24268398, 25059362)
expected_detected <- c(18899L, 18931L, 18969L, 18709L, 18772L,
                       18873L, 18752L, 18892L, 18771L, 18815L)
if (!identical(as.numeric(colSums(counts)), expected_library_size) ||
    !identical(as.integer(colSums(counts > 0)), expected_detected)) {
  stop("deposited library sizes or detected-gene counts changed")
}
if (any(table(group) < 3L) || anyDuplicated(paste(group, replicate))) {
  stop("contrast does not retain at least three unique biological replicates per arm")
}

out_counts <- data.frame(Ensembl_geneID = ids, counts, check.names = FALSE)
out_path <- file.path(dataset_dir, "raw", "GSE175461_counts.tsv.gz")
con <- gzfile(out_path, "wt", compression = 9)
write.table(out_counts, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)

samplesheet <- data.frame(
  sample = sample,
  group = group,
  condition = condition,
  geo_accession = geo_accession,
  biological_replicate = replicate,
  source_column = sample,
  source_library_token = source_library_token,
  sex = "male",
  tissue = "supraoptic_nucleus",
  analysis_keep = TRUE,
  stringsAsFactors = FALSE
)
write.table(
  samplesheet,
  file.path(dataset_dir, "metadata", "GSE175461_samplesheet.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE
)

output_library_size <- as.numeric(colSums(as.matrix(out_counts[sample])))
qc <- data.frame(
  sample = sample,
  geo_accession = geo_accession,
  group = group,
  biological_replicate = replicate,
  source_column = sample,
  source_column_present = sample %in% names(raw),
  unique_biological_unit = !duplicated(paste(group, replicate)),
  source_gene_rows = nrow(counts),
  output_gene_rows = nrow(out_counts),
  detected_genes = as.integer(colSums(counts > 0)),
  library_size_source = as.numeric(colSums(counts)),
  library_size_output = output_library_size,
  count_conservation_delta = output_library_size - as.numeric(colSums(counts)),
  nonnegative_integer_counts = TRUE,
  analysis_keep = TRUE,
  stringsAsFactors = FALSE
)
if (!all(qc$source_column_present & qc$unique_biological_unit &
         qc$nonnegative_integer_counts & qc$count_conservation_delta == 0)) {
  stop("sample, biological-unit, integer-count, or count-conservation QC failed")
}
write.table(
  qc,
  file.path(dataset_dir, "processed", "GSE175461_preprocessing_qc.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE
)
write.table(
  sources[c("file", "bytes", "sha256", "source", "fetched")],
  file.path(dataset_dir, "metadata", "GSE175461_source_files.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE
)

cat(sprintf(
  "GSE175461: wrote %d genes x %d independent rat SON libraries (control=%d, case=%d); library sizes %.1fM-%.1fM; exact count conservation\n",
  nrow(counts), ncol(counts), sum(group == "control"), sum(group == "case"),
  min(colSums(counts)) / 1e6, max(colSums(counts)) / 1e6
))
