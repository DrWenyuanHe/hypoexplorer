#!/usr/bin/env Rscript
# Prepare the 8-week-old mouse hypothalamus arm of GSE264350: normal light/dark
# housing (control, n=5 independent BioSamples) versus circadian-rhythm
# disruption (case, n=5). GEO supplies FPKM in a legacy XLS workbook, so this
# adapter uses the repository-pinned SheetJS dependency to extract the reviewed
# worksheet and applies the explicit log2(FPKM + 1) transform. Source symbols
# include Excel-corrupted labels; numeric Entrez GeneIDs are instead mapped via
# a pinned official NCBI Mus musculus gene_info table. Nothing is guessed.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE264350_mmus_hypothalamus_circadian_disruption")
SRC <- file.path(DS, "raw", "GSE264350_18M_8W_RNA-seq_FPKM.xls.gz")
SOFT <- file.path(DS, "metadata", "GSE264350_family.soft.gz")
SERIES_MATRIX <- file.path(DS, "metadata", "GSE264350_series_matrix.txt.gz")
GENE_INFO <- file.path(DS, "metadata", "Mus_musculus.gene_info.gz")
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
  path = c(SRC, SOFT, SERIES_MATRIX, GENE_INFO),
  bytes = c(5494019, 7926, 6627, 3919363),
  sha256 = c(
    "aa76df8aa6c6cc2cfa4b5901ec215b0b557bbc28ecbd1d6d3f16d0ad65cb1b23",
    "e604aa31277fa1804ee4a10dd85706e1d33d906860e013999800c4e544350886",
    "618bb831a1b6e449c3062c63a53e353fdfe4183b07fbaadd920936e0c342eb35",
    "00832bb9b2b288d7fe65b76eb299d7801cea64f636e622e2203ff847c6fd7d44"
  ),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE264nnn/GSE264350/suppl/GSE264350_18M_8W_RNA-seq_FPKM.xls.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE264nnn/GSE264350/soft/GSE264350_family.soft.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE264nnn/GSE264350/matrix/GSE264350_series_matrix.txt.gz",
    "https://ftp.ncbi.nlm.nih.gov/gene/DATA/GENE_INFO/Mammalia/Mus_musculus.gene_info.gz"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(pins$path))) stop("required official GEO/NCBI input is missing")
observed_bytes <- as.numeric(file.info(pins$path)$size); observed_sha <- unname(vapply(pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, pins$bytes) || !identical(observed_sha, pins$sha256)) stop("source bytes/SHA-256 differ from reviewed inputs")

samples <- data.frame(
  gsm = paste0("GSM82167", sprintf("%02d", 7:16)),
  biosample = paste0("SAMN41010", 219:210),
  sra = c(paste0("SRX24304", 395:402), "SRX24304373", "SRX24304374"),
  source_column = c(paste0("fpkm_Hyp_8wCKM", 1:5), paste0("fpkm_Hyp_8wEGM", 1:5)),
  sample = c(paste0("control_CKM", 1:5), paste0("CRD_EGM", 1:5)),
  title = c(paste0("Hyp_8wCKM", 1:5), paste0("Hyp_8wEGM", 1:5)),
  group = rep(c("control", "case"), each = 5L), condition = rep(c("control", "circadian rhythm disruption"), each = 5L),
  stringsAsFactors = FALSE
)
if (any(table(samples$group) < 3L) || anyDuplicated(samples$gsm) || anyDuplicated(samples$biosample)) stop("contrast lacks >=3 independent BioSamples per arm")

soft <- readLines(gzfile(SOFT), warn = FALSE)
design <- sub("^!Series_overall_design = ", "", grep("^!Series_overall_design = ", soft, value = TRUE))
processing <- sub("^!Sample_data_processing = ", "", grep("^!Sample_data_processing = ", soft, value = TRUE))
if (length(design) != 1L || !grepl("hypothalamus", design, fixed = TRUE) || !grepl("8-week-old", paste(soft, collapse = " "), fixed = TRUE) ||
    !any(grepl("Genes expression level is quantified through RSEM", processing, fixed = TRUE)) ||
    !any(grepl("FPKM ( Fragments Per Kilobase Million) for each Sample", processing, fixed = TRUE))) stop("GEO no longer documents the reviewed RSEM FPKM experiment")
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft)); names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
block <- function(gsm) { i <- match(gsm, names(starts)); if (is.na(i)) stop("GSM absent from SOFT: ", gsm); soft[starts[i]:ends[i]] }
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
for (i in seq_len(nrow(samples))) {
  b <- block(samples$gsm[i]); rel <- tag(b, "!Sample_relation")
  if (!identical(tag(b, "!Sample_title"), samples$title[i]) || !"tissue: hypothalamus" %in% tag(b, "!Sample_characteristics_ch1") ||
      !any(grepl(samples$biosample[i], rel, fixed = TRUE)) || !any(grepl(samples$sra[i], rel, fixed = TRUE)) ||
      !identical(tag(b, "!Sample_library_strategy"), "RNA-Seq")) stop(samples$gsm[i], ": SOFT metadata changed")
}

# Decompress the genuine BIFF/OLE .xls and deterministically export only the
# reviewed worksheet. The xlsx package is a declared repository dependency.
node <- Sys.which("node")
cli <- file.path(ROOT, "..", "node_modules", "xlsx", "bin", "xlsx.njs")
if (!nzchar(node) || !file.exists(cli)) stop("node plus the repository xlsx dependency are required to parse the official legacy XLS")
xls_tmp <- tempfile(fileext = ".xls"); csv_tmp <- tempfile(fileext = ".csv")
on.exit(unlink(c(xls_tmp, csv_tmp)), add = TRUE)
ic <- gzfile(SRC, "rb"); oc <- file(xls_tmp, "wb")
repeat { buf <- readBin(ic, "raw", 1024L * 1024L); if (!length(buf)) break; writeBin(buf, oc) }
close(ic); close(oc)
sheetjs_output <- system2(node, c(shQuote(normalizePath(cli)), "-f", shQuote(xls_tmp), "-s", "gene_expression", "-o", shQuote(csv_tmp)), stdout = TRUE, stderr = TRUE)
sheetjs_status <- attr(sheetjs_output, "status"); if (is.null(sheetjs_status)) sheetjs_status <- 0L
if (sheetjs_status != 0L || !file.exists(csv_tmp) || !identical(sheetjs_output, "gene_expression")) stop("SheetJS failed to extract the reviewed gene_expression worksheet")
d <- data.table::fread(csv_tmp, data.table = FALSE, check.names = FALSE, showProgress = FALSE)
if (!identical(dim(d), c(20673L, 81L)) || !identical(names(d)[1:3], c("st_gene_id", "gene_id", "gene_symbol")) ||
    length(setdiff(samples$source_column, names(d)))) stop("official FPKM worksheet schema/dimensions changed")
if (anyNA(d$st_gene_id) || anyDuplicated(d$st_gene_id) || anyNA(d$gene_id) || anyDuplicated(d$gene_id)) stop("source stable/Entrez IDs are blank or duplicated")
M_source <- as.matrix(d[, samples$source_column, drop = FALSE]); storage.mode(M_source) <- "double"; colnames(M_source) <- samples$sample
if (any(!is.finite(M_source)) || any(M_source < 0) || sum(M_source != round(M_source)) != 174683L) stop("reviewed non-negative fractional FPKM semantics no longer hold")
expected_sums <- c(458172.99, 430705.84, 454877.52, 444315.86, 465108.25, 453359.61, 436213.40, 455665.83, 447701.21, 437735.91)
if (any(abs(colSums(M_source) - expected_sums) > 1e-7)) stop("FPKM numeric signature changed")

gene_info_all <- data.table::fread(GENE_INFO, data.table = FALSE, check.names = FALSE, showProgress = FALSE)
expected_taxa <- c(`10090` = 112258L, `10091` = 13L, `10092` = 17L, `39442` = 13L, `57486` = 13L)
observed_taxa <- table(gene_info_all[["#tax_id"]])
if (!identical(dim(gene_info_all), c(112314L, 16L)) || !all(c("#tax_id", "GeneID", "Symbol") %in% names(gene_info_all)) ||
    !identical(names(observed_taxa), names(expected_taxa)) || !identical(as.integer(observed_taxa), unname(expected_taxa))) stop("official Mus musculus gene_info schema/taxon composition changed")
# NCBI's species-named file also carries four Mus musculus subspecies/strain
# taxids. The GEO samples are taxid 10090, so only that exact species map is
# admissible for identifier conversion.
gene_info <- gene_info_all[gene_info_all[["#tax_id"]] == 10090L, , drop = FALSE]
if (nrow(gene_info) != 112258L || anyDuplicated(gene_info$GeneID)) stop("taxid-10090 Entrez map is not one-to-one")
entrez_to_symbol <- setNames(as.character(gene_info$Symbol), as.character(gene_info$GeneID))
mapped_symbol <- unname(entrez_to_symbol[as.character(d$gene_id)])
valid_symbol <- !is.na(mapped_symbol) & grepl("^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._-]*$", mapped_symbol, perl = TRUE)
if (sum(valid_symbol) != 20544L || sum(!valid_symbol) != 129L || anyDuplicated(mapped_symbol[valid_symbol])) stop("reviewed Entrez-to-official-symbol mapping signature changed")

M_fpkm <- M_source[valid_symbol, , drop = FALSE]; rownames(M_fpkm) <- mapped_symbol[valid_symbol]
M_quarantine <- M_source[!valid_symbol, , drop = FALSE]
conservation_delta <- colSums(M_fpkm) + colSums(M_quarantine) - colSums(M_source)
if (any(abs(conservation_delta) > 1e-8)) stop("mapped/quarantined FPKM partition did not conserve source values")
M <- log2(M_fpkm + 1)
out <- data.frame(symbol = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE264350_hypothalamus_8w_CRD_vs_control_log2fpkm.tsv.gz")
old_options <- options(digits = 17, scipen = 999); con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con); options(old_options)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
written_delta <- apply(abs(as.matrix(roundtrip[-1L]) - M), 2L, max)
if (!identical(roundtrip$symbol, rownames(M)) || !identical(names(roundtrip)[-1L], samples$sample) || any(written_delta > 1e-12)) stop("written log2(FPKM+1) matrix failed round-trip validation")

quarantine <- data.frame(st_gene_id = d$st_gene_id[!valid_symbol], gene_id = d$gene_id[!valid_symbol], source_gene_symbol = d$gene_symbol[!valid_symbol],
                         reason = ifelse(is.na(mapped_symbol[!valid_symbol]), "Entrez GeneID absent from pinned official NCBI mouse gene_info", "official NCBI symbol failed conservative identifier syntax"),
                         M_quarantine, check.names = FALSE, stringsAsFactors = FALSE)
qcon <- gzfile(file.path(DS, "metadata", "GSE264350_quarantined_features.tsv.gz"), "w"); write.table(quarantine, qcon, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(qcon)

ss <- samples[, c("sample", "group", "gsm", "biosample", "sra", "source_column", "title", "condition")]
names(ss)[names(ss) == "gsm"] <- "geo_accession"; ss$tissue <- "hypothalamus"; ss$age <- "8 weeks"; ss$strain <- "C57BL/6"
write.table(ss, file.path(DS, "metadata", "GSE264350_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
qc <- data.frame(
  sample = samples$sample, group = samples$group, geo_accession = samples$gsm,
  source_rows = nrow(M_source), mapped_output_rows = nrow(M), quarantined_unmapped_or_invalid_rows = nrow(M_quarantine),
  source_nonfinite_values = colSums(!is.finite(M_source)), source_negative_values = colSums(M_source < 0), source_fractional_values = colSums(M_source != round(M_source)),
  source_fpkm_sum = colSums(M_source), retained_fpkm_sum = colSums(M_fpkm), quarantined_fpkm_sum = colSums(M_quarantine), partition_conservation_delta = conservation_delta,
  detected_retained_features = colSums(M_fpkm > 0), output_min = apply(M, 2L, min), output_max = apply(M, 2L, max), written_matrix_max_abs_delta = written_delta,
  accepted_input_class = "RSEM FPKM", explicit_transform = "log2(FPKM + 1)", shared_route = "input_kind=matrix -> canonical normalized-matrix model",
  stringsAsFactors = FALSE
)
if (any(qc$source_nonfinite_values != 0L) || any(qc$source_negative_values != 0L) || any(abs(qc$partition_conservation_delta) > 1e-8) || any(qc$written_matrix_max_abs_delta > 1e-12)) stop("preprocessing QC failed")
write.table(qc, file.path(DS, "processed", "GSE264350_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
manifest <- data.frame(file = basename(pins$path), bytes = observed_bytes, sha256 = observed_sha, source = pins$url, fetched = "2026-09-01", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE264350_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE264350] wrote %d official-symbol genes x %d samples; control=5, CRD=5; log2(FPKM+1); quarantined %d unmapped Entrez IDs\n", nrow(M), ncol(M), nrow(M_quarantine)))
print(setNames(colSums(M_fpkm), samples$sample))
