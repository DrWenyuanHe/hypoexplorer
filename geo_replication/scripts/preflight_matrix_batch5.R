#!/usr/bin/env Rscript
# Config-free preflight for matrix batch 5. This validates the exact candidate
# rows below without reading or editing the shared dataset registry.

suppressPackageStartupMessages({
  library(edgeR)
  library(limma)
  library(msigdbr)
})

get_script_dir <- function() {
  a <- commandArgs(FALSE)
  f <- grep("^--file=", a, value = TRUE)
  if (length(f)) dirname(normalizePath(sub("^--file=", "", f[1L]))) else getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))

cfg <- data.frame(
  id = c("GSE245146", "GSE266472", "GSE278826", "GSE281726", "GSE299412"),
  dir = c(
    "datasets/GSE245146_sscr_hypothalamus_mia",
    "datasets/GSE266472_mmus_scn_photoperiod",
    "datasets/GSE278826_ggal_hypothalamus_rfi",
    "datasets/GSE281726_sscr_hypothalamus",
    "datasets/GSE299412_drer_hypothalamus"
  ),
  organism = c("Sus scrofa", "Mus musculus", "Gallus gallus", "Sus scrofa", "Danio rerio"),
  id_type = c("SYMBOL", "ENSEMBL", "SYMBOL", "SYMBOL", "SYMBOL"),
  id_col = c("symbol", "gene_id", "symbol", "symbol", "symbol"),
  id_map = NA_character_,
  input_kind = c("matrix", "counts", "counts", "counts", "counts"),
  input_path = c(
    "datasets/GSE245146_sscr_hypothalamus_mia/raw/GSE245146_saline_PRRSV_vs_control_log2tpm.tsv.gz",
    "datasets/GSE266472_mmus_scn_photoperiod/raw/GSE266472_SCN_pZT12_long_vs_short_counts.tsv.gz",
    "datasets/GSE278826_ggal_hypothalamus_rfi/raw/GSE278826_hypothalamus_high_vs_low_RFI_counts.tsv.gz",
    "datasets/GSE281726_sscr_hypothalamus/raw/GSE281726_hypothalamus_ALAC_vs_WPI_counts.tsv.gz",
    "datasets/GSE299412_drer_hypothalamus/raw/GSE299412_male_hypothalamus_cyp19a1b_mutant_counts.tsv.gz"
  ),
  samplesheet = c(
    "datasets/GSE245146_sscr_hypothalamus_mia/metadata/GSE245146_samplesheet.tsv",
    "datasets/GSE266472_mmus_scn_photoperiod/metadata/GSE266472_samplesheet.tsv",
    "datasets/GSE278826_ggal_hypothalamus_rfi/metadata/GSE278826_samplesheet.tsv",
    "datasets/GSE281726_sscr_hypothalamus/metadata/GSE281726_samplesheet.tsv",
    "datasets/GSE299412_drer_hypothalamus/metadata/GSE299412_samplesheet.tsv"
  ),
  batch_var = c("sex", "seq_batch", NA_character_, "sex", NA_character_),
  status = "ready",
  stringsAsFactors = FALSE
)

supported <- msigdbr_species()$species_name
for (i in seq_len(nrow(cfg))) {
  r <- cfg[i, ]
  id <- r$id
  ds <- file.path(ROOT, r$dir)
  if (!r$organism %in% supported) stop(id, ": unsupported pathway organism")

  input <- file.path(ROOT, r$input_path)
  sheet <- file.path(ROOT, r$samplesheet)
  if (!file.exists(input) || !file.exists(sheet)) stop(id, ": missing candidate input or samplesheet")
  ss <- read.delim(sheet, check.names = FALSE, stringsAsFactors = FALSE)
  if (!all(c("sample", "group") %in% names(ss)) || anyDuplicated(ss$sample) ||
      !identical(sort(unique(ss$group)), c("case", "control")) || any(table(ss$group) < 3L)) {
    stop(id, ": invalid independent two-arm samplesheet")
  }
  ss$group <- factor(ss$group, levels = c("control", "case"))
  use_batch <- !is.na(r$batch_var) && r$batch_var %in% names(ss) &&
    length(unique(ss[[r$batch_var]])) > 1L
  if (use_batch) {
    ss$.batch <- factor(ss[[r$batch_var]])
    design <- model.matrix(~ .batch + group, data = ss)
  } else {
    design <- model.matrix(~ group, data = ss)
  }
  if (qr(design)$rank != ncol(design) || !"groupcase" %in% colnames(design)) {
    stop(id, ": design matrix is not full-rank")
  }

  d <- read.delim(gzfile(input), check.names = FALSE, stringsAsFactors = FALSE)
  if (!r$id_col %in% names(d)) stop(id, ": configured identifier column absent")
  ids <- as.character(d[[r$id_col]])
  if (anyNA(ids) || any(!nzchar(ids)) || anyDuplicated(ids)) stop(id, ": invalid analysis identifiers")
  if (!all(ss$sample %in% names(d))) stop(id, ": samplesheet columns absent from matrix")
  M <- as.matrix(d[, ss$sample, drop = FALSE])
  storage.mode(M) <- "double"
  rownames(M) <- ids
  if (any(!is.finite(M)) || any(M < 0)) stop(id, ": nonfinite or negative values")

  if (r$input_kind == "counts") {
    y <- DGEList(counts = M)
    keep <- filterByExpr(y, design)
    y <- y[keep, , keep.lib.sizes = FALSE]
    y <- calcNormFactors(y)
    y <- estimateDisp(y, design)
    fit <- glmQLFit(y, design)
    tt <- topTags(glmQLFTest(fit, coef = "groupcase"), n = Inf)$table
    finite_tests <- sum(is.finite(tt$logFC) & is.finite(tt$PValue) & is.finite(tt$FDR))
    retained <- nrow(tt)
    front_end <- "edgeR-QL"
  } else {
    rv <- apply(M, 1L, var)
    keep <- is.finite(rv) & rv > 1e-8
    fit <- eBayes(lmFit(M[keep, , drop = FALSE], design))
    tt <- topTable(fit, coef = "groupcase", number = Inf, sort.by = "none")
    finite_tests <- sum(is.finite(tt$logFC) & is.finite(tt$P.Value) & is.finite(tt$adj.P.Val))
    retained <- nrow(tt)
    front_end <- "limma"
  }
  if (retained < 1000L || finite_tests != retained) stop(id, ": incomplete canonical fitted result")

  report <- data.frame(
    dataset = id, status = "PASS", organism_supported = TRUE,
    input_kind = r$input_kind, front_end = front_end,
    design = paste(colnames(design), collapse = " + "), design_rank = qr(design)$rank,
    control_samples = sum(ss$group == "control"), case_samples = sum(ss$group == "case"),
    matrix_rows = nrow(M), matrix_columns = ncol(M),
    library_size_min = if (r$input_kind == "counts") min(colSums(M)) else NA_real_,
    library_size_max = if (r$input_kind == "counts") max(colSums(M)) else NA_real_,
    expression_min = min(M), expression_max = max(M),
    nonfinite_values = sum(!is.finite(M)), negative_values = sum(M < 0),
    fractional_values = sum(M != round(M)), retained_features = retained,
    finite_fitted_tests = finite_tests, candidate_status = r$status,
    stringsAsFactors = FALSE
  )
  write.table(report, file.path(ds, "processed", paste0(id, "_preflight.tsv")),
              sep = "\t", quote = FALSE, row.names = FALSE, na = "NA", eol = "\n")
  write.table(r, file.path(ds, "metadata", paste0(id, "_candidate_config_row.tsv")),
              sep = "\t", quote = FALSE, row.names = FALSE, na = "NA", eol = "\n")
  cat(sprintf("[%s] PASS: %s; design=%s; retained=%d/%d; finite=%d\n",
              id, front_end, paste(colnames(design), collapse = "+"),
              retained, nrow(M), finite_tests))
}
