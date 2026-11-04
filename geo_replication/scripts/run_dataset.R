#!/usr/bin/env Rscript
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
# Usage:  Rscript scripts/run_dataset.R <DATASET_ID>
# =============================================================================
suppressPackageStartupMessages({
  library(edgeR); library(limma); library(fgsea); library(msigdbr); library(AnnotationDbi)
})

PANEL <- c("IGFBP2","IGFBP5","IGFBP6","IGFBP7","IGF1R","IRS2","IGF1","INSR","PAPPA",
           "IGFBP1","IGFBP3","IGFBP4")

get_script_dir <- function() {
  a <- commandArgs(FALSE); f <- grep("^--file=", a, value=TRUE)
  if (length(f)) return(dirname(normalizePath(sub("^--file=", "", f[1]))))
  getwd()
}
ROOT <- normalizePath(file.path(get_script_dir(), ".."))   # .../geo_replication

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 1) stop("usage: run_dataset.R <DATASET_ID>")
id <- args[1]

cfg <- read.delim(file.path(ROOT, "config", "datasets.tsv"), stringsAsFactors = FALSE)
r <- cfg[cfg$id == id, ]
if (nrow(r) != 1) stop(sprintf("dataset id '%s' not found in config/datasets.tsv", id))
cat(sprintf("[%s] %s | id_type=%s | input_kind=%s\n", id, r$organism, r$id_type, r$input_kind))

# ---- sample sheet ----------------------------------------------------------
ss <- read.delim(file.path(ROOT, r$samplesheet), stringsAsFactors = FALSE)
ss <- ss[ss$group %in% c("control", "case"), , drop = FALSE]
ss$group <- factor(ss$group, levels = c("control", "case"))
if (nlevels(droplevels(ss$group)) < 2) stop("samplesheet must contain both 'control' and 'case'")
cat(sprintf("  groups: control=%d  case=%d\n", sum(ss$group=="control"), sum(ss$group=="case")))

# ---- load expression (auto delimiter; series-matrix aware) -----------------
inpath <- file.path(ROOT, r$input_path)
if (!file.exists(inpath))
  stop(sprintf("input not found: %s\n  (status=%s — fetch it first)", inpath, r$status))

read_expr <- function(path) {
  if (grepl("series_matrix", path)) {
    L <- readLines(gzfile(path))
    b <- grep("!series_matrix_table_begin", L); e <- grep("!series_matrix_table_end", L)
    if (!length(b) || !length(e)) stop("series_matrix table markers not found")
    return(read.delim(text = L[(b+1):(e-1)], check.names = FALSE, stringsAsFactors = FALSE))
  }
  con <- if (grepl("\\.gz$", path)) gzfile(path) else file(path)
  first <- readLines(con, n = 1); close(con)
  sep <- if (grepl("\t", first)) "\t" else if (grepl(",", first)) "," else ""  # tab, comma, or whitespace
  read.delim(if (grepl("\\.gz$", path)) gzfile(path) else path,
             sep = sep, check.names = FALSE, stringsAsFactors = FALSE)
}
df <- read_expr(inpath)

# gene-ID column: config id_col if present, else first column
idcol <- r$id_col
ids_raw <- if (!is.na(idcol) && nzchar(idcol) && idcol != "NA" && idcol %in% colnames(df)) df[[idcol]] else df[[1]]
ids_raw <- as.character(ids_raw)
.bad <- is.na(ids_raw) | ids_raw == "" | ids_raw == "NA"
if (any(.bad)) ids_raw[.bad] <- paste0("UNANNOT_", which(.bad))   # no NA/empty rownames

miss <- setdiff(ss$sample, colnames(df))
if (length(miss))
  stop(sprintf("samplesheet samples not in matrix columns:\n  missing: %s\n  available: %s",
               paste(miss, collapse=", "), paste(head(colnames(df), 40), collapse=", ")))
mat <- as.matrix(df[, ss$sample, drop = FALSE])
mat <- matrix(as.numeric(mat), nrow = nrow(mat), dimnames = list(ids_raw, ss$sample))

# ---- gene-ID harmonization to SYMBOL --------------------------------------
ids <- rownames(mat); idt <- toupper(r$id_type); sym <- ids
has_map <- !is.na(r$id_map) && nzchar(r$id_map) && r$id_map != "NA"
if (idt == "ENSEMBL" && r$organism == "Mus musculus") {
  suppressPackageStartupMessages(library(org.Mm.eg.db))
  m <- mapIds(org.Mm.eg.db, keys = sub("\\..*", "", ids), keytype = "ENSEMBL", column = "SYMBOL", multiVals = "first")
  sym <- ifelse(is.na(m), ids, unname(m))
} else if (idt == "ENSEMBL" && r$organism == "Rattus norvegicus") {
  suppressPackageStartupMessages(library(org.Rn.eg.db))
  m <- mapIds(org.Rn.eg.db, keys = sub("\\..*", "", ids), keytype = "ENSEMBL", column = "SYMBOL", multiVals = "first")
  sym <- ifelse(is.na(m), ids, unname(m))
} else if (idt == "ENSEMBL" && r$organism == "Homo sapiens") {
  # Keep human Ensembl harmonization on the same pinned MSigDB authority used
  # downstream for enrichment; this environment intentionally has no separate
  # org.Hs.eg.db installation. Unmapped ids remain local-only identifiers and
  # are filtered out of the public symbol projection by the bundle builder.
  hs <- msigdbr(species = "Homo sapiens")
  hs <- hs[!is.na(hs$ensembl_gene) & nzchar(hs$ensembl_gene) &
           !is.na(hs$gene_symbol) & nzchar(hs$gene_symbol),
           c("ensembl_gene", "gene_symbol")]
  hs <- hs[!duplicated(hs$ensembl_gene), ]
  m <- hs$gene_symbol[match(sub("\\..*", "", ids), hs$ensembl_gene)]
  sym <- ifelse(is.na(m), ids, m)
} else if (idt == "ENSEMBL" && r$organism == "Macaca mulatta") {
  # Bioconductor has no maintained org.Mmu.eg.db package. msigdbr's target-
  # species table exposes the current macaque Ensembl-gene to symbol map used
  # by the same pathway collections below, keeping identifier harmonization and
  # enrichment on one pinned authority. Unmapped atlas-era ids remain ids and
  # are excluded from symbol-keyed bundles/pathways rather than guessed.
  mmu <- msigdbr(species = "Macaca mulatta")
  mmu <- mmu[!is.na(mmu$ensembl_gene) & nzchar(mmu$ensembl_gene) &
             !is.na(mmu$gene_symbol) & nzchar(mmu$gene_symbol),
             c("ensembl_gene", "gene_symbol")]
  mmu <- mmu[!duplicated(mmu$ensembl_gene), ]
  m <- mmu$gene_symbol[match(sub("\\..*", "", ids), mmu$ensembl_gene)]
  sym <- ifelse(is.na(m), ids, m)
} else if (idt == "ENTREZID" && r$organism == "Mus musculus") {
  suppressPackageStartupMessages(library(org.Mm.eg.db))
  m <- mapIds(org.Mm.eg.db, keys = as.character(ids), keytype = "ENTREZID", column = "SYMBOL", multiVals = "first")
  sym <- ifelse(is.na(m), ids, unname(m))
} else if (idt == "ENTREZID" && r$organism == "Rattus norvegicus") {
  suppressPackageStartupMessages(library(org.Rn.eg.db))
  m <- mapIds(org.Rn.eg.db, keys = as.character(ids), keytype = "ENTREZID", column = "SYMBOL", multiVals = "first")
  sym <- ifelse(is.na(m), ids, unname(m))
} else if (has_map) {
  pm <- read.delim(file.path(ROOT, r$id_map), header = FALSE, col.names = c("probe","symbol"), stringsAsFactors = FALSE)
  m <- pm$symbol[match(ids, pm$probe)]
  sym <- ifelse(is.na(m) | m == "", ids, m)
}  # else SYMBOL passthrough

# ---- design ----------------------------------------------------------------
bv <- r$batch_var
use_batch <- !is.na(bv) && nzchar(bv) && bv != "NA" && bv %in% colnames(ss) && length(unique(ss[[bv]])) > 1
if (use_batch) {
  ss$.batch <- factor(ss[[bv]]); design <- model.matrix(~ .batch + group, data = ss)
} else {
  design <- model.matrix(~ group, data = ss)
}
coef <- "groupcase"
cat(sprintf("  design: %s\n", paste(colnames(design), collapse=" + ")))

# ---- DE (front-end by input kind) -----------------------------------------
if (r$input_kind == "counts") {
  y <- DGEList(counts = mat)
  keep <- filterByExpr(y, design); y <- y[keep, , keep.lib.sizes = FALSE]
  y <- calcNormFactors(y)                       # TMM
  y <- estimateDisp(y, design)
  fit <- glmQLFit(y, design)
  qlf <- glmQLFTest(fit, coef = coef)
  tt <- topTags(qlf, n = Inf)$table
  de <- data.frame(id = rownames(tt), symbol = sym[match(rownames(tt), ids)],
                   logFC = tt$logFC, stat = sign(tt$logFC) * tt$F,
                   pvalue = tt$PValue, padj = tt$FDR, method = "edgeR-QL", stringsAsFactors = FALSE)
} else {
  # matrix path: drop constant / floored (undetected) rows — the limma analogue of filterByExpr
  rv <- apply(mat, 1, var)
  mat <- mat[is.finite(rv) & rv > 1e-8, , drop = FALSE]
  cat(sprintf("  filtered to %d expressed (non-constant) genes\n", nrow(mat)))
  fit <- eBayes(lmFit(mat, design))
  tt <- topTable(fit, coef = coef, number = Inf, sort.by = "none")
  de <- data.frame(id = rownames(mat), symbol = sym[match(rownames(mat), ids)],
                   logFC = tt$logFC, stat = tt$t,
                   pvalue = tt$P.Value, padj = tt$adj.P.Val, method = "limma", stringsAsFactors = FALSE)
}
de <- de[order(-abs(de$stat)), ]
de <- de[!duplicated(de$symbol), ]
de$direction <- ifelse(de$logFC < 0, "down", "up")

procdir <- file.path(ROOT, r$dir, "processed"); dir.create(procdir, showWarnings = FALSE, recursive = TRUE)
write.table(de, file.path(procdir, paste0(id, "_DE.tsv")), sep = "\t", quote = FALSE, row.names = FALSE)
cat(sprintf("  DE: %d genes -> processed/%s_DE.tsv\n", nrow(de), id))

# ---- panel readout ---------------------------------------------------------
pan <- de[toupper(de$symbol) %in% PANEL, c("symbol","logFC","stat","pvalue","padj","direction")]
pan$dataset <- rep(id, nrow(pan))
write.table(pan, file.path(procdir, paste0(id, "_panel.tsv")), sep = "\t", quote = FALSE, row.names = FALSE)
cat("  panel readout:\n"); if (nrow(pan)) print(pan[order(pan$logFC), ], row.names = FALSE) else cat("    (no panel genes detected)\n")

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
write.table(sel, file.path(procdir, paste0(id, "_fgsea.tsv")), sep = "\t", quote = FALSE, row.names = FALSE)
cat("  fgsea (focal pathways):\n")
if (nrow(sel)) print(sel[, c("pathway","NES","pval","padj","size")], row.names = FALSE) else cat("    (focal pathways not found)\n")
cat(sprintf("[%s] done.\n", id))
