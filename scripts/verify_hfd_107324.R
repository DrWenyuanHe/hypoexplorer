#!/usr/bin/env Rscript
# Refit both GSE107324 sex-specific edgeR models without sourcing the runner.
# For this unadjusted two-group design, derive QL logFC SE by the independent
# closed-form variance of two weighted group means, rather than matrix inversion.
suppressPackageStartupMessages({library(edgeR); library(jsonlite); library(openssl)})
root <- normalizePath(".",winslash="/")
base <- file.path(root,"geo_replication/datasets/GSE107324_rnor_hypothalamus_maternal_hfd")
out <- file.path(root,"data/internal-qc/hfd-intake-2026-09-12")
hash <- function(path) { con<-file(path,"rb");on.exit(close(con));unclass(as.character(sha256(con))) }
rel <- function(path) substring(path,nchar(root)+2)
source_report_path <- file.path(out,"107324-source-independent.json")
source_report <- fromJSON(source_report_path,simplifyVector=FALSE)
stopifnot(source_report$status=="passed")
reports <- list()
for(sex in c("male","female")) {
  audit <- Filter(function(x)x$track==sex,source_report$tracks)[[1]]
  stopifnot(audit$status=="passed",all(vapply(audit$dependencies,function(d)identical(hash(file.path(root,d$path)),d$sha256),logical(1))))
  id<-paste0("GSE107324_",sex)
  source_path<-file.path(base,"processed",paste0(id,"_source_counts.tsv.gz"))
  sheet_path<-file.path(base,"metadata",paste0(id,"_samples.tsv"))
  de_path<-file.path(base,"processed",paste0(id,"_DE.tsv"))
  se_path<-file.path(base,"processed",paste0(id,"_SE.tsv"))
  count_path<-file.path(base,"processed",paste0(id,"_counts.tsv.gz"))
  norm_path<-file.path(base,"processed",paste0(id,"_sample_qc.tsv"))
  source<-read.delim(gzfile(source_path),check.names=FALSE,stringsAsFactors=FALSE)
  sheet<-read.delim(sheet_path,check.names=FALSE,stringsAsFactors=FALSE)
  stopifnot(all(sheet$included),length(unique(sheet$sample))==12,all(sheet$sex==sex),
            sum(sheet$group=="control")==6,sum(sheet$group=="case")==6,
            all(source$gene_id==source$symbol))
  mat<-as.matrix(source[,sheet$sample]);storage.mode(mat)<-"double"
  stopifnot(all(is.finite(mat)),all(mat>=0),all(mat==floor(mat)))
  aggregated<-rowsum(mat,source$symbol,reorder=FALSE)
  stopifnot(identical(colSums(mat),colSums(aggregated)))
  before<-colSums(aggregated)
  actual_counts<-read.delim(gzfile(count_path),check.names=FALSE,stringsAsFactors=FALSE)
  stopifnot(setequal(actual_counts$gene_id,rownames(aggregated)),nrow(actual_counts)==nrow(aggregated))
  actual_mat<-as.matrix(actual_counts[,sheet$sample]);rownames(actual_mat)<-actual_counts$gene_id
  stopifnot(max(abs(actual_mat-aggregated[rownames(actual_mat),]))==0)
  sentinels<-grep("^__GSE107324_",rownames(aggregated),value=TRUE)
  stopifnot(setequal(sentinels,unlist(audit$missingSymbolsPreserved)))
  treatment<-as.integer(sheet$group=="case")
  design<-cbind(intercept=1,hfd=treatment)
  stopifnot(qr(design)$rank==2,nrow(design)-ncol(design)==10)
  y<-DGEList(counts=aggregated)
  keep<-filterByExpr(y,design=design)
  y<-y[keep,,keep.lib.sizes=FALSE]
  y<-calcNormFactors(y,method="TMM")
  y<-estimateDisp(y,design=design)
  fit<-glmQLFit(y,design=design)
  tested<-glmQLFTest(fit,coef=2)
  expected<-topTags(tested,n=Inf,sort.by="none")$table
  actual<-read.delim(de_path,check.names=FALSE,stringsAsFactors=FALSE)
  stopifnot(!anyDuplicated(actual$id),nrow(actual)==nrow(expected),setequal(actual$id,rownames(expected)),all(actual$method=="edgeR-QL"))
  actual<-actual[match(rownames(expected),actual$id),]
  delta<-c(logFC=max(abs(actual$logFC-expected$logFC)),
           stat=max(abs(actual$stat-sign(expected$logFC)*expected$F)),
           pvalue=max(abs(actual$pvalue-expected$PValue)),padj=max(abs(actual$padj-expected$FDR)))
  stopifnot(all(is.finite(delta)),all(delta<1e-8),identical(actual$direction,ifelse(expected$logFC<0,"down","up")))
  # edgeR 4 QL fitting may scale NB dispersions by average.ql.dispersion.
  # Undo that scale for the likelihood Fisher information of the fitted means.
  dispersion<-rep_len(fit$dispersion,nrow(fit$fitted.values))
  if(!is.null(fit$average.ql.dispersion)) dispersion<-dispersion/fit$average.ql.dispersion
  mu<-fit$fitted.values
  weights<-mu/(1+mu*dispersion)
  control_information<-rowSums(weights[,treatment==0,drop=FALSE])
  hfd_information<-rowSums(weights[,treatment==1,drop=FALSE])
  posterior_ql<-if(!is.null(fit$var.post))fit$var.post else fit$s2.post
  expected_se<-sqrt(posterior_ql*(1/control_information+1/hfd_information))/log(2)
  valid<-is.finite(expected_se)&expected_se>0
  se<-read.delim(se_path,check.names=FALSE,stringsAsFactors=FALSE)
  stopifnot(nrow(se)==sum(valid),setequal(se$id,rownames(expected)[valid]),!anyDuplicated(se$id))
  se<-se[match(rownames(expected)[valid],se$id),]
  se_delta<-max(abs(se$se-expected_se[valid]))
  stopifnot(is.finite(se_delta),se_delta<1e-8)
  normalization<-read.delim(norm_path,check.names=FALSE,stringsAsFactors=FALSE)
  normalization<-normalization[match(sheet$sample,normalization$sample),]
  norm_delta<-c(sourceLibrary=max(abs(normalization$library_size-before)),
                filteredLibrary=max(abs(normalization$normalization_library_size-y$samples$lib.size)),
                tmm=max(abs(normalization$tmm_norm_factor-y$samples$norm.factors)),
                effectiveLibrary=max(abs(normalization$effective_library_size-y$samples$lib.size*y$samples$norm.factors)))
  stopifnot(norm_delta["sourceLibrary"]==0,norm_delta["filteredLibrary"]==0,norm_delta["tmm"]<1e-12,norm_delta["effectiveLibrary"]<1e-6)
  reports[[length(reports)+1]]<-list(track=sex,analysisId=id,status="passed",sourceRows=nrow(source),
    aggregationRows=nrow(aggregated),aggregationCountsExact=TRUE,libraryConservation=TRUE,
    samples=as.list(sheet$sample),control=6,case=6,designRank=2,residualDf=10,
    inputUnassignedFeatures=as.list(sentinels),fittedUnassignedFeatures=as.list(intersect(sentinels,rownames(expected))),
    filteredRows=nrow(expected),fdr05=sum(actual$padj<.05),allDERowsCompared=TRUE,maxDEDifferences=as.list(delta),
    qlStandardErrorsCompared=sum(valid),maxSEDifference=se_delta,
    seDerivation="sqrt(posteriorQL * (1/sum(control Fisher weights) + 1/sum(HFD Fisher weights))) / log(2)",
    maxNormalizationDifferences=as.list(norm_delta),
    dependencies=lapply(c(source_path,sheet_path,de_path,se_path,count_path,norm_path),function(p)list(path=rel(p),sha256=hash(p))))
}
result<-list(accession="GSE107324",status="passed",checkedAt="2026-09-12",tracks=reports,
             sourceReconstruction=list(path=rel(source_report_path),sha256=hash(source_report_path)),
             packages=list(R=R.version.string,edgeR=as.character(packageVersion("edgeR"))),
             limitations="Independent source and model consistency replay, distinct from author-result concordance. Fits use only deposited workbook rows; Excel-damaged symbols remain unassigned. GEO lacks per-sample litter IDs and sexes remain separate.")
write_json(result,file.path(out,"107324-independent.json"),pretty=TRUE,auto_unbox=TRUE,digits=16)
writeLines(capture.output(sessionInfo()),file.path(out,"107324-independent-sessionInfo.txt"))
cat(toJSON(result,pretty=TRUE,auto_unbox=TRUE,digits=16),"\n")
