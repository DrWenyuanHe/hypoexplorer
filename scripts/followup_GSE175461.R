#!/usr/bin/env Rscript
# Standalone author-compatible sensitivity. Never writes production outputs.
# Documented: DESeq2 1.28.1, five euhydrated and five 72h-dehydrated rats.
# Here: installed DESeq2, ~condition Wald model, default median-ratio factors,
# parametric dispersion, betaPrior=FALSE. Alpha .1 is default; .05 is a
# predeclared independent-filter sensitivity at the paper's FDR threshold.
suppressPackageStartupMessages({library(DESeq2); library(jsonlite)})
args <- commandArgs(trailingOnly=TRUE)
root <- if (length(args)) normalizePath(args[1],mustWork=TRUE) else normalizePath('.',mustWork=TRUE)
ds <- file.path(root,'geo_replication/datasets/GSE175461_rnor_son_dehydration')
out <- file.path(root,'data/author-validation/continued-sources/five-dataset-followup-2026-09-04/GSE175461')
dir.create(out,recursive=TRUE,showWarnings=FALSE)
raw <- read.csv(gzfile(file.path(ds,'raw/GSE175461_Pauza_et_al_2021_J-Neuroendocrinology_Raw_read_counts.csv.gz')),check.names=FALSE)
names(raw)[1] <- 'id'
stopifnot(nrow(raw)==32402L,!anyDuplicated(raw$id))
samples <- c(paste0('Sample_C',1:5),paste0('Sample_D',1:5))
stopifnot(identical(names(raw)[-1],samples))
cts <- as.matrix(raw[-1]); rownames(cts) <- raw$id
stopifnot(all(is.finite(cts)),all(cts>=0),all(cts==round(cts)))
storage.mode(cts) <- 'integer'
meta <- data.frame(condition=factor(rep(c('euhydrated','dehydrated'),each=5),levels=c('euhydrated','dehydrated')),row.names=samples)
dds <- DESeqDataSetFromMatrix(cts,meta,~condition)
dds <- DESeq(dds,fitType='parametric',test='Wald',betaPrior=FALSE,quiet=FALSE)
write.table(data.frame(sample=samples,condition=meta$condition,sizeFactor=sizeFactors(dds)),file.path(out,'DESeq2_sample_factors.tsv'),sep='\t',quote=FALSE,row.names=FALSE)
write.table(data.frame(id=rownames(dds),counts(dds,normalized=TRUE),check.names=FALSE),file.path(out,'DESeq2_normalized_counts.tsv'),sep='\t',quote=FALSE,row.names=FALSE)
summary <- list(schemaVersion=1,accession='GSE175461',sensitivityNotProduction=TRUE,DESeq2=as.character(packageVersion('DESeq2')),documentedAuthorDESeq2='1.28.1',formula='~condition',contrast='dehydrated minus euhydrated',sampleCount=10L,perGroup=5L,inputGenes=nrow(dds),nonzeroGenes=sum(rowSums(cts)>0),settings=list(fitType='parametric',test='Wald',betaPrior=FALSE,normalization='default median-ratio',prefilter='none; all-zero rows retained in fit input',CooksCutoff='default',minReplicatesForReplace=7),results=list())
for (alpha in c(.1,.05)) {
  label <- if(alpha==.1)'default_alpha0.1' else 'threshold_alpha0.05'
  res <- results(dds,contrast=c('condition','dehydrated','euhydrated'),alpha=alpha)
  tab <- data.frame(id=rownames(res),as.data.frame(res),check.names=FALSE)
  write.table(tab,file.path(out,paste0('DESeq2_',label,'.tsv')),sep='\t',quote=FALSE,row.names=FALSE,na='NA')
  summary$results[[label]] <- list(alpha=alpha,rows=nrow(tab),finiteRawP=sum(is.finite(tab$pvalue)),finiteAdjustedP=sum(is.finite(tab$padj)),significantAt0.05=sum(tab$padj<.05,na.rm=TRUE),up=sum(tab$padj<.05&tab$log2FoldChange>0,na.rm=TRUE),down=sum(tab$padj<.05&tab$log2FoldChange<0,na.rm=TRUE),filterThreshold=unname(metadata(res)$filterThreshold),filterTheta=metadata(res)$filterTheta)
  if(alpha==.05) {
    diagnostics <- data.frame(id=rownames(dds),nonzero=rowSums(cts)>0,
      baseMean=res$baseMean,maxCooks=mcols(dds)$maxCooks,
      defaultCooksCutoff=qf(.99,ncol(model.matrix(~condition,meta)),nrow(meta)-ncol(model.matrix(~condition,meta))),
      belowIndependentFilter=res$baseMean<unname(metadata(res)$filterThreshold),
      pvalueMissing=is.na(res$pvalue),padjMissing=is.na(res$padj))
    write.table(diagnostics,file.path(out,'DESeq2_inference_eligibility.tsv'),sep='\t',quote=FALSE,row.names=FALSE,na='NA')
  }
}
write_json(summary,file.path(out,'DESeq2_model.summary.json'),pretty=TRUE,auto_unbox=TRUE,na='null',digits=16)
capture.output(sessionInfo(),file=file.path(out,'DESeq2_sessionInfo.txt'))
cat(toJSON(summary,pretty=TRUE,auto_unbox=TRUE,na='null',digits=12),'\n')
