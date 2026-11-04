#!/usr/bin/env Rscript
# Bounded normalization sensitivity. Does not reconstruct unspecified rlog/limma
# filtering or claim that normalized means equal the author's rlog estimates.
suppressPackageStartupMessages({library(data.table); library(DESeq2)})
out <- 'data/author-validation/continued-sources/final-numerical-batch-d'
ds <- 'geo_replication/datasets/GSE299412_drer_hypothalamus'
x <- fread(file.path(ds,'raw/GSE299412_data.txt.gz'))
a <- fread(file.path(out,'GSE299412_author_union_comparison.tsv'))
source_symbols <- x[[1L]]
stopifnot(!anyDuplicated(source_symbols),ncol(x)==64L)
M <- as.matrix(x[, -1L]); storage.mode(M)<-'integer'
rownames(M)<-source_symbols
stopifnot(all(M>=0),!anyNA(M))
fits<-list(); stats<-list()
for(scope in c('all_63_libraries','male_hypothalamus_11_libraries')) {
  selected<-if(scope=='all_63_libraries')colnames(M) else grep('^Adult_Hypo_male_',colnames(M),value=TRUE)
  mat<-M[,selected,drop=FALSE]
  size_factors<-estimateSizeFactorsForMatrix(mat)
  normalized<-sweep(mat,2,size_factors,'/')
  wt<-grep('^Adult_Hypo_male_wt_',colnames(normalized))
  ko<-grep('^Adult_Hypo_male_ko_',colnames(normalized))
  stopifnot(length(wt)==6L,length(ko)==5L)
  # Difference of log2(arithmetic normalized means + 1), NOT rlog.
  effect<-log2(rowMeans(normalized[,ko,drop=FALSE])+1)-log2(rowMeans(normalized[,wt,drop=FALSE])+1)
  b<-copy(a)
  b[,`:=`(scope=scope,source_present=author_source_symbol%in%names(effect),
          diagnostic_log2_normalized_mean_ratio=effect[author_source_symbol])]
  b<-b[source_present==TRUE]
  selected_b<-b[author_selected_direction%in%c('UP','DOWN')]
  stats[[scope]]<-data.table(scope=scope,source_genes=nrow(mat),source_libraries=ncol(mat),
      author_union_source_matched=nrow(b),author_selected_source_matched=nrow(selected_b),
      selected_direction_matches=sum((selected_b$diagnostic_log2_normalized_mean_ratio>0)==(selected_b$author_selected_direction=='UP')),
      selected_effect_r=cor(selected_b$diagnostic_log2_normalized_mean_ratio,selected_b$author_mean_rlog_difference_not_unshrunk_logFC),
      normalization_note='Median-ratio diagnostic only; not author rlog or DE results')
  fits[[scope]]<-b
}
fwrite(rbindlist(fits),file.path(out,'GSE299412_normalization_sensitivity.per-gene.tsv'),sep='\t')
fwrite(rbindlist(stats),file.path(out,'GSE299412_normalization_sensitivity.summary.tsv'),sep='\t')
capture.output(sessionInfo(),file=file.path(out,'GSE299412_normalization_sessionInfo.txt'))
print(rbindlist(stats))
