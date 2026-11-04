# Read the official legacy XLS workbook without changing it.
# Run from repository root before validate_final_numerical_batch_a.py.
suppressPackageStartupMessages(library(readxl))
suppressPackageStartupMessages(library(jsonlite))
options(digits = 17)
base <- "data/author-validation/continued-sources/final-numerical-batch-a/GSE266472"
source <- file.path(base, "tables/Supplementary Files/S4a-g Data (Deseq2 Tables).xls")
inventory <- lapply(excel_sheets(source), function(sheet) {
  x <- as.data.frame(read_excel(source, sheet = sheet, na = c("", "NA")))
  list(sheet = sheet, rows = nrow(x), columns = names(x))
})
write_json(list(schemaVersion = 1, source = source, sheets = inventory),
           file.path(base, "workbook-inventory.json"), pretty = TRUE, auto_unbox = TRUE)
x <- as.data.frame(read_excel(source, sheet = "S2a. DESeq2_Data_all", na = c("", "NA")))
stopifnot(!anyDuplicated(x$ensemblid), all(is.finite(x$log2FoldChange)))
write.table(x, file.path(base, "author-whole-day-DE.tsv"), sep = "\t",
            quote = FALSE, row.names = FALSE, na = "NA")
sig <- !is.na(x$padj) & x$padj < 0.05 & abs(x$log2FoldChange) > 0.1
summary <- list(schemaVersion = 1, rows = nrow(x), uniqueEnsemblIds = length(unique(x$ensemblid)),
                finiteAdjustedP = sum(!is.na(x$padj)),
                paperRule = "padj < 0.05 and abs(log2FoldChange) > 0.1",
                significant = sum(sig), positive = sum(sig & x$log2FoldChange > 0),
                negative = sum(sig & x$log2FoldChange < 0),
                hypothesis = "Whole-day long versus short photoperiod; DESeq2 ~ batch + photoperiod",
                localComparisonPerformed = FALSE,
                reason = "Local contrast restricts to pZT12. Author workbook contains one all-time DE table and functional subsets, not a pZT12-specific result.",
                R = R.version.string, readxl = as.character(packageVersion("readxl")))
write_json(summary, file.path(base, "author-summary.json"), pretty = TRUE, auto_unbox = TRUE)
print(summary)
