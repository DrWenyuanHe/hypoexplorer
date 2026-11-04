## ============================================================
## run_all_clusters.R
## Batch orchestrator: pseudobulk edgeR-QL DE + FGSEA enrichment
## for every cell cluster in the dataset, with per-cluster QC,
## LOO sensitivity, and a cross-cluster summary roll-up.
##
## OUTPUT TREE (auto-created under working directory):
##
##   results/
##     <cluster_code>__<cluster_label_safe>/
##       de/
##         DE_all.csv
##         DE_sig_ourThresh.csv            (FDR<=0.05 & |logFC|>=0.25)
##         DE_sig_LeiThresh.csv            (FDR<=0.05 & |logFC|>=log2(1.5))
##         normcpm.csv
##         LOO_sensitivity_top20.csv
##       fgsea/
##         FGSEA_Hallmark.csv
##         FGSEA_KEGG.csv
##         FGSEA_GO_BP.csv
##         FGSEA_Reactome.csv
##         FGSEA_Hallmark_noLE.csv
##         FGSEA_KEGG_noLE.csv
##         FGSEA_GO_BP_noLE.csv
##         FGSEA_Reactome_noLE.csv
##       qc/
##         group_sizes.csv
##     _global/
##       qa_compiled/
##         <cluster_code>__<cluster_label_safe>.pdf
##           (multi-page QA PDF: cover + group sizes, MDS, sample
##            correlation, BCV + QL dispersion, p-value histogram +
##            volcano, top-20 DEGs, LOO sensitivity — all plotted
##            directly, no intermediate PNGs)
##       composition/
##         cell_counts_by_sample_and_cluster_long.csv
##         cell_counts_by_sample_and_cluster_wide.csv
##         cell_proportions_by_sample_and_cluster_long.csv
##         cell_proportions_by_sample_and_cluster_wide.csv
##         DA_composition_quasibinomial_all_clusters.csv
##         DA_composition_propeller_vs_quasibinomial.csv
##         CellComposition_Proportions.png/.pdf
##         CellCounts_BySample.png/.pdf
##       summary/
##         run_status.csv                  (success/fail per cluster)
##         DE_summary_all_clusters.csv
##         FGSEA_summary_all_clusters.csv  (long-format, all hits at FDR<=0.25)
##
## Usage: source this file after the Seurat objects HCA_Macaque001_S001..S006
## are loaded in the global environment.
## ============================================================

# -------- 0) Packages (install if missing) --------
# Windows without Rtools: prefer pre-built binaries and never prompt to
# compile from source. This avoids the
#   "WARNING: Rtools is required to build R packages but is not currently installed"
# chain when a package's source version is newer than its Windows binary.
# If you DO install Rtools44 (https://cran.rstudio.com/bin/windows/Rtools/)
# you can safely delete this block.
if (.Platform$OS.type == "windows") {
  options(pkgType = "binary")
  options(install.packages.check.source = "no")
}

if (!requireNamespace("BiocManager", quietly = TRUE))
  install.packages("BiocManager", type = "binary")

cran_pkgs <- c("Seurat", "SeuratObject", "Matrix",
               "dplyr", "tidyr", "ggplot2", "scales",
               "pheatmap", "data.table", "RColorBrewer",
               "gridExtra")
bioc_pkgs <- c("edgeR", "limma", "statmod",
               "fgsea", "msigdbr", "clusterProfiler",
               "org.Mmu.eg.db", "enrichplot", "BiocParallel")

need_cran <- setdiff(cran_pkgs, rownames(installed.packages()))
if (length(need_cran))
  install.packages(need_cran, dependencies = TRUE, type = "binary")
need_bioc <- setdiff(bioc_pkgs, rownames(installed.packages()))
if (length(need_bioc))
  BiocManager::install(need_bioc, ask = FALSE, update = FALSE, type = "binary")

suppressPackageStartupMessages({
  library(Seurat);  library(SeuratObject);  library(Matrix)
  library(dplyr);   library(tidyr);         library(ggplot2); library(scales)
  library(pheatmap); library(data.table);   library(RColorBrewer)
  library(edgeR);   library(limma);         library(statmod)
  library(fgsea);   library(msigdbr);       library(clusterProfiler)
  library(org.Mmu.eg.db);                   library(enrichplot)
  library(BiocParallel)
  library(gridExtra); library(grid)
})

# Force serial BiocParallel backend. fgsea dispatches permutation testing
# through BiocParallel::bplapply; on Windows the default SnowParam spawns
# PSOCK workers whose socket handshake intermittently fails ("error writing
# to connection"). Serial eliminates that class of failure; perm testing is
# not the bottleneck here.
BiocParallel::register(BiocParallel::SerialParam())

# -------- 1) Global configuration --------
celltype_col   <- "celltype_level3_abbr"   # change in one place if needed
MIN_CELLS      <- 15                        # project rule (CLAUDE.md)
LEI_LFC_THRESH <- log2(1.5)                 # Lei et al. 2024 threshold
TOP_N_LOO      <- 20                        # LOO: top DEGs to probe
MSIGDB_SPECIES <- "Macaca mulatta"          # project rule
FGSEA_MIN      <- 15
FGSEA_MAX      <- 500

# sample-level condition map (hard-coded per CLAUDE.md)
cond_map <- c(
  HCA_Macaque001_S001 = "Normal",
  HCA_Macaque001_S002 = "Normal",
  HCA_Macaque001_S003 = "Normal",
  HCA_Macaque001_S004 = "Obese",
  HCA_Macaque001_S005 = "Obese",
  HCA_Macaque001_S006 = "Obese"
)

# curated cluster label map (from test.R; keep in sync)
subcluster_map <- c(
  # GABAergic
  "i0"="MEIS2/ONECUT1","i3"="DLX1","i4"="DLX1/B3GALNT2","i13"="RELN/EFNA5",
  "i14"="CCK/ST18","i15"="MEIS2/ESRRG","i17"="NR2F1/SLC7A3","i18"="NTS/ADCYAP1R1",
  "i19"="TAC1/FBN2","i20"="SST/CALCR","i23"="AGRP/MCTP2","i24"="CALCB/CRISPLD2",
  "i25"="LHX1/GRAMD2B","i26"="GALP/HTR2C","i32"="GAL/TAC1","i40"="GHRH/PIK3R1",
  "i42"="SST/NPY","i43"="KALRN/PTK2B","i45"="KIT/OTX2",
  # Glutamatergic
  "e1"="CBLN1/PDE1C","e2"="LEPR/KCNB2","e5"="GPC5/HTATSF1","e6"="NKAIN3/TSPAN6",
  "e7"="HTATSF1/PRLR","e8"="IQGAP2/PRDM13","e9"="POMC/TBX3","e10"="HMX3/SYNPR",
  "e11"="GPR50","e12"="CRH/RNPC3","e16"="PENK/OXT","e21"="CBLN2/ISLR2",
  "e22"="ESR1/TMEM114","e27"="CRHBP/ARPP21","e28"="HCRT/NPVF","e29"="CALB2/PSTPIP1",
  "e31"="IRX3/ANOS1","e33"="KISS1/ESR1","e34"="LHX1/COCH","e35"="EGR3/ETV3",
  "e36"="CARTPT/GHR","e37"="PMCH/DCN","e38"="NPY/ITGA8","e39"="AVP/CAPRIN2",
  "e41"="ADCYAP1/BDNF","e47"="HCRT/PDYN",
  # Histaminergic
  "h44"="HDC","h46"="HDC/HPCAL1",
  # Oxytocin
  "o30"="OXT/PTGFR"
)

# Non-neuronal populations. Unlike neuronal clusters (named "<letter><digits>"
# e.g. "e9"), these are named after the cell type and do NOT survive code_of()'s
# "^[a-z]+[0-9]+" extraction, so they were historically dropped from DE/FGSEA.
# Each row maps the EXACT lowercased metadata label -> a clean id + display label.
#   - id must be a valid JS identifier (no hyphens): the web layer turns it into
#     a POP_<ID> global and a pop_<id>.js filename.
#   - matching is EXACT ("^label$"), NOT the neuronal "^code([:_]|$)" delimiter
#     rule — otherwise "tany_a"/"tany_b" would both collapse onto code "tany".
nonneuronal_map <- list(
  list(meta="ast-1",       id="Ast1",    label="Astrocyte 1"),
  list(meta="ast-2",       id="Ast2",    label="Astrocyte 2"),
  list(meta="oligo-1",     id="Oligo1",  label="Oligodendrocyte 1"),
  list(meta="oligo-2",     id="Oligo2",  label="Oligodendrocyte 2"),
  list(meta="opc",         id="OPC",     label="OPC"),
  list(meta="cop",         id="COP",     label="COP"),
  list(meta="micro-1",     id="Micro1",  label="Microglia 1"),
  list(meta="micro-2",     id="Micro2",  label="Microglia 2"),
  list(meta="endothelial", id="Endo",    label="Endothelial"),
  list(meta="ependy-1",    id="Ependy1", label="Ependymal 1"),
  list(meta="ependy-2",    id="Ependy2", label="Ependymal 2"),
  list(meta="fibro-1",     id="Fibro1",  label="Fibroblast 1"),
  list(meta="fibro-2",     id="Fibro2",  label="Fibroblast 2"),
  list(meta="tany_a",      id="TanyA",   label="Tanycyte A"),
  list(meta="tany_b",      id="TanyB",   label="Tanycyte B")
)

# -------- 2) Collect Seurat objects --------
obj_names <- ls(pattern = "^HCA_Macaque001_S\\d{3}$", envir = .GlobalEnv)
if (length(obj_names) < 2) {
  stop("run_all_clusters.R: expected >=2 Seurat objects named HCA_Macaque001_S### ",
       "in the global environment, found ", length(obj_names), ". ",
       "Load them before sourcing this file.")
}
objs <- mget(obj_names, envir = .GlobalEnv, inherits = TRUE)
cat("Loaded", length(objs), "Seurat objects:", paste(names(objs), collapse = ", "), "\n")

# confirm celltype column exists in every object
bad <- names(objs)[!vapply(objs, function(x) celltype_col %in% colnames(x@meta.data),
                           logical(1))]
if (length(bad)) {
  stop("Column '", celltype_col, "' missing in: ", paste(bad, collapse = ", "))
}

# -------- 3) Build the list of clusters to iterate --------
# Strategy: discover every cluster that appears in the data, then union
# with subcluster_map so curated clusters come first in a stable order.
discovered <- unique(unlist(lapply(objs, function(x) {
  v <- tolower(trimws(as.character(x@meta.data[[celltype_col]])))
  v[!is.na(v) & nzchar(v)]
})))

# The labels in metadata might be "e9", "e9:POMC/TBX3", or "e9_POMC/TBX3".
# Extract the leading "e9" / "i23" / "o30" / "h44" / "c15" token as the code.
code_of <- function(lbl) {
  m <- regmatches(lbl, regexpr("^[a-z]+[0-9]+", lbl))
  if (length(m) == 0) return(NA_character_)
  m
}
discovered_codes <- unique(na.omit(vapply(discovered, code_of, character(1))))

# Build the per-population iteration registry. Each id maps to a regex used to
# subset cells from the celltype column and a human-readable display label.
# Neuronal ids come from code_of() (curated first, then any extra discovered
# codes) and use the legacy "^code([:_]|$)" rule that tolerates "e9", "e9:..",
# "e9_..". Non-neuronal ids come from nonneuronal_map and match their full
# label EXACTLY. `discovered` is already lowercased/trimmed (see above).
MATCH_BY_ID <- list()
LABEL_BY_ID <- list()

neuronal_ids <- c(
  intersect(names(subcluster_map), discovered_codes),
  setdiff(discovered_codes, names(subcluster_map))
)
for (code in neuronal_ids) {
  MATCH_BY_ID[[code]] <- paste0("^", code, "([:_]|$)")
  LABEL_BY_ID[[code]] <- if (code %in% names(subcluster_map)) subcluster_map[[code]] else code
}

# Non-neuronal: include only populations actually present in the data. Labels
# contain only [a-z0-9_-] (no regex metacharacters), so "^label$" is literal.
for (nn in nonneuronal_map) {
  if (nn$meta %in% discovered) {
    MATCH_BY_ID[[nn$id]] <- paste0("^", nn$meta, "$")
    LABEL_BY_ID[[nn$id]] <- nn$label
  }
}

clusters_to_run <- names(MATCH_BY_ID)

# Optional subset hooks (default: run all). Useful for incremental re-runs, e.g.
# regenerating just the non-neuronal populations without recomputing neuronal
# ones. ONLY_CLUSTERS takes precedence; both are comma-separated id lists.
# NOTE: when running a subset, the per-cluster outputs are written as usual but
# the _global summaries (run_status/DE_summary/FGSEA_summary) reflect ONLY the
# subset — merge them back if you need a dataset-wide roll-up.
.only <- trimws(Sys.getenv("ONLY_CLUSTERS", ""))
.skip <- trimws(Sys.getenv("SKIP_CLUSTERS", ""))
if (nzchar(.only)) {
  want <- trimws(strsplit(.only, ",")[[1]])
  clusters_to_run <- clusters_to_run[clusters_to_run %in% want]
} else if (nzchar(.skip)) {
  drop <- trimws(strsplit(.skip, ",")[[1]])
  clusters_to_run <- clusters_to_run[!clusters_to_run %in% drop]
}

cat("Clusters to run (n=", length(clusters_to_run), "): ",
    paste(clusters_to_run, collapse = ", "), "\n", sep = "")
cat("  neuronal: ", sum(clusters_to_run %in% neuronal_ids),
    " | non-neuronal: ", sum(!clusters_to_run %in% neuronal_ids), "\n", sep = "")

# -------- 4) Output root --------
RESULTS_ROOT <- "results"
GLOBAL_DIR   <- file.path(RESULTS_ROOT, "_global")
COMP_DIR     <- file.path(GLOBAL_DIR, "composition")
SUMMARY_DIR  <- file.path(GLOBAL_DIR, "summary")
QA_DIR       <- file.path(GLOBAL_DIR, "qa_compiled")
for (d in c(RESULTS_ROOT, GLOBAL_DIR, COMP_DIR, SUMMARY_DIR, QA_DIR)) {
  dir.create(d, showWarnings = FALSE, recursive = TRUE)
}

# helper: sanitize a cluster label for filesystem
safe_fs <- function(s) gsub("[^A-Za-z0-9._-]+", "_", s)

# per-cluster folder builder. Only CSV/table outputs are written under
# the per-cluster tree; all figures are consolidated into the compiled
# QA PDF under results/_global/qa_compiled/.
cluster_dir <- function(code) {
  lbl <- LABEL_BY_ID[[code]]
  base <- file.path(RESULTS_ROOT, paste0(code, "__", safe_fs(lbl)))
  for (sub in c("de", "fgsea", "qc")) {
    dir.create(file.path(base, sub), showWarnings = FALSE, recursive = TRUE)
  }
  list(base = base,
       de   = file.path(base, "de"),
       fgsea= file.path(base, "fgsea"),
       qc   = file.path(base, "qc"),
       label= lbl)
}

# Bundle one cluster's QC + DE summary into a single multi-page PDF
# under QA_DIR. All plots are drawn directly into the PDF device (no
# intermediate PNGs). Pages:
#   1. Cover + group sizes table
#   2. MDS (padded axes, variance-explained in axis labels)
#   3. Sample correlation heatmap (log-CPM, Pearson)
#   4. BCV + QL dispersion (2-panel base R)
#   5. P-value histogram + volcano (2-panel base R)
#   6. Top-20 DEGs table
#   7. LOO sensitivity table
make_qa_pdf <- function(code, display, paths, gsz, y, fit, res, deg,
                        logcpm_qc, grp, loo_summary) {
  out_pdf <- file.path(QA_DIR, paste0(code, "__", safe_fs(paths$label), ".pdf"))
  pdf(out_pdf, width = 8.5, height = 11, onefile = TRUE)
  on.exit(if (length(dev.list())) dev.off(), add = TRUE)

  title_grob <- function(txt, size = 14) {
    grid::textGrob(txt, gp = grid::gpar(fontsize = size, fontface = "bold"))
  }
  tbl_theme <- gridExtra::ttheme_default(
    core    = list(fg_params = list(fontsize = 8)),
    colhead = list(fg_params = list(fontsize = 9, fontface = "bold")))
  pad_lim <- function(v, frac) {
    rng <- range(v, na.rm = TRUE); span <- diff(rng)
    if (!is.finite(span) || span == 0) span <- 1
    c(rng[1] - span * frac, rng[2] + span * frac)
  }
  mds_cols <- c("Normal" = "#4C78A8", "Obese" = "#E45756")

  # ---- Page 1: cover + group sizes ----
  cover_tbl <- data.frame(
    Metric = c("Cluster code", "Cluster label", "n Normal", "n Obese",
               "Is 3v3?", "MIN_CELLS", "Samples kept"),
    Value  = c(code, paths$label, as.character(gsz$n_normal),
               as.character(gsz$n_obese), as.character(gsz$is_3v3),
               as.character(gsz$min_cells), gsz$samples_kept),
    stringsAsFactors = FALSE)
  gridExtra::grid.arrange(
    title_grob(paste0("QA Report - ", display), size = 20),
    gridExtra::tableGrob(cover_tbl, rows = NULL,
                         theme = gridExtra::ttheme_default(base_size = 10)),
    nrow = 2, heights = c(1, 5))

  # ---- Page 2: MDS (base R, padded axes, variance-explained labels) ----
  mds_obj  <- limma::plotMDS(y, plot = FALSE)
  ve       <- tryCatch(mds_obj$var.explained, error = function(e) NULL)
  xlab_mds <- if (!is.null(ve) && length(ve) >= 2)
    paste0("Leading logFC dim 1 (", round(ve[1] * 100), "%)") else
    "Leading logFC dim 1"
  ylab_mds <- if (!is.null(ve) && length(ve) >= 2)
    paste0("Leading logFC dim 2 (", round(ve[2] * 100), "%)") else
    "Leading logFC dim 2"
  par(mar = c(5, 5, 4, 3))
  plot(mds_obj$x, mds_obj$y, type = "n",
       xlim = pad_lim(mds_obj$x, 0.40),
       ylim = pad_lim(mds_obj$y, 0.30),
       xlab = xlab_mds, ylab = ylab_mds,
       main = paste("MDS:", display),
       cex.main = 0.95, cex.lab = 0.85, cex.axis = 0.75)
  text(mds_obj$x, mds_obj$y, labels = colnames(y),
       col = mds_cols[as.character(grp)], cex = 0.7)

  # ---- Page 3: Sample correlation heatmap (pheatmap draws via grid) ----
  if (!is.null(logcpm_qc) && ncol(logcpm_qc) >= 2) {
    tryCatch({
      pheatmap::pheatmap(
        cor(logcpm_qc),
        display_numbers = TRUE, number_format = "%.3f",
        main = paste("Sample correlation (log-CPM):", display))
    }, error = function(e) {
      grid::grid.newpage()
      grid::grid.text(
        paste0("Sample correlation failed: ", conditionMessage(e)),
        gp = grid::gpar(fontsize = 11, col = "grey40"))
    })
  }

  # ---- Page 4: BCV + QL dispersion (base R, 2-panel) ----
  par(mfrow = c(2, 1), mar = c(4, 4, 3, 2))
  edgeR::plotBCV(y,   main = paste("BCV:",           display))
  edgeR::plotQLDisp(fit, main = paste("QL dispersion:", display))
  par(mfrow = c(1, 1))

  # ---- Page 5: P-value histogram + Volcano (base R, 2-panel) ----
  par(mfrow = c(2, 1), mar = c(4, 4, 3, 2))
  hist(res$table$PValue, breaks = 50,
       xlab = "raw p-value",
       main = paste("p-value dist:", display))
  plot(deg$logFC, -log10(deg$FDR), pch = 16, cex = 0.5,
       xlab = "log2FC (Obese vs Normal)", ylab = "-log10(FDR)",
       main = paste("Volcano:", display))
  abline(v = c(-0.25, 0.25), lty = 2)
  abline(h = -log10(0.05), lty = 2)
  par(mfrow = c(1, 1))

  # ---- Page 6: Top-20 DEGs table ----
  top20 <- head(deg, 20)
  if (nrow(top20) > 0) {
    top20_df <- data.frame(
      gene   = top20$gene,
      logFC  = signif(top20$logFC,  3),
      logCPM = signif(top20$logCPM, 3),
      `F`    = signif(top20$`F`,    3),
      PValue = signif(top20$PValue, 3),
      FDR    = signif(top20$FDR,    3),
      check.names = FALSE, stringsAsFactors = FALSE)
    gridExtra::grid.arrange(
      title_grob("Top 20 DEGs (by FDR)"),
      gridExtra::tableGrob(top20_df, rows = NULL, theme = tbl_theme),
      nrow = 2, heights = c(0.4, 7))
  }

  # ---- Page 7: LOO sensitivity table ----
  if (!is.null(loo_summary) && nrow(loo_summary) > 0) {
    loo_df <- data.frame(
      gene               = loo_summary$gene,
      orig_logFC         = signif(loo_summary$orig_logFC, 3),
      orig_FDR           = signif(loo_summary$orig_FDR,   3),
      orig_sig_0.05      = loo_summary$orig_sig_0.05,
      loo_n_fits         = loo_summary$loo_n_fits,
      loo_frac_preserved = signif(loo_summary$loo_frac_preserved, 3),
      loo_fragile        = loo_summary$loo_fragile,
      stringsAsFactors   = FALSE)
    gridExtra::grid.arrange(
      title_grob(paste0("LOO sensitivity (top ", nrow(loo_df), " DEGs)")),
      gridExtra::tableGrob(loo_df, rows = NULL, theme = tbl_theme),
      nrow = 2, heights = c(0.4, 7))
  }

  invisible(out_pdf)
}

# -------- 5) Pseudobulk helper (RAW COUNTS ONLY, hard-stop) --------
pb_one <- function(x, ct_pat_in, sample_name) {
  DefaultAssay(x) <- "RNA"
  lab <- tolower(trimws(as.character(x@meta.data[[celltype_col]])))
  idx <- grepl(ct_pat_in, lab)
  if (sum(idx) < MIN_CELLS) return(NULL)

  mat <- tryCatch(GetAssayData(x, layer = "counts")[, idx, drop = FALSE],
                  error = function(e) NULL)
  if (is.null(mat) || Matrix::nnzero(mat) == 0) {
    stop("Sample '", sample_name, "': no non-empty 'counts' layer. ",
         "Pseudobulk DE requires raw UMI counts; aborting. ",
         "Do NOT feed normalized values to edgeR/TMM.")
  }
  v <- Matrix::rowSums(mat); names(v) <- rownames(mat)
  v
}

# -------- 6) FGSEA gene sets (build ONCE, reuse for every cluster) --------
cat("Building msigdbr gene sets for species '", MSIGDB_SPECIES, "'...\n", sep = "")
hallmark_tbl <- msigdbr(species = MSIGDB_SPECIES, category = "H")
hallmark     <- split(hallmark_tbl$gene_symbol, hallmark_tbl$gs_name)

kegg_tbl <- msigdbr(species = MSIGDB_SPECIES, category = "C2",
                    subcollection = "CP:KEGG_LEGACY")
kegg     <- split(kegg_tbl$gene_symbol, kegg_tbl$gs_name)

go_bp_tbl <- msigdbr(species = MSIGDB_SPECIES, category = "C5",
                     subcollection = "GO:BP")
go_bp     <- split(go_bp_tbl$gene_symbol, go_bp_tbl$gs_name)

react_tbl <- msigdbr(species = MSIGDB_SPECIES, category = "C2",
                     subcollection = "CP:REACTOME")
react     <- split(react_tbl$gene_symbol, react_tbl$gs_name)

cat("MSigDB sizes — Hallmark:", length(hallmark),
    " KEGG:", length(kegg),
    " GO:BP:", length(go_bp),
    " Reactome:", length(react), "\n")

# -------- 7) Per-cluster DE + FGSEA (one cluster worth of work) --------
# Returns a one-row summary data.frame plus a long-format fgsea summary
# (written into the parent scope via <<- is avoided; we return both).
run_one_cluster <- function(code) {
  on.exit(graphics.off(), add = TRUE)
  lbl     <- LABEL_BY_ID[[code]]
  label   <- code    # used in filenames / titles (short)
  display <- if (lbl != code) paste0(code, " (", lbl, ")") else code
  paths   <- cluster_dir(code)

  cat("\n==========================================================\n")
  cat("Cluster:", display, "\n")
  cat("Output :", paths$base, "\n")
  cat("==========================================================\n")

  # match pattern from the registry: neuronal "^code([:_]|$)" or, for
  # non-neuronal, an exact "^label$".
  ct_pat <- MATCH_BY_ID[[code]]

  # pseudobulk across samples
  pb_list <- Map(function(obj, nm) pb_one(obj, ct_pat, nm), objs, names(objs))
  pb_list <- pb_list[!vapply(pb_list, is.null, logical(1))]

  if (length(pb_list) < 2) {
    stop("Fewer than 2 samples passed MIN_CELLS=", MIN_CELLS, " for cluster ", code)
  }

  # build gene x sample matrix
  genes <- Reduce(intersect, lapply(pb_list, names))
  if (length(genes) == 0) stop("No shared genes across samples for cluster ", code)
  mat   <- do.call(cbind, lapply(pb_list, function(v) v[genes]))
  colnames(mat) <- names(pb_list); rownames(mat) <- genes

  # groups
  grp <- factor(unname(cond_map[colnames(mat)]), levels = c("Normal", "Obese"))
  if (any(is.na(grp))) {
    stop("cond_map missing labels for: ",
         paste(colnames(mat)[is.na(grp)], collapse = ", "))
  }
  if (length(unique(grp)) < 2) {
    stop("Only one group represented after MIN_CELLS filter for cluster ", code,
         " (", paste(levels(grp)[table(grp) > 0], collapse = ","), ")")
  }

  # realized group sizes
  nN <- sum(grp == "Normal"); nO <- sum(grp == "Obese")
  is_3v3 <- (nN == 3 && nO == 3)
  gsz <- data.frame(cluster=code, cluster_label=lbl,
                    min_cells=MIN_CELLS, n_normal=nN, n_obese=nO,
                    is_3v3=is_3v3,
                    samples_kept=paste(colnames(mat), collapse=";"),
                    stringsAsFactors=FALSE)
  write.csv(gsz, file.path(paths$qc, "group_sizes.csv"), row.names = FALSE)
  if (!is_3v3) {
    warning("Cluster ", code, ": group sizes are ", nN, "v", nO,
            " (not 3v3). Report realized n in Methods.")
  }

  # edgeR QL
  y <- DGEList(counts = mat)
  keepg <- filterByExpr(y, group = grp)
  y <- y[keepg, , keep.lib.sizes = FALSE]
  y <- calcNormFactors(y, method = "TMM")

  # ---- Cache log-CPM for sample-correlation heatmap (drawn later into PDF) ----
  logcpm_qc <- edgeR::cpm(y, log = TRUE, prior.count = 1)

  # ---- dispersion + QL fit ----
  design <- model.matrix(~ grp)
  y   <- estimateDisp(y, design)
  fit <- glmQLFit(y, design)
  res <- glmQLFTest(fit, coef = "grpObese")

  # ---- DE tables ----
  deg <- topTags(res, n=Inf)$table
  deg$gene <- rownames(deg)
  deg <- deg[order(deg$FDR), ]

  deg_sig_our <- subset(deg, FDR <= 0.05 & abs(logFC) >= 0.25)
  deg_sig_lei <- subset(deg, FDR <= 0.05 & abs(logFC) >= LEI_LFC_THRESH)

  write.csv(deg,         file.path(paths$de, "DE_all.csv"),           row.names=FALSE)
  write.csv(deg_sig_our, file.path(paths$de, "DE_sig_ourThresh.csv"), row.names=FALSE)
  write.csv(deg_sig_lei, file.path(paths$de, "DE_sig_LeiThresh.csv"), row.names=FALSE)

  norm_cpm <- edgeR::cpm(y, normalized.lib.sizes = TRUE)
  write.csv(cbind(gene=rownames(norm_cpm), as.data.frame(norm_cpm, check.names=FALSE)),
            file.path(paths$de, "normcpm.csv"), row.names=FALSE)

  # ---- LOO sensitivity on top-N DEGs ----
  top_loo_genes <- head(deg$gene, TOP_N_LOO)
  loo_one <- function(drop_sample) {
    keep_cols <- setdiff(colnames(mat), drop_sample)
    if (length(keep_cols) < 3) return(NULL)
    grp_l <- factor(unname(cond_map[keep_cols]), levels=c("Normal","Obese"))
    if (length(unique(grp_l)) < 2) return(NULL)
    y_l <- DGEList(counts=mat[, keep_cols, drop=FALSE])
    keepg_l <- filterByExpr(y_l, group=grp_l)
    if (sum(keepg_l) == 0) return(NULL)
    y_l <- y_l[keepg_l, , keep.lib.sizes=FALSE]
    y_l <- calcNormFactors(y_l, method="TMM")
    design_l <- model.matrix(~ grp_l)
    y_l <- estimateDisp(y_l, design_l)
    fit_l <- glmQLFit(y_l, design_l)
    res_l <- glmQLFTest(fit_l, coef="grp_lObese")
    tbl_l <- topTags(res_l, n=Inf)$table
    tbl_l$gene <- rownames(tbl_l)
    tbl_l
  }

  loo_tables <- setNames(
    lapply(colnames(mat), function(s) {
      tryCatch(loo_one(s),
               error = function(e) {
                 message("LOO dropping ", s, " failed: ", conditionMessage(e)); NULL })
    }),
    colnames(mat)
  )

  loo_summary <- do.call(rbind, lapply(top_loo_genes, function(g) {
    orig_row <- deg[deg$gene == g, , drop = FALSE]
    fits_preserving <- vapply(loo_tables, function(tbl) {
      if (is.null(tbl)) return(NA)
      i <- match(g, tbl$gene)
      if (is.na(i)) return(FALSE)
      tbl$FDR[i] <= 0.05
    }, logical(1))
    frac <- mean(fits_preserving, na.rm = TRUE)
    data.frame(
      gene               = g,
      orig_FDR           = orig_row$FDR[1],
      orig_logFC         = orig_row$logFC[1],
      orig_sig_0.05      = orig_row$FDR[1] <= 0.05,
      loo_n_fits         = sum(!is.na(fits_preserving)),
      loo_frac_preserved = frac,
      loo_fragile        = !is.na(frac) & frac < 2/3,
      stringsAsFactors = FALSE
    )
  }))
  if (!is.null(loo_summary) && nrow(loo_summary) > 0) {
    write.csv(loo_summary,
              file.path(paths$de, paste0("LOO_sensitivity_top", TOP_N_LOO, ".csv")),
              row.names = FALSE)
  }
  n_fragile <- if (is.null(loo_summary)) NA_integer_ else sum(loo_summary$loo_fragile, na.rm=TRUE)

  # ---- FGSEA: Hallmark / KEGG / GO:BP / Reactome ----
  # Rank by signed QL F-statistic (Squair et al. 2021). deg$F is the QL
  # F-statistic returned by glmQLFTest via topTags(); it is continuous
  # in evidence and does not collapse top genes onto a shared
  # minimum-achievable-FDR plateau the way -log10(FDR) does.
  ranked <- deg %>%
    transmute(gene = gene,
              score = sign(logFC) * `F`) %>%
    arrange(desc(score))
  ranks <- setNames(ranked$score, ranked$gene)
  set.seed(42)
  eps <- 1e-7
  ranks_no_ties <- ranks + runif(length(ranks), 0, eps)

  run_fgsea <- function(gs, name) {
    tryCatch(
      fgsea(pathways = gs, stats = ranks_no_ties,
            minSize = FGSEA_MIN, maxSize = FGSEA_MAX,
            BPPARAM = BiocParallel::SerialParam()),
      error = function(e) {
        message("FGSEA ", name, " failed for ", code, ": ", conditionMessage(e))
        NULL
      })
  }

  fg <- list(
    Hallmark = run_fgsea(hallmark, "Hallmark"),
    KEGG     = run_fgsea(kegg,     "KEGG"),
    GO_BP    = run_fgsea(go_bp,    "GO:BP"),
    Reactome = run_fgsea(react,    "Reactome")
  )

  fgsea_long_rows <- list()
  for (nm in names(fg)) {
    f <- fg[[nm]]
    if (is.null(f) || nrow(f) == 0) next

    # with leadingEdge collapsed as string
    f_df <- as.data.frame(f)
    if ("leadingEdge" %in% colnames(f_df)) {
      f_df$leadingEdge <- vapply(f_df$leadingEdge, paste, collapse=";",
                                 FUN.VALUE=character(1))
    }
    write.csv(f_df,
              file.path(paths$fgsea, paste0("FGSEA_", nm, ".csv")),
              row.names=FALSE, fileEncoding="UTF-8")

    f_noLE <- f_df[, !colnames(f_df) %in% "leadingEdge", drop=FALSE]
    write.csv(f_noLE,
              file.path(paths$fgsea, paste0("FGSEA_", nm, "_noLE.csv")),
              row.names=FALSE)

    # capture top hits for cross-cluster summary (FDR<=0.25, for completeness)
    hits <- f_df[!is.na(f_df$padj) & f_df$padj <= 0.25, , drop=FALSE]
    if (nrow(hits) > 0) {
      fgsea_long_rows[[nm]] <- data.frame(
        cluster    = code,
        cluster_label = lbl,
        collection = nm,
        pathway    = hits$pathway,
        NES        = hits$NES,
        pval       = hits$pval,
        padj       = hits$padj,
        size       = hits$size,
        stringsAsFactors = FALSE
      )
    }
  }

  fgsea_long <- if (length(fgsea_long_rows) == 0) {
    data.frame(cluster=character(), cluster_label=character(),
               collection=character(), pathway=character(), NES=numeric(),
               pval=numeric(), padj=numeric(), size=integer(),
               stringsAsFactors=FALSE)
  } else do.call(rbind, fgsea_long_rows)

  # ---- summary row for cross-cluster roll-up ----
  top_up   <- head(deg$gene[deg$logFC > 0], 5)
  top_down <- head(deg$gene[deg$logFC < 0], 5)

  n_hits_at <- function(f, cut) {
    if (is.null(f)) return(NA_integer_)
    sum(!is.na(f$padj) & f$padj <= cut, na.rm=TRUE)
  }

  summary_row <- data.frame(
    cluster               = code,
    cluster_label         = lbl,
    n_normal              = nN,
    n_obese               = nO,
    is_3v3                = is_3v3,
    samples_kept          = paste(colnames(mat), collapse=";"),
    n_DEG_FDR05_lfc025    = nrow(deg_sig_our),
    n_DEG_FDR05_LeiThresh = nrow(deg_sig_lei),
    n_DEG_fragile_LOO     = n_fragile,
    top5_up               = paste(top_up,   collapse=";"),
    top5_down             = paste(top_down, collapse=";"),
    n_fgsea_hallmark_0.25 = n_hits_at(fg$Hallmark, 0.25),
    n_fgsea_kegg_0.25     = n_hits_at(fg$KEGG,     0.25),
    n_fgsea_gobp_0.25     = n_hits_at(fg$GO_BP,    0.25),
    n_fgsea_reactome_0.25 = n_hits_at(fg$Reactome, 0.25),
    n_fgsea_hallmark_0.05 = n_hits_at(fg$Hallmark, 0.05),
    n_fgsea_kegg_0.05     = n_hits_at(fg$KEGG,     0.05),
    n_fgsea_gobp_0.05     = n_hits_at(fg$GO_BP,    0.05),
    n_fgsea_reactome_0.05 = n_hits_at(fg$Reactome, 0.05),
    stringsAsFactors      = FALSE
  )

  # ---- Compiled QA PDF (QC + DE summary) for this cluster ----
  # All plots are drawn directly into the PDF device from in-memory
  # objects (y, fit, res, deg, logcpm_qc, grp, loo_summary) — no
  # intermediate PNG files are written under the per-cluster tree.
  tryCatch(
    make_qa_pdf(code = code, display = display, paths = paths,
                gsz = gsz, y = y, fit = fit, res = res, deg = deg,
                logcpm_qc = logcpm_qc, grp = grp,
                loo_summary = loo_summary),
    error = function(e)
      message("   QA PDF compilation failed for ", code, ": ",
              conditionMessage(e))
  )

  list(summary_row = summary_row, fgsea_long = fgsea_long)
}

# -------- 8) Run every cluster with per-cluster try/catch --------
status_rows  <- list()
summary_rows <- list()
fgsea_rows   <- list()

t0 <- Sys.time()
for (code in clusters_to_run) {
  t_start <- Sys.time()
  # Catch errors (short-circuit) but let warnings through without aborting
  # run_one_cluster. tryCatch(warning = ...) short-circuits at the first
  # warning; withCallingHandlers prints it inline and resumes.
  out <- tryCatch(
    withCallingHandlers(
      run_one_cluster(code),
      warning = function(w) {
        message("   WARNING (", code, "): ", conditionMessage(w))
        invokeRestart("muffleWarning")
      }
    ),
    error = function(e) e
  )
  elapsed <- as.numeric(difftime(Sys.time(), t_start, units = "secs"))

  if (inherits(out, "error")) {
    msg <- conditionMessage(out)
    message("!! Cluster ", code, " FAILED: ", msg)
    status_rows[[code]] <- data.frame(
      cluster = code,
      cluster_label = LABEL_BY_ID[[code]],
      status  = "failed",
      elapsed_sec = round(elapsed, 1),
      message = msg,
      stringsAsFactors = FALSE)
  } else {
    status_rows[[code]]  <- data.frame(
      cluster = code,
      cluster_label = LABEL_BY_ID[[code]],
      status  = "ok",
      elapsed_sec = round(elapsed, 1),
      message = "",
      stringsAsFactors = FALSE)
    summary_rows[[code]] <- out$summary_row
    if (nrow(out$fgsea_long) > 0) fgsea_rows[[code]] <- out$fgsea_long
  }
}
t_total <- as.numeric(difftime(Sys.time(), t0, units = "mins"))
cat("\nFinished batch DE/FGSEA. Total elapsed: ", round(t_total, 2), " min\n", sep="")

# write run_status.csv
run_status <- do.call(rbind, status_rows)
write.csv(run_status, file.path(SUMMARY_DIR, "run_status.csv"), row.names=FALSE)
cat("Saved: ", file.path(SUMMARY_DIR, "run_status.csv"), "\n", sep="")

# cross-cluster DE summary
if (length(summary_rows)) {
  de_summary <- do.call(rbind, summary_rows)
  de_summary <- de_summary[order(-de_summary$n_DEG_FDR05_LeiThresh,
                                 -de_summary$n_DEG_FDR05_lfc025), ]
  write.csv(de_summary,
            file.path(SUMMARY_DIR, "DE_summary_all_clusters.csv"),
            row.names=FALSE)
  cat("Saved: ", file.path(SUMMARY_DIR, "DE_summary_all_clusters.csv"), "\n", sep="")
}

# cross-cluster FGSEA summary (long)
if (length(fgsea_rows)) {
  fgsea_long_all <- do.call(rbind, fgsea_rows)
  fgsea_long_all <- fgsea_long_all[order(fgsea_long_all$padj,
                                         fgsea_long_all$pval), ]
  write.csv(fgsea_long_all,
            file.path(SUMMARY_DIR, "FGSEA_summary_all_clusters.csv"),
            row.names=FALSE)
  cat("Saved: ", file.path(SUMMARY_DIR, "FGSEA_summary_all_clusters.csv"), "\n", sep="")
}

## ============================================================
## 9) GLOBAL composition block (one-shot, cross-cluster)
##    - cell count / proportion tables
##    - stacked bar plots (counts + proportions)
##    - quasi-binomial GLM across clusters
##    - propeller concordance (logit + asin)
## ============================================================

cat("\n==== Global composition block ====\n")

# -------- 9.1) Build combined metadata across samples --------
safe_chr <- function(v) {
  if (is.data.frame(v)) v <- v[[1]]
  if (is.list(v)) {
    v <- vapply(v, function(x) {
      if (is.null(x) || length(x) == 0) return(NA_character_)
      as.character(x[[1]])
    }, FUN.VALUE = character(1))
  } else v <- as.character(v)
  trimws(v)
}

md_list <- lapply(names(objs), function(nm) {
  x <- objs[[nm]]
  cl <- safe_chr(x@meta.data[[celltype_col]])
  data.frame(sample = rep(nm, length(cl)),
             cluster = cl,
             stringsAsFactors = FALSE)
})
md_all <- do.call(rbind, md_list)
md_all$sample  <- trimws(as.character(md_all$sample))
md_all$cluster <- trimws(as.character(md_all$cluster))
md_all <- md_all[!is.na(md_all$cluster) & nzchar(md_all$cluster), , drop = FALSE]

# Relabel non-neuronal cluster names to the clean ids used everywhere else
# (run_status / DE / FGSEA, pop_<id>.js, the website). Neuronal labels already
# equal their id ("e9"); only the cell-type-named non-neuronal labels differ
# ("Ast-1" -> "Ast1"). Keeps the composition/DA tables joinable to population ids.
.raw2id <- setNames(vapply(nonneuronal_map, `[[`, character(1), "id"),
                    vapply(nonneuronal_map, `[[`, character(1), "meta"))
.lc <- tolower(md_all$cluster)
.hit <- .lc %in% names(.raw2id)
if (any(.hit)) md_all$cluster[.hit] <- unname(.raw2id[.lc[.hit]])

cat("Combined metadata rows: ", nrow(md_all),
    " | samples: ", length(unique(md_all$sample)),
    " | clusters: ", length(unique(md_all$cluster)), "\n", sep="")

# -------- 9.2) Count / proportion tables --------
tab <- table(md_all$cluster, md_all$sample)

counts_long <- as.data.frame(tab, stringsAsFactors = FALSE)
colnames(counts_long) <- c("cluster", "sample", "n_cells")
counts_long <- counts_long[counts_long$n_cells > 0, , drop = FALSE]
counts_long <- counts_long[order(counts_long$sample, counts_long$cluster), , drop = FALSE]

counts_wide <- data.frame(
  cluster = rownames(tab),
  as.data.frame.matrix(tab, stringsAsFactors = FALSE),
  check.names = FALSE)
rownames(counts_wide) <- NULL
counts_wide <- counts_wide[order(counts_wide$cluster), , drop = FALSE]

# proportions
sample_totals <- aggregate(n_cells ~ sample, data = counts_long, FUN = sum)
colnames(sample_totals)[2] <- "total_cells_in_sample"
props_long <- merge(counts_long, sample_totals, by = "sample", all.x = TRUE, sort = FALSE)
props_long$pct_of_sample <- 100 * props_long$n_cells / props_long$total_cells_in_sample
props_long <- props_long[order(props_long$sample, -props_long$pct_of_sample,
                               props_long$cluster), , drop = FALSE]

props_mat <- xtabs(pct_of_sample ~ cluster + sample, data = props_long)
props_wide <- data.frame(
  cluster = rownames(props_mat),
  as.data.frame.matrix(props_mat, stringsAsFactors = FALSE),
  check.names = FALSE)
rownames(props_wide) <- NULL
props_wide <- props_wide[order(props_wide$cluster), , drop = FALSE]

write.csv(counts_long, file.path(COMP_DIR, "cell_counts_by_sample_and_cluster_long.csv"),
          row.names = FALSE)
write.csv(counts_wide, file.path(COMP_DIR, "cell_counts_by_sample_and_cluster_wide.csv"),
          row.names = FALSE)
write.csv(props_long,  file.path(COMP_DIR, "cell_proportions_by_sample_and_cluster_long.csv"),
          row.names = FALSE)
write.csv(props_wide,  file.path(COMP_DIR, "cell_proportions_by_sample_and_cluster_wide.csv"),
          row.names = FALSE)
cat("Saved composition count/proportion tables to ", COMP_DIR, "\n", sep="")

# -------- 9.3) Stacked bar plots (proportions + counts) --------
sample_order <- names(objs)
if (is.null(sample_order) || length(sample_order) == 0)
  sample_order <- sort(unique(props_long$sample))

cluster_totals <- aggregate(n_cells ~ cluster, data = counts_long, FUN = sum)
cluster_totals <- cluster_totals[order(-cluster_totals$n_cells), , drop = FALSE]
cluster_order <- cluster_totals$cluster

plot_prop <- props_long
plot_prop$sample  <- factor(plot_prop$sample,  levels = sample_order)
plot_prop$cluster <- factor(plot_prop$cluster, levels = cluster_order)

p_prop <- ggplot(plot_prop, aes(x = sample, y = pct_of_sample, fill = cluster)) +
  geom_col(width = 0.75, color = "white", linewidth = 0.2) +
  scale_y_continuous(limits = c(0, 100), breaks = seq(0, 100, 20),
                     labels = function(x) paste0(x, "%"), expand = c(0, 0)) +
  labs(title = paste0("Cell-type composition by sample (", celltype_col, ")"),
       x = NULL, y = "Percent of cells") +
  theme_classic(base_size = 12) +
  theme(axis.text.x = element_text(angle = 30, hjust = 1, face = "bold"),
        plot.title = element_text(face = "bold"),
        legend.title = element_blank(), legend.position = "right")
ggsave(file.path(COMP_DIR, "CellComposition_Proportions.png"),
       p_prop, width = 8.5, height = 5.5, dpi = 300, bg = "white")
ggsave(file.path(COMP_DIR, "CellComposition_Proportions.pdf"),
       p_prop, width = 8.5, height = 5.5)

plot_count <- counts_long
plot_count$sample  <- factor(plot_count$sample,  levels = sample_order)
plot_count$cluster <- factor(plot_count$cluster, levels = cluster_order)

p_count <- ggplot(plot_count, aes(x = sample, y = n_cells, fill = cluster)) +
  geom_col(width = 0.75, color = "white", linewidth = 0.2) +
  scale_y_continuous(expand = c(0, 0), labels = scales::comma) +
  labs(title = paste0("Cell counts by sample (", celltype_col, ")"),
       x = NULL, y = "Number of cells") +
  theme_classic(base_size = 12) +
  theme(axis.text.x = element_text(angle = 30, hjust = 1, face = "bold"),
        plot.title = element_text(face = "bold"),
        legend.title = element_blank(), legend.position = "right")
ggsave(file.path(COMP_DIR, "CellCounts_BySample.png"),
       p_count, width = 8.5, height = 5.5, dpi = 300, bg = "white")
ggsave(file.path(COMP_DIR, "CellCounts_BySample.pdf"),
       p_count, width = 8.5, height = 5.5)

# -------- 9.4) Quasi-binomial GLM across clusters --------
sample_totals2 <- aggregate(n_cells ~ sample, data = counts_long, FUN = sum)
colnames(sample_totals2)[2] <- "total_cells"
sample_meta <- data.frame(
  sample      = sample_totals2$sample,
  total_cells = sample_totals2$total_cells,
  group       = unname(cond_map[sample_totals2$sample]),
  stringsAsFactors = FALSE)
sample_meta <- sample_meta[!is.na(sample_meta$group), , drop = FALSE]
sample_meta$group <- factor(sample_meta$group, levels = c("Normal", "Obese"))

if (nrow(sample_meta) >= 4) {
  all_clusters2 <- sort(unique(counts_long$cluster))
  grid_df <- expand.grid(cluster = all_clusters2,
                         sample  = sample_meta$sample,
                         stringsAsFactors = FALSE)
  count_full <- merge(grid_df, counts_long[, c("cluster","sample","n_cells")],
                      by = c("cluster","sample"), all.x = TRUE, sort = FALSE)
  count_full$n_cells[is.na(count_full$n_cells)] <- 0L
  count_full <- merge(count_full, sample_meta, by = "sample",
                      all.x = TRUE, sort = FALSE)
  count_full$prop <- count_full$n_cells / count_full$total_cells

  test_one_cluster_qb <- function(df_one) {
    df_one <- df_one[is.finite(df_one$n_cells) & is.finite(df_one$total_cells), , drop = FALSE]
    if (nrow(df_one) < 4) return(NULL)
    df_one$n_cells     <- pmax(0, pmin(df_one$n_cells, df_one$total_cells))
    df_one$other_cells <- df_one$total_cells - df_one$n_cells

    mpN <- mean(df_one$prop[df_one$group == "Normal"], na.rm = TRUE)
    mpO <- mean(df_one$prop[df_one$group == "Obese"],  na.rm = TRUE)

    if (all(df_one$n_cells == 0) || all(df_one$other_cells == 0)) {
      return(data.frame(p_value=NA_real_, beta_obese=NA_real_, se=NA_real_,
                        OR_obese_vs_normal=NA_real_,
                        mean_prop_normal=mpN, mean_prop_obese=mpO,
                        stringsAsFactors=FALSE))
    }
    fit <- tryCatch(
      glm(cbind(n_cells, other_cells) ~ group, data=df_one, family=quasibinomial()),
      error=function(e) NULL)
    if (is.null(fit)) {
      return(data.frame(p_value=NA_real_, beta_obese=NA_real_, se=NA_real_,
                        OR_obese_vs_normal=NA_real_,
                        mean_prop_normal=mpN, mean_prop_obese=mpO,
                        stringsAsFactors=FALSE))
    }
    co <- summary(fit)$coefficients
    rn <- rownames(co)
    idx <- which(rn == "groupObese"); if (!length(idx)) idx <- grep("^group", rn)
    if (!length(idx)) {
      return(data.frame(p_value=NA_real_, beta_obese=NA_real_, se=NA_real_,
                        OR_obese_vs_normal=NA_real_,
                        mean_prop_normal=mpN, mean_prop_obese=mpO,
                        stringsAsFactors=FALSE))
    }
    data.frame(
      p_value            = unname(co[idx[1], "Pr(>|t|)"]),
      beta_obese         = unname(co[idx[1], "Estimate"]),
      se                 = unname(co[idx[1], "Std. Error"]),
      OR_obese_vs_normal = exp(unname(co[idx[1], "Estimate"])),
      mean_prop_normal   = mpN,
      mean_prop_obese    = mpO,
      stringsAsFactors   = FALSE)
  }

  cluster_list <- split(count_full, count_full$cluster)
  da_results <- do.call(rbind, lapply(names(cluster_list), function(cl) {
    out <- test_one_cluster_qb(cluster_list[[cl]])
    if (is.null(out)) return(NULL)
    out$cluster   <- cl
    out$n_samples <- nrow(cluster_list[[cl]])
    out$mean_pct_normal              <- 100 * out$mean_prop_normal
    out$mean_pct_obese               <- 100 * out$mean_prop_obese
    out$delta_pct_obese_minus_normal <- out$mean_pct_obese - out$mean_pct_normal
    out
  }))

  if (!is.null(da_results) && nrow(da_results)) {
    da_results$FDR <- p.adjust(da_results$p_value, method = "BH")
    da_results <- da_results[, c("cluster","n_samples",
                                 "mean_pct_normal","mean_pct_obese",
                                 "delta_pct_obese_minus_normal",
                                 "OR_obese_vs_normal","beta_obese","se",
                                 "p_value","FDR")]
    da_results <- da_results[order(da_results$p_value, da_results$FDR, na.last=TRUE), ]
    write.csv(da_results,
              file.path(COMP_DIR, "DA_composition_quasibinomial_all_clusters.csv"),
              row.names=FALSE)
    cat("Saved: ",
        file.path(COMP_DIR, "DA_composition_quasibinomial_all_clusters.csv"), "\n", sep="")
  } else {
    message("Quasi-binomial GLM produced no results.")
    da_results <- NULL
  }
} else {
  message("Too few samples with cond_map mapping for composition testing.")
  da_results <- NULL
}

# -------- 9.5) Propeller concordance (logit + asin) --------
propeller_out <- tryCatch({
  if (!requireNamespace("speckle", quietly = TRUE)) {
    if (!requireNamespace("BiocManager", quietly = TRUE))
      install.packages("BiocManager", type = "binary")
    BiocManager::install("speckle", ask = FALSE, update = FALSE, type = "binary")
  }
  suppressPackageStartupMessages({ library(speckle); library(limma) })

  prop_input <- md_all
  prop_input$group <- unname(cond_map[prop_input$sample])
  prop_input <- prop_input[!is.na(prop_input$group), , drop = FALSE]
  prop_input$group <- factor(prop_input$group, levels = c("Normal", "Obese"))

  prop_logit <- speckle::propeller(clusters = prop_input$cluster,
                                   sample   = prop_input$sample,
                                   group    = prop_input$group,
                                   transform = "logit")
  prop_asin  <- speckle::propeller(clusters = prop_input$cluster,
                                   sample   = prop_input$sample,
                                   group    = prop_input$group,
                                   transform = "asin")

  to_df <- function(x, tag) {
    df <- as.data.frame(x)
    df$cluster <- rownames(df); rownames(df) <- NULL
    keep <- c("cluster","PropMean.Normal","PropMean.Obese",
              "PropRatio","Tstatistic","P.Value","FDR")
    keep <- keep[keep %in% colnames(df)]
    df <- df[, keep, drop = FALSE]
    new_names <- colnames(df)
    for (j in seq_along(new_names)) {
      if (new_names[j] != "cluster") new_names[j] <- paste0(tag, "_", new_names[j])
    }
    colnames(df) <- new_names
    df
  }

  pl <- to_df(prop_logit, "propeller_logit")
  pa <- to_df(prop_asin,  "propeller_asin")
  merged <- merge(pl, pa, by = "cluster", all = TRUE)

  if (!is.null(da_results)) {
    qb <- da_results[, c("cluster","p_value","FDR",
                         "delta_pct_obese_minus_normal","OR_obese_vs_normal")]
    colnames(qb) <- c("cluster","quasibinom_P.Value","quasibinom_FDR",
                      "quasibinom_delta_pct","quasibinom_OR")
    merged <- merge(merged, qb, by = "cluster", all = TRUE)
  }

  concord_fdr <- 0.1
  qb_sig <- if ("quasibinom_FDR" %in% colnames(merged))
              !is.na(merged$quasibinom_FDR) & merged$quasibinom_FDR <= concord_fdr
            else rep(FALSE, nrow(merged))
  pl_sig <- !is.na(merged$propeller_logit_FDR) & merged$propeller_logit_FDR <= concord_fdr
  pa_sig <- !is.na(merged$propeller_asin_FDR)  & merged$propeller_asin_FDR  <= concord_fdr
  merged$n_methods_sig_at_FDR0.1 <- qb_sig + pl_sig + pa_sig
  merged$concordant_at_FDR0.1    <- merged$n_methods_sig_at_FDR0.1 %in% c(0, 3)
  merged <- merged[order(merged$propeller_logit_FDR, merged$cluster, na.last=TRUE), ,
                   drop=FALSE]

  write.csv(merged,
            file.path(COMP_DIR, "DA_composition_propeller_vs_quasibinomial.csv"),
            row.names=FALSE)
  cat("Saved: ",
      file.path(COMP_DIR, "DA_composition_propeller_vs_quasibinomial.csv"), "\n", sep="")

  n_disc <- sum(!merged$concordant_at_FDR0.1, na.rm = TRUE)
  if (n_disc > 0) {
    warning(n_disc,
            " cluster(s) show discordant significance calls between quasi-binomial ",
            "and propeller at FDR <= 0.1. Inspect ",
            file.path(COMP_DIR, "DA_composition_propeller_vs_quasibinomial.csv"),
            " before using composition claims in figures.")
  }
  merged
}, error = function(e) {
  message("Propeller concordance step failed: ", conditionMessage(e))
  message("Skipping propeller and proceeding with quasi-binomial results only.")
  NULL
})

cat("\n==========================================================\n")
cat("DONE. Output tree under: ", normalizePath(RESULTS_ROOT, mustWork=FALSE), "\n", sep="")
cat("  Per-cluster:   ", RESULTS_ROOT, "/<code>__<label>/{de,fgsea,qc,plots}\n", sep="")
cat("  Cross-cluster: ", GLOBAL_DIR,   "/{composition,summary}\n", sep="")
cat("==========================================================\n")
