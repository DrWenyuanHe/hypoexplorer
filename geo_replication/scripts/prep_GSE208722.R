#!/usr/bin/env Rscript
# Prepare GSE208722's MKRN3-deficient versus wild-type contrast in human
# iPSC-derived hypothalamic neurons. GEO documents Salmon quantification
# imported through tximport/DESeq2; the deposited count estimates are retained
# exactly as written and are not rounded or renormalized before edgeR-QL.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE208722_hsap_hypothalamic_neurons_mkrn3")
TAR <- file.path(DS, "raw", "GSE208722_RAW.tar")
SOFT <- file.path(DS, "metadata", "GSE208722_family.soft.gz")
SRC_DIR <- file.path(DS, "raw", "source_files")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
pins <- data.frame(
  path = c(TAR, SOFT), bytes = c(1536000, 2357),
  sha256 = c("02430a28784636b04f2a5d07ba4192fbb59fc66fb099568577003c63e5c4953e",
             "662c6f8164a9e7e1138f0982f0c0269c56d8aad2e4799c1b7fc6413020a53ae7"),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE208nnn/GSE208722/suppl/GSE208722_RAW.tar",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE208nnn/GSE208722/soft/GSE208722_family.soft.gz"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(pins$path))) stop("required official GEO Salmon-count archive or family SOFT is missing")
observed_bytes <- as.numeric(file.info(pins$path)$size)
observed_sha <- unname(vapply(pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, pins$bytes) || !identical(observed_sha, pins$sha256)) stop("source bytes/SHA-256 differ from reviewed inputs")

members <- utils::untar(TAR, list = TRUE)
if (length(members) != 6L || any(!grepl("^GSM[0-9]+_(WT|KO)-[BCD]-ready[.]counts[.]txt[.]gz$", members))) stop("official count archive member list changed")
dir.create(SRC_DIR, recursive = TRUE, showWarnings = FALSE)
if (any(!file.exists(file.path(SRC_DIR, members)))) utils::untar(TAR, files = members, exdir = SRC_DIR)
if (any(!file.exists(file.path(SRC_DIR, members)))) stop("could not extract reviewed count files")

samples <- data.frame(
  gsm = paste0("GSM63655", 65:70),
  genotype = rep(c("MKRN3-WT", "MKRN3-KO"), each = 3L),
  code = rep(c("B", "C", "D"), 2L),
  differentiation = rep(c("I", "II", "III"), 2L),
  group = rep(c("control", "case"), each = 3L), stringsAsFactors = FALSE
)
samples$file <- paste0(samples$gsm, "_", ifelse(samples$group == "control", "WT", "KO"), "-", samples$code, "-ready.counts.txt.gz")
samples$sample <- paste0(ifelse(samples$group == "control", "WT", "KO"), "_", samples$code)
if (any(!samples$file %in% members) || any(table(samples$group) != 3L)) stop("reviewed WT/KO sample selection changed")

soft <- readLines(gzfile(SOFT), warn = FALSE)
design_text <- sub("^!Series_overall_design = ", "", grep("^!Series_overall_design = ", soft, value = TRUE))
processing <- sub("^!Sample_data_processing = ", "", grep("^!Sample_data_processing = ", soft, value = TRUE))
if (length(design_text) != 1L || !grepl("Three replicates issued from three different hypothalamic differentiations", design_text, fixed = TRUE) ||
    !any(grepl("Salmon v0.9.0", processing, fixed = TRUE)) ||
    !any(grepl("Counts were imported into R using tximport", processing, fixed = TRUE))) {
  stop("GEO no longer documents the reviewed independent WT/KO Salmon-count experiment")
}
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft)); names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
block <- function(gsm) { i <- match(gsm, names(starts)); if (is.na(i)) stop("GSM absent from SOFT: ", gsm); soft[starts[i]:ends[i]] }
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
samples$biosample <- samples$sra <- samples$title <- NA_character_
for (i in seq_len(nrow(samples))) {
  b <- block(samples$gsm[i]); rel <- tag(b, "!Sample_relation"); chars <- tag(b, "!Sample_characteristics_ch1")
  if (!paste0("genotype: ", samples$genotype[i]) %in% chars ||
      !"cell type: Hypothalamic neurons derived from hiPSCs" %in% chars ||
      !identical(tag(b, "!Sample_library_strategy"), "RNA-Seq")) stop(samples$gsm[i], ": SOFT metadata changed")
  samples$title[i] <- tag(b, "!Sample_title")
  samples$biosample[i] <- sub(".*biosample/", "", rel[grepl("BioSample:", rel, fixed = TRUE)])
  samples$sra[i] <- sub(".*term=", "", rel[grepl("SRA:", rel, fixed = TRUE)])
}
if (anyDuplicated(samples$biosample)) stop("selected differentiations are not independent BioSamples")

tables <- lapply(file.path(SRC_DIR, samples$file), function(f) read.delim(gzfile(f), header = FALSE, col.names = c("id", "count"), check.names = FALSE, stringsAsFactors = FALSE))
if (any(vapply(tables, nrow, integer(1)) != 57373L) || any(vapply(tables, ncol, integer(1)) != 2L)) stop("official count-file dimensions changed")
ids <- as.character(tables[[1L]]$id)
if (anyNA(ids) || any(!grepl("^ENSG[0-9]+([.][0-9]+)?$", ids)) || anyDuplicated(ids) ||
    !all(vapply(tables[-1L], function(x) identical(as.character(x$id), ids), logical(1)))) stop("human Ensembl feature order/identity changed")
M <- do.call(cbind, lapply(tables, function(x) as.numeric(x$count)))
colnames(M) <- samples$sample; rownames(M) <- ids
if (any(!is.finite(M)) || any(M < 0)) stop("Salmon/tximport count estimates must be finite and non-negative")

suppressPackageStartupMessages({library(edgeR); library(msigdbr)})
design <- model.matrix(~ factor(group, levels = c("control", "case")), data = samples)
y <- DGEList(counts = M); keep <- filterByExpr(y, design); y <- calcNormFactors(y[keep, , keep.lib.sizes = FALSE])
hs <- msigdbr(species = "Homo sapiens")
hs <- hs[!is.na(hs$ensembl_gene) & nzchar(hs$ensembl_gene) & !is.na(hs$gene_symbol) & nzchar(hs$gene_symbol), c("ensembl_gene", "gene_symbol")]
hs <- hs[!duplicated(hs$ensembl_gene), ]
mapped <- hs$gene_symbol[match(sub("[.].*", "", ids), hs$ensembl_gene)]
mapping_coverage <- mean(!is.na(mapped)); modeled_mapping_coverage <- mean(!is.na(mapped[keep]))
if (sum(keep) < 5000L || modeled_mapping_coverage < 0.70 || any(!is.finite(y$samples$norm.factors))) stop("count-level or human-symbol mapping QC failed")

out <- data.frame(Ensembl_gene_id = ids, M, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE208722_MKRN3_KO_vs_WT_salmon_counts.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$Ensembl_gene_id, ids) || !identical(names(roundtrip)[-1L], samples$sample) || any(as.matrix(roundtrip[-1L]) != M)) stop("written count-estimate matrix failed exact round-trip validation")

samples$geo_accession <- samples$gsm; samples$tissue_model <- "day-30 human iPSC-derived hypothalamic neurons"
samples$source_scale <- "Salmon estimates imported by tximport/DESeq2; deposited count values preserved"
write.table(samples[, c("sample", "group", "geo_accession", "biosample", "sra", "genotype", "code", "differentiation", "tissue_model", "source_scale", "file", "title")],
            file.path(DS, "metadata", "GSE208722_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
qc <- data.frame(
  sample = samples$sample, group = samples$group, source_rows = nrow(M), output_rows = nrow(M),
  nonfinite_values = colSums(!is.finite(M)), negative_values = colSums(M < 0), fractional_values = colSums(M != round(M)),
  library_size = colSums(M), detected_features = colSums(M > 0), filterByExpr_features = sum(keep), tmm_norm_factor = y$samples$norm.factors,
  mapped_human_symbols = sum(!is.na(mapped)), human_symbol_mapping_coverage = mapping_coverage,
  modeled_symbol_mapping_coverage = modeled_mapping_coverage,
  accepted_input_class = "Salmon estimates imported with tximport/DESeq2; deposited count values preserved",
  shared_route = "input_kind=counts -> canonical edgeR-QL", written_exact = TRUE, stringsAsFactors = FALSE
)
write.table(qc, file.path(DS, "processed", "GSE208722_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
manifest <- data.frame(file = basename(pins$path), bytes = observed_bytes, sha256 = observed_sha, source = pins$url, fetched = "2026-09-01", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE208722_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE208722] wrote %d human Ensembl genes x %d independent differentiations; WT=3, MKRN3-deficient=3; %d fractional cells preserved; modeled-feature mapping coverage %.1f%%; %d filterByExpr features\n",
            nrow(M), ncol(M), sum(M != round(M)), 100 * modeled_mapping_coverage, sum(keep)))
