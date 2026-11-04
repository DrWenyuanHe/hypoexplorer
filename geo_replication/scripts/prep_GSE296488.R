#!/usr/bin/env Rscript

# Prepare GSE296488 WT arcuate-nucleus cagrilintide/AM833 versus vehicle.
# GEO supplies kallisto transcript abundances. We aggregate deposited TPM on
# the linear scale with a pinned Ensembl GRCm39 transcript-to-gene annotation,
# then log2(TPM+1) for limma. Fractional estimated counts are never rounded.

script_arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
if (length(script_arg) != 1L) stop("cannot resolve this script's path")
script_dir <- dirname(normalizePath(sub("^--file=", "", script_arg)))
root <- normalizePath(file.path(script_dir, ".."))
dataset_dir <- file.path(root, "datasets", "GSE296488_mmus_arc_cagrilintide")
raw_dir <- file.path(dataset_dir, "raw")
soft_path <- file.path(dataset_dir, "metadata", "GSE296488_family.soft.gz")
gtf_path <- file.path(raw_dir, "Mus_musculus.GRCm39.113.gtf.gz")

assert <- function(ok, message) if (!isTRUE(ok)) stop(message, call. = FALSE)
assert(requireNamespace("data.table", quietly = TRUE), "data.table is required")
assert(file.exists(soft_path) && file.info(soft_path)$size == 9765,
       "GSE296488 family SOFT is missing or its byte size changed")
assert(file.exists(gtf_path) && file.info(gtf_path)$size == 40537437,
       "pinned Ensembl release-113 GRCm39 GTF is missing or changed")

samples <- data.frame(
  sample = c(sprintf("GSM%d", 8971569:8971575), sprintf("GSM%d", 8971462:8971469)),
  group = c(rep("control", 7L), rep("case", 8L)),
  treatment = c(rep("Vehicle", 7L), rep("AM833 0.3 nmol/kg", 8L)),
  library = c(paste0("Brain_region_", 93:99), paste0("Brain_region_", 100:107)),
  title = c(paste0("p26688_28474/", 93:99), paste0("p26688_28474/", 100:107)),
  stringsAsFactors = FALSE
)
samples$source_file <- paste0(samples$sample, "_", samples$library, ".txt.gz")
expected_bytes <- c(1736104, 1778367, 1763435, 1763576, 1758678, 1741117, 1759421,
                    1759346, 1742945, 1761861, 1758819, 1763797, 1770324, 1755792, 1757276)
assert(identical(as.integer(table(samples$group)[c("control", "case")]), c(7L, 8L)),
       "contrast is no longer seven vehicle versus eight AM833 animals")
for (i in seq_len(nrow(samples))) {
  p <- file.path(raw_dir, samples$source_file[i])
  assert(file.exists(p) && file.info(p)$size == expected_bytes[i],
         paste("missing or changed kallisto file", samples$source_file[i]))
}

soft <- readLines(gzfile(soft_path), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft)
ends <- c(starts[-1L] - 1L, length(soft))
assert(length(starts) == 116L, "family SOFT no longer contains 116 samples")
for (i in seq_len(nrow(samples))) {
  j <- which(soft[starts] == paste0("^SAMPLE = ", samples$sample[i]))
  assert(length(j) == 1L, paste("missing SOFT block for", samples$sample[i]))
  block <- soft[starts[j]:ends[j]]
  required <- c(
    paste0("!Sample_title = ", samples$title[i]),
    "!Sample_source_name_ch1 = Brain tissue",
    "!Sample_characteristics_ch1 = tissue: Brain tissue",
    "!Sample_characteristics_ch1 = cell type: ARC",
    "!Sample_characteristics_ch1 = genotype: 129/Sv",
    paste0("!Sample_characteristics_ch1 = treatment: ", samples$treatment[i]),
    paste0("!Sample_description = Library name: ", samples$library[i]),
    "!Sample_library_strategy = RNA-Seq",
    paste0("!Sample_supplementary_file_1 = ftp://ftp.ncbi.nlm.nih.gov/geo/samples/GSM8971nnn/",
           samples$sample[i], "/suppl/", samples$source_file[i])
  )
  assert(all(required %in% block), paste("SOFT metadata changed for", samples$sample[i]))
}

# Build a deterministic transcript-to-gene map from the pinned official GTF.
gtf <- data.table::fread(gtf_path, sep = "\t", header = FALSE, select = c(3L, 9L),
                         quote = "", showProgress = FALSE)
assert(nrow(gtf) == 2475479L, "Ensembl GTF row count changed")
gtf <- gtf[gtf[["V3"]] == "transcript"]
assert(nrow(gtf) == 278375L, "Ensembl GTF transcript inventory changed")
attrs <- gtf[["V9"]]
tx_id <- sub('.*transcript_id "([^"]+)".*', "\\1", attrs)
gene_id <- sub('.*gene_id "([^"]+)".*', "\\1", attrs)
assert(!anyDuplicated(tx_id) && all(grepl("^ENSMUST[0-9]+$", tx_id)) &&
         all(grepl("^ENSMUSG[0-9]+$", gene_id)),
       "invalid or duplicated transcript-to-gene mapping")
tx_to_gene <- setNames(gene_id, tx_id)

gene_tpm_list <- vector("list", nrow(samples))
qc <- vector("list", nrow(samples))
reference_targets <- NULL
reference_genes <- NULL

for (i in seq_len(nrow(samples))) {
  d <- data.table::fread(file.path(raw_dir, samples$source_file[i]),
                         showProgress = FALSE, check.names = FALSE)
  assert(nrow(d) == 121798L &&
           identical(colnames(d), c("target_id", "length", "eff_length", "est_counts", "tpm")),
         paste("unexpected kallisto dimensions/header for", samples$sample[i]))
  targets <- as.character(d[["target_id"]])
  if (is.null(reference_targets)) reference_targets <- targets
  assert(identical(targets, reference_targets) && !anyDuplicated(targets),
         paste("transcript inventory/order differs for", samples$sample[i]))
  est <- as.numeric(d[["est_counts"]])
  tpm <- as.numeric(d[["tpm"]])
  assert(!anyNA(est) && !anyNA(tpm) && all(is.finite(est)) && all(is.finite(tpm)) &&
           all(est >= 0) && all(tpm >= 0),
         paste("invalid kallisto abundance values for", samples$sample[i]))
  # est_counts are deliberately allowed to be fractional; TPM is the documented
  # normalized matrix used below.
  assert(mean(est == round(est)) < 0.9 && abs(sum(tpm) - 1e6) < 2,
         paste("kallisto scale checks failed for", samples$sample[i]))

  mapped_gene <- unname(tx_to_gene[targets])
  mapped <- !is.na(mapped_gene)
  mapped_tpm <- sum(tpm[mapped])
  assert(mean(mapped) > 0.98 && mapped_tpm / sum(tpm) > 0.98,
         paste("insufficient transcript/TPM coverage in pinned GTF for", samples$sample[i]))
  gene_table <- rowsum(tpm[mapped], group = mapped_gene[mapped], reorder = FALSE)
  gene_tpm <- as.numeric(gene_table[, 1L])
  genes <- rownames(gene_table)
  if (is.null(reference_genes)) reference_genes <- genes
  assert(identical(genes, reference_genes),
         paste("gene aggregation order differs for", samples$sample[i]))
  aggregation_delta <- sum(gene_tpm) - mapped_tpm
  assert(abs(aggregation_delta) < 1e-6,
         paste("gene-level TPM is not conserved for", samples$sample[i]))
  gene_tpm_list[[i]] <- gene_tpm
  qc[[i]] <- data.frame(
    sample = samples$sample[i], group = samples$group[i],
    treatment = samples$treatment[i], source_file = samples$source_file[i],
    source_transcripts = length(targets), mapped_transcripts = sum(mapped),
    unmapped_transcripts = sum(!mapped), source_tpm_sum = sum(tpm),
    mapped_tpm_sum = mapped_tpm, unmapped_tpm_sum = sum(tpm[!mapped]),
    estimated_fragment_sum = sum(est), detected_transcripts = sum(tpm > 0),
    mapped_tpm_fraction = mapped_tpm / sum(tpm),
    gene_tpm_sum = sum(gene_tpm), tpm_aggregation_delta = aggregation_delta,
    metadata_match = TRUE, analysis_keep = TRUE, stringsAsFactors = FALSE
  )
}

T <- do.call(cbind, gene_tpm_list)
rownames(T) <- reference_genes
colnames(T) <- samples$sample
assert(all(is.finite(T)) && all(T >= 0) && !anyDuplicated(rownames(T)),
       "gene-level TPM matrix is invalid")
L <- log2(T + 1)
delta <- apply(abs(2^L - 1 - T), 2L, max)
assert(max(delta) < 1e-10, "log2(TPM+1) transformation is not reversible")

out <- data.frame(Ensembl_gene_id = rownames(L), L, check.names = FALSE,
                  stringsAsFactors = FALSE)
out_path <- file.path(raw_dir, "GSE296488_WT_ARC_AM833_vs_vehicle_log2tpm.tsv.gz")
con <- gzfile(out_path, "wt")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)

write.table(samples,
            file.path(dataset_dir, "metadata", "GSE296488_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)

qc <- do.call(rbind, qc)
qc$gene_rows <- nrow(T)
qc$detected_genes <- colSums(T > 0)
qc$log2_expression_sum <- colSums(L)
qc$transform_max_abs_delta <- delta
qc$nonfinite_values <- colSums(!is.finite(L))
qc$negative_values <- colSums(L < 0)
assert(all(qc$nonfinite_values == 0L) && all(qc$negative_values == 0L),
       "transformed output contains invalid values")
write.table(qc,
            file.path(dataset_dir, "processed", "GSE296488_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)

cat(sprintf(
  "GSE296488 prepared: %d genes x %d independent WT ARC animals; vehicle=%d AM833=%d; estimated fragments %.2fM-%.2fM; mapped TPM %.2f-%.2f%%; limma matrix\n",
  nrow(L), ncol(L), sum(samples$group == "control"), sum(samples$group == "case"),
  min(qc$estimated_fragment_sum) / 1e6, max(qc$estimated_fragment_sum) / 1e6,
  100 * min(qc$mapped_tpm_fraction), 100 * max(qc$mapped_tpm_fraction)
))
