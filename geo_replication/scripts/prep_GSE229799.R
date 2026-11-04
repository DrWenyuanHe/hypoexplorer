#!/usr/bin/env Rscript

# Prepare the eight unambiguous GSE229799 hypothalamus libraries for limma.
# The depositor supplied normalized RSEM/limma-voom expression, not raw counts;
# counts are never reconstructed or rounded here.

script_arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
if (length(script_arg) != 1L) stop("cannot resolve this script's path")
script_dir <- dirname(normalizePath(sub("^--file=", "", script_arg)))
root <- normalizePath(file.path(script_dir, ".."))
dataset_dir <- file.path(root, "datasets", "GSE229799_mmus_hypo_clic1ko")
source_path <- file.path(dataset_dir, "raw", "GSE229799_clic1ko_rnaseq_normalized_data.csv.gz")
soft_path <- file.path(dataset_dir, "metadata", "GSE229799_family.soft.gz")

assert <- function(ok, message) if (!isTRUE(ok)) stop(message, call. = FALSE)
assert(file.exists(source_path) && file.info(source_path)$size == 1123905,
       "normalized GEO matrix is missing or its byte size changed")
assert(file.exists(soft_path) && file.info(soft_path)$size == 2472,
       "GSE229799 family SOFT is missing or its byte size changed")

samples <- data.frame(
  sample = c("K2_S84", "K4_S85", "K6_S86", "K8_S87",
             "W1_S79", "W3_S80", "W9_S81", "W11_S82"),
  group = c(rep("case", 4L), rep("control", 4L)),
  gsm = c("GSM7178030", "GSM7178031", "GSM7178032", "GSM7178033",
          "GSM7178035", "GSM7178036", "GSM7178037", "GSM7178038"),
  title = c("KO2", "KO4", "KO6", "KO8", "WT1", "WT3", "WT9", "WT11"),
  condition = c(rep("Clic1_knockout", 4L), rep("wild_type", 4L)),
  stringsAsFactors = FALSE
)
assert(identical(as.integer(table(samples$group)[c("control", "case")]), c(4L, 4L)),
       "contrast is no longer four WT versus four Clic1-KO animals")

# Validate the one-to-one repository mapping for the retained columns.
soft <- readLines(gzfile(soft_path), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft)
ends <- c(starts[-1L] - 1L, length(soft))
assert(length(starts) == 9L, "family SOFT no longer contains nine samples")
for (i in seq_len(nrow(samples))) {
  j <- which(soft[starts] == paste0("^SAMPLE = ", samples$gsm[i]))
  assert(length(j) == 1L, paste("missing SOFT block for", samples$gsm[i]))
  block <- soft[starts[j]:ends[j]]
  required <- c(
    paste0("!Sample_title = ", samples$title[i]),
    "!Sample_source_name_ch1 = Hypothalamus",
    "!Sample_characteristics_ch1 = tissue: Hypothalamus",
    "!Sample_characteristics_ch1 = Sex: male",
    paste0("!Sample_characteristics_ch1 = treatment: ",
           if (samples$group[i] == "case") "Clic1 Knockout" else "WT"),
    paste0("!Sample_description = ", samples$sample[i]),
    "!Sample_library_strategy = RNA-Seq"
  )
  assert(all(required %in% block), paste("SOFT metadata changed for", samples$gsm[i]))
}

d <- read.csv(gzfile(source_path), check.names = FALSE, row.names = 1,
              stringsAsFactors = FALSE)
assert(nrow(d) == 14351L && ncol(d) == 10L,
       "unexpected dimensions in normalized GEO matrix")
expected_columns <- c("K2_S84", "K4_S85", "K6_S86", "K8_S87", "K10_S88",
                      "W1_S79", "W3_S80", "W9_S81", "W11_S82", "W15_S83")
assert(identical(colnames(d), expected_columns), "normalized matrix columns changed")
ids <- rownames(d)
assert(!anyDuplicated(ids) && all(grepl("^ENSMUSG[0-9]+$", ids)),
       "gene identifiers are not unique unversioned mouse Ensembl IDs")

# K10_S88 conflicts with its GEO block (title/treatment say WT, description says
# K10), and W15_S83 has no GEO sample block. Both are excluded rather than
# guessed. The remaining eight columns have explicit, mutually consistent GEO
# identities and still exceed the minimum replication rule.
assert(setequal(setdiff(colnames(d), samples$sample), c("K10_S88", "W15_S83")),
       "the expected two ambiguous/unregistered columns changed")

M <- as.matrix(d[, samples$sample, drop = FALSE])
storage.mode(M) <- "double"
assert(!anyNA(M) && all(is.finite(M)) && all(M >= 0),
       "normalized expression contains missing, non-finite, or negative values")
fraction_integer <- mean(M == round(M))
assert(fraction_integer < 0.01 && max(M) < 1e5,
       "matrix no longer looks like depositor-normalized continuous expression")

expected_sums <- c(993076.1389461528, 996304.2295247472, 1001229.2410313813,
                   992816.7275225190, 993211.8193273987, 1008222.9727676827,
                   988036.4843665966, 1003479.7643462382)
expected_detected <- c(14345L, 14339L, 14333L, 14339L,
                       14347L, 14348L, 14344L, 14338L)
assert(max(abs(colSums(M) - expected_sums)) < 1e-6 &&
         identical(as.integer(colSums(M > 0)), expected_detected),
       "pinned normalized abundance totals or detection counts changed")

# run_dataset.R's matrix path fits limma directly, so provide log2 expression.
L <- log2(M + 1)
rownames(L) <- ids
reconstructed <- 2^L - 1
delta <- apply(abs(reconstructed - M), 2L, max)
assert(all(is.finite(L)) && all(L >= 0) && max(delta) < 1e-10,
       "log2(normalized+1) transform failed reversibility/finite-value checks")

out <- data.frame(Ensembl_gene_id = rownames(L), L, check.names = FALSE,
                  stringsAsFactors = FALSE)
out_path <- file.path(dataset_dir, "raw", "GSE229799_clic1ko_vs_wt_log2norm.tsv.gz")
con <- gzfile(out_path, "wt")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)

write.table(samples,
            file.path(dataset_dir, "metadata", "GSE229799_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)

qc <- data.frame(
  sample = samples$sample,
  group = samples$group,
  gsm = samples$gsm,
  source_gene_rows = nrow(M),
  normalized_abundance_sum = colSums(M),
  detected_genes = colSums(M > 0),
  log2_expression_sum = colSums(L),
  min_log2_expression = apply(L, 2L, min),
  max_log2_expression = apply(L, 2L, max),
  nonfinite_values = colSums(!is.finite(L)),
  negative_values = colSums(L < 0),
  transform_max_abs_delta = delta,
  metadata_match = TRUE,
  analysis_keep = TRUE,
  stringsAsFactors = FALSE
)
assert(all(qc$nonfinite_values == 0L) && all(qc$negative_values == 0L),
       "transformed output contains invalid values")
write.table(qc,
            file.path(dataset_dir, "processed", "GSE229799_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)

cat(sprintf(
  "GSE229799 prepared: %d genes x %d independently mapped animals; WT=%d KO=%d; normalized abundance sums %.0f-%.0f; limma matrix\n",
  nrow(L), ncol(L), sum(samples$group == "control"), sum(samples$group == "case"),
  min(colSums(M)), max(colSums(M))
))
