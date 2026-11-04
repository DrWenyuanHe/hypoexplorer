# Read-only replay of the two existing limma-trend routes; no scientific outputs are written.
suppressPackageStartupMessages({library(limma);library(data.table);library(jsonlite)})
args <- commandArgs(trailingOnly=TRUE)
stopifnot(length(args)==2)
id <- args[1]; outpath <- args[2]
base <- file.path('geo_replication/datasets',if(id=='GSE157077') 'GSE157077_mmus_scn_hfd' else 'GSE135639_mmus_pomc_maternal_hfd')
if(id=='GSE157077') {
  arm <- function(file,label) {
    m <- fread(file.path(base,'raw',file)); x <- as.matrix(m[,-1L,with=FALSE])
    dimnames(x) <- list(as.character(m[[1]]),paste0(label,' ',sub('^ZT_(\\d+)_REP_(\\d+)$','ZT\\1 rep\\2',names(m)[-1L])))
    x
  }
  a <- arm('GSE157077_mouse_scn_control.tsv.gz','Chow'); b <- arm('GSE157077_mouse_scn_high_fat.tsv.gz','HFD')
  stopifnot(identical(rownames(a),rownames(b)))
  expr <- cbind(a,b)
} else {
  m <- fread(file.path(base,'raw','GSE135639_Newborn.txt.gz'))
  columns <- grep('^(CD|HFD)\\d+-\\d+$',names(m),value=TRUE)
  stopifnot(length(columns)==17L)
  expr <- as.matrix(m[,..columns]); dimnames(expr) <- list(as.character(m[[1]]),columns)
}
storage.mode(expr) <- 'double'
ss <- fread(file.path(base,'metadata',paste0(id,'_samplesheet.tsv')))
stopifnot(all(is.finite(expr)),all(expr>=0),!anyDuplicated(colnames(expr)),identical(as.character(ss$sample),colnames(expr)))
measurement <- list(rows=nrow(expr),samples=colnames(expr),missingSamples=list(),duplicateSamples=0,malformedRows=0,invalidValues=sum(!is.finite(expr)),negativeValues=sum(expr<0),fractionalValues=sum(expr!=round(expr)),sums=as.list(colSums(expr)),detected=as.list(colSums(expr>0)))
expr <- expr[order(rowMeans(expr),decreasing=TRUE),,drop=FALSE]
expr <- expr[!duplicated(rownames(expr)),,drop=FALSE]
keep <- rowSums(expr>0.5)>=ncol(expr)/3
y <- log2(expr[keep,,drop=FALSE]+1)
if(id=='GSE157077') {
  diet <- factor(ifelse(grepl('^Chow ',colnames(y)),'chow','hfd'),levels=c('chow','hfd'))
  zt <- factor(sub('^\\S+ (ZT\\d+) .*$','\\1',colnames(y)))
  design <- model.matrix(~zt+diet)
  fit <- eBayes(lmFit(y,design),trend=TRUE)
  comparisons <- list(hfd_vs_chow=list(coef='diethfd',file='GSE157077_DE.tsv'))
  design_note <- 'limma-trend with a categorical ZT + diet design; 36 libraries and six time-of-day levels.'
} else {
  diet <- ifelse(grepl('^HFD',colnames(y)),'hfd','chow')
  age <- paste0('P',sub('^(CD|HFD)(\\d+)-\\d+$','\\2',colnames(y)))
  cell <- factor(paste(diet,age,sep='_'),levels=c('chow_P0','chow_P21','hfd_P0','hfd_P21'))
  design <- model.matrix(~0+cell); colnames(design) <- levels(cell)
  cm <- makeContrasts(dietP0=hfd_P0-chow_P0,dietP21=hfd_P21-chow_P21,ageChow=chow_P21-chow_P0,ageHFD=hfd_P21-hfd_P0,levels=design)
  fit <- eBayes(contrasts.fit(lmFit(y,design),cm),trend=TRUE)
  comparisons <- list(hfd_vs_chow_p0=list(coef='dietP0',file='GSE135639_dietP0_DE.tsv'),hfd_vs_chow_p21=list(coef='dietP21',file='GSE135639_dietP21_DE.tsv'),p21_vs_p0_chow=list(coef='ageChow',file='GSE135639_ageChow_DE.tsv'),p21_vs_p0_hfd=list(coef='ageHFD',file='GSE135639_ageHFD_DE.tsv'))
  design_note <- 'limma-trend cell-means model with all 17 libraries, four diet-by-age cells, and four explicit simple-effect contrasts; residual variance pooled across the full model.'
}
stopifnot(qr(design)$rank==ncol(design),nrow(design)>ncol(design))
results <- lapply(comparisons,function(comparison) {
  tt <- topTable(fit,coef=comparison$coef,number=Inf,sort.by='P')
  replay <- data.frame(id=rownames(tt),logFC=tt$logFC,stat=tt$t,pvalue=tt$P.Value,padj=tt$adj.P.Val)
  saved <- as.data.frame(fread(file.path(base,'processed',comparison$file)))
  idx <- match(saved$id,replay$id); matched <- sum(!is.na(idx)); other <- replay[idx,,drop=FALSE]
  columns <- c('logFC','stat','pvalue','padj')
  agree <- matched==nrow(saved) && matched>0 && all(saved$method=='limma-trend') && all(vapply(columns,function(k) all(is.finite(saved[[k]])) && all(is.finite(other[[k]])) && all(abs(saved[[k]]-other[[k]])<=1e-6+1e-6*pmax(abs(saved[[k]]),abs(other[[k]]))),logical(1)))
  deltas <- lapply(columns,function(k) max(abs(saved[[k]]-other[[k]])));names(deltas)<-columns
  list(status=if(agree)'pass' else 'review',existingRows=nrow(saved),matchedRows=matched,maxAbsoluteDeltas=deltas,file=comparison$file,coef=comparison$coef)
})
write_json(list(configId=id,measurement=measurement,designRank=qr(design)$rank,designColumns=ncol(design),residualDf=nrow(design)-ncol(design),designNote=design_note,transformedRows=nrow(y),transformedSums=as.list(colSums(y)),contrasts=results,software=list(R=as.character(getRversion()),limma=as.character(packageVersion('limma')))),outpath,pretty=TRUE,auto_unbox=TRUE,digits=16,na='null')
cat(id,':',paste(vapply(results,function(x)x$status,character(1)),collapse=','),'\n')
