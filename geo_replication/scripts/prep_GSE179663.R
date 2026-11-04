#!/usr/bin/env Rscript
# Prepare the focused 4-v-4 spontaneous-torpor comparison in Djungarian-
# hamster hypothalamus. The authors assembled Trinity contigs, mapped them by
# BLASTx to mouse GRCm39 GeneIDs, and supplied non-normalized RSEM results.
# Fractional expected counts and the documented author projection are retained.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE179663_psun_hypothalamus_torpor")
TAR <- file.path(DS, "raw", "GSE179663_RAW.tar")
SOFT <- file.path(DS, "metadata", "GSE179663_family.soft.gz")
SRC_DIR <- file.path(DS, "raw")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}

pins <- data.frame(
  path = c(TAR, SOFT),
  bytes = c(11397120, 3050),
  sha256 = c(
    "f4fb00cc551f75059b47ebc8748c2e61f779e19838eddc12172809616856dde0",
    "e420e53ac0abdedbdf9f54bde6ad767dcbe8aa84b52882b9672282ec3528ad81"
  ),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE179nnn/GSE179663/suppl/GSE179663_RAW.tar",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE179nnn/GSE179663/soft/GSE179663_family.soft.gz"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(pins$path))) stop("required official GEO RSEM archive or family SOFT is missing")
observed_bytes <- as.numeric(file.info(pins$path)$size)
observed_sha <- unname(vapply(pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, pins$bytes) || !identical(observed_sha, pins$sha256)) {
  stop("source bytes/SHA-256 differ from reviewed inputs")
}

members <- utils::untar(TAR, list = TRUE)
if (length(members) != 12L || any(!grepl("^GSM[0-9]+_.+[.]genes[.]results[.]txt[.]gz$", members))) {
  stop("official RSEM archive member list changed")
}
if (any(!file.exists(file.path(SRC_DIR, members)))) utils::untar(TAR, files = members, exdir = SRC_DIR)
if (any(!file.exists(file.path(SRC_DIR, members)))) stop("could not extract reviewed RSEM files")

samples <- data.frame(
  gsm = c("GSM5425882", "GSM5425883", "GSM5425884", "GSM5425885",
          "GSM5425878", "GSM5425879", "GSM5425880", "GSM5425881"),
  animal = c("SPNT19", "SPNT36", "SPNT37", "SPNT38", "SPHT02", "SPHT10", "SPHT26", "SPHT33"),
  group = rep(c("control", "case"), each = 4L),
  state = rep(c("short-photoperiod normothermia", "short-photoperiod spontaneous daily torpor"), each = 4L),
  stringsAsFactors = FALSE
)
samples$file <- paste0(samples$gsm, "_", samples$animal, ".genes.results.txt.gz")
samples$sample <- samples$animal
if (any(!samples$file %in% members) || any(table(samples$group) != 4L)) stop("reviewed SPNT/SPHT sample selection changed")

soft <- readLines(gzfile(SOFT), warn = FALSE)
design_text <- sub("^!Series_overall_design = ", "", grep("^!Series_overall_design = ", soft, value = TRUE))
processing <- sub("^!Sample_data_processing = ", "", grep("^!Sample_data_processing = ", soft, value = TRUE))
required_processing <- c(
  "Genome_build: GRCm39, Mus musculus and trinity assembled transcripts.",
  "blastx 2.5.0+", "hits_to_genemap.rb", "rsem 1.3.1",
  "Supplementary_files_format_and_content: .genes.results.txt, non-normalized gene expression"
)
if (length(design_text) != 1L ||
    !grepl("spontaneous daily torpor", design_text, fixed = TRUE) ||
    !grepl("torpor-free day", design_text, fixed = TRUE) ||
    !grepl("Zeitgeber-Time 4", design_text, fixed = TRUE) ||
    any(!vapply(required_processing, function(x) any(grepl(x, processing, fixed = TRUE)), logical(1)))) {
  stop("GEO no longer documents the reviewed torpor states or author mouse-GeneID RSEM projection")
}

starts <- grep("^\\^SAMPLE = ", soft)
ends <- c(starts[-1L] - 1L, length(soft))
names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
block <- function(gsm) {
  i <- match(gsm, names(starts))
  if (is.na(i)) stop("GSM absent from SOFT: ", gsm)
  soft[starts[i]:ends[i]]
}
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
samples$biosample <- samples$sra <- samples$sex <- samples$title <- NA_character_
for (i in seq_len(nrow(samples))) {
  b <- block(samples$gsm[i]); rel <- tag(b, "!Sample_relation"); chars <- tag(b, "!Sample_characteristics_ch1")
  title <- tag(b, "!Sample_title")
  expected_phrase <- if (samples$group[i] == "control") "normothermic (NT)" else "hypothermic (HT)"
  if (!grepl(expected_phrase, title, fixed = TRUE) ||
      !"tissue: hypothalamus" %in% chars ||
      !"photoperiod: adapted to short photoperiod (LD 8:16)" %in% chars ||
      !identical(tag(b, "!Sample_library_strategy"), "RNA-Seq")) {
    stop(samples$gsm[i], ": SOFT metadata changed")
  }
  samples$title[i] <- title
  samples$sex[i] <- tolower(sub("^Sex: ", "", grep("^Sex: ", chars, value = TRUE)))
  samples$biosample[i] <- sub(".*biosample/", "", rel[grepl("BioSample:", rel, fixed = TRUE)])
  samples$sra[i] <- sub(".*term=", "", rel[grepl("SRA:", rel, fixed = TRUE)])
}
if (anyDuplicated(samples$biosample) || any(!samples$sex %in% c("female", "male")) ||
    any(vapply(split(samples$sex, samples$group), function(x) length(unique(x)) < 2L, logical(1)))) {
  stop("selected libraries are not independent or sex-adjustable")
}

tables <- lapply(file.path(SRC_DIR, members), function(f) read.delim(gzfile(f), check.names = FALSE, stringsAsFactors = FALSE))
expected_columns <- c("gene_id", "transcript_id(s)", "length", "effective_length", "expected_count", "TPM", "FPKM")
if (any(vapply(tables, nrow, integer(1)) != 17191L) ||
    any(vapply(tables, ncol, integer(1)) != 7L) ||
    any(!vapply(tables, function(x) identical(names(x), expected_columns), logical(1)))) {
  stop("official RSEM file schema/dimensions changed")
}
ids <- as.character(tables[[1L]]$gene_id)
if (anyNA(ids) || any(!grepl("^[0-9]+$", ids)) || anyDuplicated(ids) ||
    !all(vapply(tables[-1L], function(x) identical(as.character(x$gene_id), ids), logical(1)))) {
  stop("author-projected mouse GeneID order changed")
}
selected <- tables[match(samples$file, members)]
M <- do.call(cbind, lapply(selected, function(x) as.numeric(x$expected_count)))
colnames(M) <- samples$sample; rownames(M) <- ids
if (any(!is.finite(M)) || any(M < 0)) stop("RSEM expected counts must be finite and non-negative")
if (sum(M != round(M)) == 0L || any(abs(vapply(selected, function(x) sum(x$TPM), numeric(1)) - 1e6) > 1)) {
  stop("reviewed RSEM expected-count/TPM semantics changed")
}

suppressPackageStartupMessages({library(AnnotationDbi); library(org.Mm.eg.db); library(edgeR)})
mapped <- mapIds(org.Mm.eg.db, keys = ids, keytype = "ENTREZID", column = "SYMBOL", multiVals = "first")
mapping_coverage <- mean(!is.na(mapped))
if (mapping_coverage < 0.95) stop("author mouse-GeneID projection fails the existing mapping-coverage gate")
unmapped <- data.frame(
  GeneID = ids[is.na(mapped)],
  reason = "author mouse GeneID not present in pinned org.Mm.eg.db",
  stringsAsFactors = FALSE
)
write.table(unmapped, file.path(DS, "processed", "GSE179663_unmapped_mouse_geneids.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

out <- data.frame(GeneID = ids, M, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE179663_SPNT_vs_SPHT_RSEM_expected_counts.tsv.gz")
con <- gzfile(out_path, "w")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(as.character(roundtrip$GeneID), ids) ||
    !identical(names(roundtrip)[-1L], samples$sample) ||
    any(abs(as.matrix(roundtrip[-1L]) - M) > 0)) {
  stop("written RSEM count-estimate matrix failed exact round-trip validation")
}

samples$geo_accession <- samples$gsm
samples$tissue <- "whole hypothalamus"
samples$biological_species <- "Phodopus sungorus"
samples$feature_space <- "Mus musculus GRCm39 GeneIDs assigned by the authors after Trinity/BLASTx"
write.table(
  samples[, c("sample", "group", "sex", "geo_accession", "biosample", "sra", "animal", "state",
              "tissue", "biological_species", "feature_space", "file", "title")],
  file.path(DS, "metadata", "GSE179663_samplesheet.tsv"),
  sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"
)

samples$sex <- factor(samples$sex)
samples$group <- factor(samples$group, levels = c("control", "case"))
design <- model.matrix(~ sex + group, data = samples)
if (qr(design)$rank != ncol(design)) stop("sex-adjusted design is not full rank")
y <- DGEList(counts = M)
keep <- filterByExpr(y, design)
y <- calcNormFactors(y[keep, , keep.lib.sizes = FALSE])
if (sum(keep) < 5000L || any(!is.finite(y$samples$norm.factors))) stop("count-level preprocessing QC failed")
qc <- data.frame(
  sample = samples$sample,
  group = samples$group,
  sex = samples$sex,
  source_rows = nrow(M),
  output_rows = nrow(M),
  nonfinite_values = colSums(!is.finite(M)),
  negative_values = colSums(M < 0),
  fractional_values = colSums(M != round(M)),
  library_size = colSums(M),
  detected_features = colSums(M > 0),
  filterByExpr_features = sum(keep),
  tmm_norm_factor = y$samples$norm.factors,
  mapped_mouse_symbols = sum(!is.na(mapped)),
  mouse_symbol_mapping_coverage = mapping_coverage,
  accepted_input_class = "author-supplied RSEM expected counts in mouse GeneID feature space",
  shared_route = "input_kind=counts -> sex-adjusted canonical edgeR-QL in author mouse-ortholog feature space",
  written_exact = TRUE,
  stringsAsFactors = FALSE
)
write.table(qc, file.path(DS, "processed", "GSE179663_preprocessing_qc.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

member_paths <- file.path(SRC_DIR, members)
member_sources <- paste0(
  "https://ftp.ncbi.nlm.nih.gov/geo/samples/",
  sub("^(GSM[0-9]{4}).*", "\\1nnn", members), "/",
  sub("^(GSM[0-9]+).*", "\\1", members), "/suppl/", members
)
manifest <- rbind(
  data.frame(file = basename(pins$path), bytes = observed_bytes, sha256 = observed_sha,
             source = pins$url, fetched = "2026-09-01", stringsAsFactors = FALSE),
  data.frame(file = members, bytes = as.numeric(file.info(member_paths)$size),
             sha256 = unname(vapply(member_paths, sha256_file, character(1))),
             source = member_sources, fetched = "extracted from pinned GSE179663_RAW.tar", stringsAsFactors = FALSE)
)
write.table(manifest, file.path(DS, "metadata", "GSE179663_source_files.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

cat(sprintf(
  "[GSE179663] wrote %d author-projected mouse GeneIDs x %d independent hamsters; SPNT=4, SPHT=4; %d fractional cells preserved; mapping coverage %.2f%%; %d filterByExpr features\n",
  nrow(M), ncol(M), sum(M != round(M)), 100 * mapping_coverage, sum(keep)
))
