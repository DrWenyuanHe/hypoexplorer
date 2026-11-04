#!/usr/bin/env Rscript

# Assemble the F1-generation GSE168151 EDC-mixture-vs-vehicle contrast from
# per-animal STAR-style gene-count files. F3 animals are a distinct generation
# and are retained only in the complete source archive.

script_arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
if (length(script_arg) != 1L) stop("cannot resolve this script's path")
script_dir <- dirname(normalizePath(sub("^--file=", "", script_arg)))
root <- normalizePath(file.path(script_dir, ".."))
dataset_dir <- file.path(root, "datasets", "GSE168151_rnor_mbh_edc")
archive <- file.path(dataset_dir, "raw", "GSE168151_RAW.tar")
soft_path <- file.path(dataset_dir, "metadata", "GSE168151_family.soft.gz")

assert <- function(ok, message) if (!isTRUE(ok)) stop(message, call. = FALSE)
assert(file.exists(archive) && file.info(archive)$size == 3205120,
       "GSE168151_RAW.tar is missing or its byte size changed")
assert(file.exists(soft_path) && file.info(soft_path)$size == 3152,
       "GSE168151 family SOFT is missing or its byte size changed")

expected_inventory <- c(
  "GSM5129961_F1_C1_2211_9_S9_L002_R1_001.preprocessed.star.ReadsPerGene.out.txt.gz",
  "GSM5129962_F1_C2_2211_10_S10_L002_R1_001.preprocessed.star.ReadsPerGene.out.txt.gz",
  "GSM5129963_F1_C3_2211_11_S11_L002_R1_001.preprocessed.star.ReadsPerGene.out.txt.gz",
  "GSM5129964_F1_C4_2211_12_S12_L002_R1_001.preprocessed.star.ReadsPerGene.out.txt.gz",
  "GSM5129965_F1_E1_2211_13_S13_L002_R1_001.preprocessed.star.ReadsPerGene.out.txt.gz",
  "GSM5129966_F1_E2_2211_14_S14_L002_R1_001.preprocessed.star.ReadsPerGene.out.txt.gz",
  "GSM5129967_F1_E3_2211_15_S15_L002_R1_001.preprocessed.star.ReadsPerGene.out.txt.gz",
  "GSM5129968_F1_E4_2211_16_S16_L002_R1_001.preprocessed.star.ReadsPerGene.out.txt.gz",
  "GSM5129969_F3_C1_2212_1_S1_L001_R1_001.preprocessed.star.ReadsPerGene.out.txt.gz",
  "GSM5129970_F3_C2_2212_2_S2_L001_R1_001.preprocessed.star.ReadsPerGene.out.txt.gz",
  "GSM5129971_F3_C3_2212_3_S3_L001_R1_001.preprocessed.star.ReadsPerGene.out.txt.gz",
  "GSM5129972_F3_C4_2212_4_S4_L001_R1_001.preprocessed.star.ReadsPerGene.out.txt.gz",
  "GSM5129973_F3_E1_2212_5_S5_L001_R1_001.preprocessed.star.ReadsPerGene.out.txt.gz",
  "GSM5129974_F3_E2_2212_6_S6_L001_R1_001.preprocessed.star.ReadsPerGene.out.txt.gz",
  "GSM5129975_F3_E3_2212_7_S7_L001_R1_001.preprocessed.star.ReadsPerGene.out.txt.gz",
  "GSM5129976_F3_E4_2212_8_S8_L001_R1_001.preprocessed.star.ReadsPerGene.out.txt.gz"
)
listed <- utils::untar(archive, list = TRUE)
assert(length(listed) == 16L && setequal(listed, expected_inventory),
       "GSE168151 archive inventory changed")

samples <- data.frame(
  sample = sprintf("GSM%d", 5129961:5129968),
  group = c(rep("control", 4L), rep("case", 4L)),
  condition = c(rep("vehicle_F1", 4L), rep("EDC_mixture_F1", 4L)),
  animal = c(paste0("F1_C", 1:4), paste0("F1_E", 1:4)),
  generation = "F1",
  sequencing_lane = "L002",
  source_file = expected_inventory[1:8],
  expected_title = c(
    paste("Control C1 F1 generation"), paste("Control C2 F1 generation"),
    paste("Control C3 F1 generation"), paste("Control C4 F1 generation"),
    paste("Control E1 F1 generation"), paste("Control E2 F1 generation"),
    paste("Control E3 F1 generation"), paste("Control E4 F1 generation")
  ),
  treatment = c(rep("Control (Vehicle)", 4L), rep("EDC mixture", 4L)),
  stringsAsFactors = FALSE
)
assert(identical(as.integer(table(samples$group)[c("control", "case")]), c(4L, 4L)),
       "contrast is no longer 4 vehicle animals versus 4 EDC animals")

soft <- readLines(gzfile(soft_path), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft)
ends <- c(starts[-1L] - 1L, length(soft))
assert(length(starts) == 16L, "family SOFT no longer contains 16 samples")
for (i in seq_len(nrow(samples))) {
  block_index <- which(vapply(starts, function(j) {
    identical(soft[j], paste0("^SAMPLE = ", samples$sample[i]))
  }, logical(1)))
  assert(length(block_index) == 1L, paste("missing SOFT block for", samples$sample[i]))
  block <- soft[starts[block_index]:ends[block_index]]
  required <- c(
    paste0("!Sample_title = ", samples$expected_title[i]),
    "!Sample_characteristics_ch1 = age: 21 day-old",
    "!Sample_characteristics_ch1 = strain: Wistar rat",
    paste0("!Sample_characteristics_ch1 = treatment: ", samples$treatment[i]),
    "!Sample_characteristics_ch1 = tissue: Hypothalamus (MBH-PoA)",
    "!Sample_characteristics_ch1 = generation: F1",
    "!Sample_characteristics_ch1 = gender: female",
    "!Sample_library_strategy = RNA-Seq",
    paste0(
      "!Sample_supplementary_file_1 = ftp://ftp.ncbi.nlm.nih.gov/geo/samples/GSM5129nnn/",
      samples$sample[i], "/suppl/", samples$source_file[i]
    )
  )
  assert(all(required %in% block), paste("SOFT metadata changed for", samples$sample[i]))
}

extract_dir <- tempfile("GSE168151_extract_")
dir.create(extract_dir)
on.exit(unlink(extract_dir, recursive = TRUE, force = TRUE), add = TRUE)
utils::untar(archive, exdir = extract_dir)
assert(setequal(list.files(extract_dir), expected_inventory),
       "extracted GSE168151 inventory differs from the archive listing")

star_summary_ids <- c("N_unmapped", "N_multimapping", "N_noFeature", "N_ambiguous")
counts_list <- vector("list", nrow(samples))
qc <- vector("list", nrow(samples))
reference_ids <- NULL
expected_library_sizes <- c(
  14175856, 19249536, 13967526, 5655354,
  13837319, 13150495, 9859178, 35981898
)
expected_detected_genes <- c(17065L, 17015L, 17286L, 16398L, 18042L, 17413L, 17546L, 18048L)

for (i in seq_len(nrow(samples))) {
  path <- file.path(extract_dir, samples$source_file[i])
  d <- read.delim(
    gzfile(path), header = FALSE, sep = "\t", quote = "",
    comment.char = "", stringsAsFactors = FALSE, check.names = FALSE
  )
  assert(ncol(d) == 4L && nrow(d) == 32887L,
         paste("unexpected STAR-count dimensions in", samples$source_file[i]))
  assert(identical(as.character(d[[1]][1:4]), star_summary_ids),
         paste("STAR summary rows changed in", samples$source_file[i]))
  values <- as.matrix(d[, 2:4, drop = FALSE])
  storage.mode(values) <- "numeric"
  assert(!anyNA(values) && all(is.finite(values)) && all(values >= 0) &&
           all(values == round(values)),
         paste("non-integer or invalid counts in", samples$source_file[i]))
  gene_ids <- as.character(d[[1]][-(1:4)])
  gene_counts <- values[-(1:4), 3L]
  forward_counts <- values[-(1:4), 2L]
  unstranded_counts <- values[-(1:4), 1L]
  assert(length(gene_ids) == 32883L && !anyDuplicated(gene_ids),
         paste("gene rows are invalid in", samples$source_file[i]))
  assert(sum(gene_counts) > 10 * sum(forward_counts),
         paste("reverse-strand count dominance changed in", samples$source_file[i]))
  if (is.null(reference_ids)) reference_ids <- gene_ids
  assert(identical(gene_ids, reference_ids),
         paste("gene order differs in", samples$source_file[i]))
  assert(sum(gene_counts) == expected_library_sizes[i] &&
           sum(gene_counts > 0) == expected_detected_genes[i],
         paste("pinned count totals changed in", samples$source_file[i]))
  counts_list[[i]] <- gene_counts
  qc[[i]] <- data.frame(
    sample = samples$sample[i], group = samples$group[i],
    condition = samples$condition[i], animal = samples$animal[i],
    generation = samples$generation[i], sequencing_lane = samples$sequencing_lane[i],
    source_file = samples$source_file[i], raw_rows = nrow(d),
    source_gene_rows = length(gene_ids), star_summary_rows_removed = 4L,
    unstranded_gene_total = sum(unstranded_counts),
    forward_strand_gene_total = sum(forward_counts),
    reverse_strand_gene_total = sum(gene_counts), selected_count_column = 4L,
    library_size = sum(gene_counts), detected_genes = sum(gene_counts > 0),
    integer_counts = TRUE, nonnegative_counts = TRUE, gene_order_match = TRUE,
    stringsAsFactors = FALSE
  )
}

count_matrix <- do.call(cbind, counts_list)
rownames(count_matrix) <- reference_ids
colnames(count_matrix) <- samples$sample
storage.mode(count_matrix) <- "numeric"
assert(all(count_matrix == round(count_matrix)) && all(count_matrix >= 0),
       "merged matrix is not nonnegative integer counts")

qc <- do.call(rbind, qc)
qc$merged_gene_rows <- nrow(count_matrix)
qc$merged_library_size <- as.numeric(colSums(count_matrix))
qc$count_conservation_delta <- qc$merged_library_size - qc$library_size
qc$library_size_watch <- qc$library_size < 0.5 * median(qc$library_size) |
  qc$library_size > 2 * median(qc$library_size)
qc$analysis_keep <- TRUE
assert(all(qc$count_conservation_delta == 0), "merged counts are not exactly conserved")

counts_path <- file.path(dataset_dir, "raw", "GSE168151_F1_EDC_vs_vehicle_counts.tsv.gz")
samplesheet_path <- file.path(dataset_dir, "metadata", "GSE168151_samplesheet.tsv")
qc_path <- file.path(dataset_dir, "processed", "GSE168151_preprocessing_qc.tsv")

out <- data.frame(gene_id = rownames(count_matrix), count_matrix,
                  check.names = FALSE, stringsAsFactors = FALSE)
con <- gzfile(counts_path, "wt")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)
write.table(
  samples[, c("sample", "group", "condition", "animal", "generation", "sequencing_lane")],
  samplesheet_path, sep = "\t", quote = FALSE, row.names = FALSE
)
write.table(qc, qc_path, sep = "\t", quote = FALSE, row.names = FALSE)

cat(sprintf(
  "GSE168151 prepared: %d genes x %d independent F1 rats; control=%d case=%d; libraries %.2fM-%.2fM; exact conservation\n",
  nrow(count_matrix), ncol(count_matrix), sum(samples$group == "control"),
  sum(samples$group == "case"), min(colSums(count_matrix)) / 1e6,
  max(colSums(count_matrix)) / 1e6
))
