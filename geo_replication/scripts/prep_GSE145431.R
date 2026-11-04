#!/usr/bin/env Rscript

# Prepare the deposited raw-count contrast for GSE145431:
# male rat paraventricular nucleus, 24 h furosemide/low-sodium depletion vs control.

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
dataset_dir <- file.path(root, "datasets", "GSE145431_rnor_pvn_sodium_depletion")
count_path <- file.path(dataset_dir, "raw", "GSE145431_Control_vs_furo_raw.counts.txt.gz")
soft_path <- file.path(dataset_dir, "metadata", "GSE145431_family.soft.gz")

sources <- data.frame(
  file = c(basename(count_path), basename(soft_path)),
  relative_path = c(
    "raw/GSE145431_Control_vs_furo_raw.counts.txt.gz",
    "metadata/GSE145431_family.soft.gz"
  ),
  bytes = c(309618, 2908),
  sha256 = c(
    "1a3cdb4d509652be995c7c5e76d92658a17075552253084da9fb51aae85bb90a",
    "63f86938369c2279918481814a5a7a2adb136f6ad17329637b348d3c2220e68b"
  ),
  source = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE145nnn/GSE145431/suppl/GSE145431_Control_vs_furo_raw.counts.txt.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE145nnn/GSE145431/soft/GSE145431_family.soft.gz"
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

sample <- c(paste0("Control", 1:3), paste0("Furo", 1:3))
geo_accession <- paste0("GSM", 4318357:4318362)
group <- rep(c("control", "case"), each = 3L)
replicate <- rep(1:3, 2L)
condition <- c(rep("control", 3L), rep("furosemide_10mgkg_low_sodium_24h", 3L))
title <- c(
  paste0("PVN, Control, rep", 1:3),
  paste0("PVN, Furosemide (10mg/kg), rep", 1:3)
)
treatment <- c(rep("control", 3L), rep("Furosemide", 3L))

soft <- readLines(gzfile(soft_path), warn = FALSE)
if (sum(grepl("^\\^SAMPLE = ", soft)) != 6L ||
    !"^SERIES = GSE145431" %in% soft ||
    !"!Series_type = Expression profiling by high throughput sequencing" %in% soft) {
  stop("GSE145431 family SOFT series structure changed")
}
for (i in seq_along(sample)) {
  block <- soft_block(soft, geo_accession[[i]])
  required <- c(
    paste0("!Sample_title = ", title[[i]]),
    "!Sample_organism_ch1 = Rattus norvegicus",
    "!Sample_characteristics_ch1 = tissue: Paraventricular Nucleus",
    paste0("!Sample_characteristics_ch1 = treatment: ", treatment[[i]]),
    "!Sample_characteristics_ch1 = pooled: n=3 Pooled",
    "!Sample_characteristics_ch1 = Sex: Male",
    "!Sample_library_strategy = RNA-Seq"
  )
  if (!all(required %in% block)) stop("authoritative SOFT metadata changed for ", geo_accession[[i]])
}

raw <- read.delim(gzfile(count_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(names(raw), c("", "Furo1", "Furo2", "Furo3", "Control1", "Control2", "Control3")) ||
    nrow(raw) != 32402L) {
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

expected_library_size <- c(21443039, 21669388, 20911950, 22495415, 21950410, 22247782)
expected_detected <- c(20267L, 20366L, 20202L, 20303L, 20325L, 20343L)
if (!identical(as.numeric(colSums(counts)), expected_library_size) ||
    !identical(as.integer(colSums(counts > 0)), expected_detected)) {
  stop("deposited library sizes or detected-gene counts changed")
}
biological_unit <- paste0(group, "_pool", replicate)
if (any(table(group) < 3L) || anyDuplicated(biological_unit)) {
  stop("contrast does not retain three independent animal pools per arm")
}

out_counts <- data.frame(Ensembl_geneID = ids, counts, check.names = FALSE)
out_path <- file.path(dataset_dir, "raw", "GSE145431_counts.tsv.gz")
con <- gzfile(out_path, "wt", compression = 9)
write.table(out_counts, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)

samplesheet <- data.frame(
  sample = sample,
  group = group,
  condition = condition,
  geo_accession = geo_accession,
  biological_replicate = replicate,
  biological_unit = biological_unit,
  animals_per_library = 3L,
  source_column = sample,
  sex = "male",
  tissue = "paraventricular_nucleus",
  analysis_keep = TRUE,
  stringsAsFactors = FALSE
)
write.table(
  samplesheet,
  file.path(dataset_dir, "metadata", "GSE145431_samplesheet.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE
)

output_library_size <- as.numeric(colSums(as.matrix(out_counts[sample])))
qc <- data.frame(
  sample = sample,
  geo_accession = geo_accession,
  group = group,
  biological_replicate = replicate,
  biological_unit = biological_unit,
  animals_per_library = 3L,
  source_column = sample,
  source_column_present = sample %in% names(raw),
  unique_biological_unit = !duplicated(biological_unit),
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
  file.path(dataset_dir, "processed", "GSE145431_preprocessing_qc.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE
)
write.table(
  sources[c("file", "bytes", "sha256", "source", "fetched")],
  file.path(dataset_dir, "metadata", "GSE145431_source_files.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE
)

cat(sprintf(
  "GSE145431: wrote %d genes x %d independent pooled-rat PVN libraries (control=%d, case=%d; 3 animals/library); library sizes %.1fM-%.1fM; exact count conservation\n",
  nrow(counts), ncol(counts), sum(group == "control"), sum(group == "case"),
  min(colSums(counts)) / 1e6, max(colSums(counts)) / 1e6
))
