# GSE135639 — POMC-neuron translatome (RiboTag) from offspring of chow- vs
# high-fat-diet dams, profiled at P0 and P21.
#   Haddad-Tóvolli et al., Mol Metab 2020;36:100963 (PMID 32283518).
#
# The deposited matrix is NOT raw counts. GEO's own data-processing field states
# "Normalized counts (CPM) were obtained by edgeR library v.3.10.5 in R", which
# the numbers agree with: non-integer, ~1e6 per column, varying 0.91–1.10M as
# effective-library-size normalization produces. edgeR-QL — the repo's default —
# needs the counts and the library sizes, and neither was deposited, so it cannot
# be run here however much we would prefer to. This takes the same route as
# de_gse157077.R and GSE220533: limma-trend on log2(value + 1).
#
# The bundle reports the unit as `log2-normalized` rather than `CPM`: the values
# ARE log2 CPM, but the app's `CPM` tooltip describes a matrix this pipeline
# computed from counts it holds, and this one arrives pre-normalized on the
# submitters' scale. `log2-normalized` is the string whose tooltip says exactly
# that (see unitProvenance in src/utils/sampleValues.ts).
#
# Design: cell means (~ 0 + diet x age), one mean per design cell.
#
# REMOVED 2026-08-29 — the age-adjusted `~ age + diet` fit. It used to be the
# default shipped contrast: a COMMON maternal-diet effect adjusted for age. Three
# things were wrong with it as the thing a visitor sees first.
#
#   * An additive model ASSUMES no interaction and does not establish it. Only 4
#     genes reached FDR<0.05 on the age x diet term, which is weak evidence for
#     additivity rather than proof of it at n=17. The coefficient was therefore a
#     weighted average of the P0 and P21 diet effects (roughly 59% / 41% by cell
#     size), and a genuinely age-specific effect could be averaged away by it.
#
#   * It was not the raw difference between the 8 chow and 9 HFD libraries, but
#     the app draws per-sample bars split only by diet — so for ~85 of 15,230
#     genes (0.6%) the bars leaned opposite to the fitted logFC.
#
#   * It found nothing: 0 genes at FDR<0.05, against 21 for the P21 cell
#     contrast and 9 for P0. Separating the ages is what makes the effect visible.
#
# The four simple effects below say everything the additive fit said and say it
# per age, so nothing is lost by dropping it. `dietP21` is now the DEFAULT
# contrast; see src/data/datasets.ts and scripts/build_normalized_bundles.mts.
#
# NOTE the file name: GEO deposits this as "GSE135639_Newborn.txt.gz", but the
# matrix carries all 17 libraries including both P21 arms. The name describes the
# first experiment in the series, not the file's contents.
#
# Run from the repo root: Rscript scripts/de_gse135639.R
#
# Output: processed/GSE135639_<coef>_DE.tsv in the schema run_mouse_fgsea.R and
# the bundle builders read (id, symbol, logFC, stat, pvalue, padj, method,
# direction). There is deliberately no un-suffixed GSE135639_DE.tsv any more —
# that was the age-adjusted table.
#
# ── The 2x2 exposed as separate contrasts ────────────────────────────────────
# The design's four SIMPLE effects are fitted from a cell-means model
# (~0 + cell, one mean per diet x age cell) with limma contrasts:
#
#   dietP0  = hfd_P0  - chow_P0    (maternal diet at birth,   5 vs 5)
#   dietP21 = hfd_P21 - chow_P21   (maternal diet at weaning, 3 vs 4)
#   ageChow = chow_P21 - chow_P0   (P0→P21 maturation, chow arm — the source
#   ageHFD  = hfd_P21  - hfd_P0     study's own axis; HFD arm likewise)
#
# Each is written as processed/GSE135639_<coef>_DE.tsv so run_mouse_fgsea.R
# discovers them by its *_DE.tsv glob, and the bundle builder ships them as
# deByContrast entries. The residual variance is pooled across ALL 17 libraries
# (both fits use every sample), so the per-cell contrasts are better powered
# than a naive subset re-fit — but n per cell is still 3–5, so expect the gene
# level to be quiet and the pathway level to carry what signal there is.
#
# Every table is content-compared before writing: an unchanged fit must not
# touch the file's mtime, because the bundle builder treats "FGSEA older than
# its DE table" as staleness and would demand an FGSEA re-run that nothing
# actually invalidated. (Even a re-run of the same fit under a newer limma can
# drift in the last float digit; when only such sub-noise digits change, keep
# the committed table.)

suppressMessages({ library(limma); library(data.table) })

base <- "geo_replication/datasets/GSE135639_mmus_pomc_maternal_hfd"
dir.create(file.path(base, "processed"), showWarnings = FALSE, recursive = TRUE)
dir.create(file.path(base, "metadata"), showWarnings = FALSE, recursive = TRUE)

m <- fread(file.path(base, "raw", "GSE135639_Newborn.txt.gz"))
# The deposited header carries 15 trailing empty fields, which fread names V18…V32
# and fills with NA. Select the sample columns POSITIVELY, by the pattern the
# series documents (CD0-1 … HFD21-4), rather than trying to detect the junk:
# an all-NA column that slipped through reached the design matrix as an unusable
# factor level, and a column that silently went MISSING would be far worse — it
# would drop an animal from an arm without changing anything visible.
sampleCols <- grep("^(CD|HFD)\\d+-\\d+$", names(m), value = TRUE)
stopifnot(length(sampleCols) == 17L)
ids <- as.character(m[[1]])
expr <- as.matrix(m[, ..sampleCols])
# Both dimnames in one assignment, then asserted: setting rownames() separately
# on a matrix from as.matrix silently no-ops in some data.table versions, and an
# unnamed matrix costs every gene symbol downstream (see de_gse157077.R).
dimnames(expr) <- list(ids, sampleCols)
stopifnot(!is.null(rownames(expr)), any(grepl("[A-Za-z]", head(rownames(expr)))))
storage.mode(expr) <- "double"

cat(sprintf("matrix: %d rows x %d libraries\n", nrow(expr), ncol(expr)))
cat(sprintf("column sums: %s\n", paste(round(colSums(expr)), collapse = " ")))

# Collapse duplicated symbols BEFORE the fit. limma's topTable falls back to row
# INDICES when rownames are not unique, which silently produces a DE table keyed
# by integers. Keep the most-expressed row per symbol.
ord <- order(rowMeans(expr), decreasing = TRUE)
expr <- expr[ord, , drop = FALSE]
expr <- expr[!duplicated(rownames(expr)), , drop = FALSE]
stopifnot(!anyDuplicated(rownames(expr)))
cat(sprintf("symbols: %d after collapsing duplicates\n", nrow(expr)))

# Column names encode both factors: CD/HFD and the postnatal day.
#   CD0-1 … CD0-5, CD21-1 … CD21-3, HFD0-1 … HFD0-5, HFD21-1 … HFD21-4
diet <- factor(ifelse(grepl("^HFD", colnames(expr)), "hfd", "chow"), levels = c("chow", "hfd"))
age  <- factor(paste0("P", sub("^(CD|HFD)(\\d+)-\\d+$", "\\2", colnames(expr))), levels = c("P0", "P21"))
stopifnot(!any(is.na(diet)), !any(is.na(age)), nlevels(age) == 2L)
# Pin the exact cell sizes GEO documents (CD0 x5, CD21 x3, HFD0 x5, HFD21 x4).
# The design is unbalanced, so a silently dropped or duplicated library would
# change the age adjustment rather than obviously breaking anything.
stopifnot(identical(as.vector(table(diet, age)), c(5L, 5L, 3L, 4L)))
print(table(diet, age))

# Keep genes detected in at least a third of libraries — the analogue of edgeR's
# filterByExpr for a matrix that arrives already normalized.
keep <- rowSums(expr > 0.5) >= (ncol(expr) / 3)
cat(sprintf("genes: %d of %d kept (detected in >= %d of %d libraries)\n",
            sum(keep), nrow(expr), ceiling(ncol(expr) / 3), ncol(expr)))
y <- log2(expr[keep, , drop = FALSE] + 1)

deTable <- function(tt) data.table(
  id = rownames(tt),
  symbol = rownames(tt),
  logFC = tt$logFC,
  stat = tt$t,
  pvalue = tt$P.Value,
  padj = tt$adj.P.Val,
  method = "limma-trend",
  direction = ifelse(tt$logFC > 0, "up", "down")
)

# Write only when the content actually changed (see the header note: an
# unchanged fit must not advance the DE table's mtime past its FGSEA output).
writeDeIfChanged <- function(dt, path) {
  tmp <- paste0(path, ".tmp")
  fwrite(dt, tmp, sep = "\t")
  if (file.exists(path) &&
      identical(readBin(tmp, "raw", file.size(tmp)), readBin(path, "raw", file.size(path)))) {
    file.remove(tmp)
    cat(sprintf("unchanged: %s (mtime preserved)\n", basename(path)))
  } else {
    if (!file.rename(tmp, path)) stop("rename failed: ", path)
    cat(sprintf("wrote: %s\n", basename(path)))
  }
}

# ── Cell-means fit: the four simple effects of the 2x2 ───────────────────────
cell <- factor(paste(as.character(diet), as.character(age), sep = "_"),
               levels = c("chow_P0", "chow_P21", "hfd_P0", "hfd_P21"))
stopifnot(!any(is.na(cell)), nlevels(cell) == 4L)
design2 <- model.matrix(~ 0 + cell)
colnames(design2) <- levels(cell)
cm <- makeContrasts(
  dietP0  = hfd_P0 - chow_P0,
  dietP21 = hfd_P21 - chow_P21,
  ageChow = chow_P21 - chow_P0,
  ageHFD  = hfd_P21 - hfd_P0,
  levels = design2
)
fit2 <- eBayes(contrasts.fit(lmFit(y, design2), cm), trend = TRUE)
tables <- list()
for (coefName in colnames(cm)) {
  tt2 <- topTable(fit2, coef = coefName, number = Inf, sort.by = "P")
  out2 <- deTable(tt2)
  tables[[coefName]] <- out2
  writeDeIfChanged(out2, file.path(base, "processed", sprintf("GSE135639_%s_DE.tsv", coefName)))
  cat(sprintf("  %-8s padj<0.05: %d | padj<0.1: %d | p<0.01: %d | top: %s\n",
              coefName, sum(out2$padj < 0.05), sum(out2$padj < 0.1), sum(out2$pvalue < 0.01),
              paste(head(out2$symbol, 5), collapse = " ")))
}

# dietP21 is the DEFAULT contrast the bundle ships in `de` (see
# scripts/build_normalized_bundles.mts `defaultPrefix`), so it is the one the
# summary below reports on.
DEFAULT_COEF <- "dietP21"
out <- tables[[DEFAULT_COEF]]

# Samplesheet in the repo's two-column schema. Written HERE, from the same
# colnames the fit used, so the bundle's expression columns cannot drift from the
# arms the DE table describes. `age` is extra context; the builders read only
# `sample` and `group`.
ss <- data.table(
  sample = colnames(expr),
  group = ifelse(diet == "chow", "control", "case"),
  age = as.character(age)
)
fwrite(ss, file.path(base, "metadata", "GSE135639_samplesheet.tsv"), sep = "\t")

cat(sprintf("\n[%s = default contrast] DE rows: %d | padj<0.05: %d | padj<0.1: %d | p<0.01: %d\n",
            DEFAULT_COEF, nrow(out), sum(out$padj < 0.05), sum(out$padj < 0.1),
            sum(out$pvalue < 0.01)))
cat("top 15 by p:\n")
print(head(out[, .(symbol, logFC = round(logFC, 3), stat = round(stat, 2),
                   pvalue = signif(pvalue, 3), padj = signif(padj, 3))], 15))

# Sanity checks against the source study.
cat("\nPOMC-lineage markers (RiboTag pulldown should be POMC-enriched):\n")
print(out[symbol %in% c("Pomc", "Cartpt", "Prcp", "Agrp", "Npy"),
          .(symbol, logFC = round(logFC, 3), pvalue = signif(pvalue, 3), padj = signif(padj, 3))])

# The age axis dwarfs the diet axis, which is WHY the additive age-adjusted fit
# was dropped rather than kept alongside these: averaging the two ages together
# hid the diet effect instead of sharpening it. Recorded from the shipped
# maturation contrasts, not from a separate model.
cat(sprintf("\nfor scale — maturation (P21 vs P0) padj<0.05: chow %d, HFD %d of %d genes;",
            sum(tables$ageChow$padj < 0.05), sum(tables$ageHFD$padj < 0.05), nrow(out)))
cat(sprintf(" diet padj<0.05: P0 %d, P21 %d\n",
            sum(tables$dietP0$padj < 0.05), sum(tables$dietP21$padj < 0.05)))
