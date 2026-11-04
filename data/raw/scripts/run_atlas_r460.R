## ============================================================
## run_atlas_r460.R
## Self-contained regeneration of the macaque snRNA atlas analysis
## (Lei et al. 2024 Cell Metab, CNP0003785; obese vs normal re-analysis).
##
## Replaces the "source run_all_clusters.R after loading six Seurat objects
## into .GlobalEnv" workflow with a single command that
##   1. reads HCA_Macaque001_S001..S006.rds one at a time (SeuratObject +
##      Matrix only; Seurat itself is not needed),
##   2. builds and SAVES per-population, per-animal pseudobulk counts
##      (gzipped TSV) plus population x sample cell counts,
##   3. runs the run_all_clusters.R DE recipe (MIN_CELLS=15 per animal,
##      filterByExpr(group) + keep.lib.sizes=FALSE, TMM, edgeR QL,
##      coef grpObese) and FGSEA (signed QL F ranks, 1e-7 tie jitter,
##      MSigDB H / C2 CP:KEGG_LEGACY / C5 GO:BP / C2 CP:REACTOME ortholog-
##      mapped to Macaca mulatta, size 15-500) with the same output file
##      names and columns,
##   4. writes sessionInfo + key/value provenance per population and per run.
##
## Differences from run_all_clusters.R (profile "current", the default):
##   * FGSEA RNG: tie seed 42 once, then set.seed(42) again before EACH
##     collection (the original seeded once, so KEGG/GO_BP/Reactome
##     permutations depended on the collections run before them).
##   * msigdbr >= 26 caches the ortholog map per target species from the
##     first collection fetched and silently truncates later C2/C5 mappings.
##     The cache is cleared before every collection fetch.
##   * Duplicate feature symbols would be summed before DE (asserted absent:
##     Seurat features are unique).
##   * Extra outputs: de/rawcpm.csv (CPM on filtered library sizes WITHOUT
##     TMM factors), qc/library_sizes.csv, de/DE_provenance.tsv,
##     fgsea/FGSEA_provenance.tsv (schema 3, as scripts/run_mouse_fgsea.R),
##     sessionInfo.txt.
## Profile "legacy" reproduces the original single-seed RNG stream and the
## original msigdbr call (category=, no cache clearing); use it only to
## validate against the committed tables under the original R 4.4.1 stack.
##
## Usage (from any directory):
##   Rscript data/raw/scripts/run_atlas_r460.R [options]
## Options (env var in brackets):
##   --input-dir=DIR     directory holding HCA_Macaque001_S00[1-6].rds
##                       [ATLAS_INPUT_DIR; default atlas-input]
##   --out-root=DIR      staging root [ATLAS_OUT_ROOT; default regen-r460/macaque]
##   --pseudobulk-dir=DIR  where pseudobulk is written/read [default <out-root>/pseudobulk]
##   --stage=all|pseudobulk|analyze   (default all)
##   --only=id1,id2      restrict analysis to population ids (e.g. e9,Ast1)
##   --workers=N         parallel PSOCK workers for the analysis stage (default 1)
##   --profile=current|legacy          (default current)
##   --loo               also write de/LOO_sensitivity_top20.csv
##   --qa-pdf            also write _global/qa_compiled/<pop>.pdf (needs pheatmap, gridExtra)
## ============================================================

suppressPackageStartupMessages({
  library(Matrix); library(edgeR); library(limma); library(statmod)
  library(fgsea); library(msigdbr); library(dplyr); library(BiocParallel)
})
BiocParallel::register(BiocParallel::SerialParam())

# -------- 0) Arguments --------
.args <- commandArgs(trailingOnly = TRUE)
argVal <- function(name, env = NULL, default = NULL) {
  hit <- grep(paste0("^--", name, "="), .args, value = TRUE)
  if (length(hit)) return(sub(paste0("^--", name, "="), "", hit[[length(hit)]]))
  if (!is.null(env) && nzchar(Sys.getenv(env))) return(Sys.getenv(env))
  default
}
argFlag <- function(name) paste0("--", name) %in% .args

INPUT_DIR  <- argVal("input-dir", "ATLAS_INPUT_DIR", "atlas-input")
OUT_ROOT   <- argVal("out-root", "ATLAS_OUT_ROOT", "regen-r460/macaque")
PB_DIR     <- argVal("pseudobulk-dir", NULL, file.path(OUT_ROOT, "pseudobulk"))
STAGE      <- argVal("stage", NULL, "all")
ONLY       <- argVal("only", "ONLY_CLUSTERS", "")
WORKERS    <- as.integer(argVal("workers", NULL, "1"))
PROFILE    <- argVal("profile", NULL, "current")
DO_LOO     <- argFlag("loo")
DO_QA_PDF  <- argFlag("qa-pdf")
stopifnot(STAGE %in% c("all", "pseudobulk", "analyze"),
          PROFILE %in% c("current", "legacy"), WORKERS >= 1)

scriptArg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
GENERATOR_PATH <- normalizePath(if (length(scriptArg)) sub("^--file=", "", scriptArg[[1L]])
                                else "data/raw/scripts/run_atlas_r460.R", mustWork = TRUE)
GENERATOR_REL  <- "data/raw/scripts/run_atlas_r460.R"

# -------- 1) Fixed configuration (identical to run_all_clusters.R) --------
SAMPLES        <- sprintf("HCA_Macaque001_S%03d", 1:6)
celltype_col   <- "celltype_level3_abbr"
MIN_CELLS      <- 15
LEI_LFC_THRESH <- log2(1.5)
TOP_N_LOO      <- 20
MSIGDB_SPECIES <- "Macaca mulatta"
MSIGDB_AUTHORITY <- "HS"
FGSEA_MIN      <- 15L
FGSEA_MAX      <- 500L
TIE_SEED       <- 42L
FGSEA_SEED     <- 42L
TIE_EPS        <- 1e-7

cond_map <- c(
  HCA_Macaque001_S001 = "Normal", HCA_Macaque001_S002 = "Normal",
  HCA_Macaque001_S003 = "Normal", HCA_Macaque001_S004 = "Obese",
  HCA_Macaque001_S005 = "Obese",  HCA_Macaque001_S006 = "Obese")

subcluster_map <- c(
  "i0"="MEIS2/ONECUT1","i3"="DLX1","i4"="DLX1/B3GALNT2","i13"="RELN/EFNA5",
  "i14"="CCK/ST18","i15"="MEIS2/ESRRG","i17"="NR2F1/SLC7A3","i18"="NTS/ADCYAP1R1",
  "i19"="TAC1/FBN2","i20"="SST/CALCR","i23"="AGRP/MCTP2","i24"="CALCB/CRISPLD2",
  "i25"="LHX1/GRAMD2B","i26"="GALP/HTR2C","i32"="GAL/TAC1","i40"="GHRH/PIK3R1",
  "i42"="SST/NPY","i43"="KALRN/PTK2B","i45"="KIT/OTX2",
  "e1"="CBLN1/PDE1C","e2"="LEPR/KCNB2","e5"="GPC5/HTATSF1","e6"="NKAIN3/TSPAN6",
  "e7"="HTATSF1/PRLR","e8"="IQGAP2/PRDM13","e9"="POMC/TBX3","e10"="HMX3/SYNPR",
  "e11"="GPR50","e12"="CRH/RNPC3","e16"="PENK/OXT","e21"="CBLN2/ISLR2",
  "e22"="ESR1/TMEM114","e27"="CRHBP/ARPP21","e28"="HCRT/NPVF","e29"="CALB2/PSTPIP1",
  "e31"="IRX3/ANOS1","e33"="KISS1/ESR1","e34"="LHX1/COCH","e35"="EGR3/ETV3",
  "e36"="CARTPT/GHR","e37"="PMCH/DCN","e38"="NPY/ITGA8","e39"="AVP/CAPRIN2",
  "e41"="ADCYAP1/BDNF","e47"="HCRT/PDYN",
  "h44"="HDC","h46"="HDC/HPCAL1",
  "o30"="OXT/PTGFR")

nonneuronal_map <- list(
  list(meta="ast-1", id="Ast1", label="Astrocyte 1"),
  list(meta="ast-2", id="Ast2", label="Astrocyte 2"),
  list(meta="oligo-1", id="Oligo1", label="Oligodendrocyte 1"),
  list(meta="oligo-2", id="Oligo2", label="Oligodendrocyte 2"),
  list(meta="opc", id="OPC", label="OPC"),
  list(meta="cop", id="COP", label="COP"),
  list(meta="micro-1", id="Micro1", label="Microglia 1"),
  list(meta="micro-2", id="Micro2", label="Microglia 2"),
  list(meta="endothelial", id="Endo", label="Endothelial"),
  list(meta="ependy-1", id="Ependy1", label="Ependymal 1"),
  list(meta="ependy-2", id="Ependy2", label="Ependymal 2"),
  list(meta="fibro-1", id="Fibro1", label="Fibroblast 1"),
  list(meta="fibro-2", id="Fibro2", label="Fibroblast 2"),
  list(meta="tany_a", id="TanyA", label="Tanycyte A"),
  list(meta="tany_b", id="TanyB", label="Tanycyte B"))

safe_fs <- function(s) gsub("[^A-Za-z0-9._-]+", "_", s)
code_of <- function(lbl) {
  m <- regmatches(lbl, regexpr("^[a-z]+[0-9]+", lbl))
  if (length(m) == 0) NA_character_ else m
}

# -------- 2) Small utilities --------
sha256File <- function(path) {
  con <- file(path, "rb"); on.exit(close(con))
  unclass(as.character(openssl::sha256(con)))
}
# Every text output is written with LF line endings on any OS (the repo stores
# these files with eol=lf), so recorded SHA-256s are of the exact committed bytes.
writeCsvLF <- function(x, path, ...) {
  con <- file(path, open = "wb"); on.exit(close(con))
  write.csv(x, con, ...)
}
writeLinesLF <- function(lines, path) {
  con <- file(path, open = "wb"); on.exit(close(con))
  writeLines(lines, con, sep = "\n")
}
fwriteLF <- function(x, file, ...) data.table::fwrite(x, file, eol = "\n", ...)
sha256Lines <- function(lines) {
  unclass(as.character(openssl::sha256(charToRaw(paste(lines, collapse = "\n")))))
}
writeKV <- function(values, path) {
  stopifnot(!anyDuplicated(names(values)), !anyNA(values), all(nzchar(values)))
  # data.table(key = ...) would be read as setkey(); name the column afterwards.
  kv <- data.frame(k = names(values), value = unname(values), stringsAsFactors = FALSE)
  names(kv)[1] <- "key"
  fwriteLF(kv, path, sep = "\t")
}
writeSessionInfo <- function(path, extra = character()) {
  writeLinesLF(c(extra, "", capture.output(print(sessionInfo()))), path)
}
pkgv <- function(p) as.character(packageVersion(p))

# Registry discovery must match run_all_clusters.R: curated neuronal codes first
# (in subcluster_map order), then any extra discovered codes, then the
# non-neuronal labels present in the data.
buildRegistry <- function(discovered) {
  discovered_codes <- unique(na.omit(vapply(discovered, code_of, character(1))))
  neuronal_ids <- c(intersect(names(subcluster_map), discovered_codes),
                    setdiff(discovered_codes, names(subcluster_map)))
  rows <- lapply(neuronal_ids, function(code) data.frame(
    id = code, label = if (code %in% names(subcluster_map)) subcluster_map[[code]] else code,
    pattern = paste0("^", code, "([:_]|$)"), class = "neuronal", stringsAsFactors = FALSE))
  for (nn in nonneuronal_map) if (nn$meta %in% discovered) rows[[length(rows) + 1]] <-
    data.frame(id = nn$id, label = nn$label, pattern = paste0("^", nn$meta, "$"),
               class = "non-neuronal", stringsAsFactors = FALSE)
  reg <- do.call(rbind, rows)
  reg$dir <- paste0(reg$id, "__", safe_fs(reg$label))
  reg
}

# ============================================================
# STAGE 1: pseudobulk
# ============================================================
runPseudobulk <- function() {
  suppressPackageStartupMessages(library(SeuratObject))
  dir.create(PB_DIR, recursive = TRUE, showWarnings = FALSE)
  paths <- file.path(INPUT_DIR, paste0(SAMPLES, ".rds"))
  if (!all(file.exists(paths))) stop("missing input RDS: ", paste(paths[!file.exists(paths)], collapse = ", "))

  cat("Hashing inputs...\n")
  input_sha <- vapply(paths, sha256File, character(1))

  per_sample <- list()   # sample -> list(labels=chr, sums=list(id->named numeric), features=chr)
  label_counts <- list()
  discovered_all <- character()
  first_pass_labels <- list()
  # Pass 1 would need every object twice; instead read each object once and
  # pseudobulk by EVERY lowercased label, then assemble populations by pattern.
  for (s in SAMPLES) {
    t0 <- Sys.time()
    x <- readRDS(file.path(INPUT_DIR, paste0(s, ".rds")))
    if (!celltype_col %in% colnames(x@meta.data)) stop("column ", celltype_col, " missing in ", s)
    m <- SeuratObject::LayerData(x[["RNA"]], layer = "counts")
    lab_raw <- trimws(as.character(x@meta.data[[celltype_col]]))
    stopifnot(identical(rownames(x@meta.data), colnames(m)))
    rm(x); invisible(gc())
    if (is.null(m) || Matrix::nnzero(m) == 0) stop(s, ": empty counts layer")
    if (!is.numeric(m@x) || any(m@x != round(m@x))) stop(s, ": counts layer is not integer UMI counts")
    if (anyDuplicated(rownames(m))) {
      # uniform rule: sum counts per final gene symbol before DE
      cat("  ", s, ": summing ", sum(duplicated(rownames(m))), " duplicate feature symbols\n", sep = "")
      m <- as(Matrix::fac2sparse(factor(rownames(m), levels = unique(rownames(m)))) %*% m, "CsparseMatrix")
    }
    lab <- tolower(lab_raw)
    ok <- !is.na(lab) & nzchar(lab)
    ulab <- sort(unique(lab[ok]))
    # label x cell indicator -> gene x label sums in one sparse product
    ind <- Matrix::sparseMatrix(i = seq_along(lab)[ok], j = match(lab[ok], ulab), x = 1,
                                dims = c(length(lab), length(ulab)), dimnames = list(NULL, ulab))
    sums <- as.matrix(m %*% ind)
    per_sample[[s]] <- list(features = rownames(m), sums = sums,
                            ncells = setNames(as.integer(Matrix::colSums(ind)), ulab),
                            n_cells_total = ncol(m), n_cells_labelled = sum(ok))
    label_counts[[s]] <- table(lab_raw[ok])
    discovered_all <- union(discovered_all, ulab)
    rm(m, ind, sums); invisible(gc())
    cat(sprintf("  %s: %d features x %d cells, %d labels (%.0fs)\n", s,
                length(per_sample[[s]]$features), per_sample[[s]]$n_cells_total,
                length(ulab), as.numeric(difftime(Sys.time(), t0, units = "secs"))))
  }

  # discovery order matters only for the "extra codes" branch; mirror the
  # original (unique over objects in sample order, labels in cell order is not
  # recoverable here, but extra codes are reported and none are expected).
  reg <- buildRegistry(discovered_all)
  extra <- setdiff(reg$id[reg$class == "neuronal"], names(subcluster_map))
  if (length(extra)) warning("uncurated neuronal codes discovered: ", paste(extra, collapse = ", "))

  # gene universe in S001 order, then any genes first seen later
  genes <- Reduce(function(a, b) c(a, setdiff(b, a)), lapply(per_sample, `[[`, "features"))
  feat_identical <- all(vapply(per_sample, function(p) identical(p$features, per_sample[[1]]$features), logical(1)))

  cc <- matrix(0L, nrow(reg), length(SAMPLES), dimnames = list(reg$id, SAMPLES))
  pb_sha <- character()
  for (k in seq_len(nrow(reg))) {
    pat <- reg$pattern[k]
    out <- matrix(NA_real_, length(genes), length(SAMPLES), dimnames = list(genes, SAMPLES))
    for (s in SAMPLES) {
      p <- per_sample[[s]]
      hit <- colnames(p$sums)[grepl(pat, colnames(p$sums))]
      cc[k, s] <- sum(p$ncells[hit])
      v <- if (length(hit)) rowSums(p$sums[, hit, drop = FALSE]) else setNames(numeric(length(p$features)), p$features)
      out[p$features, s] <- v
    }
    stopifnot(all(is.na(out) | out == round(out)))
    df <- data.frame(gene = genes, out, check.names = FALSE)
    f <- file.path(PB_DIR, paste0(reg$dir[k], ".counts.tsv.gz"))
    fwriteLF(df, f, sep = "\t", na = "NA", compress = "gzip")
    pb_sha[reg$id[k]] <- sha256File(f)
  }

  regOut <- cbind(reg, as.data.frame(cc, check.names = FALSE),
                  n_samples_ge_min_cells = rowSums(cc >= MIN_CELLS),
                  pseudobulk_file = paste0(reg$dir, ".counts.tsv.gz"),
                  pseudobulk_sha256 = unname(pb_sha[reg$id]))
  fwriteLF(regOut, file.path(PB_DIR, "population_cell_counts.tsv"), sep = "\t")

  # raw-label x sample cell counts (comparable to composition/cell_counts_*_wide.csv)
  allLabs <- sort(unique(unlist(lapply(label_counts, names))))
  lc <- sapply(SAMPLES, function(s) { v <- label_counts[[s]][allLabs]; v[is.na(v)] <- 0L; as.integer(v) })
  fwriteLF(data.frame(cluster = allLabs, lc, check.names = FALSE),
                     file.path(PB_DIR, "cell_counts_by_label.tsv"), sep = "\t")

  feat <- data.frame(sample = SAMPLES,
                     n_features = vapply(per_sample, function(p) length(p$features), 1L),
                     features_sha256 = vapply(per_sample, function(p) sha256Lines(p$features), ""),
                     n_cells_total = vapply(per_sample, `[[`, 1L, "n_cells_total"),
                     n_cells_labelled = vapply(per_sample, `[[`, 1L, "n_cells_labelled"),
                     input_file = basename(paths), input_bytes = file.size(paths),
                     input_sha256 = unname(input_sha))
  fwriteLF(feat, file.path(PB_DIR, "samples.tsv"), sep = "\t")

  writeKV(c(
    generator = GENERATOR_REL, generator_sha256 = sha256File(GENERATOR_PATH),
    r_version = R.version.string, seuratobject_version = pkgv("SeuratObject"),
    matrix_version = pkgv("Matrix"), data_table_version = pkgv("data.table"),
    input_dir = normalizePath(INPUT_DIR, winslash = "/"),
    celltype_column = celltype_col, assay = "RNA", layer = "counts",
    aggregation = "sum of integer UMI counts over all cells of a population per animal (all cells kept here; MIN_CELLS applied at DE time)",
    label_normalisation = "tolower(trimws(label)); neuronal ^code([:_]|$), non-neuronal exact label",
    duplicate_symbol_rule = "sum counts per feature symbol (none present)",
    features_identical_across_samples = as.character(feat_identical),
    gene_universe_rows = as.character(length(genes)),
    n_populations = as.character(nrow(reg)),
    written_utc = format(Sys.time(), tz = "UTC", usetz = TRUE)),
    file.path(PB_DIR, "PSEUDOBULK_provenance.tsv"))
  writeSessionInfo(file.path(PB_DIR, "sessionInfo.txt"), "stage: pseudobulk")
  cat("Pseudobulk written to ", PB_DIR, " (", nrow(reg), " populations)\n", sep = "")
}

# ============================================================
# STAGE 2: DE + FGSEA
# ============================================================
clearOrthologCache <- function(species) {
  ns <- asNamespace("msigdbr")
  if (!exists("pkg_env", envir = ns, inherits = FALSE)) return(invisible(NULL))
  speciesId <- babelgene::species(species)$taxon_id
  if (length(speciesId) != 1L || is.na(speciesId)) stop("could not resolve target-species taxonomy id")
  cache <- get("pkg_env", envir = ns, inherits = FALSE)
  key <- paste0("orthologs", speciesId)
  if (exists(key, envir = cache, inherits = FALSE)) rm(list = key, envir = cache)
  invisible(NULL)
}

buildGeneSets <- function() {
  spec <- list(Hallmark = list("H", NULL), KEGG = list("C2", "CP:KEGG_LEGACY"),
               GO_BP = list("C5", "GO:BP"), Reactome = list("C2", "CP:REACTOME"))
  out <- list(); dbv <- character()
  for (nm in names(spec)) {
    cat_ <- spec[[nm]][[1]]; sub <- spec[[nm]][[2]]
    tb <- if (PROFILE == "legacy") {
      if (is.null(sub)) msigdbr(species = MSIGDB_SPECIES, category = cat_)
      else msigdbr(species = MSIGDB_SPECIES, category = cat_, subcollection = sub)
    } else {
      clearOrthologCache(MSIGDB_SPECIES)
      msigdbr(db_species = MSIGDB_AUTHORITY, species = MSIGDB_SPECIES,
              collection = cat_, subcollection = sub)
    }
    if (!nrow(tb)) stop("empty gene-set table for ", nm)
    gs <- split(tb$gene_symbol, tb$gs_name)
    attr(gs, "source_collection") <- cat_
    attr(gs, "source_subcollection") <- if (is.null(sub)) "(all)" else sub
    out[[nm]] <- gs
    dbv <- union(dbv, unique(tb$db_version))
  }
  if (length(dbv) != 1L) stop("MSigDB gene sets did not resolve to one db_version: ", paste(dbv, collapse = ","))
  attr(out, "db_version") <- dbv
  out
}

membershipSha256 <- function(pathways) {
  nms <- sort(names(pathways))
  sha256Lines(vapply(nms, function(p) paste(p, paste(sort(unique(pathways[[p]])), collapse = ";"), sep = "\t"), ""))
}

readPseudobulk <- function(dirName) {
  df <- data.table::fread(file.path(PB_DIR, paste0(dirName, ".counts.tsv.gz")),
                          sep = "\t", na.strings = "NA", data.table = FALSE)
  m <- as.matrix(df[, SAMPLES]); rownames(m) <- df$gene
  m
}

## ---- QA PDF (verbatim port of run_all_clusters.R::make_qa_pdf) ----
make_qa_pdf <- function(code, display, paths, gsz, y, fit, res, deg, logcpm_qc, grp, loo_summary, qa_dir) {
  out_pdf <- file.path(qa_dir, paste0(code, "__", safe_fs(paths$label), ".pdf"))
  pdf(out_pdf, width = 8.5, height = 11, onefile = TRUE)
  on.exit(if (length(dev.list())) dev.off(), add = TRUE)
  title_grob <- function(txt, size = 14) grid::textGrob(txt, gp = grid::gpar(fontsize = size, fontface = "bold"))
  tbl_theme <- gridExtra::ttheme_default(core = list(fg_params = list(fontsize = 8)),
                                         colhead = list(fg_params = list(fontsize = 9, fontface = "bold")))
  pad_lim <- function(v, frac) { rng <- range(v, na.rm = TRUE); span <- diff(rng)
    if (!is.finite(span) || span == 0) span <- 1; c(rng[1] - span * frac, rng[2] + span * frac) }
  mds_cols <- c("Normal" = "#4C78A8", "Obese" = "#E45756")
  cover_tbl <- data.frame(Metric = c("Cluster code", "Cluster label", "n Normal", "n Obese", "Is 3v3?", "MIN_CELLS", "Samples kept"),
    Value = c(code, paths$label, as.character(gsz$n_normal), as.character(gsz$n_obese), as.character(gsz$is_3v3),
              as.character(gsz$min_cells), gsz$samples_kept), stringsAsFactors = FALSE)
  gridExtra::grid.arrange(title_grob(paste0("QA Report - ", display), size = 20),
    gridExtra::tableGrob(cover_tbl, rows = NULL, theme = gridExtra::ttheme_default(base_size = 10)), nrow = 2, heights = c(1, 5))
  mds_obj <- limma::plotMDS(y, plot = FALSE)
  ve <- tryCatch(mds_obj$var.explained, error = function(e) NULL)
  xl <- if (!is.null(ve) && length(ve) >= 2) paste0("Leading logFC dim 1 (", round(ve[1] * 100), "%)") else "Leading logFC dim 1"
  yl <- if (!is.null(ve) && length(ve) >= 2) paste0("Leading logFC dim 2 (", round(ve[2] * 100), "%)") else "Leading logFC dim 2"
  par(mar = c(5, 5, 4, 3))
  plot(mds_obj$x, mds_obj$y, type = "n", xlim = pad_lim(mds_obj$x, 0.40), ylim = pad_lim(mds_obj$y, 0.30),
       xlab = xl, ylab = yl, main = paste("MDS:", display), cex.main = 0.95, cex.lab = 0.85, cex.axis = 0.75)
  text(mds_obj$x, mds_obj$y, labels = colnames(y), col = mds_cols[as.character(grp)], cex = 0.7)
  if (!is.null(logcpm_qc) && ncol(logcpm_qc) >= 2) tryCatch(
    pheatmap::pheatmap(cor(logcpm_qc), display_numbers = TRUE, number_format = "%.3f",
                       main = paste("Sample correlation (log-CPM):", display)),
    error = function(e) { grid::grid.newpage(); grid::grid.text(paste0("Sample correlation failed: ", conditionMessage(e))) })
  par(mfrow = c(2, 1), mar = c(4, 4, 3, 2))
  edgeR::plotBCV(y, main = paste("BCV:", display)); edgeR::plotQLDisp(fit, main = paste("QL dispersion:", display))
  par(mfrow = c(2, 1), mar = c(4, 4, 3, 2))
  hist(res$table$PValue, breaks = 50, xlab = "raw p-value", main = paste("p-value dist:", display))
  plot(deg$logFC, -log10(deg$FDR), pch = 16, cex = 0.5, xlab = "log2FC (Obese vs Normal)", ylab = "-log10(FDR)",
       main = paste("Volcano:", display))
  abline(v = c(-0.25, 0.25), lty = 2); abline(h = -log10(0.05), lty = 2); par(mfrow = c(1, 1))
  top20 <- head(deg, 20)
  if (nrow(top20) > 0) gridExtra::grid.arrange(title_grob("Top 20 DEGs (by FDR)"),
    gridExtra::tableGrob(data.frame(gene = top20$gene, logFC = signif(top20$logFC, 3), logCPM = signif(top20$logCPM, 3),
      `F` = signif(top20$`F`, 3), PValue = signif(top20$PValue, 3), FDR = signif(top20$FDR, 3), check.names = FALSE),
      rows = NULL, theme = tbl_theme), nrow = 2, heights = c(0.4, 7))
  if (!is.null(loo_summary) && nrow(loo_summary) > 0) gridExtra::grid.arrange(
    title_grob(paste0("LOO sensitivity (top ", nrow(loo_summary), " DEGs)")),
    gridExtra::tableGrob(transform(loo_summary, orig_logFC = signif(orig_logFC, 3), orig_FDR = signif(orig_FDR, 3),
      loo_frac_preserved = signif(loo_frac_preserved, 3)), rows = NULL, theme = tbl_theme), nrow = 2, heights = c(0.4, 7))
  invisible(out_pdf)
}

## ---- One population ----
run_one <- function(k, reg, GS, ctx) {
  on.exit(graphics.off(), add = TRUE)
  code <- reg$id[k]; lbl <- reg$label[k]
  display <- if (lbl != code) paste0(code, " (", lbl, ")") else code
  base <- file.path(ctx$results_root, reg$dir[k])
  paths <- list(base = base, de = file.path(base, "de"), fgsea = file.path(base, "fgsea"),
                qc = file.path(base, "qc"), label = lbl)
  for (d in c(paths$de, paths$fgsea, paths$qc)) dir.create(d, recursive = TRUE, showWarnings = FALSE)
  writeSessionInfo(file.path(base, "sessionInfo.txt"),
                   c(paste("population:", display), paste("profile:", ctx$profile),
                     paste("generator:", GENERATOR_REL, ctx$generator_sha256)))

  full <- readPseudobulk(reg$dir[k])
  ncells <- unlist(reg[k, SAMPLES])
  kept <- SAMPLES[ncells >= MIN_CELLS]
  if (length(kept) < 2) stop("Fewer than 2 samples passed MIN_CELLS=", MIN_CELLS, " for cluster ", code)
  sub <- full[, kept, drop = FALSE]
  mat <- sub[stats::complete.cases(sub), , drop = FALSE]   # == Reduce(intersect) over kept samples
  if (!nrow(mat)) stop("No shared genes across samples for cluster ", code)

  grp <- factor(unname(cond_map[colnames(mat)]), levels = c("Normal", "Obese"))
  if (length(unique(grp)) < 2) stop("Only one group represented after MIN_CELLS filter for cluster ", code,
                                    " (", paste(levels(grp)[table(grp) > 0], collapse = ","), ")")
  nN <- sum(grp == "Normal"); nO <- sum(grp == "Obese"); is_3v3 <- (nN == 3 && nO == 3)
  gsz <- data.frame(cluster = code, cluster_label = lbl, min_cells = MIN_CELLS, n_normal = nN, n_obese = nO,
                    is_3v3 = is_3v3, samples_kept = paste(colnames(mat), collapse = ";"), stringsAsFactors = FALSE)
  writeCsvLF(gsz, file.path(paths$qc, "group_sizes.csv"), row.names = FALSE)

  # ---- edgeR QL (identical recipe) ----
  y <- DGEList(counts = mat)
  lib_prefilter <- y$samples$lib.size
  keepg <- filterByExpr(y, group = grp)
  y <- y[keepg, , keep.lib.sizes = FALSE]
  y <- calcNormFactors(y, method = "TMM")
  logcpm_qc <- edgeR::cpm(y, log = TRUE, prior.count = 1)
  design <- model.matrix(~ grp)
  y <- estimateDisp(y, design)
  fit <- glmQLFit(y, design)
  res <- glmQLFTest(fit, coef = "grpObese")
  deg <- topTags(res, n = Inf)$table
  deg$gene <- rownames(deg)
  deg <- deg[order(deg$FDR), ]
  deg_sig_our <- subset(deg, FDR <= 0.05 & abs(logFC) >= 0.25)
  deg_sig_lei <- subset(deg, FDR <= 0.05 & abs(logFC) >= LEI_LFC_THRESH)
  de_path <- file.path(paths$de, "DE_all.csv")
  writeCsvLF(deg, de_path, row.names = FALSE)
  writeCsvLF(deg_sig_our, file.path(paths$de, "DE_sig_ourThresh.csv"), row.names = FALSE)
  writeCsvLF(deg_sig_lei, file.path(paths$de, "DE_sig_LeiThresh.csv"), row.names = FALSE)
  norm_cpm <- edgeR::cpm(y, normalized.lib.sizes = TRUE)
  writeCsvLF(cbind(gene = rownames(norm_cpm), as.data.frame(norm_cpm, check.names = FALSE)),
            file.path(paths$de, "normcpm.csv"), row.names = FALSE)
  raw_cpm <- edgeR::cpm(y, normalized.lib.sizes = FALSE)
  writeCsvLF(cbind(gene = rownames(raw_cpm), as.data.frame(raw_cpm, check.names = FALSE)),
            file.path(paths$de, "rawcpm.csv"), row.names = FALSE)
  libs <- data.frame(sample = colnames(y), group = as.character(grp), n_cells = unname(ncells[colnames(y)]),
                     lib_size_all_shared_genes = lib_prefilter, lib_size_filtered = y$samples$lib.size,
                     norm_factor = y$samples$norm.factors,
                     effective_lib_size = y$samples$lib.size * y$samples$norm.factors)
  writeCsvLF(libs, file.path(paths$qc, "library_sizes.csv"), row.names = FALSE)

  # ---- optional LOO ----
  loo_summary <- NULL
  if (ctx$loo) {
    top_loo_genes <- head(deg$gene, TOP_N_LOO)
    loo_one <- function(drop_sample) {
      keep_cols <- setdiff(colnames(mat), drop_sample)
      if (length(keep_cols) < 3) return(NULL)
      grp_l <- factor(unname(cond_map[keep_cols]), levels = c("Normal", "Obese"))
      if (length(unique(grp_l)) < 2) return(NULL)
      y_l <- DGEList(counts = mat[, keep_cols, drop = FALSE])
      keepg_l <- filterByExpr(y_l, group = grp_l)
      if (sum(keepg_l) == 0) return(NULL)
      y_l <- y_l[keepg_l, , keep.lib.sizes = FALSE]
      y_l <- calcNormFactors(y_l, method = "TMM")
      design_l <- model.matrix(~ grp_l)
      y_l <- estimateDisp(y_l, design_l)
      fit_l <- glmQLFit(y_l, design_l)
      tbl_l <- topTags(glmQLFTest(fit_l, coef = "grp_lObese"), n = Inf)$table
      tbl_l$gene <- rownames(tbl_l); tbl_l
    }
    loo_tables <- setNames(lapply(colnames(mat), function(s) tryCatch(loo_one(s), error = function(e) NULL)), colnames(mat))
    loo_summary <- do.call(rbind, lapply(top_loo_genes, function(g) {
      orig_row <- deg[deg$gene == g, , drop = FALSE]
      fp <- vapply(loo_tables, function(tbl) { if (is.null(tbl)) return(NA); i <- match(g, tbl$gene)
        if (is.na(i)) return(FALSE); tbl$FDR[i] <= 0.05 }, logical(1))
      frac <- mean(fp, na.rm = TRUE)
      data.frame(gene = g, orig_FDR = orig_row$FDR[1], orig_logFC = orig_row$logFC[1],
                 orig_sig_0.05 = orig_row$FDR[1] <= 0.05, loo_n_fits = sum(!is.na(fp)),
                 loo_frac_preserved = frac, loo_fragile = !is.na(frac) & frac < 2/3, stringsAsFactors = FALSE)
    }))
    if (!is.null(loo_summary) && nrow(loo_summary) > 0)
      writeCsvLF(loo_summary, file.path(paths$de, paste0("LOO_sensitivity_top", TOP_N_LOO, ".csv")), row.names = FALSE)
  }
  n_fragile <- if (is.null(loo_summary)) NA_integer_ else sum(loo_summary$loo_fragile, na.rm = TRUE)

  # ---- FGSEA ----
  ranked <- deg %>% transmute(gene = gene, score = sign(logFC) * `F`) %>% arrange(desc(score))
  ranks <- setNames(ranked$score, ranked$gene)
  set.seed(TIE_SEED)
  ranks_no_ties <- ranks + runif(length(ranks), 0, TIE_EPS)
  fg <- list()
  for (nm in names(GS)) {
    if (ctx$profile == "current") set.seed(FGSEA_SEED)
    fg[[nm]] <- tryCatch(fgsea(pathways = GS[[nm]], stats = ranks_no_ties, minSize = FGSEA_MIN, maxSize = FGSEA_MAX,
                               BPPARAM = BiocParallel::SerialParam()),
                         error = function(e) { message("FGSEA ", nm, " failed for ", code, ": ", conditionMessage(e)); NULL })
  }
  fgsea_long_rows <- list(); fg_paths <- list()
  for (nm in names(fg)) {
    f <- fg[[nm]]
    if (is.null(f) || nrow(f) == 0) next
    f_df <- as.data.frame(f)
    f_df$leadingEdge <- vapply(f_df$leadingEdge, paste, collapse = ";", FUN.VALUE = character(1))
    fp <- file.path(paths$fgsea, paste0("FGSEA_", nm, ".csv"))
    writeCsvLF(f_df, fp, row.names = FALSE)
    writeCsvLF(f_df[, colnames(f_df) != "leadingEdge", drop = FALSE],
              file.path(paths$fgsea, paste0("FGSEA_", nm, "_noLE.csv")), row.names = FALSE)
    fg_paths[[nm]] <- fp
    hits <- f_df[!is.na(f_df$padj) & f_df$padj <= 0.25, , drop = FALSE]
    if (nrow(hits) > 0) fgsea_long_rows[[nm]] <- data.frame(cluster = code, cluster_label = lbl, collection = nm,
      pathway = hits$pathway, NES = hits$NES, pval = hits$pval, padj = hits$padj, size = hits$size, stringsAsFactors = FALSE)
  }
  if (length(fg_paths) != length(GS)) stop("one or more FGSEA collections produced no output for ", code)

  # ---- provenance ----
  pb_file <- file.path(PB_DIR, paste0(reg$dir[k], ".counts.tsv.gz"))
  writeKV(c(
    schema_version = "1", generator = GENERATOR_REL, generator_sha256 = ctx$generator_sha256,
    profile = ctx$profile, r_version = R.version.string,
    edger_version = pkgv("edgeR"), limma_version = pkgv("limma"), statmod_version = pkgv("statmod"),
    population_id = code, population_label = lbl,
    pseudobulk_file = basename(pb_file), pseudobulk_sha256 = sha256File(pb_file),
    min_cells_per_animal = as.character(MIN_CELLS), samples_kept = paste(colnames(mat), collapse = ";"),
    n_normal = as.character(nN), n_obese = as.character(nO),
    genes_shared = as.character(nrow(mat)), genes_after_filterByExpr = as.character(nrow(y)),
    recipe = "DGEList; filterByExpr(group=grp); keep.lib.sizes=FALSE; calcNormFactors(TMM); estimateDisp(~grp); glmQLFit; glmQLFTest(coef=grpObese)",
    normcpm_definition = "edgeR::cpm(y, normalized.lib.sizes=TRUE) on filtered y (TMM-effective library sizes)",
    rawcpm_definition = "edgeR::cpm(y, normalized.lib.sizes=FALSE) on filtered y (filtered library sizes, no TMM)",
    de_all_sha256 = sha256File(de_path),
    normcpm_sha256 = sha256File(file.path(paths$de, "normcpm.csv")),
    rawcpm_sha256 = sha256File(file.path(paths$de, "rawcpm.csv"))),
    file.path(paths$de, "DE_provenance.tsv"))

  seed_policy <- if (ctx$profile == "current") "tie seed once; FGSEA seed reset before each collection"
                 else "tie seed once; no reset (legacy single RNG stream across collections)"
  fv <- c(
    schema_version = "3", generator = GENERATOR_REL, generator_sha256 = ctx$generator_sha256,
    r_version = R.version.string, fgsea_version = pkgv("fgsea"), msigdbr_version = pkgv("msigdbr"),
    babelgene_version = pkgv("babelgene"), msigdb_authority = MSIGDB_AUTHORITY,
    msigdb_db_version = attr(GS, "db_version"), target_species = MSIGDB_SPECIES,
    de_sha256 = sha256File(de_path), rank_gene_count = as.character(length(ranks_no_ties)),
    rank_statistic = "sign(logFC) * F (edgeR QL, DE_all.csv)",
    tie_seed = as.character(TIE_SEED),
    fgsea_seed = if (ctx$profile == "current") as.character(FGSEA_SEED) else "none",
    seed_policy = seed_policy,
    tie_jitter = "runif(0,1e-7) added in descending-score order (dplyr::arrange); no re-sort",
    ortholog_cache_policy = if (ctx$profile == "current") "clear target-species msigdbr ortholog cache before every collection fetch"
                            else "legacy: msigdbr(category=) in order H, KEGG, GO_BP, Reactome without cache clearing",
    output_hash_policy = "SHA-256 of exact published CSV bytes (FGSEA_<collection>.csv, with leadingEdge)",
    min_pathway_size = as.character(FGSEA_MIN), max_pathway_size = as.character(FGSEA_MAX))
  for (nm in names(GS)) {
    prefix <- tolower(nm)
    res_df <- read.csv(fg_paths[[nm]])
    fv <- c(fv, setNames(c(attr(GS[[nm]], "source_collection"), attr(GS[[nm]], "source_subcollection"),
      as.character(length(GS[[nm]])), ctx$membership_sha[[nm]], as.character(nrow(res_df)), sha256File(fg_paths[[nm]])),
      paste0(prefix, c("_source_collection", "_source_subcollection", "_pathway_count",
                       "_membership_sha256", "_result_rows", "_result_sha256"))))
  }
  writeKV(fv, file.path(paths$fgsea, "FGSEA_provenance.tsv"))

  if (ctx$qa_pdf) tryCatch(make_qa_pdf(code, display, paths, gsz, y, fit, res, deg, logcpm_qc, grp, loo_summary, ctx$qa_dir),
                           error = function(e) message("QA PDF failed for ", code, ": ", conditionMessage(e)))

  n_hits_at <- function(f, cut) if (is.null(f)) NA_integer_ else sum(!is.na(f$padj) & f$padj <= cut)
  summary_row <- data.frame(cluster = code, cluster_label = lbl, n_normal = nN, n_obese = nO, is_3v3 = is_3v3,
    samples_kept = paste(colnames(mat), collapse = ";"), n_DEG_FDR05_lfc025 = nrow(deg_sig_our),
    n_DEG_FDR05_LeiThresh = nrow(deg_sig_lei), n_DEG_fragile_LOO = n_fragile,
    top5_up = paste(head(deg$gene[deg$logFC > 0], 5), collapse = ";"),
    top5_down = paste(head(deg$gene[deg$logFC < 0], 5), collapse = ";"),
    n_fgsea_hallmark_0.25 = n_hits_at(fg$Hallmark, 0.25), n_fgsea_kegg_0.25 = n_hits_at(fg$KEGG, 0.25),
    n_fgsea_gobp_0.25 = n_hits_at(fg$GO_BP, 0.25), n_fgsea_reactome_0.25 = n_hits_at(fg$Reactome, 0.25),
    n_fgsea_hallmark_0.05 = n_hits_at(fg$Hallmark, 0.05), n_fgsea_kegg_0.05 = n_hits_at(fg$KEGG, 0.05),
    n_fgsea_gobp_0.05 = n_hits_at(fg$GO_BP, 0.05), n_fgsea_reactome_0.05 = n_hits_at(fg$Reactome, 0.05),
    stringsAsFactors = FALSE)
  fgsea_long <- if (length(fgsea_long_rows)) do.call(rbind, fgsea_long_rows) else NULL
  list(summary_row = summary_row, fgsea_long = fgsea_long)
}

worker <- function(k) {
  t0 <- Sys.time()
  out <- tryCatch(withCallingHandlers(run_one(k, REG_, GS_, CTX_),
                                      warning = function(w) invokeRestart("muffleWarning")),
                  error = function(e) e)
  list(k = k, out = out, elapsed = as.numeric(difftime(Sys.time(), t0, units = "secs")))
}

runAnalyze <- function() {
  if (DO_QA_PDF) for (p in c("pheatmap", "gridExtra"))
    if (!requireNamespace(p, quietly = TRUE)) stop("--qa-pdf needs package ", p)
  reg <- data.table::fread(file.path(PB_DIR, "population_cell_counts.tsv"), data.table = FALSE)
  pbProv <- data.table::fread(file.path(PB_DIR, "PSEUDOBULK_provenance.tsv"), data.table = FALSE)
  # re-verify every pseudobulk file against the manifest before use
  for (k in seq_len(nrow(reg))) if (sha256File(file.path(PB_DIR, reg$pseudobulk_file[k])) != reg$pseudobulk_sha256[k])
    stop("pseudobulk file changed since it was written: ", reg$pseudobulk_file[k])
  sel <- seq_len(nrow(reg))
  if (nzchar(ONLY)) sel <- which(reg$id %in% trimws(strsplit(ONLY, ",")[[1]]))

  results_root <- file.path(OUT_ROOT, "results")
  summary_dir <- file.path(results_root, "_global", "summary")
  qa_dir <- file.path(results_root, "_global", "qa_compiled")
  dir.create(summary_dir, recursive = TRUE, showWarnings = FALSE)
  if (DO_QA_PDF) dir.create(qa_dir, recursive = TRUE, showWarnings = FALSE)

  cat("Building MSigDB gene sets (profile ", PROFILE, ")...\n", sep = "")
  GS <- buildGeneSets()
  cat("MSigDB ", attr(GS, "db_version"), " sizes: ",
      paste(names(GS), vapply(GS, length, 1L), sep = "=", collapse = " "), "\n", sep = "")
  gsDir <- file.path(OUT_ROOT, "genesets"); dir.create(gsDir, showWarnings = FALSE)
  saveRDS(GS, file.path(gsDir, paste0("msigdb_", attr(GS, "db_version"), "_Macaca_mulatta_", PROFILE, ".rds")))

  ctx <- list(results_root = results_root, qa_dir = qa_dir, profile = PROFILE, loo = DO_LOO, qa_pdf = DO_QA_PDF,
              generator_sha256 = sha256File(GENERATOR_PATH),
              membership_sha = lapply(GS, membershipSha256))

  # Workers read the registry, gene sets and context from their global
  # environment, so the (large) GO:BP list is shipped once per worker rather
  # than serialised with every task.
  assign("REG_", reg, envir = globalenv()); assign("GS_", GS, envir = globalenv())
  assign("CTX_", ctx, envir = globalenv())
  t0 <- Sys.time()
  if (WORKERS > 1) {
    cl <- parallel::makeCluster(min(WORKERS, length(sel)))
    on.exit(parallel::stopCluster(cl), add = TRUE)
    parallel::clusterExport(cl, ls(globalenv()), envir = globalenv())
    parallel::clusterEvalQ(cl, suppressPackageStartupMessages({
      library(Matrix); library(edgeR); library(limma); library(statmod)
      library(fgsea); library(msigdbr); library(dplyr); library(BiocParallel)
      BiocParallel::register(BiocParallel::SerialParam()) }))
    outs <- parallel::parLapplyLB(cl, sel, worker)
  } else outs <- lapply(sel, worker)

  status <- list(); summ <- list(); longs <- list()
  for (o in outs) {
    id <- reg$id[o$k]
    failed <- inherits(o$out, "error")
    cat(sprintf("%-8s %-7s %5.1fs %s\n", id, if (failed) "FAILED" else "ok", o$elapsed,
                if (failed) conditionMessage(o$out) else ""))
    status[[id]] <- data.frame(cluster = id, cluster_label = reg$label[o$k], status = if (failed) "failed" else "ok",
                               elapsed_sec = round(o$elapsed, 1), message = if (failed) conditionMessage(o$out) else "",
                               stringsAsFactors = FALSE)
    if (!failed) { summ[[id]] <- o$out$summary_row; if (!is.null(o$out$fgsea_long)) longs[[id]] <- o$out$fgsea_long }
  }
  writeCsvLF(do.call(rbind, status), file.path(summary_dir, "run_status.csv"), row.names = FALSE)
  if (length(summ)) { ds <- do.call(rbind, summ)
    ds <- ds[order(-ds$n_DEG_FDR05_LeiThresh, -ds$n_DEG_FDR05_lfc025), ]
    writeCsvLF(ds, file.path(summary_dir, "DE_summary_all_clusters.csv"), row.names = FALSE) }
  if (length(longs)) { fl <- do.call(rbind, longs); fl <- fl[order(fl$padj, fl$pval), ]
    writeCsvLF(fl, file.path(summary_dir, "FGSEA_summary_all_clusters.csv"), row.names = FALSE) }

  writeKV(c(generator = GENERATOR_REL, generator_sha256 = ctx$generator_sha256, profile = PROFILE,
            r_version = R.version.string, platform = R.version$platform,
            edger_version = pkgv("edgeR"), limma_version = pkgv("limma"), statmod_version = pkgv("statmod"),
            fgsea_version = pkgv("fgsea"), msigdbr_version = pkgv("msigdbr"), babelgene_version = pkgv("babelgene"),
            dplyr_version = pkgv("dplyr"), msigdb_db_version = attr(GS, "db_version"),
            pseudobulk_dir = normalizePath(PB_DIR, winslash = "/"),
            pseudobulk_generator_sha256 = pbProv$value[pbProv$key == "generator_sha256"],
            populations_requested = as.character(length(sel)),
            populations_ok = as.character(length(summ)),
            populations_failed = { f <- setdiff(reg$id[sel], names(summ)); if (length(f)) paste(f, collapse = ";") else "none" },
            workers = as.character(WORKERS), loo = as.character(DO_LOO), qa_pdf = as.character(DO_QA_PDF),
            elapsed_min = sprintf("%.2f", as.numeric(difftime(Sys.time(), t0, units = "mins"))),
            finished_utc = format(Sys.time(), tz = "UTC", usetz = TRUE)),
          file.path(results_root, "_global", "RUN_provenance.tsv"))
  writeSessionInfo(file.path(results_root, "_global", "sessionInfo.txt"), c("stage: analyze", paste("profile:", PROFILE)))
  cat("Analysis written to ", results_root, "\n", sep = "")
}

if (STAGE %in% c("all", "pseudobulk")) runPseudobulk()
if (STAGE %in% c("all", "analyze")) runAnalyze()
