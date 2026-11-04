suppressMessages({
  library(data.table)
  library(digest)
})

root <- file.path("geo_replication", "datasets", "GSE224254_mouse_sst_neuron_sex")
raw_dir <- file.path(root, "raw")
soft_path <- file.path(root, "metadata", "GSE224254_family.soft.gz")
archive_path <- file.path(raw_dir, "GSE224254_RAW.tar")
runinfo_path <- file.path(root, "metadata", "GSE224254_sra_runinfo.csv")
reference_path <- file.path(root, "metadata", "Mus_musculus.GRCm38.release97.cdna.all.fa.gz")
out_path <- file.path(raw_dir, "GSE224254_sst_neuron_gene_expected_counts.tsv.gz")
map_path <- file.path(root, "metadata", "GSE224254_transcript_to_gene.tsv.gz")
sample_path <- file.path(root, "metadata", "GSE224254_samplesheet.tsv")
qc_path <- file.path(root, "processed", "GSE224254_preprocessing_qc.tsv")
quarantine_path <- file.path(root, "processed", "GSE224254_quarantined_transcripts.tsv.gz")
manifest_path <- file.path(root, "metadata", "GSE224254_source_files.tsv")

geo_accession <- paste0("GSM", 7018347:7018354)
sample_names <- c(paste0("female_", 1:4), paste0("male_", 1:4))
source_files <- file.path(raw_dir, paste0(geo_accession, "_", 3297:3304, ".tsv.gz"))
stopifnot(
  file.exists(soft_path), file.exists(archive_path), file.exists(runinfo_path),
  file.exists(reference_path), all(file.exists(source_files))
)

tables <- lapply(source_files, fread, check.names = FALSE)
expected_names <- c("target_id", "length", "eff_length", "est_counts", "tpm")
stopifnot(all(vapply(tables, function(x) identical(names(x), expected_names), logical(1))))
stopifnot(length(unique(vapply(tables, nrow, integer(1)))) == 1L)
source_rows <- nrow(tables[[1L]])
stopifnot(source_rows %% 2L == 0L)
block_rows <- source_rows %/% 2L

reference_ids <- tables[[1L]]$target_id[seq_len(block_rows)]
stopifnot(!anyNA(reference_ids), all(nzchar(reference_ids)), !anyDuplicated(reference_ids))
for (x in tables) {
  stopifnot(
    identical(x$target_id[seq_len(block_rows)], reference_ids),
    identical(x$target_id[block_rows + seq_len(block_rows)], reference_ids),
    identical(x$length[seq_len(block_rows)], x$length[block_rows + seq_len(block_rows)]),
    identical(x$eff_length[seq_len(block_rows)], x$eff_length[block_rows + seq_len(block_rows)]),
    all(is.finite(x$est_counts)), all(x$est_counts >= 0),
    all(is.finite(x$tpm)), all(x$tpm >= 0)
  )
}

# Each GSM has exactly two SRA runs, and each submitted abundance file contains
# two complete Kallisto blocks in the same transcript order, each independently
# summing to ~1e6 TPM. Sum the fractional expected counts across those technical
# runs before gene aggregation; never round them.
runinfo <- fread(runinfo_path)
stopifnot(all(geo_accession %in% runinfo$LibraryName))
run_counts <- runinfo[, .(sra_runs = uniqueN(Run), sra_experiments = uniqueN(Experiment)), by = LibraryName]
stopifnot(all(run_counts[match(geo_accession, LibraryName), sra_runs] == 2L))
stopifnot(all(run_counts[match(geo_accession, LibraryName), sra_experiments] == 1L))

transcript_counts <- vapply(tables, function(x) {
  x$est_counts[seq_len(block_rows)] + x$est_counts[block_rows + seq_len(block_rows)]
}, numeric(block_rows))
colnames(transcript_counts) <- sample_names

canonical_transcript <- sub("\\.[0-9]+$", "", reference_ids)
stopifnot(!anyDuplicated(canonical_transcript))

# The submitted target universe matches the official Ensembl GRCm38 release-97
# cDNA reference (118,333 of 118,489 canonical transcript IDs; 99.87%). Parse
# that version-matched primary reference instead of projecting through a newer
# annotation snapshot that has retired many otherwise valid source transcripts.
con <- gzfile(reference_path, "rt")
headers <- character()
repeat {
  block <- readLines(con, n = 100000L, warn = FALSE)
  if (!length(block)) break
  headers <- c(headers, block[startsWith(block, ">")])
}
close(con)
stopifnot(length(headers) > 100000L)
reference_mapping <- data.table(
  reference_transcript_id = sub("^>([^ ]+).*$", "\\1", headers),
  canonical_transcript = sub("^>(ENSMUST[0-9]+).*$", "\\1", headers),
  gene_id = sub("^.* gene:(ENSMUSG[0-9]+)(?:\\.[0-9]+)? .*$", "\\1", headers),
  symbol = ifelse(
    grepl(" gene_symbol:[^ ]+", headers),
    sub("^.* gene_symbol:([^ ]+).*$", "\\1", headers),
    NA_character_
  )
)
stopifnot(
  all(grepl("^ENSMUST[0-9]+\\.[0-9]+$", reference_mapping$reference_transcript_id)),
  all(grepl("^ENSMUST[0-9]+$", reference_mapping$canonical_transcript)),
  all(grepl("^ENSMUSG[0-9]+$", reference_mapping$gene_id))
)
mapping_count <- reference_mapping[, .(gene_mappings = uniqueN(gene_id)), by = canonical_transcript]
unique_map <- reference_mapping[mapping_count[gene_mappings == 1L], on = "canonical_transcript"]
unique_map <- unique_map[!duplicated(canonical_transcript)]
gene_id <- unique_map$gene_id[match(canonical_transcript, unique_map$canonical_transcript)]
symbol <- unique_map$symbol[match(canonical_transcript, unique_map$canonical_transcript)]
ambiguous_ids <- mapping_count[gene_mappings > 1L, canonical_transcript]
status <- ifelse(
  canonical_transcript %in% ambiguous_ids,
  "ambiguous Ensembl GRCm38 release-97 transcript-to-gene mapping",
  ifelse(is.na(gene_id), "absent from Ensembl GRCm38 release-97 cDNA reference", "retained unique release-97 mapping")
)
retained <- status == "retained unique release-97 mapping"
stopifnot(any(retained), any(!retained))

map_table <- data.table(
  source_transcript_id = reference_ids,
  canonical_transcript_id = canonical_transcript,
  gene_id,
  symbol,
  mapping_status = status
)
con <- gzfile(map_path, "wt")
write.table(map_table, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)

gene_counts <- rowsum(transcript_counts[retained, , drop = FALSE], group = gene_id[retained], reorder = FALSE)
stopifnot(!anyDuplicated(rownames(gene_counts)), all(is.finite(gene_counts)), all(gene_counts >= 0))
out <- data.table(gene_id = rownames(gene_counts))
out[, (sample_names) := as.data.table(gene_counts)]
con <- gzfile(out_path, "wt")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)

quarantine <- data.table(
  source_transcript_id = reference_ids[!retained],
  canonical_transcript_id = canonical_transcript[!retained],
  exclusion_reason = status[!retained]
)
quarantine[, (sample_names) := as.data.table(transcript_counts[!retained, , drop = FALSE])]
con <- gzfile(quarantine_path, "wt")
write.table(quarantine, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)

soft <- readLines(gzfile(soft_path), warn = FALSE)
sample_starts <- grep("^\\^SAMPLE = ", soft)
sample_ends <- c(sample_starts[-1L] - 1L, length(soft))
sample_ids <- sub("^\\^SAMPLE = ", "", soft[sample_starts])
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
  group = c(rep("control", 4L), rep("case", 4L)),
  geo_accession,
  biosample,
  sra_experiment,
  title,
  sex = c(rep("female", 4L), rep("male", 4L)),
  tissue = "tuberal hypothalamus",
  cell_type = "FACS-isolated SST neurons",
  genotype = "Sst-Cre heterozygote",
  contrast_role = c(rep("control (female)", 4L), rep("case (male)", 4L))
)
fwrite(samples, sample_path, sep = "\t")

total <- colSums(transcript_counts)
retained_total <- colSums(transcript_counts[retained, , drop = FALSE])
quarantined_total <- colSums(transcript_counts[!retained, , drop = FALSE])
qc <- data.table(
  sample = sample_names,
  group = samples$group,
  geo_accession,
  sra_runs = 2L,
  source_rows = source_rows,
  unique_source_transcripts = block_rows,
  duplicated_technical_run_rows = block_rows,
  uniquely_mapped_transcripts = sum(retained),
  release97_reference_transcripts = nrow(reference_mapping),
  canonical_reference_overlap = sum(canonical_transcript %in% reference_mapping$canonical_transcript),
  quarantined_unmapped_transcripts = sum(status == "absent from Ensembl GRCm38 release-97 cDNA reference"),
  quarantined_ambiguous_transcripts = sum(status == "ambiguous Ensembl GRCm38 release-97 transcript-to-gene mapping"),
  output_genes = nrow(out),
  nonfinite_values = colSums(!is.finite(transcript_counts)),
  negative_values = colSums(transcript_counts < 0),
  fractional_values = colSums(abs(transcript_counts - round(transcript_counts)) > 1e-10),
  source_expected_count_sum = total,
  retained_expected_count_sum = retained_total,
  quarantined_expected_count_sum = quarantined_total,
  mapped_count_fraction = retained_total / total,
  partition_delta = total - retained_total - quarantined_total,
  detected_output_genes = colSums(gene_counts > 0),
  minimum_pairwise_correlation = apply(cor(log2(gene_counts + 1)), 2L, function(x) min(x[x < 1 - 1e-12])),
  accepted_input_class = "Kallisto fractional expected counts, two technical SRA runs per biological sample",
  aggregation = "sum technical-run blocks; Ensembl GRCm38 release-97 transcript-to-gene map; sum transcripts by gene",
  shared_route = "input_kind=counts -> canonical edgeR-QL model; fractional estimates preserved"
)
fwrite(qc, qc_path, sep = "\t")

source_paths <- c(archive_path, soft_path, runinfo_path, reference_path, source_files)
manifest <- data.table(
  file = basename(source_paths),
  bytes = file.info(source_paths)$size,
  sha256 = vapply(source_paths, digest, character(1), file = TRUE, algo = "sha256", serialize = FALSE),
  role = c(
    "official GEO processed-data archive",
    "official GEO family metadata",
    "official NCBI SRA run table confirming two runs per GSM",
    "official Ensembl GRCm38 release-97 cDNA reference; exact transcript-to-gene authority",
    rep("official per-GSM Kallisto transcript abundance file extracted unchanged from archive", length(source_files))
  )
)
fwrite(manifest, manifest_path, sep = "\t")

cat(sprintf(
  "GSE224254: %d unique transcripts -> %d uniquely mapped genes x %d samples; retained %.2f%% of expected-count mass\n",
  block_rows, nrow(out), length(sample_names), 100 * sum(retained_total) / sum(total)
))
