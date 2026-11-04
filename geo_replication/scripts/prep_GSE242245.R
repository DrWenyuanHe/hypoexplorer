#!/usr/bin/env Rscript
# =============================================================================
# Assemble a gene-level count matrix for GSE242245 -- hypothalamic oxytocin-neuron
# RiboTag/TRAP translatome (Gruber et al., Cell Rep 2023;42(10):113305, PMID
# 37864798; doi 10.1016/j.celrep.2023.113305).
#
# CONTRAST BUILT (NOT the diet contrast this Series is usually screened for):
#   standard-chow (SC) diet, Oxt-Cre;RiboTag IP fraction,
#   vehicle i.p. (control, n=4) vs CCK-8s 20 ug/kg i.p. (case, n=3), 2 h post-injection.
#
# WHY NOT chow-vs-HFHS.  The obvious contrast -- SC vs HFHS, vehicle, IP fraction,
# 4 vs 4 -- is NOT usable.  The HFHS cohort's IP libraries are genuine RiboTag
# pulldowns (Rpl22 45-68 CPM vs 17-19 in the whole-lysate inputs) but the
# oxytocin-neuron capture failed in half of them.  Oxt CPM:
#     SC vehicle IP  : 25077, 32140, 30913, 16143      (tight, ~100x over input)
#     HFHS vehicle IP:   249,   337,  8000, 11374      (45-fold spread; 2/4 at input level)
#     HFHS CCK IP    : 14155,  3853,    78,   167      (same bimodal failure)
# Avp tracks Oxt exactly, so this is IP purity, not a graded diet effect on Oxt.
# Fatally for this resource, every IGF-panel gene is strongly ANTI-correlated with
# Oxt purity across the 15 IP libraries (Spearman rho: Igfbp2 -0.52, Igfbp5 -0.85,
# Igfbp7 -0.72, Igf1r -0.79, Irs2 -0.75, Igf1 -0.85) -- Igf1r reads 27-32 CPM in the
# clean SC IPs and 58-95 CPM in the HFHS IPs.  A chow-vs-HFHS run would therefore
# report a large, entirely artefactual IGF-axis "diet effect".  Dropping the two
# failed HFHS vehicle IPs leaves n=2, below the n>=3 floor.  The diet arm is rejected.
#
# Also excluded: the 8 whole-lysate "input" libraries (chow only, so diet is not
# testable there and fraction would confound), and all HFHS libraries.
#
# FILE QUIRKS handled below (a naive merge gets each of these wrong):
#   (a) GSM7757028_MUC14082.tsv.gz has NO header row -- detect, do not assume.
#   (b) GSM7757016_MUC13129.tsv.gz carries an extra leading row-index column.
#   (c) Excel date corruption of two symbols is inconsistent across files:
#       "10/01/19" and "10/01/20" are both Oct-1, "10/03/04" is Oct-3/4
#       (GSM7757028 retains the intact spellings, which is how they were resolved).
#
# Usage:  Rscript scripts/prep_GSE242245.R
# =============================================================================

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value=TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS   <- file.path(ROOT, "datasets", "GSE242245_mmus_pvn_ot_trap")
TAR  <- file.path(DS, "raw", "GSE242245_RAW.tar")

# GSM -> (tar entry, output sample name, group). Assignment taken from the series
# matrix lines !Sample_geo_accession / !Sample_title / !Sample_characteristics_ch1
# ("diet:", "treatment:", "fraction:"), not from filenames.
samples <- data.frame(
  gsm   = c("GSM7757023","GSM7757024","GSM7757025","GSM7757026",
            "GSM7757020","GSM7757021","GSM7757022"),
  entry = c("GSM7757023_MUC13137.tsv.gz","GSM7757024_MUC13138.tsv.gz",
            "GSM7757025_MUC13139.tsv.gz","GSM7757026_MUC13140.tsv.gz",
            "GSM7757020_MUC13133.tsv.gz","GSM7757021_MUC13134.tsv.gz",
            "GSM7757022_MUC13136.tsv.gz"),
  name  = c("Veh_IP_MUC13137","Veh_IP_MUC13138","Veh_IP_MUC13139","Veh_IP_MUC13140",
            "CCK_IP_MUC13133","CCK_IP_MUC13134","CCK_IP_MUC13136"),
  group = c("control","control","control","control","case","case","case"),
  stringsAsFactors = FALSE)

tmp <- tempfile("gse242245_"); dir.create(tmp)
untar(TAR, files = samples$entry, exdir = tmp)

DEMANGLE <- c("10/01/19" = "Oct-1", "10/01/20" = "Oct-1", "10/03/04" = "Oct-3/4")

read_htseq <- function(p) {
  L <- readLines(gzfile(p)); L <- L[nzchar(L)]
  f1 <- strsplit(L[1], "\t", fixed = TRUE)[[1]]
  if (identical(f1[1], "V1") || identical(f1[1], "")) L <- L[-1]   # header row present
  parts <- strsplit(L, "\t", fixed = TRUE)
  nf    <- length(parts[[1]])
  gene  <- vapply(parts, function(x) x[nf - 1L], character(1))     # 2-col: [1]; 3-col: [2]
  hit   <- gene %in% names(DEMANGLE); gene[hit] <- unname(DEMANGLE[gene[hit]])
  if (anyDuplicated(gene)) stop(sprintf("duplicate gene ids in %s", basename(p)))
  v <- as.numeric(vapply(parts, function(x) x[nf], character(1)))
  if (any(!is.finite(v)))                stop(sprintf("non-numeric counts in %s", basename(p)))
  if (any(abs(v - round(v)) > 1e-8))     stop(sprintf("non-integer counts in %s", basename(p)))
  setNames(v, gene)
}

mats <- lapply(file.path(tmp, samples$entry), read_htseq)
names(mats) <- samples$name
cat(sprintf("[GSE242245] rows per library: %s\n",
            paste(vapply(mats, length, integer(1)), collapse = ", ")))

genes <- sort(Reduce(intersect, lapply(mats, names)))
cat(sprintf("[GSE242245] %d genes common across %d libraries\n", length(genes), length(mats)))

M <- vapply(mats, function(v) as.numeric(v[genes]), numeric(length(genes)))
rownames(M) <- genes; colnames(M) <- samples$name
if (any(is.na(M))) stop("NA after alignment -- gene sets are not comparable")
storage.mode(M) <- "integer"
if (any(is.na(M))) stop("integer overflow on cast")

cat("[GSE242245] library sizes and Oxt purity:\n")
print(data.frame(sample = colnames(M), group = samples$group, lib_size = colSums(M),
                 Oxt_cpm = round(M["Oxt", ] / colSums(M) * 1e6)), row.names = FALSE)

out  <- data.frame(symbol = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
outp <- file.path(DS, "raw", "GSE242245_OT_TRAP_IP_SCdiet_counts.tsv.gz")
gz <- gzfile(outp, "w"); write.table(out, gz, sep = "\t", quote = FALSE, row.names = FALSE); close(gz)
cat(sprintf("[GSE242245] wrote %s  (%d genes x %d samples)\n", basename(outp), nrow(out), ncol(M)))

ss  <- data.frame(sample = samples$name, group = samples$group, stringsAsFactors = FALSE)
ssp <- file.path(DS, "metadata", "GSE242245_samplesheet.tsv")
write.table(ss, ssp, sep = "\t", quote = FALSE, row.names = FALSE)
cat(sprintf("[GSE242245] wrote %s\n", basename(ssp)))

panel <- c("Igfbp2","Igfbp5","Igfbp7","Igf1r","Irs2","Igf1","Oxt")
cat("[GSE242245] panel genes present: ", paste(panel[panel %in% rownames(M)], collapse = ", "), "\n")
unlink(tmp, recursive = TRUE)
