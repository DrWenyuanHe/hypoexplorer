#!/usr/bin/env Rscript

# Assemble the GSE280030 palmitate-vs-vehicle contrast from per-culture HTSeq
# files. Leptin and leptin-antagonist cultures remain in the source archive but
# are not used as biological replicates for this two-arm contrast.

script_arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
if (length(script_arg) != 1L) stop("cannot resolve this script's path")
script_dir <- dirname(normalizePath(sub("^--file=", "", script_arg)))
root <- normalizePath(file.path(script_dir, ".."))
dataset_dir <- file.path(root, "datasets", "GSE280030_mmus_mhypoa_palmitate")
archive <- file.path(dataset_dir, "raw", "GSE280030_RAW.tar")
soft_path <- file.path(dataset_dir, "metadata", "GSE280030_family.soft.gz")

assert <- function(ok, message) if (!isTRUE(ok)) stop(message, call. = FALSE)
assert(file.exists(archive) && file.info(archive)$size == 2867200,
       "GSE280030_RAW.tar is missing or its byte size changed")
assert(file.exists(soft_path) && file.info(soft_path)$size == 3828,
       "GSE280030 family SOFT is missing or its byte size changed")

expected_inventory <- c(
  "GSM8585940_D3counts.txt.gz", "GSM8585941_D16counts.txt.gz",
  "GSM8585942_D17counts.txt.gz", "GSM8585943_D19counts.txt.gz",
  "GSM8585944_D20counts.txt.gz", "GSM8585945_D21counts.txt.gz",
  "GSM8585946_D40counts.txt.gz", "GSM8585947_D22counts.txt.gz",
  "GSM8585948_D23counts.txt.gz", "GSM8585949_D24counts.txt.gz",
  "GSM8585950_D41counts.txt.gz", "GSM8585951_D25counts.txt.gz",
  "GSM8585952_D26counts.txt.gz", "GSM8585953_D27counts.txt.gz",
  "GSM8585954_D42counts.txt.gz"
)
listed <- utils::untar(archive, list = TRUE)
assert(length(listed) == 15L && setequal(listed, expected_inventory),
       "GSE280030 archive inventory changed")

samples <- data.frame(
  sample = sprintf("GSM%d", 8585940:8585946),
  group = c(rep("control", 3L), rep("case", 4L)),
  condition = c(rep("vehicle_bsa", 3L), rep("palmitate_5mM", 4L)),
  culture_replicate = c("D3", "D16", "D17", "D19", "D20", "D21", "D40"),
  source_file = expected_inventory[1:7],
  treatment_code = c(rep("CTR", 3L), rep("PA", 4L)),
  expected_title = c(
    "Neural cells, control, 3", "Neural cells, control, 16",
    "Neural cells, control, 17", "Neural cells, Palmitic acid, 19",
    "Neural cells, Palmitic acid, 20", "Neural cells, Palmitic acid, 21",
    "Neural cells, Palmitic acid, 40"
  ),
  stringsAsFactors = FALSE
)
assert(identical(as.integer(table(samples$group)[c("control", "case")]), c(3L, 4L)),
       "contrast is no longer 3 control cultures versus 4 palmitate cultures")

soft <- readLines(gzfile(soft_path), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft)
ends <- c(starts[-1L] - 1L, length(soft))
assert(length(starts) == 15L, "family SOFT no longer contains 15 samples")
for (i in seq_len(nrow(samples))) {
  block_index <- which(vapply(starts, function(j) {
    identical(soft[j], paste0("^SAMPLE = ", samples$sample[i]))
  }, logical(1)))
  assert(length(block_index) == 1L, paste("missing SOFT block for", samples$sample[i]))
  block <- soft[starts[block_index]:ends[block_index]]
  required <- c(
    paste0("!Sample_title = ", samples$expected_title[i]),
    "!Sample_source_name_ch1 = mHypoA-2/12 (Clu177, Cedarlane, Canada)",
    "!Sample_characteristics_ch1 = cell line: mHypoA-2/12 (Clu177, Cedarlane, Canada)",
    "!Sample_characteristics_ch1 = cell type: neural cells",
    paste0("!Sample_characteristics_ch1 = treatment: ", samples$treatment_code[i]),
    "!Sample_library_strategy = RNA-Seq",
    paste0(
      "!Sample_supplementary_file_1 = ftp://ftp.ncbi.nlm.nih.gov/geo/samples/GSM8585nnn/",
      samples$sample[i], "/suppl/", samples$source_file[i]
    )
  )
  assert(all(required %in% block), paste("SOFT metadata changed for", samples$sample[i]))
}

extract_dir <- tempfile("GSE280030_extract_")
dir.create(extract_dir)
on.exit(unlink(extract_dir, recursive = TRUE, force = TRUE), add = TRUE)
utils::untar(archive, exdir = extract_dir)
assert(setequal(list.files(extract_dir), expected_inventory),
       "extracted GSE280030 inventory differs from the archive listing")

summary_ids <- c(
  "__no_feature", "__ambiguous", "__too_low_aQual",
  "__not_aligned", "__alignment_not_unique"
)
counts_list <- vector("list", nrow(samples))
qc <- vector("list", nrow(samples))
reference_ids <- NULL
expected_library_sizes <- c(1959684, 2418401, 2450772, 2302394, 1785121, 2019981, 2186375)
expected_detected_genes <- c(19555L, 20672L, 19961L, 20168L, 19409L, 20179L, 19939L)

for (i in seq_len(nrow(samples))) {
  path <- file.path(extract_dir, samples$source_file[i])
  d <- read.delim(
    gzfile(path), header = FALSE, sep = "\t", quote = "",
    comment.char = "", stringsAsFactors = FALSE, check.names = FALSE
  )
  assert(ncol(d) == 2L && nrow(d) == 57015L,
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
  assert(length(gene_ids) == 57010L && !anyDuplicated(gene_ids),
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
    condition = samples$condition[i], culture_replicate = samples$culture_replicate[i],
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

counts_path <- file.path(dataset_dir, "raw", "GSE280030_PA_vs_CTR_counts.tsv.gz")
samplesheet_path <- file.path(dataset_dir, "metadata", "GSE280030_samplesheet.tsv")
qc_path <- file.path(dataset_dir, "processed", "GSE280030_preprocessing_qc.tsv")

out <- data.frame(gene_id = rownames(count_matrix), count_matrix,
                  check.names = FALSE, stringsAsFactors = FALSE)
con <- gzfile(counts_path, "wt")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)
write.table(
  samples[, c("sample", "group", "condition", "culture_replicate")],
  samplesheet_path, sep = "\t", quote = FALSE, row.names = FALSE
)
write.table(qc, qc_path, sep = "\t", quote = FALSE, row.names = FALSE)

cat(sprintf(
  "GSE280030 prepared: %d genes x %d independent cultures; control=%d case=%d; libraries %.2fM-%.2fM; exact conservation\n",
  nrow(count_matrix), ncol(count_matrix), sum(samples$group == "control"),
  sum(samples$group == "case"), min(colSums(count_matrix)) / 1e6,
  max(colSums(count_matrix)) / 1e6
))
