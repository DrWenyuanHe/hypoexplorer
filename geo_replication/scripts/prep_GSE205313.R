#!/usr/bin/env Rscript
# =============================================================================
# Assemble a gene-level count matrix for GSE205313 (hypothalamic ACSA-2+ astrocytes).
#
# This Series ships one *transcript-level* Salmon quant (.sf) per GSM inside
# GSE205313_RAW.tar, keyed by versioned Ensembl transcript IDs (ENSMUST...N).
# org.Mm.eg.db's ENSEMBLTRANS keytype only covers 18% of them (21% of reads), so we
# build the tx2gene map straight from the matching Ensembl annotation instead
# (GRCm38 release 102: 140762/140948 exact versioned matches, 140890 versionless),
# sum NumReads per gene symbol (the tximport gene-level counts convention), round,
# and emit a symbol-keyed raw-count matrix the pipeline consumes with id_type=SYMBOL.
#
# Contrast built: hypothalamus only, C57BL/6JRj males, ACSA-2+ MACS-sorted astrocytes,
# 4-month high-fat high-sugar (case) vs standard chow (control), 5 vs 6 libraries.
# The hippocampus (GSM6210151-162) and cortex (GSM6210163-174) arms of the same
# Series are intentionally excluded — one tissue, one 1x1 contrast.
# NOTE: each library is an independent pool of 2 animals (Series overall_design);
# the pools are the independent replicate units, no pool is split across libraries.
#
# The 66 MB GSE205313_RAW.tar is deleted after assembly; re-fetch it with
#   curl -o datasets/GSE205313_mmus_hypo_astrocyte_hfhs/raw/GSE205313_RAW.tar \
#     https://ftp.ncbi.nlm.nih.gov/geo/series/GSE205nnn/GSE205313/suppl/GSE205313_RAW.tar
#
# Usage:  Rscript scripts/prep_GSE205313.R
# =============================================================================

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value=TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS   <- file.path(ROOT, "datasets", "GSE205313_mmus_hypo_astrocyte_hfhs")
TAR  <- file.path(DS, "raw", "GSE205313_RAW.tar")

GTF_URL <- "https://ftp.ensembl.org/pub/release-102/gtf/mus_musculus/Mus_musculus.GRCm38.102.gtf.gz"

# GSM -> (tar entry, output sample name, group); groups read off !Sample_characteristics_ch1
# "diet:" and !Sample_source_name_ch1 "Brain, hypothalamus" in the series matrix.
samples <- data.frame(
  gsm   = c("GSM6210140","GSM6210141","GSM6210142","GSM6210143","GSM6210144","GSM6210145",
            "GSM6210146","GSM6210147","GSM6210148","GSM6210149","GSM6210150"),
  entry = c("GSM6210140_R_1.sf.gz","GSM6210141_R_2.sf.gz","GSM6210142_R_3.sf.gz",
            "GSM6210143_R_4.sf.gz","GSM6210144_R_5.sf.gz","GSM6210145_R_6.sf.gz",
            "GSM6210146_R_7.sf.gz","GSM6210147_R_8.sf.gz","GSM6210148_R_9.sf.gz",
            "GSM6210149_R_11.sf.gz","GSM6210150_R_12.sf.gz"),
  name  = c("HPT_SCdiet_1","HPT_SCdiet_2","HPT_SCdiet_3","HPT_SCdiet_4","HPT_SCdiet_5","HPT_SCdiet_6",
            "HPT_HFHSdiet_1","HPT_HFHSdiet_2","HPT_HFHSdiet_3","HPT_HFHSdiet_4","HPT_HFHSdiet_5"),
  group = c(rep("control", 6), rep("case", 5)),
  stringsAsFactors = FALSE)

# ---- tx2gene from Ensembl GTF ---------------------------------------------
gtf <- file.path(tempdir(), basename(GTF_URL))
if (!file.exists(gtf)) {
  cat("[GSE205313] fetching", basename(GTF_URL), "...\n")
  download.file(GTF_URL, gtf, mode = "wb", quiet = TRUE)
}
L  <- readLines(gzfile(gtf))
L  <- L[!startsWith(L, "#")]
f3 <- vapply(strsplit(L, "\t", fixed = TRUE), `[`, character(1), 3L)
att <- vapply(strsplit(L[f3 == "transcript"], "\t", fixed = TRUE), `[`, character(1), 9L)
grab <- function(x, key) {
  p <- paste0(key, ' "([^"]*)"')
  m <- regmatches(x, regexpr(p, x))
  out <- rep(NA_character_, length(x))
  hit <- vapply(regexpr(p, x), function(i) i > 0, logical(1))
  out[hit] <- sub(p, "\\1", m)
  out
}
t2g <- data.frame(tx  = grab(att, "transcript_id"),
                  gid = grab(att, "gene_id"),
                  sym = grab(att, "gene_name"), stringsAsFactors = FALSE)
t2g$sym <- ifelse(is.na(t2g$sym) | t2g$sym == "", t2g$gid, t2g$sym)
t2g <- t2g[!duplicated(t2g$tx), ]
cat(sprintf("[GSE205313] tx2gene: %d transcripts -> %d genes\n", nrow(t2g), length(unique(t2g$sym))))

# ---- read the 11 hypothalamic Salmon quants -------------------------------
tmp <- tempfile("sf205313_"); dir.create(tmp)
untar(TAR, files = samples$entry, exdir = tmp)

read_sf <- function(p) {
  d <- read.delim(gzfile(p), stringsAsFactors = FALSE)
  setNames(d$NumReads, vapply(strsplit(d$Name, ".", fixed = TRUE), `[`, character(1), 1L))
}
mats  <- lapply(file.path(tmp, samples$entry), read_sf)
txs   <- Reduce(intersect, lapply(mats, names))     # identical Salmon index across runs
cat(sprintf("[GSE205313] %d transcripts common across %d libraries\n", length(txs), length(mats)))
M <- vapply(mats, function(v) as.numeric(v[txs]), numeric(length(txs)))
rownames(M) <- txs; colnames(M) <- samples$name

sym <- t2g$sym[match(txs, t2g$tx)]
cat(sprintf("[GSE205313] tx->SYMBOL mapped %d/%d (%.2f%%), covering %.2f%% of reads\n",
            sum(!is.na(sym)), length(sym), 100*mean(!is.na(sym)),
            100*sum(M[!is.na(sym), ]) / sum(M)))
key <- ifelse(is.na(sym), txs, sym)                 # keep unmapped under their transcript id
agg <- round(rowsum(M, group = key))                # sum transcript NumReads per gene, then round
agg <- agg[order(rownames(agg)), , drop = FALSE]
storage.mode(agg) <- "integer"

out  <- data.frame(symbol = rownames(agg), agg, check.names = FALSE, stringsAsFactors = FALSE)
outp <- file.path(DS, "raw", "GSE205313_hypo_astrocyte_counts.tsv.gz")
gz <- gzfile(outp, "w"); write.table(out, gz, sep = "\t", quote = FALSE, row.names = FALSE); close(gz)
cat(sprintf("[GSE205313] wrote %s  (%d genes x %d samples)\n", basename(outp), nrow(out), ncol(agg)))
cat("[GSE205313] library sizes:\n"); print(colSums(agg))

# sanity: IGF panel presence
panel <- c("Igfbp2","Igfbp5","Igfbp6","Igfbp7","Igf1r","Irs2","Igf1")
cat("[GSE205313] panel genes present: ", paste(panel[panel %in% rownames(agg)], collapse = ", "), "\n")
unlink(tmp, recursive = TRUE)
