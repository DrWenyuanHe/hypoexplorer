#!/usr/bin/env Rscript
# Prepare the sex-balanced POAH Hour_2 contrast from GSE298648: conventionally
# incubated broiler chicks (control, n=4 independent BioSamples) versus
# embryonic heat-conditioned chicks (case, n=4). All birds received the same
# acute day-4 heat challenge before sampling. GEO supplies raw gene read counts.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE298648_ggal_poah_ehc")
SRC <- file.path(DS, "raw", "GSE298648_2025_05_30_unfiltered_count_data.txt.bz2")
SOFT <- file.path(DS, "metadata", "GSE298648_family.soft.gz")
GENE_INFO <- file.path(DS, "metadata", "Gallus_gallus.gene_info.gz")
if (!requireNamespace("data.table", quietly = TRUE)) stop("the data.table R package is required")

sha256_file <- function(path) {
  if (.Platform$OS.type == "windows") {
    z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
    z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  } else if (nzchar(Sys.which("sha256sum"))) {
    z <- system2("sha256sum", shQuote(path), stdout = TRUE, stderr = TRUE)
    z <- sub("[[:space:]].*$", "", z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  } else stop("no SHA-256 utility found")
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
pins <- data.frame(
  path = c(SRC, SOFT, GENE_INFO), bytes = c(1731865, 9099, 1190334),
  sha256 = c("2a8944f2bc2a9f90b0d93d7d79a5f512bface6dd6dacc1bc072acc9c75105aab",
             "f2825649e9bd08fe9b95c79eba7c63325d1dbb27f77bd23d254e7e0bcc6d0c1f",
             "6439131780910766d033094798233926889e74571e1a48057e1568b58ddc92cf"),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE298nnn/GSE298648/suppl/GSE298648_2025_05_30_unfiltered_count_data.txt.bz2",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE298nnn/GSE298648/soft/GSE298648_family.soft.gz",
    "https://ftp.ncbi.nlm.nih.gov/gene/DATA/GENE_INFO/Non-mammalian_vertebrates/Gallus_gallus.gene_info.gz"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(pins$path))) stop("required official GEO source or family SOFT is missing")
observed_bytes <- as.numeric(file.info(pins$path)$size); observed_sha <- unname(vapply(pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, pins$bytes) || !identical(observed_sha, pins$sha256)) stop("source bytes/SHA-256 differ from reviewed inputs")

samples <- data.frame(
  gsm = c(paste0("GSM901994", 5:8), paste0("GSM901993", 4:7)),
  biosample = c(paste0("SAMN488608", 84:81), paste0("SAMN488608", 95:92)),
  sra = c(paste0("SRX290232", 59:62), paste0("SRX290232", 48:51)),
  source_column = c("Sample_64", "Sample_73", "Sample_70", "Sample_118", "Sample_67", "Sample_91", "Sample_115", "Sample_79"),
  sample = c("control_M1", "control_M2", "control_F1", "control_F2", "EHC_M1", "EHC_M2", "EHC_F1", "EHC_F2"),
  group = rep(c("control", "case"), each = 4L), treatment = rep(c("C", "EHC"), each = 4L),
  sex = rep(c("Male", "Male", "Female", "Female"), 2L), geo_replicate_label = rep(c("Rep_D", "Rep_C"), each = 4L),
  stringsAsFactors = FALSE
)
if (any(table(samples$group) < 3L) || anyDuplicated(samples$gsm) || anyDuplicated(samples$biosample)) stop("contrast lacks >=3 independent BioSamples per arm")

soft <- readLines(gzfile(SOFT), warn = FALSE)
design <- sub("^!Series_overall_design = ", "", grep("^!Series_overall_design = ", soft, value = TRUE))
processing <- sub("^!Sample_data_processing = ", "", grep("^!Sample_data_processing = ", soft, value = TRUE))
if (length(design) != 1L || !grepl("Control and EHC groups were subjected to an acute heat challenge", design, fixed = TRUE) ||
    !any(grepl("read counts in a tab delimited text file", processing, fixed = TRUE)) ||
    !any(grepl("Samples with or more than 90% of correct alignment were used for counting", processing, fixed = TRUE))) stop("GEO no longer documents the reviewed raw-count experiment")
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft)); names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
block <- function(gsm) { i <- match(gsm, names(starts)); if (is.na(i)) stop("GSM absent from SOFT: ", gsm); soft[starts[i]:ends[i]] }
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
for (i in seq_len(nrow(samples))) {
  b <- block(samples$gsm[i]); rel <- tag(b, "!Sample_relation"); chars <- tag(b, "!Sample_characteristics_ch1")
  if (!identical(tag(b, "!Sample_title"), samples$source_column[i]) || !"tissue: POAH" %in% chars || !"time point: Hour_2" %in% chars ||
      !paste0("Sex: ", samples$sex[i]) %in% chars || !paste0("treatment: ", samples$treatment[i]) %in% chars ||
      !paste0("biological replicate: ", samples$geo_replicate_label[i]) %in% chars ||
      !any(grepl(samples$biosample[i], rel, fixed = TRUE)) || !any(grepl(samples$sra[i], rel, fixed = TRUE)) ||
      !identical(tag(b, "!Sample_library_strategy"), "RNA-Seq")) stop(samples$gsm[i], ": SOFT metadata changed")
}

d <- data.table::fread(SRC, data.table = FALSE, check.names = FALSE, showProgress = FALSE)
if (!identical(dim(d), c(30108L, 72L)) || !identical(names(d)[1L], "gene_id") || length(setdiff(samples$source_column, names(d)))) stop("official count-table schema/dimensions changed")
ids <- as.character(d$gene_id)
if (anyNA(ids) || any(!nzchar(ids)) || anyDuplicated(ids) || any(!grepl("^ENSGALG[0-9]+([.][0-9]+)?$", ids))) stop("blank, duplicate, or invalid chicken Ensembl gene ID")
M_source <- as.matrix(d[, samples$source_column, drop = FALSE]); storage.mode(M_source) <- "double"; colnames(M_source) <- samples$sample
if (any(!is.finite(M_source)) || any(M_source < 0) || any(M_source != round(M_source))) stop("reviewed raw integer-count semantics no longer hold")
expected_lib <- c(6099027, 6043226, 6058747, 4888023, 3173834, 2837239, 2336020, 1370531)
expected_detected <- c(22122, 22257, 23071, 22708, 20091, 21162, 20749, 19537)
if (!identical(unname(colSums(M_source)), expected_lib) || !identical(unname(colSums(M_source > 0)), expected_detected)) stop("count-table numeric signature changed")

# The shared pipeline has no built-in chicken Ensembl converter. Build a
# fail-closed projection from the pinned official NCBI taxid-9031 gene_info
# dbXrefs. Promote only Ensembl IDs with one GeneID, one conservative official
# symbol, and a symbol that is not shared by distinct GeneIDs. Many-to-one
# Ensembl IDs for the same GeneID are summed on the untouched count scale.
# Every other valid source Ensembl ID remains as a unique reserved identifier,
# preserving all counts without inventing a gene name.
gene_info_all <- data.table::fread(GENE_INFO, data.table = FALSE, check.names = FALSE, showProgress = FALSE)
observed_taxa <- table(gene_info_all[["#tax_id"]]); expected_taxa <- c(`9031` = 32177L, `208524` = 37L)
if (!identical(dim(gene_info_all), c(32214L, 16L)) || !all(c("#tax_id", "GeneID", "Symbol", "dbXrefs") %in% names(gene_info_all)) ||
    !identical(names(observed_taxa), names(expected_taxa)) || !identical(as.integer(observed_taxa), unname(expected_taxa))) stop("official Gallus gallus gene_info schema/taxon composition changed")
gene_info <- gene_info_all[gene_info_all[["#tax_id"]] == 9031L, , drop = FALSE]
xref_tokens <- strsplit(gene_info$dbXrefs, "|", fixed = TRUE)
ensembl_tokens <- lapply(xref_tokens, function(v) sub("^Ensembl:", "", v[grepl("^Ensembl:ENSGALG[0-9]+$", v)]))
pairs <- data.frame(
  ensembl = unlist(ensembl_tokens, use.names = FALSE),
  GeneID = rep(gene_info$GeneID, lengths(ensembl_tokens)),
  symbol = rep(gene_info$Symbol, lengths(ensembl_tokens)), stringsAsFactors = FALSE
)
pairs <- pairs[pairs$ensembl %in% ids, , drop = FALSE]
by_ensembl <- split(seq_len(nrow(pairs)), pairs$ensembl)
status <- setNames(rep("absent_from_pinned_NCBI_Ensembl_xrefs", length(ids)), ids)
candidate <- vector("list", length(by_ensembl)); names(candidate) <- names(by_ensembl)
for (e in names(by_ensembl)) {
  ii <- by_ensembl[[e]]; gids <- unique(pairs$GeneID[ii]); syms <- unique(pairs$symbol[ii])
  if (length(gids) != 1L || length(syms) != 1L) {
    status[e] <- "ambiguous_NCBI_Ensembl_xref"
  } else if (!grepl("^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._-]*$", syms, perl = TRUE)) {
    status[e] <- "invalid_official_symbol_syntax"
  } else {
    status[e] <- "candidate"
    candidate[[e]] <- c(GeneID = as.character(gids), symbol = syms)
  }
}
candidate <- candidate[lengths(candidate) > 0L]
candidate_map <- data.frame(
  ensembl = names(candidate), GeneID = as.integer(vapply(candidate, `[[`, character(1), "GeneID")),
  symbol = vapply(candidate, `[[`, character(1), "symbol"), stringsAsFactors = FALSE
)
symbol_gene_count <- vapply(split(candidate_map$GeneID, candidate_map$symbol), function(v) length(unique(v)), integer(1))
candidate_map$promote <- unname(symbol_gene_count[candidate_map$symbol] == 1L)
status[candidate_map$ensembl[!candidate_map$promote]] <- "official_symbol_shared_by_distinct_GeneIDs"
status[candidate_map$ensembl[candidate_map$promote]] <- "mapped_official_symbol"
promoted <- candidate_map[candidate_map$promote, , drop = FALSE]
status_counts <- table(status)
if (!identical(as.integer(status_counts), c(14615L, 47L, 1L, 15441L, 4L)) ||
    !identical(names(status_counts), c("absent_from_pinned_NCBI_Ensembl_xrefs", "ambiguous_NCBI_Ensembl_xref", "invalid_official_symbol_syntax", "mapped_official_symbol", "official_symbol_shared_by_distinct_GeneIDs"))) stop("reviewed chicken identifier-mapping signature changed")

mapped_symbol <- setNames(promoted$symbol, promoted$ensembl)
final_labels <- paste0("__UNMAPPED_GALG_", ids)
is_promoted <- ids %in% promoted$ensembl
final_labels[is_promoted] <- unname(mapped_symbol[ids[is_promoted]])
M <- rowsum(M_source, group = final_labels, reorder = FALSE)
conservation_delta <- colSums(M) - colSums(M_source)
if (nrow(M) != 30080L || any(abs(conservation_delta) > 0)) stop("official-symbol aggregation failed row-count/count-conservation gates")

map_audit <- data.frame(
  source_ensembl_id = ids, output_label = final_labels, mapping_status = unname(status[ids]),
  official_entrez_gene_id = candidate_map$GeneID[match(ids, candidate_map$ensembl)],
  official_symbol = candidate_map$symbol[match(ids, candidate_map$ensembl)], stringsAsFactors = FALSE
)
write.table(map_audit, file.path(DS, "metadata", "GSE298648_identifier_mapping.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

out <- data.frame(symbol = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE298648_POAH_hour2_EHC_vs_control_counts.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$symbol, rownames(M)) || !identical(names(roundtrip)[-1L], samples$sample) || any(as.matrix(roundtrip[-1L]) != M)) stop("written count matrix failed exact round-trip validation")

ss <- samples[, c("sample", "group", "gsm", "biosample", "sra", "source_column", "treatment", "sex", "geo_replicate_label")]
names(ss)[names(ss) == "gsm"] <- "geo_accession"; ss$tissue <- "pre-optic anterior hypothalamic area (POAH)"; ss$time_point <- "Hour_2"
ss$batch_model_note <- "Rep_C/Rep_D is treatment-confounded in GEO and is not a batch covariate"
write.table(ss, file.path(DS, "metadata", "GSE298648_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
qc <- data.frame(
  sample = samples$sample, group = samples$group, sex = samples$sex, geo_accession = samples$gsm,
  source_rows = nrow(M_source), output_rows = nrow(M), source_ids_mapped_to_official_symbol = sum(is_promoted),
  official_symbol_rows_after_count_scale_collapse = length(unique(promoted$symbol)), reserved_non_symbol_source_ids = sum(!is_promoted),
  duplicate_ensembl_rows_collapsed_on_count_scale = sum(is_promoted) - length(unique(promoted$symbol)),
  blank_ids = 0L, duplicate_ids = 0L, invalid_source_ids = 0L,
  nonfinite_values = colSums(!is.finite(M_source)), negative_values = colSums(M_source < 0), fractional_values = colSums(M_source != round(M_source)),
  source_library_size = colSums(M_source), output_library_size = colSums(M), count_conservation_delta = conservation_delta,
  detected_output_features = colSums(M > 0), accepted_input_class = "raw gene read counts",
  batch_handling = "GEO Rep_C/Rep_D labels are fully treatment-confounded; batch_var=NA; sex is balanced 2F/2M per arm",
  shared_route = "input_kind=counts -> canonical edgeR-QL", written_exact = TRUE, stringsAsFactors = FALSE
)
if (any(qc$nonfinite_values != 0L) || any(qc$negative_values != 0L) || any(qc$fractional_values != 0L) || any(qc$output_library_size < 1e6) || any(qc$count_conservation_delta != 0)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE298648_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
manifest <- data.frame(file = basename(pins$path), bytes = observed_bytes, sha256 = observed_sha, source = pins$url, fetched = "2026-09-01", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE298648_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE298648] wrote %d count-conserved rows x %d samples; control=4, EHC=4; %d source Ensembl IDs mapped to %d official symbols; %d retained as reserved identifiers\n", nrow(M), ncol(M), sum(is_promoted), length(unique(promoted$symbol)), sum(!is_promoted)))
print(setNames(colSums(M), samples$sample))
