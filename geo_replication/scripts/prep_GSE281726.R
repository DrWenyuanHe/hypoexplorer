#!/usr/bin/env Rscript
# Prepare the formula-only hypothalamus contrast from GSE281726: piglet formula
# enriched in alpha-lactalbumin versus the alpha-lactalbumin-reduced WPI formula.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE281726_sscr_hypothalamus")
SOFT <- file.path(DS, "metadata", "GSE281726_family.soft.gz")
GENE_INFO <- file.path(DS, "metadata", "Sus_scrofa.gene_info.gz")
MANIFEST <- file.path(DS, "metadata", "GSE281726_source_files.tsv")
if (!requireNamespace("data.table", quietly = TRUE)) stop("the data.table R package is required")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
if (!file.exists(MANIFEST) ||
    sha256_file(MANIFEST) != "a46c78da2fdffcb1b00108c5eaa2be6f97a298e7407d7b71592548b7095829e2") {
  stop("GSE281726 source manifest is missing or changed")
}
pins <- read.delim(MANIFEST, stringsAsFactors = FALSE, check.names = FALSE)
resolve_pin <- function(f) {
  p <- file.path(DS, c("raw", "metadata"), f); p <- p[file.exists(p)]
  if (length(p) != 1L) stop("pinned source missing or ambiguous: ", f)
  p
}
pin_paths <- vapply(pins$file, resolve_pin, character(1))
if (!identical(as.numeric(file.info(pin_paths)$size), as.numeric(pins$bytes)) ||
    !identical(unname(vapply(pin_paths, sha256_file, character(1))), pins$sha256)) {
  stop("GSE281726 source bytes/SHA-256 differ from the reviewed manifest")
}

soft <- readLines(gzfile(SOFT), warn = FALSE)
if (!any(grepl("Quantification of per-gene counts was obtained using HT-Seq count", soft, fixed = TRUE)) ||
    !any(grepl("^!Sample_library_strategy = RNA-Seq$", soft)) ||
    !any(grepl("^!Series_pubmed_id = 41102179$", soft)) ||
    !any(grepl("randomly assigned", soft, fixed = TRUE))) {
  stop("GEO no longer documents the reviewed randomized HTSeq-count experiment")
}
starts <- grep("^\\^SAMPLE = ", soft)
ends <- c(starts[-1L] - 1L, length(soft))
tag <- function(b, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), b, value = TRUE))
char_value <- function(b, key) {
  x <- tag(b, "!Sample_characteristics_ch1")
  hit <- grep(paste0("^", key, ":"), x, ignore.case = TRUE, value = TRUE)
  if (length(hit) != 1L) stop("missing/duplicate characteristic ", key)
  trimws(sub("^[^:]+:", "", hit))
}
sample_meta <- do.call(rbind, lapply(seq_along(starts), function(i) {
  b <- soft[starts[i]:ends[i]]; rel <- tag(b, "!Sample_relation")
  data.frame(
    geo_accession = sub("^\\^SAMPLE = ", "", b[1L]),
    title = tag(b, "!Sample_title"),
    tissue = char_value(b, "tissue"),
    sex = char_value(b, "Sex"),
    diet = char_value(b, "diet"),
    biosample = sub(".*(SAMN[0-9]+).*", "\\1", grep("biosample", rel, ignore.case = TRUE, value = TRUE)),
    sra = sub(".*term=", "", grep("sra\\?term=", rel, ignore.case = TRUE, value = TRUE)),
    source_file = basename(tag(b, "!Sample_supplementary_file_1")),
    stringsAsFactors = FALSE
  )
}))
samples <- sample_meta[sample_meta$tissue == "Hypothalamus" &
                         grepl("-(WPI|ALAC)-Hypo$", sample_meta$title), , drop = FALSE]
samples$group <- ifelse(grepl("-WPI-", samples$title), "control",
                        ifelse(grepl("-ALAC-", samples$title), "case", NA))
samples$formula <- ifelse(samples$group == "control", "WPI", "ALAC")
samples$pig_id <- sub("^(PIG[0-9]+)-.*$", "\\1", samples$title)
samples$sample <- paste(samples$formula, samples$pig_id, sep = "_")
if (nrow(samples) != 23L || sum(samples$group == "control") != 12L ||
    sum(samples$group == "case") != 11L ||
    sum(samples$group == "control" & samples$sex == "F") != 6L ||
    sum(samples$group == "control" & samples$sex == "M") != 6L ||
    sum(samples$group == "case" & samples$sex == "F") != 5L ||
    sum(samples$group == "case" & samples$sex == "M") != 6L ||
    anyNA(samples$group) || anyDuplicated(samples$pig_id) ||
    anyDuplicated(samples$geo_accession) || anyDuplicated(samples$biosample) ||
    anyDuplicated(samples$sra) || anyDuplicated(samples$source_file) ||
    length(setdiff(samples$source_file, pins$file))) {
  stop("reviewed 12-WPI/11-ALAC formula-only hypothalamus design changed")
}

source_tables <- lapply(file.path(DS, "raw", samples$source_file), function(f)
  data.table::fread(f, header = FALSE, data.table = FALSE, showProgress = FALSE))
if (any(vapply(source_tables, nrow, integer(1)) != 35675L) ||
    any(vapply(source_tables, ncol, integer(1)) != 2L)) {
  stop("per-sample HTSeq count-file dimensions changed")
}
all_ids <- as.character(source_tables[[1L]][[1L]])
technical_labels <- c("__no_feature", "__ambiguous", "__too_low_aQual",
                      "__not_aligned", "__alignment_not_unique")
is_gene <- grepl("^ENSSSCG[0-9]+([.][0-9]+)?$", all_ids)
if (anyNA(all_ids) || any(!nzchar(all_ids)) || anyDuplicated(all_ids) ||
    !identical(all_ids[!is_gene], technical_labels) ||
    !all(vapply(source_tables, function(x) identical(as.character(x[[1L]]), all_ids), logical(1)))) {
  stop("pig Ensembl feature namespaces/order differ across selected files")
}
M_all <- do.call(cbind, lapply(source_tables, function(x) as.numeric(x[[2L]])))
source_ids <- all_ids[is_gene]
M_source <- M_all[is_gene, , drop = FALSE]
technical_counts <- M_all[!is_gene, , drop = FALSE]
colnames(M_source) <- samples$sample; rownames(M_source) <- source_ids
if (any(!is.finite(M_source)) || any(M_source < 0) || any(M_source != round(M_source))) {
  stop("reviewed raw integer-count semantics no longer hold")
}

gene_info_all <- data.table::fread(GENE_INFO, data.table = FALSE, check.names = FALSE, showProgress = FALSE)
taxa <- table(gene_info_all[["#tax_id"]])
if (!identical(dim(gene_info_all), c(54111L, 16L)) ||
    !identical(as.integer(taxa[c("9823", "9825", "309913", "310261")]), c(54048L, 13L, 37L, 13L))) {
  stop("official Sus scrofa gene_info signature changed")
}
gene_info <- gene_info_all[gene_info_all[["#tax_id"]] == 9823L, , drop = FALSE]
xref_tokens <- strsplit(gene_info$dbXrefs, "|", fixed = TRUE)
ensembl_tokens <- lapply(xref_tokens, function(v)
  sub("^Ensembl:", "", v[grepl("^Ensembl:ENSSSCG[0-9]+$", v)]))
pairs <- data.frame(
  ensembl = unlist(ensembl_tokens, use.names = FALSE),
  GeneID = rep(gene_info$GeneID, lengths(ensembl_tokens)),
  symbol = rep(gene_info$Symbol, lengths(ensembl_tokens)),
  stringsAsFactors = FALSE
)
pairs <- pairs[pairs$ensembl %in% source_ids, , drop = FALSE]
by_ensembl <- split(seq_len(nrow(pairs)), pairs$ensembl)
candidate <- lapply(by_ensembl, function(ii) {
  gids <- unique(pairs$GeneID[ii]); syms <- unique(pairs$symbol[ii])
  if (length(gids) == 1L && length(syms) == 1L &&
      grepl("^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._-]*$", syms, perl = TRUE)) {
    c(GeneID = as.character(gids), symbol = syms)
  } else NULL
})
candidate <- candidate[lengths(candidate) > 0L]
candidate_map <- data.frame(
  ensembl = names(candidate),
  GeneID = as.integer(vapply(candidate, function(x) x[["GeneID"]], character(1))),
  symbol = vapply(candidate, function(x) x[["symbol"]], character(1)),
  stringsAsFactors = FALSE
)
symbol_gid_count <- vapply(split(candidate_map$GeneID, candidate_map$symbol),
                           function(v) length(unique(v)), integer(1))
candidate_map <- candidate_map[symbol_gid_count[candidate_map$symbol] == 1L, , drop = FALSE]
mapped_symbol <- setNames(candidate_map$symbol, candidate_map$ensembl)
promote <- source_ids %in% candidate_map$ensembl
final_labels <- paste0("__UNMAPPED_SSCR_", source_ids)
final_labels[promote] <- unname(mapped_symbol[source_ids[promote]])
if (sum(promote) != 17592L || length(unique(final_labels[promote])) != 17438L ||
    sum(!promote) != 18078L) {
  stop("reviewed pig Ensembl-to-official-symbol mapping signature changed")
}
M <- rowsum(M_source, group = final_labels, reorder = FALSE)
conservation_delta <- colSums(M) - colSums(M_source)
if (nrow(M) != 35516L || any(conservation_delta != 0)) {
  stop("official-symbol aggregation failed count-conservation gates")
}
map_audit <- data.frame(
  source_ensembl_id = source_ids, output_label = final_labels,
  mapping_status = ifelse(promote, "mapped_current_NCBI_Ensembl_xref",
                          "reserved_unresolved_or_ambiguous_source_id"),
  official_gene_id = candidate_map$GeneID[match(source_ids, candidate_map$ensembl)],
  official_symbol = candidate_map$symbol[match(source_ids, candidate_map$ensembl)],
  stringsAsFactors = FALSE
)
write.table(map_audit, file.path(DS, "metadata", "GSE281726_identifier_mapping.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

out_path <- file.path(DS, "raw", "GSE281726_hypothalamus_ALAC_vs_WPI_counts.tsv.gz")
out <- data.frame(symbol = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
con <- gzfile(out_path, "w")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$symbol, rownames(M)) ||
    !identical(names(roundtrip)[-1L], samples$sample) ||
    any(as.matrix(roundtrip[-1L]) != M)) {
  stop("written pig count matrix failed exact round-trip validation")
}

ss <- samples[, c("sample", "group", "geo_accession", "biosample", "sra",
                  "source_file", "pig_id", "formula", "sex", "tissue")]
ss$age <- "postnatal day 16"
write.table(ss, file.path(DS, "metadata", "GSE281726_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
qc <- data.frame(
  sample = samples$sample, group = samples$group, sex = samples$sex,
  source_rows = nrow(M_source), output_rows = nrow(M),
  mapped_source_rows = sum(promote),
  official_symbol_rows = length(unique(final_labels[promote])),
  reserved_source_rows = sum(!promote),
  collapsed_mapped_rows = sum(promote) - length(unique(final_labels[promote])),
  excluded_htseq_summary_rows = length(technical_labels),
  htseq_no_feature = technical_counts[match("__no_feature", technical_labels), ],
  htseq_ambiguous = technical_counts[match("__ambiguous", technical_labels), ],
  htseq_too_low_aQual = technical_counts[match("__too_low_aQual", technical_labels), ],
  htseq_not_aligned = technical_counts[match("__not_aligned", technical_labels), ],
  htseq_alignment_not_unique = technical_counts[match("__alignment_not_unique", technical_labels), ],
  source_library_size = colSums(M_source), output_library_size = colSums(M),
  count_conservation_delta = conservation_delta,
  detected_output_features = colSums(M > 0),
  nonfinite_values = colSums(!is.finite(M_source)),
  negative_values = colSums(M_source < 0),
  fractional_values = colSums(M_source != round(M_source)),
  accepted_input_class = "HTSeq integer gene counts from 3-prime Tag-Seq",
  batch_handling = "sex modeled additively; both sexes represented in both arms",
  shared_route = "input_kind=counts -> canonical edgeR-QL",
  stringsAsFactors = FALSE
)
if (any(qc$nonfinite_values != 0) || any(qc$negative_values != 0) ||
    any(qc$fractional_values != 0) || any(qc$count_conservation_delta != 0) ||
    any(qc$output_library_size < 1e5)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE281726_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE281726] wrote %d count-conserved rows x %d hypothalamus samples; WPI=12, ALAC=11; %d official pig symbols\n",
            nrow(M), ncol(M), length(unique(final_labels[promote]))))
