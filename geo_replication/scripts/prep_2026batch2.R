#!/usr/bin/env Rscript
# Prep for the 2026 batch-2 datasets: subset the chosen case/control columns,
# round estimated/fractional counts to integers, and drop featureCounts annotation
# columns, writing a clean genes x samples count matrix per dataset that
# run_dataset.R consumes unchanged. Provenance-as-code (raw files are gitignored).
#   Rscript scripts/prep_2026batch2.R
get_dir <- function() { a<-commandArgs(FALSE); f<-grep("^--file=",a,value=TRUE)
  if(length(f)) dirname(normalizePath(sub("^--file=","",f[1]))) else getwd() }
ROOT <- normalizePath(file.path(get_dir(), ".."))
wgz <- function(df, path) { gz<-gzfile(path,"w"); write.table(df, gz, sep="\t", quote=FALSE, row.names=FALSE); close(gz)
  cat(sprintf("  wrote %s (%d genes x %d samples)\n", basename(path), nrow(df), ncol(df)-1)) }

# ---- GSE235479: NZO/HlLtJ hypothalamus, 44%HFHS vs 10% control; sex blocked ----
{
  d <- file.path(ROOT, "datasets/GSE235479_mmus_hypothalamus_nzo_hfhs")
  df <- read.csv(gzfile(file.path(d, "raw/GSE235479_counts_matrix.csv.gz")), check.names=FALSE)
  ctrl <- c("ORSAM9430","ORSAM9431","ORSAM9432","ORSAM9433","ORSAM9444","ORSAM9445")
  case <- c("ORSAM9434","ORSAM9435","ORSAM9436","ORSAM9454","ORSAM9455","ORSAM9456")
  m <- round(as.matrix(df[, c(ctrl, case)]))
  out <- data.frame(Gene_ID = df$Gene_ID, m, check.names=FALSE)
  cat("[GSE235479]\n"); wgz(out, file.path(d, "raw/GSE235479_counts_clean.tsv.gz"))
}

# ---- E-MTAB-6929: whole hypothalamus, HFD vs LFD (featureCounts, fractional) ----
{
  d <- file.path(ROOT, "datasets/EMTAB6929_mmus_hypothalamus_hfd")
  df <- read.delim(file.path(d, "raw/Final_Counts.txt"), check.names=FALSE)
  ctrl <- c("2","9","12","13","14","24","25","31")   # LFD (lean)
  case <- c("11","15","17","20","22","29","30","32")  # HFD (obese)
  m <- round(as.matrix(df[, c(ctrl, case)]))
  colnames(m) <- c(paste0("LFD_", ctrl), paste0("HFD_", case))
  out <- data.frame(Geneid = df$Geneid, m, check.names=FALSE)
  cat("[E-MTAB-6929]\n"); wgz(out, file.path(d, "raw/EMTAB6929_counts_clean.tsv.gz"))
}

# ---- GSE167264: hypothalamus ND ob/ob vs WT (featureCounts; skip comment line) -
{
  d <- file.path(ROOT, "datasets/GSE167264_mmus_hypothalamus_obob")
  df <- read.delim(gzfile(file.path(d, "raw/GSE167264_counts.txt.gz")), skip=1, check.names=FALSE, quote="")
  ctrl <- c("WT_ND_1_Hy_S13.bam","WT_ND_2_Hy_S14.bam","WT_ND_3_Hy_S15.bam")
  case <- c("ob_ob_ND_1_Hy_S19.bam","ob_ob_ND_2_Hy_S20.bam","ob_ob_ND_3_Hy_S21.bam")
  stopifnot(all(c(ctrl, case) %in% colnames(df)))
  m <- as.matrix(df[, c(ctrl, case)])
  colnames(m) <- sub("\\.bam$", "", colnames(m))
  out <- data.frame(Geneid = df$Geneid, m, check.names=FALSE)
  cat("[GSE167264]\n"); wgz(out, file.path(d, "raw/GSE167264_counts_clean.tsv.gz"))
}
cat("prep_2026batch2 done.\n")
