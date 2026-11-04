#!/usr/bin/env Rscript
# Read-only replay of the macaque atlas DE from the committed per-animal
# pseudobulk counts (data/raw/pseudobulk), for the R 4.6.0 atlas audit.
#
# data/raw/scripts/run_atlas_r460.R wrote the pseudobulk, the DE tables, the
# TMM-normalized CPM and qc/library_sizes.csv. This script refits each app
# population independently of that producer (DGEList -> filterByExpr(group) with
# keep.lib.sizes = FALSE -> TMM -> estimateDisp(~grp) -> glmQLFit ->
# glmQLFTest(coef 2)) and compares the saved library sizes, TMM factors,
# normalized CPM and every DE row with the refit. It writes audit evidence only.
# usage: Rscript scripts/audit_macaque_normalization_r460.R manifest.json output.json
suppressPackageStartupMessages({ library(edgeR); library(jsonlite); library(data.table) })
args <- commandArgs(trailingOnly = TRUE)
stopifnot(length(args) == 2)
manifest <- fromJSON(args[1], simplifyVector = FALSE)
rel <- function(a, b) max(abs(a - b) / pmax(abs(a), abs(b), 1e-300))
within <- function(a, b) length(a) > 0 && all(is.finite(a)) && all(is.finite(b)) && all(abs(a - b) <= 1e-6 + 1e-6 * pmax(abs(a), abs(b)))
tracks <- lapply(manifest$tracks, function(t) {
  cat(t$trackId, '... '); flush.console()
  res <- tryCatch({
    counts <- fread(t$pseudobulk, sep = '\t', header = TRUE)
    genes <- as.character(counts[[1]])
    full <- as.matrix(counts[, -1L, with = FALSE]); rownames(full) <- genes
    kept <- unlist(t$samplesKept)
    groups <- unlist(t$groups)[kept]
    stopifnot(!anyDuplicated(genes), all(kept %in% colnames(full)))
    sub <- full[, kept, drop = FALSE]
    mat <- sub[stats::complete.cases(sub), , drop = FALSE]
    values_ok <- all(is.finite(mat)) && all(mat >= 0) && all(mat == round(mat))
    grp <- factor(unname(groups), levels = c('Normal', 'Obese'))
    y <- DGEList(counts = mat)
    total <- y$samples$lib.size
    detected <- colSums(mat > 0)
    keep <- filterByExpr(y, group = grp)
    y <- y[keep, , keep.lib.sizes = FALSE]
    y <- calcNormFactors(y, method = 'TMM')
    norm <- cpm(y, normalized.lib.sizes = TRUE)
    design <- model.matrix(~grp)
    y <- estimateDisp(y, design)
    fit <- glmQLFit(y, design)
    tt <- topTags(glmQLFTest(fit, coef = 2), n = Inf, sort.by = 'none')$table
    libs <- read.csv(t$librarySizes, stringsAsFactors = FALSE)
    li <- match(kept, libs$sample)
    stopifnot(!anyNA(li))
    library_deltas <- list(
      lib_size_all_shared_genes = rel(libs$lib_size_all_shared_genes[li], total),
      lib_size_filtered = rel(libs$lib_size_filtered[li], y$samples$lib.size),
      norm_factor = max(abs(libs$norm_factor[li] - y$samples$norm.factors)),
      effective_lib_size = rel(libs$effective_lib_size[li], y$samples$lib.size * y$samples$norm.factors))
    saved_cpm <- fread(t$normcpm, sep = ',', header = TRUE)
    ci <- match(saved_cpm$gene, rownames(norm))
    cpm_matched <- sum(!is.na(ci))
    cpm_ok <- cpm_matched == nrow(saved_cpm) && nrow(saved_cpm) == nrow(norm) && identical(colnames(saved_cpm)[-1L], kept) &&
      within(as.vector(as.matrix(saved_cpm[, -1L, with = FALSE])), as.vector(norm[ci, kept, drop = FALSE]))
    saved_de <- fread(t$de, sep = ',', header = TRUE)
    di <- match(saved_de$gene, rownames(tt))
    de_matched <- sum(!is.na(di))
    cols <- c(logFC = 'logFC', logCPM = 'logCPM', F = 'F', PValue = 'PValue', FDR = 'FDR')
    de_deltas <- lapply(cols, function(k) max(abs(saved_de[[k]] - tt[[k]][di])))
    de_ok <- de_matched == nrow(saved_de) && nrow(saved_de) == nrow(tt) && !anyDuplicated(saved_de$gene) &&
      all(vapply(cols, function(k) within(saved_de[[k]], tt[[k]][di]), logical(1)))
    libraries_ok <- library_deltas$lib_size_all_shared_genes <= 1e-12 && library_deltas$lib_size_filtered <= 1e-12 &&
      library_deltas$norm_factor <= 1e-9 && library_deltas$effective_lib_size <= 1e-9
    list(trackId = t$trackId, status = if (values_ok && libraries_ok && cpm_ok && de_ok) 'pass' else 'review',
      matrix = list(genes = nrow(full), sharedGenes = nrow(mat), samples = kept, integerNonnegative = values_ok,
        libraryTotals = as.list(setNames(total, kept)), detectedGenes = as.list(setNames(detected, kept))),
      filteredGenes = nrow(y), normFactors = as.list(setNames(y$samples$norm.factors, kept)),
      libraryDeltas = library_deltas, librariesMatch = libraries_ok,
      cpm = list(rows = nrow(saved_cpm), matchedRows = cpm_matched, match = cpm_ok),
      de = list(rows = nrow(saved_de), matchedRows = de_matched, maxAbsoluteDeltas = de_deltas, match = de_ok),
      residualDf = nrow(design) - ncol(design), designRank = qr(design)$rank)
  }, error = function(e) list(trackId = t$trackId, status = 'not_assessed', note = conditionMessage(e)))
  cat(res$status, '\n'); flush.console()
  res
})
names(tracks) <- vapply(tracks, function(t) t$trackId, character(1))
write_json(list(evidenceId = manifest$evidenceId, tracks = tracks,
  software = list(R = as.character(getRversion()), edgeR = as.character(packageVersion('edgeR')), limma = as.character(packageVersion('limma')))),
  args[2], pretty = TRUE, auto_unbox = TRUE, digits = 16, na = 'null')
