#!/usr/bin/env Rscript
# =============================================================================
# Assemble a hypothalamus-only gene-level count matrix for GSE217420
# (Montani/Pagani et al., Ube3a2x duplication vs WT; FVB/NJ; PFC + hypothalamus).
#
# The Series ships ONE supplementary CSV holding all 38 libraries
# (GSE217420_reads_processed_all_samples.csv.gz): 3 annotation columns
# (ensembl_id, gene_name, gene_description) + 38 raw-count columns whose headers
# are exactly the GEO !Sample_description strings (e.g. "238-HYT_HOM_M").
#
# Two reasons we re-emit rather than point the pipeline at the CSV directly:
#   1. the gene_description field contains embedded (quoted) commas, which makes
#      the CSV brittle for the downstream delimiter sniffer;
#   2. the Series mixes prefrontal cortex (PFC) with hypothalamus (HYT) —
#      only the 18 HYT libraries belong in this contrast.
#
# Contrast built: hypothalamus, adult FVB/NJ, Ube3a2x (case) vs WT (control),
# 10 vs 8 independent animals, sex balanced 5M/5F vs 4M/4F -> sex is carried as a
# third samplesheet column and declared as batch_var.
#
# Usage:  Rscript scripts/prep_GSE217420.R
# =============================================================================

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS   <- file.path(ROOT, "datasets", "GSE217420_mmus_hypothalamus_ube3a")
CSV  <- file.path(DS, "raw", "GSE217420_reads_processed_all_samples.csv.gz")

# ---- read the full supplementary count table (quoted descriptions handled) ---
df <- read.csv(gzfile(CSV), check.names = FALSE, stringsAsFactors = FALSE)
cat(sprintf("[GSE217420] supplementary CSV: %d rows x %d cols\n", nrow(df), ncol(df)))
stopifnot(identical(colnames(df)[1:3], c("ensembl_id", "gene_name", "gene_description")))

# ---- hypothalamus arms, taken from the series matrix, not from the filenames --
# !Sample_source_name_ch1 / "tissue:" == Hypothalamus, !Sample_characteristics_ch1
# "genotype:" == Ube3a2x|WT, "Sex:" == M|F; the column headers of the CSV are the
# matching !Sample_description strings.
samples <- data.frame(
  gsm = c("GSM6717059","GSM6717061","GSM6717069","GSM6717078","GSM6717080",
          "GSM6717083","GSM6717088","GSM6717093",
          "GSM6717057","GSM6717063","GSM6717066","GSM6717072","GSM6717074",
          "GSM6717082","GSM6717084","GSM6717086","GSM6717089","GSM6717091"),
  sample = c("245-HYT_WT_M","251-HYT_WT_M","262-HYT_WT_F","398-HYT_WT_F","403-HYT_WT_M",
             "410-HYT_WT_F","423-HYT_WT_M","471-HYT_WT_F",
             "238-HYT_HOM_M","253-HYT_HOM_M","258-HYT_HOM_M","267-HYT_HOM_M","272-HYT_HOM_F",
             "404-HYT_HOM_M","417-HYT_HOM_F","420-HYT_HOM_F","462-HYT_HOM_F","468-HYT_HOM_F"),
  group = c(rep("control", 8), rep("case", 10)),
  sex   = c("M","M","F","F","M","F","M","F",
            "M","M","M","M","F","M","F","F","F","F"),
  stringsAsFactors = FALSE)

miss <- setdiff(samples$sample, colnames(df))
if (length(miss)) stop("CSV is missing columns: ", paste(miss, collapse = ", "))

# every remaining count column must be PFC (i.e. nothing hypothalamic is dropped)
other <- setdiff(colnames(df)[-(1:3)], samples$sample)
stopifnot(all(grepl("-PFC_", other, fixed = TRUE)))
cat(sprintf("[GSE217420] kept %d HYT libraries, dropped %d PFC libraries\n",
            nrow(samples), length(other)))

M <- as.matrix(df[, samples$sample, drop = FALSE])
storage.mode(M) <- "double"

# ---- hard check: raw integer counts, not RPKM/CPM ---------------------------
stopifnot(all(is.finite(M)), all(M >= 0), all(M == round(M)))
cat(sprintf("[GSE217420] integer check PASSED; max=%.0f  library sizes %.2f-%.2f M reads\n",
            max(M), min(colSums(M))/1e6, max(colSums(M))/1e6))

# ---- collapse the (few) duplicated ENSEMBL ids ------------------------------
ids <- as.character(df$ensembl_id)
dup <- sum(duplicated(ids))
if (dup) {
  cat(sprintf("[GSE217420] summing %d duplicated ensembl_id rows\n", dup))
  M <- rowsum(M, group = ids)
  ids <- rownames(M)
} else {
  rownames(M) <- ids
}
M <- M[order(rownames(M)), , drop = FALSE]

out  <- data.frame(ensembl_id = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
outp <- file.path(DS, "raw", "GSE217420_hypothalamus_counts.tsv.gz")
gz <- gzfile(outp, "w"); write.table(out, gz, sep = "\t", quote = FALSE, row.names = FALSE); close(gz)
cat(sprintf("[GSE217420] wrote %s  (%d genes x %d samples)\n",
            basename(outp), nrow(out), ncol(M)))

# ---- samplesheet ------------------------------------------------------------
mdir <- file.path(DS, "metadata"); dir.create(mdir, showWarnings = FALSE, recursive = TRUE)
write.table(samples[, c("sample", "group", "sex")],
            file.path(mdir, "GSE217420_samplesheet.tsv"),
            sep = "\t", quote = FALSE, row.names = FALSE)
cat("[GSE217420] wrote metadata/GSE217420_samplesheet.tsv\n")

# ---- sanity: IGF panel presence (matrix is ENSEMBL-keyed) -------------------
panel <- c(Igfbp2 = "ENSMUSG00000039323", Igfbp5 = "ENSMUSG00000026185",
           Igfbp7 = "ENSMUSG00000036256", Igf1r  = "ENSMUSG00000005533",
           Irs2   = "ENSMUSG00000038894")
found <- names(panel)[panel %in% rownames(M)]
cat("[GSE217420] panel genes present (ENSEMBL): ", paste(found, collapse = ", "), "\n")
gn <- df$gene_name[match(panel, df$ensembl_id)]
print(data.frame(panel_symbol = names(panel), ensembl = unname(panel),
                 csv_gene_name = gn,
                 mean_count = round(rowMeans(M[panel, , drop = FALSE]), 1)),
      row.names = FALSE)

# ---- sanity: Ube3a dosage + sex labels confirmed from expression -------------
chk <- c(Ube3a = "ENSMUSG00000025326", Xist = "ENSMUSG00000086503", Ddx3y = "ENSMUSG00000069045")
cpm <- t(t(M) / colSums(M)) * 1e6
sm  <- data.frame(sample = colnames(M), group = samples$group, sex = samples$sex,
                  lib_M = round(colSums(M) / 1e6, 1),
                  Ube3a_cpm = round(cpm[chk["Ube3a"], ], 1),
                  Xist_cpm  = round(cpm[chk["Xist"], ], 1),
                  Ddx3y_cpm = round(cpm[chk["Ddx3y"], ], 1))
print(sm, row.names = FALSE)
cat(sprintf("[GSE217420] Ube3a CPM  WT %.1f vs Ube3a2x %.1f  (ratio %.2fx)
",
            mean(sm$Ube3a_cpm[sm$group == "control"]),
            mean(sm$Ube3a_cpm[sm$group == "case"]),
            mean(sm$Ube3a_cpm[sm$group == "case"]) / mean(sm$Ube3a_cpm[sm$group == "control"])))
cat(sprintf("[GSE217420] sex labels agree with Xist/Ddx3y for %d/%d libraries
",
            sum((sm$sex == "F") == (sm$Xist_cpm > sm$Ddx3y_cpm)), nrow(sm)))
