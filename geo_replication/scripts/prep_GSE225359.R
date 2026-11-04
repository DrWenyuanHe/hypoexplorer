#!/usr/bin/env Rscript

# Prepare one prespecified contrast from the GSE225359 MBH raw-count matrix:
# female rat mediobasal hypothalamus at P90, perinatal DES 12 ug/kg/day vs vehicle.

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
dataset_dir <- file.path(root, "datasets", "GSE225359_rnor_mbh_perinatal_des")
count_path <- file.path(dataset_dir, "raw", "GSE225359_mbh_merged_gene_counts.txt.gz")
soft_path <- file.path(dataset_dir, "metadata", "GSE225359_family.soft.gz")

sources <- data.frame(
  file = c(basename(count_path), basename(soft_path)),
  relative_path = c(
    "raw/GSE225359_mbh_merged_gene_counts.txt.gz",
    "metadata/GSE225359_family.soft.gz"
  ),
  bytes = c(3498534, 12795),
  sha256 = c(
    "5172e8c0132db828bc999530c52e2955909d4dd5fd01cb517166935ffd8feafb",
    "412455c6f49185151f37ee061521a5c23e14d3ae7992d15c01beb9b31d6e8c42"
  ),
  source = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE225nnn/GSE225359/suppl/GSE225359_mbh_merged_gene_counts.txt.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE225nnn/GSE225359/soft/GSE225359_family.soft.gz"
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

sample <- c(
  "101M-C-P90", "119M-C-P90", "185M-C-P90", "200M-C-P90", "315M-C-P90",
  "145M-D12-P90", "192M-D12-P90", "205M-D12-P90", "206M-D12-P90", "331M-D12-P90"
)
geo_accession <- c(
  "GSM7047238", "GSM7047248", "GSM7047266", "GSM7047270", "GSM7047320",
  "GSM7047258", "GSM7047268", "GSM7047273", "GSM7047274", "GSM7047322"
)
group <- rep(c("control", "case"), each = 5L)
replicate <- rep(1:5, 2L)
condition <- c(rep("perinatal_vehicle_p90", 5L), rep("perinatal_des_12ugkgday_p90", 5L))
title <- c(
  paste0("MBH_P90_control_", 1:5),
  paste0("MBH_P90_DES 12_", 1:5)
)
treatment <- c(rep("vehicle", 5L), rep("DES 12 ug/kg bw/day", 5L))
animal <- sub("M-.*$", "", sample)

soft <- readLines(gzfile(soft_path), warn = FALSE)
if (sum(grepl("^\\^SAMPLE = ", soft)) != 210L ||
    !"^SERIES = GSE225359" %in% soft ||
    !"!Series_type = Expression profiling by high throughput sequencing" %in% soft) {
  stop("GSE225359 family SOFT series structure changed")
}
for (i in seq_along(sample)) {
  block <- soft_block(soft, geo_accession[[i]])
  required <- c(
    paste0("!Sample_title = ", title[[i]]),
    "!Sample_organism_ch1 = Rattus norvegicus",
    "!Sample_source_name_ch1 = medio-basal hypothalamus",
    "!Sample_characteristics_ch1 = Sex: female",
    "!Sample_characteristics_ch1 = tissue: medio-basal hypothalamus",
    "!Sample_characteristics_ch1 = age: P90",
    paste0("!Sample_characteristics_ch1 = treatment: ", treatment[[i]]),
    paste0("!Sample_description = ", sample[[i]]),
    "!Sample_library_strategy = RNA-Seq"
  )
  if (!all(required %in% block)) stop("authoritative SOFT metadata changed for ", geo_accession[[i]])
}

raw <- read.delim(gzfile(count_path), check.names = FALSE, stringsAsFactors = FALSE)
if (nrow(raw) != 32883L || ncol(raw) != 107L ||
    !identical(names(raw)[1:2], c("Geneid", "gene_name")) ||
    !all(sample %in% names(raw))) {
  stop("deposited MBH count-matrix dimensions or header changed")
}
ids <- as.character(raw$Geneid)
if (any(!grepl("^ENSRNOG[0-9]+$", ids)) || anyDuplicated(ids)) {
  stop("Ensembl gene identifiers are empty, malformed, or duplicated")
}
counts <- as.matrix(raw[sample])
storage.mode(counts) <- "numeric"
assert_integer_counts(counts)

expected_library_size <- c(22416287, 19670500, 18128066, 16919455, 18271370,
                           21950162, 20594781, 15851452, 15405270, 14683787)
expected_detected <- c(18339L, 18324L, 18094L, 18237L, 18100L,
                       18188L, 18242L, 17821L, 17800L, 17736L)
if (!identical(as.numeric(colSums(counts)), expected_library_size) ||
    !identical(as.integer(colSums(counts > 0)), expected_detected)) {
  stop("deposited library sizes or detected-gene counts changed")
}
if (any(table(group) < 3L) || anyDuplicated(animal)) {
  stop("contrast does not retain five unique biological animals per arm")
}

out_counts <- data.frame(Ensembl_geneID = ids, counts, check.names = FALSE)
out_path <- file.path(dataset_dir, "raw", "GSE225359_counts.tsv.gz")
con <- gzfile(out_path, "wt", compression = 9)
write.table(out_counts, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)

samplesheet <- data.frame(
  sample = sample,
  group = group,
  condition = condition,
  geo_accession = geo_accession,
  biological_replicate = replicate,
  animal = animal,
  source_column = sample,
  sex = "female",
  age = "P90",
  tissue = "mediobasal_hypothalamus",
  exposure_window = "gestation_day_7_to_postnatal_day_22",
  analysis_keep = TRUE,
  stringsAsFactors = FALSE
)
write.table(
  samplesheet,
  file.path(dataset_dir, "metadata", "GSE225359_samplesheet.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE
)

output_library_size <- as.numeric(colSums(as.matrix(out_counts[sample])))
qc <- data.frame(
  sample = sample,
  geo_accession = geo_accession,
  group = group,
  biological_replicate = replicate,
  animal = animal,
  source_column = sample,
  source_column_present = sample %in% names(raw),
  unique_biological_unit = !duplicated(animal),
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
  file.path(dataset_dir, "processed", "GSE225359_preprocessing_qc.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE
)
write.table(
  sources[c("file", "bytes", "sha256", "source", "fetched")],
  file.path(dataset_dir, "metadata", "GSE225359_source_files.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE
)

cat(sprintf(
  "GSE225359: wrote %d genes x %d independent female-rat MBH libraries at P90 (vehicle=%d, DES12=%d); library sizes %.1fM-%.1fM; exact count conservation\n",
  nrow(counts), ncol(counts), sum(group == "control"), sum(group == "case"),
  min(colSums(counts)) / 1e6, max(colSums(counts)) / 1e6
))
