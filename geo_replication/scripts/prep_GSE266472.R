#!/usr/bin/env Rscript
# Prepare a projected-ZT12 long- versus short-photoperiod SCN contrast from
# GSE266472. The selected samples are balanced within both sequencing batches.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE266472_mmus_scn_photoperiod")
SOFT <- file.path(DS, "metadata", "GSE266472_family.soft.gz")
SRA_XML <- file.path(DS, "metadata", "GSE266472_sra_records.xml")
MANIFEST <- file.path(DS, "metadata", "GSE266472_source_files.tsv")
if (!requireNamespace("data.table", quietly = TRUE) ||
    !requireNamespace("xml2", quietly = TRUE) ||
    !requireNamespace("AnnotationDbi", quietly = TRUE) ||
    !requireNamespace("org.Mm.eg.db", quietly = TRUE)) {
  stop("data.table, xml2, AnnotationDbi, and org.Mm.eg.db are required")
}

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
if (!file.exists(MANIFEST) ||
    sha256_file(MANIFEST) != "3d96b2caf35e38385a4644cd154fc255d71c83ed707e7646c8012eb058221df1") {
  stop("GSE266472 source manifest is missing or changed")
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
  stop("GSE266472 source bytes/SHA-256 differ from the reviewed manifest")
}

soft <- readLines(gzfile(SOFT), warn = FALSE)
if (!any(grepl("HTSeq-formatted counts file", soft, fixed = TRUE)) ||
    !any(grepl("^!Sample_library_strategy = RNA-Seq$", soft)) ||
    !any(grepl("^!Series_pubmed_id = 39096022$", soft)) ||
    !any(grepl("minimum n of 4 was achieved per timepoint per cycle", soft, fixed = TRUE))) {
  stop("GEO no longer documents the reviewed SCN RNA-seq count experiment")
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
    photoperiod = char_value(b, "photoperioid"),
    projected_zt = as.integer(char_value(b, "projected zeitgeber_time")),
    clock_time = as.integer(char_value(b, "timepoint clock_time")),
    cycle = char_value(b, "circadian cycle"),
    replicate = char_value(b, "replicate"),
    rna_batch = char_value(b, "batch rna_extraction"),
    seq_batch = char_value(b, "batch sequencing"),
    biosample = sub(".*(SAMN[0-9]+).*", "\\1", grep("biosample", rel, ignore.case = TRUE, value = TRUE)),
    sra = sub(".*term=", "", grep("sra\\?term=", rel, ignore.case = TRUE, value = TRUE)),
    stringsAsFactors = FALSE
  )
}))
samples <- sample_meta[sample_meta$projected_zt == 12L, , drop = FALSE]
samples$group <- ifelse(samples$photoperiod == "SHORT", "control",
                        ifelse(samples$photoperiod == "LONG", "case", NA))
samples$sample <- paste(tolower(samples$photoperiod), paste0("cycle", samples$cycle),
                        paste0("rep", samples$replicate), sep = "_")
if (nrow(samples) != 18L || sum(samples$group == "control") != 9L ||
    sum(samples$group == "case") != 9L || anyNA(samples$group) ||
    sum(samples$seq_batch == "5209" & samples$group == "control") != 4L ||
    sum(samples$seq_batch == "5209" & samples$group == "case") != 4L ||
    sum(samples$seq_batch == "5728" & samples$group == "control") != 5L ||
    sum(samples$seq_batch == "5728" & samples$group == "case") != 5L ||
    anyDuplicated(samples$geo_accession) || anyDuplicated(samples$biosample) ||
    anyDuplicated(samples$sra) || anyDuplicated(samples$sample)) {
  stop("reviewed batch-balanced nine-per-arm pZT12 design changed")
}

xml <- xml2::read_xml(SRA_XML)
packages <- xml2::xml_find_all(xml, ".//EXPERIMENT_PACKAGE")
sra_map <- do.call(rbind, lapply(packages, function(node) {
  gsm <- xml2::xml_text(xml2::xml_find_first(
    node, ".//SAMPLE_DESCRIPTOR/IDENTIFIERS/EXTERNAL_ID"))
  srx <- xml2::xml_attr(xml2::xml_find_first(node, "./EXPERIMENT"), "accession")
  sf <- xml2::xml_find_all(node, ".//SRAFile")
  original_fastq <- xml2::xml_attr(sf[xml2::xml_attr(sf, "semantic_name") == "fastq"], "filename")
  r1 <- original_fastq[grepl("_R1_", original_fastq)]
  if (length(r1) != 1L) return(NULL)
  prefix <- sub("-[^-]+-[^-]+_S.*$", "", r1)
  data.frame(geo_accession = gsm, sra = srx,
             original_r1_filename = r1,
             source_file = paste0("GSE266472_", prefix, "_HTSeq_formatted.counts.gz"),
             stringsAsFactors = FALSE)
}))
samples <- merge(samples, sra_map, by = c("geo_accession", "sra"), all.x = TRUE, sort = FALSE)
samples <- samples[match(sample_meta$geo_accession[sample_meta$projected_zt == 12L],
                         samples$geo_accession), , drop = FALSE]
if (anyNA(samples$source_file) || anyDuplicated(samples$source_file) ||
    length(setdiff(samples$source_file, pins$file))) {
  stop("official SRA original filenames no longer map selected GSMs to reviewed count files")
}

source_tables <- lapply(file.path(DS, "raw", samples$source_file), function(f)
  data.table::fread(f, header = FALSE, data.table = FALSE, showProgress = FALSE))
if (any(vapply(source_tables, nrow, integer(1)) != 56980L) ||
    any(vapply(source_tables, ncol, integer(1)) != 2L)) {
  stop("per-sample HTSeq count-file dimensions changed")
}
source_ids <- as.character(source_tables[[1L]][[1L]])
if (anyNA(source_ids) || any(!nzchar(source_ids)) || anyDuplicated(source_ids) ||
    any(!grepl("^ENSMUSG[0-9]+([.][0-9]+)?$", source_ids)) ||
    !all(vapply(source_tables, function(x) identical(as.character(x[[1L]]), source_ids), logical(1)))) {
  stop("mouse Ensembl feature namespaces/order differ across selected files")
}
M <- do.call(cbind, lapply(source_tables, function(x) as.numeric(x[[2L]])))
colnames(M) <- samples$sample; rownames(M) <- source_ids
if (any(!is.finite(M)) || any(M < 0) || any(M != round(M))) {
  stop("reviewed raw integer-count semantics no longer hold")
}

base_ids <- sub("\\..*$", "", source_ids)
mapped <- suppressMessages(AnnotationDbi::mapIds(
  org.Mm.eg.db::org.Mm.eg.db, keys = base_ids,
  keytype = "ENSEMBL", column = "SYMBOL", multiVals = "first"
))
mapped <- unname(mapped[base_ids])
if (sum(!is.na(mapped) & nzchar(mapped)) < 20000L) {
  stop("current mouse Ensembl-to-symbol mapping coverage unexpectedly low")
}
map_audit <- data.frame(
  source_ensembl_id = source_ids, versionless_ensembl_id = base_ids,
  current_symbol = mapped,
  mapping_status = ifelse(!is.na(mapped) & nzchar(mapped),
                          "mapped_by_current_org.Mm.eg.db", "unmapped_retained_as_Ensembl"),
  stringsAsFactors = FALSE
)
write.table(map_audit, file.path(DS, "metadata", "GSE266472_identifier_mapping.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

out_path <- file.path(DS, "raw", "GSE266472_SCN_pZT12_long_vs_short_counts.tsv.gz")
out <- data.frame(gene_id = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
con <- gzfile(out_path, "w")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$gene_id, rownames(M)) ||
    !identical(names(roundtrip)[-1L], samples$sample) ||
    any(as.matrix(roundtrip[-1L]) != M)) {
  stop("written mouse count matrix failed exact round-trip validation")
}

ss <- samples[, c("sample", "group", "geo_accession", "biosample", "sra",
                  "source_file", "original_r1_filename", "photoperiod",
                  "projected_zt", "clock_time", "cycle", "replicate",
                  "rna_batch", "seq_batch")]
ss$tissue <- "suprachiasmatic nucleus"; ss$sex <- "male"; ss$age <- "postnatal day 50"
write.table(ss, file.path(DS, "metadata", "GSE266472_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
qc <- data.frame(
  sample = samples$sample, group = samples$group, seq_batch = samples$seq_batch,
  source_rows = nrow(M), current_symbol_mappings = sum(!is.na(mapped) & nzchar(mapped)),
  library_size = colSums(M), detected_features = colSums(M > 0),
  nonfinite_values = colSums(!is.finite(M)), negative_values = colSums(M < 0),
  fractional_values = colSums(M != round(M)),
  accepted_input_class = "HTSeq integer gene counts",
  batch_handling = "sequencing batch modeled additively; 4v4 in 5209 and 5v5 in 5728",
  shared_route = "input_kind=counts -> canonical edgeR-QL",
  stringsAsFactors = FALSE
)
if (any(qc$nonfinite_values != 0) || any(qc$negative_values != 0) ||
    any(qc$fractional_values != 0) || any(qc$library_size < 1e6) ||
    any(qc$detected_features < 10000L)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE266472_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE266472] wrote %d Ensembl count rows x %d pZT12 SCN samples; short=9, long=9; %d current mouse symbol mappings\n",
            nrow(M), ncol(M), sum(!is.na(mapped) & nzchar(mapped))))
