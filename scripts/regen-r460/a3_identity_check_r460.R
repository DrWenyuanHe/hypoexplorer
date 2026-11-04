#!/usr/bin/env Rscript
# Before/after check for the rule A3 re-run: for each affected dataset compare
# the A2 staged outputs (copied to <before dir>) with the A3 staged outputs:
# published rows, which raw features each published symbol stands for, and the
# DE / FGSEA headline numbers.
# Usage: Rscript scripts/regen-r460/a3_identity_check_r460.R <before dir> <staging root> <out tsv>
suppressPackageStartupMessages(library(data.table))
args <- commandArgs(trailingOnly = TRUE)
before <- args[[1]]; stage <- args[[2]]; out <- args[[3]]
rd <- function(p) if (file.exists(p)) fread(p, colClasses = list(character = c("id", "symbol"))) else NULL
fmap <- function(p) { x <- read.delim(gzfile(p), colClasses = "character", na.strings = "NA", quote = ""); data.table(x) }
rows <- list()
for (d in list.dirs(before, recursive = FALSE)) {
  ds <- basename(d)
  for (f in list.files(file.path(d, "processed"), pattern = "_DE\\.tsv$")) {
    stem <- sub("_DE\\.tsv$", "", f)
    a <- rd(file.path(d, "processed", f)); b <- rd(file.path(stage, ds, "processed", f))
    fa <- fmap(list.files(file.path(d, "processed"), "_feature_map\\.tsv\\.gz$", full.names = TRUE)[1])
    fb <- fmap(list.files(file.path(stage, ds, "processed"), "_feature_map\\.tsv\\.gz$", full.names = TRUE)[1])
    contrib <- function(fm) { m <- fm[status == "mapped"]; m[, .(features = paste(sort(sub("__dup[0-9]+$", "", feature_id)), collapse = ";"), n = .N), by = symbol] }
    ca <- contrib(fa); cb <- contrib(fb)
    j <- merge(ca, cb, by = "symbol", all = TRUE, suffixes = c(".a2", ".a3"))
    changed <- j[is.na(features.a2) | is.na(features.a3) | n.a2 != n.a3]
    shared_rows <- intersect(a$symbol, b$symbol)
    m <- merge(a[, .(symbol, lfc_a = logFC, fdr_a = padj)], b[, .(symbol, lfc_b = logFC, fdr_b = padj)], by = "symbol")
    unchanged_symbols <- setdiff(m$symbol, changed$symbol)
    mu <- m[symbol %in% unchanged_symbols]
    fg <- vapply(c("HALLMARK", "KEGG", "GO_BP", "REACTOME"), function(db) {
      x <- rd(file.path(d, "processed", sprintf("%s_FGSEA_%s.tsv", stem, db))); y <- rd(file.path(stage, ds, "processed", sprintf("%s_FGSEA_%s.tsv", stem, db)))
      if (is.null(x) || is.null(y)) return(NA_character_)
      sprintf("%d->%d", sum(x$padj < 0.05, na.rm = TRUE), sum(y$padj < 0.05, na.rm = TRUE))
    }, "")
    rows[[length(rows) + 1L]] <- data.table(dataset_dir = ds, stem = stem,
      de_rows_a2 = nrow(a), de_rows_a3 = nrow(b),
      rows_removed = paste(setdiff(a$symbol, b$symbol), collapse = ";"),
      rows_added = paste(setdiff(b$symbol, a$symbol), collapse = ";"),
      symbols_whose_features_changed = paste(sprintf("%s[%s -> %s]", changed$symbol, changed$features.a2, fifelse(is.na(changed$features.a3), "hidden", changed$features.a3)), collapse = "; "),
      fdr05_a2 = sum(a$padj < 0.05, na.rm = TRUE), fdr05_a3 = sum(b$padj < 0.05, na.rm = TRUE),
      max_abs_dlogFC_same_features = if (nrow(mu)) max(abs(mu$lfc_b - mu$lfc_a)) else NA_real_,
      max_abs_dFDR_same_features = if (nrow(mu)) max(abs(mu$fdr_b - mu$fdr_a)) else NA_real_,
      fgsea_padj05_hallmark = fg[["HALLMARK"]], fgsea_padj05_kegg = fg[["KEGG"]],
      fgsea_padj05_go_bp = fg[["GO_BP"]], fgsea_padj05_reactome = fg[["REACTOME"]])
  }
}
res <- rbindlist(rows); fwrite(res, out, sep = "\t", eol = "\n")
options(width = 250); print(res)
