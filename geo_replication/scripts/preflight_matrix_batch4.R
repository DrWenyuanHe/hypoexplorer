#!/usr/bin/env Rscript
# Config-free preflight for the four accepted datasets in matrix batch 4.
# This deliberately does not read or edit config/datasets.tsv. It validates the
# exact candidate rows below and exercises the corresponding canonical DE
# front-end through a finite fitted result.

suppressPackageStartupMessages({
  library(edgeR)
  library(limma)
  library(msigdbr)
})

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))
cfg <- data.frame(
  id = c("GSE104255", "GSE141144", "GSE202003", "GSE227725"),
  dir = c(
    "datasets/GSE104255_ggal_hypothalamus",
    "datasets/GSE141144_drer_hypothalamus_flx",
    "datasets/GSE202003_ggal_hypothalamus_lcitrulline",
    "datasets/GSE227725_sscr_hypothalamus_mia"
  ),
  organism = c("Gallus gallus", "Danio rerio", "Gallus gallus", "Sus scrofa"),
  id_type = "SYMBOL", id_col = "symbol", id_map = NA_character_,
  input_kind = c("counts", "counts", "counts", "matrix"),
  input_path = c(
    "datasets/GSE104255_ggal_hypothalamus/raw/GSE104255_hypothalamus_6wk_vs_3wk_counts.tsv.gz",
    "datasets/GSE141144_drer_hypothalamus_flx/raw/GSE141144_adult_hypothalamus_FLX_vs_control_counts.tsv.gz",
    "datasets/GSE202003_ggal_hypothalamus_lcitrulline/raw/GSE202003_hypothalamus_LCit_vs_basal_24C_counts.tsv.gz",
    "datasets/GSE227725_sscr_hypothalamus_mia/raw/GSE227725_nursed_MIA_vs_control_log2tpm.tsv.gz"
  ),
  samplesheet = c(
    "datasets/GSE104255_ggal_hypothalamus/metadata/GSE104255_samplesheet.tsv",
    "datasets/GSE141144_drer_hypothalamus_flx/metadata/GSE141144_samplesheet.tsv",
    "datasets/GSE202003_ggal_hypothalamus_lcitrulline/metadata/GSE202003_samplesheet.tsv",
    "datasets/GSE227725_sscr_hypothalamus_mia/metadata/GSE227725_samplesheet.tsv"
  ),
  batch_var = c(NA_character_, NA_character_, NA_character_, "sex"), status = "ready",
  stringsAsFactors = FALSE
)

supported <- msigdbr_species()$species_name
for (i in seq_len(nrow(cfg))) {
  r <- cfg[i, ]; id <- r$id; ds <- file.path(ROOT, r$dir)
  if (!r$organism %in% supported) stop(id, ": organism unsupported by the canonical MSigDB front-end")
  input <- file.path(ROOT, r$input_path); sheet <- file.path(ROOT, r$samplesheet)
  if (!file.exists(input) || !file.exists(sheet)) stop(id, ": candidate input or samplesheet missing")
  ss <- read.delim(sheet, check.names = FALSE, stringsAsFactors = FALSE)
  if (!all(c("sample", "group") %in% names(ss)) || anyDuplicated(ss$sample) ||
      !identical(sort(unique(ss$group)), c("case", "control")) || any(table(ss$group) < 3L)) stop(id, ": invalid independent two-arm samplesheet")
  ss$group <- factor(ss$group, levels = c("control", "case"))
  use_batch <- !is.na(r$batch_var) && r$batch_var %in% names(ss) && length(unique(ss[[r$batch_var]])) > 1L
  if (use_batch) {
    ss$.batch <- factor(ss[[r$batch_var]])
    design <- model.matrix(~ .batch + group, data = ss)
  } else {
    design <- model.matrix(~ group, data = ss)
  }
  if (qr(design)$rank != ncol(design) || !"groupcase" %in% colnames(design)) stop(id, ": design matrix is not full-rank")

  d <- read.delim(gzfile(input), check.names = FALSE, stringsAsFactors = FALSE)
  if (!r$id_col %in% names(d)) stop(id, ": configured identifier column absent")
  ids <- as.character(d[[r$id_col]])
  if (anyNA(ids) || any(!nzchar(ids)) || anyDuplicated(ids)) stop(id, ": blank or duplicate analysis-ready identifiers")
  if (!all(ss$sample %in% names(d))) stop(id, ": samplesheet columns absent from matrix")
  M <- as.matrix(d[, ss$sample, drop = FALSE]); storage.mode(M) <- "double"; rownames(M) <- ids
  if (any(!is.finite(M)) || any(M < 0)) stop(id, ": nonfinite or negative analysis-ready values")

  if (r$input_kind == "counts") {
    if (any(M != round(M))) stop(id, ": audited integer source changed")
    y <- DGEList(counts = M); keep <- filterByExpr(y, design)
    y <- y[keep, , keep.lib.sizes = FALSE]; y <- calcNormFactors(y); y <- estimateDisp(y, design)
    fit <- glmQLFit(y, design); tt <- topTags(glmQLFTest(fit, coef = "groupcase"), n = Inf)$table
    finite_tests <- sum(is.finite(tt$logFC) & is.finite(tt$PValue) & is.finite(tt$FDR))
    retained <- nrow(tt); front_end <- "edgeR-QL"
  } else {
    rv <- apply(M, 1L, var); keep <- is.finite(rv) & rv > 1e-8; fit <- eBayes(lmFit(M[keep, , drop = FALSE], design))
    tt <- topTable(fit, coef = "groupcase", number = Inf, sort.by = "none")
    finite_tests <- sum(is.finite(tt$logFC) & is.finite(tt$P.Value) & is.finite(tt$adj.P.Val))
    retained <- nrow(tt); front_end <- "limma"
  }
  if (retained < 1000L || finite_tests != retained) stop(id, ": canonical front-end did not yield a complete finite result")

  report <- data.frame(
    dataset = id, status = "PASS", organism_supported = TRUE,
    input_kind = r$input_kind, front_end = front_end, design = paste(colnames(design), collapse = " + "), design_rank = qr(design)$rank,
    control_samples = sum(ss$group == "control"), case_samples = sum(ss$group == "case"), matrix_rows = nrow(M), matrix_columns = ncol(M),
    nonfinite_values = sum(!is.finite(M)), negative_values = sum(M < 0), fractional_values = sum(M != round(M)),
    retained_features = retained, finite_fitted_tests = finite_tests, candidate_status = r$status,
    stringsAsFactors = FALSE
  )
  write.table(report, file.path(ds, "processed", paste0(id, "_preflight.tsv")), sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n")
  write.table(r, file.path(ds, "metadata", paste0(id, "_candidate_config_row.tsv")), sep = "\t", quote = FALSE, row.names = FALSE, na = "NA", eol = "\n")
  cat(sprintf("[%s] PASS: %s; design=%s; retained=%d/%d; finite=%d\n", id, front_end, paste(colnames(design), collapse = "+"), retained, nrow(M), finite_tests))
}
