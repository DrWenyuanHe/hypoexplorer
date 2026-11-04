# Separate, predeclared author-context fits. Never writes Explorer outputs.
suppressPackageStartupMessages({library(DESeq2); library(jsonlite)})
options(stringsAsFactors=FALSE, digits=17)
base <- file.path(getwd(), 'data/author-validation/continued-sources/ten-dataset-followup-2026-09-04')
run <- function(acc, label, samples, groups, contrast, beta=FALSE, author_sf=FALSE) {
  out <- file.path(base,acc)
  dat <- read.delim(file.path(out,'author-universe-counts.tsv'),check.names=FALSE)
  counts <- as.matrix(dat[,samples,drop=FALSE]); rownames(counts)<-dat$feature_id
  stopifnot(!anyDuplicated(rownames(counts)), all(is.finite(counts)), all(counts>=0), all(counts==round(counts)))
  active<-rowSums(counts)>0
  meta<-data.frame(row.names=samples,group=factor(groups))
  dds<-DESeqDataSetFromMatrix(counts[active,,drop=FALSE],meta,~group)
  if(author_sf) {
    sf<-read.delim(file.path(out,'author-normalization-size-factors.tsv'))
    sizeFactors(dds)<-sf$size_factor[match(samples,sf$sample)]
  }
  cat(acc,label,':',nrow(dds),'genes',ncol(dds),'libraries\n')
  dds<-DESeq(dds,betaPrior=beta,quiet=TRUE)
  res<-results(dds,contrast=c('group',contrast),alpha=.1)
  r05<-results(dds,contrast=c('group',contrast),alpha=.05)
  rawq<-results(dds,contrast=c('group',contrast),independentFiltering=FALSE)
  all<-data.frame(feature_id=dat$feature_id)
  for(col in colnames(res))all[[col]]<-res[[col]][match(dat$feature_id,rownames(res))]
  all$padj_alpha_0p05<-r05$padj[match(dat$feature_id,rownames(r05))]
  all$padj_without_independent_filter<-rawq$padj[match(dat$feature_id,rownames(rawq))]
  all$dispersion<-dispersions(dds)[match(dat$feature_id,rownames(dds))]
  write.table(all,file.path(out,paste0(label,'.tsv')),sep='\t',quote=FALSE,row.names=FALSE,na='NA')
  normalized<-data.frame(feature_id=rownames(dds),counts(dds,normalized=TRUE),check.names=FALSE)
  write.table(normalized,file.path(out,paste0(label,'-normalized-counts.tsv')),sep='\t',quote=FALSE,row.names=FALSE,na='NA')
  write_json(list(label=label,design='~group',contrast=contrast,samples=samples,groups=groups,
    count_universe='All actual author-result effect rows with source counts; no significance-based selection',
    supplied_rows=nrow(counts),active_rows=sum(active),all_zero_rows=sum(!active),betaPrior=beta,
    normalization=if(author_sf)'Size factors recovered from author normalized sample columns' else 'DESeq2 median ratio',
    size_factors=as.list(sizeFactors(dds)),alpha_0p1=list(threshold=unname(metadata(res)$filterThreshold),theta=unname(metadata(res)$filterTheta),finite_q=sum(is.finite(res$padj))),
    alpha_0p05=list(threshold=unname(metadata(r05)$filterThreshold),theta=unname(metadata(r05)$filterTheta),finite_q=sum(is.finite(r05$padj))),
    R_version=R.version.string,DESeq2_version=as.character(packageVersion('DESeq2'))),
    file.path(out,paste0(label,'-metadata.json')),pretty=TRUE,auto_unbox=TRUE,digits=NA,na='null')
}
for(acc in c('GSE98519','GSE160467','GSE270378')) {
  ss<-read.delim(file.path(base,acc,'registered-samples.tsv'))
  if(acc=='GSE98519') {
    run(acc,'DESeq2-current-default',ss$sample,ss$group,c('case','control'))
    run(acc,'DESeq2-historical-beta-prior',ss$sample,ss$group,c('case','control'),beta=TRUE)
  } else if(acc=='GSE160467') {
    run(acc,'DESeq2-author-normalization',ss$sample,ss$group,c('case','control'),author_sf=TRUE)
  } else {
    all<-read.delim(file.path(base,acc,'all-24h-samples.tsv'))
    run(acc,'DESeq2-all-24h-groups',all$sample,all$group,c('CBD3','control'))
    run(acc,'DESeq2-pairwise-24h',ss$sample,ss$group,c('case','control'))
  }
  writeLines(capture.output(sessionInfo()),file.path(base,acc,'R-sessionInfo.txt'))
}
