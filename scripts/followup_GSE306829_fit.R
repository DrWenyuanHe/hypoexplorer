#!/usr/bin/env Rscript
# Evidence-only sensitivity. See GSE306829/PREDECLARATION.md before running.
suppressPackageStartupMessages(library(DESeq2))
args <- commandArgs(trailingOnly = TRUE)
root <- if (length(args)) normalizePath(args[[1]]) else normalizePath(".")
ds <- file.path(root, "geo_replication/datasets/GSE306829_mmus_mpoa_pnoc_bactrap")
out <- file.path(root, "data/author-validation/continued-sources/five-dataset-followup-2026-09-04/GSE306829")
stopifnot(file.exists(file.path(out, "PREDECLARATION.md")))
source_path <- file.path(ds, "raw/GSE306829_IPvsInput_deg.txt.gz")
source_hash <- tolower(trimws(system2("certutil", c("-hashfile", shQuote(source_path), "SHA256"), stdout = TRUE)))
stopifnot("2f8a9797e72032e1d32776d8f766e4a170c3e34be7f1c5a0aef8ed0cb9773a74" %in% source_hash)
a <- read.delim(gzfile(source_path), check.names = FALSE)
ss <- read.delim(file.path(ds, "metadata/GSE306829_samplesheet.tsv"), check.names = FALSE)
counts <- as.matrix(a[, ss$source_column]); rownames(counts) <- a$gene_id; colnames(counts) <- ss$sample
stopifnot(nrow(counts) == 27884L, ncol(counts) == 6L, !anyDuplicated(rownames(counts)),
          all(is.finite(counts)), all(counts >= 0), all(counts == round(counts)),
          identical(ss$pair, rep(paste0("pool", 1:3), 2)), all(ss$pooled_animals == 3))
storage.mode(counts) <- "integer"
prepared <- read.delim(gzfile(file.path(ds, "raw/GSE306829_PNOC_IP_vs_input_counts.tsv.gz")), check.names = FALSE)
stopifnot(identical(prepared$gene_id, rownames(counts)), identical(names(prepared)[-1], colnames(counts)),
          all(as.matrix(prepared[-1]) == counts))
coldata <- data.frame(row.names = ss$sample, pair = factor(ss$pair),
                      fraction = factor(ss$group, levels = c("control", "case")))
options(digits = 17)
write_tsv <- function(x, name) write.table(x, file.path(out, name), sep = "\t", quote = FALSE,
                                         row.names = FALSE, na = "NA", eol = "\n")
suppressPackageStartupMessages(library(edgeR))
local <- read.delim(file.path(ds, "processed/GSE306829_DE.tsv"), check.names = FALSE)
edge_keep <- filterByExpr(DGEList(counts = counts), model.matrix(~ pair + fraction, coldata))
stopifnot(all(local$id %in% rownames(counts)[edge_keep]))
write_tsv(data.frame(gene_id = rownames(counts), retained_by_edgeR_filter = edge_keep,
                     in_explorer = rownames(counts) %in% local$id), "coverage-audit.tsv")
if (length(args) > 1 && args[[2]] == "coverage-only") quit(save = "no")
metadata <- list()
for (mode in c("paired", "group_only")) {
  cat("Fitting", mode, "\n")
  formula <- if (mode == "paired") ~ pair + fraction else ~ fraction
  dds <- DESeqDataSetFromMatrix(counts, coldata, design = formula)
  dds <- DESeq(dds, test = "Wald", fitType = "parametric", sfType = "ratio", betaPrior = FALSE,
               minReplicatesForReplace = 7, parallel = FALSE, quiet = TRUE)
  res <- results(dds, contrast = c("fraction", "case", "control"), alpha = 0.05)
  nofilter <- results(dds, contrast = c("fraction", "case", "control"), independentFiltering = FALSE,
                      alpha = 0.05)
  default_alpha <- results(dds, contrast = c("fraction", "case", "control"), alpha = 0.1)
  table <- data.frame(gene_id = rownames(res), as.data.frame(res),
                      padj_no_independent_filter = nofilter$padj,
                      padj_default_alpha_0_1 = default_alpha$padj, check.names = FALSE)
  write_tsv(table, paste0(mode, ".deseq2.tsv"))
  sf <- sizeFactors(dds)
  inferred <- vapply(ss$sample, function(s) median(a[[paste0(s, "_count")]] / a[[s]], na.rm = TRUE), numeric(1))
  # 0/0 becomes NaN and is omitted, never treated as an observed ratio.
  norm <- data.frame(sample = names(sf), size_factor = as.numeric(sf), author_inferred_size_factor = inferred,
                     maximum_normalized_count_delta = vapply(seq_along(sf), function(i)
                       max(abs(counts[, i] / sf[i] - a[[ss$sample[i]]])), numeric(1)))
  write_tsv(norm, paste0(mode, ".normalization.tsv"))
  metadata[[mode]] <- c(paste("design", deparse(formula)), paste("DESeq2", packageVersion("DESeq2")),
                        paste("filterThreshold", metadata(res)$filterThreshold),
                        paste("filterTheta", metadata(res)$filterTheta),
                        paste("defaultAlphaFilterThreshold", metadata(default_alpha)$filterThreshold),
                        paste("defaultAlphaFilterTheta", metadata(default_alpha)$filterTheta),
                        paste("dispersionTrendType", attr(dispersionFunction(dds), "fitType")),
                        paste("fittedRows", nrow(dds)))
}
writeLines(c(unlist(metadata), capture.output(sessionInfo())), file.path(out, "fit-session.txt"))
