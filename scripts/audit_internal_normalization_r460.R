#!/usr/bin/env Rscript
# Read-only numeric replay of the R 4.6.0 bulk DE tables (September 25, 2026).
#
# Successor of scripts/audit_internal_normalization.R, which replays the
# pre-regeneration route and stays byte-identical because retained evidence pins
# it. This replay follows the rules of scripts/lib/de_common.R:
#   A2/A3.1  every feature takes the public symbol and status recorded in the
#       table's own <stem>_feature_map.tsv.gz sidecar; features published under
#       a symbol are aggregated before the fit; ambiguous (A3/A3.1) and unmapped
#       features stay in the fit as their own rows and are not published;
#   B1  count estimates are not rounded.
# The fit itself (filterByExpr -> TMM -> estimateDisp -> glmQLFit ->
# glmQLFTest, or lmFit -> eBayes) is written out here, independently of the
# producers, and every published DE row is compared by symbol. For count
# inputs the TMM factors and effective library sizes are also compared with the
# table's <stem>_cpm_normalization.tsv sidecar.
#
# Writes audit evidence only; never writes analysis tables or public bundles.
# usage: Rscript scripts/audit_internal_normalization_r460.R manifest.json output-directory
suppressPackageStartupMessages({ library(edgeR); library(limma); library(jsonlite); library(data.table) })
args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 2) stop('usage: audit_internal_normalization_r460.R manifest.json output-directory')
script_file <- normalizePath(sub('^--file=', '', grep('^--file=', commandArgs(FALSE), value = TRUE)[1]), winslash = '/')
repo <- normalizePath(file.path(dirname(script_file), '..'), winslash = '/')
source(file.path(repo, 'scripts', 'lib', 'de_common.R'))
de_init(repo)
jobs <- fromJSON(args[1], simplifyVector = FALSE)$jobs
out <- args[2]
dir.create(out, recursive = TRUE, showWarnings = FALSE)

# Feature-map statuses published under their symbol (rules A2/A3/A3.1): "mapped"
# (alone or summed with the other published features of that symbol) and
# "disambiguated_by_*". "ambiguous_symbol" and "dropped_no_symbol" features stay
# in the fit as their own rows and are not published.
fm_publish <- function(status) !is.na(status) & (status == 'mapped' | startsWith(status, 'disambiguated_by_'))
# Aggregation written out here, independently of de_common.R aggregate_by_symbol:
# published features are combined per symbol (counts and linear values summed,
# log values averaged, log2(x + 1) values summed on the linear scale); every other
# feature is its own fit row under its raw ID.
replay_aggregate <- function(mat, symbols, publish, scale) {
  publish <- publish & !is.na(symbols) & nzchar(symbols)
  key <- ifelse(publish, symbols, NA_character_)
  pub_syms <- unique(key[publish])
  own <- which(!publish)
  own_ids <- rownames(mat)[own]
  own_ids[is.na(own_ids) | !nzchar(own_ids)] <- paste0('UNANNOT_', own[is.na(own_ids) | !nzchar(own_ids)])
  key[own] <- make.unique(c(pub_syms, own_ids))[-seq_along(pub_syms)]
  x <- mat[publish, , drop = FALSE]; k <- key[publish]
  agg <- switch(scale,
    counts = rowsum(x, k, reorder = FALSE),
    log = limma::avereps(x, ID = k),
    log2p1 = log2(rowsum(2^x - 1, k, reorder = FALSE) + 1))
  un <- mat[own, , drop = FALSE]; rownames(un) <- key[own]
  full <- rbind(agg, un); storage.mode(full) <- 'double'; colnames(full) <- colnames(mat)
  list(mat = full, published = pub_syms,
       info = list(n_unmapped_in_fit = sum(is.na(symbols) | !nzchar(symbols)), n_hidden_in_fit = length(own),
                   n_features_collapsed = sum(publish) - length(pub_syms)))
}
max_delta <- function(a, b) if (length(a) && all(is.finite(a)) && all(is.finite(b))) max(abs(a - b)) else Inf
within_tol <- function(a, b) length(a) > 0 && all(is.finite(a)) && all(is.finite(b)) &&
  all(abs(a - b) <= 1e-6 + 1e-6 * pmax(abs(a), abs(b)))
read_kv <- function(path) {
  kv <- fread(path, sep = '\t', header = TRUE, colClasses = 'character', quote = '')
  setNames(kv$value, kv$key)
}

for (j in jobs) {
  target <- file.path(out, paste0(j$configId, '.json'))
  if (file.exists(target)) {
    old <- tryCatch(fromJSON(target), error = function(e) NULL)
    if (!is.null(old$evidenceId) && identical(old$evidenceId, j$evidenceId)) next
  }
  cat(j$configId, '... '); flush.console()
  result <- tryCatch({
    r <- j$config
    prov <- read_kv(j$provenance)
    ss <- read.delim(j$sheet, stringsAsFactors = FALSE)
    ss <- ss[ss$group %in% c('control', 'case'), , drop = FALSE]
    ss$group <- factor(ss$group, levels = c('control', 'case'))
    if (length(unique(ss$sample)) != nrow(ss) || nlevels(droplevels(ss$group)) != 2) stop('invalid sample groups')
    df <- read_expr_file(j$input)
    ids <- if (!is.null(r$id_col) && !is.na(r$id_col) && r$id_col %in% colnames(df)) as.character(df[[r$id_col]]) else as.character(df[[1]])
    bad <- is.na(ids) | ids == '' | ids == 'NA'
    ids[bad] <- paste0('UNANNOT_', which(bad))
    if (length(setdiff(ss$sample, colnames(df)))) stop('missing matrix sample columns')
    mat <- as.matrix(df[, ss$sample, drop = FALSE])
    mat <- matrix(as.numeric(mat), nrow = nrow(mat), dimnames = list(ids, ss$sample))
    if (any(!is.finite(mat))) stop('non-finite input')

    # Rule A2: symbols from the table's own feature map. The map normally lists
    # the configured input rows in order; a producer that prepared the configured
    # matrix from an earlier file maps that file, so fall back to a lookup and,
    # for symbol-keyed inputs, to the public symbol gate.
    if (!is.null(j$geneMap)) {
      # Intake fit matrices (run_september5_r460.R) are already keyed by public
      # symbol; features without one keep their source gene ID, which the
      # track's gene map records with an NA symbol.
      gm <- fread(j$geneMap, sep = '\t', header = TRUE, colClasses = 'character', na.strings = c('NA', ''))
      unmapped <- gm$gene_id[is.na(gm$symbol)]
      if (anyDuplicated(ids) || !setequal(setdiff(ids, unmapped), unique(gm$symbol[!is.na(gm$symbol)])))
        stop('fit matrix rows differ from the gene map symbols and unmapped IDs')
      symbols <- ifelse(ids %in% unmapped, NA_character_, ids)
      publish <- !is.na(symbols)
      mapping <- sprintf('intake gene map: %d published symbols, %d unmapped source IDs kept in the fit', sum(!is.na(symbols)), sum(is.na(symbols)))
      fm <- NULL
    } else fm <- fread(j$featureMap, sep = '\t', header = TRUE, colClasses = 'character', na.strings = c('NA', ''))
    if (is.null(fm)) {
    } else if (nrow(fm) == length(ids) && identical(fm$feature_id, ids)) {
      symbols <- fm$symbol
      publish <- fm_publish(fm$status)
      mapping <- 'feature map, row for row'
    } else {
      symbols <- fm$symbol[match(ids, fm$feature_id)]
      publish <- fm_publish(fm$status[match(ids, fm$feature_id)])
      unmatched <- is.na(match(ids, fm$feature_id))
      if (any(unmatched) && toupper(r$id_type) == 'SYMBOL') {
        symbols[unmatched] <- normalize_gene(ids[unmatched]); publish[unmatched] <- !is.na(symbols[unmatched])
      }
      else if (any(unmatched)) stop(sprintf('%d input features are absent from the feature map', sum(unmatched)))
      mapping <- sprintf('feature map lookup (%d of %d rows); public symbol gate for %d symbol-keyed rows',
                         sum(!unmatched), length(ids), sum(unmatched))
    }
    symbols[bad] <- NA_character_; publish[bad] <- FALSE
    scale <- if (r$input_kind == 'counts') 'counts' else if (!is.null(j$geneMap)) 'log' else unname(prov[['input_scale']])
    if (!scale %in% c('counts', 'log', 'log2p1')) stop(sprintf('unsupported input scale: %s', scale))
    if (r$input_kind == 'counts' && any(mat < 0)) stop('negative counts')
    ag <- replay_aggregate(mat, symbols, publish, scale)
    fitmat <- ag$mat

    bv <- r$batch_var
    use_batch <- !is.null(bv) && !is.na(bv) && nzchar(bv) && bv != 'NA' && bv %in% colnames(ss) && length(unique(ss[[bv]])) > 1
    if (use_batch) { ss$.batch <- factor(ss[[bv]]); design <- model.matrix(~ .batch + group, data = ss) } else design <- model.matrix(~group, data = ss)
    if (qr(design)$rank < ncol(design) || nrow(design) <= ncol(design)) stop('non-identifiable design')
    input_totals <- colSums(mat)
    normalization_deltas <- NULL
    if (r$input_kind == 'counts') {
      y <- DGEList(counts = fitmat)
      keep <- filterByExpr(y, design); y <- y[keep, , keep.lib.sizes = FALSE]
      y <- calcNormFactors(y)
      samples <- data.frame(sample = ss$sample, library_size = unname(input_totals),
        normalization_library_size = y$samples$lib.size, tmm_norm_factor = y$samples$norm.factors,
        effective_library_size = y$samples$lib.size * y$samples$norm.factors)
      y <- estimateDisp(y, design)
      fit <- glmQLFit(y, design)
      qlf <- glmQLFTest(fit, coef = 'groupcase')
      tt <- topTags(qlf, n = Inf, sort.by = 'none')$table
      replay <- data.frame(id = rownames(tt), logFC = tt$logFC, stat = sign(tt$logFC) * tt$F, pvalue = tt$PValue, padj = tt$FDR)
      if (!is.null(j$pairNormalization)) {
        cn <- read.delim(j$pairNormalization, stringsAsFactors = FALSE)
        k <- match(samples$sample, cn$sample)
        if (anyNA(k)) stop('normalization sidecar lacks a sample')
        normalization_deltas <- list(
          tmm_norm_factor = max(abs(cn$TMM_factor[k] - samples$tmm_norm_factor)),
          filtered_library_size = max(abs(cn$filtered_library_size[k] - samples$normalization_library_size) / samples$normalization_library_size),
          raw_library_size = max(abs(cn$raw_library_size[k] - samples$library_size)))
      } else if (!is.null(j$cpmNormalization) && file.exists(j$cpmNormalization)) {
        cn <- read.delim(j$cpmNormalization, stringsAsFactors = FALSE)
        k <- match(samples$sample, cn$sample)
        if (anyNA(k)) stop('cpm normalization sidecar lacks a sample')
        normalization_deltas <- list(
          tmm_norm_factor = max(abs(cn$tmm_norm_factor[k] - samples$tmm_norm_factor)),
          effective_library_size = max(abs(cn$effective_library_size[k] - samples$effective_library_size) / samples$effective_library_size),
          raw_library_size = max(abs(cn$raw_library_size[k] - samples$library_size)))
      }
    } else {
      rv <- apply(fitmat, 1, var); fitmat <- fitmat[is.finite(rv) & rv > 1e-8, , drop = FALSE]
      fit <- eBayes(lmFit(fitmat, design)); tt <- topTable(fit, coef = 'groupcase', number = Inf, sort.by = 'none')
      replay <- data.frame(id = rownames(fitmat), logFC = tt$logFC, stat = tt$t, pvalue = tt$P.Value, padj = tt$adj.P.Val)
      # Aggregation leaves every single-feature symbol and unmapped row unchanged;
      # measure that identity on the rows the fit used.
      counts_by_symbol <- table(symbols[!is.na(symbols)])
      rows <- which(!is.na(symbols) & symbols %in% names(counts_by_symbol)[counts_by_symbol == 1] & symbols %in% rownames(fitmat))
      delta <- if (length(rows)) max(abs(fitmat[symbols[rows], , drop = FALSE] - mat[rows, , drop = FALSE])) else 0
      samples <- data.frame(sample = ss$sample, log2_expression_sum = unname(input_totals), identity_transform_delta = delta)
    }
    published <- replay[replay$id %in% ag$published, , drop = FALSE]
    observed <- read.delim(j$table, check.names = FALSE, stringsAsFactors = FALSE)
    idx <- match(observed$symbol, published$id)
    matched <- sum(!is.na(idx)); comparable <- published[idx, , drop = FALSE]
    cols <- c('logFC', 'stat', 'pvalue', 'padj')
    deltas <- setNames(lapply(cols, function(k) max_delta(observed[[k]], comparable[[k]])), cols)
    same_set <- nrow(published) == nrow(observed) && matched == nrow(observed) && !anyDuplicated(observed$symbol)
    within <- same_set && matched > 0 && all(vapply(cols, function(k) within_tol(observed[[k]], comparable[[k]]), logical(1)))
    normalization_ok <- is.null(normalization_deltas) ||
      (normalization_deltas$tmm_norm_factor <= 1e-9 && max(unlist(normalization_deltas[intersect(names(normalization_deltas), c('effective_library_size', 'filtered_library_size'))])) <= 1e-9 &&
        normalization_deltas$raw_library_size <= 1e-6)
    status <- if (within && normalization_ok) 'pass' else 'review'
    list(status = status, configId = j$configId, inputKind = r$input_kind, inputScale = scale,
      symbolMapping = mapping, inputRows = nrow(df), fitRows = nrow(ag$mat), unmappedInFit = ag$info$n_unmapped_in_fit, unpublishedInFit = ag$info$n_hidden_in_fit,
      featuresCollapsed = ag$info$n_features_collapsed, fittedRows = nrow(replay), publishedRows = nrow(published),
      existingRows = nrow(observed), matchedRows = matched,
      maxAbsoluteDeltas = deltas, cpmNormalizationDeltas = normalization_deltas, samples = samples,
      identityColumn = 'symbol',
      note = if (status == 'pass') paste0('Current inputs reproduce every published DE row within absolute 1e-6 + relative 1e-6 tolerance under the R 4.6.0 rules (A3.1 aggregation by the recorded feature-map symbols and statuses, B1 unrounded counts)',
        if (is.null(normalization_deltas)) '.' else '; the TMM factors and library sizes match the normalization sidecar.')
      else if (!same_set) sprintf('The replay publishes %d rows and the table has %d (%d matched by symbol); inspect the feature map and producer route.', nrow(published), nrow(observed), matched)
      else if (!within) 'The replay does not reproduce every published DE statistic within tolerance; inspect the producer route before using this replay as normalization evidence.'
      else 'The replayed TMM factors or effective library sizes differ from the CPM normalization sidecar.')
  }, error = function(e) list(status = 'not_assessed', configId = j$configId, note = conditionMessage(e)))
  result$evidenceId <- j$evidenceId
  result$software <- list(R = as.character(getRversion()), edgeR = as.character(packageVersion('edgeR')), limma = as.character(packageVersion('limma')))
  write_json(result, target, pretty = TRUE, auto_unbox = TRUE, digits = 16, na = 'null', null = 'null')
  cat(result$status, '\n'); flush.console()
}
