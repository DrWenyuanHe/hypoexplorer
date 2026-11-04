# R 4.6.0 regeneration variant of scripts/compute_edger_se.R (sealed original left byte-identical).
# Shared rules: scripts/lib/de_common.R; orchestrated by scripts/regenerate_bulk_de.R.
# Compute and persist the QL-adjusted coefficient Wald SE for every edgeR-QL
# dataset, so its effects can carry a real 95% confidence interval.
#
# WHY
# ---
# src/utils/seRecovery.ts used to reconstruct the SE as |logFC| / sqrt(QL F).
# That is the SE implied by edgeR's own p-value — algebraically identical to
# backing one out as |logFC| / qt(1 - p/2, df.total) — but it is NOT an estimate
# of the sampling standard deviation of logFC, because the QL F is a
# deviance-ratio statistic over the posterior QL dispersion rather than a Wald
# statistic. The p-to-SE reconstruction assumes a Wald test; edgeR does not
# perform one.
#
# The consequence is not cosmetic. Measured on GSE225038, |logFC|/sqrt(F) runs a
# median 0.752x the QL-adjusted Wald SE, so every edgeR study entered the
# inverse-variance model at roughly 1/0.752^2 = 1.77x the weight it had earned,
# against limma studies whose |logFC|/|t| IS a real moderated SE. tau^2 does not
# absorb that, because Q and tau^2 are themselves computed from those weights.
#
# WHAT
# ----
# Refit each dataset with the standard recipe on EXACTLY the matrix the DE
# runner tested — geo_replication/scripts/run_dataset.R and this script both
# build it with prepare_config_dataset() in scripts/lib/de_common.R (features
# sharing a symbol summed before testing, features without one kept in
# the fit as raw-id rows but not published, counts unrounded) —
# CHECK that the refit reproduces the DE table's logFC, and only then write the
# SE. A dataset that fails gets no SE file and drops out of inverse-variance
# pooling, which is the correct outcome — a plausible number from the wrong
# model is worse than none.
#
# Output: processed/<GSE>_SE.tsv (id, se), a SIDECAR, plus
# <GSE>_SE_provenance.tsv and <GSE>_SE_sessionInfo.txt. Deliberately not a new
# column in <GSE>_DE.tsv: rewriting those would reformat every numeric cell of
# 40 committed tables and bury a real change in a cosmetic diff.
#
# Run from the repo root: Rscript scripts/regen-r460/compute_edger_se_r460.R [GSE…]
# HYPO_OUT_ROOT=<dir> reads the DE table from and writes the SE to
# <dir>/<dataset dir>/processed instead of the repository.

suppressMessages({ library(edgeR); library(data.table) })
local({
  f <- grep("^--file=", commandArgs(FALSE), value = TRUE)
  repo <- if (length(f)) dirname(dirname(dirname(normalizePath(sub("^--file=", "", f[[1L]]))))) else getwd()
  source(file.path(repo, "scripts", "lib", "de_common.R"), local = globalenv())
  de_init(repo)
})

# The refit reproduces the DE tables essentially exactly (max |diff| 0.000),
# so this is loose enough for filtering edge cases and far too tight for a
# genuinely different model.
TOL <- 0.01
MIN_AGREE <- 0.99

cfg <- fread(file.path(de_repo_root(), "geo_replication/config/datasets.tsv"))
args <- commandArgs(trailingOnly = TRUE)
if (length(args)) cfg <- cfg[cfg$id %in% args, ]

written <- 0L; skipped <- character(); failed <- character()

for (k in seq_len(nrow(cfg))) {
  row <- as.list(cfg[k, ])
  gid <- row$id
  procDir <- dataset_output_dir(row$dir, "processed")
  dePath <- file.path(procDir, paste0(gid, "_DE.tsv"))
  if (!file.exists(dePath)) { skipped <- c(skipped, sprintf("%s (no DE table)", gid)); next }
  de <- fread(dePath)
  method <- unique(de$method)[1]
  # limma's |logFC|/|t| IS the moderated coefficient SE, so those datasets need
  # nothing persisted. Anything else has no known logFC<->SE relationship.
  if (is.na(method) || method != "edgeR-QL") { skipped <- c(skipped, sprintf("%s (%s)", gid, method)); next }
  if (row$input_kind != "counts") { skipped <- c(skipped, sprintf("%s (input_kind=%s)", gid, row$input_kind)); next }

  prep <- tryCatch(prepare_config_dataset(row), error = function(e) e)
  if (inherits(prep, "error")) { failed <- c(failed, sprintf("%s (%s)", gid, conditionMessage(prep))); next }
  design <- prep$design; coefName <- prep$coef
  ft <- fit_edger_ql(prep$mat, design, coefName)
  fit <- ft$fit
  tt <- topTags(ft$qlf, n = Inf, sort.by = "none")$table

  # ── Gate: does this refit reproduce the DE table's effects? ───────────────
  # Both tables are keyed by the aggregated symbol; the older tables carried a
  # separate raw `id`, so keep choosing whichever key actually joins.
  candidates <- list(id = as.character(de$id))
  if ("symbol" %in% names(de)) candidates$symbol <- as.character(de$symbol)
  overlaps <- vapply(candidates, function(k) length(intersect(rownames(tt), k)), integer(1))
  key <- candidates[[which.max(overlaps)]]
  common <- intersect(rownames(tt), key)
  if (length(common) < 100) { failed <- c(failed, sprintf("%s (only %d shared ids)", gid, length(common))); next }
  agree <- mean(abs(tt[common, "logFC"] - de$logFC[match(common, key)]) < TOL)
  if (agree < MIN_AGREE) {
    failed <- c(failed, sprintf("%s (logFC agreement %.1f%% < %.0f%%)", gid, 100 * agree, 100 * MIN_AGREE)); next
  }

  # ── QL-adjusted Wald SE of the contrast coefficient, on the log2 scale ───
  # Cov(beta) = (X'WX)^-1 * var.post, with edgeR's NB working weights
  # W = mu / (1 + dispersion * mu), the dispersion rescaled by edgeR v4's
  # average.ql.dispersion, converted from natural log to log2 (ql_wald_se in
  # scripts/lib/de_common.R; it fails closed on invalid QL variances).
  seLog2 <- tryCatch(ql_wald_se(fit, design, coefName), error = function(e) e)
  if (inherits(seLog2, "error")) { failed <- c(failed, sprintf("%s (%s)", gid, conditionMessage(seLog2))); next }
  dispersionMode <- if (is.null(fit$average.ql.dispersion)) "legacy NB" else
    sprintf("edgeR-v4 working (average QL %.6g)", fit$average.ql.dispersion)

  out <- data.table(id = rownames(tt), se = seLog2)
  # Unmapped rows are part of the fit but, like the DE table, not published.
  out <- out[is.finite(se) & se > 0 & id %in% prep$published]
  sePath <- file.path(procDir, paste0(gid, "_SE.tsv"))
  write_tsv_lf(out, sePath)
  write_provenance(paste0(gid, "_SE"), procDir, de_script_path(),
    inputs = c(matrix = prep$inpath, samplesheet = prep$ss_path, de_table = dePath),
    outputs = c(se = sePath),
    fields = list(config_id = gid, design = paste(colnames(design), collapse = " + "), coef = coefName,
                  n_features_raw = prep$agg$n_features_raw, n_unmapped_in_fit = prep$agg$n_unmapped_in_fit,
                  n_symbols_after_aggregation = prep$agg$n_symbols_after_aggregation,
                  n_features_tested = nrow(tt), n_se_rows = nrow(out),
                  logfc_gate_agreement = signif(agree, 6), logfc_gate_tolerance = TOL,
                  dispersion_mode = dispersionMode))

  # Diagnostic: a correct SE makes "95% CI excludes 0" agree closely with
  # edgeR's own p<0.05 call. Exact agreement is not expected (a QL F is not a
  # Wald z), but a badly wrong SE shows up here immediately.
  ok <- is.finite(seLog2) & is.finite(tt$logFC)
  ci <- abs(tt$logFC[ok]) > 1.96 * seLog2[ok]
  cat(sprintf(paste0(
      "%-12s n=%5d  logFC agree %.1f%%  median SE %.4f  ",
      "CI/p<0.05 concordance %.1f%%  weights: %s\n"),
      gid, nrow(out), 100 * agree, median(out$se),
      100 * mean(ci == (tt$PValue[ok] < 0.05)), dispersionMode))
  flush.console()
  written <- written + 1L
}

cat(sprintf("\nwrote %d SE sidecar(s)\n", written))
if (length(skipped)) cat(sprintf("skipped %d: %s\n", length(skipped), paste(head(skipped, 8), collapse = ", ")))
if (length(failed)) {
  cat(sprintf("\nFAILED THE logFC GATE (%d) — these get NO se and drop out of inverse-variance pooling:\n  %s\n",
              length(failed), paste(failed, collapse = "\n  ")))
  quit(save = "no", status = 1L)
}
