#!/usr/bin/env Rscript
# Prepare the adult zebrafish baseline hypothalamus FLX-lineage versus control
# contrast (6 independent pooled biological replicates per arm) from the
# official STAR integer gene-count matrix. Historical GRCz11v92 identifiers
# are mapped only with the exact Ensembl release-92 GTF named in GEO.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE141144_drer_hypothalamus_flx")
COUNTS <- file.path(DS, "raw", "GSE141144_sampleCounts.txt.gz")
SOFT <- file.path(DS, "metadata", "GSE141144_family.soft.gz")
GTF <- file.path(DS, "metadata", "Danio_rerio.GRCz11.92.gtf.gz")
if (!requireNamespace("data.table", quietly = TRUE)) stop("the data.table R package is required")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
pins <- data.frame(
  path = c(COUNTS, SOFT, GTF), bytes = c(2652944, 6445, 17905499),
  sha256 = c(
    "7925fc19cf082f3702878584fd2bac1084c03491799b396e96b185438db2d43e",
    "faa53eba0c4bceaef148b87f14d0e70b642ab4fd4a9f092f7f339348271c3c59",
    "1aac17de0fb3c41277fafdd72cab687cdef4c0c3713fb3778b745a55185c7e36"
  ),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE141nnn/GSE141144/suppl/GSE141144_sampleCounts.txt.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE141nnn/GSE141144/soft/GSE141144_family.soft.gz",
    "https://ftp.ensembl.org/pub/release-92/gtf/danio_rerio/Danio_rerio.GRCz11.92.gtf.gz"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(pins$path))) stop("required official source is missing")
observed_bytes <- as.numeric(file.info(pins$path)$size); observed_sha <- unname(vapply(pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, pins$bytes) || !identical(observed_sha, pins$sha256)) stop("source bytes/SHA-256 differ from reviewed inputs")

soft <- readLines(gzfile(SOFT), warn = FALSE)
if (!any(grepl("effects of early life exposure to fluoxetine", soft, fixed = TRUE)) ||
    !any(grepl("Genome_build: GRCz11v92", soft, fixed = TRUE)) ||
    !any(grepl("raw count values for each sample", soft, fixed = TRUE))) stop("GEO experiment/build/count semantics changed")
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft))
tag <- function(b, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), b, value = TRUE))
meta <- lapply(seq_along(starts), function(i) {
  b <- soft[starts[i]:ends[i]]; ch <- tag(b, "!Sample_characteristics_ch1"); rel <- tag(b, "!Sample_relation")
  data.frame(
    gsm = tag(b, "!Sample_geo_accession"), title = tag(b, "!Sample_title"),
    genotype = sub("^genotype/variation: ", "", ch[grepl("^genotype/variation: ", ch)]),
    stress = sub("^stress status: ", "", ch[grepl("^stress status: ", ch)]),
    drug = sub("^drug status: ", "", ch[grepl("^drug status: ", ch)]),
    tissue = sub("^tissue: ", "", ch[grepl("^tissue: ", ch)]),
    biosample = sub(".*biosample/", "", rel[grepl("biosample/", rel, fixed = TRUE)]),
    srx = sub(".*term=", "", rel[grepl("sra[?]term=", rel)]), strategy = tag(b, "!Sample_library_strategy"),
    stringsAsFactors = FALSE
  )
})
meta <- do.call(rbind, meta)
meta <- meta[grepl("^Adt_(Ctl|FLX)_Bsal_Hyp_[1-6]$", meta$title), , drop = FALSE]
meta$source_column <- sub("^Adt_", "", meta$title)
meta$group <- ifelse(meta$drug == "Ctl", "control", "case")
if (nrow(meta) != 12L || !identical(as.integer(table(meta$group)[c("control", "case")]), c(6L, 6L)) ||
    any(meta$stress != "Bsal") || any(tolower(meta$tissue) != "hypothalamus") || any(meta$strategy != "RNA-Seq") ||
    anyDuplicated(meta$gsm) || anyDuplicated(meta$biosample) || anyDuplicated(meta$source_column)) stop("reviewed 6+6 independent baseline hypothalamus roster changed")

d <- data.table::fread(COUNTS, data.table = FALSE, check.names = FALSE, showProgress = FALSE)
if (!identical(dim(d), c(31902L, 73L)) || !identical(names(d)[1L], "V1")) stop("official count-table dimensions/schema changed")
ids <- as.character(d[[1L]])
if (anyNA(ids) || any(!nzchar(ids)) || anyDuplicated(ids) ||
    sum(grepl("^ENSDARG[0-9]+$", ids)) != 31901L || !identical(ids[!grepl("^ENSDARG[0-9]+$", ids)], "d4EGFP")) stop("reviewed zebrafish identifier roster changed")
if (!all(meta$source_column %in% names(d))) stop("reviewed source columns are absent")
M_source <- as.matrix(d[, meta$source_column, drop = FALSE]); storage.mode(M_source) <- "double"; colnames(M_source) <- meta$gsm
if (any(!is.finite(M_source)) || any(M_source < 0) || any(M_source != round(M_source))) stop("STAR raw integer-count semantics no longer hold")

gtf <- readLines(gzfile(GTF), warn = FALSE)
gtf <- gtf[grepl("gene_id \\\"", gtf) & grepl("gene_name \\\"", gtf)]
gtf_id <- sub(".*gene_id \\\"([^\\\"]+)\\\".*", "\\1", gtf)
gtf_symbol <- sub(".*gene_name \\\"([^\\\"]+)\\\".*", "\\1", gtf)
pairs <- unique(data.frame(ensembl = gtf_id, symbol = gtf_symbol, stringsAsFactors = FALSE))
pairs <- pairs[grepl("^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._-]*$", pairs$symbol, perl = TRUE), , drop = FALSE]
id_cardinality <- vapply(split(pairs$symbol, pairs$ensembl), function(v) length(unique(v)), integer(1))
pairs <- pairs[pairs$ensembl %in% names(id_cardinality)[id_cardinality == 1L], , drop = FALSE]
symbol_cardinality <- vapply(split(pairs$ensembl, pairs$symbol), function(v) length(unique(v)), integer(1))
pairs <- pairs[symbol_cardinality[pairs$symbol] == 1L & pairs$ensembl %in% ids, , drop = FALSE]
if (nrow(pairs) != 23468L || anyDuplicated(pairs$ensembl) || anyDuplicated(pairs$symbol)) stop("reviewed release-92 identifier-map signature changed")
mapped <- setNames(pairs$symbol, pairs$ensembl)
labels <- paste0("__UNMAPPED_DRER_", ids); hit <- ids %in% names(mapped); labels[hit] <- unname(mapped[ids[hit]])
if (anyDuplicated(labels)) stop("output labels are not unique")
rownames(M_source) <- labels

out <- data.frame(symbol = labels, M_source, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE141144_adult_hypothalamus_FLX_vs_control_counts.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$symbol, labels) || !identical(names(roundtrip)[-1L], meta$gsm) || any(as.matrix(roundtrip[-1L]) != M_source)) stop("written matrix failed exact round-trip validation")

ss <- data.frame(
  sample = meta$gsm, group = meta$group, geo_accession = meta$gsm, biosample = meta$biosample, sra = meta$srx,
  source_column = meta$source_column, drug_status = meta$drug, stress_status = meta$stress,
  tissue = meta$tissue, genotype = meta$genotype, biological_unit = "independent pool of 5 adult hypothalami",
  stringsAsFactors = FALSE
)
write.table(ss, file.path(DS, "metadata", "GSE141144_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
map_audit <- data.frame(source_gene_id = ids, output_label = labels,
                        mapping_status = ifelse(hit, "Ensembl_GRCz11_release92_unique_symbol", "reserved_unnamed_or_ambiguous"), stringsAsFactors = FALSE)
write.table(map_audit, file.path(DS, "metadata", "GSE141144_identifier_mapping.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
qc <- data.frame(
  sample = meta$gsm, group = meta$group, source_column = meta$source_column,
  source_gene_rows = nrow(M_source), mapped_official_symbols = sum(hit), reserved_source_ids = sum(!hit),
  source_library_size = colSums(M_source), detected_features = colSums(M_source > 0),
  nonfinite_values = colSums(!is.finite(M_source)), negative_values = colSums(M_source < 0), fractional_values = colSums(M_source != round(M_source)),
  accepted_input_class = "STAR raw integer gene counts", shared_route = "input_kind=counts -> canonical edgeR-QL", written_exact = TRUE,
  stringsAsFactors = FALSE
)
if (any(qc$source_library_size < 1e6) || any(qc$detected_features < 10000L)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE141144_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
manifest <- data.frame(file = basename(pins$path), bytes = observed_bytes, sha256 = observed_sha, source = pins$url, fetched = "2026-09-01", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE141144_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE141144] wrote %d count rows x %d samples; control=6, FLX=6; mapped=%d; reserved=%d\n",
            nrow(M_source), ncol(M_source), sum(hit), sum(!hit)))

