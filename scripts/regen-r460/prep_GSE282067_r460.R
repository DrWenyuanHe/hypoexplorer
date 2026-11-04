#!/usr/bin/env Rscript
# R 4.6.0 regeneration variant of geo_replication/scripts/prep_GSE282067.R (sealed original left byte-identical).
# Shared rules: scripts/lib/de_common.R; orchestrated by scripts/regenerate_bulk_de.R.
# =============================================================================
# Assemble a gene-level count matrix for GSE282067 (hypothalamus BL6 Treg arm).
#
# The replicated block of this Series ships one Salmon gene-level quant (.sf) per
# GSM, keyed by RefSeq IDs with a salmon dedup/version suffix (e.g. NM_001037748_8).
# The standardized pipeline (run_dataset.R) only auto-maps ENSEMBL/ENTREZID, so we
# pre-map RefSeq -> SYMBOL here and emit a clean symbol-keyed raw-count matrix that
# the pipeline consumes with id_type=SYMBOL.
#
# Contrast built: hypothalamus, C57BL/6, CD4+CD25+ Tregs, HFD (case) vs SD (control),
# 4 vs 4 independent libraries (the survey-verified, adequately powered stratum).
# The 8 pooled n=1 COUNTS_* libraries (GSM8635143-150) are intentionally excluded.
#
# Usage:  Rscript scripts/regen-r460/prep_GSE282067_r460.R
# =============================================================================
suppressPackageStartupMessages({ library(AnnotationDbi); library(org.Mm.eg.db) })

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value=TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), "..", "..", "geo_replication"))
# Shared rules + HYPO_OUT_ROOT overlay (outputs land in <HYPO_OUT_ROOT>/<dataset dir>/).
source(file.path(ROOT, "..", "scripts", "lib", "de_common.R")); de_init(file.path(ROOT, ".."))
DS   <- file.path(ROOT, "datasets", "GSE282067_mmus_hypothalamus_treg")
TAR  <- file.path(DS, "raw", "GSE282067_RAW.tar")

# GSM -> (tar entry, output sample name, group) for the hypo BL6 Treg SD-vs-HFD stratum
samples <- data.frame(
  gsm   = c("GSM8635178","GSM8635180","GSM8635184","GSM8635186",
            "GSM8635179","GSM8635181","GSM8635182","GSM8635183"),
  entry = c("GSM8635178_24L012443.quant.genes.sf.gz","GSM8635180_24L012445.quant.genes.sf.gz",
            "GSM8635184_24L012449.quant.genes.sf.gz","GSM8635186_24L012451.quant.genes.sf.gz",
            "GSM8635179_24L012444.quant.genes.sf.gz","GSM8635181_24L012446.quant.genes.sf.gz",
            "GSM8635182_24L012447.quant.genes.sf.gz","GSM8635183_24L012448.quant.genes.sf.gz"),
  name  = c("SD_Treg_67_71","SD_Treg_43_47","SD_Treg_11_15","SD_Treg_62_66",
            "HFD_Treg_77_80","HFD_Treg_33_37","HFD_Treg_06_10","HFD_Treg_72_76"),
  group = c("control","control","control","control","case","case","case","case"),
  stringsAsFactors = FALSE)

tmp <- tempfile("sf282067_"); dir.create(tmp)
untar(TAR, files = samples$entry, exdir = tmp)

read_sf <- function(p) {
  d <- read.delim(gzfile(p), stringsAsFactors = FALSE)
  setNames(d$NumReads, d$Name)
}
mats <- lapply(file.path(tmp, samples$entry), read_sf)
genes <- Reduce(intersect, lapply(mats, names))          # identical reference across runs
cat(sprintf("[GSE282067] %d genes common across %d libraries\n", length(genes), length(mats)))
# Salmon NumReads are estimates: kept UNROUNDED (rule B, scripts/lib/de_common.R).
M <- vapply(mats, function(v) as.numeric(v[genes]), numeric(length(genes)))
rownames(M) <- genes; colnames(M) <- samples$name

# RefSeq -> SYMBOL: keep the leading RefSeq accession (N[MR]_<digits>), dropping any
# salmon dedup suffix (e.g. NM_001037748_8 -> NM_001037748; NM_177379 stays intact),
# then map and aggregate by symbol.
base <- sub("^(N[MR]_[0-9]+).*$", "\\1", rownames(M))
sym  <- mapIds(org.Mm.eg.db, keys = base, keytype = "REFSEQ", column = "SYMBOL", multiVals = "first")
mapped <- sum(!is.na(sym)); cat(sprintf("[GSE282067] RefSeq->SYMBOL mapped %d/%d (%.1f%%)\n",
                                          mapped, length(sym), 100*mapped/length(sym)))
key <- ifelse(is.na(sym), base, unname(sym))             # keep unmapped under their RefSeq base
agg <- rowsum(M, group = key)                            # sum counts per gene symbol
agg <- agg[order(rownames(agg)), , drop = FALSE]

out <- data.frame(symbol = rownames(agg), agg, check.names = FALSE, stringsAsFactors = FALSE)
outp <- overlay_output_path(file.path(DS, "raw", "GSE282067_hypo_BL6_Treg_counts.tsv.gz"))
write_table_lf(out, outp)
cat(sprintf("[GSE282067] wrote %s  (%d genes x %d samples)\n", basename(outp), nrow(out), ncol(agg)))
# sanity: IGF panel presence
panel <- c("Igfbp2","Igfbp5","Igfbp6","Igfbp7","Igf1r","Irs2")
cat("[GSE282067] panel genes present: ", paste(panel[panel %in% rownames(agg)], collapse=", "), "\n")
unlink(tmp, recursive = TRUE)
