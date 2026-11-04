#!/usr/bin/env Rscript
# Prepare the GSE111339 Brahman hypothalamus post- versus pre-puberty
# contrast (6 independent heifers per arm) from official HTSeq integer counts.
# Historical Ensembl IDs are mapped only with the exact UMD3.1 release-74
# annotation named in GEO; ambiguous/unnamed IDs retain reserved labels.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE111339_btau_hypothalamus")
TAR <- file.path(DS, "raw", "GSE111339_RAW.tar")
HTSEQ_DIR <- file.path(DS, "raw", "htseq")
SOFT <- file.path(DS, "metadata", "GSE111339_family.soft.gz")
GTF <- file.path(DS, "metadata", "Bos_taurus.UMD3.1.74.gtf.gz")
if (!requireNamespace("data.table", quietly = TRUE)) stop("the data.table R package is required")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
pins <- data.frame(
  path = c(TAR, SOFT, GTF), bytes = c(7526400, 5913, 6767056),
  sha256 = c(
    "96b6f1193b4933227587679487f3cebdd3e232aaae0dbc0f63cd09b2bbc38069",
    "8944293799d37189325c2ce6f51c69159d1d92b70ad945dfb79ed02f7624a035",
    "e3cd177cb4ab6abe949410f97d42e998b127d00a63902ca964edcce6713d3bdc"
  ),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE111nnn/GSE111339/suppl/GSE111339_RAW.tar",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE111nnn/GSE111339/soft/GSE111339_family.soft.gz",
    "https://ftp.ensembl.org/pub/release-74/gtf/bos_taurus/Bos_taurus.UMD3.1.74.gtf.gz"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(pins$path))) stop("required official source is missing")
observed_bytes <- as.numeric(file.info(pins$path)$size); observed_sha <- unname(vapply(pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, pins$bytes) || !identical(observed_sha, pins$sha256)) stop("source bytes/SHA-256 differ from reviewed inputs")

soft <- readLines(gzfile(SOFT), warn = FALSE)
if (!any(grepl("Transcriptome related to pubertal development in Brahman heifers", soft, fixed = TRUE)) ||
    !any(grepl("Genome_build: UMD3.1.74", soft, fixed = TRUE))) stop("GEO experiment/build metadata changed")
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft))
tag <- function(b, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), b, value = TRUE))
meta <- lapply(seq_along(starts), function(i) {
  b <- soft[starts[i]:ends[i]]; ch <- tag(b, "!Sample_characteristics_ch1"); rel <- tag(b, "!Sample_relation")
  data.frame(
    gsm = tag(b, "!Sample_geo_accession"), title = tag(b, "!Sample_title"),
    organism = tag(b, "!Sample_organism_ch1"),
    animal_id = sub("^animal id: ", "", ch[grepl("^animal id: ", ch)]),
    puberty = sub("^puberty status: ", "", ch[grepl("^puberty status: ", ch)]),
    tissue = sub("^tissue: ", "", ch[grepl("^tissue: ", ch)]),
    biosample = sub(".*biosample/", "", rel[grepl("biosample/", rel, fixed = TRUE)]),
    srx = sub(".*term=", "", rel[grepl("sra[?]term=", rel)]), strategy = tag(b, "!Sample_library_strategy"),
    stringsAsFactors = FALSE
  )
})
meta <- do.call(rbind, meta); meta <- meta[meta$tissue == "Hypothalamus", , drop = FALSE]
if (nrow(meta) != 12L || !identical(as.integer(table(meta$puberty)[c("pre-puberty", "post-puberty")]), c(6L, 6L)) ||
    any(meta$organism != "Bos indicus") || any(meta$strategy != "RNA-Seq") ||
    anyDuplicated(meta$animal_id) || anyDuplicated(meta$biosample)) stop("reviewed 6+6 independent hypothalamus roster changed")

# Fail closed at the unchanged shared-pipeline species/pathway gate. GEO calls
# these animals Bos indicus, while the current msigdbr authority used by
# run_dataset.R has Bos taurus but no Bos indicus collection. UMD3.1.74 is the
# deposited alignment/annotation reference; it does not authorize relabeling
# the biological samples or silently selecting Bos taurus pathways.
if (!requireNamespace("msigdbr", quietly = TRUE)) stop("the msigdbr R package is required for the existing-pipeline species gate")
supported_species <- msigdbr::msigdbr_species()$species_name
if (!"Bos indicus" %in% supported_species) {
  manifest <- data.frame(file = basename(pins$path), bytes = observed_bytes, sha256 = observed_sha, source = pins$url, fetched = "2026-09-01", stringsAsFactors = FALSE)
  write.table(manifest, file.path(DS, "metadata", "GSE111339_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
  stop(paste(
    "GSE111339 excluded by the existing-pipeline species/pathway gate:",
    "GEO organism is Bos indicus, which is absent from msigdbr_species();",
    "relabeling it Bos taurus merely because UMD3.1.74 was the alignment reference",
    "would introduce an unreviewed cross-species pathway projection."
  ))
}

all_members <- list.files(HTSEQ_DIR, "[.]txt[.]gz$", full.names = TRUE)
if (length(all_members) != 72L) stop("GEO TAR extraction is incomplete; expected 72 HTSeq members")
sample_files <- vapply(meta$gsm, function(gsm) {
  z <- all_members[startsWith(basename(all_members), paste0(gsm, "_"))]
  if (length(z) != 1L) stop("expected exactly one extracted count member for ", gsm)
  z
}, character(1))
tabs <- lapply(sample_files, function(f) data.table::fread(f, header = FALSE, data.table = FALSE, showProgress = FALSE))
ids_all <- as.character(tabs[[1L]][[1L]])
if (length(ids_all) != 24621L || !all(vapply(tabs, function(z) identical(as.character(z[[1L]]), ids_all), logical(1)))) stop("HTSeq identifier rosters differ across samples")
special <- startsWith(ids_all, "__"); ids <- ids_all[!special]
if (sum(special) != 5L || length(ids) != 24616L || anyDuplicated(ids) || any(!grepl("^ENSBTAG[0-9]+$", ids))) stop("reviewed HTSeq/Ensembl row signature changed")
M_source <- do.call(cbind, lapply(tabs, function(z) z[[2L]][!special])); storage.mode(M_source) <- "double"
colnames(M_source) <- meta$gsm
if (any(!is.finite(M_source)) || any(M_source < 0) || any(M_source != round(M_source))) stop("HTSeq raw integer-count semantics no longer hold")
special_counts <- do.call(cbind, lapply(tabs, function(z) z[[2L]][special])); rownames(special_counts) <- ids_all[special]; colnames(special_counts) <- meta$gsm

gtf <- readLines(gzfile(GTF), warn = FALSE)
gtf <- gtf[grepl("gene_id \\\"", gtf) & grepl("gene_name \\\"", gtf)]
gtf_id <- sub(".*gene_id \\\"([^\\\"]+)\\\".*", "\\1", gtf)
gtf_symbol <- sub(".*gene_name \\\"([^\\\"]+)\\\".*", "\\1", gtf)
pairs <- unique(data.frame(ensembl = gtf_id, symbol = gtf_symbol, stringsAsFactors = FALSE))
pairs <- pairs[grepl("^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._-]*$", pairs$symbol, perl = TRUE), , drop = FALSE]
id_cardinality <- vapply(split(pairs$symbol, pairs$ensembl), function(v) length(unique(v)), integer(1))
pairs <- pairs[pairs$ensembl %in% names(id_cardinality)[id_cardinality == 1L], , drop = FALSE]
symbol_cardinality <- vapply(split(pairs$ensembl, pairs$symbol), function(v) length(unique(v)), integer(1))
pairs <- pairs[symbol_cardinality[pairs$symbol] == 1L, , drop = FALSE]
pairs <- pairs[pairs$ensembl %in% ids, , drop = FALSE]
if (nrow(pairs) != 16982L || anyDuplicated(pairs$ensembl) || anyDuplicated(pairs$symbol)) stop("reviewed release-74 identifier-map signature changed")
mapped <- setNames(pairs$symbol, pairs$ensembl)
labels <- paste0("__UNMAPPED_BTAU_", ids); hit <- ids %in% names(mapped); labels[hit] <- unname(mapped[ids[hit]])
if (anyDuplicated(labels)) stop("output labels are not unique")
rownames(M_source) <- labels

out <- data.frame(symbol = labels, M_source, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE111339_hypothalamus_post_vs_pre_counts.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$symbol, labels) || any(as.matrix(roundtrip[-1L]) != M_source)) stop("written matrix failed exact round-trip validation")

ss <- data.frame(
  sample = meta$gsm, group = ifelse(meta$puberty == "pre-puberty", "control", "case"),
  geo_accession = meta$gsm, biosample = meta$biosample, sra = meta$srx, animal_id = meta$animal_id,
  puberty_status = meta$puberty, tissue = meta$tissue, title = meta$title, stringsAsFactors = FALSE
)
write.table(ss, file.path(DS, "metadata", "GSE111339_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
map_audit <- data.frame(source_ensembl_id = ids, output_label = labels,
                        mapping_status = ifelse(hit, "Ensembl_UMD3.1_release74_unique_symbol", "reserved_unnamed_or_ambiguous"), stringsAsFactors = FALSE)
write.table(map_audit, file.path(DS, "metadata", "GSE111339_identifier_mapping.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
qc <- data.frame(
  sample = meta$gsm, group = ss$group, source_file = basename(sample_files),
  source_gene_rows = nrow(M_source), mapped_official_symbols = sum(hit), reserved_source_ids = sum(!hit),
  assigned_gene_counts = colSums(M_source), detected_features = colSums(M_source > 0),
  htseq_no_feature = special_counts["__no_feature", ], htseq_ambiguous = special_counts["__ambiguous", ],
  htseq_too_low_aQual = special_counts["__too_low_aQual", ], htseq_not_aligned = special_counts["__not_aligned", ],
  htseq_alignment_not_unique = special_counts["__alignment_not_unique", ],
  nonfinite_values = colSums(!is.finite(M_source)), negative_values = colSums(M_source < 0), fractional_values = colSums(M_source != round(M_source)),
  accepted_input_class = "HTSeq raw integer gene counts", shared_route = "input_kind=counts -> canonical edgeR-QL", written_exact = TRUE,
  stringsAsFactors = FALSE
)
if (any(qc$assigned_gene_counts < 1e6) || any(qc$detected_features < 10000L)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE111339_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
manifest <- data.frame(file = basename(pins$path), bytes = observed_bytes, sha256 = observed_sha, source = pins$url, fetched = "2026-09-01", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE111339_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE111339] wrote %d count rows x %d samples; pre=6, post=6; mapped=%d; reserved=%d\n",
            nrow(M_source), ncol(M_source), sum(hit), sum(!hit)))
