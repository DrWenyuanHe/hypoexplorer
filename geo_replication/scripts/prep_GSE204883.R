#!/usr/bin/env Rscript
# Prepare GSE204883's maternally programmed photoperiod contrast in laser-
# captured hypothalamic ependymal/tanycyte tissue. The authors mapped hamster
# reads to a Siberian-hamster assembly annotated by Liftoff from mouse GRCm39;
# their deposited mouse Ensembl gene IDs are used without an inferred remap.

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE204883_psun_tanycyte_photoperiod")
TAR <- file.path(DS, "raw", "GSE204883_RAW.tar")
GTF <- file.path(DS, "raw", "GSE204883_sib-ham-liftoff-annotation.gtf.gz")
SOFT <- file.path(DS, "metadata", "GSE204883_family.soft.gz")
SRC_DIR <- file.path(DS, "raw", "source_files")

sha256_file <- function(path) {
  z <- system2("certutil", c("-hashfile", shQuote(normalizePath(path)), "SHA256"), stdout = TRUE, stderr = TRUE)
  z <- trimws(z); z <- z[grepl("^[[:xdigit:]]{64}$", z)]
  if (length(z) != 1L) stop("could not calculate SHA-256 for ", path)
  tolower(z)
}
pins <- data.frame(
  path = c(TAR, GTF, SOFT), bytes = c(2355200, 9036331, 4419),
  sha256 = c("f6ddf52d22ce7e28d8d39c45606a6922981e125f2d3790f0fc584e188643c5fb",
             "7708647273a50446609df5abd9e67e8f4f3f1d8b46d9b74db1848313b2b3cab4",
             "4d57020639d134e07c1b733d2b998fd30a41bfcb55d34ba274eec615c9052e91"),
  url = c(
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE204nnn/GSE204883/suppl/GSE204883_RAW.tar",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE204nnn/GSE204883/suppl/GSE204883_sib-ham-liftoff-annotation.gtf.gz",
    "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE204nnn/GSE204883/soft/GSE204883_family.soft.gz"
  ), stringsAsFactors = FALSE
)
if (any(!file.exists(pins$path))) stop("required official GEO source, Liftoff GTF, or family SOFT is missing")
observed_bytes <- as.numeric(file.info(pins$path)$size)
observed_sha <- unname(vapply(pins$path, sha256_file, character(1)))
if (!identical(observed_bytes, pins$bytes) || !identical(observed_sha, pins$sha256)) stop("source bytes/SHA-256 differ from reviewed inputs")

members <- utils::untar(TAR, list = TRUE)
if (length(members) != 21L || any(!grepl("^GSM[0-9]+_.+-counts-gene-simple[.]txt[.]gz$", members))) stop("official RAW archive member list changed")
dir.create(SRC_DIR, recursive = TRUE, showWarnings = FALSE)
if (any(!file.exists(file.path(SRC_DIR, members)))) utils::untar(TAR, files = members, exdir = SRC_DIR)
if (any(!file.exists(file.path(SRC_DIR, members)))) stop("could not extract reviewed RAW archive members")

samples <- data.frame(
  gsm = c(paste0("GSM61992", 58:62), paste0("GSM61992", 68:72)),
  animal = c("LP-IP10", "LP-IP21", "LP-IP28", "LP-IP29", "LP-IP9",
             "SP-IP10", "SP-IP11", "SP-IP12", "SP-IP19", "SP-IP23"),
  group = rep(c("control", "case"), each = 5L),
  maternal_photoperiod = rep(c("long", "short"), each = 5L),
  postweaning_photoperiod = "intermediate", stringsAsFactors = FALSE
)
samples$file <- paste0(samples$gsm, "_", samples$animal, "-PE-counts-gene-simple.txt.gz")
samples$sample <- sub("-", "", samples$animal)
if (any(!samples$file %in% members) || any(table(samples$group) < 3L)) stop("reviewed LPIP/SPIP sample selection changed")

soft <- readLines(gzfile(SOFT), warn = FALSE)
design_text <- sub("^!Series_overall_design = ", "", grep("^!Series_overall_design = ", soft, value = TRUE))
processing <- sub("^!Sample_data_processing = ", "", grep("^!Sample_data_processing = ", soft, value = TRUE))
if (length(design_text) != 1L || !grepl("assigned to the same intermediate photoperiod", design_text, fixed = TRUE) ||
    !any(grepl("liftoff -g Mus_musculus.GRCm39.104.gff3", processing, fixed = TRUE)) ||
    !any(grepl("mouse ensembl Ids from the liftoff annotation", processing, fixed = TRUE))) {
  stop("GEO no longer documents the reviewed maternal-history contrast or mouse-Liftoff count space")
}
starts <- grep("^\\^SAMPLE = ", soft); ends <- c(starts[-1L] - 1L, length(soft)); names(starts) <- sub("^\\^SAMPLE = ", "", soft[starts])
block <- function(gsm) { i <- match(gsm, names(starts)); if (is.na(i)) stop("GSM absent from SOFT: ", gsm); soft[starts[i]:ends[i]] }
tag <- function(x, key) sub(paste0("^", key, " = "), "", grep(paste0("^", key, " = "), x, value = TRUE))
samples$biosample <- samples$sra <- samples$title <- NA_character_
for (i in seq_len(nrow(samples))) {
  b <- block(samples$gsm[i]); rel <- tag(b, "!Sample_relation"); chars <- tag(b, "!Sample_characteristics_ch1")
  expected_treatment <- if (samples$group[i] == "control") "gestated on long photoperiod transfered to intermediate photoperiod" else "gestated on short photoperiod transfered to intermediate photoperiod"
  if (!paste0("treatment: ", expected_treatment) %in% chars || !identical(tag(b, "!Sample_library_strategy"), "RNA-Seq")) stop(samples$gsm[i], ": SOFT metadata changed")
  samples$title[i] <- tag(b, "!Sample_title")
  samples$biosample[i] <- sub(".*biosample/", "", rel[grepl("BioSample:", rel, fixed = TRUE)])
  samples$sra[i] <- sub(".*term=", "", rel[grepl("SRA:", rel, fixed = TRUE)])
}
if (anyDuplicated(samples$biosample)) stop("selected libraries are not independent BioSamples")

tables <- lapply(file.path(SRC_DIR, samples$file), function(f) read.delim(gzfile(f), check.names = FALSE, stringsAsFactors = FALSE))
if (any(vapply(tables, nrow, integer(1)) != 21882L) || any(vapply(tables, ncol, integer(1)) != 2L)) stop("official count-file dimensions changed")
ids <- as.character(tables[[1L]][[1L]])
if (anyNA(ids) || any(!nzchar(ids)) || anyDuplicated(ids) ||
    !all(vapply(tables[-1L], function(x) identical(as.character(x[[1L]]), ids), logical(1)))) stop("count-file feature order/identity changed")
M0 <- do.call(cbind, lapply(tables, function(x) as.numeric(x[[2L]])))
colnames(M0) <- samples$sample
if (any(!is.finite(M0)) || any(M0 < 0) || any(M0 != round(M0))) stop("reviewed featureCounts integer semantics no longer hold")

gtf <- readLines(gzfile(GTF), warn = FALSE)
gtf_ids <- sub('.*gene_id "([^"]+)".*', "\\1", gtf[grepl('gene_id "', gtf, fixed = TRUE)])
if (length(unique(gtf_ids)) != 21882L || any(!ids %in% gtf_ids)) stop("count IDs no longer match the author-supplied Liftoff GTF")
valid <- grepl("^ENSMUSG[0-9]+([.][0-9]+)?$", ids)
if (sum(valid) != 21852L || sum(!valid) != 30L || any(!grepl("^transcript:ENSMUST", ids[!valid]))) stop("reviewed gene/transcript identifier split changed")
M <- M0[valid, , drop = FALSE]; rownames(M) <- ids[valid]
quarantine <- data.frame(feature_id = ids[!valid], reason = "transcript identifier emitted in gene_id field", M0[!valid, , drop = FALSE], check.names = FALSE)
write.table(quarantine, file.path(DS, "processed", "GSE204883_quarantined_transcript_ids.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

suppressPackageStartupMessages({library(AnnotationDbi); library(org.Mm.eg.db); library(edgeR)})
mapped <- mapIds(org.Mm.eg.db, keys = rownames(M), keytype = "ENSEMBL", column = "SYMBOL", multiVals = "first")
mapping_coverage <- mean(!is.na(mapped))
if (mapping_coverage < 0.80) stop("author mouse-Ensembl projection fails the existing mapping-coverage gate")
out <- data.frame(Geneid = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
out_path <- file.path(DS, "raw", "GSE204883_LPIP_vs_SPIP_mouse_liftoff_counts.tsv.gz")
con <- gzfile(out_path, "w"); write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n"); close(con)
roundtrip <- read.delim(gzfile(out_path), check.names = FALSE, stringsAsFactors = FALSE)
if (!identical(roundtrip$Geneid, rownames(M)) || !identical(names(roundtrip)[-1L], samples$sample) || any(as.matrix(roundtrip[-1L]) != M)) stop("written count matrix failed exact round-trip validation")

samples$geo_accession <- samples$gsm; samples$tissue <- "laser-captured hypothalamic ependymal zone / tanycytes"
samples$biological_species <- "Phodopus sungorus"
samples$feature_space <- "Mus musculus GRCm39 Ensembl IDs lifted onto the Siberian-hamster assembly by the authors"
write.table(samples[, c("sample", "group", "geo_accession", "biosample", "sra", "animal", "maternal_photoperiod", "postweaning_photoperiod", "tissue", "biological_species", "feature_space", "file", "title")],
            file.path(DS, "metadata", "GSE204883_samplesheet.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")

design <- model.matrix(~ factor(group, levels = c("control", "case")), data = samples)
y <- DGEList(counts = M); keep <- filterByExpr(y, design); y <- calcNormFactors(y[keep, , keep.lib.sizes = FALSE])
if (sum(keep) < 5000L || any(!is.finite(y$samples$norm.factors))) stop("count-level preprocessing QC failed")
qc <- data.frame(
  sample = samples$sample, group = samples$group, source_rows = nrow(M0), output_rows = nrow(M),
  quarantined_transcript_rows = sum(!valid), quarantined_counts = colSums(M0[!valid, , drop = FALSE]),
  quarantined_fraction = colSums(M0[!valid, , drop = FALSE]) / colSums(M0),
  nonfinite_values = colSums(!is.finite(M)), negative_values = colSums(M < 0), fractional_values = colSums(M != round(M)),
  library_size = colSums(M), detected_features = colSums(M > 0), filterByExpr_features = sum(keep),
  tmm_norm_factor = y$samples$norm.factors, mapped_mouse_symbols = sum(!is.na(mapped)), mouse_symbol_mapping_coverage = mapping_coverage,
  accepted_input_class = "author-supplied GRCm39-Liftoff mouse-Ensembl featureCounts",
  shared_route = "input_kind=counts -> canonical edgeR-QL in author mouse-ortholog feature space", written_exact = TRUE,
  stringsAsFactors = FALSE
)
write.table(qc, file.path(DS, "processed", "GSE204883_preprocessing_qc.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
manifest <- data.frame(file = basename(pins$path), bytes = observed_bytes, sha256 = observed_sha, source = pins$url, fetched = "2026-09-01", stringsAsFactors = FALSE)
write.table(manifest, file.path(DS, "metadata", "GSE204883_source_files.tsv"), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
cat(sprintf("[GSE204883] wrote %d mouse-Ensembl genes x %d independent hamster samples; LPIP=5, SPIP=5; quarantined 30 transcript IDs; mapping coverage %.1f%%; %d filterByExpr features\n",
            nrow(M), ncol(M), 100 * mapping_coverage, sum(keep)))
