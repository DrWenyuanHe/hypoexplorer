#!/usr/bin/env Rscript
# Audit every group of features that share one final public symbol in the
# staged R 4.6.0 regeneration, using the same classifier as rule A3
# (classify_symbol_groups in scripts/lib/de_common.R).
#
# Inputs, per staged dataset directory under <staging root>:
#   processed/<stem>_feature_map.tsv.gz   (config, supported-matrix, dedicated
#                                          producers; batch-1 "__dupN" row ids
#                                          are reduced to their source label)
#   metadata/<base>_gene_map.tsv          (HFD / September 5 intake drivers)
# Outputs (in <out dir>):
#   duplicate_groups_audit.tsv   one row per dataset feature map: group counts per class
#   duplicate_groups_detail.tsv  one row per group: class, labels, exact-label
#                                features, what rule A3 publishes
#
# Usage: Rscript scripts/regen-r460/audit_duplicate_groups_r460.R <staging root> <out dir>
suppressPackageStartupMessages(library(data.table))
local({
  f <- grep("^--file=", commandArgs(FALSE), value = TRUE)
  repo <- dirname(dirname(dirname(normalizePath(sub("^--file=", "", f[[1L]])))))
  source(file.path(repo, "scripts", "lib", "de_common.R"), local = globalenv())
  de_init(repo)
})
args <- commandArgs(trailingOnly = TRUE)
stage <- args[[1]]; out <- args[[2]]
dir.create(out, recursive = TRUE, showWarnings = FALSE)

maps <- list()
for (d in list.dirs(stage, recursive = FALSE)) {
  for (f in list.files(file.path(d, "processed"), pattern = "_feature_map\\.tsv\\.gz$", full.names = TRUE)) {
    fm <- read.delim(gzfile(f), colClasses = "character", na.strings = "NA", quote = "")
    maps[[length(maps) + 1L]] <- list(dataset_dir = basename(d), map = sub("_feature_map\\.tsv\\.gz$", "", basename(f)),
      source = "feature_map", labels = sub("__dup[0-9]+$", "", fm$feature_id), symbols = fm$symbol)
  }
  for (f in list.files(file.path(d, "metadata"), pattern = "_gene_map\\.tsv$", full.names = TRUE)) {
    gm <- fread(f, colClasses = "character", na.strings = "NA")
    maps[[length(maps) + 1L]] <- list(dataset_dir = basename(d), map = sub("_gene_map\\.tsv$", "", basename(f)),
      source = "intake_gene_map", labels = gm$gene_id, symbols = gm$symbol)
  }
}

summary_rows <- list(); detail_rows <- list()
for (m in maps) {
  g <- classify_symbol_groups(m$labels, m$symbols)
  mapped <- !is.na(m$symbols) & nzchar(m$symbols)
  single_date <- sum(mapped & is_date_label(m$labels) & !(m$symbols %in% g$symbol))
  if (nrow(g)) {
    g[, `:=`(dataset_dir = m$dataset_dir, map = m$map,
             a3_action = fifelse(class %in% c("i_stable_ids", "ii_identical"), "summed",
                          fifelse(n_exact > 0, "publish exact-label feature(s) only", "symbol hidden")),
             published_identity_changed = class %in% c("ii_date_damaged", "iii_symbol_labels"))]
    detail_rows[[length(detail_rows) + 1L]] <- g
  }
  cnt <- function(k) sum(g$class == k)
  summary_rows[[length(summary_rows) + 1L]] <- data.table(
    dataset_dir = m$dataset_dir, map = m$map, source = m$source,
    n_features = length(m$labels), n_mapped = sum(mapped), n_groups = nrow(g),
    i_stable_ids = cnt("i_stable_ids"), ii_identical = cnt("ii_identical"),
    ii_date_damaged = cnt("ii_date_damaged"), iii_symbol_labels = cnt("iii_symbol_labels"),
    features_in_i = sum(g[class == "i_stable_ids", n_features]),
    features_in_ii_identical = sum(g[class == "ii_identical", n_features]),
    features_in_ii_date = sum(g[class == "ii_date_damaged", n_features]),
    features_in_iii = sum(g[class == "iii_symbol_labels", n_features]),
    a3_symbols_hidden = sum(g$class %in% c("ii_date_damaged", "iii_symbol_labels") & g$n_exact == 0),
    a3_symbols_reduced_to_exact = sum(g$class %in% c("ii_date_damaged", "iii_symbol_labels") & g$n_exact > 0),
    singleton_date_labels_published = single_date,
    affected_by_a3 = any(g$class %in% c("ii_date_damaged", "iii_symbol_labels")))
}
summ <- rbindlist(summary_rows)[order(dataset_dir, map)]
det <- rbindlist(detail_rows, fill = TRUE)
if (nrow(det)) setcolorder(det, c("dataset_dir", "map", "symbol", "class", "n_features", "n_exact", "labels", "a3_action", "published_identity_changed"))
fwrite(summ, file.path(out, "duplicate_groups_audit.tsv"), sep = "\t", eol = "\n")
fwrite(det[order(dataset_dir, map, class, symbol)], file.path(out, "duplicate_groups_detail.tsv"), sep = "\t", eol = "\n")
cat(sprintf("%d feature maps, %d groups: %s; affected maps %d\n", nrow(summ), nrow(det),
            paste(names(table(det$class)), table(det$class), sep = "=", collapse = " "), sum(summ$affected_by_a3)))
