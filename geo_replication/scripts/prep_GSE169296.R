#!/usr/bin/env Rscript

# Prepare the fallback GSE169296 contrast:
# male rat paraventricular nucleus at PD44, adolescent restraint stress vs nonstress.

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
dataset_dir <- file.path(root, "datasets", "GSE169296_rnor_pvn_adolescent_stress")
count_path <- file.path(dataset_dir, "raw", "GSE169296_Male_control_and_stress_PVN.csv.gz")
soft_path <- file.path(dataset_dir, "metadata", "GSE169296_family.soft.gz")

sources <- data.frame(
  file = c(basename(count_path), basename(soft_path)),
  relative_path = c(
    "raw/GSE169296_Male_control_and_stress_PVN.csv.gz",
    "metadata/GSE169296_family.soft.gz"
  ),
  bytes = c(5241748, 8978),
  sha256 = c(
    "c79f885cbb18f40b99fc3a888a5903a3f0af1f785422627df42a17b0fe708750",
    "5a91045d3457a334c31170f2df1d5d26c24c7131839c8a022aa56dbb9d02c6f4"
  ),
  source = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE169nnn/GSE169296/suppl/GSE169296_Male_control_and_stress_PVN.csv.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE169nnn/GSE169296/soft/GSE169296_family.soft.gz"
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

sample <- c("M9PVN", "M17PVN", "M24PVN", "M2PVN", "M11PVN", "M12PVN")
animal <- c("M9", "M17", "M24", "M2", "M11", "M12")
geo_accession <- c("GSM5194743", "GSM5194753", "GSM5194758", "GSM5194739", "GSM5194747", "GSM5194750")
group <- rep(c("control", "case"), each = 3L)
replicate <- rep(1:3, 2L)
condition <- c(rep("nonstress", 3L), rep("adolescent_restraint_stress_pd32_pd44", 3L))
title <- c(
  "M9 PVN_nonstressRep1", "M17 PVN_nonstressRep2", "M24 PVN_nonstressRep3",
  "M2 PVN_stressRep1", "M11 PVN_stressRep2", "M12 PVN_stressRep3"
)
source_prefix <- c(
  "control - M9PVN_TCTACGAC trimmed (paired) RNA DNA (GE)",
  "control - M17PVN_GACCTTAG RNA DNA (GE)",
  "control - M24PVN_TGACAGAC RNA DNA (GE)",
  "stress - M2PVN_TGCTGATA trimmed (paired) RNA DNA (GE)",
  "stress - M11PVN_TCATTGAG trimmed (paired) RNA DNA (GE)",
  "stress - M12PVN_TCCTCAAT RNA DNA (GE)"
)
source_column <- paste0(source_prefix, " - Expression values")

soft <- readLines(gzfile(soft_path), warn = FALSE)
if (sum(grepl("^\\^SAMPLE = ", soft)) != 108L ||
    !"^SERIES = GSE169296" %in% soft ||
    !"!Series_type = Expression profiling by high throughput sequencing" %in% soft) {
  stop("GSE169296 family SOFT series structure changed")
}
for (i in seq_along(sample)) {
  block <- soft_block(soft, geo_accession[[i]])
  deposited_group <- if (group[[i]] == "control") "nonstress" else "stress"
  required <- c(
    paste0("!Sample_title = ", title[[i]]),
    "!Sample_organism_ch1 = Rattus norvegicus",
    "!Sample_source_name_ch1 = brain punches",
    "!Sample_characteristics_ch1 = strain: Sprague Dawley",
    "!Sample_characteristics_ch1 = postnatal day (pd): PD44",
    paste0("!Sample_characteristics_ch1 = group: ", deposited_group),
    "!Sample_characteristics_ch1 = Sex: male",
    "!Sample_characteristics_ch1 = brain region: paraventricular nucleus of the hypothalamus",
    "!Sample_library_strategy = RNA-Seq"
  )
  if (!all(required %in% block)) stop("authoritative SOFT metadata changed for ", geo_accession[[i]])
}

raw <- read.csv(gzfile(count_path), check.names = FALSE, stringsAsFactors = FALSE)
expression_columns <- grep(" - Expression values$", names(raw), value = TRUE)
gene_id_columns <- grep(" - Gene ID$", names(raw), value = TRUE)
unique_read_columns <- grep(" - Unique gene reads$", names(raw), value = TRUE)
if (nrow(raw) != 32623L || ncol(raw) != 144L ||
    !identical(expression_columns, source_column) ||
    length(gene_id_columns) != 6L || length(unique_read_columns) != 6L) {
  stop("deposited CLC export dimensions or sample-column schema changed")
}

ids <- as.character(raw[[gene_id_columns[[1L]]]])
for (column in gene_id_columns[-1L]) {
  if (!identical(ids, as.character(raw[[column]]))) {
    stop("sample-specific Ensembl gene-ID columns are not identical")
  }
}
if (any(!grepl("^ENSRNOG[0-9]+$", ids)) || anyDuplicated(ids)) {
  stop("Ensembl gene identifiers are empty, malformed, or duplicated")
}
for (i in seq_along(source_column)) {
  if (!identical(as.numeric(raw[[source_column[[i]]]]), as.numeric(raw[[unique_read_columns[[i]]]]))) {
    stop("Expression values no longer equal Unique gene reads for ", sample[[i]])
  }
}

counts <- as.matrix(raw[source_column])
colnames(counts) <- sample
storage.mode(counts) <- "numeric"
assert_integer_counts(counts)
expected_library_size <- c(5722197, 9032951, 6325827, 7347978, 7013494, 9320658)
expected_detected <- c(14334L, 16569L, 15703L, 16226L, 15585L, 16042L)
if (!identical(as.numeric(colSums(counts)), expected_library_size) ||
    !identical(as.integer(colSums(counts > 0)), expected_detected)) {
  stop("deposited library sizes or detected-gene counts changed")
}
if (any(table(group) < 3L) || anyDuplicated(animal)) {
  stop("contrast does not retain three unique biological rats per arm")
}

out_counts <- data.frame(Ensembl_geneID = ids, counts, check.names = FALSE)
out_path <- file.path(dataset_dir, "raw", "GSE169296_counts.tsv.gz")
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
  source_column = source_column,
  sex = "male",
  age = "PD44",
  tissue = "paraventricular_nucleus",
  analysis_keep = TRUE,
  stringsAsFactors = FALSE
)
write.table(
  samplesheet,
  file.path(dataset_dir, "metadata", "GSE169296_samplesheet.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE
)

output_library_size <- as.numeric(colSums(as.matrix(out_counts[sample])))
qc <- data.frame(
  sample = sample,
  geo_accession = geo_accession,
  group = group,
  biological_replicate = replicate,
  animal = animal,
  source_column = source_column,
  source_column_present = source_column %in% names(raw),
  unique_biological_unit = !duplicated(animal),
  expression_equals_unique_gene_reads = TRUE,
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
         qc$expression_equals_unique_gene_reads & qc$nonnegative_integer_counts &
         qc$count_conservation_delta == 0)) {
  stop("sample, biological-unit, integer-count, or count-conservation QC failed")
}
write.table(
  qc,
  file.path(dataset_dir, "processed", "GSE169296_preprocessing_qc.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE
)
write.table(
  sources[c("file", "bytes", "sha256", "source", "fetched")],
  file.path(dataset_dir, "metadata", "GSE169296_source_files.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE
)

cat(sprintf(
  "GSE169296: wrote %d genes x %d independent male-rat PVN libraries (nonstress=%d, stress=%d); library sizes %.1fM-%.1fM; exact count conservation\n",
  nrow(counts), ncol(counts), sum(group == "control"), sum(group == "case"),
  min(colSums(counts)) / 1e6, max(colSums(counts)) / 1e6
))
