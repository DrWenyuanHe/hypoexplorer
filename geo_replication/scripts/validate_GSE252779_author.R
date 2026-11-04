#!/usr/bin/env Rscript

suppressPackageStartupMessages({
  library(DESeq2)
  library(edgeR)
  library(readxl)
})

get_script_dir <- function() {
  args <- commandArgs(FALSE)
  file_arg <- grep("^--file=", args, value = TRUE)
  if (length(file_arg)) return(dirname(normalizePath(sub("^--file=", "", file_arg[1]))))
  getwd()
}

ROOT <- normalizePath(file.path(get_script_dir(), ".."))
DS <- file.path(ROOT, "datasets", "GSE252779_mmus_hypo_celastrol")
COUNT_BOOK <- file.path(DS, "raw", "GSE252779_Gene-count.xlsx")
AUTHOR_BOOK <- file.path(DS, "raw", "GSE252779_Expression_data.xlsx")

stopifnot(file.exists(COUNT_BOOK), file.exists(AUTHOR_BOOK))

normalized <- as.data.frame(
  read_excel(COUNT_BOOK, sheet = "Cuff-gene-count", .name_repair = "minimal"),
  check.names = FALSE
)
counts <- as.data.frame(
  read_excel(COUNT_BOOK, sheet = "STRA-gee-count", .name_repair = "minimal"),
  check.names = FALSE
)

selected <- c(
  paste0("Hypo-Veh-", 1:4),
  paste0("Hypo-CS-", 1:4)
)
missing_columns <- setdiff(c("Gene_ID", selected), colnames(counts))
if (length(missing_columns)) {
  stop(sprintf("missing expected columns: %s", paste(missing_columns, collapse = ", ")))
}

normalized_matrix <- as.matrix(normalized[, selected, drop = FALSE])
count_matrix <- as.matrix(counts[, selected, drop = FALSE])
storage.mode(normalized_matrix) <- "double"
storage.mode(count_matrix) <- "double"

cat(sprintf(
  "Cuff-gene-count: %.2f%% integral, sums %.0f-%.0f\n",
  100 * mean(normalized_matrix == round(normalized_matrix)),
  min(colSums(normalized_matrix)),
  max(colSums(normalized_matrix))
))
cat(sprintf(
  "STRA-gee-count: %.2f%% integral, sums %.0f-%.0f\n",
  100 * mean(count_matrix == round(count_matrix)),
  min(colSums(count_matrix)),
  max(colSums(count_matrix))
))

if (mean(count_matrix == round(count_matrix)) != 1) stop("STRA sheet is not integer counts")
if (anyNA(count_matrix) || any(count_matrix < 0)) stop("invalid count values")

symbols <- as.character(counts$Gene_ID)
valid <- !is.na(symbols) & nzchar(symbols)
count_matrix <- count_matrix[valid, , drop = FALSE]
symbols <- symbols[valid]
count_matrix <- rowsum(count_matrix, group = symbols, reorder = FALSE)

sample_data <- data.frame(
  group = factor(rep(c("control", "case"), each = 4), levels = c("control", "case"))
)
rownames(sample_data) <- selected
design <- model.matrix(~ group, sample_data)

y <- DGEList(counts = count_matrix)
keep <- filterByExpr(y, design)
y <- y[keep, , keep.lib.sizes = FALSE]
y <- calcNormFactors(y)
y <- estimateDisp(y, design)
fit <- glmQLFit(y, design)
test <- glmQLFTest(fit, coef = "groupcase")
local <- topTags(test, n = Inf, sort.by = "none")$table
local$symbol <- rownames(local)

author <- as.data.frame(
  read_excel(AUTHOR_BOOK, sheet = "PF_v_Veh.deseq", .name_repair = "minimal"),
  check.names = FALSE
)
author$id <- as.character(author$id)
author$log2FoldChange <- as.numeric(author$log2FoldChange)
author$padj <- as.numeric(author$padj)

joined <- merge(
  local[, c("symbol", "logFC", "FDR")],
  author[, c("id", "log2FoldChange", "padj")],
  by.x = "symbol",
  by.y = "id"
)
joined <- joined[is.finite(joined$logFC) & is.finite(joined$log2FoldChange), ]

local_sig <- joined$FDR < 0.05
author_sig <- !is.na(joined$padj) & joined$padj < 0.05
both_sig <- local_sig & author_sig
union_sig <- local_sig | author_sig

metrics <- c(
  local_tests = nrow(local),
  author_tests = nrow(author),
  joined = nrow(joined),
  pearson_logfc = cor(joined$logFC, joined$log2FoldChange, method = "pearson"),
  spearman_logfc = cor(joined$logFC, joined$log2FoldChange, method = "spearman"),
  median_abs_logfc_delta = median(abs(joined$logFC - joined$log2FoldChange)),
  local_fdr_005 = sum(local_sig),
  author_fdr_005 = sum(author_sig),
  shared_fdr_005 = sum(both_sig),
  fdr_jaccard = sum(both_sig) / sum(union_sig),
  author_sig_direction_agreement = mean(
    sign(joined$logFC[author_sig]) == sign(joined$log2FoldChange[author_sig])
  )
)

print(metrics)

# The five deposited result-sheet names do not behave like their literal labels.
# Fit all four deposited arms once and compare every estimable pair to every
# author sheet so the actual author estimands can be identified empirically.
all_columns <- c(
  paste0("Hypo-Veh-", 1:4),
  paste0("Hypo-PF-", 1:4),
  paste0("Hypo-CS-", 1:4),
  paste0("Hypo-PF/CS-", 1:4)
)
all_counts <- as.matrix(counts[, all_columns, drop = FALSE])
storage.mode(all_counts) <- "double"
all_counts <- all_counts[valid, , drop = FALSE]
all_counts <- rowsum(all_counts, group = symbols, reorder = FALSE)

all_group <- factor(rep(c("Veh", "PF", "CS", "PFCS"), each = 4))
all_design <- model.matrix(~ 0 + all_group)
colnames(all_design) <- levels(all_group)
all_y <- DGEList(counts = all_counts)
all_keep <- filterByExpr(all_y, all_design)
all_y <- all_y[all_keep, , keep.lib.sizes = FALSE]
all_y <- calcNormFactors(all_y)
all_y <- estimateDisp(all_y, all_design)
all_fit <- glmQLFit(all_y, all_design)

pair_specs <- list(
  CS_minus_Veh = c(CS = 1, Veh = -1),
  PF_minus_Veh = c(PF = 1, Veh = -1),
  PFCS_minus_Veh = c(PFCS = 1, Veh = -1),
  CS_minus_PF = c(CS = 1, PF = -1),
  PFCS_minus_PF = c(PFCS = 1, PF = -1),
  PFCS_minus_CS = c(PFCS = 1, CS = -1)
)
pair_effects <- lapply(pair_specs, function(spec) {
  contrast <- setNames(rep(0, ncol(all_design)), colnames(all_design))
  contrast[names(spec)] <- spec
  result <- topTags(glmQLFTest(all_fit, contrast = contrast), n = Inf, sort.by = "none")$table
  setNames(result$logFC, rownames(result))
})

author_sheets <- excel_sheets(AUTHOR_BOOK)
correlation_matrix <- matrix(
  NA_real_,
  nrow = length(author_sheets),
  ncol = length(pair_effects),
  dimnames = list(author_sheets, names(pair_effects))
)
for (sheet in author_sheets) {
  sheet_data <- as.data.frame(
    read_excel(AUTHOR_BOOK, sheet = sheet, .name_repair = "minimal"),
    check.names = FALSE
  )
  sheet_effect <- setNames(as.numeric(sheet_data$log2FoldChange), as.character(sheet_data$id))
  for (pair_name in names(pair_effects)) {
    common <- intersect(names(sheet_effect), names(pair_effects[[pair_name]]))
    correlation_matrix[sheet, pair_name] <- cor(
      sheet_effect[common],
      pair_effects[[pair_name]][common],
      use = "complete.obs"
    )
  }
}
cat("\nAuthor-sheet versus all four-arm edgeR effects (Pearson r):\n")
print(round(correlation_matrix, 4))

swapped_contrast <- setNames(rep(0, ncol(all_design)), colnames(all_design))
swapped_contrast[c("PF", "Veh")] <- c(1, -1)
swapped_local <- topTags(
  glmQLFTest(all_fit, contrast = swapped_contrast),
  n = Inf,
  sort.by = "none"
)$table
swapped_local$symbol <- rownames(swapped_local)
veh_v_cs_author <- as.data.frame(
  read_excel(AUTHOR_BOOK, sheet = "Veh_v_CS.deseq", .name_repair = "minimal"),
  check.names = FALSE
)
veh_v_cs_author$id <- as.character(veh_v_cs_author$id)
veh_v_cs_author$log2FoldChange <- as.numeric(veh_v_cs_author$log2FoldChange)
veh_v_cs_author$padj <- as.numeric(veh_v_cs_author$padj)
swapped_join <- merge(
  swapped_local[, c("symbol", "logFC", "FDR")],
  veh_v_cs_author[, c("id", "log2FoldChange", "padj")],
  by.x = "symbol",
  by.y = "id"
)
swapped_join <- swapped_join[
  is.finite(swapped_join$logFC) & is.finite(swapped_join$log2FoldChange),
]
swapped_local_sig <- swapped_join$FDR < 0.05
swapped_author_sig <- !is.na(swapped_join$padj) & swapped_join$padj < 0.05
swapped_both_sig <- swapped_local_sig & swapped_author_sig
swapped_union_sig <- swapped_local_sig | swapped_author_sig
swapped_metrics <- c(
  joined = nrow(swapped_join),
  pearson_logfc = cor(swapped_join$logFC, swapped_join$log2FoldChange),
  spearman_logfc = cor(swapped_join$logFC, swapped_join$log2FoldChange, method = "spearman"),
  local_fdr_005 = sum(swapped_local_sig),
  author_fdr_005 = sum(swapped_author_sig),
  shared_fdr_005 = sum(swapped_both_sig),
  fdr_jaccard = sum(swapped_both_sig) / sum(swapped_union_sig),
  author_sig_direction_agreement = mean(
    sign(swapped_join$logFC[swapped_author_sig]) ==
      sign(swapped_join$log2FoldChange[swapped_author_sig])
  )
)
cat("\nPF-labeled columns minus vehicle versus author Veh_v_CS sheet:\n")
print(swapped_metrics)

# Recreate the submitter's named method with the PF/CS permutation inferred
# independently above. Matching base means as well as effects distinguishes a
# true label permutation from a coincidental biological correlation.
biological_group <- factor(
  rep(c("Veh", "PF", "CS", "PFCS"), each = 4),
  levels = c("Veh", "CS", "PF", "PFCS")
)
deseq_data <- DESeqDataSetFromMatrix(
  countData = all_counts,
  colData = data.frame(group = biological_group, row.names = colnames(all_counts)),
  design = ~ group
)
deseq_data <- DESeq(deseq_data, quiet = TRUE)
deseq_result <- as.data.frame(results(
  deseq_data,
  contrast = c("group", "CS", "Veh")
))
deseq_result$symbol <- rownames(deseq_result)
deseq_join <- merge(
  deseq_result[, c("symbol", "baseMean", "log2FoldChange", "pvalue", "padj")],
  author[, c("id", "baseMean", "log2FoldChange", "pvalue", "padj")],
  by.x = "symbol",
  by.y = "id",
  suffixes = c("_local", "_author")
)
deseq_finite <- is.finite(deseq_join$log2FoldChange_local) &
  is.finite(deseq_join$log2FoldChange_author)
deseq_join <- deseq_join[deseq_finite, ]
deseq_local_sig <- !is.na(deseq_join$padj_local) & deseq_join$padj_local < 0.05
deseq_author_sig <- !is.na(deseq_join$padj_author) & deseq_join$padj_author < 0.05
deseq_both_sig <- deseq_local_sig & deseq_author_sig
deseq_union_sig <- deseq_local_sig | deseq_author_sig
deseq_metrics <- c(
  joined = nrow(deseq_join),
  base_mean_pearson = cor(deseq_join$baseMean_local, deseq_join$baseMean_author),
  logfc_pearson = cor(deseq_join$log2FoldChange_local, deseq_join$log2FoldChange_author),
  logfc_spearman = cor(
    deseq_join$log2FoldChange_local,
    deseq_join$log2FoldChange_author,
    method = "spearman"
  ),
  median_abs_logfc_delta = median(abs(
    deseq_join$log2FoldChange_local - deseq_join$log2FoldChange_author
  )),
  local_fdr_005 = sum(deseq_local_sig),
  author_fdr_005 = sum(deseq_author_sig),
  shared_fdr_005 = sum(deseq_both_sig),
  fdr_jaccard = sum(deseq_both_sig) / sum(deseq_union_sig),
  author_sig_direction_agreement = mean(
    sign(deseq_join$log2FoldChange_local[deseq_author_sig]) ==
      sign(deseq_join$log2FoldChange_author[deseq_author_sig])
  )
)
cat("\nDESeq2 reconstruction of GEO-defined CS-minus-Veh versus its shifted author sheet:\n")
print(deseq_metrics)

expected_best_pair <- c(
  "Veh_v_CS.deseq" = "PF_minus_Veh",
  "PF_v_Veh.deseq" = "CS_minus_Veh",
  "PF_v_CS.deseq" = "CS_minus_PF",
  "PF_v_PF+CS.deseq" = "PFCS_minus_CS",
  "PF+CS_v_Veh.deseq" = "PFCS_minus_Veh"
)
observed_best_pair <- apply(correlation_matrix, 1, function(values) {
  colnames(correlation_matrix)[which.max(values)]
})

if (!identical(unname(observed_best_pair[names(expected_best_pair)]), unname(expected_best_pair))) {
  stop("author sheet-to-contrast permutation changed")
}
if (metrics[["pearson_logfc"]] < 0.75 || metrics[["spearman_logfc"]] < 0.90) {
  stop("corrected CS-minus-Veh edgeR effects no longer reproduce the matching author sheet")
}
if (metrics[["author_sig_direction_agreement"]] != 1 || metrics[["shared_fdr_005"]] < 80) {
  stop("author-significant direction/FDR overlap regression")
}
if (deseq_metrics[["base_mean_pearson"]] < 0.99 ||
    deseq_metrics[["median_abs_logfc_delta"]] > 0.10 ||
    deseq_metrics[["author_sig_direction_agreement"]] != 1) {
  stop("DESeq2 author-method reconstruction regression")
}
cat("\n[GSE252779] PASS: raw-count route and shifted author-sheet mapping validated.\n")
