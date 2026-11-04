#!/usr/bin/env Rscript
# =============================================================================
# Assemble a gene-level count matrix for GSE245727 (hypothalamus, GLP-1 arm).
#
# Petersen et al., Nature 2024 (PMID 38750368) — "GLP-1-directed NMDA receptor
# antagonism for obesity treatment". This Series ships one featureCounts table
# per GSM inside GSE245727_RAW.tar (gencode vM25 / mm10, -t exon -g gene_id), so
# every library carries the same 55401-row ENSMUSG index; column 7 of each table
# is the raw integer count.
#
# Contrast built: hypothalamus, GLP-1 mono-agonist (case) vs vehicle (control),
# 6 vs 6. The Series has four arms (vehicle / GLP-1 / GLP-1+MK-801 co-admin /
# conjugate 2); the two MK-801-containing arms are intentionally excluded so the
# contrast is single-mechanism GLP-1 receptor agonism against its own vehicle.
#
# The 86 MB RAW.tar is NOT kept in the repo: it is downloaded to a tempdir, only
# the 12 needed members are extracted, and the tar is deleted on exit.
#
# Usage:  Rscript scripts/prep_GSE245727.R
# =============================================================================
suppressPackageStartupMessages({ library(AnnotationDbi); library(org.Mm.eg.db) })

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value=TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS   <- file.path(ROOT, "datasets", "GSE245727_mmus_hypothalamus_glp1_mk801")
URL  <- "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE245nnn/GSE245727/suppl/GSE245727_RAW.tar"

# GSM -> (tar entry, output sample name, group).
# Arms read off the series matrix !Sample_title / !Sample_characteristics_ch1
# "treatment:" line, positionally matched to !Sample_geo_accession.
samples <- data.frame(
  gsm   = c("GSM7847383","GSM7847389","GSM7847391","GSM7847393","GSM7847394","GSM7847398",
            "GSM7847385","GSM7847386","GSM7847387","GSM7847388","GSM7847397","GSM7847399"),
  idx   = c(7, 13, 15, 17, 18, 22,   9, 10, 11, 12, 21, 23),   # the 0149_<idx>_S<idx> run id
  name  = c("Vehicle_rep1","Vehicle_rep2","Vehicle_rep3","Vehicle_rep4","Vehicle_rep5","Vehicle_rep6",
            "GLP1_rep1","GLP1_rep2","GLP1_rep3","GLP1_rep4","GLP1_rep5","GLP1_rep6"),
  group = c(rep("control", 6), rep("case", 6)),
  stringsAsFactors = FALSE)
samples$entry <- sprintf("%s_0149_%d_S%d_Aligned.sortedByCoord.out.bam_featureCounts.txt.gz",
                         samples$gsm, samples$idx, samples$idx)

tmp <- tempfile("fc245727_"); dir.create(tmp)
on.exit(unlink(tmp, recursive = TRUE), add = TRUE)
TAR <- file.path(DS, "raw", "GSE245727_RAW.tar")
if (!file.exists(TAR)) {                      # not tracked: fetch to the tempdir
  TAR <- file.path(tmp, "GSE245727_RAW.tar")
  cat("[GSE245727] downloading RAW.tar (86 MB) ...\n")
  utils::download.file(URL, TAR, mode = "wb", quiet = TRUE)
}
untar(TAR, files = samples$entry, exdir = tmp)

# featureCounts: 1-line '# Program:' banner, then Geneid Chr Start End Strand Length <bam>
read_fc <- function(p) {
  d <- read.delim(gzfile(p), skip = 1, check.names = FALSE, stringsAsFactors = FALSE)
  setNames(d[[ncol(d)]], d$Geneid)
}
mats  <- lapply(file.path(tmp, samples$entry), read_fc)
genes <- Reduce(intersect, lapply(mats, names))     # identical gencode vM25 index across runs
cat(sprintf("[GSE245727] %d genes common across %d libraries\n", length(genes), length(mats)))

M <- vapply(mats, function(v) as.numeric(v[genes]), numeric(length(genes)))
rownames(M) <- genes; colnames(M) <- samples$name
stopifnot(all(is.finite(M)), all(M == round(M)))    # hard requirement: raw integer counts
cat(sprintf("[GSE245727] integer check OK; library sizes %s\n",
            paste(sprintf("%s=%.1fM", colnames(M), colSums(M)/1e6), collapse=" ")))

# gencode ids carry a version suffix (ENSMUSG00000102693.1) -> strip to bare ENSMUSG
base <- sub("[.].*$", "", rownames(M))
stopifnot(!any(duplicated(base)))
rownames(M) <- base
M <- M[order(rownames(M)), , drop = FALSE]

out  <- data.frame(gene_id = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
outp <- file.path(DS, "raw", "GSE245727_hypo_counts.tsv.gz")
gz <- gzfile(outp, "w"); write.table(out, gz, sep = "\t", quote = FALSE, row.names = FALSE); close(gz)
cat(sprintf("[GSE245727] wrote %s  (%d genes x %d samples)\n", basename(outp), nrow(out), ncol(M)))

ssp <- file.path(DS, "metadata", "GSE245727_samplesheet.tsv")
write.table(samples[, c("name","group")], ssp, sep = "\t", quote = FALSE,
            row.names = FALSE, col.names = c("sample","group"))
cat(sprintf("[GSE245727] wrote %s\n", basename(ssp)))

# sanity: IGF panel presence (symbol -> ENSEMBL, checked against the matrix index)
panel <- c("Igfbp2","Igfbp5","Igfbp7","Igf1r","Irs2")
ens <- mapIds(org.Mm.eg.db, keys = panel, keytype = "SYMBOL", column = "ENSEMBL", multiVals = "first")
hit <- panel[!is.na(ens) & ens %in% rownames(M)]
cat("[GSE245727] panel genes present: ", paste(sprintf("%s(%s)", hit, ens[hit]), collapse=", "), "\n")
