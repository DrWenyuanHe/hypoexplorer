#!/usr/bin/env Rscript

# Assemble the canonical GSE232510 arcuate-nucleus HFD-vs-chow contrast from
# per-animal HTSeq files. The exercise and miR-211 arms are deliberately not
# analysis replicates for this contrast.

script_arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
if (length(script_arg) != 1L) stop("cannot resolve this script's path")
script_dir <- dirname(normalizePath(sub("^--file=", "", script_arg)))
root <- normalizePath(file.path(script_dir, ".."))
dataset_dir <- file.path(root, "datasets", "GSE232510_rnor_arc_hfd")
archive <- file.path(dataset_dir, "raw", "GSE232510_RAW.tar")
soft_path <- file.path(dataset_dir, "metadata", "GSE232510_family.soft.gz")

assert <- function(ok, message) if (!isTRUE(ok)) stop(message, call. = FALSE)
assert(file.exists(archive) && file.info(archive)$size == 2150400,
       "GSE232510_RAW.tar is missing or its byte size changed")
assert(file.exists(soft_path) && file.info(soft_path)$size == 4073,
       "GSE232510 family SOFT is missing or its byte size changed")

expected_inventory <- c(
  "GSM7349354_CS_Rep1_count.txt.gz",
  "GSM7349355_CS_Rep4_count.txt.gz",
  "GSM7349356_CS_Rep5_count.txt.gz",
  "GSM7349357_HFS_Rep1_count.txt.gz",
  "GSM7349358_HFS_Rep2_count.txt.gz",
  "GSM7349359_HFS_Rep4_count.txt.gz",
  "GSM7349360_HFR_Rep1_count.txt.gz",
  "GSM7349361_HFR_Rep2_count.txt.gz",
  "GSM7349362_HFR_Rep3_count.txt.gz",
  "GSM7349363_HFR_Rep4_count.txt.gz",
  "GSM7349364_S_1_mir3_counts_htseq.umi_corrected.tsv.gz",
  "GSM7349365_S_3_mir8_counts_htseq.umi_corrected.tsv.gz",
  "GSM7349366_S_4_mir20_counts_htseq.umi_corrected.tsv.gz",
  "GSM7349367_S_6_mir30_counts_htseq.umi_corrected.tsv.gz",
  "GSM7349368_S_1_inh9_counts_htseq.umi_corrected.tsv.gz",
  "GSM7349369_S_2_inh10_counts_htseq.umi_corrected.tsv.gz",
  "GSM7349370_S_3_inh13_counts_htseq.umi_corrected.tsv.gz",
  "GSM7349371_S_4_inh19_counts_htseq.umi_corrected.tsv.gz"
)
listed <- utils::untar(archive, list = TRUE)
assert(length(listed) == 18L && setequal(listed, expected_inventory),
       "GSE232510 archive inventory changed")

samples <- data.frame(
  sample = sprintf("GSM%d", 7349354:7349359),
  group = c(rep("control", 3L), rep("case", 3L)),
  condition = c(rep("chow_sedentary", 3L), rep("high_fat_sedentary", 3L)),
  animal = c("CS_Rep1", "CS_Rep4", "CS_Rep5", "HFS_Rep1", "HFS_Rep2", "HFS_Rep4"),
  source_file = expected_inventory[1:6],
  expected_title = c(
    "WSH female arcuate nucleus, chow sedentary, rep 1",
    "WSH female arcuate nucleus, chow sedentary, rep 2",
    "WSH female arcuate nucleus, chow sedentary, rep 3",
    "WSH female arcuate nucleus, HF sedentary, rep 1",
    "WSH female arcuate nucleus, HF sedentary, rep 2",
    "WSH female arcuate nucleus, HF sedentary, rep 3"
  ),
  stringsAsFactors = FALSE
)
assert(identical(as.integer(table(samples$group)[c("control", "case")]), c(3L, 3L)),
       "contrast is no longer 3 control animals versus 3 case animals")

soft <- readLines(gzfile(soft_path), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft)
ends <- c(starts[-1L] - 1L, length(soft))
assert(length(starts) == 18L, "family SOFT no longer contains 18 samples")
for (i in seq_len(nrow(samples))) {
  block_index <- which(vapply(starts, function(j) {
    identical(soft[j], paste0("^SAMPLE = ", samples$sample[i]))
  }, logical(1)))
  assert(length(block_index) == 1L, paste("missing SOFT block for", samples$sample[i]))
  block <- soft[starts[block_index]:ends[block_index]]
  required <- c(
    paste0("!Sample_title = ", samples$expected_title[i]),
    "!Sample_source_name_ch1 = Hypothalamic arcuate nucleus",
    "!Sample_characteristics_ch1 = tissue: Hypothalamic arcuate nucleus",
    "!Sample_characteristics_ch1 = Sex: Female",
    "!Sample_library_strategy = RNA-Seq",
    paste0(
      "!Sample_supplementary_file_1 = ftp://ftp.ncbi.nlm.nih.gov/geo/samples/GSM7349nnn/",
      samples$sample[i], "/suppl/", samples$source_file[i]
    )
  )
  assert(all(required %in% block), paste("SOFT metadata changed for", samples$sample[i]))
}

extract_dir <- tempfile("GSE232510_extract_")
dir.create(extract_dir)
on.exit(unlink(extract_dir, recursive = TRUE, force = TRUE), add = TRUE)
utils::untar(archive, exdir = extract_dir)
assert(setequal(list.files(extract_dir), expected_inventory),
       "extracted GSE232510 inventory differs from the archive listing")

summary_ids <- c(
  "__no_feature", "__ambiguous", "__too_low_aQual",
  "__not_aligned", "__alignment_not_unique"
)
counts_list <- vector("list", nrow(samples))
qc <- vector("list", nrow(samples))
reference_ids <- NULL
expected_library_sizes <- c(5154977, 5634204, 4680736, 5769107, 6373077, 6322895)
expected_detected_genes <- c(15421L, 15561L, 15304L, 15618L, 15608L, 15564L)

for (i in seq_len(nrow(samples))) {
  path <- file.path(extract_dir, samples$source_file[i])
  d <- read.delim(
    gzfile(path), header = FALSE, sep = "\t", quote = "",
    comment.char = "", stringsAsFactors = FALSE, check.names = FALSE
  )
  assert(ncol(d) == 2L && nrow(d) == 32888L,
         paste("unexpected HTSeq dimensions in", samples$source_file[i]))
  ids <- as.character(d[[1]])
  values <- suppressWarnings(as.numeric(d[[2]]))
  assert(!anyNA(values) && all(is.finite(values)) && all(values >= 0) &&
           all(values == round(values)),
         paste("non-integer or invalid counts in", samples$source_file[i]))
  is_summary <- startsWith(ids, "__")
  assert(identical(ids[is_summary], summary_ids),
         paste("HTSeq summary rows changed in", samples$source_file[i]))
  gene_ids <- ids[!is_summary]
  gene_counts <- values[!is_summary]
  assert(length(gene_ids) == 32883L && !anyDuplicated(gene_ids),
         paste("gene rows are invalid in", samples$source_file[i]))
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
    source_file = samples$source_file[i], raw_rows = nrow(d),
    source_gene_rows = length(gene_ids), summary_rows_removed = sum(is_summary),
    htseq_unassigned_total = sum(values[is_summary]),
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
qc$analysis_keep <- TRUE
assert(all(qc$count_conservation_delta == 0), "merged counts are not exactly conserved")

counts_path <- file.path(dataset_dir, "raw", "GSE232510_arc_HFS_vs_CS_counts.tsv.gz")
samplesheet_path <- file.path(dataset_dir, "metadata", "GSE232510_samplesheet.tsv")
qc_path <- file.path(dataset_dir, "processed", "GSE232510_preprocessing_qc.tsv")

out <- data.frame(gene_id = rownames(count_matrix), count_matrix,
                  check.names = FALSE, stringsAsFactors = FALSE)
con <- gzfile(counts_path, "wt")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)
write.table(
  samples[, c("sample", "group", "condition", "animal")],
  samplesheet_path, sep = "\t", quote = FALSE, row.names = FALSE
)
write.table(qc, qc_path, sep = "\t", quote = FALSE, row.names = FALSE)

cat(sprintf(
  "GSE232510 prepared: %d genes x %d independent rats; control=%d case=%d; libraries %.2fM-%.2fM; exact conservation\n",
  nrow(count_matrix), ncol(count_matrix), sum(samples$group == "control"),
  sum(samples$group == "case"), min(colSums(count_matrix)) / 1e6,
  max(colSums(count_matrix)) / 1e6
))
