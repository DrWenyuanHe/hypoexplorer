#!/usr/bin/env Rscript

# Shared fail-closed assembler for GEO deposits containing one two-column,
# headerless gene-count file per biological library. Dataset-specific scripts
# source this file and pass a fully pinned specification to
# prepare_per_sample_gene_counts().

assert_count_prep <- function(ok, message) {
  if (!isTRUE(ok)) stop(message, call. = FALSE)
}

prepare_per_sample_gene_counts <- function(spec) {
  required_spec <- c(
    "accession", "dataset_dir", "archive_path", "archive_bytes", "soft_path",
    "soft_bytes", "expected_inventory", "samples", "expected_rows",
    "expected_library_sizes", "expected_detected_genes", "counts_path",
    "samplesheet_path", "qc_path"
  )
  assert_count_prep(
    all(required_spec %in% names(spec)),
    paste("prep specification is missing:", paste(setdiff(required_spec, names(spec)), collapse = ", "))
  )

  samples <- spec$samples
  required_sample_columns <- c(
    "sample", "group", "condition", "replicate", "source_file",
    "expected_title", "required_soft"
  )
  assert_count_prep(
    all(required_sample_columns %in% names(samples)),
    paste("sample specification is missing:", paste(setdiff(required_sample_columns, names(samples)), collapse = ", "))
  )
  assert_count_prep(!anyDuplicated(samples$sample), "sample accessions are duplicated")
  assert_count_prep(!anyDuplicated(samples$source_file), "source files are reused across libraries")
  assert_count_prep(
    identical(as.integer(table(factor(samples$group, levels = c("control", "case")))), c(3L, 3L)),
    "focused contrast must contain exactly three independent libraries per arm"
  )

  assert_count_prep(
    file.exists(spec$archive_path) && file.info(spec$archive_path)$size == spec$archive_bytes,
    paste(spec$accession, "source archive is missing or its byte size changed")
  )
  assert_count_prep(
    file.exists(spec$soft_path) && file.info(spec$soft_path)$size == spec$soft_bytes,
    paste(spec$accession, "family SOFT is missing or its byte size changed")
  )

  listed <- utils::untar(spec$archive_path, list = TRUE)
  assert_count_prep(
    length(listed) == length(spec$expected_inventory) && setequal(basename(listed), spec$expected_inventory),
    paste(spec$accession, "archive inventory changed")
  )
  source_dir <- dirname(spec$archive_path)
  extracted <- list.files(source_dir, pattern = "\\.txt\\.gz$", full.names = FALSE)
  assert_count_prep(
    length(extracted) == length(spec$expected_inventory) && setequal(extracted, spec$expected_inventory),
    paste(spec$accession, "extracted source inventory differs from the archive")
  )

  soft <- readLines(gzfile(spec$soft_path), warn = FALSE)
  starts <- grep("^\\^SAMPLE = ", soft)
  ends <- c(starts[-1L] - 1L, length(soft))
  assert_count_prep(
    length(starts) == length(spec$expected_inventory),
    paste(spec$accession, "SOFT sample inventory changed")
  )
  for (i in seq_len(nrow(samples))) {
    block_index <- which(vapply(starts, function(j) {
      identical(soft[j], paste0("^SAMPLE = ", samples$sample[i]))
    }, logical(1)))
    assert_count_prep(length(block_index) == 1L, paste("missing SOFT block for", samples$sample[i]))
    block <- soft[starts[block_index]:ends[block_index]]
    required <- c(
      paste0("!Sample_title = ", samples$expected_title[i]),
      "!Sample_library_strategy = RNA-Seq",
      samples$required_soft[[i]]
    )
    assert_count_prep(all(required %in% block), paste("SOFT metadata changed for", samples$sample[i]))
    supplementary <- grep("^!Sample_supplementary_file_1 = ", block, value = TRUE)
    assert_count_prep(
      length(supplementary) == 1L && endsWith(supplementary, paste0("/", samples$source_file[i])),
      paste("SOFT supplementary-file mapping changed for", samples$sample[i])
    )
  }

  expected_rows <- as.integer(spec$expected_rows)
  expected_library_sizes <- as.numeric(spec$expected_library_sizes)
  expected_detected_genes <- as.integer(spec$expected_detected_genes)
  expected_summary_ids <- if (is.null(spec$expected_summary_ids)) {
    c(
      "__no_feature", "__ambiguous", "__too_low_aQual",
      "__not_aligned", "__alignment_not_unique"
    )
  } else {
    spec$expected_summary_ids
  }
  assert_count_prep(
    length(expected_library_sizes) == nrow(samples) && length(expected_detected_genes) == nrow(samples),
    "pinned QC vectors do not match the selected sample count"
  )

  reference_ids <- NULL
  counts_list <- vector("list", nrow(samples))
  qc <- vector("list", nrow(samples))
  for (i in seq_len(nrow(samples))) {
    path <- file.path(source_dir, samples$source_file[i])
    d <- read.delim(
      gzfile(path), header = FALSE, sep = "\t", quote = "", comment.char = "",
      stringsAsFactors = FALSE, check.names = FALSE
    )
    assert_count_prep(
      ncol(d) == 2L && nrow(d) == expected_rows,
      paste("unexpected count-file dimensions in", samples$source_file[i])
    )
    ids <- as.character(d[[1]])
    raw_values <- suppressWarnings(as.numeric(d[[2]]))
    assert_count_prep(
      !anyNA(raw_values) && all(is.finite(raw_values)) && all(raw_values >= 0) &&
        all(raw_values == round(raw_values)),
      paste("non-integer, negative, or invalid counts in", samples$source_file[i])
    )
    is_summary <- startsWith(ids, "__")
    assert_count_prep(
      identical(ids[is_summary], expected_summary_ids),
      paste("named featureCounts/HTSeq summary rows changed in", samples$source_file[i])
    )
    gene_ids <- ids[!is_summary]
    values <- raw_values[!is_summary]
    assert_count_prep(
      !anyNA(gene_ids) && all(nzchar(gene_ids)) && !anyDuplicated(gene_ids) &&
        !any(startsWith(gene_ids, "__")),
      paste("invalid or duplicated gene identifiers in", samples$source_file[i])
    )
    if (is.null(reference_ids)) reference_ids <- gene_ids
    assert_count_prep(identical(gene_ids, reference_ids), paste("gene order differs in", samples$source_file[i]))
    assert_count_prep(
      sum(values) == expected_library_sizes[i] && sum(values > 0) == expected_detected_genes[i],
      paste("pinned count totals changed in", samples$source_file[i])
    )
    assert_count_prep(
      sum(values > 0) >= 5000L,
      paste("library fails the 5,000-detected-gene QC floor:", samples$sample[i])
    )
    counts_list[[i]] <- values
    qc[[i]] <- data.frame(
      sample = samples$sample[i], group = samples$group[i], condition = samples$condition[i],
      replicate = samples$replicate[i], source_file = samples$source_file[i],
      raw_rows = length(ids), source_gene_rows = length(gene_ids),
      summary_rows_removed = sum(is_summary),
      unassigned_or_summary_total = sum(raw_values[is_summary]),
      library_size = sum(values),
      detected_genes = sum(values > 0), integer_counts = TRUE,
      nonnegative_counts = TRUE, gene_order_match = TRUE, stringsAsFactors = FALSE
    )
  }

  count_matrix <- do.call(cbind, counts_list)
  rownames(count_matrix) <- reference_ids
  colnames(count_matrix) <- samples$sample
  storage.mode(count_matrix) <- "numeric"
  assert_count_prep(all(count_matrix >= 0) && all(count_matrix == round(count_matrix)),
                    "merged matrix is not nonnegative integer counts")

  qc <- do.call(rbind, qc)
  qc$merged_gene_rows <- nrow(count_matrix)
  qc$merged_library_size <- as.numeric(colSums(count_matrix))
  qc$count_conservation_delta <- qc$merged_library_size - qc$library_size
  qc$analysis_keep <- TRUE
  assert_count_prep(all(qc$count_conservation_delta == 0), "merged counts are not exactly conserved")

  dir.create(dirname(spec$counts_path), recursive = TRUE, showWarnings = FALSE)
  dir.create(dirname(spec$samplesheet_path), recursive = TRUE, showWarnings = FALSE)
  dir.create(dirname(spec$qc_path), recursive = TRUE, showWarnings = FALSE)
  out <- data.frame(gene_id = rownames(count_matrix), count_matrix,
                    check.names = FALSE, stringsAsFactors = FALSE)
  con <- gzfile(spec$counts_path, "wt")
  write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE)
  close(con)
  write.table(
    samples[, c("sample", "group", "condition", "replicate")],
    spec$samplesheet_path, sep = "\t", quote = FALSE, row.names = FALSE
  )
  write.table(qc, spec$qc_path, sep = "\t", quote = FALSE, row.names = FALSE)

  cat(sprintf(
    "%s prepared: %d genes x %d independent libraries; control=3 case=3; libraries %.2fM-%.2fM; exact conservation\n",
    spec$accession, nrow(count_matrix), ncol(count_matrix),
    min(colSums(count_matrix)) / 1e6, max(colSums(count_matrix)) / 1e6
  ))
  invisible(list(counts = count_matrix, samples = samples, qc = qc))
}
