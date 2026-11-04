#!/usr/bin/env Rscript
# R 4.6.0 regeneration variant of geo_replication/scripts/prep_2026batch2.R (sealed original left byte-identical).
# Shared rules: scripts/lib/de_common.R; orchestrated by scripts/regenerate_bulk_de.R.
# Prep for the 2026 batch-2 datasets: subset the chosen case/control columns
# and drop featureCounts annotation columns, writing a clean genes x samples
# count matrix per dataset that run_dataset.R consumes unchanged.
# Estimated/fractional counts are kept UNROUNDED (rule B, scripts/lib/de_common.R):
# edgeR's quasi-likelihood pipeline accepts non-integer counts.
# Provenance-as-code (raw files are gitignored).
#   Rscript scripts/regen-r460/prep_2026batch2_r460.R [GSE235479 E-MTAB-6929 GSE167264]
#   HYPO_OUT_ROOT=<dir> writes the prepared matrices under <dir>/<dataset dir>/raw/
get_dir <- function() { a<-commandArgs(FALSE); f<-grep("^--file=",a,value=TRUE)
  if(length(f)) dirname(normalizePath(sub("^--file=","",f[1]))) else getwd() }
ROOT <- normalizePath(file.path(get_dir(), "..", "..", "geo_replication"))
source(file.path(ROOT, "..", "scripts", "lib", "de_common.R")); de_init(file.path(ROOT, ".."))
want <- commandArgs(trailingOnly = TRUE)
run_it <- function(id) !length(want) || id %in% want
out_path <- function(d, file) overlay_output_path(file.path(d, "raw", file))
wgz <- function(df, path) { write_table_lf(df, path)
  cat(sprintf("  wrote %s (%d genes x %d samples)\n", basename(path), nrow(df), ncol(df)-1)) }

# ---- GSE235479: NZO/HlLtJ hypothalamus, 44%HFHS vs 10% control; sex blocked ----
if (run_it("GSE235479")) {
  d <- file.path(ROOT, "datasets/GSE235479_mmus_hypothalamus_nzo_hfhs")
  df <- read.csv(gzfile(file.path(d, "raw/GSE235479_counts_matrix.csv.gz")), check.names=FALSE)
  ctrl <- c("ORSAM9430","ORSAM9431","ORSAM9432","ORSAM9433","ORSAM9444","ORSAM9445")
  case <- c("ORSAM9434","ORSAM9435","ORSAM9436","ORSAM9454","ORSAM9455","ORSAM9456")
  m <- as.matrix(df[, c(ctrl, case)])                 # unrounded estimates (rule B)
  out <- data.frame(Gene_ID = df$Gene_ID, m, check.names=FALSE)
  cat("[GSE235479]\n"); wgz(out, out_path(d, "GSE235479_counts_clean.tsv.gz"))
}

# ---- E-MTAB-6929: whole hypothalamus, HFD vs LFD (featureCounts, fractional) ----
if (run_it("E-MTAB-6929")) {
  d <- file.path(ROOT, "datasets/EMTAB6929_mmus_hypothalamus_hfd")
  df <- read.delim(file.path(d, "raw/Final_Counts.txt"), check.names=FALSE)
  ctrl <- c("2","9","12","13","14","24","25","31")   # LFD (lean)
  case <- c("11","15","17","20","22","29","30","32")  # HFD (obese)
  m <- as.matrix(df[, c(ctrl, case)])                 # unrounded fractional counts (rule B)
  colnames(m) <- c(paste0("LFD_", ctrl), paste0("HFD_", case))
  out <- data.frame(Geneid = df$Geneid, m, check.names=FALSE)
  cat("[E-MTAB-6929]\n"); wgz(out, out_path(d, "EMTAB6929_counts_clean.tsv.gz"))
}

# ---- GSE167264: hypothalamus ND ob/ob vs WT (featureCounts; skip comment line) -
if (run_it("GSE167264")) {
  d <- file.path(ROOT, "datasets/GSE167264_mmus_hypothalamus_obob")
  df <- read.delim(gzfile(file.path(d, "raw/GSE167264_counts.txt.gz")), skip=1, check.names=FALSE, quote="")
  ctrl <- c("WT_ND_1_Hy_S13.bam","WT_ND_2_Hy_S14.bam","WT_ND_3_Hy_S15.bam")
  case <- c("ob_ob_ND_1_Hy_S19.bam","ob_ob_ND_2_Hy_S20.bam","ob_ob_ND_3_Hy_S21.bam")
  stopifnot(all(c(ctrl, case) %in% colnames(df)))
  m <- as.matrix(df[, c(ctrl, case)])
  colnames(m) <- sub("\\.bam$", "", colnames(m))
  out <- data.frame(Geneid = df$Geneid, m, check.names=FALSE)
  cat("[GSE167264]\n"); wgz(out, out_path(d, "GSE167264_counts_clean.tsv.gz"))
}
cat("prep_2026batch2 done.\n")
