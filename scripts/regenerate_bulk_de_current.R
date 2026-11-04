# Current orchestration successor, 2026-10-23. The sealed prior driver is
# preserved; only GSE135007 routes to the canonical serialization successor.
#!/usr/bin/env Rscript
# Regenerate every bulk differential-expression output (DE, SE sidecar, browser
# CPM / expression matrices, provenance) into a STAGING tree under the single
# R runtime running this script, then compare the staged tables with the
# committed ones.
#
#   Rscript scripts/regenerate_bulk_de_current.R --out <output-dir> [--workers 8]
#          [--only ID,ID,...] [--phase run|compare|all|fgsea|fgsea-compare] [--control <dir>]
#          [--committed <extract of the committed geo_replication tree>]
#
# Every producer is run as its own Rscript process with HYPO_OUT_ROOT=<out>
# (writes go to <out>/<dataset dir>/processed|metadata|raw, never the
# repository) and HYPO_SKIP_FGSEA=1 (enrichment is regenerated separately).
# Producers and their rules are listed in scripts/lib/de_common.R.
#
# Jobs (all producers live in scripts/regen-r460/; the sealed originals they
# derive from are never run or modified):
#   config    geo_replication/config/datasets.tsv rows: run_dataset_r460.R, then
#             compute_edger_se_r460.R for count inputs. A preparation is re-run
#             first only when its output changed under the shared rules (rule B:
#             prep_2026batch2_r460.R, prep_GSE229838_r460.R,
#             prep_GSE282067_r460.R); otherwise the tracked prepared input is used.
#   batch1    supported_matrix_r460.R <id>
#   hfd       run_hfd_r460.R <accession>
#   sept5     run_september5_r460.R <accession>
#   dedicated de_gse135639_r460.R, de_gse157077_r460.R, de_gse154274_r460.R
#   fgsea     run_fgsea_r460.R (phase fgsea)
#
# Outputs: <out>/_logs/<job>.log, <out>/RUN_SUMMARY.tsv (one row per DE table),
# <out>/COMPARISON.tsv (phase compare), <stem>_FGSEA_* next to each staged DE
# table (phase fgsea) and <out>/FGSEA_COMPARISON.tsv (phase fgsea-compare).

suppressPackageStartupMessages({ library(data.table); library(jsonlite); library(parallel) })
REPO <- local({
  f <- grep("^--file=", commandArgs(FALSE), value = TRUE)
  if (length(f)) dirname(dirname(normalizePath(sub("^--file=", "", f[[1L]]), winslash = "/"))) else getwd()
})
source(file.path(REPO, "scripts", "lib", "de_common.R")); de_init(REPO)

arg <- function(name, default = NULL) {
  a <- commandArgs(trailingOnly = TRUE); i <- match(paste0("--", name), a)
  if (is.na(i)) default else a[[i + 1L]]
}
OUT <- arg("out"); if (is.null(OUT)) stop("--out <staging root> is required")
dir.create(OUT, recursive = TRUE, showWarnings = FALSE)
OUT <- normalizePath(OUT, winslash = "/")
if (startsWith(tolower(OUT), tolower(paste0(REPO, "/")))) stop("--out must be outside the repository")
WORKERS <- as.integer(arg("workers", "8"))
ONLY <- arg("only"); ONLY <- if (is.null(ONLY)) character() else strsplit(ONLY, ",", fixed = TRUE)[[1L]]
PHASE <- arg("phase", "all")
RSCRIPT <- file.path(R.home("bin"), if (.Platform$OS.type == "windows") "Rscript.exe" else "Rscript")

# ---- job inventory -----------------------------------------------------------

cfg <- fread(file.path(REPO, "geo_replication/config/datasets.tsv"), na.strings = NULL)
manifest_stems <- function(path, sept5) {
  studies <- fromJSON(file.path(REPO, path), simplifyVector = FALSE)
  lapply(studies, function(s) {
    stems <- unlist(lapply(seq_along(s$tracks), function(ti) {
      tr <- s$tracks[[ti]]
      base <- if (sept5) { if (ti == 1L) s$accession else paste0(s$accession, "_", tr$id) } else tr$analysisId
      vapply(seq_along(s$contrasts), function(ci) if (ci == 1L) base else paste0(base, "_", s$contrasts[[ci]]$id), "")
    }))
    list(accession = s$accession, dir = s$dir, stems = stems)
  })
}
HFD <- manifest_stems("data/intake/hfd-2026-09-12/studies.json", FALSE)
S5 <- manifest_stems("data/intake/september5-2026/studies.json", TRUE)
driver_stems <- c(unlist(lapply(HFD, `[[`, "stems")), unlist(lapply(S5, `[[`, "stems")))
BATCH1 <- c(`E-MTAB-12340` = "EMTAB12340_mmus_hypothalamus_puberty", GSE128148 = "GSE128148_mmus_arc_corticosterone",
            GSE156859 = "GSE156859_rnor_fetal_hypothalamus_ozone", GSE167105 = "GSE167105_mmus_hypothalamus_thrb",
            GSE189945 = "GSE189945_mmus_arc_development")
# Preparations whose output changes under rule B (they used to round).
PREP <- list(GSE235479 = c("scripts/regen-r460/prep_2026batch2_r460.R", "GSE235479"),
             `E-MTAB-6929` = c("scripts/regen-r460/prep_2026batch2_r460.R", "E-MTAB-6929"),
             GSE229838 = "scripts/regen-r460/prep_GSE229838_r460.R",
             GSE282067 = "scripts/regen-r460/prep_GSE282067_r460.R",
             GSE205313 = "scripts/regen-r460/prep_GSE205313_r460.R")
NOTES <- list()   # per-job rule exceptions (none: GSE205313 is prepared unrounded from its pinned sources)

jobs <- list()
add_job <- function(name, kind, dirs, stems, steps, note = "") {
  jobs[[name]] <<- list(name = name, kind = kind, dirs = dirs, stems = stems, steps = steps, note = note)
}
for (k in seq_len(nrow(cfg))) {
  r <- cfg[k]
  if (r$id %in% driver_stems || r$id %in% names(BATCH1)) next
  steps <- list()
  if (!is.null(PREP[[r$id]])) steps <- c(steps, list(list(script = PREP[[r$id]][[1]], args = PREP[[r$id]][-1], prep = TRUE)))
  steps <- c(steps, list(list(script = "scripts/regen-r460/run_dataset_r460.R", args = r$id,
                              prep_generator = if (!is.null(PREP[[r$id]])) PREP[[r$id]][[1]] else "")))
  if (r$input_kind == "counts") steps <- c(steps, list(list(script = "scripts/regen-r460/compute_edger_se_r460.R", args = r$id, se = TRUE)))
  add_job(r$id, "config", basename(r$dir), r$id, steps, if (is.null(NOTES[[r$id]])) "" else NOTES[[r$id]])
}
for (id in names(BATCH1)) add_job(id, "batch1", BATCH1[[id]], id,
  list(list(script = "scripts/regen-r460/supported_matrix_r460.R", args = id)))
for (s in HFD) add_job(paste0("hfd_", s$accession), "hfd", basename(s$dir), s$stems,
  list(list(script = "scripts/regen-r460/run_hfd_r460.R", args = s$accession)))
for (s in S5) add_job(paste0("sept5_", s$accession), "sept5", basename(s$dir), s$stems,
  list(list(script = if (s$accession == "GSE135007") "scripts/regen-r460/run_gse135007_serialized_r460.R" else "scripts/regen-r460/run_september5_r460.R", args = s$accession)))
add_job("GSE135639", "dedicated", "GSE135639_mmus_pomc_maternal_hfd",
        paste0("GSE135639_", c("dietP0", "dietP21", "ageChow", "ageHFD")), list(list(script = "scripts/regen-r460/de_gse135639_r460.R", args = character())))
add_job("GSE157077", "dedicated", "GSE157077_mmus_scn_hfd", "GSE157077", list(list(script = "scripts/regen-r460/de_gse157077_r460.R", args = character())))
add_job("GSE154274", "dedicated", "GSE154274_rnor_hypo_pcos_offspring", "GSE154274", list(list(script = "scripts/regen-r460/de_gse154274_r460.R", args = character())))

# Committed DE tables that are deliberately NOT regenerated, with the reason.
SKIPPED <- data.table(
  job = c("GSE201986", "GSE113943"),
  dataset_dir = c("GSE201986_mmul_arc_sex_season", "GSE113943_mmus_hypothalamus_array"),
  stem = c("GSE201986", "GSE113943"),
  reason = c(
    paste("not a registered explorer dataset (excluded from FGSEA in run_mouse_fgsea.R); its features are",
          "mixed Ensembl macaque transcripts / RefSeq / custom TU ids with no deposited feature-to-gene map,",
          "so rule A (map to a gene symbol, drop unmapped) would drop every feature; no R producer exists"),
    paste("archived microarray (geo_replication/archive, unregistered); no config row, prepared matrix or",
          "probe-to-symbol map is tracked, so the original run cannot be re-specified")))

if (length(ONLY)) jobs <- jobs[names(jobs) %in% ONLY | vapply(jobs, function(j) any(j$stems %in% ONLY), TRUE)]
cat(sprintf("%d jobs (%d DE tables) -> %s\n", length(jobs), sum(lengths(lapply(jobs, `[[`, "stems"))), OUT))

# ---- run -------------------------------------------------------------------------

run_job <- function(job, OUT, REPO, RSCRIPT) {
  logdir <- file.path(OUT, "_logs"); dir.create(logdir, showWarnings = FALSE, recursive = TRUE)
  log <- file.path(logdir, paste0(gsub("[^A-Za-z0-9_.-]", "_", job$name), ".log"))
  unlink(log)
  Sys.setenv(HYPO_OUT_ROOT = OUT, HYPO_SKIP_FGSEA = "1", HYPO_PREP_GENERATOR = "",
             HYPO_RULE_EXCEPTION = job$note)
  setwd(REPO)
  t0 <- Sys.time(); codes <- integer()
  for (st in job$steps) {
    Sys.setenv(HYPO_PREP_GENERATOR = if (length(st$prep_generator) && nzchar(st$prep_generator)) file.path(REPO, st$prep_generator) else "")
    o <- tempfile(); e <- tempfile()
    code <- system2(RSCRIPT, c(shQuote(file.path(REPO, st$script)), shQuote(st$args)), stdout = o, stderr = e)
    cat(sprintf("==== %s %s (exit %s)\n", st$script, paste(st$args, collapse = " "), code), file = log, append = TRUE)
    for (f in c(o, e)) if (file.exists(f)) { cat(readLines(f, warn = FALSE), sep = "\n", file = log, append = TRUE); cat("\n", file = log, append = TRUE) }
    unlink(c(o, e))
    codes <- c(codes, code)
    if (code != 0 && !isTRUE(st$se)) break
  }
  list(name = job$name, codes = codes, seconds = as.numeric(difftime(Sys.time(), t0, units = "secs")), log = log)
}

summarize <- function(results) {
  rows <- list()
  for (job in jobs) {
    res <- results[[job$name]]
    txt <- if (!is.null(res) && file.exists(res$log)) readLines(res$log, warn = FALSE) else character()
    err <- grep("^Error|QC_FAILURE|FAILED|halted|EXCLUDE|PROCESSING FAILURE", txt, value = TRUE)
    for (stem in job$stems) {
      proc <- file.path(OUT, job$dirs[[1]], "processed")
      de_ok <- file.exists(file.path(proc, paste0(stem, "_DE.tsv"))) && file.exists(file.path(proc, paste0(stem, "_provenance.tsv")))
      se_needed <- file.exists(file.path(REPO, "geo_replication", c("datasets", "archive"), job$dirs[[1]], "processed", paste0(stem, "_SE.tsv")))
      se_ok <- file.exists(file.path(proc, paste0(stem, "_SE.tsv")))
      main_idx <- which(!vapply(job$steps, function(s) isTRUE(s$se), TRUE))
      main_ok <- !is.null(res) && length(res$codes) >= max(main_idx) && all(res$codes[main_idx] == 0)
      status <- if (de_ok && main_ok && (!any(se_needed) || se_ok)) "ok" else if (de_ok && main_ok) "ok_de_no_se" else "failed"
      rows[[length(rows) + 1L]] <- data.table(job = job$name, kind = job$kind, dataset_dir = job$dirs[[1]], stem = stem,
        status = status, se_status = if (se_ok) "written" else if (any(se_needed)) "MISSING" else "not_applicable",
        seconds = if (is.null(res)) NA_real_ else round(res$seconds, 1),
        exit_codes = if (is.null(res)) "" else paste(res$codes, collapse = ","),
        error = if (length(err)) paste(tail(err, 3), collapse = " | ") else "", note = job$note)
    }
  }
  out <- rbindlist(rows)
  if (!length(ONLY)) out <- rbind(out, SKIPPED[, .(job, kind = "skipped", dataset_dir, stem, status = "skipped_documented",
    se_status = "not_applicable", seconds = NA_real_, exit_codes = "", error = "", note = reason)])
  out
}

if (PHASE %in% c("run", "all")) {
  cl <- makePSOCKcluster(min(WORKERS, length(jobs)))
  on.exit(stopCluster(cl), add = TRUE)
  # Longest first: the big multi-track September studies and large count matrices.
  size_of <- function(j) length(j$stems) * 10 + (j$kind == "config")
  ordered <- jobs[order(-vapply(jobs, size_of, 0))]
  t0 <- Sys.time()
  results <- parLapplyLB(cl, ordered, run_job, OUT = OUT, REPO = REPO, RSCRIPT = RSCRIPT)
  names(results) <- vapply(results, `[[`, "", "name")
  saveRDS(results, file.path(OUT, "_logs", sprintf("results_%s.rds", format(Sys.time(), "%Y%m%d_%H%M%S"))))
  summary <- summarize(results)
  sp <- file.path(OUT, if (length(ONLY)) "RUN_SUMMARY_partial.tsv" else "RUN_SUMMARY.tsv")
  fwrite(summary, sp, sep = "\t", eol = "\n")
  cat(sprintf("run finished in %.1f min: %s\n", as.numeric(difftime(Sys.time(), t0, units = "mins")),
              paste(names(table(summary$status)), table(summary$status), sep = "=", collapse = " ")))
}

# ---- compare staging with committed ---------------------------------------------
#
# Tables are joined on the PUBLIC symbol: committed (and control) tables are
# projected through normalize_gene() exactly as the bundle builders project
# them; where two committed rows project to one symbol the strongest |stat| is
# kept (the old post-test rule). Staging tables are already keyed by it.
#
# --control <dir> (optional) names an environment-only control tree: the
# pre-change producers re-run under this R on the committed inputs. It splits
# every difference into an environment part (committed vs control) and a rule
# part (control vs staging), which is what the classification uses.

CONTROL <- arg("control")

# --committed <dir>: a read-only extract of the COMMITTED tables (e.g.
# `git archive HEAD` of geo_replication/*/*/processed), so the comparison stays
# against the commit even after staged outputs are promoted into the working
# tree. Default: the working tree.
COMMITTED_ROOT <- arg("committed", file.path(REPO))
committed_path <- function(dsdir, file) {
  cand <- file.path(COMMITTED_ROOT, "geo_replication", c("datasets", "archive"), dsdir, "processed", file)
  cand[file.exists(cand)][1]
}

read_de_keyed <- function(path, normalize) {
  d <- fread(path, colClasses = list(character = c("id", "symbol")))
  sym <- if ("symbol" %in% names(d)) d$symbol else d$id
  sym[is.na(sym) | !nzchar(sym)] <- d$id[is.na(sym) | !nzchar(sym)]
  d[, key := if (normalize) normalize_gene(sym) else sym]
  n_rows <- nrow(d)
  d <- d[!is.na(key)]
  d <- d[order(-abs(stat))]
  n_dup <- sum(duplicated(d$key))
  d <- d[!duplicated(key)]
  list(d = d, n_rows = n_rows, n_dup = n_dup)
}

mx <- function(x) if (length(x) && any(is.finite(x))) max(abs(x), na.rm = TRUE) else NA_real_

# Metrics for table `b` relative to table `a` (both keyed).
pair_metrics <- function(a, b) {
  m <- merge(a[, .(key, logFC, stat, pvalue, padj)], b[, .(key, logFC, stat, pvalue, padj)], by = "key", suffixes = c(".a", ".b"))
  sa <- !is.na(m$padj.a) & m$padj.a < 0.05; sb <- !is.na(m$padj.b) & m$padj.b < 0.05
  lost_missing <- sum(a$padj < 0.05 & !(a$key %in% b$key), na.rm = TRUE)
  gained_missing <- sum(b$padj < 0.05 & !(b$key %in% a$key), na.rm = TRUE)
  union_sig <- sum(sa | sb) + lost_missing + gained_missing
  crossing <- sum(sa != sb)
  list(n_a = nrow(a), n_b = nrow(b), n_shared = nrow(m),
       max_abs_dlogFC = mx(m$logFC.b - m$logFC.a), max_abs_dstat = mx(m$stat.b - m$stat.a),
       max_abs_dPValue = mx(m$pvalue.b - m$pvalue.a), max_abs_dFDR = mx(m$padj.b - m$padj.a),
       median_abs_dlogFC = if (nrow(m)) median(abs(m$logFC.b - m$logFC.a)) else NA_real_,
       fdr05_a = sum(a$padj < 0.05, na.rm = TRUE), fdr05_b = sum(b$padj < 0.05, na.rm = TRUE),
       fdr05_crossing_shared = crossing, fdr05_gained = sum(!sa & sb), fdr05_lost = sum(sa & !sb),
       fdr05_lost_absent = lost_missing, fdr05_gained_absent = gained_missing,
       fdr05_changed_fraction = if (union_sig) (crossing + lost_missing + gained_missing) / union_sig else 0,
       sign_flips_fdr05_either = sum((sa | sb) & sign(m$logFC.a) != sign(m$logFC.b)),
       sign_flips_fdr05_both = sum((sa & sb) & sign(m$logFC.a) != sign(m$logFC.b)))
}

se_keyed <- function(path, de_keyed) {
  t <- fread(path, colClasses = list(character = "id"))
  id2key <- setNames(de_keyed$key, as.character(de_keyed$id))
  t[, key := ifelse(id %in% names(id2key), id2key[id], normalize_gene(id))]
  t[!is.na(key) & !duplicated(key)]
}
se_metrics <- function(ta, tb) {
  j <- merge(ta[, .(key, se_a = se)], tb[, .(key, se_b = se)], by = "key")
  list(se_shared = nrow(j), max_abs_dSE = mx(j$se_b - j$se_a),
       median_se_ratio = if (nrow(j)) median(j$se_b / j$se_a) else NA_real_)
}

compare_stem <- function(dsdir, stem, prov) {
  cp <- committed_path(dsdir, paste0(stem, "_DE.tsv"))
  sp <- file.path(OUT, dsdir, "processed", paste0(stem, "_DE.tsv"))
  if (is.na(cp) || !file.exists(sp)) return(NULL)
  old <- read_de_keyed(cp, TRUE); new <- read_de_keyed(sp, FALSE)
  pm <- pair_metrics(old$d, new$d)
  se_old <- committed_path(dsdir, paste0(stem, "_SE.tsv")); se_new <- file.path(OUT, dsdir, "processed", paste0(stem, "_SE.tsv"))
  se <- if (!is.na(se_old) && file.exists(se_new)) se_metrics(se_keyed(se_old, old$d), se_keyed(se_new, new$d)) else
    list(se_shared = NA_integer_, max_abs_dSE = NA_real_, median_se_ratio = NA_real_)
  pv <- function(k) if (!is.null(prov[[k]])) prov[[k]] else NA
  row <- data.table(dataset_dir = dsdir, stem = stem,
    n_committed_rows = old$n_rows, n_committed_symbols = pm$n_a, committed_dup_symbols = old$n_dup,
    n_staging = pm$n_b, n_shared = pm$n_shared,
    max_abs_dlogFC = pm$max_abs_dlogFC, max_abs_dstat = pm$max_abs_dstat,
    max_abs_dPValue = pm$max_abs_dPValue, max_abs_dFDR = pm$max_abs_dFDR, median_abs_dlogFC = pm$median_abs_dlogFC,
    fdr05_committed = pm$fdr05_a, fdr05_staging = pm$fdr05_b,
    fdr05_crossing_shared = pm$fdr05_crossing_shared, fdr05_gained = pm$fdr05_gained, fdr05_lost = pm$fdr05_lost,
    fdr05_lost_absent_in_staging = pm$fdr05_lost_absent, fdr05_gained_absent_in_committed = pm$fdr05_gained_absent,
    fdr05_changed_fraction = pm$fdr05_changed_fraction,
    sign_flips_fdr05_either = pm$sign_flips_fdr05_either, sign_flips_fdr05_both = pm$sign_flips_fdr05_both,
    se_shared = se$se_shared, max_abs_dSE = se$max_abs_dSE, median_se_ratio = se$median_se_ratio,
    n_features_raw = as.integer(pv("n_features_raw")),
    n_unmapped_in_fit = as.integer(pv("n_unmapped_in_fit")), n_features_collapsed = as.integer(pv("n_features_collapsed")),
    input_fractional_cells = suppressWarnings(as.numeric(pv("input_fractional_cells"))))
  if (!is.null(CONTROL)) {
    ctp <- file.path(CONTROL, dsdir, "processed", paste0(stem, "_DE.tsv"))
    if (file.exists(ctp)) {
      ctl <- read_de_keyed(ctp, TRUE)
      env <- pair_metrics(old$d, ctl$d); rul <- pair_metrics(ctl$d, new$d)
      pick <- c("n_shared", "max_abs_dlogFC", "max_abs_dFDR", "fdr05_b", "fdr05_crossing_shared",
                "fdr05_changed_fraction", "sign_flips_fdr05_either")
      for (k in pick) { row[[paste0("env_", k)]] <- env[[k]]; row[[paste0("rule_", k)]] <- rul[[k]] }
      row$env_same_gene_set <- setequal(old$d$key, ctl$d$key)
      row$rule_same_gene_set <- setequal(ctl$d$key, new$d$key)
      cse <- file.path(CONTROL, dsdir, "processed", paste0(stem, "_SE.tsv"))
      if (!is.na(se_old) && file.exists(cse)) row$env_median_se_ratio <- se_metrics(se_keyed(se_old, old$d), se_keyed(cse, ctl$d))$median_se_ratio
    }
  }
  row
}

if (PHASE %in% c("compare", "all")) {
  sp <- file.path(OUT, if (length(ONLY)) "RUN_SUMMARY_partial.tsv" else "RUN_SUMMARY.tsv")
  summary <- if (file.exists(sp)) fread(sp) else summarize(list())
  if (length(ONLY)) summary <- summary[job %in% ONLY | stem %in% ONLY]
  rows <- list()
  for (i in which(summary$status %in% c("ok", "ok_de_no_se"))) {
    s <- summary[i]
    pf <- file.path(OUT, s$dataset_dir, "processed", paste0(s$stem, "_provenance.tsv"))
    prov <- if (file.exists(pf)) { p <- fread(pf, sep = "\t", quote = ""); setNames(as.list(p$value), p$key) } else list()
    r <- tryCatch(compare_stem(s$dataset_dir, s$stem, prov), error = function(e) { message(s$stem, ": ", conditionMessage(e)); NULL })
    if (!is.null(r)) rows[[length(rows) + 1L]] <- r
  }
  cmp <- rbindlist(rows, fill = TRUE)
  # Rule B datasets: preparations that used to round and were re-run unrounded.
  RULE_B <- c("GSE235479", "E-MTAB-6929", "GSE229838", "GSE282067", "GSE205313")
  cmp[, rule_B := stem %in% RULE_B]
  if ("rule_max_abs_dlogFC" %in% names(cmp)) {
    # With a control, "rule effect" is measured: any change between the
    # environment-only control and the staged table.
    cmp[, rule_effect := !is.na(rule_max_abs_dlogFC) & (rule_max_abs_dlogFC > 1e-9 | rule_max_abs_dFDR > 1e-9 | !rule_same_gene_set)]
    cmp[is.na(rule_max_abs_dlogFC), rule_effect := (n_unmapped_in_fit > 0 | n_features_collapsed > 0 | committed_dup_symbols > 0) %in% TRUE]
  } else cmp[, rule_effect := (n_unmapped_in_fit > 0 | n_features_collapsed > 0 | committed_dup_symbols > 0) %in% TRUE]
  cmp[, rule_A := rule_effect & ((n_unmapped_in_fit > 0 | n_features_collapsed > 0 | committed_dup_symbols > 0) %in% TRUE)]
  cmp[, classification := fifelse(rule_A & rule_B, "ii+iii rule A and rule B",
                           fifelse(rule_B, "iii rule B (fractional)",
                           fifelse(rule_A, "ii rule A (duplicates/unmapped)",
                           fifelse(rule_effect, "ii rule A (symbol gate only)", "i environment only"))))]
  cmp[, flagged := fdr05_changed_fraction > 0.05 | sign_flips_fdr05_either > 0]
  fwrite(cmp, file.path(OUT, if (length(ONLY)) "COMPARISON_partial.tsv" else "COMPARISON.tsv"), sep = "\t", eol = "\n")
  cat(sprintf("compared %d tables: %s; flagged %d\n", nrow(cmp),
              paste(names(table(cmp$classification)), table(cmp$classification), sep = "=", collapse = "; "), sum(cmp$flagged)))
}

# ---- FGSEA over the staged DE tables, and its comparison ---------------------------
#
# --phase fgsea: scripts/run_mouse_fgsea.R --force with HYPO_OUT_ROOT=<out>, the
# staged DE tables split across --workers processes (each builds its own
# MSigDB projections, clearing the ortholog cache before every fetch).
# --phase fgsea-compare: FGSEA_COMPARISON.tsv, one row per table x collection.

FGSEA_DBS <- c("HALLMARK", "KEGG", "GO_BP", "REACTOME")

if (PHASE == "fgsea") {
  des <- list.files(OUT, pattern = "_DE\\.tsv$", recursive = TRUE, full.names = TRUE)
  des <- des[basename(dirname(des)) == "processed"]
  stems <- sub("_DE\\.tsv$", "", basename(des))
  if (length(ONLY)) stems <- stems[stems %in% ONLY]
  groups <- split(stems, rep_len(seq_len(WORKERS), length(stems)))
  run_fgsea_group <- function(ids, OUT, REPO, RSCRIPT, k) {
    # C collation: the provenance membership hashes sort pathway and gene
    # names, and the committed FGSEA provenance was computed under C collation
    # (a user-locale run yields the same gene sets but different hashes).
    Sys.setenv(HYPO_OUT_ROOT = OUT, LC_COLLATE = "C"); setwd(REPO)
    log <- file.path(OUT, "_logs", sprintf("fgsea_%02d", k))
    system2(RSCRIPT, c(shQuote(file.path(REPO, "scripts/regen-r460/run_fgsea_r460.R")), shQuote(ids), "--force"),
            stdout = paste0(log, ".out"), stderr = paste0(log, ".err"))
  }
  cl <- makePSOCKcluster(length(groups)); on.exit(stopCluster(cl), add = TRUE)
  t0 <- Sys.time()
  codes <- clusterMap(cl, run_fgsea_group, groups, k = seq_along(groups),
                      MoreArgs = list(OUT = OUT, REPO = REPO, RSCRIPT = RSCRIPT), .scheduling = "dynamic")
  cat(sprintf("fgsea finished in %.1f min; exit codes %s\n", as.numeric(difftime(Sys.time(), t0, units = "mins")),
              paste(unlist(codes), collapse = ",")))
}

if (PHASE == "fgsea-compare") {
  prov_of <- function(path) if (!is.na(path) && file.exists(path)) { p <- fread(path, colClasses = "character"); setNames(p$value, p$key) } else character()
  sm <- fread(file.path(OUT, "RUN_SUMMARY.tsv"))[status == "ok"]
  rows <- list()
  for (i in seq_len(nrow(sm))) {
    s <- sm[i]; proc <- file.path(OUT, s$dataset_dir, "processed")
    po <- prov_of(committed_path(s$dataset_dir, paste0(s$stem, "_FGSEA_provenance.tsv")))
    pn <- prov_of(file.path(proc, paste0(s$stem, "_FGSEA_provenance.tsv")))
    cde <- committed_path(s$dataset_dir, paste0(s$stem, "_DE.tsv"))
    committed_fgsea_matches_committed_de <- if (length(po) && !is.na(cde)) unname(po["de_sha256"] == sha256_file(cde)) else NA
    # How much did the ranking itself change? Spearman of DE stat on shared public symbols.
    rank_cor <- NA_real_; rank_n_old <- NA_integer_; rank_n_new <- NA_integer_
    if (!is.na(cde)) {
      a <- read_de_keyed(cde, TRUE)$d; b <- read_de_keyed(file.path(proc, paste0(s$stem, "_DE.tsv")), FALSE)$d
      m <- merge(a[, .(key, s_a = stat)], b[, .(key, s_b = stat)], by = "key")
      rank_cor <- suppressWarnings(cor(m$s_a, m$s_b, method = "spearman")); rank_n_old <- nrow(a); rank_n_new <- nrow(b)
    }
    for (db in FGSEA_DBS) {
      fo <- committed_path(s$dataset_dir, sprintf("%s_FGSEA_%s.tsv", s$stem, db))
      fn <- file.path(proc, sprintf("%s_FGSEA_%s.tsv", s$stem, db))
      if (is.na(fo) || !file.exists(fn)) {
        rows[[length(rows) + 1L]] <- data.table(dataset_dir = s$dataset_dir, stem = s$stem, collection = db,
          status = if (!file.exists(fn)) "no_staged_fgsea" else "no_committed_fgsea")
        next
      }
      o <- fread(fo); n <- fread(fn)
      m <- merge(o[, .(pathway, nes_o = NES, padj_o = padj)], n[, .(pathway, nes_n = NES, padj_n = padj)], by = "pathway")
      so <- (m$padj_o < 0.05) %in% TRUE; sn <- (m$padj_n < 0.05) %in% TRUE
      key <- tolower(db)
      same_membership <- length(po) && length(pn) && identical(unname(po[paste0(key, "_membership_sha256")]), unname(pn[paste0(key, "_membership_sha256")]))
      same_versions <- length(po) && length(pn) && all(po[c("fgsea_version", "msigdbr_version", "msigdb_db_version", "r_version")] ==
                                                        pn[c("fgsea_version", "msigdbr_version", "msigdb_db_version", "r_version")])
      d <- abs(m$nes_n - m$nes_o)
      rows[[length(rows) + 1L]] <- data.table(dataset_dir = s$dataset_dir, stem = s$stem, collection = db, status = "compared",
        n_sets_committed = nrow(o), n_sets_staging = nrow(n), n_shared = nrow(m),
        padj05_committed = sum(o$padj < 0.05, na.rm = TRUE), padj05_staging = sum(n$padj < 0.05, na.rm = TRUE),
        sig_gained = sum(!so & sn) + sum(n$padj < 0.05 & !(n$pathway %in% o$pathway), na.rm = TRUE),
        sig_lost = sum(so & !sn) + sum(o$padj < 0.05 & !(o$pathway %in% n$pathway), na.rm = TRUE),
        max_abs_dNES = if (nrow(m)) max(d, na.rm = TRUE) else NA_real_, median_abs_dNES = if (nrow(m)) median(d, na.rm = TRUE) else NA_real_,
        sig_nes_sign_flips = sum((so | sn) & sign(m$nes_o) != sign(m$nes_n), na.rm = TRUE),
        same_msigdb_membership = same_membership, same_fgsea_msigdb_r_versions = same_versions,
        de_rank_spearman = rank_cor, de_genes_committed = rank_n_old, de_genes_staging = rank_n_new,
        committed_fgsea_matches_committed_de = committed_fgsea_matches_committed_de,
        rank_gene_count_committed = suppressWarnings(as.integer(po["rank_gene_count"])),
        rank_gene_count_staging = suppressWarnings(as.integer(pn["rank_gene_count"])))
    }
  }
  fc <- rbindlist(rows, fill = TRUE)
  # DE identity from COMPARISON.tsv: same public gene set and every stat equal.
  cmp <- fread(file.path(OUT, "COMPARISON.tsv"))[, .(stem, de_identical = max_abs_dstat < 1e-9 & n_committed_symbols == n_staging & n_shared == n_staging,
                                                    de_max_abs_dstat = max_abs_dstat)]
  fc <- merge(fc, cmp, by = "stem", all.x = TRUE, sort = FALSE)
  # The ranked list is identical only if the DE statistics AND the ranked row
  # set agree: committed tables also ranked unpublished raw-id rows.
  fc[, de_identical := de_identical %in% TRUE & (rank_gene_count_committed == rank_gene_count_staging) %in% TRUE]
  fc[status == "compared", attribution := fifelse(!same_msigdb_membership | !same_fgsea_msigdb_r_versions,
      fifelse(de_identical %in% TRUE, "gene sets / versions only", "DE change + gene sets / versions"),
      fifelse(de_identical %in% TRUE, fifelse(max_abs_dNES < 1e-9 & sig_gained == 0 & sig_lost == 0, "identical", fifelse(max_abs_dNES < 1e-3 & sig_gained == 0 & sig_lost == 0, "identical within float noise (DE last-digit)", "same DE, different result (UNEXPECTED)")),
              "DE change"))]
  fwrite(fc, file.path(OUT, "FGSEA_COMPARISON.tsv"), sep = "\t", eol = "\n")
  cat(sprintf("FGSEA comparison: %d rows; %s\n", nrow(fc), paste(names(table(fc$attribution, useNA = "ifany")), table(fc$attribution, useNA = "ifany"), sep = "=", collapse = "; ")))
}
