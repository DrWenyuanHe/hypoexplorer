suppressMessages(library(data.table))

root <- file.path("geo_replication", "datasets", "GSE131172_mmus_hypothalamus_estrous")
source_path <- file.path(root, "raw", "GSE131172_ExpressionMatrix.txt.gz")
soft_path <- file.path(root, "metadata", "GSE131172_family.soft.gz")
out_path <- file.path(root, "raw", "GSE131172_hypothalamus_log2fpkm.tsv.gz")
sample_path <- file.path(root, "metadata", "GSE131172_samplesheet.tsv")
qc_path <- file.path(root, "processed", "GSE131172_preprocessing_qc.tsv")
source_manifest_path <- file.path(root, "metadata", "GSE131172_source_files.tsv")

stopifnot(file.exists(source_path), file.exists(soft_path))

selected <- c("hypo_A1", "hypo_A2", "hypo_A3", "hypo_B1", "hypo_B2", "hypo_B3")
src <- fread(source_path, select = c("gene_id", selected), colClasses = list(character = "gene_id"))
stopifnot(nrow(src) == 20414L, identical(names(src), c("gene_id", selected)))
stopifnot(!anyNA(src$gene_id), all(nzchar(src$gene_id)), !anyDuplicated(src$gene_id))
stopifnot(all(grepl("^[0-9]+$", src$gene_id)))

linear <- as.matrix(src[, ..selected])
storage.mode(linear) <- "double"
stopifnot(all(is.finite(linear)), all(linear >= 0))
transformed <- log2(linear + 1)
stopifnot(all(is.finite(transformed)))

out <- data.table(gene_id = src$gene_id)
out[, (selected) := as.data.table(transformed)]
dir.create(dirname(out_path), recursive = TRUE, showWarnings = FALSE)
con <- gzfile(out_path, "wt")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)

samples <- data.table(
  sample = selected,
  group = c(rep("control", 3L), rep("case", 3L)),
  geo_accession = paste0("GSM", 3765077:3765082),
  biosample = paste0("SAMN", 11639788:11639783),
  sra_experiment = paste0("SRX", 5828094:5828099),
  estrous_stage = c(rep("estrus", 3L), rep("diestrus", 3L)),
  tissue = "Hypothalamus",
  sex = "female",
  age = "10 weeks"
)
fwrite(samples, sample_path, sep = "\t")

qc <- data.table(
  sample = selected,
  group = samples$group,
  geo_accession = samples$geo_accession,
  source_rows = nrow(src),
  output_rows = nrow(out),
  blank_ids = sum(!nzchar(src$gene_id)),
  duplicate_ids = sum(duplicated(src$gene_id)),
  nonfinite_values = colSums(!is.finite(linear)),
  negative_values = colSums(linear < 0),
  fractional_values = colSums(abs(linear - round(linear)) > 1e-10),
  source_fpkm_sum = colSums(linear),
  detected_features = colSums(linear > 0),
  output_min = apply(transformed, 2L, min),
  output_max = apply(transformed, 2L, max),
  accepted_input_class = "RSEM FPKM",
  explicit_transform = "log2(FPKM + 1)",
  shared_route = "input_kind=matrix -> canonical normalized-matrix model"
)
fwrite(qc, qc_path, sep = "\t")

sources <- data.table(
  file = c(basename(source_path), basename(soft_path)),
  sha256 = c(
    "042cb554016941777523c676b07011a606b14e78e44a5f3e1176f6e7a3a6f4b3",
    "597adc3568a7a094415162f688681e9c0a011b2f1f3d64a5a943551b8e2906fc"
  ),
  role = c("official per-sample FPKM matrix", "official GEO family metadata")
)
fwrite(sources, source_manifest_path, sep = "\t")

cat(sprintf("GSE131172: wrote %d genes x %d hypothalamus samples\n", nrow(out), length(selected)))
