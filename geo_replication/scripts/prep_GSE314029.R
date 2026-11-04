#!/usr/bin/env Rscript
# GSE314029 (GLP-1:GIP:lanifibranor agonist vs vehicle, mouse hypothalamus).
# The count matrix columns are internal library IDs (Sample_25L00XXXX); bridge to
# treatment via the series matrix (!Sample_title aligns by position with
# !Sample_description = "Library name: 25L00XXXX"). Build a clean hypothalamus
# count matrix: 8 Vehicle (control) vs 6 Gr3 quintuple-agonist biological reps
# (the 2 Gr3_rep_* technical replicates are dropped to avoid pseudoreplication).
get_dir <- function() { a<-commandArgs(FALSE); f<-grep("^--file=",a,value=TRUE)
  if(length(f)) dirname(normalizePath(sub("^--file=","",f[1]))) else getwd() }
ROOT <- normalizePath(file.path(get_dir(), ".."))
d <- file.path(ROOT, "datasets/GSE314029_mmus_hypothalamus_glp1agonist")

sm <- readLines(gzfile(file.path(d, "metadata/GSE314029_series_matrix.txt.gz")))
getrow <- function(tag){ l<-sm[grepl(paste0("^", tag), sm)][1]; v<-strsplit(l, "\t")[[1]][-1]; gsub('"','',v) }
titles <- getrow("!Sample_title")
lib <- sub("Library name: ", "", getrow("!Sample_description"))
names(lib) <- titles

ctrl_t <- c("Vhcl_67_Hy","Vhcl_66_Hy","Vhcl_59_Hy","Vhcl_85_Hy","Vhcl_60_Hy","Vhcl_61_Hy","Vhcl_68_Hy","Vhcl_69_Hy")
case_t <- c("Gr3_6_Hy","Gr3_29_Hy","Gr3_31_Hy","Gr3_30_Hy","Gr3_32_Hy","Gr3_4_Hy")  # drop Gr3_rep_31/30 (tech reps)
sel_t <- c(ctrl_t, case_t)
cols <- paste0("Sample_", lib[sel_t])

df <- read.delim(gzfile(file.path(d, "raw/GSE314029_lani_bulk_counts.tsv.gz")), check.names=FALSE)
stopifnot(all(cols %in% colnames(df)))
m <- as.matrix(df[, cols]); colnames(m) <- sel_t
out <- data.frame(ensembl_id = df[[1]], m, check.names=FALSE)
gz <- gzfile(file.path(d, "raw/GSE314029_counts_clean.tsv.gz"), "w")
write.table(out, gz, sep="\t", quote=FALSE, row.names=FALSE); close(gz)
cat(sprintf("[GSE314029] wrote clean matrix: %d genes x %d samples (%d ctrl + %d case)\n",
            nrow(out), length(sel_t), length(ctrl_t), length(case_t)))

ss <- data.frame(sample = sel_t, group = c(rep("control", length(ctrl_t)), rep("case", length(case_t))))
write.table(ss, file.path(d, "metadata/GSE314029_samplesheet.tsv"), sep="\t", quote=FALSE, row.names=FALSE)
cat("  wrote samplesheet\n")
