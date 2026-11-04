#!/usr/bin/env Rscript
# Bounded method sensitivity. All 16 deposited libraries versus the day-15 eight.
# Both include the two deposited reporters; no thresholds tuned to table values.
suppressPackageStartupMessages({library(data.table); library(DESeq2)})
out <- 'data/author-validation/continued-sources/final-numerical-batch-d'
ds <- 'geo_replication/datasets/GSE301692_hsap_hypothalamus_pituitary_organoid'
x <- fread(file.path(ds, 'raw/GSE301692_30_HTSeq.COUNT.txt.gz'))
meta <- fread(file.path(ds, 'metadata/GSE301692_sample_inventory.tsv'))
author <- fread(file.path(out, 'GSE301692_TableS4_comparison.tsv'))
stopifnot(nrow(x)==38608L, nrow(meta)==16L, nrow(author)==56L)
outputs <- list(); summaries <- list()
for (scope in c('day15_eight_libraries', 'all_sixteen_libraries')) {
  sm <- if (scope == 'day15_eight_libraries') meta[day==15L] else meta
  group <- factor(paste0('day',sm$day,'_',sm$outcome))
  coldata <- data.frame(group=group, row.names=sm$sample)
  selected_names <- sm$sample
  counts <- as.matrix(x[, ..selected_names])
  rownames(counts) <- x$gene_id
  stopifnot(all(is.finite(counts)), all(counts==round(counts)))
  storage.mode(counts) <- 'integer'
  dds <- DESeqDataSetFromMatrix(counts,coldata,~group)
  dds <- DESeq(dds, quiet=TRUE)
  results <- results(dds, contrast=c('group','day15_success','day15_fail'))
  result <- as.data.table(results, keep.rownames='id')
  # Gene versions are absent from author excerpt. Preserve stable ID exactly.
  result[, id:=sub('\\.[0-9]+$', '', id)]
  stopifnot(!anyDuplicated(result$id))
  matched <- merge(author, result, by='id', all.x=TRUE)
  matched[, scope:=scope]
  outputs[[scope]] <- matched
  summaries[[scope]] <- data.table(scope=scope, samples=nrow(sm), tested=nrow(result),
      refit_fdr05=sum(result$padj<.05,na.rm=TRUE), author_rows=nrow(matched),
      effect_r=cor(matched$author_logFC,matched$log2FoldChange),
      median_abs_effect_delta=median(abs(matched$author_logFC-matched$log2FoldChange)),
      max_abs_effect_delta=max(abs(matched$author_logFC-matched$log2FoldChange)),
      median_baseMean_ratio=median(matched$baseMean/matched$author_baseMean),
      max_relative_baseMean_delta=max(abs(matched$baseMean/matched$author_baseMean-1)),
      max_abs_p_delta=max(abs(matched$pvalue-matched$author_p)),
      max_abs_padj_delta=max(abs(matched$padj-matched$author_padj)))
}
fwrite(rbindlist(outputs),file.path(out,'GSE301692_DESeq2_sensitivity.per-gene.tsv'),sep='\t')
fwrite(rbindlist(summaries),file.path(out,'GSE301692_DESeq2_sensitivity.summary.tsv'),sep='\t')
capture.output(sessionInfo(),file=file.path(out,'GSE301692_DESeq2_sessionInfo.txt'))
print(rbindlist(summaries))
