#!/usr/bin/env Rscript
# R 4.6.0 regeneration variant of geo_replication/scripts/run_dataset.R (sealed original left byte-identical).
# Shared rules: scripts/lib/de_common.R; orchestrated by scripts/regenerate_bulk_de.R.
# =============================================================================
# Standardized replication pipeline — single dataset (count-level standardization)
#
#   raw counts        -> edgeR-QL (filterByExpr -> TMM -> glmQLFTest)   [stat = sign(logFC)*F]
#   normalized matrix -> limma   (lmFit -> eBayes)                      [stat = moderated t]
#                         |  (common schema)  v
#   <id>_DE.tsv  +  <id>_panel.tsv  +  <id>_fgsea.tsv
#
# Both front-ends converge to one DE schema, one fgsea step (Reactome IGF-transport
# pathway + Type-1-IGF1R negative control), and one panel readout.
# See docs/STANDARD_PIPELINE.md and docs/ANALYSIS_TARGET.md.
#
# Features are mapped to their final public symbol and aggregated BEFORE the
# test (counts summed, log matrices averaged); count estimates stay unrounded.
# Each run also writes <id>_CPM_raw / <id>_CPM_TMM (counts) or <id>_expression
# (matrix), <id>_feature_map, <id>_provenance.tsv and <id>_sessionInfo.txt.
# The shared rules live in scripts/lib/de_common.R.
#
# Usage:  Rscript scripts/regen-r460/run_dataset_r460.R <DATASET_ID>
#   HYPO_OUT_ROOT=<dir>   write to <dir>/<dataset dir>/processed instead of the repo
#   HYPO_SKIP_FGSEA=1     skip the focal fgsea step
# =============================================================================
suppressPackageStartupMessages({
  library(edgeR); library(limma); library(AnnotationDbi)
})

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value=TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), "..", "..", "geo_replication"))   # .../geo_replication
source(file.path(ROOT, "..", "scripts", "lib", "de_common.R"))
de_init(file.path(ROOT, ".."))

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 1) stop("usage: run_dataset.R <DATASET_ID>")
id <- args[1]

cfg <- read.delim(file.path(ROOT, "config", "datasets.tsv"), stringsAsFactors = FALSE)
r <- cfg[cfg$id == id, ]
if (nrow(r) != 1) stop(sprintf("dataset id '%s' not found in config/datasets.tsv", id))
cat(sprintf("[%s] %s | id_type=%s | input_kind=%s\n", id, r$organism, r$id_type, r$input_kind))

# ---- load, harmonize to the final public symbol, aggregate (rule A) ----------
prep <- prepare_config_dataset(r)
cat(sprintf("  groups: control=%d  case=%d\n", sum(prep$ss$group=="control"), sum(prep$ss$group=="case")))
a <- prep$agg
cat(sprintf("  features: %d raw -> %d symbols (%d unmapped, kept in the fit, %d collapsed into shared symbols)\n",
            a$n_features_raw, a$n_symbols_after_aggregation, a$n_unmapped_in_fit, a$n_features_collapsed))
cat(sprintf("  design: %s\n", paste(colnames(prep$design), collapse=" + ")))

# ---- DE (front-end by input kind) -----------------------------------------
res <- run_config_de(prep)
if (r$input_kind != "counts") cat(sprintf("  filtered to %d expressed (non-constant) genes\n", res$n_tested))

procdir <- dataset_output_dir(r$dir, "processed")
out <- write_config_outputs(prep, res, id, procdir, generators = de_script_path())
de <- out$de
cat(sprintf("  DE: %d genes -> %s\n", nrow(de), repo_rel(out$de_path)))

# ---- panel readout ---------------------------------------------------------
pan <- de[toupper(de$symbol) %in% PANEL, c("symbol","logFC","stat","pvalue","padj","direction")]
cat("  panel readout:\n"); if (nrow(pan)) print(pan[order(pan$logFC), ], row.names = FALSE) else cat("    (no panel genes detected)\n")

if (nzchar(Sys.getenv("HYPO_SKIP_FGSEA", ""))) {
  cat(sprintf("[%s] done (focal fgsea skipped: HYPO_SKIP_FGSEA).\n", id))
  quit(save = "no", status = 0)
}
suppressPackageStartupMessages({ library(fgsea); library(msigdbr) })

# ---- fgsea: Reactome IGF-transport pathway + negative control --------------
msig <- tryCatch(msigdbr(species = r$organism, collection = "C2", subcollection = "CP:REACTOME"),
                 error = function(e) msigdbr(species = r$organism, category = "C2", subcategory = "CP:REACTOME"))
paths <- split(msig$gene_symbol, msig$gs_name)
ranks <- de$stat; names(ranks) <- de$symbol
ranks <- ranks[is.finite(ranks) & !duplicated(names(ranks))]; ranks <- sort(ranks)
set.seed(42)  # fgsea multilevel sampling is stochastic — seed for reproducible NES/padj
fg <- fgsea(pathways = paths, stats = ranks, eps = 0)
fg$leadingEdge <- vapply(fg$leadingEdge, function(x) paste(x, collapse = ";"), character(1))
sel <- fg[grepl("IGF_TRANSPORT_AND_UPTAKE", fg$pathway) |
          grepl("SIGNALING_BY_TYPE_1.*IGF1R|TYPE_1_INSULIN_LIKE_GROWTH_FACTOR_1_RECEPTOR", fg$pathway), ]
sel$dataset <- rep(id, nrow(sel))
write_table_lf(sel, file.path(procdir, paste0(id, "_fgsea.tsv")))
cat("  fgsea (focal pathways):\n")
if (nrow(sel)) print(sel[, c("pathway","NES","pval","padj","size")], row.names = FALSE) else cat("    (focal pathways not found)\n")
cat(sprintf("[%s] done.\n", id))
