#!/usr/bin/env Rscript
# Read-only numeric replay of geo_replication/scripts/run_dataset.R.
# Writes audit evidence only; never writes analysis tables or public bundles.
suppressPackageStartupMessages({ library(edgeR); library(limma); library(jsonlite) })
args <- commandArgs(trailingOnly=TRUE)
if (length(args) != 2) stop('usage: audit_internal_normalization.R manifest.json output-directory')
jobs <- fromJSON(args[1], simplifyVector=FALSE)$jobs
out <- args[2]
dir.create(out, recursive=TRUE, showWarnings=FALSE)
read_expr <- function(path) {
  if (grepl('series_matrix', path)) {
    con <- if (grepl('\\.gz$',path)) gzfile(path) else file(path)
    L <- readLines(con); close(con)
    b <- grep('!series_matrix_table_begin',L); e <- grep('!series_matrix_table_end',L)
    if(length(b)!=1 || length(e)!=1) stop('series matrix markers unavailable')
    return(read.delim(text=L[(b+1):(e-1)], check.names=FALSE, stringsAsFactors=FALSE))
  }
  con <- if (grepl('\\.gz$',path)) gzfile(path) else file(path)
  first <- readLines(con,n=1); close(con)
  sep <- if(grepl('\t',first)) '\t' else if(grepl(',',first)) ',' else ''
  con <- if (grepl('\\.gz$',path)) gzfile(path) else file(path)
  on.exit(try(close(con),silent=TRUE))
  read.delim(con,sep=sep,check.names=FALSE,stringsAsFactors=FALSE)
}
max_delta <- function(a,b) if(length(a) && all(is.finite(a)) && all(is.finite(b))) max(abs(a-b)) else Inf
for (j in jobs) {
  target <- file.path(out,paste0(j$configId,'.json'))
  if(file.exists(target)) {
    old <- tryCatch(fromJSON(target),error=function(e) NULL)
    if(!is.null(old$evidenceId) && identical(old$evidenceId,j$evidenceId)) next
  }
  cat(j$configId,'... '); flush.console()
  result <- tryCatch({
    r <- j$config
    ss <- read.delim(j$sheet,stringsAsFactors=FALSE)
    ss <- ss[ss$group %in% c('control','case'),,drop=FALSE]
    ss$group <- factor(ss$group,levels=c('control','case'))
    if(length(unique(ss$sample)) != nrow(ss) || nlevels(droplevels(ss$group))!=2) stop('invalid sample groups')
    df <- read_expr(j$input)
    observed <- read.delim(j$table,check.names=FALSE,stringsAsFactors=FALSE)
    ids <- if(!is.null(r$id_col) && r$id_col %in% colnames(df)) as.character(df[[r$id_col]]) else as.character(df[[1]])
    identity_column <- r$id_col
    # Some dedicated preparation scripts store both original feature IDs and symbols,
    # while the registry declares the symbol column for downstream projections.
    # Original identifiers are an unambiguous join key only when unique and complete.
    original_ids <- as.character(df[[1]])
    if(!anyDuplicated(original_ids) && all(observed$id %in% original_ids) && !all(observed$id %in% ids)) {
      ids <- original_ids
      identity_column <- colnames(df)[1]
    }
    bad <- is.na(ids) | ids=='' | ids=='NA'; ids[bad] <- paste0('UNANNOT_',which(bad))
    if(length(setdiff(ss$sample,colnames(df)))) stop('missing matrix sample columns')
    mat <- as.matrix(df[,ss$sample,drop=FALSE])
    mat <- matrix(as.numeric(mat),nrow=nrow(mat),dimnames=list(ids,ss$sample))
    if(any(!is.finite(mat))) stop('non-finite input')
    bv <- r$batch_var
    use_batch <- !is.null(bv) && !is.na(bv) && nzchar(bv) && bv!='NA' && bv %in% colnames(ss) && length(unique(ss[[bv]]))>1
    if(use_batch) { ss$.batch <- factor(ss[[bv]]); design <- model.matrix(~ .batch + group,data=ss) }
    else design <- model.matrix(~group,data=ss)
    if(qr(design)$rank < ncol(design) || nrow(design)<=ncol(design)) stop('non-identifiable design')
    input_totals <- colSums(mat)
    if(r$input_kind=='counts') {
      y <- DGEList(counts=mat)
      keep <- filterByExpr(y,design); y <- y[keep,,keep.lib.sizes=FALSE]
      y <- calcNormFactors(y)
      samples <- data.frame(sample=ss$sample,library_size=input_totals,
        normalization_library_size=y$samples$lib.size,tmm_norm_factor=y$samples$norm.factors,
        effective_library_size=y$samples$lib.size*y$samples$norm.factors)
      y <- estimateDisp(y,design)
      fit <- glmQLFit(y,design)
      qlf <- glmQLFTest(fit,coef='groupcase')
      tt <- topTags(qlf,n=Inf)$table
      replay <- data.frame(id=rownames(tt),logFC=tt$logFC,stat=sign(tt$logFC)*tt$F,pvalue=tt$PValue,padj=tt$FDR)
    } else {
      rv <- apply(mat,1,var); mat <- mat[is.finite(rv) & rv>1e-8,,drop=FALSE]
      fit <- eBayes(lmFit(mat,design)); tt <- topTable(fit,coef='groupcase',number=Inf,sort.by='none')
      replay <- data.frame(id=rownames(mat),logFC=tt$logFC,stat=tt$t,pvalue=tt$P.Value,padj=tt$adj.P.Val)
      samples <- data.frame(sample=ss$sample,log2_expression_sum=input_totals,identity_transform_delta=0)
    }
    # Compare by original feature identifier; symbol projection does not alter the fit.
    idx <- match(observed$id,replay$id)
    matched <- sum(!is.na(idx)); comparable <- replay[idx,,drop=FALSE]
    deltas <- lapply(c('logFC','stat','pvalue','padj'),function(k) max_delta(observed[[k]],comparable[[k]]))
    names(deltas) <- c('logFC','stat','pvalue','padj')
    # Relative+absolute numeric comparison handles platform-level rounding only.
    within <- matched==nrow(observed) && matched>0 && all(vapply(names(deltas),function(k)
      all(is.finite(observed[[k]])) && all(is.finite(comparable[[k]])) &&
      all(abs(observed[[k]]-comparable[[k]]) <= 1e-6 + 1e-6*pmax(abs(observed[[k]]),abs(comparable[[k]]))),logical(1)))
    list(status=if(within) 'pass' else 'review',configId=j$configId,inputKind=r$input_kind,
      inputRows=nrow(df),fittedRows=nrow(replay),existingRows=nrow(observed),matchedRows=matched,
      maxAbsoluteDeltas=deltas,samples=samples,
      identityColumn=identity_column,
      note=if(within) 'Current inputs reproduce every existing DE row within absolute 1e-6 + relative 1e-6 tolerance.' else 'The current canonical numeric route does not reproduce all recorded DE statistics; inspect the dedicated model and software version before using this replay as normalization evidence.')
  },error=function(e) list(status='not_assessed',configId=j$configId,note=conditionMessage(e)))
  result$evidenceId <- j$evidenceId
  result$software <- list(R=as.character(getRversion()),edgeR=as.character(packageVersion('edgeR')),limma=as.character(packageVersion('limma')))
  write_json(result,target,pretty=TRUE,auto_unbox=TRUE,digits=16,na='null')
  cat(result$status,'\n'); flush.console()
}
