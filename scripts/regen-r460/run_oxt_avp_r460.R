#!/usr/bin/env Rscript
# Analyze reviewed OXT/AVP microarrays on their deposited log-expression scale.
# No CEL processing, scale inference, or author-result reconstruction is done.
#
# Rscript scripts/regen-r460/run_oxt_avp_r460.R [ACCESSION ...] [--check|--validate-inputs]
# HYPO_OUT_ROOT redirects study outputs and intake registration into staging.
# Shared configuration is never edited: merge config.generated.tsv separately.

script <- grep("^--file=", commandArgs(FALSE), value = TRUE)
ROOT <- normalizePath(file.path(dirname(sub("^--file=", "", script[[1L]])), "..", ".."), winslash = "/")
if (as.character(getRversion()) != "4.6.0") stop("This producer requires R 4.6.0; no outputs were written")
suppressPackageStartupMessages({ library(data.table); library(jsonlite); library(limma); library(AnnotationDbi) })
if (as.character(packageVersion("limma")) != "3.68.4") stop("This producer requires limma 3.68.4")
source(file.path(ROOT, "scripts", "lib", "de_common.R"))
de_init(ROOT)
setwd(ROOT)

MANIFEST <- "data/intake/oxt-avp-2026-10-19/studies.json"
ANALYSES <- "data/intake/oxt-avp-2026-10-19/analyses.json"
CONFIG <- "data/intake/oxt-avp-2026-10-19/config.generated.tsv"
args <- commandArgs(trailingOnly = TRUE)
CHECK <- "--check" %in% args
VALIDATE <- "--validate-inputs" %in% args
stopifnot(!(CHECK && VALIDATE), !any(startsWith(args, "--") & !args %in% c("--check", "--validate-inputs")))
requested <- args[!startsWith(args, "--")]
all_studies <- fromJSON(MANIFEST, simplifyVector = FALSE)
if (!length(all_studies)) stop("The intake has no studies with a resolved design review")
unknown <- setdiff(requested, vapply(all_studies, function(s) s$accession, ""))
if (length(unknown)) stop("Unknown or held accession: ", paste(unknown, collapse = ", "))
studies <- if (length(requested)) Filter(function(s) s$accession %in% requested, all_studies) else all_studies
STAGING <- nzchar(hypo_out_root())
registration <- if (STAGING) file.path(hypo_out_root(), "_registry", "oxt-avp-2026-10-19") else dirname(ANALYSES)
analysis_path <- file.path(registration, basename(ANALYSES))
config_path <- file.path(registration, basename(CONFIG))

assert <- function(ok, note) if (!isTRUE(ok)) stop(note, call. = FALSE)
nonempty <- function(value) is.character(value) && length(value) == 1L && !is.na(value) && nzchar(trimws(value))
child <- function(path, directory) {
  assert(nonempty(path) && startsWith(path, paste0(directory, "/")) && !grepl("\\\\", path) &&
    !any(strsplit(path, "/", fixed = TRUE)[[1L]] %in% c("", ".", "..")), paste("Unsafe study path:", path))
  path
}
compare_table <- function(expected, path) {
  assert(file.exists(path), paste("Missing replay output:", path))
  saved <- fread(path, na.strings = c("NA", ""))
  assert(identical(names(expected), names(saved)) && nrow(expected) == nrow(saved), paste("Replay schema/row mismatch:", path))
  for (key in names(expected)) {
    a <- expected[[key]]; b <- saved[[key]]
    if (is.numeric(a)) {
      assert(all(is.na(a) == is.na(b)) && all(abs(a - b) <= 1e-10 + 1e-8 * abs(a), na.rm = TRUE), paste("Replay numeric mismatch:", path, key))
    } else assert(identical(as.character(a), as.character(b)), paste("Replay identity mismatch:", path, key))
  }
}
save_table <- function(table, path) {
  if (CHECK) compare_table(table, path) else write_tsv_lf(table, path)
}
source_bindings <- c(GSE30733 = "rat_son_lactation_gse30733", GSE65663 = "rat_son_salt_gse65663")
source_directories <- c(GSE30733 = "geo_replication/datasets/GSE30733_rnor_son_lactation",
  GSE65663 = "geo_replication/datasets/GSE65663_rnor_son_salt")
records <- list()

# Validate every requested study before writing anything, including held designs.
for (s in studies) {
  assert(s$accession %in% names(source_bindings) && identical(s$id, unname(source_bindings[[s$accession]])) &&
    identical(s$dir, unname(source_directories[[s$accession]])), "Unreviewed OXT/AVP source identity")
  assert(identical(s$organism, "Rattus norvegicus") && nonempty(s$expressionUnit), paste(s$accession, "requires rat identity and an explicit expression unit"))
  review <- s$designReview
  assert(!is.null(review) && review$replicationStatus %in% c("pass", "pass_with_notes"), paste(s$accession, "independent replication is unresolved; analysis is held"))
  assert(nonempty(review$biologicalUnit) && nonempty(review$note) && length(review$evidencePaths) > 0L,
    paste(s$accession, "requires an explained, source-bound design review"))
  evidence <- unlist(review$evidencePaths, use.names = FALSE)
  assert(all(file.exists(file.path(ROOT, evidence))), paste(s$accession, "design evidence is missing"))
  assert(length(s$tracks) == 1L && length(s$groups) >= 2L && length(s$contrasts) >= 1L, "This SON intake requires one track and explicit groups/contrasts")
  group_keys <- vapply(s$groups, function(g) g$key, "")
  contrast_ids <- vapply(s$contrasts, function(co) co$id, "")
  assert(!anyDuplicated(group_keys) && !anyDuplicated(contrast_ids), "Duplicate group or contrast IDs")
  for (tr in s$tracks) {
    assert(identical(tr$kind, "matrix_log"), "Only a source-reviewed deposited log-expression matrix is supported")
    assert(nonempty(tr$analysisId) && grepl(paste0("^", s$accession, "(_[A-Za-z0-9_]+)?$"), tr$analysisId), "Analysis ID is not bound to the source accession")
    child(tr$matrix, s$dir); child(tr$samplesheet, s$dir)
    assert(file.exists(tr$matrix) && file.exists(tr$samplesheet), paste(s$accession, "prepared input is missing"))
    ss <- fread(tr$samplesheet, na.strings = c("NA", ""))
    assert(all(c("sample", "group", "biological_unit") %in% names(ss)), "Samplesheet needs sample, group and biological_unit")
    if ("included" %in% names(ss)) ss <- ss[tolower(as.character(included)) == "true"]
    assert(nrow(ss) > 0L && !anyNA(ss[, .(sample, group, biological_unit)]) &&
      all(nzchar(ss$sample)) && all(nzchar(ss$biological_unit)) && !anyDuplicated(ss$sample) &&
      !anyDuplicated(ss$biological_unit) && all(ss$group %in% group_keys), "Samples must identify distinct reviewed biological units in declared groups")
    input <- fread(tr$matrix)
    assert(all(c("gene_id", "symbol", ss$sample) %in% names(input)), "Prepared matrix is missing IDs, symbols or selected samples")
    assert(!anyNA(input$gene_id) && !anyDuplicated(input$gene_id) && all(nzchar(input$gene_id)), "Prepared source feature IDs must be unique")
    x <- as.matrix(input[, ss$sample, with = FALSE]); storage.mode(x) <- "double"
    assert(nrow(x) >= 100L && all(is.finite(x)), "Prepared log expression must be finite and transcriptome-wide")
    for (co in s$contrasts) {
      assert(co$baseline %in% group_keys && co$case %in% group_keys && co$baseline != co$case, "Contrast references invalid groups")
      assert(sum(ss$group == co$baseline) >= 3L && sum(ss$group == co$case) >= 3L, "Each contrast requires at least three independent reviewed units per arm")
    }
  }
}
if (VALIDATE) {
  cat("Validated source-bound log-expression inputs and independent units for", length(studies), "studies; no analysis outputs written\n")
  quit(save = "no", status = 0L)
}

for (s in studies) {
  proc <- if (CHECK) file.path(ROOT, s$dir, "processed") else dataset_output_dir(s$dir, "processed")
  meta <- if (CHECK) file.path(ROOT, s$dir, "metadata") else dataset_output_dir(s$dir, "metadata")
  for (tr in s$tracks) {
    ss <- fread(tr$samplesheet, na.strings = c("NA", ""))
    if ("included" %in% names(ss)) ss <- ss[tolower(as.character(included)) == "true"]
    input <- fread(tr$matrix)
    raw <- as.matrix(input[, ss$sample, with = FALSE]); storage.mode(raw) <- "double"; rownames(raw) <- input$gene_id
    # Source probe annotations are retained; never guess a symbol for a probe.
    symbols <- normalize_gene(as.character(input$symbol))
    extras <- setdiff(names(input), c("gene_id", "symbol", ss$sample))
    mar <- resolve_ambiguous_mar(as.character(input$gene_id), symbols, s$organism, setNames(lapply(extras, function(k) input[[k]]), extras))
    ag <- aggregate_by_symbol(raw, mar$symbols, "log", labels = mar$labels, resolved_by = mar$resolved_by)
    mat <- ag$mat; published <- ag$published
    stem <- tr$analysisId
    model_path <- file.path(proc, paste0(stem, "_model_input.tsv.gz"))
    expression_path <- file.path(proc, paste0(stem, "_expression.tsv.gz"))
    save_table(data.table(gene_id = rownames(mat), as.data.table(mat)), model_path)
    save_table(data.table(gene_id = published, as.data.table(mat[published, , drop = FALSE])), expression_path)
    feature_path <- file.path(proc, paste0(stem, "_feature_map.tsv.gz"))
    if (!CHECK) write_feature_map(ag$feature_map, stem, proc)
    source_review_paths <- unlist(s$designReview$evidencePaths, use.names = FALSE)
    for (ci in seq_along(s$contrasts)) {
      co <- s$contrasts[[ci]]
      aid <- if (ci == 1L) stem else paste0(stem, "_", co$id)
      subss <- copy(ss[group %in% c(co$baseline, co$case)])
      subss$group <- factor(ifelse(subss$group == co$baseline, "control", "case"), levels = c("control", "case"))
      if (!is.null(co$covariate)) {
        assert(co$covariate %in% names(subss) && !anyNA(subss[[co$covariate]]), "Missing declared covariate")
        subss$.batch <- factor(subss[[co$covariate]])
        design <- model.matrix(~.batch + group, subss)
      } else design <- model.matrix(~group, subss)
      assert(qr(design)$rank == ncol(design) && nrow(design) > ncol(design), paste(aid, "design is rank-deficient or has no residual degrees of freedom"))
      fit <- fit_limma_matrix(mat[, subss$sample, drop = FALSE], design)
      assert(nrow(fit$mat) >= 100L, "Variance filter retained fewer than 100 features")
      tt <- topTable(fit$fit, coef = "groupcase", number = Inf, sort.by = "none")
      j <- match("groupcase", colnames(design))
      se_all <- fit$fit$stdev.unscaled[, j] * sqrt(fit$fit$s2.post)
      keep <- rownames(tt) %in% published
      de <- data.table(id = rownames(tt)[keep], symbol = rownames(tt)[keep], logFC = tt$logFC[keep],
        stat = tt$t[keep], pvalue = tt$P.Value[keep], padj = tt$adj.P.Val[keep], method = "limma",
        direction = ifelse(tt$logFC[keep] < 0, "down", "up"))
      se <- se_all[keep]
      assert(nrow(de) >= 100L && !anyNA(de) && !anyDuplicated(de$symbol) && all(is.finite(de$logFC)) &&
        all(is.finite(de$stat)) && all(de$pvalue >= 0 & de$pvalue <= 1) && all(de$padj >= 0 & de$padj <= 1) &&
        all(is.finite(se) & se > 0), "Invalid limma statistics or coefficient standard errors")
      de_path <- file.path(proc, paste0(aid, "_DE.tsv")); se_path <- file.path(proc, paste0(aid, "_SE.tsv"))
      sample_path <- file.path(meta, paste0(aid, "_analysis_samplesheet.tsv"))
      sample_qc <- file.path(proc, paste0(aid, "_sample_qc.tsv"))
      save_table(de, de_path); save_table(data.table(id = de$id, se = se), se_path); save_table(subss, sample_path)
      save_table(data.table(sample = subss$sample, identity_transform_delta = 0,
        log_expression_sum = colSums(mat[, subss$sample, drop = FALSE]), method = "submitted log expression; shared pre-fit symbol averaging"), sample_qc)
      provenance_path <- file.path(proc, paste0(aid, "_provenance.tsv"))
      if (CHECK) {
        prov <- fread(provenance_path); p <- setNames(as.character(prov$value), prov$key)
        assert(identical(p[["generator_sha256"]], sha256_file(de_script_path())) &&
          identical(p[["generator_2_sha256"]], sha256_file(file.path(ROOT, "scripts/lib/de_common.R"))) &&
          identical(p[["input_manifest_sha256"]], sha256_file(MANIFEST)) &&
          identical(p[["input_matrix_sha256"]], sha256_file(tr$matrix)) &&
          identical(p[["input_samplesheet_sha256"]], sha256_file(tr$samplesheet)), "Current producer/source provenance is stale")
        for (key in grep("^input_.*_sha256$", names(p), value = TRUE)) {
          path <- p[[sub("_sha256$", "", key)]]
          assert(file.exists(path) && identical(p[[key]], sha256_file(path)), paste("Pinned source/design evidence changed:", path))
        }
        for (key in grep("^output_.*_sha256$", names(p), value = TRUE)) {
          path <- file.path(proc, p[[sub("_sha256$", "", key)]])
          assert(file.exists(path) && identical(p[[key]], sha256_file(path)), paste("Pinned published output changed:", path))
        }
      } else write_provenance(aid, proc, de_script_path(),
        inputs = c(matrix = tr$matrix, samplesheet = tr$samplesheet, manifest = MANIFEST,
          setNames(source_review_paths, paste0("design_evidence_", seq_along(source_review_paths)))),
        outputs = c(de = de_path, se = se_path, model_input = model_path, expression = expression_path, feature_map = feature_path),
        fields = c(list(accession = s$accession, track = tr$id, contrast = co$id, organism = s$organism,
          input_kind = "matrix_log", expression_unit = s$expressionUnit, method = "limma", design = paste(colnames(design), collapse = " + "),
          coef = "groupcase", design_rank = qr(design)$rank, residual_df = nrow(design) - ncol(design),
          samples_control = paste(subss$sample[subss$group == "control"], collapse = ","),
          samples_case = paste(subss$sample[subss$group == "case"], collapse = ","),
          replication_status = s$designReview$replicationStatus, biological_unit = s$designReview$biologicalUnit,
          n_features_tested = nrow(tt), n_unmapped_tested = sum(!keep), n_de_rows = nrow(de),
          normalization = "Deposited log expression unchanged; shared limma::avereps for unambiguous same-symbol probes before fitting",
          fdr_family = "all variance-filtered fit rows including unmapped rows, hidden only from publication"), ag$info))
      records[[length(records) + 1L]] <- list(studyId = s$id, accession = s$accession, track = tr$id, contrast = co$id,
        analysisId = aid, inputKind = "matrix", control = sum(subss$group == "control"), case = sum(subss$group == "case"),
        nGenes = nrow(de), fdr05 = sum(de$padj < .05), seCoverage = 1, fullInputRows = nrow(raw),
        mappedRows = length(published), unmappedRowsInFit = ag$info$n_unmapped_in_fit,
        design = colnames(design), designRank = qr(design)$rank, residualDf = nrow(design) - ncol(design),
        samples = as.character(subss$sample), counts = repo_equivalent_path(model_path), cpm = repo_equivalent_path(expression_path),
        samplesheet = tr$samplesheet, analysisSamplesheet = repo_equivalent_path(sample_path),
        provenance = repo_equivalent_path(provenance_path), sourceSha256 = sha256_file(tr$matrix), deSha256 = sha256_file(de_path),
        expressionSha256 = sha256_file(expression_path), replicationStatus = s$designReview$replicationStatus)
      cat(aid, ":", nrow(de), "public genes;", sum(de$padj < .05), "FDR < .05;", if (CHECK) "replay agrees" else "written", "\n")
    }
  }
}
if (!CHECK) {
  dir.create(registration, recursive = TRUE, showWarnings = FALSE)
  previous <- if (length(requested) && file.exists(analysis_path)) fromJSON(analysis_path, simplifyVector = FALSE) else list()
  replaced <- vapply(studies, function(s) s$id, "")
  merged <- c(Filter(function(a) !a$studyId %in% replaced, previous), records)
  write_json_lf(merged, analysis_path, pretty = TRUE, auto_unbox = TRUE, null = "null")
  config <- rbindlist(lapply(merged, function(a) {
    s <- all_studies[[match(a$studyId, vapply(all_studies, function(study) study$id, ""))]]
    co <- s$contrasts[[match(a$contrast, vapply(s$contrasts, function(contrast) contrast$id, ""))]]
    data.table(id = a$analysisId, dir = sub("^geo_replication/", "", s$dir), organism = s$organism,
      id_type = "SYMBOL", id_col = "gene_id", id_map = "NA", input_kind = "matrix",
      input_path = sub("^geo_replication/", "", a$counts), samplesheet = sub("^geo_replication/", "", a$analysisSamplesheet),
      batch_var = if (is.null(co$covariate)) "NA" else co$covariate, status = "ready")
  }))
  write_tsv_lf(config, config_path)
  cat("Wrote dedicated intake analyses/config; shared configuration was not edited. Run the R4.6 FGSEA producer after merging the config rows.\n")
}
