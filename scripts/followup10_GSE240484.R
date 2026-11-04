# Evidence-only diagnostic. See the predeclared PROTOCOL.md.
suppressPackageStartupMessages({library(edgeR); library(jsonlite)})
out <- 'data/author-validation/continued-sources/ten-dataset-followup-2026-09-04/GSE240484'
ds <- 'geo_replication/datasets/GSE240484_mmus_arc_agrp_nutrap'
raw <- read.delim(gzfile(file.path(ds,'raw/GSE240484_rna_counts.tsv.gz')),check.names=FALSE)
universe <- read.delim(gzfile(file.path(out,'GSE240484_rna_cpms_agrp-ffl.tsv.gz')),check.names=FALSE)[[1]]
stopifnot(!anyDuplicated(raw$Geneid),!anyDuplicated(universe),all(universe %in% raw$Geneid))
raw <- raw[match(universe,raw$Geneid),]
summary <- list(edgeR=as.character(packageVersion('edgeR')),notProduction=TRUE,models=list())
for (groups in c(2,3)) {
  samples <- grep(if(groups==2)'^AgRP-pos_(fed|fasted)_' else '^AgRP-pos_',names(raw),value=TRUE)
  condition <- factor(sub('^AgRP-pos_([^_]+)_.*','\\1',samples),levels=if(groups==2)c('fed','fasted') else c('fed','fasted','leptin'))
  counts <- as.matrix(raw[,samples]); rownames(counts) <- raw$Geneid
  stopifnot(all(is.finite(counts)),all(counts>=0),all(counts==round(counts)))
  design <- model.matrix(~condition)
  y <- calcNormFactors(DGEList(counts))
  y <- estimateDisp(y,design)
  write.table(data.frame(genes=rownames(y),cpm(y,log=TRUE),check.names=FALSE),file.path(out,paste0('cpm_',groups,'groups.tsv')),sep='\t',quote=FALSE,row.names=FALSE)
  write.table(data.frame(sample=samples,condition=condition,y$samples),file.path(out,paste0('samples_',groups,'groups.tsv')),sep='\t',quote=FALSE,row.names=FALSE)
  for (legacy in c(TRUE,FALSE)) {
    label <- paste0(groups,'groups_',if(legacy)'legacy' else 'current')
    fit <- glmQLFit(y,design,legacy=legacy)
    tab <- topTags(glmQLFTest(fit,coef='conditionfasted'),n=Inf,sort.by='none')$table
    write.table(data.frame(genes=rownames(tab),tab),file.path(out,paste0(label,'.tsv')),sep='\t',quote=FALSE,row.names=FALSE,na='NA')
    summary$models[[label]] <- list(samples=length(samples),genes=nrow(tab),significant=sum(tab$FDR<.05,na.rm=TRUE),fdrAndEffectWithoutAbundance=sum(tab$FDR<.05&abs(tab$logFC)>.5,na.rm=TRUE))
  }
}
# Newly retrieved Zenodo source specifies batch, historical dispersion calls,
# robust QL, full-input library sizes and an explicit initial log-CPM filter.
# Reimplement only the inspected statistical core; do not source archived scripts.
raw_full <- read.delim(gzfile(file.path(ds,'raw/GSE240484_rna_counts.tsv.gz')),check.names=FALSE)
source_design <- read.delim(file.path(out,'zenodo/design.tsv'),check.names=FALSE)
samples <- gsub('AgRP_pos','AgRP-pos',source_design$id)
counts <- as.matrix(raw_full[,samples]); rownames(counts) <- raw_full$Geneid
design <- as.matrix(source_design[,-1]); rownames(design) <- samples
y <- DGEList(counts)
keep <- rowSums(cpm(y,log=TRUE)>1)>=2
stopifnot(setequal(rownames(y)[keep],universe))
y <- y[keep,,keep.lib.sizes=TRUE]
y <- calcNormFactors(y)
write.table(data.frame(genes=rownames(y),cpm(y,log=TRUE),check.names=FALSE),file.path(out,'source_code_logcpm.tsv'),sep='\t',quote=FALSE,row.names=FALSE)
y <- estimateGLMCommonDisp(y,design)
y <- estimateGLMTrendedDisp(y,design)
y <- estimateGLMTagwiseDisp(y,design)
fit <- glmQLFit(y,design,robust=TRUE,legacy=TRUE)
contrast <- rep(0,ncol(design)); names(contrast)<-colnames(design)
contrast['fasted']<-1; contrast['fed']<--1
tab <- topTags(glmQLFTest(fit,contrast=contrast),n=Inf,sort.by='none')$table
write.table(data.frame(genes=rownames(tab),tab),file.path(out,'source_code_refit.tsv'),sep='\t',quote=FALSE,row.names=FALSE)
summary$models$source_code_refit <- list(samples=ncol(y),genes=nrow(tab),significant=sum(tab$FDR<.05),paperRule=sum(tab$FDR<=.05&abs(tab$logFC)>=.5&tab$logCPM>=1))
write_json(summary,file.path(out,'models.summary.json'),pretty=TRUE,auto_unbox=TRUE)
capture.output(sessionInfo(),file=file.path(out,'sessionInfo.txt'))
cat(toJSON(summary,pretty=TRUE,auto_unbox=TRUE))
