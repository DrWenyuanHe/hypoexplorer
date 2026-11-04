#!/usr/bin/env Rscript
# =============================================================================
# Assemble a gene-level count matrix for GSE254155 (whole hypothalamus, fed vs fasted).
#
# The Series ships one featureCounts (Subread v2.0.1, gencode vM12, -g gene_name)
# table per GSM inside GSE254155_RAW.tar. Each file carries a '#Program:...' banner
# line, then Geneid/Chr/Start/End/Strand/Length and a single count column whose header
# is the submitter's local BAM path (e.g. /Users/.../P121.bam) — NOT the GSM. Column
# names therefore come from the GEO !Sample_title, matched to the tar member by GSM.
#
# Contrast built: hypothalamus, male B6/J, genotype "Control" (wild type), ZT16,
# 16-hour fast (case) vs ad libitum fed (control), 10 vs 10 independent mice.
# The Per2-ko (n=5) and PER2-S662D (n=5+5) genotype arms are intentionally excluded,
# so genotype, sex, strain, tissue and circadian timepoint are all held constant.
#
# Usage:  Rscript scripts/prep_GSE254155.R
# =============================================================================
get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value=TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS   <- file.path(ROOT, "datasets", "GSE254155_mmus_hypothalamus_fedfast")
TAR  <- file.path(DS, "raw", "GSE254155_RAW.tar")
URL  <- "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE254nnn/GSE254155/suppl/GSE254155_RAW.tar"

# GSM -> (tar entry, sample name = GEO !Sample_title, group) for the Control-genotype stratum
gsm  <- sprintf("GSM80351%02d", 14:33)
name <- c(paste0("Ctrl.AL.",   1:10), paste0("Ctrl.Fast.", 1:10))
samples <- data.frame(
  gsm   = gsm,
  entry = paste0(gsm, "_", name, ".txt.gz"),
  name  = name,
  group = rep(c("control", "case"), each = 10),
  treatment = rep(c("AdLibitumFed", "Fast16h"), each = 10),
  stringsAsFactors = FALSE)

tmp <- tempfile("fc254155_"); dir.create(tmp)
tarpath <- TAR
if (!file.exists(tarpath)) {                     # 120 MB; not kept in the repo
  tarpath <- file.path(tmp, "GSE254155_RAW.tar")
  cat("[GSE254155] downloading RAW.tar ...\n")
  download.file(URL, tarpath, mode = "wb", quiet = TRUE)
}
untar(tarpath, files = samples$entry, exdir = tmp)

# featureCounts table: 1 banner line, then Geneid + 5 annotation cols + 1 count col
read_fc <- function(p) {
  d <- read.delim(gzfile(p), skip = 1, check.names = FALSE, stringsAsFactors = FALSE)
  setNames(d[[ncol(d)]], d$Geneid)
}
mats  <- lapply(file.path(tmp, samples$entry), read_fc)
genes <- Reduce(intersect, lapply(mats, names))          # identical annotation across runs
cat(sprintf("[GSE254155] %d genes common across %d libraries\n", length(genes), length(mats)))
M <- vapply(mats, function(v) as.numeric(v[genes]), numeric(length(genes)))
rownames(M) <- genes; colnames(M) <- samples$name
stopifnot(all(M == round(M)), !any(is.na(M)))            # raw integer counts
M <- M[order(rownames(M)), , drop = FALSE]

out  <- data.frame(symbol = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
outp <- file.path(DS, "raw", "GSE254155_hypo_ctrl_fedfast_counts.tsv.gz")
gz <- gzfile(outp, "w"); write.table(out, gz, sep = "\t", quote = FALSE, row.names = FALSE); close(gz)
cat(sprintf("[GSE254155] wrote %s  (%d genes x %d samples)\n", basename(outp), nrow(out), ncol(M)))
cat(sprintf("[GSE254155] library sizes: %s\n", paste(sprintf("%s=%.1fM", colnames(M), colSums(M)/1e6), collapse=" ")))

panel <- c("Igfbp2","Igfbp5","Igfbp6","Igfbp7","Igf1r","Irs2","Igf1")
cat("[GSE254155] panel genes present: ", paste(panel[panel %in% rownames(M)], collapse=", "), "\n")
unlink(tmp, recursive = TRUE)
