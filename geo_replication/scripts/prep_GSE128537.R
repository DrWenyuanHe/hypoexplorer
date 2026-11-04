#!/usr/bin/env Rscript

# Select exactly one GEO-labeled hypothalamus RNA-seq library from each of the
# eight rhesus macaque donors in GSE128537. Adjacent medulla and all other brain
# regions are excluded; age is balanced for sex and the proposed model adjusts
# for sex.

script_arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
if (length(script_arg) != 1L) stop("cannot resolve this script's path")
script_dir <- dirname(normalizePath(sub("^--file=", "", script_arg)))
root <- normalizePath(file.path(script_dir, ".."))
dataset_dir <- file.path(root, "datasets", "GSE128537_mmul_hypo_aging")
source_path <- file.path(dataset_dir, "raw", "GSE128537_Rhesus_RNA_gene_count.txt.gz")
soft_path <- file.path(dataset_dir, "metadata", "GSE128537_family.soft.gz")

assert <- function(ok, message) if (!isTRUE(ok)) stop(message, call. = FALSE)
assert(file.exists(source_path) && file.info(source_path)$size == 11471053,
       "GSE128537 gene-count matrix is missing or its byte size changed")
assert(file.exists(soft_path) && file.info(soft_path)$size == 32032,
       "GSE128537 family SOFT is missing or its byte size changed")

samples <- data.frame(
  sample = c("4_36", "7_36", "8_36", "10_36",
             "2_36", "3_36", "6_36", "11_36"),
  group = c(rep("control", 4L), rep("case", 4L)),
  donor = c("Rhesus 4", "Rhesus 7", "Rhesus 8", "Rhesus 10",
            "Rhesus 2", "Rhesus 3", "Rhesus 6", "Rhesus 11"),
  gsm = c("GSM3679314", "GSM3679418", "GSM3679470", "GSM3679522",
          "GSM3679210", "GSM3679262", "GSM3679366", "GSM3679574"),
  sex = c("female", "male", "male", "female",
          "male", "male", "female", "female"),
  age_years = c(3.2, 4.0, 3.8, 5.0, 10.0, 10.0, 10.0, 9.8),
  age_class = c(rep("young", 4L), rep("middle_aged", 4L)),
  stringsAsFactors = FALSE
)
assert(!anyDuplicated(samples$donor) && !anyDuplicated(samples$gsm),
       "retained libraries are not one-to-one with independent donors")
assert(identical(as.integer(table(samples$group)[c("control", "case")]), c(4L, 4L)),
       "age contrast is no longer four versus four donors")
assert(all(table(samples$group, samples$sex) == 2L),
       "sex is no longer balanced 2F/2M within each age class")

soft <- readLines(gzfile(soft_path), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft)
ends <- c(starts[-1L] - 1L, length(soft))
assert(length(starts) == 449L, "family SOFT sample inventory changed")
for (i in seq_len(nrow(samples))) {
  j <- which(soft[starts] == paste0("^SAMPLE = ", samples$gsm[i]))
  assert(length(j) == 1L, paste("missing SOFT block for", samples$gsm[i]))
  block <- soft[starts[j]:ends[j]]
  age_text <- if (samples$age_years[i] == 4) "4 years" else
    if (samples$age_years[i] == 5) "5 years" else paste0(samples$age_years[i], " years")
  required <- c(
    paste0("!Sample_title = ", samples$sample[i], " RNA-seq"),
    "!Sample_source_name_ch1 = hypothalamus",
    paste0("!Sample_characteristics_ch1 = macaque id: ", samples$donor[i]),
    "!Sample_characteristics_ch1 = tissue: brain",
    paste0("!Sample_characteristics_ch1 = gender: ", samples$sex[i]),
    paste0("!Sample_characteristics_ch1 = age: ", age_text),
    "!Sample_description = Rhesus_RNA_gene_count.txt",
    "!Sample_library_strategy = RNA-Seq"
  )
  assert(all(required %in% block), paste("SOFT metadata changed for", samples$gsm[i]))
}

d <- read.delim(gzfile(source_path), check.names = FALSE, stringsAsFactors = FALSE)
assert(nrow(d) == 30807L && ncol(d) == 409L,
       "unexpected dimensions in GSE128537 source count matrix")
assert(all(c("gene", samples$sample) %in% colnames(d)),
       "one or more retained hypothalamus columns are absent")
ids <- as.character(d[["gene"]])
assert(!anyDuplicated(ids) && all(grepl("^ENSMMUG[0-9]+$", ids)),
       "macaque Ensembl gene IDs are not unique or well formed")

M <- as.matrix(d[, samples$sample, drop = FALSE])
storage.mode(M) <- "double"
assert(!anyNA(M) && all(is.finite(M)) && all(M >= 0) && all(M == round(M)),
       "retained source values are not nonnegative integer counts")

expected_libraries <- c(11701516, 12359990, 12208363, 9057534,
                        9113745, 9757855, 9423434, 11199221)
expected_detected <- c(18908L, 19350L, 19230L, 18996L,
                       19012L, 18697L, 18816L, 19205L)
assert(identical(as.numeric(colSums(M)), expected_libraries) &&
         identical(as.integer(colSums(M > 0)), expected_detected),
       "pinned library sizes or gene detection counts changed")

out <- data.frame(gene = ids, M, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(dataset_dir, "raw", "GSE128537_hypothalamus_age_counts.tsv.gz")
con <- gzfile(out_path, "wt")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)

write.table(samples,
            file.path(dataset_dir, "metadata", "GSE128537_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)

qc <- data.frame(
  sample = samples$sample,
  group = samples$group,
  donor = samples$donor,
  gsm = samples$gsm,
  sex = samples$sex,
  age_years = samples$age_years,
  source_gene_rows = nrow(M),
  source_library_size = colSums(M),
  detected_genes = colSums(M > 0),
  merged_gene_rows = nrow(M),
  merged_library_size = colSums(M),
  count_conservation_delta = colSums(M) - expected_libraries,
  integer_counts = TRUE,
  nonnegative_counts = TRUE,
  metadata_match = TRUE,
  one_library_per_donor = TRUE,
  analysis_keep = TRUE,
  stringsAsFactors = FALSE
)
assert(all(qc$count_conservation_delta == 0), "merged counts are not exactly conserved")
write.table(qc,
            file.path(dataset_dir, "processed", "GSE128537_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)

cat(sprintf(
  "GSE128537 prepared: %d genes x %d independent macaques; young=%d middle-aged=%d; libraries %.2fM-%.2fM; exact conservation\n",
  nrow(M), ncol(M), sum(samples$group == "control"), sum(samples$group == "case"),
  min(colSums(M)) / 1e6, max(colSums(M)) / 1e6
))
