#!/usr/bin/env Rscript
# High-fat diet intake front end, using the established September intake recipe. Uses the repository's edgeR-QL recipe and
# writes its common DE/SE/config schema for run_mouse_fgsea.R and the explorer.
suppressPackageStartupMessages({library(data.table); library(jsonlite); library(edgeR); library(limma); library(AnnotationDbi)})
# A Windows workstation may retain its organism annotation in an older user
# library. Prefer the active runtime, and use the existing library if present.
legacy_annotation_library <- file.path(Sys.getenv("LOCALAPPDATA"), "R/win-library/4.4")
if(.Platform$OS.type=="windows" && dir.exists(legacy_annotation_library))
  .libPaths(unique(c(.libPaths(), legacy_annotation_library)))
ROOT <- normalizePath(".", winslash="/")
MANIFEST <- "data/intake/hfd-2026-09-12/studies.json"
studies <- fromJSON(MANIFEST, simplifyVector=FALSE)
requested <- commandArgs(trailingOnly=TRUE)
if(length(requested)) studies <- Filter(function(s) s$accession %in% requested, studies)
stopifnot(length(studies)>0)

sha <- function(path) { con<-file(path,"rb"); on.exit(close(con)); unclass(as.character(openssl::sha256(con))) }
write_tsv <- function(x,p) fwrite(x,p,sep="\t",quote=FALSE,na="NA")

map_symbols <- function(ids, symbols, organism) {
  needs <- is.na(symbols) | !nzchar(symbols) | grepl("^ENS[A-Z]*G[0-9]+",symbols)
  if(any(needs)) {
    pkg <- switch(organism, "Mus musculus"="org.Mm.eg.db", "Rattus norvegicus"="org.Rn.eg.db", stop("unsupported organism"))
    suppressPackageStartupMessages(library(pkg, character.only=TRUE))
    db <- get(pkg)
    keys <- sub("\\.[0-9]+$","",ids[needs])
    keytype <- if(all(grepl("^[0-9]+$",keys))) "ENTREZID" else "ENSEMBL"
    valid <- intersect(unique(keys), AnnotationDbi::keys(db,keytype=keytype))
    mp <- if(length(valid)) mapIds(db,keys=valid,keytype=keytype,column="SYMBOL",multiVals="first") else setNames(character(),character())
    mapped <- unname(mp[keys]); mapped[is.na(mapped)|!nzchar(mapped)] <- ids[needs][is.na(mapped)|!nzchar(mapped)]
    symbols[needs] <- mapped
  }
  # The browser also uses the repository's MGI authority for newer mouse
  # Ensembl IDs. Apply that fallback before count-scale aggregation so it
  # cannot introduce a second symbol collision after differential testing.
  if(organism=="Mus musculus") {
    mgi<-unlist(fromJSON("scripts/lib/mmus_ens2sym.json"),use.names=TRUE)
    remaining<-grepl("^ENSMUSG[0-9]+",symbols)
    fallback<-unname(mgi[sub("\\.[0-9]+$","",symbols[remaining])])
    symbols[which(remaining)[!is.na(fallback)]]<-fallback[!is.na(fallback)]
  }
  symbols
}

ql_se <- function(fit, design, coefficient) {
  mu<-fit$fitted.values; disp<-fit$dispersion
  if(length(disp)==1L) disp<-rep(disp,nrow(mu))
  if(!is.null(fit$average.ql.dispersion)) disp<-disp/fit$average.ql.dispersion
  post<-if(!is.null(fit$var.post)) fit$var.post else fit$s2.post
  stopifnot(length(post)==nrow(mu),all(is.finite(post)&post>0))
  j<-match(coefficient,colnames(design))
  vapply(seq_len(nrow(mu)),function(i){
    w<-mu[i,]/(1+disp[i]*mu[i,])
    inv<-tryCatch(solve(crossprod(design*w,design)),error=function(e) NULL)
    if(is.null(inv)) return(NA_real_)
    sqrt(inv[j,j]*post[i])/log(2)
  },numeric(1))
}

cfg_path <- "geo_replication/config/datasets.tsv"
cfg <- fread(cfg_path,na.strings=NULL)
outputs <- list()
for(s in studies) {
  cat("\nPreparing",s$accession,"\n");flush.console()
  ds<-s$dir; proc<-file.path(ds,"processed")
  diagnostics<-list()
  for(ti in seq_along(s$tracks)) {
    tr<-s$tracks[[ti]]; source<-fread(tr$matrix); ss<-fread(tr$samplesheet,na.strings="")
    ss<-ss[included==TRUE];stopifnot(!anyDuplicated(ss$sample))
    ids<-source$gene_id; symbols<-map_symbols(ids,source$symbol,s$organism)
    mat<-as.matrix(source[,ss$sample,with=FALSE]);storage.mode(mat)<-"double"
    is_count<-tr$kind=="counts"
    stopifnot(all(is.finite(mat)))
    if(tr$kind!="matrix_log") stopifnot(all(mat>=0),all(colSums(mat)>0))
    pre_sums<-colSums(mat)
    # Resolve symbol collisions on the count scale before normalization/testing.
    # Retain every unresolved ID as its own row, conserving every library sum.
    if(tr$kind=="matrix_log") mat<-limma::avereps(mat,ID=symbols) else mat<-rowsum(mat,symbols,reorder=FALSE)
    if(tr$kind!="matrix_log") stopifnot(max(abs(colSums(mat)-pre_sums))<1e-6)
    conservation_delta<-if(is_count) max(abs(colSums(mat)-pre_sums)) else NULL
    if(tr$kind=="matrix") mat<-log2(mat+1)
    base_id<-tr$analysisId
    counts_path<-file.path(proc,paste0(base_id,if(is_count) "_counts.tsv.gz" else "_expression.tsv.gz"))
    write_tsv(data.table(gene_id=rownames(mat),as.data.table(mat)),counts_path)
    write_tsv(data.table(gene_id=ids,symbol=symbols),file.path(ds,"metadata",paste0(base_id,"_gene_map.tsv")))
    expr<-if(is_count) sweep(mat,2,colSums(mat),"/")*1e6 else mat
    expr_path<-file.path(proc,paste0(base_id,if(is_count) "_CPM.tsv.gz" else "_expression.tsv.gz"))
    write_tsv(data.table(gene_id=rownames(mat),as.data.table(expr)),expr_path)
    for(ci in seq_along(s$contrasts)) {
      co<-s$contrasts[[ci]]
      aid<-if(ci==1L) base_id else paste0(base_id,"_",co$id)
      subss<-ss[group %in% c(co$baseline,co$case)]
      subss$group<-factor(ifelse(subss$group==co$baseline,"control","case"),levels=c("control","case"))
      stopifnot(all(table(subss$group)>=3L))
      if(!is.null(co$covariate)) {
        stopifnot(!anyNA(subss[[co$covariate]]))
        subss$.batch<-factor(subss[[co$covariate]])
        design<-model.matrix(~.batch+group,subss)
      } else design<-model.matrix(~group,subss)
      stopifnot(qr(design)$rank==ncol(design),nrow(design)>ncol(design))
      if(is_count) {
      y<-DGEList(mat[,subss$sample,drop=FALSE])
      keep<-filterByExpr(y,design);y<-y[keep,,keep.lib.sizes=FALSE]
      y<-calcNormFactors(y);y<-estimateDisp(y,design)
      fit<-glmQLFit(y,design);test<-glmQLFTest(fit,coef="groupcase")
      tt<-topTags(test,n=Inf,sort.by="none")$table
      de<-data.table(id=rownames(tt),symbol=rownames(tt),logFC=tt$logFC,
        stat=sign(tt$logFC)*tt$F,pvalue=tt$PValue,padj=tt$FDR,method="edgeR-QL",
        direction=ifelse(tt$logFC<0,"down","up"))
      se<-ql_se(fit,design,"groupcase")
      normalization<-data.table(sample=subss$sample,library_size=pre_sums[subss$sample],
                 normalization_library_size=y$samples$lib.size,tmm_norm_factor=y$samples$norm.factors,
                 effective_library_size=y$samples$lib.size*y$samples$norm.factors)
      } else {
        x<-mat[,subss$sample,drop=FALSE]
        rv<-apply(x,1,var);x<-x[is.finite(rv)&rv>1e-8,,drop=FALSE]
        fit<-eBayes(lmFit(x,design));j<-match("groupcase",colnames(design))
        tt<-topTable(fit,coef=j,number=Inf,sort.by="none")
        de<-data.table(id=rownames(tt),symbol=rownames(tt),logFC=tt$logFC,
          stat=tt$t,pvalue=tt$P.Value,padj=tt$adj.P.Val,method="limma",
          direction=ifelse(tt$logFC<0,"down","up"))
        se<-fit$stdev.unscaled[,j]*sqrt(fit$s2.post)
        normalization<-data.table(sample=subss$sample,identity_transform_delta=0,
          log_expression_sum=colSums(mat[,subss$sample,drop=FALSE]),
          method=if(tr$kind=="matrix_log") "submitted log expression" else "log2(submitted linear expression + 1)")
      }
      stopifnot(nrow(de)>100L,!anyNA(de),all(is.finite(de$logFC)),all(is.finite(de$stat)),
                all(de$pvalue>=0&de$pvalue<=1),all(de$padj>=0&de$padj<=1))
      write_tsv(de,file.path(proc,paste0(aid,"_DE.tsv")))
      se_valid<-is.finite(se)&se>0
      stopifnot(length(se)==nrow(tt),mean(se_valid)>.95)
      # All-zero arms can make a Wald covariance singular even when the QL
      # test remains valid. Omit those intervals rather than inventing an SE.
      write_tsv(data.table(id=rownames(tt)[se_valid],se=se[se_valid]),file.path(proc,paste0(aid,"_SE.tsv")))
      sample_path<-file.path(ds,"metadata",paste0(aid,"_analysis_samplesheet.tsv"))
      write_tsv(subss,sample_path)
      write_tsv(normalization,file.path(proc,paste0(aid,"_sample_qc.tsv")))
      cfg<-cfg[id!=aid]
      cfg<-rbind(cfg,data.table(id=aid,dir=sub("^geo_replication/","",ds),organism=s$organism,
        id_type="SYMBOL",id_col="gene_id",id_map="NA",input_kind=if(is_count) "counts" else "matrix",
        input_path=sub("^geo_replication/","",counts_path),samplesheet=sub("^geo_replication/","",sample_path),
        batch_var=if(is.null(co$covariate)) "NA" else co$covariate,status="ready"),fill=TRUE)
      record<-list(accession=s$accession,studyId=s$id,track=tr$id,contrast=co$id,analysisId=aid,
        control=as.integer(table(subss$group)[1]),case=as.integer(table(subss$group)[2]),
        nGenes=nrow(de),fdr05=sum(de$padj<.05),seCoverage=mean(se_valid),
        inputKind=if(is_count) "counts" else "matrix",
        minTmm=if(is_count) min(y$samples$norm.factors) else NULL,maxTmm=if(is_count) max(y$samples$norm.factors) else NULL,
        fullInputRows=length(ids),mappedRows=nrow(mat),maxLibrarySumDelta=conservation_delta,
        sourceSha256=sha(tr$matrix),deSha256=sha(file.path(proc,paste0(aid,"_DE.tsv"))),
        design=colnames(design),designRank=qr(design)$rank,residualDf=nrow(design)-ncol(design),samples=as.character(subss$sample),counts=counts_path,
        cpm=expr_path,samplesheet=tr$samplesheet)
      diagnostics[[length(diagnostics)+1L]]<-record
      cat(aid,":",nrow(de),"genes;",sum(de$padj<.05),"FDR<0.05\n");flush.console()
    }
  }
  write_json(diagnostics,file.path(proc,"intake_qc.json"),pretty=TRUE,auto_unbox=TRUE,null="null")
  writeLines(capture.output(sessionInfo()),file.path(proc,"sessionInfo.txt"))
  outputs<-c(outputs,diagnostics)
}
# Register successful analyses only after all requested fits pass.
write_tsv(cfg,cfg_path)
previous_path<-"data/intake/hfd-2026-09-12/analyses.json"
previous<-if(file.exists(previous_path)) fromJSON(previous_path,simplifyVector=FALSE) else list()
replaced<-vapply(outputs,function(x)x$analysisId,character(1))
previous<-Filter(function(x)!x$analysisId %in% replaced,previous)
write_json(c(previous,outputs),previous_path,pretty=TRUE,auto_unbox=TRUE,null="null")
