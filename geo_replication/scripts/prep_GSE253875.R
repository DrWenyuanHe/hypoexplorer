#!/usr/bin/env Rscript

# Prepare GT1-7 hypothalamic GnRH-neuron cultures treated for 24 hours with
# 0.125 uM Alisol B versus matched vehicle/control cultures. GEO supplies the
# original featureCounts integer matrix, so this dataset follows edgeR-QL.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE253875_mmus_gt17_alisolb")
SRC <- file.path(DS, "raw", "source", "GSE253875_gene_count.txt.gz")
SOFT <- file.path(DS, "metadata", "GSE253875_family.soft.gz")
assert <- function(ok, message) if (!isTRUE(ok)) stop(message, call. = FALSE)

assert(file.exists(SRC) && file.info(SRC)$size == 2185503,
       "GSE253875 count matrix is missing or its byte size changed")
assert(file.exists(SOFT) && file.info(SOFT)$size == 2525,
       "GSE253875 family SOFT is missing or its byte size changed")

samples <- data.frame(
  sample = c("GSM8029702", "GSM8029703", "GSM8029704",
             "GSM8029699", "GSM8029700", "GSM8029701"),
  group = rep(c("control", "case"), each = 3L),
  condition = rep(c("vehicle_control_24h", "Alisol_B_0.125uM_24h"), each = 3L),
  source_column = c("C1", "C2", "C3", "A1", "A2", "A3"),
  expected_title = c(
    "GT1-7 cells, control, 24hours, rep1",
    "GT1-7 cells, control, 24hours, rep2",
    "GT1-7 cells, control, 24hours, rep3",
    "GT1-7 cells, Alisol B intervention, 24hours, rep1",
    "GT1-7 cells, Alisol B intervention, 24hours, rep2",
    "GT1-7 cells, Alisol B intervention, 24hours, rep3"
  ),
  biological_replicate = rep(1:3, 2L), stringsAsFactors = FALSE
)
assert(all(table(samples$group) >= 3L) && !anyDuplicated(samples$sample),
       "contrast no longer contains three independent cultures per arm")

soft <- readLines(gzfile(SOFT), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft)
ends <- c(starts[-1L] - 1L, length(soft))
names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
assert(length(starts) == 6L, "family SOFT no longer contains six samples")
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
block <- function(gsm) {
  i <- match(gsm, names(starts)); assert(!is.na(i), paste("SOFT is missing", gsm))
  soft[starts[i]:ends[i]]
}
biosample <- character(nrow(samples))
for (i in seq_len(nrow(samples))) {
  b <- block(samples$sample[i])
  expected_treatment <- if (samples$group[i] == "case") "Alisol B intervention" else "control"
  chars <- tag(b, "!Sample_characteristics_ch1")
  assert(identical(tag(b, "!Sample_title"), samples$expected_title[i]) &&
           identical(tag(b, "!Sample_source_name_ch1"), "GT1-7 cells") &&
           all(c("cell line: GT1-7 cells", paste0("genotype: ", expected_treatment),
                 paste0("treatment: ", expected_treatment)) %in% chars) &&
           identical(tag(b, "!Sample_library_strategy"), "RNA-Seq"),
         paste("GEO metadata changed for", samples$sample[i]))
  rel <- grep("^BioSample: ", tag(b, "!Sample_relation"), value = TRUE)
  assert(length(rel) == 1L, paste("expected one BioSample for", samples$sample[i]))
  biosample[i] <- sub("^.*/", "", rel)
}
assert(!anyDuplicated(biosample), "selected culture libraries share a BioSample")
samples$biosample <- biosample

d <- read.delim(gzfile(SRC), check.names = FALSE, stringsAsFactors = FALSE)
assert(nrow(d) == 54532L && ncol(d) == 16L,
       "GSE253875 source count matrix dimensions changed")
assert(identical(names(d)[1:7], c("gene_id", "C1", "C2", "C3", "A1", "A2", "A3")),
       "GSE253875 count columns changed")
gene_ids <- as.character(d$gene_id)
assert(!anyNA(gene_ids) && all(grepl("^ENSMUSG[0-9]+$", gene_ids)) && !anyDuplicated(gene_ids),
       "GSE253875 gene identifiers are invalid or duplicated")
M <- as.matrix(d[, samples$source_column, drop = FALSE]); storage.mode(M) <- "double"
colnames(M) <- samples$sample
assert(!anyNA(M) && all(is.finite(M)) && all(M >= 0) && all(M == round(M)),
       "GSE253875 source is no longer non-negative integer counts")
expected_totals <- c(13856608, 14918830, 15143826, 15875638, 15073493, 13364102)
expected_detected <- c(23124L, 23722L, 23783L, 23908L, 23644L, 23644L)
assert(identical(as.numeric(colSums(M)), expected_totals) &&
         identical(as.integer(colSums(M > 0)), expected_detected),
       "GSE253875 pinned library totals or detected-gene counts changed")
assert(min(colSums(M)) >= 1e6 && min(colSums(M > 0)) >= 5000,
       "GSE253875 hard library-size/detection QC failed")

out <- data.frame(gene_id = gene_ids, M, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE253875_AlisolB_vs_control_counts.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)

ss <- data.frame(sample = samples$sample, group = samples$group, condition = samples$condition,
                 geo_accession = samples$sample, biosample = samples$biosample,
                 source_column = samples$source_column, cell_line = "GT1-7",
                 biological_replicate = samples$biological_replicate, stringsAsFactors = FALSE)
write.table(ss, file.path(DS, "metadata", "GSE253875_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

qc <- data.frame(sample = samples$sample, group = samples$group,
                 source_column = samples$source_column, source_gene_rows = nrow(M),
                 output_gene_rows = nrow(M), source_library_size = colSums(M),
                 output_library_size = colSums(M), count_conservation_delta = 0,
                 detected_genes = colSums(M > 0), integer_counts = TRUE,
                 nonnegative_counts = TRUE, hard_qc_pass = TRUE, stringsAsFactors = FALSE)
assert(all(qc$count_conservation_delta == 0), "GSE253875 counts were not exactly conserved")
write.table(qc, file.path(DS, "processed", "GSE253875_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
paths <- c(SRC, SOFT)
expected_sha <- c("3143c5c1fe4a33c55adf1d51cd30a8d6ef62b0bd186dabd92902a6843bee9962",
                  "6780440bfe24b50a49428ed5c0e265970c6cb6409352c1377c28e9a948acaf2c")
observed_sha <- vapply(paths, sha256_file, character(1))
assert(identical(unname(observed_sha), expected_sha), "GSE253875 source checksum changed")
manifest <- data.frame(
  file = basename(paths), bytes = as.numeric(file.info(paths)$size), sha256 = observed_sha,
  source = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE253nnn/GSE253875/suppl/GSE253875_gene_count.txt.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE253nnn/GSE253875/soft/GSE253875_family.soft.gz"
  ), fetched = "2026-08-31", stringsAsFactors = FALSE
)
write.table(manifest, file.path(DS, "metadata", "GSE253875_source_files.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE253875] wrote %d genes x 6 cultures; control=3 case=3; exact conservation; hard QC passed\n", nrow(M)))
