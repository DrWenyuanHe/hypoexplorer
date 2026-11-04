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
# Refit each dataset with the standard recipe, CHECK that the refit reproduces
# the committed logFC, and only then write the SE. The check is load-bearing:
# the original DE runner is not in this repo (geo_replication/scripts/ is
# gitignored and absent), so agreement is the only thing establishing that these
# SEs belong to those effects rather than to some other fit. A dataset that
# fails gets no SE file and drops out of inverse-variance pooling, which is the
# correct outcome — a plausible number from the wrong model is worse than none.
#
# Output: processed/<GSE>_SE.tsv (id, se), a SIDECAR. Deliberately not a new
# column in <GSE>_DE.tsv: rewriting those would reformat every numeric cell of
# 40 committed tables and bury a real change in a cosmetic diff.
#
# Run from the repo root: Rscript scripts/compute_edger_se.R [GSE…]

suppressMessages({ library(edgeR); library(data.table) })

# The refit reproduces the committed tables essentially exactly (max |diff|
# 0.000 on three of four spot-checked datasets), so this is loose enough for
# filtering edge cases and far too tight for a genuinely different model.
TOL <- 0.01
MIN_AGREE <- 0.99

cfg <- fread("geo_replication/config/datasets.tsv")
args <- commandArgs(trailingOnly = TRUE)
if (length(args)) cfg <- cfg[cfg$id %in% args, ]

written <- 0L; skipped <- character(); failed <- character()

for (k in seq_len(nrow(cfg))) {
  row <- cfg[k, ]
  gid <- row$id
  dePath <- file.path("geo_replication", row$dir, "processed", paste0(gid, "_DE.tsv"))
  if (!file.exists(dePath)) { skipped <- c(skipped, sprintf("%s (no DE table)", gid)); next }
  de <- fread(dePath)
  method <- unique(de$method)[1]
  # limma's |logFC|/|t| IS the moderated coefficient SE, so those datasets need
  # nothing persisted. Anything else has no known logFC<->SE relationship.
  if (is.na(method) || method != "edgeR-QL") { skipped <- c(skipped, sprintf("%s (%s)", gid, method)); next }
  if (row$input_kind != "counts") { skipped <- c(skipped, sprintf("%s (input_kind=%s)", gid, row$input_kind)); next }

  cnt <- tryCatch(fread(file.path("geo_replication", row$input_path)), error = function(e) NULL)
  ss  <- tryCatch(fread(file.path("geo_replication", row$samplesheet)), error = function(e) NULL)
  if (is.null(cnt) || is.null(ss)) { skipped <- c(skipped, sprintf("%s (missing raw/samplesheet)", gid)); next }

  idcol <- if (row$id_col %in% names(cnt)) row$id_col else names(cnt)[1]
  genes <- as.character(cnt[[idcol]])
  keepCols <- intersect(ss$sample, names(cnt))
  if (length(keepCols) != nrow(ss)) {
    failed <- c(failed, sprintf("%s (samplesheet/matrix mismatch: %d of %d)", gid, length(keepCols), nrow(ss))); next
  }
  m <- as.matrix(cnt[, ..keepCols]); rownames(m) <- genes
  m <- m[!duplicated(rownames(m)), , drop = FALSE]; storage.mode(m) <- "double"
  grp <- factor(ss$group[match(keepCols, ss$sample)], levels = c("control", "case"))

  bv <- row$batch_var
  design <- if (!is.na(bv) && bv != "NA" && bv %in% names(ss)) {
    batch <- factor(ss[[bv]][match(keepCols, ss$sample)])
    if (nlevels(batch) > 1) model.matrix(~ batch + grp) else model.matrix(~ grp)
  } else model.matrix(~ grp)
  coefName <- tail(colnames(design), 1L)

  y <- DGEList(counts = m, group = grp)
  y <- y[filterByExpr(y, design = design), , keep.lib.sizes = FALSE]
  y <- calcNormFactors(y)
  y <- estimateDisp(y, design)
  fit <- glmQLFit(y, design)
  tt <- topTags(glmQLFTest(fit, coef = coefName), n = Inf, sort.by = "none")$table

  # ── Gate: does this refit reproduce the committed effects? ───────────────
  # The DE table carries BOTH an `id` and a `symbol`, and which one the matrix is
  # keyed by varies across the corpus (ENSEMBL rownames in GSE160802/GSE190712,
  # symbols in GSE225038). Preferring `symbol` unconditionally compared Ensembl
  # rownames against gene symbols and produced ~60 accidental matches, which then
  # tripped the gate as if the model disagreed. Pick whichever key actually joins.
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
  # W = mu / (1 + dispersion * mu). edgeR v4's non-legacy glmQLFit refits with
  # dispersion / average.ql.dispersion, then restores fit$dispersion to the
  # original NB dispersion. Reconstruct the weights from the dispersion used by
  # that refit; older edgeR fits have no average.ql.dispersion and keep the
  # legacy fit$dispersion weights. Convert from natural log to log2 so the SE is
  # on the same scale as logFC, which is what the interval is drawn around.
  mu <- fit$fitted.values
  disp <- fit$dispersion
  # edgeR 4.10 renamed the posterior QL variance from `var.post` to `s2.post`.
  # Accept both names, but fail closed if neither has one value per fitted gene;
  # silently recycling a missing/scalar value would corrupt every interval.
  qlVarPost <- fit$var.post
  if (is.null(qlVarPost)) qlVarPost <- fit$s2.post
  if (is.null(qlVarPost) || length(qlVarPost) != nrow(mu) ||
      any(!is.finite(qlVarPost) | qlVarPost <= 0)) {
    failed <- c(failed, sprintf("%s (invalid posterior QL variance)", gid)); next
  }
  if (length(disp) == 1L) disp <- rep(disp, nrow(mu))
  qlScale <- fit$average.ql.dispersion
  dispersionMode <- "legacy NB"
  if (!is.null(qlScale)) {
    if (length(qlScale) != 1L || !is.finite(qlScale) || qlScale <= 0) {
      failed <- c(failed, sprintf("%s (invalid average.ql.dispersion)", gid)); next
    }
    disp <- disp / qlScale
    dispersionMode <- sprintf("edgeR-v4 working (average QL %.6g)", qlScale)
  }
  if (length(disp) != nrow(mu) || any(!is.finite(disp) | disp < 0)) {
    failed <- c(failed, sprintf("%s (invalid working dispersion)", gid)); next
  }
  j <- match(coefName, colnames(design))
  seLog2 <- rep(NA_real_, nrow(mu))
  for (i in seq_len(nrow(mu))) {
    w <- mu[i, ] / (1 + disp[i] * mu[i, ])
    inv <- tryCatch(solve(crossprod(design * w, design)), error = function(e) NULL)
    if (is.null(inv)) next
    v <- inv[j, j] * qlVarPost[i]
    if (length(v) == 1L && is.finite(v) && v > 0) seLog2[i] <- sqrt(v) / log(2)
  }

  out <- data.table(id = rownames(tt), se = seLog2)
  out <- out[is.finite(se) & se > 0]
  fwrite(out, file.path("geo_replication", row$dir, "processed", paste0(gid, "_SE.tsv")), sep = "\t")

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
}
