#!/usr/bin/env Rscript
# GSE135007 serialization successor, 2026-10-23.
# The pinned run_september5_r460.R is preserved unchanged. This specialization
# retains its source/mapping/model and writes the canonical count matrix with
# 17 significant decimal digits, then fits only the reread persisted matrix.
# HYPO_OUT_ROOT is required; adoption is explicit and separately verified.
# R 4.6.0 regeneration variant of scripts/run_september5_pipeline.R (sealed original left byte-identical).
# Shared rules: scripts/lib/de_common.R; orchestrated by scripts/regenerate_bulk_de.R.
# September 5 intake front end. Uses the repository's edgeR-QL recipe and
# writes its common DE/SE/config schema for run_mouse_fgsea.R and the explorer.
#
# Shared rules (scripts/lib/de_common.R): every feature is mapped to its final
# public symbol and aggregated before testing (counts and linear matrices
# summed, log matrices averaged; features unmapped kept in the fit and
# counted), counts stay unrounded, both browser CPMs (raw and whole-dataset
# TMM) are written, and each analysis gets <aid>_provenance.tsv and
# <aid>_sessionInfo.txt. HYPO_OUT_ROOT redirects every write, including the
# registry updates (to <HYPO_OUT_ROOT>/_registry/).
suppressPackageStartupMessages({library(data.table); library(jsonlite); library(edgeR); library(limma); library(AnnotationDbi)})
local({
  f <- grep("^--file=", commandArgs(FALSE), value = TRUE)
  repo <- if (length(f)) dirname(dirname(dirname(normalizePath(sub("^--file=", "", f[[1L]]))))) else getwd()
  source(file.path(repo, "scripts", "lib", "de_common.R"), local = globalenv())
  de_init(repo)
})
ROOT <- de_repo_root()
setwd(ROOT)
stopifnot(as.character(getRversion())=="4.6.0",
          as.character(packageVersion("edgeR"))=="4.10.1",
          as.character(packageVersion("limma"))=="3.68.4",
          as.character(packageVersion("org.Mm.eg.db"))=="3.23.0")
if(!nzchar(hypo_out_root())) stop("Use HYPO_OUT_ROOT for this successor; verify staged results before explicit adoption.")
LEGACY_PRODUCER<-file.path(ROOT,"scripts/regen-r460/run_september5_r460.R")
stopifnot(sha256_file(LEGACY_PRODUCER)=="ecd983ff457ed5d3776c84e4756bfc0ed1a40c96259f1ef444d9cbb8ef41043d")
write_counts_roundtrip<-function(mat,path){
  text<-data.table(gene_id=rownames(mat))
  for(j in seq_len(ncol(mat)))text[[colnames(mat)[j]]]<-sprintf("%.17g",mat[,j])
  write_tsv_lf(text,path,compress="gzip")
  disk<-fread(path);saved<-as.matrix(disk[,colnames(mat),with=FALSE])
  storage.mode(saved)<-"double";rownames(saved)<-disk$gene_id
  stopifnot(identical(dimnames(mat),dimnames(saved)),identical(mat,saved))
  list(mat=saved,receipt=list(schemaVersion=1,canonicalSchema="hypo-counts-tsv17-v1",
      exactValues=TRUE,nValues=length(mat),maxAbsoluteDelta=max(abs(mat-saved)),
      numericFormat="sprintf %.17g, decimal point, LF TSV, gzip",
      canonicalMatrix=repo_equivalent_path(path),canonicalMatrixSha256=sha256_file(path),
      policy="All normalization/model fits consume this exact reread persisted matrix."))
}
MANIFEST <- "data/intake/september5-2026/studies.json"
studies <- fromJSON(MANIFEST, simplifyVector=FALSE)
requested <- commandArgs(trailingOnly=TRUE)
if(!length(requested))requested<-"GSE135007"
stopifnot(identical(unique(requested),"GSE135007"))
if(length(requested)) studies <- Filter(function(s) s$accession %in% requested, studies)
stopifnot(length(studies)>0)

sha <- function(path) sha256_file(path)
write_tsv <- function(x,p) write_tsv_lf(x,p)
STAGING <- nzchar(hypo_out_root())

cfg_path <- "geo_replication/config/datasets.tsv"
cfg <- fread(cfg_path,na.strings=NULL)
outputs <- list()
for(s in studies) {
  cat("\nPreparing",s$accession,"\n");flush.console()
  ds<-s$dir; proc<-dataset_output_dir(ds,"processed"); meta<-dataset_output_dir(ds,"metadata")
  diagnostics<-list()
  for(ti in seq_along(s$tracks)) {
    tr<-s$tracks[[ti]]; source<-fread(tr$matrix); ss<-fread(tr$samplesheet,na.strings="")
    ss<-ss[included==TRUE];stopifnot(!anyDuplicated(ss$sample))
    ids<-as.character(source$gene_id); symbols<-intake_symbols(ids,source$symbol,s$organism)
    retained<-fread(file.path(ROOT,s$dir,"metadata/GSE135007_gene_map.tsv"))
    midx<-match(ids,retained$gene_id)
    stopifnot(!anyNA(midx),identical(symbols,as.character(retained$symbol[midx])))
    raw<-as.matrix(source[,ss$sample,with=FALSE]);storage.mode(raw)<-"double";rownames(raw)<-ids
    is_count<-tr$kind=="counts"
    stopifnot(all(is.finite(raw)))
    if(tr$kind!="matrix_log") stopifnot(all(raw>=0),all(colSums(raw)>0))
    pre_sums<-colSums(raw)
    # Rule A: resolve symbol collisions on the count (or linear) scale before
    # normalization/testing; features without a public symbol stay in the fit
    # as raw-id rows (normalization, priors) and are not published.
    ag<-aggregate_by_symbol(raw,symbols,switch(tr$kind,counts="counts",matrix="linear",matrix_log="log"))
    mat<-ag$mat
    published<-ag$published
    if(tr$kind!="matrix_log") stopifnot(max(abs(colSums(mat)-pre_sums))<1e-6)
    conservation_delta<-if(is_count) max(abs(colSums(mat)-pre_sums)) else NULL
    if(tr$kind=="matrix") mat<-log2(mat+1)
    base_id<-if(ti==1L) s$accession else paste0(s$accession,"_",tr$id)
    counts_path<-file.path(proc,paste0(base_id,if(is_count) "_counts.tsv.gz" else "_expression.tsv.gz"))
    canonical<-write_counts_roundtrip(mat,counts_path)
    mat<-canonical$mat
    write_json_lf(canonical$receipt,file.path(proc,paste0(base_id,"_serialization.json")),pretty=TRUE,auto_unbox=TRUE,digits=17)
    write_tsv(data.table(gene_id=ids,symbol=symbols),file.path(meta,paste0(base_id,"_gene_map.tsv")))
    # Rule C: raw and whole-track TMM CPM over every included sample (one
    # filterByExpr + TMM fit on the full feature set; contrasts use subsets).
    all_design<-model.matrix(~factor(group),ss)
    cpm<-if(is_count) write_cpm_pair(mat,pre_sums,all_design,base_id,proc,published=published) else NULL
    expr_path<-if(is_count) cpm$paths[["raw"]] else counts_path
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
      ft<-fit_edger_ql(mat[,subss$sample,drop=FALSE],design,"groupcase")
      y<-ft$y;fit<-ft$fit
      tt<-topTags(ft$qlf,n=Inf,sort.by="none")$table
      de<-data.table(id=rownames(tt),symbol=rownames(tt),logFC=tt$logFC,
        stat=sign(tt$logFC)*tt$F,pvalue=tt$PValue,padj=tt$FDR,method="edgeR-QL",
        direction=ifelse(tt$logFC<0,"down","up"))
      se<-ql_wald_se(fit,design,"groupcase")
      normalization<-data.table(sample=subss$sample,raw_library_size=pre_sums[subss$sample],
                 filtered_library_size=y$samples$lib.size,TMM_factor=y$samples$norm.factors)
      } else {
        x<-mat[,subss$sample,drop=FALSE]
        rv<-apply(x,1,var);x<-x[is.finite(rv)&rv>1e-8,,drop=FALSE]
        fit<-eBayes(lmFit(x,design));j<-match("groupcase",colnames(design))
        tt<-topTable(fit,coef=j,number=Inf,sort.by="none")
        de<-data.table(id=rownames(tt),symbol=rownames(tt),logFC=tt$logFC,
          stat=tt$t,pvalue=tt$P.Value,padj=tt$adj.P.Val,method="limma",
          direction=ifelse(tt$logFC<0,"down","up"))
        se<-fit$stdev.unscaled[,j]*sqrt(fit$s2.post)
        normalization<-data.table(sample=subss$sample,method=if(tr$kind=="matrix_log") "submitted log expression" else "log2(submitted linear expression + 1)")
      }
      se_all<-se; stopifnot(length(se_all)==nrow(tt))
      pub<-rownames(tt) %in% published
      n_unmapped_tested<-sum(!pub); n_tested<-nrow(tt)
      de<-de[pub]; se<-se_all[pub]; tt<-tt[pub,,drop=FALSE]
      stopifnot(nrow(de)>100L,!anyNA(de),all(is.finite(de$logFC)),all(is.finite(de$stat)),
                all(de$pvalue>=0&de$pvalue<=1),all(de$padj>=0&de$padj<=1),!anyDuplicated(de$symbol))
      de_path<-file.path(proc,paste0(aid,"_DE.tsv"))
      write_tsv(de,de_path)
      se_valid<-is.finite(se)&se>0
      stopifnot(length(se)==nrow(tt),mean(se_valid)>.95)
      # All-zero arms can make a Wald covariance singular even when the QL
      # test remains valid. Omit those intervals rather than inventing an SE.
      se_path<-file.path(proc,paste0(aid,"_SE.tsv"))
      write_tsv(data.table(id=rownames(tt)[se_valid],se=se[se_valid]),se_path)
      sample_path<-file.path(meta,paste0(aid,"_samplesheet.tsv"))
      write_tsv(subss,sample_path)
      write_tsv(normalization,file.path(proc,paste0(aid,"_normalization.tsv")))
      prov_outputs<-c(de=de_path,se=se_path,matrix=counts_path)
      if(is_count) prov_outputs<-c(prov_outputs,cpm_raw=cpm$paths[["raw"]],cpm_tmm=cpm$paths[["tmm"]],cpm_normalization=cpm$paths[["norm"]])
      write_provenance(aid,proc,c(de_script_path(),LEGACY_PRODUCER),
        inputs=c(matrix=repo_path(tr$matrix),samplesheet=repo_path(tr$samplesheet),manifest=file.path(ROOT,MANIFEST)),
        outputs=prov_outputs,
        fields=list(canonical_schema="hypo-counts-tsv17-v1",canonical_matrix_reread_before_fit=TRUE,
          canonical_matrix_roundtrip_exact=canonical$receipt$exactValues,
          canonical_matrix_roundtrip_values=canonical$receipt$nValues,
          canonical_matrix_roundtrip_max_absolute_delta=canonical$receipt$maxAbsoluteDelta,
          canonical_matrix_sha256=sha(counts_path),
          source_mapping_fresh_authority="org.Mm.eg.db3.23.0",source_mapping_matches_retained=TRUE,
          accession=s$accession,track=tr$id,contrast=co$id,organism=s$organism,input_kind=tr$kind,
          method=de$method[1],design=paste(colnames(design),collapse=" + "),coef="groupcase",
          samples_control=paste(subss$sample[subss$group=="control"],collapse=","),
          samples_case=paste(subss$sample[subss$group=="case"],collapse=","),
          input_fractional_cells=if(is_count) sum(raw!=round(raw)) else NA,
          n_features_raw=ag$info$n_features_raw,n_unmapped_in_fit=ag$info$n_unmapped_in_fit,
          n_symbols_after_aggregation=ag$info$n_symbols_after_aggregation,
          n_features_collapsed=ag$info$n_features_collapsed,
          n_symbols_with_multiple_features=ag$info$n_symbols_with_multiple_features,
          aggregation=ag$info$aggregation,
          unmapped_signal_fraction=if(is.null(ag$info$unmapped_signal_fraction)) NA else signif(ag$info$unmapped_signal_fraction,6),
          n_features_tested=n_tested,n_unmapped_tested=n_unmapped_tested,
          fdr_family="all tested fit rows, including unmapped rows that are not published",n_de_rows=nrow(de),n_fdr_lt_0.05=sum(de$padj<.05),
          cpm_tmm_filter_genes=if(is_count) cpm$n_genes_tmm_filter else NA,
          cpm_design=if(is_count) cpm$design else NA,cpm_tmm_factors=if(is_count) cpm$factors else NA))
      cfg<-cfg[id!=aid]
      cfg<-rbind(cfg,data.table(id=aid,dir=sub("^geo_replication/","",ds),organism=s$organism,
        id_type="SYMBOL",id_col="gene_id",id_map="NA",input_kind=if(is_count) "counts" else "matrix",
        input_path=sub("^geo_replication/","",repo_equivalent_path(counts_path)),
        samplesheet=sub("^geo_replication/","",repo_equivalent_path(sample_path)),
        batch_var=if(is.null(co$covariate)) "NA" else co$covariate,status="ready"),fill=TRUE)
      record<-list(accession=s$accession,studyId=s$id,track=tr$id,contrast=co$id,analysisId=aid,
        control=as.integer(table(subss$group)[1]),case=as.integer(table(subss$group)[2]),
        nGenes=nrow(de),fdr05=sum(de$padj<.05),seCoverage=mean(se_valid),
        inputKind=if(is_count) "counts" else "matrix",
        minTmm=if(is_count) min(y$samples$norm.factors) else NULL,maxTmm=if(is_count) max(y$samples$norm.factors) else NULL,
        fullInputRows=length(ids),mappedRows=length(published),unmappedRowsInFit=ag$info$n_unmapped_in_fit,
        maxLibrarySumDelta=conservation_delta,
        sourceSha256=sha(tr$matrix),deSha256=sha(de_path),
        design=colnames(design),samples=as.character(subss$sample),
        counts=repo_equivalent_path(counts_path),cpm=repo_equivalent_path(expr_path),
        cpmTmm=if(is_count) repo_equivalent_path(cpm$paths[["tmm"]]) else NULL,samplesheet=tr$samplesheet)
      diagnostics[[length(diagnostics)+1L]]<-record
      cat(aid,":",nrow(de),"genes;",sum(de$padj<.05),"FDR<0.05\n");flush.console()
    }
  }
  write_json_lf(diagnostics,file.path(proc,"intake_qc.json"),pretty=TRUE,auto_unbox=TRUE)
  write_lines_lf(capture.output(sessionInfo()),file.path(proc,"sessionInfo.txt"))
  outputs<-c(outputs,diagnostics)
}
# Register successful analyses only after all requested fits pass. A staging
# run (HYPO_OUT_ROOT) registers into the staging tree, never the repository.
reg_dir<-if(STAGING) file.path(hypo_out_root(),"_registry","september5-2026",paste(vapply(studies,function(x)x$accession,""),collapse="+")) else NULL
if(STAGING) dir.create(reg_dir,recursive=TRUE,showWarnings=FALSE)
write_tsv(cfg,if(STAGING) file.path(reg_dir,"datasets.tsv") else cfg_path)
previous_path<-"data/intake/september5-2026/analyses.json"
previous<-if(file.exists(previous_path)) fromJSON(previous_path,simplifyVector=FALSE) else list()
replaced<-vapply(outputs,function(x)x$analysisId,character(1))
previous<-Filter(function(x)!x$analysisId %in% replaced,previous)
write_json_lf(c(previous,outputs),if(STAGING) file.path(reg_dir,"analyses.json") else previous_path,pretty=TRUE,auto_unbox=TRUE)
