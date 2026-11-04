# R 4.6.0 regeneration variant of scripts/de_gse157077.R (sealed original left byte-identical).
# Shared rules: scripts/lib/de_common.R; orchestrated by scripts/regenerate_bulk_de.R.
# GSE157077 — SCN, chow vs high-fat diet, sampled every 4 h across one 24 h cycle.
#
# The deposited matrices are FPKM, not counts (column sums ~4e5, non-integer),
# so edgeR-QL — the repo's default for count data — is not applicable. This
# follows the same route the pipeline already takes for GSE220533, whose raw
# counts were likewise unavailable: limma-trend on the log2 of the submitters'
# own normalized values, with the unit reported honestly as log2-normalized
# rather than relabelled CPM.
#
# Design: ~ ZT + diet.
#   ZT enters as a FACTOR, not a covariate to be averaged away. The 18 chow and
#   18 HFD libraries are paired by time of day, and a gene with a strong daily
#   rhythm carries variance across ZT that would otherwise land in the residual
#   and shrink every diet t-statistic in the dataset. Blocking on ZT asks the
#   question the contrast is meant to ask — the diet difference AT MATCHED TIME
#   OF DAY — which is exactly the comparison the pooled two-arm bundle reports.
#
# Run from the repo root: Rscript scripts/regen-r460/de_gse157077_r460.R
# HYPO_OUT_ROOT=<dir> writes to <dir>/GSE157077_mmus_scn_hfd/ instead of the repo.
#
# Output: processed/GSE157077_DE.tsv in the schema the FGSEA script and the
# bundle builders read (id, symbol, logFC, stat, pvalue, padj, method, direction).

suppressMessages({ library(limma); library(data.table) })
local({
  f <- grep("^--file=", commandArgs(FALSE), value = TRUE)
  repo <- if (length(f)) dirname(dirname(dirname(normalizePath(sub("^--file=", "", f[[1L]]))))) else getwd()
  source(file.path(repo, "scripts", "lib", "de_common.R"), local = globalenv())
  de_init(repo)
})
setwd(de_repo_root())

base <- "geo_replication/datasets/GSE157077_mmus_scn_hfd"
proc <- dataset_output_dir(base, "processed")
meta <- dataset_output_dir(base, "metadata")

read_arm <- function(file, arm) {
  m <- fread(file.path(base, "raw", file))
  ids <- as.character(m[[1]])
  vals <- as.matrix(m[, -1L, with = FALSE])
  # Both dimnames in one assignment, then asserted. Setting rownames() on a
  # matrix that as.matrix produced without any silently no-ops in some
  # data.table versions, and an unnamed matrix costs every gene symbol
  # downstream — which is exactly how the first run of this script produced a
  # DE table keyed by row index.
  dimnames(vals) <- list(
    ids,
    paste0(arm, " ", sub("^ZT_(\\d+)_REP_(\\d+)$", "ZT\\1 rep\\2", colnames(m)[-1L]))
  )
  stopifnot(!is.null(rownames(vals)), any(grepl("[A-Za-z]", head(rownames(vals)))))
  vals
}

chow <- read_arm("GSE157077_mouse_scn_control.tsv.gz", "Chow")
hfd  <- read_arm("GSE157077_mouse_scn_high_fat.tsv.gz", "HFD")
stopifnot(!is.null(rownames(chow)), identical(rownames(chow), rownames(hfd)))

expr <- cbind(chow, hfd)

# The deposited matrix carries 537 duplicated gene symbols (24,883 rows for
# 24,346 symbols) — separate loci that resolve to one name. They must be
# collapsed BEFORE the fit, and not only for tidiness: limma's topTable
# silently falls back to returning row INDICES instead of names when rownames
# are not unique, which is how the first run of this script produced a DE table
# keyed by integers. Rule A (scripts/lib/de_common.R): map every row to its
# final public symbol and SUM the FPKM of rows sharing a symbol on the linear
# scale, before the detection filter and the log transform; rows without a
# public symbol stay in the fit as their own rows and are not published.
ag <- aggregate_by_symbol(expr, normalize_gene(rownames(expr)), "linear")
expr <- ag$mat
stopifnot(!anyDuplicated(rownames(expr)))
cat(sprintf("symbols: %d after aggregating %d rows (%d unmapped kept in the fit)\n",
            nrow(expr), ag$info$n_features_raw, ag$info$n_unmapped_in_fit))

diet <- factor(c(rep("chow", ncol(chow)), rep("hfd", ncol(hfd))), levels = c("chow", "hfd"))
zt   <- factor(sub("^\\S+ (ZT\\d+) .*$", "\\1", colnames(expr)))

# Keep genes detected in at least a third of libraries — the analogue of
# edgeR's filterByExpr for a matrix that arrives already normalized. Undetected
# genes carry no rhythm and no contrast, and only cost multiplicity.
keep <- rowSums(expr > 0.5) >= (ncol(expr) / 3)
cat(sprintf("genes: %d of %d kept (detected in >= %d of %d libraries)\n",
            sum(keep), nrow(expr), ceiling(ncol(expr) / 3), ncol(expr)))
y <- log2(expr[keep, , drop = FALSE] + 1)

design <- model.matrix(~ zt + diet)
fit <- eBayes(lmFit(y, design), trend = TRUE)
tt <- topTable(fit, coef = "diethfd", number = Inf, sort.by = "P")
tt <- tt[rownames(tt) %in% ag$published, ]   # unmapped rows: fitted, not published

out <- data.table(
  id = rownames(tt),
  symbol = rownames(tt),
  logFC = tt$logFC,
  stat = tt$t,
  pvalue = tt$P.Value,
  padj = tt$adj.P.Val,
  method = "limma-trend",
  direction = ifelse(tt$logFC > 0, "up", "down")
)
de_path <- file.path(proc, "GSE157077_DE.tsv")
write_tsv_lf(out, de_path)
expr_path <- write_expression_matrix(log2(expr + 1), "GSE157077", proc, ag$published)
fm_path <- write_feature_map(ag$feature_map, "GSE157077", proc)

# Samplesheet in the repo's two-column schema, plus the time column the
# time-series generator reads.
ss <- data.table(
  sample = colnames(expr),
  group = ifelse(diet == "chow", "control", "case"),
  zt = as.integer(sub("ZT", "", as.character(zt)))
)
ss_path <- file.path(meta, "GSE157077_samplesheet.tsv")
write_tsv_lf(ss, ss_path)
write_provenance("GSE157077", proc, de_script_path(),
  inputs = c(control = file.path(base, "raw", "GSE157077_mouse_scn_control.tsv.gz"),
             high_fat = file.path(base, "raw", "GSE157077_mouse_scn_high_fat.tsv.gz")),
  outputs = c(de = de_path, expression = expr_path, feature_map = fm_path, samplesheet = ss_path),
  fields = list(config_id = "GSE157077", organism = "Mus musculus", input_kind = "matrix",
                input_scale = "linear FPKM", method = "limma-trend", design = paste(colnames(design), collapse = " + "),
                coef = "diethfd", n_features_raw = ag$info$n_features_raw,
                n_unmapped_in_fit = ag$info$n_unmapped_in_fit,
                n_symbols_after_aggregation = ag$info$n_symbols_after_aggregation,
                n_features_collapsed = ag$info$n_features_collapsed,
                n_symbols_with_multiple_features = ag$info$n_symbols_with_multiple_features,
                aggregation = ag$info$aggregation, n_features_tested = nrow(out), n_de_rows = nrow(out),
                n_fdr_lt_0.05 = sum(out$padj < 0.05)))

cat(sprintf("DE rows: %d | padj<0.05: %d | padj<0.1: %d\n",
            nrow(out), sum(out$padj < 0.05), sum(out$padj < 0.1)))
cat("top 10 by p:\n")
print(head(out[, .(symbol, logFC = round(logFC, 3), stat = round(stat, 2),
                   pvalue = signif(pvalue, 3), padj = signif(padj, 3))], 10))
cat("\nclock-gene sanity (should NOT be strongly diet-shifted; they are time-shifted):\n")
print(out[symbol %in% c("Arntl", "Dbp", "Nr1d1", "Per2", "Cry1"),
          .(symbol, logFC = round(logFC, 3), pvalue = signif(pvalue, 3), padj = signif(padj, 3))])
