suppressMessages({
  library(data.table)
  library(digest)
})

root <- file.path("geo_replication", "datasets", "GSE231617_rat_son_aging")
source_path <- file.path(root, "raw", "GSE231616_depthNormCount_G2020_97.csv.gz")
soft_path <- file.path(root, "metadata", "GSE231616_family.soft.gz")
out_path <- file.path(root, "raw", "GSE231617_son_log2_depth_normalized_counts.tsv.gz")
sample_path <- file.path(root, "metadata", "GSE231617_samplesheet.tsv")
qc_path <- file.path(root, "processed", "GSE231617_preprocessing_qc.tsv")
manifest_path <- file.path(root, "metadata", "GSE231617_source_files.tsv")

stopifnot(file.exists(source_path), file.exists(soft_path))

source <- read.csv(source_path, check.names = FALSE, stringsAsFactors = FALSE)
sample_names <- c(paste0("SON_M35_", 1:4), paste0("SON_M125_", 1:4))
stopifnot(
  nrow(source) > 1000L,
  identical(names(source)[2:9], sample_names),
  identical(names(source)[10:11], c("SON_M35_Mean", "SON_M125_Mean"))
)

symbols <- trimws(as.character(source[[1L]]))
stopifnot(!anyNA(symbols), all(nzchar(symbols)), !anyDuplicated(symbols))
linear <- as.matrix(source[, sample_names, drop = FALSE])
storage.mode(linear) <- "double"
stopifnot(all(is.finite(linear)), all(linear >= 0))

# GEO documents these as DESeq2-normalized counts. They are continuous, not raw
# counts, so retain every submitted value and take the explicit normalized-
# matrix route after a single log2(x + 1) variance-stabilizing transform.
transformed <- log2(linear + 1)
stopifnot(all(is.finite(transformed)))
out <- data.table(symbol = symbols)
out[, (sample_names) := as.data.table(transformed)]
con <- gzfile(out_path, "wt")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)

soft <- readLines(gzfile(soft_path), warn = FALSE)
sample_starts <- grep("^\\^SAMPLE = ", soft)
sample_ends <- c(sample_starts[-1L] - 1L, length(soft))
sample_ids <- sub("^\\^SAMPLE = ", "", soft[sample_starts])
geo_accession <- paste0("GSM", 7291678:7291685)

one <- function(block, pattern, replacement = "\\1") {
  hit <- grep(pattern, block, value = TRUE)
  stopifnot(length(hit) == 1L)
  sub(pattern, replacement, hit)
}

biosample <- sra_experiment <- title <- character(length(geo_accession))
for (i in seq_along(geo_accession)) {
  j <- match(geo_accession[i], sample_ids)
  stopifnot(!is.na(j))
  block <- soft[sample_starts[j]:sample_ends[j]]
  title[i] <- one(block, "^!Sample_title = (.*)$")
  biosample[i] <- one(block, ".*/biosample/(SAMN[0-9]+)$")
  sra_experiment[i] <- one(block, ".*term=(SRX[0-9]+)$")
}
stopifnot(identical(title, sample_names), !anyDuplicated(biosample), !anyDuplicated(sra_experiment))

samples <- data.table(
  sample = sample_names,
  group = c(rep("control", 4L), rep("case", 4L)),
  geo_accession,
  biosample,
  sra_experiment,
  title,
  age_days = c(rep(35L, 4L), rep(125L, 4L)),
  tissue = "supraoptic nucleus",
  sex = "male",
  strain = "Sprague Dawley",
  biological_unit = "pool of supraoptic nuclei from four rats"
)
fwrite(samples, sample_path, sep = "\t")

qc <- data.table(
  sample = sample_names,
  group = samples$group,
  source_rows = nrow(linear),
  output_rows = nrow(out),
  blank_ids = 0L,
  duplicate_ids = 0L,
  nonfinite_values = colSums(!is.finite(linear)),
  negative_values = colSums(linear < 0),
  fractional_values = colSums(abs(linear - round(linear)) > 1e-10),
  source_sum = colSums(linear),
  detected_features = colSums(linear > 0),
  output_min = apply(transformed, 2L, min),
  output_max = apply(transformed, 2L, max),
  minimum_pairwise_correlation = apply(cor(transformed), 2L, function(x) min(x[x < 1 - 1e-12])),
  accepted_input_class = "DESeq2 depth-normalized sample-level counts",
  explicit_transform = "log2(normalized count + 1)",
  shared_route = "input_kind=matrix -> canonical limma/eBayes model"
)
fwrite(qc, qc_path, sep = "\t")

source_paths <- c(source_path, soft_path)
manifest <- data.table(
  file = basename(source_paths),
  bytes = file.info(source_paths)$size,
  sha256 = vapply(source_paths, digest, character(1), file = TRUE, algo = "sha256", serialize = FALSE),
  role = c(
    "official GEO SubSeries sample-level DESeq2-normalized count matrix",
    "official GEO SubSeries family metadata; records GSE231616 as the RNA-Seq component of GSE231617"
  )
)
fwrite(manifest, manifest_path, sep = "\t")

cat(sprintf("GSE231617/GSE231616: wrote %d genes x %d samples\n", nrow(out), length(sample_names)))
