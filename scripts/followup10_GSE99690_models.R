# Separate model diagnostics, never writes registered Explorer data.
args <- commandArgs(trailingOnly=TRUE)
g <- args[[1]]
out <- file.path('data/author-validation/continued-sources/ten-dataset-followup-2026-09-04',g)
suppressPackageStartupMessages({library(DESeq2);library(edgeR)})
counts <- as.matrix(read.delim(file.path(out,'source-counts.tsv'),row.names=1,check.names=FALSE))
ss <- read.delim(file.path(out,'samples.tsv'),check.names=FALSE)
ss$group <- factor(ss$group,levels=c('control','case'))
rownames(ss) <- ss$sample
author <- read.delim(file.path(out,'author-results.tsv'),row.names=1,check.names=FALSE)
stopifnot(identical(colnames(counts),rownames(ss)),all(counts==round(counts)))
write_result <- function(result,name) {
  write.table(data.frame(id=rownames(result),result,check.names=FALSE),file.path(out,paste0(name,'.tsv')),sep='\t',quote=FALSE,row.names=FALSE,na='NA')
}
if (g %in% c('GSE99690','GSE242187')) {
  for (prior in c(FALSE,TRUE)) {
    dds <- DESeqDataSetFromMatrix(round(counts),ss,~group)
    dds <- DESeq(dds,betaPrior=prior,quiet=TRUE)
    tag <- if(prior) 'group-only-DESeq2-legacy-prior' else 'group-only-DESeq2-unshrunk'
    res <- results(dds,contrast=c('group','case','control'),alpha=0.05)
    write_result(as.data.frame(res),tag)
    if (!prior) write_result(as.data.frame(counts(dds,normalized=TRUE)),'DESeq2-normalized')
  }
  if (g=='GSE99690') {
    ss$pair <- factor(ss$pair)
    dds <- DESeqDataSetFromMatrix(round(counts),ss,~pair+group)
    dds <- DESeq(dds,betaPrior=FALSE,quiet=TRUE)
    write_result(as.data.frame(results(dds,contrast=c('group','case','control'),alpha=0.05)),'blocked-DESeq2-unshrunk')
    # The saved author's baseMean equals the mean of all nine normalized columns.
    # This supports checking the three-condition fit despite two-condition methods prose.
    all <- as.matrix(read.delim(file.path(out,'source-counts-all-nine.tsv'),row.names=1,check.names=FALSE))
    allss <- data.frame(row.names=colnames(all),condition=factor(rep(c('control','case','eight'),3),levels=c('control','case','eight')))
    dds <- DESeqDataSetFromMatrix(round(all),allss,~condition)
    dds <- DESeq(dds,betaPrior=TRUE,quiet=TRUE)
    write_result(as.data.frame(results(dds,contrast=c('condition','case','control'),alpha=0.05)),'nine-library-DESeq2-legacy-prior')
    write_result(as.data.frame(results(dds,contrast=c('condition','case','control'),alpha=0.1)),'nine-library-DESeq2-default-alpha')
    write_result(as.data.frame(counts(dds,normalized=TRUE)),'nine-library-DESeq2-normalized')
  }
} else {
  design <- model.matrix(~group,ss)
  for (universe in c('author-retained','registered-filter')) {
    y <- DGEList(counts)
    keep <- if(universe=='author-retained') rownames(y)%in%rownames(author) else filterByExpr(y,design)
    y <- calcNormFactors(y[keep,,keep.lib.sizes=FALSE])
    y <- estimateDisp(y,design)
    fit <- glmFit(y,design)
    res <- topTags(glmLRT(fit,coef=2),n=Inf,sort.by='none')$table
    write_result(res,paste0(universe,'-edgeR-LRT'))
    qlf <- glmQLFit(y,design)
    resq <- topTags(glmQLFTest(qlf,coef=2),n=Inf,sort.by='none')$table
    write_result(resq,paste0(universe,'-edgeR-QL'))
  }
}
writeLines(capture.output(sessionInfo()),file.path(out,'R-session.txt'))
cat(g,'diagnostics complete\n')
