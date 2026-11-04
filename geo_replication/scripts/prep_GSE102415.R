#!/usr/bin/env Rscript

# Prepare the tracker-ranked fallback GSE102415: GLP-1/dexamethasone conjugate
# versus vehicle in DIO mouse hypothalamus. Each selected GSM has one deposited
# HTSeq gene-count file; the other three six-animal arms are not pooled in.

script_arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
if (length(script_arg) != 1L) stop("cannot resolve this script's path")
script_dir <- dirname(normalizePath(sub("^--file=", "", script_arg)))
root <- normalizePath(file.path(script_dir, ".."))
dataset_dir <- file.path(root, "datasets", "GSE102415_mmus_hypo_glp1_dexa")
archive <- file.path(dataset_dir, "raw", "GSE102415_RAW.tar")
soft_path <- file.path(dataset_dir, "metadata", "GSE102415_family.soft.gz")

assert <- function(ok, message) if (!isTRUE(ok)) stop(message, call. = FALSE)
assert(file.exists(archive) && file.info(archive)$size == 5109760,
       "GSE102415 raw-count archive is missing or its byte size changed")
assert(file.exists(soft_path) && file.info(soft_path)$size == 4595,
       "GSE102415 family SOFT is missing or its byte size changed")

expected_inventory <- c(
  sprintf("GSM%d_GAR%04d.gene.counts.tsv.gz", 2736209:2736231, 544:566),
  sprintf("GSM%d_GAR%04d.gene.counts.tsv.gz", 2736232:2736238, 611:617)
)
listed <- utils::untar(archive, list = TRUE)
assert(length(listed) == 30L && setequal(listed, expected_inventory),
       "GSE102415 archive inventory changed")

samples <- data.frame(
  sample = c(sprintf("GSM%d", 2736209:2736214), sprintf("GSM%d", 2736227:2736232)),
  group = c(rep("control", 6L), rep("case", 6L)),
  title = c("HT_1", "HT_2", "HT_19", "HT_20", "HT_29", "HT_30",
            "HT_37", "HT_38", "HT_291", "HT_301", "HT_31", "HT_32"),
  treatment = c(rep("vehicle", 6L), rep("GLP1_Dexa", 6L)),
  source_file = c(expected_inventory[1:6], expected_inventory[19:24]),
  stringsAsFactors = FALSE
)
assert(identical(as.integer(table(samples$group)[c("control", "case")]), c(6L, 6L)),
       "contrast is no longer six vehicle versus six GLP-1/Dexa libraries")

soft <- readLines(gzfile(soft_path), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft)
ends <- c(starts[-1L] - 1L, length(soft))
assert(length(starts) == 30L, "family SOFT no longer contains 30 samples")
for (i in seq_len(nrow(samples))) {
  j <- which(soft[starts] == paste0("^SAMPLE = ", samples$sample[i]))
  assert(length(j) == 1L, paste("missing SOFT block for", samples$sample[i]))
  block <- soft[starts[j]:ends[j]]
  required <- c(
    paste0("!Sample_title = ", samples$title[i]),
    paste0("!Sample_source_name_ch1 = ",
           if (samples$group[i] == "case") "GLP1/Dexa" else "vehicle"),
    "!Sample_characteristics_ch1 = tissue: Hypothalamus",
    "!Sample_library_strategy = RNA-Seq",
    paste0("!Sample_supplementary_file_1 = ftp://ftp.ncbi.nlm.nih.gov/geo/samples/GSM2736nnn/",
           samples$sample[i], "/suppl/", samples$source_file[i])
  )
  assert(all(required %in% block), paste("SOFT metadata changed for", samples$sample[i]))
}

extract_dir <- tempfile("GSE102415_extract_")
dir.create(extract_dir)
on.exit(unlink(extract_dir, recursive = TRUE, force = TRUE), add = TRUE)
utils::untar(archive, exdir = extract_dir)
assert(setequal(list.files(extract_dir), expected_inventory),
       "extracted archive inventory differs from its listing")

counts_list <- vector("list", nrow(samples))
reference_ids_versioned <- NULL
expected_libraries <- c(34605699, 44564321, 40326016, 37486736, 39812119, 40798407,
                        39073177, 37500457, 34644393, 35616352, 39852781, 38840355)
expected_detected <- c(22059L, 22584L, 22379L, 22265L, 22341L, 22438L,
                       22417L, 22387L, 22224L, 22329L, 22398L, 22428L)
summary_ids <- c("__no_feature", "__ambiguous", "__too_low_aQual",
                 "__not_aligned", "__alignment_not_unique")
unassigned_totals <- numeric(nrow(samples))

for (i in seq_len(nrow(samples))) {
  d <- read.delim(gzfile(file.path(extract_dir, samples$source_file[i])),
                  header = FALSE, sep = "\t", quote = "", comment.char = "",
                  stringsAsFactors = FALSE, check.names = FALSE)
  assert(nrow(d) == 37315L && ncol(d) == 2L,
         paste("unexpected count-file dimensions for", samples$sample[i]))
  raw_ids <- as.character(d[[1]])
  raw_values <- suppressWarnings(as.numeric(d[[2]]))
  is_summary <- startsWith(raw_ids, "__")
  assert(identical(raw_ids[is_summary], summary_ids),
         paste("HTSeq summary rows changed for", samples$sample[i]))
  ids <- raw_ids[!is_summary]
  values <- raw_values[!is_summary]
  assert(!anyNA(values) && all(is.finite(values)) && all(values >= 0) &&
           all(values == round(values)),
         paste("non-integer or invalid values for", samples$sample[i]))
  assert(length(ids) == 37310L &&
           all(grepl("^ENSMUSG[0-9]+[.][0-9]+$", ids)) && !anyDuplicated(ids),
         paste("invalid versioned Ensembl IDs for", samples$sample[i]))
  if (is.null(reference_ids_versioned)) reference_ids_versioned <- ids
  assert(identical(ids, reference_ids_versioned),
         paste("gene order differs for", samples$sample[i]))
  assert(sum(values) == expected_libraries[i] &&
           sum(values > 0) == expected_detected[i],
         paste("pinned count totals changed for", samples$sample[i]))
  counts_list[[i]] <- values
  unassigned_totals[i] <- sum(raw_values[is_summary])
}

ids <- sub("[.][0-9]+$", "", reference_ids_versioned)
assert(!anyDuplicated(ids), "removing Ensembl versions created duplicate gene IDs")
M <- do.call(cbind, counts_list)
rownames(M) <- ids
colnames(M) <- samples$sample
storage.mode(M) <- "numeric"
assert(all(M >= 0) && all(M == round(M)), "merged matrix is not integer counts")

out <- data.frame(gene = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(dataset_dir, "raw", "GSE102415_glp1_dexa_vs_vehicle_counts.tsv.gz")
con <- gzfile(out_path, "wt")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)

write.table(samples,
            file.path(dataset_dir, "metadata", "GSE102415_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)

qc <- data.frame(
  sample = samples$sample,
  group = samples$group,
  title = samples$title,
  treatment = samples$treatment,
  source_file = samples$source_file,
  raw_rows = nrow(M) + length(summary_ids),
  source_gene_rows = nrow(M),
  summary_rows_removed = length(summary_ids),
  htseq_unassigned_total = unassigned_totals,
  source_library_size = colSums(M),
  detected_genes = colSums(M > 0),
  merged_gene_rows = nrow(M),
  merged_library_size = colSums(M),
  count_conservation_delta = colSums(M) - expected_libraries,
  integer_counts = TRUE,
  nonnegative_counts = TRUE,
  gene_order_match = TRUE,
  metadata_match = TRUE,
  analysis_keep = TRUE,
  stringsAsFactors = FALSE
)
assert(all(qc$count_conservation_delta == 0), "merged counts are not exactly conserved")
write.table(qc,
            file.path(dataset_dir, "processed", "GSE102415_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)

cat(sprintf(
  "GSE102415 prepared: %d genes x %d independent hypothalamus libraries; vehicle=%d GLP-1/Dexa=%d; libraries %.2fM-%.2fM; exact conservation\n",
  nrow(M), ncol(M), sum(samples$group == "control"), sum(samples$group == "case"),
  min(colSums(M)) / 1e6, max(colSums(M)) / 1e6
))
