#!/usr/bin/env Rscript
# Independent source reconstruction and limma replay for GSE104709.
# Uses base R reads/rowsum, independently declared sample groups, and an explicit
# two-column design. Does not source either preparation or pipeline script.
suppressPackageStartupMessages({library(limma); library(jsonlite); library(openssl)})
root <- normalizePath(".", winslash="/")
base <- file.path(root, "geo_replication/datasets/GSE104709_mmus_cvh_hfd_rnaseq")
out <- file.path(root, "data/internal-qc/hfd-intake-2026-09-12")
dir.create(out, recursive=TRUE, showWarnings=FALSE)
source_path <- file.path(base, "raw/GSE104709_Gene_quant.txt.gz")
prepared_path <- file.path(base, "processed/GSE104709_log2_PORT_expression.tsv.gz")
sheet_path <- file.path(base, "metadata/GSE104709_samplesheet.tsv")
de_path <- file.path(base, "processed/GSE104709_DE.tsv")
se_path <- file.path(base, "processed/GSE104709_SE.tsv")
hash <- function(path) { con<-file(path,"rb"); on.exit(close(con)); unclass(as.character(sha256(con))) }
rel <- function(path) substring(path,nchar(root)+2)
sources <- read.delim(file.path(base,"metadata/GSE104709_source_files.tsv"),check.names=FALSE)
stopifnot(all(vapply(sources$file,function(p) file.exists(file.path(root,p)),logical(1))))
hash_ok <- mapply(function(p,expected) identical(hash(file.path(root,p)),expected),sources$file,sources$sha256)
stopifnot(all(hash_ok))

source <- read.delim(gzfile(source_path),check.names=FALSE,stringsAsFactors=FALSE)
prepared <- read.delim(gzfile(prepared_path),check.names=FALSE,stringsAsFactors=FALSE)
sheet <- read.delim(sheet_path,check.names=FALSE,stringsAsFactors=FALSE)
stopifnot(all(tolower(as.character(sheet$included)) %in% c("true","false")))
sheet$included <- tolower(as.character(sheet$included))=="true"
control <- paste0("GSM",2806502:2806506)
case <- paste0("GSM",2806518:2806522)
selected <- c(control,case)
author_columns <- c("RC-Only.01","RC-Only.02","RC-Only.03","RC-Only.05","RC-Only.06",
                    "HFD-Only.19","HFD-Only.20","HFD-Only.21","HFD-Only.23","HFD-Only.24")
stopifnot(identical(sheet$sample[sheet$included],selected))
stopifnot(identical(sheet$source_sample[sheet$included],author_columns))
stopifnot(identical(sheet$group[sheet$included],c(rep("control",5),rep("case",5))))
stopifnot(all(sheet$pool_size==2),all(sheet$unit_type=="two-mouse RNA pool"))
stopifnot(!anyDuplicated(sheet$unit_id),sum(!sheet$included)==11)

# Validate every selected sample against GEO's exact title and condition rows.
meta <- readLines(gzfile(file.path(base,"raw/GSE104709_series_matrix.txt.gz")),warn=FALSE)
metadata_row <- function(prefix) {
  row<-meta[startsWith(meta,paste0(prefix,"\t"))]
  stopifnot(length(row)==1)
  gsub('^"|"$','',strsplit(row,"\t",fixed=TRUE)[[1]][-1])
}
geo_gsm <- metadata_row("!Sample_geo_accession")
geo_title <- metadata_row("!Sample_title")
condition_row <- meta[startsWith(meta,"!Sample_characteristics_ch1\t") & grepl('"dietary condition:',meta,fixed=TRUE)]
stopifnot(length(condition_row)==1)
geo_condition <- gsub('^"|"$','',strsplit(condition_row,"\t",fixed=TRUE)[[1]][-1])
idx <- match(selected,geo_gsm)
stopifnot(!anyNA(idx),identical(geo_title[idx],sheet$geo_title[sheet$included]))
stopifnot(identical(geo_condition[idx],c(rep("dietary condition: RC Only",5),rep("dietary condition: HFD Only",5))))

source_mat <- as.matrix(source[,author_columns]); storage.mode(source_mat)<-"double"
stopifnot(nrow(source_mat)==21654,all(is.finite(source_mat)),all(source_mat>=0))
summed <- rowsum(source_mat,trimws(source$geneSymbol),reorder=FALSE)
stopifnot(max(abs(colSums(summed)-colSums(source_mat)))==0)
expected <- log2(summed+1)
colnames(expected)<-selected
stopifnot(nrow(prepared)==nrow(expected),!anyDuplicated(prepared$gene_id),!anyDuplicated(prepared$symbol))
stopifnot(identical(prepared$gene_id,prepared$symbol),setequal(prepared$symbol,rownames(expected)))
prepared_mat <- as.matrix(prepared[,selected]);rownames(prepared_mat)<-prepared$symbol
prepared_delta <- max(abs(prepared_mat-expected[rownames(prepared_mat),selected]))
stopifnot(prepared_delta<1e-12)

# Build the contrast directly: case indicator coefficient is HFD minus chow.
x <- expected
variance <- apply(x,1,var)
x <- x[is.finite(variance)&variance>1e-8,,drop=FALSE]
design <- cbind(intercept=1,hfd=as.integer(selected %in% case))
fit <- eBayes(lmFit(x,design))
table <- topTable(fit,coef=2,number=Inf,sort.by="none")
standard_error <- fit$stdev.unscaled[,2]*sqrt(fit$s2.post)
stopifnot(qr(design)$rank==2,nrow(design)-ncol(design)==8,all(is.finite(standard_error)),all(standard_error>0))
stopifnot(max(abs(table$logFC-(rowMeans(x[,case])-rowMeans(x[,control]))))<1e-10)

result <- list(accession="GSE104709",checkedAt="2026-09-12",
               status="source-passed-model-awaiting-pipeline",scope="independent source reconstruction and model replay",
               sourceHashesVerified=as.list(sources$file),sourceRows=nrow(source_mat),preparedRows=nrow(expected),
               duplicateSymbolRowsSummed=nrow(source_mat)-nrow(expected),selectedSamples=as.list(selected),
               controlPools=5,casePools=5,micePerPool=2,individualPoolMembersKnown=FALSE,
               everySelectedValueCompared=length(expected),maxPreparedValueDifference=prepared_delta,
               librarySumConservation=TRUE,sourceScale="PORT-normalized subsampled gene read counts",
               analysisScale="log2(PORT-normalized read count + 1)",rawCounts=FALSE,
               expectedFittedRows=nrow(table),model="limma lmFit then eBayes; HFD minus chow; nonconstant genes",
               residualDf=8,pipelineCompared=FALSE,
               authorStatisticsCompared=FALSE,
               limitations="Internal source and model consistency checks; no claim of author-table concordance. Five pools per arm, with two mice per pool; individual pool membership is unavailable. Chronic HFD comparison includes obesity and all animals underwent forced wakefulness before collection.",
               dependencies=lapply(c(source_path,prepared_path,sheet_path),function(p) list(path=rel(p),sha256=hash(p))),
               packages=list(R=R.version.string,limma=as.character(packageVersion("limma"))))
if(file.exists(de_path)&&file.exists(se_path)) {
  actual <- read.delim(de_path,check.names=FALSE,stringsAsFactors=FALSE)
  se <- read.delim(se_path,check.names=FALSE,stringsAsFactors=FALSE)
  stopifnot(nrow(actual)==nrow(table),!anyDuplicated(actual$id),setequal(actual$id,rownames(table)),
            all(actual$method=="limma"),nrow(se)==nrow(table),!anyDuplicated(se$id),setequal(se$id,rownames(table)))
  actual <- actual[match(rownames(table),actual$id),]
  se <- se[match(rownames(table),se$id),]
  delta <- c(logFC=max(abs(actual$logFC-table$logFC)),
             stat=max(abs(actual$stat-table$t)),pvalue=max(abs(actual$pvalue-table$P.Value)),
             padj=max(abs(actual$padj-table$adj.P.Val)),se=max(abs(se$se-standard_error)))
  stopifnot(all(is.finite(delta)),all(delta<1e-10),
            identical(actual$direction,ifelse(table$logFC<0,"down","up")))
  result$status <- "passed"
  result$pipelineCompared <- TRUE
  result$comparedRows <- nrow(table)
  result$maxDifferences <- as.list(delta)
  result$fdr05 <- sum(actual$padj<.05)
  result$dependencies <- c(result$dependencies,lapply(c(de_path,se_path),function(p) list(path=rel(p),sha256=hash(p))))
}
write_json(result,file.path(out,"104709-independent.json"),pretty=TRUE,auto_unbox=TRUE,digits=16)
writeLines(capture.output(sessionInfo()),file.path(out,"104709-independent-sessionInfo.txt"))
cat(toJSON(result,pretty=TRUE,auto_unbox=TRUE,digits=16),"\n")
