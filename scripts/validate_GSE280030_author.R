#!/usr/bin/env Rscript
# One predeclared author-compatible sensitivity fit, not parameter search.
# The author workbook fixes the eligible gene list; exact iDEP options/version
# are unavailable, so agreement does not establish an identical historical run.
suppressPackageStartupMessages({library(DESeq2); library(jsonlite); library(edgeR); library(AnnotationDbi); library(org.Mm.eg.db)})
root <- normalizePath(getwd())
out <- file.path(root, "data/author-validation/continued-sources/GSE280030")
ds <- file.path(root, "geo_replication/datasets/GSE280030_mmus_mhypoa_palmitate")
author <- read.delim(file.path(out, "comparison.per-gene.tsv"), check.names=FALSE,
                     stringsAsFactors=FALSE, na.strings="")
author <- author[author$coverage != "local_only", ]
stopifnot(nrow(author) == 27978L, !anyDuplicated(author$id))
archive <- file.path(ds, "raw/GSE280030_RAW.tar")
inventory <- utils::untar(archive, list=TRUE)
stopifnot(length(inventory) == 15L, all(grepl("^GSM[0-9]+_D[0-9]+counts.txt.gz$", inventory)))
scratch <- tempfile("GSE280030_author_compatible_")
dir.create(scratch)
utils::untar(archive, exdir=scratch)
gsm <- sprintf("GSM%d", 8585940:8585954)
culture <- c(3L,16L,17L,19L,20L,21L,40L,22L,23L,24L,41L,25L,26L,27L,42L)
condition <- c(rep("CTR",3L), rep("PA",4L), rep("LEPA",4L), rep("LANTA",4L))
sample_names <- paste0(condition,"_",culture)
files <- paste0(gsm,"_D",culture,"counts.txt.gz")
stopifnot(setequal(files,inventory))
soft <- readLines(gzfile(file.path(ds,"metadata/GSE280030_family.soft.gz")),warn=FALSE)
starts <- grep("^\\^SAMPLE = ",soft); ends <- c(starts[-1]-1L,length(soft))
for(i in seq_along(gsm)) {
  k <- which(soft[starts] == paste0("^SAMPLE = ",gsm[i])); stopifnot(length(k)==1L)
  stopifnot(paste0("!Sample_characteristics_ch1 = treatment: ",condition[i]) %in% soft[starts[k]:ends[k]])
}
tables <- lapply(files,function(f) read.delim(gzfile(file.path(scratch,f)),header=FALSE,check.names=FALSE,stringsAsFactors=FALSE))
stopifnot(all(vapply(tables,function(x) identical(x[[1]],tables[[1]][[1]]),logical(1))))
ids <- tables[[1]][[1]]; is_gene <- !startsWith(ids,"__")
counts <- do.call(cbind,lapply(tables,function(x)x[[2]][is_gene]))
rownames(counts) <- ids[is_gene]; colnames(counts) <- sample_names
stopifnot(nrow(counts)==57010L,!anyNA(counts),all(counts>=0),all(counts==round(counts)),all(author$id %in% rownames(counts)))
storage.mode(counts) <- "integer"

# Reconcile the local filter independently; do not change the local analysis.
local_design <- model.matrix(~ factor(condition[1:7], levels=c("CTR","PA")))
local_dge <- DGEList(counts=counts[,1:7])
local_keep <- filterByExpr(local_dge,design=local_design)
local_de <- read.delim(file.path(ds,"processed/GSE280030_DE.tsv"),stringsAsFactors=FALSE)
cat("Local filter check: recreated=",sum(local_keep)," registered=",nrow(local_de)," recreated-only=",length(setdiff(rownames(counts)[local_keep],local_de$id))," registered-only=",length(setdiff(local_de$id,rownames(counts)[local_keep])),"\n")
stopifnot(all(local_de$id %in% rownames(counts)[local_keep]))
local_dge <- calcNormFactors(local_dge[local_keep,,keep.lib.sizes=FALSE])
local_dge <- estimateDisp(local_dge,local_design)
local_test <- topTags(glmQLFTest(glmQLFit(local_dge,local_design),coef=2),n=Inf)$table
local_symbols <- mapIds(org.Mm.eg.db,keys=rownames(local_test),keytype="ENSEMBL",column="SYMBOL",multiVals="first")
local_symbols <- ifelse(is.na(local_symbols),rownames(local_test),unname(local_symbols))
local_test$symbol <- local_symbols
local_selected <- local_test[order(-abs(local_test$F)),]
local_selected <- local_selected[!duplicated(local_selected$symbol),]
mapping_difference <- list(recreatedOnly=setdiff(rownames(local_selected),local_de$id),registeredOnly=setdiff(local_de$id,rownames(local_selected)))
cat("Symbol selection: recreated=",nrow(local_selected)," differences=",toJSON(mapping_difference,auto_unbox=TRUE),"\n")
local_test <- local_test[match(local_de$id,rownames(local_test)),]
stopifnot(all(is.finite(local_test$FDR)),identical(rownames(local_test),local_de$id))

selected <- counts[author$id,]
metadata <- data.frame(condition=factor(condition,levels=c("CTR","PA","LEPA","LANTA")),row.names=sample_names)
dds <- DESeqDataSetFromMatrix(selected,metadata,~condition)
dds <- DESeq(dds,quiet=FALSE)
res <- as.data.frame(results(dds,contrast=c("condition","PA","CTR"),alpha=0.05))
res$id <- rownames(res)
res <- res[match(author$id,res$id),]
stopifnot(identical(res$id,author$id))
eligible <- is.finite(author$author_padj) & is.finite(res$padj)
sig_a <- is.finite(author$author_padj) & author$author_padj<0.05
sig_r <- is.finite(res$padj) & res$padj<0.05
fc_ok <- is.finite(author$author_logFC) & is.finite(res$log2FoldChange)
ratio <- res$padj[eligible]/author$author_padj[eligible]
summary <- list(
  accession="GSE280030",comparison="PA minus CTR",reviewDate="2026-09-04",
  inputArchive=archive,libraryCount=ncol(selected),geneCount=nrow(selected),
  sampleNames=sample_names,DESeq2Version=as.character(packageVersion("DESeq2")),edgeRVersion=as.character(packageVersion("edgeR")),
  design="~condition across all 15 deposited cultures; CTR reference; Wald PA-versus-CTR contrast",
  geneSelection="Exactly 27,978 IDs supplied by the author's full result workbook, not an inferred expression-filter threshold",
  assumptions="Default DESeq2 fitType=parametric, sfType=ratio, independent filtering with results alpha=0.05. These are a predeclared compatible sensitivity fit, not confirmed historical iDEP options.",
  localFilter=list(rule="edgeR::filterByExpr on the seven-sample ~group design, defaults; then order by absolute F and retain first gene per mapped symbol",filterRetained=sum(local_keep),registeredRows=nrow(local_de),currentAnnotationSymbolDeduplicated=nrow(local_selected),exactLocalIdSetMatch=setequal(rownames(local_selected),local_de$id),currentAnnotationSelectionDifferences=mapping_difference,orgMmEgDbVersion=as.character(packageVersion("org.Mm.eg.db")),maxAbsoluteLocalLogFCDifference=max(abs(local_test$logFC-local_de$logFC)),maxAbsoluteLocalAdjustedPDifference=max(abs(local_test$FDR-local_de$padj))),
  authorSignificant=sum(sig_a),reconstructedSignificant=sum(sig_r),overlap=sum(sig_a&sig_r),
  bothFiniteAdjustedP=sum(eligible),authorAdjustedPMissing=sum(!is.finite(author$author_padj)),reconstructedAdjustedPMissing=sum(!is.finite(res$padj)),
  jaccard=sum(sig_a&sig_r)/sum(sig_a|sig_r),
  pearsonLogFC=cor(author$author_logFC[fc_ok],res$log2FoldChange[fc_ok]),
  spearmanLogFC=cor(author$author_logFC[fc_ok],res$log2FoldChange[fc_ok],method="spearman"),
  maxAbsoluteLogFCDifference=max(abs(author$author_logFC[fc_ok]-res$log2FoldChange[fc_ok])),
  meanAbsoluteLogFCDifference=mean(abs(author$author_logFC[fc_ok]-res$log2FoldChange[fc_ok])),
  pearsonNegativeLog10Padj=cor(-log10(author$author_padj[eligible]),-log10(res$padj[eligible])),
  medianAdjustedPRatio=median(ratio),maxAbsoluteAdjustedPDifference=max(abs(author$author_padj[eligible]-res$padj[eligible])),
  interpretation="Compatible-model diagnostic; source workbook and local registered results are unchanged. Review exact options/version and missing adjusted p-values before treating significance as identical."
)
write.table(data.frame(id=res$id,author_logFC=author$author_logFC,author_padj=author$author_padj,res[,setdiff(names(res),"id")]),file.path(out,"deseq2-compatible.per-gene.tsv"),sep="\t",quote=FALSE,row.names=FALSE,na="")
write_json(summary,file.path(out,"deseq2-compatible.summary.json"),pretty=TRUE,auto_unbox=TRUE,digits=16)
cat(toJSON(summary,pretty=TRUE,auto_unbox=TRUE,digits=16),"\n")
