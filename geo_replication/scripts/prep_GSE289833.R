#!/usr/bin/env Rscript
# =============================================================================
# Assemble a gene-level count matrix for GSE289833 (hypothalamus arm only).
#
# This Series ships one featureCounts table per GSM (Geneid/Chr/Start/End/Strand/
# Length + a single count column named after the GEO library). Twelve GSMs cover
# two tissues; the hippocampus arm (GSM8799951-8799956, "*-Hippo") is dropped and
# only the six hypothalamus libraries are merged here.
#
# Contrast built: hypothalamus, 8-week-old male C57BL/6, 18 h fasted (case) vs
# fed (control), 3 vs 3 independent libraries.
# Arms come from the series matrix !Sample_characteristics_ch1 "tissue:" and
# "treatment:" lines, not from the filenames.
#
# Usage:  Rscript scripts/prep_GSE289833.R
# =============================================================================
get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value=TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS   <- file.path(ROOT, "datasets", "GSE289833_mmus_hypo_fasting18h")

# GSM -> (per-GSM file, output sample name, group) for the hypothalamus stratum
samples <- data.frame(
  gsm   = c("GSM8799960","GSM8799961","GSM8799962",
            "GSM8799957","GSM8799958","GSM8799959"),
  file  = c("GSM8799960_FED1-Hypo_counts.tsv.gz","GSM8799961_FED2-Hypo_counts.tsv.gz",
            "GSM8799962_FED3-Hypo_counts.tsv.gz","GSM8799957_FASTED1-Hypo_counts.tsv.gz",
            "GSM8799958_FASTED2-Hypo_counts.tsv.gz","GSM8799959_FASTED3-Hypo_counts.tsv.gz"),
  name  = c("FED1_Hypo","FED2_Hypo","FED3_Hypo",
            "FASTED1_Hypo","FASTED2_Hypo","FASTED3_Hypo"),
  group = c("control","control","control","case","case","case"),
  stringsAsFactors = FALSE)

# Fetch the six per-GSM featureCounts tables into a scratch dir. Only the merged
# matrix is kept under raw/ (the per-GSM files are 22 MB of redundant annotation
# columns; the Series also ships them together as the 44 MB GSE289833_RAW.tar).
tmp <- tempfile("fc289833_"); dir.create(tmp)
on.exit(unlink(tmp, recursive = TRUE), add = TRUE)
for (i in seq_len(nrow(samples))) {
  url <- sprintf("https://ftp.ncbi.nlm.nih.gov/geo/samples/GSM8799nnn/%s/suppl/%s",
                 samples$gsm[i], samples$file[i])
  download.file(url, file.path(tmp, samples$file[i]), mode = "wb", quiet = TRUE)
}

read_fc <- function(p) {
  d <- read.delim(gzfile(p), check.names = FALSE, stringsAsFactors = FALSE)
  # featureCounts: last column is the count column; cols 1-6 are the annotation
  setNames(d[[ncol(d)]], d$Geneid)
}
mats  <- lapply(file.path(tmp, samples$file), read_fc)
genes <- Reduce(intersect, lapply(mats, names))   # identical GRCm38.101 annotation across runs
cat(sprintf("[GSE289833] %d genes common across %d libraries\n", length(genes), length(mats)))

M <- vapply(mats, function(v) as.numeric(v[genes]), numeric(length(genes)))
rownames(M) <- genes; colnames(M) <- samples$name

stopifnot(all(is.finite(M)), all(M == round(M)), all(M >= 0))   # raw integer counts
cat(sprintf("[GSE289833] integer check OK; library sizes: %s\n",
            paste(sprintf("%s=%.1fM", colnames(M), colSums(M)/1e6), collapse = " ")))

out  <- data.frame(gene_id = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
outp <- file.path(DS, "raw", "GSE289833_hypo_counts.tsv.gz")
gz <- gzfile(outp, "w"); write.table(out, gz, sep = "\t", quote = FALSE, row.names = FALSE); close(gz)
cat(sprintf("[GSE289833] wrote %s  (%d genes x %d samples)\n", basename(outp), nrow(out), ncol(M)))

ss <- data.frame(sample = samples$name, group = samples$group, stringsAsFactors = FALSE)
# binary connection => LF line endings, matching the rest of the samplesheet corpus
ssc <- file(file.path(DS, "metadata", "GSE289833_samplesheet.tsv"), "wb")
write.table(ss, ssc, sep = "	", quote = FALSE, row.names = FALSE, eol = "
")
close(ssc)
cat("[GSE289833] wrote metadata/GSE289833_samplesheet.tsv\n")

# sanity: IGF panel presence (ENSMUSG ids for Igfbp2/5/7, Igf1r, Irs2)
panel <- c(Igfbp2 = "ENSMUSG00000039323", Igfbp5 = "ENSMUSG00000026185",
           Igfbp7 = "ENSMUSG00000036256", Igf1r  = "ENSMUSG00000005533",
           Irs2   = "ENSMUSG00000038894")
hit <- panel[panel %in% rownames(M)]
cat("[GSE289833] panel genes present: ", paste(names(hit), collapse = ", "), "\n")
if (length(hit)) print(M[hit, , drop = FALSE])
