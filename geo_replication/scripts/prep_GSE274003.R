suppressMessages({
  library(data.table)
  library(digest)
})

dataset_id <- "GSE274003"
dataset_dir <- file.path(
  "geo_replication", "datasets", "GSE274003_psun_mbh_photoperiod"
)
raw_path <- file.path(
  dataset_dir, "raw", "GSE274003_MBHExpressedGenesTranscripts.csv.gz"
)
soft_path <- file.path(dataset_dir, "metadata", "GSE274003_family.soft.gz")
listing_path <- file.path(
  dataset_dir, "metadata", "GSE274003_supplementary_listing.html"
)
output_path <- file.path(
  dataset_dir, "raw",
  "GSE274003_MBH_LD_vs_4wkSD_mouse_projection_count_estimates.tsv.gz"
)
samplesheet_path <- file.path(
  dataset_dir, "metadata", "GSE274003_samplesheet.tsv"
)
qc_path <- file.path(
  dataset_dir, "processed", "GSE274003_preprocessing_qc.tsv"
)
manifest_path <- file.path(
  dataset_dir, "metadata", "GSE274003_source_files.tsv"
)

stopifnot(file.exists(raw_path), file.exists(soft_path), file.exists(listing_path))
dir.create(file.path(dataset_dir, "processed"), recursive = TRUE, showWarnings = FALSE)

# The official CSV contains one row per author-quantified transcript. Sample
# values are Salmon count estimates and are intentionally retained as doubles.
x <- as.data.table(read.csv(gzfile(raw_path), check.names = FALSE))
stopifnot(nrow(x) == 91460L, ncol(x) == 58L)
stopifnot(all(c("gene_id", "feature_id", "Reference") %in% names(x)))
stopifnot(!anyNA(x$gene_id), all(nzchar(x$gene_id)))

control_animals <- c("417", "205", "248", "247", "238", "141")
case_animals <- c("356", "333", "332", "351", "352", "314")
animal_ids <- c(control_animals, case_animals)
source_columns <- animal_ids
sample_names <- paste0("MBH", animal_ids)
stopifnot(all(source_columns %in% names(x)))

for (sample in source_columns) {
  values <- x[[sample]]
  stopifnot(is.numeric(values), all(is.finite(values)), all(values >= 0))
}

source_values <- as.matrix(x[, ..source_columns])
storage.mode(source_values) <- "double"
source_sums <- colSums(source_values)
source_fractional <- colSums(abs(source_values - round(source_values)) > 1e-10)

# The author projected reads to Mus musculus GRCm39 before Salmon
# quantification. Collapse transcript estimates to the supplied mouse gene
# symbols without rounding or attempting a new orthology transformation.
counts <- x[, lapply(.SD, sum), by = gene_id, .SDcols = source_columns]
setnames(counts, "gene_id", "symbol")
setnames(counts, source_columns, sample_names)
setcolorder(counts, c("symbol", sample_names))
stopifnot(nrow(counts) == uniqueN(x$gene_id), !anyDuplicated(counts$symbol))
stopifnot(all(is.finite(as.matrix(counts[, ..sample_names]))))
stopifnot(all(as.matrix(counts[, ..sample_names]) >= 0))

collapsed_values <- as.matrix(counts[, ..sample_names])
storage.mode(collapsed_values) <- "double"
partition_delta <- source_sums - colSums(collapsed_values)
stopifnot(all(abs(partition_delta) < pmax(1e-7, abs(source_sums) * 1e-12)))
fwrite(counts, output_path, sep = "\t", compress = "gzip")

# Reconstruct the accession-to-animal mapping from official SOFT sample blocks.
soft <- readLines(gzfile(soft_path), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft)
ends <- c(starts[-1L] - 1L, length(soft))
gsm <- sub("^\\^SAMPLE = ", "", soft[starts])

extract_one <- function(block, pattern, replacement = "\\1") {
  hits <- grep(pattern, block, value = TRUE)
  stopifnot(length(hits) == 1L)
  sub(pattern, replacement, hits)
}

sample_meta <- rbindlist(lapply(seq_along(starts), function(i) {
  block <- soft[starts[i]:ends[i]]
  if (!any(grepl("cell type: Medio-Basal Hypothalamus Microdissection", block))) {
    return(NULL)
  }
  description <- grep("^!Sample_description = MBH[0-9]+$", block, value = TRUE)
  stopifnot(length(description) == 1L)
  data.table(
    geo_accession = gsm[i],
    title = extract_one(block, "^!Sample_title = (.*)$"),
    animal_id = sub("^!Sample_description = MBH", "", description)
  )
}))
stopifnot(nrow(sample_meta) == 54L, !anyDuplicated(sample_meta$animal_id))

selected <- sample_meta[match(animal_ids, animal_id)]
stopifnot(!anyNA(selected$geo_accession))
expected_gsm <- c(
  "GSM8441496", "GSM8441505", "GSM8441514", "GSM8441523", "GSM8441532", "GSM8441541",
  "GSM8441497", "GSM8441506", "GSM8441515", "GSM8441524", "GSM8441533", "GSM8441542"
)
stopifnot(identical(selected$geo_accession, expected_gsm))
stopifnot(all(grepl(", LD,", selected$title[seq_along(control_animals)])))
stopifnot(all(grepl(", 4wk SD,", selected$title[length(control_animals) + seq_along(case_animals)])))

samples <- data.table(
  sample = sample_names,
  group = c(rep("control", length(control_animals)), rep("case", length(case_animals))),
  geo_accession = selected$geo_accession,
  animal_id = selected$animal_id,
  title = selected$title,
  condition = c(rep("long day", 6L), rep("4 weeks short day", 6L)),
  tissue = "medio-basal hypothalamus microdissection",
  source_organism = "Cricetiscus sungorus (Siberian hamster)",
  analysis_feature_space = "author-aligned Mus musculus GRCm39 gene symbols"
)
fwrite(samples, samplesheet_path, sep = "\t")

qc <- data.table(
  sample = sample_names,
  group = samples$group,
  geo_accession = samples$geo_accession,
  source_transcript_rows = nrow(x),
  collapsed_gene_rows = nrow(counts),
  blank_gene_ids = sum(is.na(x$gene_id) | !nzchar(x$gene_id)),
  duplicated_source_gene_rows = sum(duplicated(x$gene_id)),
  source_fractional_values = source_fractional,
  collapsed_fractional_values = colSums(abs(collapsed_values - round(collapsed_values)) > 1e-10),
  source_sum = source_sums,
  collapsed_sum = colSums(collapsed_values),
  partition_delta,
  detected_collapsed_genes = colSums(collapsed_values > 0),
  accepted_input_class = "author Salmon transcript count estimates",
  aggregation = "sum transcript estimates by author-supplied mouse gene symbol; no rounding",
  projection_authority = "official SOFT: Minimap2 alignment to Mus musculus GRCm39",
  shared_route = "input_kind=counts -> canonical edgeR-QL model"
)
fwrite(qc, qc_path, sep = "\t")

source_paths <- c(raw_path, soft_path, listing_path)
hash_file <- function(path) {
  digest(file = path, algo = "sha256", serialize = FALSE)
}
manifest <- data.table(
  file = basename(source_paths),
  bytes = file.info(source_paths)$size,
  sha256 = vapply(source_paths, hash_file, character(1)),
  role = c(
    "official GEO MBH Salmon transcript count-estimate matrix",
    "official GEO family metadata and author mouse-projection evidence",
    "official GEO supplementary-file listing"
  )
)
fwrite(manifest, manifest_path, sep = "\t")

cat(sprintf(
  "%s: %d transcript rows -> %d mouse-symbol genes; %d control vs %d case samples; fractional estimates preserved\n",
  dataset_id, nrow(x), nrow(counts), length(control_animals), length(case_animals)
))
