#!/usr/bin/env Rscript
# R 4.6.0 regeneration variant of scripts/prep_supported_matrix_batch1.R (sealed original left byte-identical).
# Shared rules: scripts/lib/de_common.R; orchestrated by scripts/regenerate_bulk_de.R.

# Prepare and run the standard bulk-RNA pipeline for a tracker-defined batch
# whose inputs are author-deposited count or normalized-expression matrices.
#
# This script is intentionally self-contained: it does not mutate shared
# dataset config, registry, tracker, or bundle-builder files.  Every generated
# artifact is written under one of the five dataset-specific directories.
#
# Usage:
#   Rscript scripts/regen-r460/supported_matrix_r460.R
#   Rscript scripts/regen-r460/supported_matrix_r460.R GSE128148 GSE167105

suppressPackageStartupMessages({
  library(data.table)
  library(edgeR)
  library(limma)
  library(fgsea)
  library(msigdbr)
  library(AnnotationDbi)
  library(BiocParallel)
  library(digest)
})

PANEL <- c(
  "IGFBP2", "IGFBP5", "IGFBP6", "IGFBP7", "IGF1R", "IRS2", "IGF1",
  "INSR", "PAPPA", "IGFBP1", "IGFBP3", "IGFBP4"
)
FGSEA_MIN <- 15L
FGSEA_MAX <- 500L
ACCESS_DATE <- "2026-09-01"

get_script_dir <- function() {
  args <- commandArgs(FALSE)
  file_arg <- grep("^--file=", args, value = TRUE)
  if (length(file_arg)) dirname(normalizePath(sub("^--file=", "", file_arg[[1L]]))) else getwd()
}

ROOT <- normalizePath(file.path(get_script_dir(), "..", ".."), winslash = "/", mustWork = TRUE)
DATA_ROOT <- file.path(ROOT, "geo_replication", "datasets")
# Shared DE rules (symbol aggregation before testing, provenance records,
# HYPO_OUT_ROOT output redirection): scripts/lib/de_common.R. Its repo_rel()
# replaces this script's former local copy.
source(file.path(ROOT, "scripts", "lib", "de_common.R"))
de_init(ROOT)
SKIP_FGSEA <- nzchar(Sys.getenv("HYPO_SKIP_FGSEA", ""))

DATASET_DIRS <- c(
  `E-MTAB-12340` = "EMTAB12340_mmus_hypothalamus_puberty",
  GSE128148 = "GSE128148_mmus_arc_corticosterone",
  GSE156859 = "GSE156859_rnor_fetal_hypothalamus_ozone",
  GSE167105 = "GSE167105_mmus_hypothalamus_thrb",
  GSE189945 = "GSE189945_mmus_arc_development"
)

requested <- commandArgs(trailingOnly = TRUE)
if (!length(requested)) requested <- names(DATASET_DIRS)
unknown <- setdiff(requested, names(DATASET_DIRS))
if (length(unknown)) stop("unknown dataset id(s): ", paste(unknown, collapse = ", "))

dataset_dir <- function(id) file.path(DATA_ROOT, unname(DATASET_DIRS[[id]]))
# Where this run WRITES (the repository, or the HYPO_OUT_ROOT overlay); sources
# are always read from dataset_dir().
out_dir <- function(id, sub) dataset_output_dir(file.path("datasets", unname(DATASET_DIRS[[id]])), sub)

qc_stop <- function(message) {
  cond <- structure(
    list(message = paste0("QC_FAILURE: ", message), call = NULL),
    class = c("dataset_qc_failure", "error", "condition")
  )
  stop(cond)
}

assert_qc <- function(ok, message) {
  if (!isTRUE(ok)) qc_stop(message)
}

write_tsv <- function(x, path) {
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  write_tsv_lf(x, path)
}

# The prepared matrix keeps one row per SOURCE feature, with its final public
# symbol (NA = no symbol, dropped before testing); aggregation happens in run_de.
write_matrix <- function(ds) {
  out <- data.table(gene_id = ds$ids, symbol = ds$final_symbols)
  out <- cbind(out, as.data.table(ds$mat, keep.rownames = FALSE))
  write_tsv(out, ds$prepared_path)
}

write_local_id_map <- function(ds) {
  if (ds$input_kind != "matrix") return(invisible(NULL))
  path <- file.path(out_dir(ds$id, "metadata"), paste0(ds$id, "_id_map.tsv"))
  fwrite(
    data.table(gene_id = ds$ids, symbol = ds$final_symbols), path,
    sep = "\t", quote = FALSE, na = "NA", col.names = FALSE, eol = "\n"
  )
  invisible(path)
}

# Rule A (scripts/lib/de_common.R): final public symbol per source feature;
# counts summed and log matrices averaged per symbol BEFORE the fit; features
# without a symbol stay in the fit as raw-id rows and are not published.
# `aggregate_scale` is declared by each preparer.
final_symbols_for <- function(ds) {
  s <- as.character(ds$symbols)
  s[grepl("^UNANNOT_ROW_[0-9]+$", s)] <- NA_character_
  # Unmapped Ensembl ids reach the gate as themselves so mouse ids can resolve
  # through MGI; everything else without a symbol is unpublished.
  normalize_gene(s)
}

aggregate_dataset <- function(ds) {
  # Rule A3 compares SOURCE labels; stable_symbol_ids() suffixed repeats with "__dupN".
  ds$source_labels <- sub("__dup[0-9]+$", "", ds$ids)
  # A3.1: 1-Mar / 2-Mar labels resolved only by another column of the source row.
  mar <- resolve_ambiguous_mar(ds$source_labels, ds$final_symbols, ds$organism,
                               if (is.null(ds$extra_columns)) list() else ds$extra_columns)
  ds$final_symbols <- mar$symbols
  ag <- aggregate_by_symbol(ds$mat, ds$final_symbols, ds$aggregate_scale, labels = mar$labels,
                            resolved_by = mar$resolved_by)
  ag$info$mar_resolution <- mar$note
  ds$agg <- ag$info
  ds$feature_map <- ag$feature_map
  ds$analysis_mat <- ag$mat
  ds$published <- ag$published
  ds$qc_analysis_mat <- if (ds$input_kind == "counts") {
    count_qc_matrix(aggregate_by_symbol(ds$qc_counts, ds$final_symbols, "counts", labels = mar$labels,
                                        resolved_by = mar$resolved_by)$mat)
  } else ag$mat
  ds
}

sha256_file <- function(path) digest(path, algo = "sha256", file = TRUE, serialize = FALSE)

write_source_manifest <- function(id, entries) {
  stopifnot(all(c("role", "path", "url", "format", "semantics") %in% names(entries)))
  missing <- !file.exists(entries$path)
  assert_qc(!any(missing), paste("missing source file(s):", paste(entries$path[missing], collapse = ", ")))
  out <- data.table(
    dataset = id,
    role = entries$role,
    local_path = vapply(entries$path, repo_rel, character(1)),
    source_url = entries$url,
    format = entries$format,
    documented_semantics = entries$semantics,
    bytes = as.numeric(file.info(entries$path)$size),
    sha256 = vapply(entries$path, sha256_file, character(1)),
    accessed = ACCESS_DATE
  )
  write_tsv(out, file.path(out_dir(id, "metadata"), paste0(id, "_source_files.tsv")))
  out
}

first_soft_field <- function(block, prefix, ignore.case = FALSE) {
  hit <- grep(prefix, block, value = TRUE, ignore.case = ignore.case)
  if (!length(hit)) return(NA_character_)
  sub(prefix, "", hit[[1L]], ignore.case = ignore.case)
}

read_geo_soft_samples <- function(path) {
  lines <- readLines(gzfile(path), warn = FALSE)
  starts <- which(startsWith(lines, "^SAMPLE = "))
  assert_qc(length(starts) > 0L, paste("no sample blocks in", basename(path)))
  ends <- c(starts[-1L] - 1L, length(lines))
  rbindlist(lapply(seq_along(starts), function(i) {
    block <- lines[starts[[i]]:ends[[i]]]
    data.table(
      gsm = sub("^\\^SAMPLE = ", "", block[[1L]]),
      title = first_soft_field(block, "^!Sample_title = "),
      source = first_soft_field(block, "^!Sample_source_name_ch1 = "),
      tissue = first_soft_field(block, "^!Sample_characteristics_ch1 = tissue: ", TRUE),
      age = first_soft_field(block, "^!Sample_characteristics_ch1 = age: ", TRUE),
      sex = first_soft_field(block, "^!Sample_characteristics_ch1 = sex: ", TRUE),
      exposure = first_soft_field(block, "^!Sample_characteristics_ch1 = exposure: ", TRUE),
      treatment = first_soft_field(block, "^!Sample_characteristics_ch1 = treatment: ", TRUE),
      treatment_length = first_soft_field(block, "^!Sample_characteristics_ch1 = treatment length: ", TRUE),
      biosample = first_soft_field(
        block,
        "^!Sample_relation = BioSample: https://www.ncbi.nlm.nih.gov/biosample/"
      ),
      srx = first_soft_field(
        block,
        "^!Sample_relation = SRA: https://www.ncbi.nlm.nih.gov/sra\\?term="
      )
    )
  }), fill = TRUE)
}

map_ensembl_symbols <- function(ids, organism) {
  clean <- sub("\\..*$", "", ids)
  if (organism == "Mus musculus") {
    suppressPackageStartupMessages(library(org.Mm.eg.db))
    db <- org.Mm.eg.db
  } else if (organism == "Rattus norvegicus") {
    suppressPackageStartupMessages(library(org.Rn.eg.db))
    db <- org.Rn.eg.db
  } else {
    stop("unsupported Ensembl organism: ", organism)
  }
  keys <- unique(clean)
  mapped <- AnnotationDbi::mapIds(
    db, keys = keys, keytype = "ENSEMBL", column = "SYMBOL", multiVals = "first"
  )
  symbols <- unname(mapped[clean])
  symbols[is.na(symbols) | !nzchar(symbols)] <- ids[is.na(symbols) | !nzchar(symbols)]
  symbols
}

stable_symbol_ids <- function(symbols) {
  ids <- as.character(symbols)
  blank <- is.na(ids) | !nzchar(ids) | ids == "NA"
  ids[blank] <- paste0("UNANNOT_ROW_", which(blank))
  make.unique(ids, sep = "__dup")
}

qc_metric <- function(metric, value, status = "INFO", note = "") {
  data.table(metric = metric, value = as.character(value), status = status, note = note)
}

qc_sample_table <- function(mat, samplesheet) {
  assert_qc(identical(colnames(mat), samplesheet$sample), "QC matrix columns do not match samplesheet order")
  rv <- apply(mat, 1L, var)
  top <- order(rv, decreasing = TRUE, na.last = NA)
  top <- head(top, min(5000L, length(top)))
  assert_qc(length(top) >= 2L, "fewer than two variable genes available for sample QC")

  qc_mat <- mat[top, , drop = FALSE]
  cors <- suppressWarnings(cor(mat, method = "pearson", use = "pairwise.complete.obs"))
  diag(cors) <- NA_real_
  median_cor <- apply(cors, 2L, median, na.rm = TRUE)

  pca <- prcomp(t(qc_mat), center = TRUE, scale. = FALSE)
  pc1 <- pca$x[, 1L]
  pc2 <- if (ncol(pca$x) >= 2L) pca$x[, 2L] else rep(NA_real_, nrow(pca$x))

  out <- copy(samplesheet)
  out[, matrix_min := apply(mat, 2L, min)]
  out[, matrix_max := apply(mat, 2L, max)]
  out[, matrix_mean := colMeans(mat)]
  out[, matrix_sd := apply(mat, 2L, sd)]
  out[, median_correlation_to_other_samples := median_cor[sample]]
  out[, PC1 := pc1[sample]]
  out[, PC2 := pc2[sample]]
  out
}

count_qc_matrix <- function(counts) {
  y <- DGEList(counts = counts)
  y <- calcNormFactors(y)
  cpm(y, log = TRUE, prior.count = 1)
}

design_for <- function(samplesheet) {
  group <- factor(samplesheet$group, levels = c("control", "case"))
  assert_qc(!anyNA(group), "analysis samplesheet contains a group outside control/case")
  assert_qc(sum(group == "control") >= 3L, "fewer than three independent control biological units")
  assert_qc(sum(group == "case") >= 3L, "fewer than three independent case biological units")
  design <- model.matrix(~ group)
  assert_qc(qr(design)$rank == ncol(design), "design matrix is not full rank")
  list(group = group, design = design, coef = "groupcase")
}

edgeR_se <- function(fit, design, coef_name, gene_ids) {
  # QL-adjusted Wald SE (scripts/lib/de_common.R ql_wald_se): accepts edgeR
  # 4.10's s2.post as well as the older var.post, and fails closed.
  se_log2 <- tryCatch(ql_wald_se(fit, design, coef_name), error = function(e) qc_stop(paste("edgeR SE:", conditionMessage(e))))
  data.table(id = gene_ids, se = se_log2)[is.finite(se) & se > 0]
}

run_de <- function(ds) {
  ss <- ds$samplesheet[analysis_keep == TRUE]
  assert_qc(identical(colnames(ds$mat), ss$sample), "analysis matrix columns do not match retained samplesheet rows")
  assert_qc(!anyDuplicated(ss$biological_unit), "retained biological-unit identifiers are not independent")
  assert_qc(!anyDuplicated(ds$ids), "source gene identifiers are not unique")
  assert_qc(all(is.finite(ds$mat)), "analysis matrix contains non-finite values")
  design_info <- design_for(ss)
  design <- design_info$design
  coef_name <- design_info$coef
  # Rule A: the fit sees one row per final public symbol (aggregate_dataset).
  mat <- ds$analysis_mat
  assert_qc(!anyDuplicated(rownames(mat)), "aggregated symbols are not unique")

  if (ds$input_kind == "counts") {
    assert_qc(all(ds$mat >= 0), "count matrix contains negative values")
    assert_qc(all(abs(ds$mat - round(ds$mat)) < 1e-8), "count matrix contains non-integer values")
    y <- DGEList(counts = mat, group = design_info$group)
    keep <- filterByExpr(y, design = design)
    assert_qc(sum(keep) >= 100L, "filterByExpr retained fewer than 100 genes")
    y <- y[keep, , keep.lib.sizes = FALSE]
    y <- calcNormFactors(y)
    y <- estimateDisp(y, design)
    fit <- glmQLFit(y, design)
    qlf <- glmQLFTest(fit, coef = coef_name)
    tt <- topTags(qlf, n = Inf)$table
    ids <- rownames(tt)
    de <- data.table(
      id = ids,
      symbol = ids,
      logFC = tt$logFC,
      stat = sign(tt$logFC) * tt$F,
      pvalue = tt$PValue,
      padj = tt$FDR,
      method = "edgeR-QL"
    )
    se <- edgeR_se(fit, design, coef_name, rownames(fit$coefficients))
    analysis_values <- cpm(y, log = TRUE, prior.count = 1)
    filtered_genes <- nrow(y)
  } else if (ds$input_kind == "matrix") {
    row_var <- apply(mat, 1L, var)
    keep <- is.finite(row_var) & row_var > 1e-8
    assert_qc(sum(keep) >= 100L, "limma variance filter retained fewer than 100 genes")
    analysis_values <- mat[keep, , drop = FALSE]
    fit <- eBayes(lmFit(analysis_values, design))
    tt <- topTable(fit, coef = coef_name, number = Inf, sort.by = "none")
    ids <- rownames(analysis_values)
    coef_index <- match(coef_name, colnames(fit$coefficients))
    moderated_se <- fit$stdev.unscaled[, coef_index] * sqrt(fit$s2.post)
    se <- data.table(id = ids, se = moderated_se)[is.finite(se) & se > 0]
    de <- data.table(
      id = ids,
      symbol = ids,
      logFC = tt$logFC,
      stat = tt$t,
      pvalue = tt$P.Value,
      padj = tt$adj.P.Val,
      method = "limma"
    )
    filtered_genes <- nrow(analysis_values)
  } else {
    stop("unsupported input_kind: ", ds$input_kind)
  }

  # Unmapped rows were fitted (normalization, priors, BH family) but are not published.
  n_unmapped_tested <- sum(!(de$id %in% ds$published))
  de <- de[id %in% ds$published]
  se <- se[id %in% ds$published]
  de <- de[order(-abs(stat))]
  de[, direction := ifelse(logFC < 0, "down", "up")]
  assert_qc(nrow(de) >= 100L, "fewer than 100 DE rows")
  list(de = de, se = se, filtered_genes = filtered_genes, analysis_values = analysis_values,
       n_unmapped_tested = n_unmapped_tested, y = if (ds$input_kind == "counts") y else NULL)
}

GS_CACHE <- new.env(parent = emptyenv())
MSIGDB_AUTHORITY <- "HS" # repository standard: human MSigDB, ortholog-mapped by msigdbr

clear_ortholog_cache <- function(species) {
  if (MSIGDB_AUTHORITY != "HS" || species %in% c("Homo sapiens", "human")) return(invisible(NULL))
  species_id <- babelgene::species(species)$taxon_id
  assert_qc(length(species_id) == 1L && !is.na(species_id), "could not resolve target-species taxonomy id")
  cache <- get("pkg_env", envir = asNamespace("msigdbr"), inherits = FALSE)
  key <- paste0("orthologs", species_id)
  if (exists(key, envir = cache, inherits = FALSE)) rm(list = key, envir = cache)
  invisible(NULL)
}

msig_list <- function(species, collection, subcollections = NULL) {
  fetch <- function(subcollection) {
    # msigdbr 26.1.0 keys its ortholog cache only by target species. Clear it so
    # one collection cannot silently truncate the projection of the next.
    clear_ortholog_cache(species)
    tryCatch(
      msigdbr(db_species = MSIGDB_AUTHORITY, species = species, collection = collection, subcollection = subcollection),
      error = function(e) tryCatch(
        msigdbr(db_species = MSIGDB_AUTHORITY, species = species, category = collection, subcategory = subcollection),
        error = function(e2) NULL
      )
    )
  }
  table <- NULL
  attempts <- if (is.null(subcollections)) list(NULL) else subcollections
  for (subcollection in attempts) {
    table <- fetch(subcollection)
    if (!is.null(table) && nrow(table)) break
  }
  if (is.null(table) || !nrow(table)) return(list())
  split(table$gene_symbol, table$gs_name)
}

gene_sets <- function(species) {
  key <- make.names(species)
  if (exists(key, envir = GS_CACHE, inherits = FALSE)) return(get(key, envir = GS_CACHE))
  sets <- list(
    HALLMARK = msig_list(species, "H"),
    KEGG = msig_list(species, "C2", list("CP:KEGG_LEGACY", "CP:KEGG", "CP:KEGG_MEDICUS")),
    GO_BP = msig_list(species, "C5", list("GO:BP")),
    REACTOME = msig_list(species, "C2", list("CP:REACTOME"))
  )
  assert_qc(all(lengths(sets) > 0L), paste("one or more MSigDB collections unavailable for", species))
  assign(key, sets, envir = GS_CACHE)
  sets
}

run_fgsea <- function(id, species, de, proc_dir) {
  ranks <- de$stat
  names(ranks) <- de$symbol
  keep <- is.finite(ranks) & !is.na(names(ranks)) & nzchar(names(ranks))
  ranks <- ranks[keep]
  ranks <- ranks[!duplicated(names(ranks))]
  assert_qc(length(ranks) >= FGSEA_MIN, "fewer than 15 unique ranked symbols for FGSEA")

  set.seed(42)
  ranks <- ranks + runif(length(ranks), 0, 1e-7)
  ranks <- sort(ranks, decreasing = TRUE)
  sets <- gene_sets(species)
  results <- list()
  for (database in names(sets)) {
    set.seed(42)
    result <- fgsea(
      pathways = sets[[database]], stats = ranks, minSize = FGSEA_MIN,
      maxSize = FGSEA_MAX, BPPARAM = SerialParam()
    )
    assert_qc(nrow(result) > 0L, paste("FGSEA returned no rows for", database))
    result <- as.data.frame(result)
    result$leadingEdge <- vapply(result$leadingEdge, paste, collapse = ";", FUN.VALUE = character(1))
    result <- as.data.table(result)[, .(pathway, pval, padj, NES, size, leadingEdge)]
    results[[database]] <- result
    write_tsv(result, file.path(proc_dir, sprintf("%s_FGSEA_%s.tsv", id, database)))
  }

  focal <- results$REACTOME[
    grepl("IGF_TRANSPORT_AND_UPTAKE", pathway) |
      grepl("SIGNALING_BY_TYPE_1.*IGF1R|TYPE_1_INSULIN_LIKE_GROWTH_FACTOR_1_RECEPTOR", pathway)
  ]
  focal[, dataset := id]
  write_tsv(focal, file.path(proc_dir, paste0(id, "_fgsea.tsv")))
  vapply(results, nrow, integer(1))
}

write_analysis_outputs <- function(ds, result) {
  proc_dir <- out_dir(ds$id, "processed")
  write_tsv(result$de, file.path(proc_dir, paste0(ds$id, "_DE.tsv")))
  write_tsv(result$se, file.path(proc_dir, paste0(ds$id, "_SE.tsv")))

  panel <- result$de[toupper(symbol) %in% PANEL, .(symbol, logFC, stat, pvalue, padj, direction)]
  panel[, dataset := ds$id]
  write_tsv(panel, file.path(proc_dir, paste0(ds$id, "_panel.tsv")))

  # Browser matrices (rule C): raw and whole-dataset TMM CPM for counts, the
  # aggregated analysis-scale matrix for normalized inputs.
  analysis_ss <- ds$samplesheet[analysis_keep == TRUE]
  browser <- if (ds$input_kind == "counts") {
    cpm <- write_cpm_pair(ds$analysis_mat, colSums(ds$mat), design_for(analysis_ss)$design, ds$id, proc_dir,
                          published = ds$published, fit_y = result$y)
    c(cpm_raw = cpm$paths[["raw"]], cpm_tmm = cpm$paths[["tmm"]], cpm_normalization = cpm$paths[["norm"]])
  } else c(expression = write_expression_matrix(ds$analysis_mat, ds$id, proc_dir, ds$published))
  browser <- c(browser, feature_map = write_feature_map(ds$feature_map, ds$id, proc_dir))

  fgsea_rows <- if (SKIP_FGSEA) c(HALLMARK = NA, KEGG = NA, GO_BP = NA, REACTOME = NA) else
    run_fgsea(ds$id, ds$organism, result$de, proc_dir)
  list(panel_rows = nrow(panel), fgsea_rows = fgsea_rows, browser = browser)
}

write_qc_outputs <- function(ds, result, output_counts) {
  proc_dir <- out_dir(ds$id, "processed")
  qc_rows <- match(rownames(result$analysis_values), rownames(ds$qc_analysis_mat))
  assert_qc(!anyNA(qc_rows), "filtered analysis rows are absent from the QC matrix")
  sample_qc <- qc_sample_table(ds$qc_analysis_mat[qc_rows, , drop = FALSE], ds$samplesheet)
  write_tsv(sample_qc, file.path(proc_dir, paste0(ds$id, "_sample_qc.tsv")))

  analysis_ss <- ds$samplesheet[analysis_keep == TRUE]
  duplicate_symbols <- sum(duplicated(ds$final_symbols[!is.na(ds$final_symbols)]))
  metrics <- rbindlist(list(
    qc_metric("decision", "PROCESS", "PASS", "Passed structural, public-data, independent-n, and standard-pipeline gates."),
    qc_metric("organism", ds$organism),
    qc_metric("region", ds$region),
    qc_metric("contrast", ds$contrast),
    qc_metric("pipeline_route", ifelse(ds$input_kind == "counts", "edgeR-QL", "limma")),
    qc_metric("source_scale", ds$source_scale),
    qc_metric("analysis_scale", ds$analysis_scale),
    qc_metric("source_gene_rows", ds$source_gene_rows),
    qc_metric("analysis_input_gene_rows", nrow(ds$mat)),
    qc_metric("genes_after_standard_expression_filter", result$filtered_genes, "PASS"),
    qc_metric("de_rows", nrow(result$de)),
    qc_metric("duplicate_source_symbols", duplicate_symbols, "INFO", "Source features sharing a final public symbol are aggregated before fitting (counts summed, log values averaged, log2(x+1) values summed on the linear scale); nothing is de-duplicated after testing."),
    qc_metric("features_unmapped_in_fit", ds$agg$n_unmapped_in_fit, "INFO", "Source features without a public gene symbol are fitted as their own rows (normalization, priors, FDR family) and excluded from the published tables."),
    qc_metric("symbols_after_aggregation", ds$agg$n_symbols_after_aggregation),
    qc_metric("nonfinite_analysis_cells", sum(!is.finite(ds$mat)), "PASS"),
    qc_metric("independent_control_n", sum(analysis_ss$group == "control"), "PASS"),
    qc_metric("independent_case_n", sum(analysis_ss$group == "case"), "PASS"),
    qc_metric("excluded_sample_n", sum(!ds$samplesheet$analysis_keep), ifelse(any(!ds$samplesheet$analysis_keep), "PASS", "INFO"), ds$exclusion_policy),
    qc_metric("analysis_matrix_min", signif(min(ds$mat), 10L)),
    qc_metric("analysis_matrix_max", signif(max(ds$mat), 10L)),
    qc_metric("minimum_sample_median_correlation", signif(min(sample_qc$median_correlation_to_other_samples), 8L)),
    qc_metric("panel_rows", output_counts$panel_rows),
    qc_metric("fgsea_hallmark_rows", output_counts$fgsea_rows[["HALLMARK"]]),
    qc_metric("fgsea_kegg_rows", output_counts$fgsea_rows[["KEGG"]]),
    qc_metric("fgsea_go_bp_rows", output_counts$fgsea_rows[["GO_BP"]]),
    qc_metric("fgsea_reactome_rows", output_counts$fgsea_rows[["REACTOME"]]),
    qc_metric("fdr_lt_0.05", sum(result$de$padj < 0.05, na.rm = TRUE)),
    qc_metric("unadjusted_p_lt_0.05", sum(result$de$pvalue < 0.05, na.rm = TRUE))
  ), use.names = TRUE, fill = TRUE)
  if (length(ds$extra_qc)) metrics <- rbind(metrics, rbindlist(ds$extra_qc, fill = TRUE))
  write_tsv(metrics, file.path(proc_dir, paste0(ds$id, "_preprocessing_qc.tsv")))

  summary <- data.table(
    dataset = ds$id,
    decision = "PROCESS",
    organism = ds$organism,
    region = ds$region,
    contrast = ds$contrast,
    control_n = sum(analysis_ss$group == "control"),
    case_n = sum(analysis_ss$group == "case"),
    input_kind = ds$input_kind,
    pipeline_route = ifelse(ds$input_kind == "counts", "filterByExpr -> TMM -> edgeR-QL", "variance filter -> limma eBayes"),
    source_scale = ds$source_scale,
    analysis_scale = ds$analysis_scale,
    prepared_matrix = repo_equivalent_path(ds$prepared_path),
    de_table = repo_equivalent_path(file.path(proc_dir, paste0(ds$id, "_DE.tsv"))),
    qc_note = ds$qc_note
  )
  write_tsv(summary, file.path(proc_dir, paste0(ds$id, "_processing_summary.tsv")))
}

# <id>_provenance.tsv and <id>_sessionInfo.txt (scripts/lib/de_common.R).
write_run_provenance <- function(ds, result, output_counts) {
  proc_dir <- out_dir(ds$id, "processed")
  analysis_ss <- ds$samplesheet[analysis_keep == TRUE]
  a <- ds$agg
  sources <- fread(file.path(out_dir(ds$id, "metadata"), paste0(ds$id, "_source_files.tsv")))
  inputs <- setNames(file.path(ROOT, sources$local_path), sources$role)
  write_provenance(ds$id, proc_dir, de_script_path(), inputs = inputs,
    outputs = c(de = file.path(proc_dir, paste0(ds$id, "_DE.tsv")), se = file.path(proc_dir, paste0(ds$id, "_SE.tsv")),
                prepared_matrix = ds$prepared_path, output_counts$browser),
    fields = list(config_id = ds$id, organism = ds$organism, input_kind = ds$input_kind,
                  input_scale = ds$aggregate_scale, method = result$de$method[1],
                  design = paste(colnames(design_for(analysis_ss)$design), collapse = " + "), coef = "groupcase",
                  samples_control = paste(analysis_ss$sample[analysis_ss$group == "control"], collapse = ","),
                  samples_case = paste(analysis_ss$sample[analysis_ss$group == "case"], collapse = ","),
                  input_fractional_cells = if (ds$input_kind == "counts") sum(ds$mat != round(ds$mat)) else NA,
                  n_features_raw = a$n_features_raw, n_unmapped_in_fit = a$n_unmapped_in_fit,
                  n_symbols_after_aggregation = a$n_symbols_after_aggregation,
                  n_features_collapsed = a$n_features_collapsed,
                  n_symbols_with_multiple_features = a$n_symbols_with_multiple_features,
                  n_groups_i_stable_ids = a$n_groups_i_stable_ids, n_groups_ii_identical = a$n_groups_ii_identical,
                  n_groups_ii_date_damaged = a$n_groups_ii_date_damaged, n_groups_iii_symbol_labels = a$n_groups_iii_symbol_labels,
                  n_features_ambiguous_hidden = a$n_features_ambiguous_hidden,
                  n_features_ambiguous_mar = a$n_features_ambiguous_mar,
                  n_features_disambiguated = a$n_features_disambiguated,
                  mar_resolution = a$mar_resolution,
                  n_symbols_hidden_ambiguous = a$n_symbols_hidden_ambiguous,
                  aggregation = a$aggregation,
                  unmapped_signal_fraction = if (is.null(a$unmapped_signal_fraction)) NA else signif(a$unmapped_signal_fraction, 6),
                  n_features_tested = result$filtered_genes, n_unmapped_tested = result$n_unmapped_tested,
                  fdr_family = "all tested fit rows, including unmapped rows that are not published",
                  n_de_rows = nrow(result$de),
                  n_fdr_lt_0.05 = sum(result$de$padj < 0.05, na.rm = TRUE),
                  fgsea = if (SKIP_FGSEA) "skipped (HYPO_SKIP_FGSEA)" else "run"))
}

validate_outputs <- function(ds, result) {
  proc_dir <- out_dir(ds$id, "processed")
  required <- c(
    paste0(ds$id, "_analysis_matrix.tsv.gz"), paste0(ds$id, "_DE.tsv"),
    paste0(ds$id, "_SE.tsv"), paste0(ds$id, "_panel.tsv"),
    paste0(ds$id, "_sample_qc.tsv"),
    paste0(ds$id, "_preprocessing_qc.tsv"), paste0(ds$id, "_processing_summary.tsv")
  )
  if (!SKIP_FGSEA) required <- c(required,
    paste0(ds$id, "_fgsea.tsv"), paste0(ds$id, "_FGSEA_HALLMARK.tsv"),
    paste0(ds$id, "_FGSEA_KEGG.tsv"), paste0(ds$id, "_FGSEA_GO_BP.tsv"),
    paste0(ds$id, "_FGSEA_REACTOME.tsv"))
  if (ds$input_kind == "matrix") {
    id_map <- file.path(out_dir(ds$id, "metadata"), paste0(ds$id, "_id_map.tsv"))
    assert_qc(file.exists(id_map) && nrow(fread(id_map, header = FALSE)) == length(ds$ids), "local id map is missing or incomplete")
  }
  assert_qc(all(file.exists(file.path(proc_dir, required))), "one or more required dataset-local outputs are missing")

  disk_de <- fread(file.path(proc_dir, paste0(ds$id, "_DE.tsv")))
  assert_qc(
    identical(names(disk_de), c("id", "symbol", "logFC", "stat", "pvalue", "padj", "method", "direction")),
    "DE output schema changed"
  )
  assert_qc(nrow(disk_de) == nrow(result$de), "DE output row count changed during serialization")
  assert_qc(!anyDuplicated(disk_de$symbol), "DE output contains duplicate symbols")
  assert_qc(all(is.finite(disk_de$logFC)) && all(is.finite(disk_de$stat)), "DE output contains non-finite effects or statistics")

  disk_se <- fread(file.path(proc_dir, paste0(ds$id, "_SE.tsv")))
  assert_qc(identical(names(disk_se), c("id", "se")), "SE sidecar schema changed")
  assert_qc(nrow(disk_se) >= 100L && all(is.finite(disk_se$se)) && all(disk_se$se > 0), "SE sidecar failed positivity/finite-row QC")

  for (database in if (SKIP_FGSEA) character() else c("HALLMARK", "KEGG", "GO_BP", "REACTOME")) {
    table <- fread(file.path(proc_dir, sprintf("%s_FGSEA_%s.tsv", ds$id, database)))
    assert_qc(
      identical(names(table), c("pathway", "pval", "padj", "NES", "size", "leadingEdge")),
      paste("FGSEA output schema changed for", database)
    )
    assert_qc(nrow(table) > 0L && all(is.finite(table$NES)), paste("FGSEA output failed row/statistic QC for", database))
  }

  qc <- fread(file.path(proc_dir, paste0(ds$id, "_preprocessing_qc.tsv")))
  assert_qc(qc[metric == "decision", value] == "PROCESS", "serialized QC decision is not PROCESS")
  invisible(TRUE)
}

run_one <- function(ds) {
  out_dir(ds$id, "metadata")
  out_dir(ds$id, "processed")
  stale_notes <- file.path(
    out_dir(ds$id, "processed"),
    c(paste0(ds$id, "_exclusion_note.txt"), paste0(ds$id, "_processing_failure.txt"))
  )
  unlink(stale_notes[file.exists(stale_notes)])
  ds$final_symbols <- final_symbols_for(ds)
  ds <- aggregate_dataset(ds)
  cat(sprintf("[%s] features: %d source -> %d symbols (%d unmapped kept in the fit, %d collapsed)\n",
              ds$id, ds$agg$n_features_raw, ds$agg$n_symbols_after_aggregation,
              ds$agg$n_unmapped_in_fit, ds$agg$n_features_collapsed))
  write_tsv(ds$samplesheet, file.path(out_dir(ds$id, "metadata"), paste0(ds$id, "_samplesheet.tsv")))
  write_matrix(ds)
  write_local_id_map(ds)
  result <- run_de(ds)
  output_counts <- write_analysis_outputs(ds, result)
  write_qc_outputs(ds, result, output_counts)
  validate_outputs(ds, result)
  write_run_provenance(ds, result, output_counts)
  cat(sprintf(
    "[%s] PROCESS: %s | %d control vs %d case | %d DE rows | %s\n",
    ds$id, ds$contrast,
    sum(ds$samplesheet$analysis_keep & ds$samplesheet$group == "control"),
    sum(ds$samplesheet$analysis_keep & ds$samplesheet$group == "case"),
    nrow(result$de), ifelse(ds$input_kind == "counts", "edgeR-QL", "limma")
  ))
  invisible(list(ds = ds, result = result, output_counts = output_counts))
}

prepare_emtab12340 <- function() {
  id <- "E-MTAB-12340"
  dir <- dataset_dir(id)
  count_path <- file.path(dir, "raw", "hypo_utr-seq_unfiltered_countmat.csv")
  sdrf_path <- file.path(dir, "metadata", "E-MTAB-12340.sdrf.txt")
  write_source_manifest(id, data.table(
    role = c("author_raw_gene_counts", "sample_metadata"),
    path = c(count_path, sdrf_path),
    url = c(
      "https://ftp.ebi.ac.uk/biostudies/fire/E-MTAB-/340/E-MTAB-12340/Files/hypo_utr-seq_unfiltered_countmat.csv",
      "https://www.ebi.ac.uk/biostudies/files/E-MTAB-12340/E-MTAB-12340.sdrf.txt"
    ),
    format = c("CSV; first column versioned mouse Ensembl gene id; remaining columns integer counts", "MAGE-TAB SDRF TSV"),
    semantics = c(
      "Author-deposited unfiltered QuantSeq/3-prime UTR RNA-seq gene counts.",
      "Official BioStudies sample annotations; organism, hypothalamus, sex, age, individual, and developmental stage."
    )
  ))

  counts <- fread(count_path, check.names = FALSE)
  assert_qc(identical(dim(counts), c(48801L, 49L)), "E-MTAB-12340 source count dimensions changed")
  assert_qc(names(counts)[[1L]] == "ensembl_id", "E-MTAB-12340 gene-id column changed")

  control_samples <- c(
    "WL1009_Hd22F2", "WL1010_Hd22F3", "WL1011_Hd22F4", "WL1012_Hd22F5", "WL1013_Hd22F6"
  )
  case_samples <- c(
    "WL1038_Hd37F1", "WL1039_Hd37F2", "WL1040_Hd37F3", "WL1041_Hd37F4", "WL1042_Hd37F6"
  )
  samples <- c(control_samples, case_samples)
  assert_qc(all(samples %in% names(counts)), "one or more selected female puberty samples are absent from the count matrix")

  sdrf <- fread(sdrf_path, check.names = FALSE)
  individual_col <- "Characteristics[individual]"
  selected_meta <- sdrf[match(samples, get(individual_col))]
  assert_qc(nrow(selected_meta) == 10L && !anyNA(selected_meta[[individual_col]]), "selected samples did not map one-to-one to SDRF rows")
  assert_qc(all(selected_meta[["Characteristics[organism]"]] == "Mus musculus"), "selected SDRF samples are not all mouse")
  assert_qc(all(selected_meta[["Characteristics[organism part]"]] == "hypothalamus"), "selected SDRF samples are not all hypothalamus")
  assert_qc(all(selected_meta[["Characteristics[sex]"]] == "female"), "selected SDRF samples are not all female")
  assert_qc(identical(as.integer(selected_meta[["Characteristics[age]"]]), c(rep(22L, 5L), rep(37L, 5L))), "selected SDRF ages changed")

  source_ids <- as.character(counts[["ensembl_id"]])
  assert_qc(!anyDuplicated(source_ids), "E-MTAB-12340 count matrix has duplicate gene ids")
  mouse_gene <- grepl("^ENSMUSG[0-9]+(\\.[0-9]+)?$", source_ids)
  assert_qc(all(grepl("^ERCC-[0-9]+$", source_ids[!mouse_gene])), "E-MTAB-12340 contains identifiers that are neither mouse Ensembl genes nor ERCC spike-ins")
  ids <- source_ids[mouse_gene]
  mat <- as.matrix(counts[mouse_gene, ..samples])
  storage.mode(mat) <- "double"
  rownames(mat) <- ids
  assert_qc(all(is.finite(mat)) && all(mat >= 0) && all(abs(mat - round(mat)) < 1e-8), "E-MTAB-12340 source values are not finite nonnegative integer counts")

  symbols <- map_ensembl_symbols(ids, "Mus musculus")
  samplesheet <- data.table(
    sample = samples,
    group = c(rep("control", 5L), rep("case", 5L)),
    analysis_keep = TRUE,
    exclusion_reason = "",
    biological_unit = selected_meta[["Source Name"]],
    organism = selected_meta[["Characteristics[organism]"]],
    tissue = selected_meta[["Characteristics[organism part]"]],
    sex = selected_meta[["Characteristics[sex]"]],
    age_days = as.integer(selected_meta[["Characteristics[age]"]]),
    developmental_stage = selected_meta[["Factor Value[developmental stage]"]],
    ena_sample = selected_meta[["Comment[ENA_SAMPLE]"]],
    ena_run = selected_meta[["Comment[ENA_RUN]"]]
  )
  assert_qc(!anyDuplicated(samplesheet$biological_unit), "E-MTAB-12340 selected rows are not ten independent mice")

  list(
    id = id,
    organism = "Mus musculus",
    region = "whole hypothalamus",
    contrast = "female post-puberty PND37 versus female pre-puberty PND22",
    input_kind = "counts",
    ids = ids,
    symbols = symbols,
    mat = mat,
    qc_counts = mat, aggregate_scale = "counts",
    samplesheet = samplesheet,
    source_gene_rows = nrow(counts),
    source_scale = "author-deposited unfiltered integer gene counts",
    analysis_scale = "raw counts; standard filterByExpr -> TMM -> edgeR-QL",
    prepared_path = file.path(out_dir(id, "processed"), paste0(id, "_analysis_matrix.tsv.gz")),
    exclusion_policy = "No author exclusions in the selected 10-mouse contrast; no post hoc outlier removal.",
    qc_note = "All ten selected columns map exactly to female hypothalamus SDRF rows and unique source animals.",
    extra_qc = list(
      qc_metric("ercc_spikein_rows_excluded", sum(!mouse_gene), "PASS", "Technical ERCC controls are not biological mouse genes and are removed before filterByExpr."),
      qc_metric("raw_count_integer_cells", length(mat), "PASS"),
      qc_metric("versioned_ensembl_ids", sum(grepl("\\.[0-9]+$", ids))),
      qc_metric("mapped_gene_symbols", sum(symbols != ids))
    )
  )
}

prepare_gse128148 <- function() {
  id <- "GSE128148"
  dir <- dataset_dir(id)
  count_path <- file.path(dir, "raw", "GSE128148_2019_Wray_4week_raw_counts.txt.gz")
  author_qc_path <- file.path(dir, "metadata", "GSE128148_2019_Wray_4week_normalised_outliers_excluded.txt.gz")
  soft_path <- file.path(dir, "metadata", "GSE128148_family.soft.gz")
  write_source_manifest(id, data.table(
    role = c("author_raw_gene_counts", "author_outlier_evidence", "sample_metadata"),
    path = c(count_path, author_qc_path, soft_path),
    url = c(
      "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE128nnn/GSE128148/suppl/GSE128148_2019_Wray_4week_raw_counts.txt.gz",
      "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE128nnn/GSE128148/suppl/GSE128148_2019_Wray_4week_normalised_outliers_excluded.txt.gz",
      "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE128nnn/GSE128148/soft/GSE128148_family.soft.gz"
    ),
    format = c(
      "gzipped TSV; mouse Ensembl id plus ten integer-count columns",
      "gzipped TSV; author DESeq2 normalized table whose sample columns encode retained libraries",
      "gzipped GEO SOFT family metadata"
    ),
    semantics = c(
      "Author-deposited four-week raw featureCounts gene counts.",
      "Official author file explicitly labelled outliers excluded; its seven library columns define the retained analysis set.",
      "GEO sample titles, treatments, four-week duration, BioSamples, and SRA experiments."
    )
  ))

  counts <- fread(count_path, check.names = FALSE)
  assert_qc(identical(dim(counts), c(22048L, 11L)), "GSE128148 four-week raw-count dimensions changed")
  all_samples <- names(counts)[-1L]
  expected_all <- sprintf("SLX-9735.L2DRBC%02d", 1:10)
  assert_qc(identical(all_samples, expected_all), "GSE128148 raw-count library order changed")

  author_qc_header <- names(fread(author_qc_path, nrows = 0L, check.names = FALSE))
  retained <- grep("^SLX-9735\\.L2DRBC", author_qc_header, value = TRUE)
  expected_retained <- expected_all[c(2L, 3L, 4L, 7L, 8L, 9L, 10L)]
  assert_qc(identical(retained, expected_retained), "GSE128148 author outlier-excluded library set changed")

  soft <- read_geo_soft_samples(soft_path)
  soft4 <- soft[grepl("^4 Week-", title)][order(gsm)]
  assert_qc(nrow(soft4) == 10L, "GSE128148 SOFT no longer has ten four-week samples")
  intended_group <- ifelse(grepl("-Veh-", soft4$title), "control", "case")
  assert_qc(identical(intended_group, c(rep("control", 5L), rep("case", 5L))), "GSE128148 four-week GEO title ordering changed")
  analysis_keep <- all_samples %in% retained
  group <- ifelse(analysis_keep, intended_group, "exclude")
  exclusion_reason <- ifelse(
    analysis_keep, "",
    "author_qc_outlier: absent from the official four-week normalized_outliers_excluded matrix"
  )
  samplesheet <- data.table(
    sample = all_samples,
    group = group,
    intended_group = intended_group,
    analysis_keep = analysis_keep,
    exclusion_reason = exclusion_reason,
    biological_unit = soft4$gsm,
    gsm = soft4$gsm,
    title = soft4$title,
    treatment = soft4$treatment,
    treatment_length = soft4$treatment_length,
    tissue = "hypothalamic arcuate nucleus",
    sex = "male",
    biosample = soft4$biosample,
    srx = soft4$srx,
    mapping_basis = "ordered official four-week count columns matched to ordered GEO four-week sample records"
  )
  assert_qc(!anyDuplicated(samplesheet$biological_unit), "GSE128148 retained rows are not distinct GEO biological samples")
  assert_qc(sum(samplesheet$analysis_keep & samplesheet$group == "control") == 3L, "GSE128148 author QC no longer retains three vehicle mice")
  assert_qc(sum(samplesheet$analysis_keep & samplesheet$group == "case") == 4L, "GSE128148 author QC no longer retains four corticosterone mice")

  ids <- as.character(counts[[1L]])
  assert_qc(!anyDuplicated(ids), "GSE128148 raw-count matrix has duplicate gene ids")
  assert_qc(all(grepl("^ENSMUSG[0-9]+(\\.[0-9]+)?$", ids)), "GSE128148 has non-mouse-Ensembl gene ids")
  all_mat <- as.matrix(counts[, ..all_samples])
  storage.mode(all_mat) <- "double"
  rownames(all_mat) <- ids
  assert_qc(all(is.finite(all_mat)) && all(all_mat >= 0) && all(abs(all_mat - round(all_mat)) < 1e-8), "GSE128148 source values are not finite nonnegative integer counts")
  mat <- all_mat[, retained, drop = FALSE]
  symbols <- map_ensembl_symbols(ids, "Mus musculus")

  list(
    id = id,
    organism = "Mus musculus",
    region = "laser-capture microdissected arcuate nucleus",
    contrast = "four-week oral corticosterone versus vehicle after author outlier exclusions",
    input_kind = "counts",
    ids = ids,
    symbols = symbols,
    mat = mat,
    qc_counts = all_mat, aggregate_scale = "counts",
    samplesheet = samplesheet,
    source_gene_rows = nrow(counts),
    source_scale = "author-deposited integer featureCounts matrix",
    analysis_scale = "raw counts; standard filterByExpr -> TMM -> edgeR-QL",
    prepared_path = file.path(out_dir(id, "processed"), paste0(id, "_analysis_matrix.tsv.gz")),
    exclusion_policy = paste(
      "Three explicit author-QC exclusions are recorded: DRBC01 and DRBC05 (vehicle),",
      "and DRBC06 (corticosterone). No additional post hoc outlier removal."
    ),
    qc_note = "The retained columns are read from the official author file named normalized_outliers_excluded; retained independent n is 3 vehicle versus 4 corticosterone.",
    extra_qc = list(
      qc_metric("author_qc_retained_libraries", paste(retained, collapse = ";"), "PASS"),
      qc_metric("author_qc_excluded_libraries", paste(setdiff(all_samples, retained), collapse = ";"), "PASS"),
      qc_metric("raw_count_integer_cells", length(all_mat), "PASS"),
      qc_metric("mapped_gene_symbols", sum(symbols != ids))
    )
  )
}

prepare_gse156859 <- function() {
  id <- "GSE156859"
  dir <- dataset_dir(id)
  matrix_path <- file.path(dir, "raw", "GSE156859_RNAseq_24_Normalized_counts_Female.txt.gz")
  soft_path <- file.path(dir, "metadata", "GSE156859_family.soft.gz")
  write_source_manifest(id, data.table(
    role = c("author_normalized_expression", "sample_metadata"),
    path = c(matrix_path, soft_path),
    url = c(
      "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE156nnn/GSE156859/suppl/GSE156859_RNAseq_24_Normalized_counts_Female.txt.gz",
      "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE156nnn/GSE156859/soft/GSE156859_family.soft.gz"
    ),
    format = c("gzipped TSV; samples in rows, gene symbols in columns", "gzipped GEO SOFT family metadata"),
    semantics = c(
      "Female-only author matrix documented as CPM plus 0.0001, geometric-mean filter, then log2; values are preserved exactly.",
      "GEO fetal whole-hypothalamus sample metadata confirming GD21, female sex, and six Air versus six 0.8 ppm ozone biological samples."
    )
  ))

  source <- fread(matrix_path, check.names = FALSE)
  assert_qc(identical(dim(source), c(12L, 11086L)), "GSE156859 female normalized-matrix dimensions changed")
  assert_qc(identical(names(source)[1:3], c("Sample name", "Exposure", "Gender")), "GSE156859 source metadata columns changed")
  assert_qc(all(source[["Gender"]] == "Female"), "GSE156859 female file contains a non-female row")
  assert_qc(sum(source[["Exposure"]] == "Air") == 6L, "GSE156859 source no longer has six female Air samples")
  assert_qc(sum(source[["Exposure"]] == "0.8 ppm ozone") == 6L, "GSE156859 source no longer has six female ozone samples")

  soft <- read_geo_soft_samples(soft_path)
  female_soft <- soft[tolower(sex) == "female"]
  assert_qc(nrow(female_soft) == 12L, "GSE156859 SOFT no longer has twelve female samples")
  assert_qc(sum(female_soft$exposure == "Air") == 6L && sum(female_soft$exposure == "0.8 ppm ozone") == 6L, "GSE156859 SOFT female exposure counts changed")
  assert_qc(all(female_soft$age == "GD 21"), "GSE156859 selected GEO samples are not all GD21")

  samples <- as.character(source[["Sample name"]])
  symbols <- names(source)[-(1:3)]
  ids <- stable_symbol_ids(symbols)
  assert_qc(!anyDuplicated(ids) && !anyDuplicated(samples), "GSE156859 source has duplicate genes or sample labels")
  mat <- t(as.matrix(source[, -(1:3)]))
  storage.mode(mat) <- "double"
  rownames(mat) <- ids
  colnames(mat) <- samples
  assert_qc(all(is.finite(mat)), "GSE156859 normalized matrix contains non-finite values")

  group <- ifelse(source[["Exposure"]] == "Air", "control", "case")
  samplesheet <- data.table(
    sample = samples,
    group = group,
    analysis_keep = TRUE,
    exclusion_reason = "",
    biological_unit = samples,
    exposure = source[["Exposure"]],
    sex = source[["Gender"]],
    age = "GD 21",
    tissue = "whole fetal hypothalamus",
    gsm = NA_character_,
    row_mapping_note = "Author matrix row labels define biological units; no row-level GSM assignment guessed. GEO metadata independently confirms the 6-per-arm female set."
  )

  list(
    id = id,
    organism = "Rattus norvegicus",
    region = "whole fetal hypothalamus",
    contrast = "maternal 0.8 ppm ozone exposure versus filtered air in female GD21 fetuses",
    input_kind = "matrix",
    ids = ids,
    symbols = symbols,
    mat = mat,
    aggregate_scale = "log",
    samplesheet = samplesheet,
    source_gene_rows = length(symbols),
    source_scale = "author log2(CPM + 0.0001) after documented geometric-mean expression filtering",
    analysis_scale = "unchanged author log2 normalized-expression values",
    prepared_path = file.path(out_dir(id, "processed"), paste0(id, "_analysis_matrix.tsv.gz")),
    exclusion_policy = "No author exclusions in the female matrix; no post hoc outlier removal.",
    qc_note = "The source file embeds sample, exposure, and sex beside each expression row; values are transposed but not transformed.",
    extra_qc = list(
      qc_metric("preserved_source_value_cells", length(mat), "PASS", "Every deposited normalized value is passed unchanged to limma."),
      qc_metric("duplicate_gene_symbols", sum(duplicated(symbols)), "PASS")
    )
  )
}

prepare_gse167105 <- function() {
  id <- "GSE167105"
  dir <- dataset_dir(id)
  matrix_path <- file.path(dir, "raw", "GSE167105_Hypothalamus_3Hb_vs_3WT_all.txt.gz")
  soft_path <- file.path(dir, "metadata", "GSE167105_family.soft.gz")
  write_source_manifest(id, data.table(
    role = c("author_normalized_expression", "sample_metadata"),
    path = c(matrix_path, soft_path),
    url = c(
      "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE167nnn/GSE167105/suppl/GSE167105_Hypothalamus_3Hb_vs_3WT_all.txt.gz",
      "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE167nnn/GSE167105/soft/GSE167105_family.soft.gz"
    ),
    format = c("gzipped TSV; symbols, author DE summary, and six normalized-expression columns", "gzipped GEO SOFT family metadata"),
    semantics = c(
      "Author-deposited nonnegative normalized per-sample expression. SOFT states TMM normalization and per-sample RPKM; source DE summary includes logCPM. Author DE summary columns are not reused.",
      "GEO metadata for three independent 3-month male WT and three THRB K146Q-mutant hypothalamus samples."
    )
  ))

  source <- fread(matrix_path, check.names = FALSE)
  expected_columns <- c(
    "Gene_symbol", "NAME", "logFC", "logCPM", "LR", "PValue", "FDR",
    "Hypothalamus.Hb60", "Hypothalamus.Hb62", "Hypothalamus.Hb83",
    "Hypothalamus.WT1", "Hypothalamus.WT2", "Hypothalamus.WT43"
  )
  assert_qc(identical(dim(source), c(24054L, 13L)), "GSE167105 hypothalamus matrix dimensions changed")
  assert_qc(identical(names(source), expected_columns), "GSE167105 hypothalamus matrix columns changed")
  samples <- c(
    "Hypothalamus.WT1", "Hypothalamus.WT2", "Hypothalamus.WT43",
    "Hypothalamus.Hb60", "Hypothalamus.Hb62", "Hypothalamus.Hb83"
  )
  source_values <- as.matrix(source[, ..samples])
  storage.mode(source_values) <- "double"
  assert_qc(all(is.finite(source_values)) && all(source_values >= 0), "GSE167105 normalized expression is not finite and nonnegative")
  mat <- log2(source_values + 1)

  symbols <- as.character(source[["Gene_symbol"]])
  assert_qc(!any(is.na(symbols) | !nzchar(symbols)), "GSE167105 source has blank gene symbols")
  ids <- stable_symbol_ids(symbols)
  rownames(mat) <- ids
  colnames(mat) <- samples

  soft <- read_geo_soft_samples(soft_path)
  hypothalamus <- soft[grepl("^Hypothalamus-", title)]
  assert_qc(nrow(hypothalamus) == 6L, "GSE167105 SOFT no longer has six hypothalamus samples")
  sample_key <- tolower(sub("^Hypothalamus\\.", "", samples))
  soft_key <- tolower(sub("^Hypothalamus-", "", hypothalamus$title))
  sample_meta <- hypothalamus[match(sample_key, soft_key)]
  assert_qc(!anyNA(sample_meta$gsm), "GSE167105 matrix columns did not map one-to-one to GEO samples")
  assert_qc(all(sample_meta$age == "3 months"), "GSE167105 selected samples are not all 3 months old")
  group <- c(rep("control", 3L), rep("case", 3L))
  samplesheet <- data.table(
    sample = samples,
    group = group,
    analysis_keep = TRUE,
    exclusion_reason = "",
    biological_unit = sample_meta$gsm,
    gsm = sample_meta$gsm,
    title = sample_meta$title,
    genotype = sample_meta$source,
    sex = "male",
    age = sample_meta$age,
    tissue = "whole hypothalamus",
    biosample = sample_meta$biosample,
    srx = sample_meta$srx
  )
  assert_qc(!anyDuplicated(samplesheet$biological_unit), "GSE167105 selected columns are not six independent mice")

  list(
    id = id,
    organism = "Mus musculus",
    region = "whole hypothalamus",
    contrast = "THRB K146Q mutant versus wild type in 3-month male mice",
    input_kind = "matrix",
    ids = ids,
    symbols = symbols,
    extra_columns = list(NAME = as.character(source[["NAME"]])),
    mat = mat,
    aggregate_scale = "log2p1",
    samplesheet = samplesheet,
    source_gene_rows = nrow(source),
    source_scale = "author normalized nonnegative expression; SOFT reports TMM and RPKM, while deposited summary includes logCPM",
    analysis_scale = "log2(author normalized expression + 1); no count-level model and no reuse of author DE statistics",
    prepared_path = file.path(out_dir(id, "processed"), paste0(id, "_analysis_matrix.tsv.gz")),
    exclusion_policy = "No author exclusions among the six hypothalamus samples; no post hoc outlier removal.",
    qc_note = "Because raw counts were not deposited, the six author-normalized sample columns are explicitly log2(x+1)-transformed and routed to limma; the original file remains unchanged.",
    extra_qc = list(
      qc_metric("source_noninteger_cells", sum(abs(source_values - round(source_values)) > 1e-8), "PASS", "Confirms this is not mislabelled as a raw-count matrix."),
      qc_metric("source_duplicate_symbols", sum(duplicated(symbols)), "INFO", "The duplicated author strings 1-Mar and 2-Mar are not guessed or remapped."),
      qc_metric("analysis_transform", "log2(x + 1)", "PASS")
    )
  )
}

prepare_gse189945 <- function() {
  id <- "GSE189945"
  dir <- dataset_dir(id)
  matrix_path <- file.path(dir, "raw", "GSE189945_MacKay_ARH_RNAseq_VSD.csv.gz")
  soft_path <- file.path(dir, "metadata", "GSE189945_family.soft.gz")
  write_source_manifest(id, data.table(
    role = c("author_vsd_expression", "sample_metadata"),
    path = c(matrix_path, soft_path),
    url = c(
      "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE189nnn/GSE189945/suppl/GSE189945_MacKay_ARH_RNAseq_VSD.csv.gz",
      "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE189nnn/GSE189945/soft/GSE189945_family.soft.gz"
    ),
    format = c("gzipped CSV; gene annotations plus 39 DESeq2 VSD RNA-seq sample columns", "gzipped GEO SOFT family metadata"),
    semantics = c(
      "Author-deposited variance-stabilized RNA-seq expression; values are preserved exactly.",
      "GEO RNA and WGBS sample metadata; only female NeuN-positive neuronal RNA-seq samples at PND12 and PND35 are retained."
    )
  ))

  source <- fread(matrix_path, check.names = FALSE)
  assert_qc(identical(dim(source), c(23953L, 43L)), "GSE189945 VSD matrix dimensions changed")
  assert_qc(identical(names(source)[1:4], c("gene_name", "chr", "gene_type", "gene_desc")), "GSE189945 annotation columns changed")
  control_samples <- c("neuron_f_12_5", "neuron_f_12_2", "neuron_f_12_4", "neuron_f_12_6", "neuron_f_12_7")
  case_samples <- c("neuron_f_35_16", "neuron_f_35_19", "neuron_f_35_17", "neuron_f_35_18", "neuron_f_35_15")
  samples <- c(control_samples, case_samples)
  assert_qc(all(samples %in% names(source)), "GSE189945 selected female neuron RNA columns are missing")
  mat <- as.matrix(source[, ..samples])
  storage.mode(mat) <- "double"
  assert_qc(all(is.finite(mat)), "GSE189945 selected VSD matrix contains non-finite values")

  source_symbols <- as.character(source[["gene_name"]])
  ids <- stable_symbol_ids(source_symbols)
  symbols <- source_symbols
  blank <- is.na(symbols) | !nzchar(symbols) | symbols == "NA"
  symbols[blank] <- ids[blank]
  rownames(mat) <- ids
  colnames(mat) <- samples
  assert_qc(!anyDuplicated(ids), "GSE189945 stable row ids are not unique")

  annotations <- data.table(
    gene_id = ids,
    source_gene_name = source_symbols,
    chr = source[["chr"]],
    gene_type = source[["gene_type"]],
    gene_description = source[["gene_desc"]],
    mapping_status = ifelse(blank, "unannotated_source_row", ifelse(duplicated(source_symbols) | duplicated(source_symbols, fromLast = TRUE), "duplicate_author_symbol", "author_symbol"))
  )
  write_tsv(annotations, file.path(out_dir(id, "metadata"), paste0(id, "_gene_annotation.tsv.gz")))

  soft <- read_geo_soft_samples(soft_path)
  rna <- soft[grepl("^RNA neuron_f_(12|35)_", title)]
  assert_qc(nrow(rna) == 10L, "GSE189945 SOFT no longer has ten selected female neuronal RNA samples")
  rna[, matrix_sample := sub("^RNA ", "", title)]
  sample_meta <- rna[match(samples, matrix_sample)]
  assert_qc(!anyNA(sample_meta$gsm), "GSE189945 selected matrix columns did not map one-to-one to GEO RNA samples")
  assert_qc(all(tolower(sample_meta$sex) == "f"), "GSE189945 selected GEO RNA samples are not all female")
  assert_qc(!anyNA(sample_meta$biosample), "GSE189945 selected GEO RNA samples lack BioSample identifiers")

  samplesheet <- data.table(
    sample = samples,
    group = c(rep("control", 5L), rep("case", 5L)),
    analysis_keep = TRUE,
    exclusion_reason = "",
    biological_unit = sample_meta$biosample,
    gsm = sample_meta$gsm,
    title = sample_meta$title,
    cell_type = "NeuN-positive neuron nuclei",
    sex = "female",
    age_days = c(rep(12L, 5L), rep(35L, 5L)),
    tissue = "microdissected arcuate nucleus",
    biosample = sample_meta$biosample,
    srx = sample_meta$srx
  )
  assert_qc(!anyDuplicated(samplesheet$biological_unit), "GSE189945 selected rows are not ten independent biological samples")

  list(
    id = id,
    organism = "Mus musculus",
    region = "FANS-sorted arcuate nucleus NeuN-positive neurons",
    contrast = "female PND35 versus female PND12 NeuN-positive arcuate neurons",
    input_kind = "matrix",
    ids = ids,
    symbols = symbols,
    mat = mat,
    aggregate_scale = "log",
    samplesheet = samplesheet,
    source_gene_rows = nrow(source),
    source_scale = "author DESeq2 variance-stabilized expression",
    analysis_scale = "unchanged author VSD values",
    prepared_path = file.path(out_dir(id, "processed"), paste0(id, "_analysis_matrix.tsv.gz")),
    exclusion_policy = "No author exclusions in the selected 10-sample contrast; no post hoc outlier removal.",
    qc_note = "Only RNA-seq columns are selected from this RNA/WGBS study; female NeuN-positive samples are matched exactly to GEO titles and values are not transformed.",
    extra_qc = list(
      qc_metric("unannotated_source_gene_rows", sum(blank), "INFO", "Unannotated rows receive stable UNANNOT_ROW identifiers; no symbol is guessed."),
      qc_metric("duplicate_nonblank_author_symbols", sum(duplicated(source_symbols) & !blank), "INFO", "Duplicate symbols are fit as distinct rows and de-duplicated only after testing."),
      qc_metric("preserved_source_value_cells", length(mat), "PASS")
    )
  )
}

PREPARERS <- list(
  `E-MTAB-12340` = prepare_emtab12340,
  GSE128148 = prepare_gse128148,
  GSE156859 = prepare_gse156859,
  GSE167105 = prepare_gse167105,
  GSE189945 = prepare_gse189945
)

run_status <- setNames(vector("list", length(requested)), requested)
for (id in requested) {
  cat(sprintf("\n[%s] preparing official sources and pinned contrast\n", id))
  run_status[[id]] <- tryCatch({
    ds <- PREPARERS[[id]]()
    output <- run_one(ds)
    list(ok = TRUE, output = output)
  }, error = function(e) {
    proc_dir <- out_dir(id, "processed")
    dir.create(proc_dir, recursive = TRUE, showWarnings = FALSE)
    is_qc <- inherits(e, "dataset_qc_failure") || startsWith(conditionMessage(e), "QC_FAILURE:")
    note_path <- file.path(
      proc_dir,
      if (is_qc) paste0(id, "_exclusion_note.txt") else paste0(id, "_processing_failure.txt")
    )
    note <- if (is_qc) {
      sprintf("EXCLUDE %s: %s", id, sub("^QC_FAILURE: ", "", conditionMessage(e)))
    } else {
      sprintf("PROCESSING FAILURE %s (not a scientific exclusion): %s", id, conditionMessage(e))
    }
    write_lines_lf(note, note_path)
    cat(note, "\n")
    list(ok = FALSE, error = conditionMessage(e), qc_failure = is_qc, note_path = note_path)
  })
  gc()
}

ok <- vapply(run_status, function(x) isTRUE(x$ok), logical(1))
cat(sprintf("\nBatch complete: %d PROCESS, %d failed/excluded.\n", sum(ok), sum(!ok)))
if (any(!ok)) quit(save = "no", status = 1L)
