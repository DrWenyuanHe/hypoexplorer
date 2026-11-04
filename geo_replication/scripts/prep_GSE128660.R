suppressMessages({
  library(data.table)
  library(readxl)
})

root <- file.path("geo_replication", "datasets", "GSE128660_mmus_hypothalamus_heat")
raw_dir <- file.path(root, "raw")
soft_path <- file.path(root, "metadata", "GSE128660_family.soft.gz")
filelist_path <- file.path(root, "metadata", "GSE128660_filelist.txt")
archive_path <- file.path(raw_dir, "GSE128660_RAW.tar")
out_path <- file.path(raw_dir, "GSE128660_hypothalamus_log2fpkm.tsv.gz")
sample_path <- file.path(root, "metadata", "GSE128660_samplesheet.tsv")
qc_path <- file.path(root, "processed", "GSE128660_preprocessing_qc.tsv")
quarantine_path <- file.path(root, "processed", "GSE128660_quarantined_novel_features.tsv.gz")
source_manifest_path <- file.path(root, "metadata", "GSE128660_source_files.tsv")

stopifnot(file.exists(soft_path), file.exists(filelist_path), file.exists(archive_path))

gsm <- as.character(3681932:3681947)
geo_accession <- paste0("GSM", gsm)
file_names <- c(
  paste0(geo_accession[1:8], "_C_H", 1:8, ".FPKM.xlsx"),
  paste0(geo_accession[9:16], "_HS_H", 1:8, ".FPKM.xlsx")
)
file_paths <- file.path(raw_dir, file_names)
stopifnot(all(file.exists(file_paths)))

sample_names <- c(paste0("C_H", 1:8), paste0("HS_H", 1:8))
group <- c(rep("control", 8L), rep("case", 8L))

tables <- vector("list", length(file_paths))
reference_ids <- NULL
for (i in seq_along(file_paths)) {
  sheets <- excel_sheets(file_paths[i])
  stopifnot("Sheet1" %in% sheets)
  x <- as.data.table(read_excel(
    file_paths[i], sheet = "Sheet1", col_types = c("text", "numeric"),
    .name_repair = "minimal"
  ))
  stopifnot(ncol(x) == 2L, identical(names(x), c("gene_id", sample_names[i])))
  stopifnot(!anyNA(x$gene_id), all(nzchar(x$gene_id)))
  stopifnot(all(
    grepl("^ENSMUSG[0-9]+(?:\\.[0-9]+)?$", x$gene_id) |
      grepl("^novel\\.[0-9]+$", x$gene_id)
  ))
  stopifnot(!anyDuplicated(x$gene_id))
  values <- x[[2L]]
  stopifnot(is.numeric(values), all(is.finite(values)), all(values >= 0))

  if (is.null(reference_ids)) {
    reference_ids <- x$gene_id
  } else if (!identical(x$gene_id, reference_ids)) {
    stopifnot(setequal(x$gene_id, reference_ids))
    x <- x[match(reference_ids, x$gene_id)]
    stopifnot(identical(x$gene_id, reference_ids))
  }
  tables[[i]] <- x[[2L]]
}

linear <- do.call(cbind, tables)
colnames(linear) <- sample_names
storage.mode(linear) <- "double"
stopifnot(nrow(linear) == length(reference_ids), ncol(linear) == 16L)
stopifnot(all(is.finite(linear)), all(linear >= 0))

transformed <- log2(linear + 1)
stopifnot(all(is.finite(transformed)), all(transformed >= 0))
valid <- grepl("^ENSMUSG[0-9]+(?:\\.[0-9]+)?$", reference_ids)
stopifnot(sum(valid) > 0L, sum(!valid) > 0L)
out <- data.table(gene_id = sub("\\.[0-9]+$", "", reference_ids[valid]))
stopifnot(!anyDuplicated(out$gene_id))
out[, (sample_names) := as.data.table(transformed[valid, , drop = FALSE])]
con <- gzfile(out_path, "wt")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)

quarantine <- data.table(
  source_feature_id = reference_ids[!valid],
  exclusion_reason = "unannotated author novel feature; no reviewed Ensembl or gene-symbol mapping"
)
quarantine[, (sample_names) := as.data.table(linear[!valid, , drop = FALSE])]
con <- gzfile(quarantine_path, "wt")
write.table(quarantine, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)

soft <- readLines(gzfile(soft_path), warn = FALSE)
sample_starts <- grep("^\\^SAMPLE = ", soft)
sample_ends <- c(sample_starts[-1L] - 1L, length(soft))
sample_ids <- sub("^\\^SAMPLE = ", "", soft[sample_starts])

extract_one <- function(block, pattern, replacement) {
  hit <- grep(pattern, block, value = TRUE)
  stopifnot(length(hit) == 1L)
  sub(pattern, replacement, hit)
}

biosample <- sra_experiment <- title <- character(length(geo_accession))
for (i in seq_along(geo_accession)) {
  j <- match(geo_accession[i], sample_ids)
  stopifnot(!is.na(j))
  block <- soft[sample_starts[j]:sample_ends[j]]
  biosample[i] <- extract_one(block, ".*/biosample/(SAMN[0-9]+)$", "\\1")
  sra_experiment[i] <- extract_one(block, ".*term=(SRX[0-9]+)$", "\\1")
  title[i] <- extract_one(block, "^!Sample_title = (.*)$", "\\1")
}
stopifnot(!anyDuplicated(biosample), !anyDuplicated(sra_experiment))

samples <- data.table(
  sample = sample_names,
  group,
  geo_accession,
  biosample,
  sra_experiment,
  title,
  stress = c(rep("control (25 C)", 8L), rep("heat stress (36 C)", 8L)),
  tissue = "hypothalamus",
  sex = "female",
  age = "10 weeks, lactating day 13"
)
fwrite(samples, sample_path, sep = "\t")

qc <- data.table(
  sample = sample_names,
  group,
  geo_accession,
  source_rows = nrow(linear),
  output_rows = nrow(out),
  quarantined_novel_rows = sum(!valid),
  blank_ids = 0L,
  duplicate_ids = 0L,
  nonfinite_values = colSums(!is.finite(linear)),
  negative_values = colSums(linear < 0),
  fractional_values = colSums(abs(linear - round(linear)) > 1e-10),
  source_fpkm_sum = colSums(linear),
  retained_fpkm_sum = colSums(linear[valid, , drop = FALSE]),
  quarantined_fpkm_sum = colSums(linear[!valid, , drop = FALSE]),
  partition_delta = colSums(linear) - colSums(linear[valid, , drop = FALSE]) - colSums(linear[!valid, , drop = FALSE]),
  detected_features = colSums(linear[valid, , drop = FALSE] > 0),
  output_min = apply(transformed[valid, , drop = FALSE], 2L, min),
  output_max = apply(transformed[valid, , drop = FALSE], 2L, max),
  accepted_input_class = "featureCounts-derived per-sample FPKM",
  explicit_transform = "log2(FPKM + 1)",
  shared_route = "input_kind=matrix -> canonical normalized-matrix model"
)
fwrite(qc, qc_path, sep = "\t")

hash_file <- function(path) digest::digest(file = path, algo = "sha256", serialize = FALSE)
source_paths <- c(archive_path, filelist_path, soft_path, file_paths)
sources <- data.table(
  file = basename(source_paths),
  bytes = file.info(source_paths)$size,
  sha256 = vapply(source_paths, hash_file, character(1)),
  role = c(
    "official GEO processed-data archive",
    "official GEO archive manifest",
    "official GEO family metadata",
    rep("official per-sample hypothalamus FPKM workbook extracted unchanged from archive", length(file_paths))
  )
)
fwrite(sources, source_manifest_path, sep = "\t")

cat(sprintf("GSE128660: wrote %d genes x %d hypothalamus samples\n", nrow(out), length(sample_names)))
