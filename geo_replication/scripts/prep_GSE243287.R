#!/usr/bin/env Rscript

# Prepare male whole-hypothalamus RNA-seq from tamoxifen-treated adult mice:
# Camk2a-CreERT2-negative Smc3-floxed controls versus neuron-specific Smc3 cKO.
# GEO deposits normalized CPM, which is preserved and log2(CPM+1)-transformed
# for limma/eBayes. Fractional values are never rounded into pseudo-counts.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE243287_mmus_hypothalamus_smc3cko")
SRC <- file.path(DS, "raw", "source", "GSE243287_normalized_CPM.General.txt.gz")
SOFT <- file.path(DS, "metadata", "GSE243287_family.soft.gz")
assert <- function(ok, message) if (!isTRUE(ok)) stop(message, call. = FALSE)

assert(file.exists(SRC) && file.info(SRC)$size == 1340734,
       "GSE243287 normalized CPM matrix is missing or its byte size changed")
assert(file.exists(SOFT) && file.info(SOFT)$size == 3132,
       "GSE243287 family SOFT is missing or its byte size changed")

samples <- data.frame(
  sample = paste0("GSM", 7782807:7782818),
  group = c(rep("control", 7L), rep("case", 5L)),
  animal = c("wt1", "wt4", "wt5", "wt6", "wt7", "wt11", "wt15",
             "cko8", "cko9", "cko12", "cko13", "cko14"),
  expected_title = c(
    "Wt1 hypothalamus, control, week 5", "Wt4 hypothalamus, control, week 5",
    "Wt5 hypothalamus, control, week 5", "Wt6 hypothalamus, control, week 5",
    "Wt7 hypothalamus, control, week 5", "Wt11 hypothalamus, control, week 5",
    "Wt15 hypothalamus, control, week 5", "cKO8 hypothalamus, control, week 5",
    "cKO9 hypothalamus, control, week 5", "cKO12 hypothalamus, control, week 5",
    "cKO13 hypothalamus, control, week 5", "cKO14 hypothalamus, control, week 5"
  ), stringsAsFactors = FALSE
)
assert(all(table(samples$group) >= 3L) && !anyDuplicated(samples$sample),
       "GSE243287 contrast lacks independent >=3/arm animals")

soft <- readLines(gzfile(SOFT), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft))
names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
assert(length(starts) == 12L, "family SOFT no longer contains 12 samples")
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
block <- function(gsm) {
  i <- match(gsm, names(starts)); assert(!is.na(i), paste("SOFT is missing", gsm))
  soft[starts[i]:ends[i]]
}
biosample <- character(nrow(samples))
for (i in seq_len(nrow(samples))) {
  b <- block(samples$sample[i]); chars <- tag(b, "!Sample_characteristics_ch1")
  genotype <- if (samples$group[i] == "case")
    "genotype: floxed Smc3 and Camk2a-cre/ERT2+ (Cre+)" else
    "genotype: floxed Smc3 and Camk2a-cre/ERT2- (Cre-)"
  assert(identical(tag(b, "!Sample_title"), samples$expected_title[i]) &&
           identical(tag(b, "!Sample_source_name_ch1"), "hypothalamus") &&
           all(c("tissue: hypothalamus", "Sex: male",
                 "time: 5 weeks after tamoxifen treatment", genotype,
                 "treatment: Tamoxifen") %in% chars) &&
           identical(tag(b, "!Sample_library_strategy"), "RNA-Seq"),
         paste("GEO metadata changed for", samples$sample[i]))
  rel <- grep("^BioSample: ", tag(b, "!Sample_relation"), value = TRUE)
  assert(length(rel) == 1L, paste("expected one BioSample for", samples$sample[i]))
  biosample[i] <- sub("^.*/", "", rel)
}
assert(!anyDuplicated(biosample), "selected animals share a BioSample")
samples$biosample <- biosample

d <- read.delim(gzfile(SRC), header = TRUE, row.names = 1L,
                check.names = FALSE, stringsAsFactors = FALSE)
expected_source_order <- c("wt15", "wt11", "wt7", "wt6", "wt5", "wt4", "wt1",
                           "cko14", "cko13", "cko12", "cko9", "cko8")
assert(nrow(d) == 32494L && ncol(d) == 12L && identical(names(d), expected_source_order),
       "GSE243287 normalized CPM matrix structure changed")
symbols <- rownames(d)
assert(!anyNA(symbols) && all(nzchar(symbols)) && !anyDuplicated(symbols),
       "GSE243287 gene symbols are blank or duplicated")
M0 <- as.matrix(d[, samples$animal, drop = FALSE]); storage.mode(M0) <- "double"
colnames(M0) <- samples$sample
assert(!anyNA(M0) && all(is.finite(M0)) && all(M0 >= 0) && any(M0 != round(M0)),
       "GSE243287 source no longer has a finite fractional normalized-CPM signature")
expected_totals <- c(999391.7, 998703.3, 1005528.6, 980226.3, 1002748.2, 991805.9,
                     996335.2, 987853.1, 1003643.1, 1013343.3, 1007374.6, 1013593.1)
expected_detected <- c(28675L, 24549L, 25054L, 25046L, 25178L, 25468L,
                       25297L, 24978L, 24326L, 24600L, 24870L, 23469L)
assert(max(abs(colSums(M0) - expected_totals)) < 0.11 &&
         identical(as.integer(colSums(M0 > 0)), expected_detected),
       "GSE243287 pinned normalized totals or detected-gene counts changed")
assert(min(colSums(M0 > 0)) >= 5000 && min(colSums(M0)) >= 5e5,
       "GSE243287 hard normalized-matrix QC failed")
L <- log2(M0 + 1)
assert(max(abs((2^L - 1) - M0)) < 1e-8, "GSE243287 log2(CPM+1) reconstruction failed")

out <- data.frame(symbol = symbols, L, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE243287_Smc3_cKO_vs_WT_log2cpm.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)

ss <- data.frame(sample = samples$sample, group = samples$group,
                 condition = ifelse(samples$group == "case", "Smc3_neuronal_cKO", "Cre_negative_WT"),
                 geo_accession = samples$sample, biosample = samples$biosample,
                 source_column = samples$animal, tissue = "whole hypothalamus", sex = "male",
                 time_after_tamoxifen = "5 weeks", stringsAsFactors = FALSE)
write.table(ss, file.path(DS, "metadata", "GSE243287_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

qc <- data.frame(sample = samples$sample, group = samples$group, source_column = samples$animal,
                 source_gene_rows = nrow(M0), output_gene_rows = nrow(L),
                 source_nonfinite_values = colSums(!is.finite(M0)), source_negative_values = colSums(M0 < 0),
                 source_fractional_values = colSums(M0 != round(M0)), source_cpm_sum = colSums(M0),
                 output_cpm_sum = colSums(2^L - 1), conservation_delta = colSums(2^L - 1) - colSums(M0),
                 detected_genes = colSums(M0 > 0), transform_max_abs_delta = apply(abs((2^L - 1) - M0), 2L, max),
                 hard_qc_pass = TRUE, stringsAsFactors = FALSE)
assert(all(abs(qc$conservation_delta) < 1e-7) && all(qc$transform_max_abs_delta < 1e-8),
       "GSE243287 normalized CPM values were not conserved")
write.table(qc, file.path(DS, "processed", "GSE243287_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
paths <- c(SRC, SOFT)
expected_sha <- c("17b39b6ec721718f1af53e05914f0809d791d9c0597c888d13aaf57b6f360648",
                  "9b88577b59b92b5062acb8fca90fdc48daa61bd11f2a424560d47197d093c569")
observed_sha <- vapply(paths, sha256_file, character(1))
assert(identical(unname(observed_sha), expected_sha), "GSE243287 source checksum changed")
manifest <- data.frame(
  file = basename(paths), bytes = as.numeric(file.info(paths)$size), sha256 = observed_sha,
  source = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE243nnn/GSE243287/suppl/GSE243287_normalized_CPM.General.txt.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE243nnn/GSE243287/soft/GSE243287_family.soft.gz"
  ), fetched = "2026-08-31", stringsAsFactors = FALSE
)
write.table(manifest, file.path(DS, "metadata", "GSE243287_source_files.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE243287] wrote %d symbols x 12 animals; WT=7 cKO=5; CPM never rounded; hard QC passed\n", nrow(L)))
