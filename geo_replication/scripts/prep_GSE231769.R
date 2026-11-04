suppressMessages({
  library(data.table)
  library(digest)
})

root <- file.path("geo_replication", "datasets", "GSE231769_mouse_mbh_maternal_emulsifier")
source_path <- file.path(root, "raw", "GSE231769_CPM_allsamples.tsv.gz")
soft_path <- file.path(root, "metadata", "GSE231769_family.soft.gz")
out_path <- file.path(root, "raw", "GSE231769_mbh_log2cpm_tmm.tsv.gz")
sample_path <- file.path(root, "metadata", "GSE231769_samplesheet.tsv")
qc_path <- file.path(root, "processed", "GSE231769_preprocessing_qc.tsv")
quarantine_path <- file.path(root, "processed", "GSE231769_quarantined_blank_feature.tsv")
manifest_path <- file.path(root, "metadata", "GSE231769_source_files.tsv")

stopifnot(file.exists(source_path), file.exists(soft_path))
source <- fread(source_path, check.names = FALSE)
sample_names <- c(paste0("MBH_CTRL_Rep", 1:4), paste0("MBH_Emul_Rep", 1:5))
stopifnot(identical(names(source), c("geneID", sample_names)), nrow(source) > 1000L)

symbols <- trimws(as.character(source$geneID))
blank <- is.na(symbols) | !nzchar(symbols)
stopifnot(sum(blank) == 1L, !anyDuplicated(symbols[!blank]))
matrix_all <- as.matrix(source[, ..sample_names])
storage.mode(matrix_all) <- "double"
stopifnot(all(is.finite(matrix_all)), all(matrix_all > -100))

# The GEO record explicitly defines this matrix as normalized log2 CPM after
# edgeR TMM. No additional transform or count-model normalization is applied.
retained <- !blank
out <- data.table(symbol = symbols[retained])
out[, (sample_names) := as.data.table(matrix_all[retained, , drop = FALSE])]
con <- gzfile(out_path, "wt")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)

quarantine <- data.table(
  source_row = which(blank),
  source_feature_id = symbols[blank],
  exclusion_reason = "blank submitted gene identifier; no auditable symbol or stable gene ID"
)
quarantine[, (sample_names) := as.data.table(matrix_all[blank, , drop = FALSE])]
fwrite(quarantine, quarantine_path, sep = "\t")

soft <- readLines(gzfile(soft_path), warn = FALSE)
sample_starts <- grep("^\\^SAMPLE = ", soft)
sample_ends <- c(sample_starts[-1L] - 1L, length(soft))
sample_ids <- sub("^\\^SAMPLE = ", "", soft[sample_starts])
geo_accession <- paste0("GSM", 7300216:7300224)

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
stopifnot(!anyDuplicated(biosample), !anyDuplicated(sra_experiment))

samples <- data.table(
  sample = sample_names,
  group = c(rep("control", 4L), rep("case", 5L)),
  geo_accession,
  biosample,
  sra_experiment,
  title,
  maternal_treatment = c(rep("control water", 4L), rep("1% CMC + 1% P80", 5L)),
  age = "P21 after weaning",
  tissue = "mediobasal hypothalamus",
  sex = "male",
  genotype = "wild-type C57BL/6"
)
fwrite(samples, sample_path, sep = "\t")

retained_matrix <- matrix_all[retained, , drop = FALSE]
qc <- data.table(
  sample = sample_names,
  group = samples$group,
  source_rows = nrow(matrix_all),
  output_rows = nrow(out),
  quarantined_blank_rows = sum(blank),
  duplicate_valid_ids = 0L,
  nonfinite_values = colSums(!is.finite(matrix_all)),
  output_min = apply(retained_matrix, 2L, min),
  output_max = apply(retained_matrix, 2L, max),
  detected_above_submitted_floor = colSums(retained_matrix > apply(retained_matrix, 2L, min) + 1e-8),
  minimum_pairwise_correlation = apply(cor(retained_matrix), 2L, function(x) min(x[x < 1 - 1e-12])),
  accepted_input_class = "author-normalized log2 CPM TMM gene matrix",
  explicit_transform = "none; submitted values are already log2 CPM TMM",
  shared_route = "input_kind=matrix -> canonical limma/eBayes model"
)
fwrite(qc, qc_path, sep = "\t")

source_paths <- c(source_path, soft_path)
manifest <- data.table(
  file = basename(source_paths),
  bytes = file.info(source_paths)$size,
  sha256 = vapply(source_paths, digest, character(1), file = TRUE, algo = "sha256", serialize = FALSE),
  role = c(
    "official GEO sample-level normalized log2 CPM TMM gene matrix",
    "official GEO family metadata and processing-scale declaration"
  )
)
fwrite(manifest, manifest_path, sep = "\t")

cat(sprintf("GSE231769: wrote %d genes x %d samples; quarantined %d blank-ID row\n", nrow(out), length(sample_names), sum(blank)))
