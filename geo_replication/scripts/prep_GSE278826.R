#!/usr/bin/env Rscript
# Prepare the high- versus low-residual-feed-intake chicken hypothalamus
# contrast from the raw gene counts supplied by GEO.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE278826_ggal_hypothalamus_rfi")
SRC <- file.path(DS, "raw", "GSE278826_gene_count.xls.gz")
SOFT <- file.path(DS, "metadata", "GSE278826_family.soft.gz")
GENE_INFO <- file.path(DS, "metadata", "Gallus_gallus.gene_info.gz")
MANIFEST <- file.path(DS, "metadata", "GSE278826_source_files.tsv")
if (!requireNamespace("data.table", quietly = TRUE)) stop("the data.table R package is required")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
if (!file.exists(MANIFEST) ||
    sha256_file(MANIFEST) != "ba74a3734334d68c3585b3bce0dc01cc82be864f148abb10210750ce537cd969") {
  stop("GSE278826 source manifest is missing or changed")
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
  stop("GSE278826 source bytes/SHA-256 differ from the reviewed manifest")
}

soft <- readLines(gzfile(SOFT), warn = FALSE)
if (!any(grepl("Sample count: raw read count values", soft, fixed = TRUE)) ||
    !any(grepl("^!Sample_library_strategy = RNA-Seq$", soft)) ||
    !any(grepl("five RNA pools were created", soft, fixed = TRUE))) {
  stop("GEO no longer documents the reviewed pooled raw-count experiment")
}
starts <- grep("^\\^SAMPLE = ", soft)
ends <- c(starts[-1L] - 1L, length(soft))
tag <- function(b, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), b, value = TRUE))
sample_meta <- do.call(rbind, lapply(seq_along(starts), function(i) {
  b <- soft[starts[i]:ends[i]]; rel <- tag(b, "!Sample_relation")
  data.frame(
    geo_accession = sub("^\\^SAMPLE = ", "", b[1L]),
    title = tag(b, "!Sample_title"),
    tissue = sub("^tissue: ", "", grep("^tissue: ", tag(b, "!Sample_characteristics_ch1"), value = TRUE)),
    biosample = sub(".*(SAMN[0-9]+).*", "\\1", grep("biosample", rel, ignore.case = TRUE, value = TRUE)),
    sra = sub(".*term=", "", grep("sra\\?term=", rel, ignore.case = TRUE, value = TRUE)),
    stringsAsFactors = FALSE
  )
}))
samples <- sample_meta[grepl("^Hypothalamus_", sample_meta$title), , drop = FALSE]
samples$group <- ifelse(grepl("_LowRFI_", samples$title), "control",
                        ifelse(grepl("_HighRFI_", samples$title), "case", NA))
samples$rfi_group <- ifelse(samples$group == "control", "low RFI", "high RFI")
samples$source_column <- sub("^Hypothalamus_(LowRFI|HighRFI)_", "Hypo_", samples$title)
samples$sample <- sub("^Hypothalamus_", "", samples$title)
if (nrow(samples) != 10L || sum(samples$group == "control") != 5L ||
    sum(samples$group == "case") != 5L || anyNA(samples$group) ||
    any(samples$tissue != "Hypothalamus") ||
    anyDuplicated(samples$geo_accession) || anyDuplicated(samples$biosample) ||
    anyDuplicated(samples$sra) || anyDuplicated(samples$source_column)) {
  stop("reviewed five-pool-per-arm hypothalamus design changed")
}

d <- data.table::fread(SRC, data.table = FALSE, check.names = FALSE, showProgress = FALSE)
required_annotations <- c("gene_id", "gene_name", "gene_description")
if (!identical(dim(d), c(28023L, 30L)) ||
    length(setdiff(c(required_annotations, samples$source_column), names(d)))) {
  stop("official chicken count-table schema/dimensions changed")
}
source_ids <- as.character(d$gene_id)
valid_source_id <- grepl("^ENSGALG[0-9]+([.][0-9]+)?$", source_ids) |
  grepl("^novel[.][0-9]+$", source_ids)
if (anyNA(source_ids) || any(!nzchar(source_ids)) || anyDuplicated(source_ids) ||
    sum(!grepl("^ENSGALG[0-9]+([.][0-9]+)?$", source_ids)) != 3667L ||
    any(!valid_source_id)) {
  stop("blank, duplicate, or unexpected chicken source identifier")
}
M_source <- as.matrix(d[, samples$source_column, drop = FALSE])
storage.mode(M_source) <- "double"; colnames(M_source) <- samples$sample
if (any(!is.finite(M_source)) || any(M_source < 0) || any(M_source != round(M_source))) {
  stop("reviewed raw integer-count semantics no longer hold")
}

gene_info_all <- data.table::fread(GENE_INFO, data.table = FALSE, check.names = FALSE, showProgress = FALSE)
taxa <- table(gene_info_all[["#tax_id"]])
if (!identical(dim(gene_info_all), c(32214L, 16L)) ||
    !identical(as.integer(taxa[c("9031", "208524")]), c(32177L, 37L))) {
  stop("official Gallus gallus gene_info signature changed")
}
gene_info <- gene_info_all[gene_info_all[["#tax_id"]] == 9031L, , drop = FALSE]
desc_match <- regmatches(d$gene_description,
                         regexec("\\[Source:NCBI gene;Acc:([0-9]+)\\]", d$gene_description))
direct_gid <- rep(NA_integer_, nrow(d))
has_direct <- lengths(desc_match) == 2L
direct_gid[has_direct] <- as.integer(vapply(desc_match[has_direct], function(x) x[2L], character(1)))
direct_idx <- match(direct_gid, gene_info$GeneID)
exact_idx <- match(d$gene_name, gene_info$Symbol)
mapped_gid <- ifelse(!is.na(direct_idx), direct_gid, gene_info$GeneID[exact_idx])
mapped_symbol <- ifelse(!is.na(direct_idx), gene_info$Symbol[direct_idx], gene_info$Symbol[exact_idx])
valid_syntax <- !is.na(mapped_symbol) &
  grepl("^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._-]*$", mapped_symbol, perl = TRUE)
symbol_gid_count <- vapply(split(mapped_gid, mapped_symbol),
                           function(v) length(unique(na.omit(v))), integer(1))
promote <- valid_syntax & unname(symbol_gid_count[mapped_symbol]) == 1L
if (sum(has_direct) != 7383L || sum(!is.na(direct_idx)) != 7165L ||
    sum(is.na(direct_idx) & !is.na(exact_idx)) != 6082L ||
    sum(promote) != 13244L || length(unique(mapped_symbol[promote])) != 13148L) {
  stop("reviewed chicken identifier-mapping signature changed")
}
final_labels <- paste0("__UNMAPPED_GALG_", source_ids)
final_labels[promote] <- mapped_symbol[promote]
M <- rowsum(M_source, group = final_labels, reorder = FALSE)
conservation_delta <- colSums(M) - colSums(M_source)
if (nrow(M) != 27927L || any(conservation_delta != 0)) {
  stop(sprintf("official-symbol aggregation failed: output_rows=%d; max_count_delta=%g",
               nrow(M), max(abs(conservation_delta))))
}
map_audit <- data.frame(
  source_ensembl_id = source_ids, source_gene_name = d$gene_name,
  parsed_ncbi_gene_id = direct_gid, mapped_ncbi_gene_id = mapped_gid,
  official_symbol = mapped_symbol, output_label = final_labels,
  mapping_status = ifelse(promote,
    ifelse(!is.na(direct_idx), "mapped_by_author_NCBI_GeneID", "mapped_by_exact_current_official_symbol"),
    "reserved_unresolved_or_ambiguous_source_id"),
  stringsAsFactors = FALSE
)
write.table(map_audit, file.path(DS, "metadata", "GSE278826_identifier_mapping.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

out_path <- file.path(DS, "raw", "GSE278826_hypothalamus_high_vs_low_RFI_counts.tsv.gz")
out <- data.frame(symbol = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
con <- gzfile(out_path, "w")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$symbol, rownames(M)) ||
    !identical(names(roundtrip)[-1L], samples$sample) ||
    any(as.matrix(roundtrip[-1L]) != M)) {
  stop("written chicken count matrix failed exact round-trip validation")
}

ss <- samples[, c("sample", "group", "geo_accession", "biosample", "sra",
                  "source_column", "rfi_group", "tissue")]
ss$sex <- "male"; ss$biological_unit <- "pool of RNA from two birds"
write.table(ss, file.path(DS, "metadata", "GSE278826_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
qc <- data.frame(
  sample = samples$sample, group = samples$group,
  source_rows = nrow(M_source), output_rows = nrow(M),
  mapped_source_rows = sum(promote),
  official_symbol_rows = length(unique(mapped_symbol[promote])),
  reserved_source_rows = sum(!promote),
  collapsed_mapped_rows = sum(promote) - length(unique(mapped_symbol[promote])),
  source_library_size = colSums(M_source), output_library_size = colSums(M),
  count_conservation_delta = conservation_delta,
  detected_output_features = colSums(M > 0),
  nonfinite_values = colSums(!is.finite(M_source)),
  negative_values = colSums(M_source < 0),
  fractional_values = colSums(M_source != round(M_source)),
  accepted_input_class = "raw gene read counts",
  shared_route = "input_kind=counts -> canonical edgeR-QL",
  stringsAsFactors = FALSE
)
if (any(qc$nonfinite_values != 0) || any(qc$negative_values != 0) ||
    any(qc$fractional_values != 0) || any(qc$count_conservation_delta != 0) ||
    any(qc$output_library_size < 1e6)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE278826_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE278826] wrote %d count-conserved rows x %d pooled samples; low RFI=5, high RFI=5; %d official chicken symbols\n",
            nrow(M), ncol(M), length(unique(mapped_symbol[promote]))))
