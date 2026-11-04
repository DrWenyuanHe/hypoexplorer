#!/usr/bin/env Rscript
# R 4.6.0 regeneration variant of geo_replication/scripts/prep_GSE229838.R (sealed original left byte-identical).
# Shared rules: scripts/lib/de_common.R; orchestrated by scripts/regenerate_bulk_de.R.
# =============================================================================
# Assemble a raw count matrix for GSE229838 (hypothalamus, PEL 10 d vs SHAM).
#
# The Series ships ONE wide supplementary table, GSE229838_Processed_data_file.txt.gz,
# with 59 columns: id (ENSMUSG) + 24 *_fpkm + 24 *_count + 9 annotation columns
# (Symbol, Description, KEGG/GO/TF text blobs). The *_count columns are raw
# integer counts written with a trailing ".00"; the *_fpkm columns are the
# normalized twins and are discarded here.
#
# Contrast built: hypothalamus, pituitary stalk electrical lesion (PEL) at day 10
# (case) vs sham-operated (control), 3 vs 3. Everything else in the Series is
# dropped: the 6 hippocampus libraries (HIP-*) and every GH-treated arm
# (PEL_3d-GH, PEL_10d-GH, SHAM-GH), plus the PEL day-3 timepoint.
#
# Usage:  Rscript scripts/regen-r460/prep_GSE229838_r460.R
# =============================================================================
suppressPackageStartupMessages({ library(data.table) })

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value=TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), "..", "..", "geo_replication"))
# Shared rules + HYPO_OUT_ROOT overlay (outputs land in <HYPO_OUT_ROOT>/<dataset dir>/).
source(file.path(ROOT, "..", "scripts", "lib", "de_common.R")); de_init(file.path(ROOT, ".."))
DS   <- file.path(ROOT, "datasets", "GSE229838_mmus_hypothalamus_pel")
SRC  <- file.path(DS, "raw", "GSE229838_Processed_data_file.txt.gz")

# GSM -> data-file count column -> output sample name -> arm
samples <- data.frame(
  gsm    = c("GSM7178967","GSM7178968","GSM7178969",
             "GSM7178961","GSM7178962","GSM7178963"),
  column = c("SHAM-1_count","SHAM-2_count","SHAM-3_count",
             "PEL_10d-1_count","PEL_10d-2_count","PEL_10d-3_count"),
  name   = c("SHAM-1","SHAM-2","SHAM-3","PEL_10d-1","PEL_10d-2","PEL_10d-3"),
  group  = c("control","control","control","case","case","case"),
  stringsAsFactors = FALSE)

# quote="" — the annotation columns carry unbalanced quotes/brackets we never read
d <- fread(cmd = sprintf('gzip -dc "%s"', SRC), sep = "\t", quote = "",
           select = c("id", "Symbol", samples$column), data.table = FALSE)
cat(sprintf("[GSE229838] read %d rows x %d selected columns\n", nrow(d), ncol(d)))

M <- as.matrix(d[, samples$column, drop = FALSE])
storage.mode(M) <- "double"
if (anyNA(M)) stop("NA in count columns")

# ---- hard check: raw read-scale counts, not FPKM ----------------------------
# The *_count columns are ESTIMATED counts (fractional multi-mapping apportionment,
# written to 2 dp): 91.8% of values are exactly integer and the remainder carry a
# fractional part, exactly like Salmon NumReads in prep_GSE282067.R. They are
# non-negative and sit on the read scale (~15-17M per library). They are passed to
# edgeR UNROUNDED (rule B, scripts/lib/de_common.R: edgeR-QL accepts non-integer
# counts). Guard against ever being handed the *_fpkm twins by mistake.
fi <- mean(M == round(M))
cat(sprintf("[GSE229838] exactly-integer values: %.2f%%   max value: %.0f\n", 100*fi, max(M)))
if (any(M < 0))            stop("negative values - not counts")
if (fi < 0.75)             stop("too few integer values - these look normalized, not counts")
if (max(colSums(M)) < 1e6) stop("library sizes below 1e6 - these are not raw read counts")
# (no rounding: fractional estimates are kept as deposited)
cat("[GSE229838] library sizes:\n")
print(setNames(colSums(M), samples$name))

# ---- ENSMUSG-keyed matrix (pipeline maps ENSEMBL -> SYMBOL via org.Mm.eg.db)
rownames(M) <- d$id
colnames(M) <- samples$name
if (anyDuplicated(rownames(M))) stop("duplicate ENSMUSG ids in source table")

out  <- data.frame(id = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
outp <- overlay_output_path(file.path(DS, "raw", "GSE229838_hypo_PEL10d_vs_SHAM_counts.tsv.gz"))
write_table_lf(out, outp)
cat(sprintf("[GSE229838] wrote %s  (%d genes x %d samples)\n", basename(outp), nrow(out), ncol(M)))

# ---- samplesheet -----------------------------------------------------------
ssp <- overlay_output_path(file.path(DS, "metadata", "GSE229838_samplesheet.tsv"))
write_table_lf(data.frame(sample = samples$name, group = samples$group), ssp)
cat(sprintf("[GSE229838] wrote %s\n", basename(ssp)))

# ---- sanity: IGF panel presence (source table is ENSMUSG-keyed + Symbol) ---
panel <- c("Igfbp2","Igfbp5","Igfbp7","Igf1r","Irs2")
hit   <- panel[panel %in% d$Symbol]
cat("[GSE229838] panel genes present: ", paste(hit, collapse = ", "), "\n")
for (g in hit) {
  i <- which(d$Symbol == g)[1]
  cat(sprintf("   %-7s %-20s %s\n", g, d$id[i], paste(M[i, ], collapse = " ")))
}
