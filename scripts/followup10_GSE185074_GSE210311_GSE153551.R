# Separate author-compatible sensitivities. Never writes registered outputs.
# Run: Rscript scripts/followup10_GSE185074_GSE210311_GSE153551.R GSE153551
suppressPackageStartupMessages({library(DESeq2); library(jsonlite)})
args <- commandArgs(TRUE)
stopifnot(length(args) == 1, args[1] %in% c('GSE185074','GSE210311','GSE153551'))
g <- args[1]
out <- file.path('data/author-validation/continued-sources/ten-dataset-followup-2026-09-04',g)
x <- read.delim(file.path(out,'source-counts.tsv'), check.names=FALSE, row.names=1)
ss <- read.delim(file.path(out,'registered-samples.tsv'))
a <- read.delim(file.path(out,'author-target.tsv'), check.names=FALSE)
rownames(ss) <- ss$sample
ss$group <- factor(ss$group, levels=c('control','case'))
manifest <- list(dataset=g, DESeq2=as.character(packageVersion('DESeq2')), R=R.version.string,
  registered_output_changed=FALSE, results_alpha=0.1,
  normalization='DESeq2 default median-ratio size factors, no offsets',
  fractional_counts='Round nearest integer before DESeqDataSetFromMatrix; deposited Salmon counts remain preserved',
  historical_version_reproduced=FALSE, fits=list())
run_fit <- function(label, xx, meta, contrast, design=~group) {
  stopifnot(identical(colnames(xx),rownames(meta)), !anyDuplicated(rownames(xx)), all(is.finite(as.matrix(xx))))
  d <- DESeqDataSetFromMatrix(round(as.matrix(xx)), meta, design)
  d <- DESeq(d, quiet=TRUE)
  replacements <- data.frame(id=character(),sample=character(),original=numeric(),replacement=numeric())
  if('replaceCounts' %in% assayNames(d)) {
    replaced <- assays(d)[['replaceCounts']]
    indices <- which(replaced != counts(d),arr.ind=TRUE)
    if(nrow(indices)) replacements <- data.frame(id=rownames(d)[indices[,1]],sample=colnames(d)[indices[,2]],
      original=counts(d)[indices],replacement=replaced[indices])
  }
  write.table(replacements,file.path(out,paste0(label,'.count-replacements.tsv')),sep='\t',quote=FALSE,row.names=FALSE)
  r <- as.data.frame(results(d, contrast=contrast, alpha=.1))
  no_cooks <- as.data.frame(results(d, contrast=contrast, alpha=.1, cooksCutoff=FALSE, independentFiltering=FALSE))
  r$id <- rownames(r)
  r$zero <- rowSums(counts(d)) == 0
  r$rawP_without_Cooks <- no_cooks$pvalue
  r$FDR_without_independent_filtering_or_Cooks <- no_cooks$padj
  r$eligible_reason <- ifelse(r$zero,'all_zero',ifelse(is.na(r$pvalue),'Cooks_or_other_rawP_missing',
                        ifelse(is.na(r$padj),'independent_filter','finite_FDR')))
  write.table(r, file.path(out,paste0(label,'.tsv')),sep='\t',quote=FALSE,row.names=FALSE,na='NA')
  write.table(data.frame(sample=colnames(d),sizeFactor=sizeFactors(d),meta),
              file.path(out,paste0(label,'.samples.tsv')),sep='\t',quote=FALSE,row.names=FALSE)
  list(label=label, samples=ncol(d), genes=nrow(d), design=deparse(design), contrast=contrast,
       finite_fdr=sum(is.finite(r$padj)), fdr_lt_05=sum(r$padj<.05,na.rm=TRUE),
       replaced_count_cells=nrow(replacements), genes_with_replaced_counts=length(unique(replacements$id)),
       fdr_lt_05_abs_lfc_gt_05=sum(r$padj<.05 & abs(r$log2FoldChange)>.5,na.rm=TRUE),
       nominalP_lt_05_abs_lfc_gt_05=sum(r$pvalue<.05 & abs(r$log2FoldChange)>.5,na.rm=TRUE),
       eligibility=as.list(table(r$eligible_reason)))
}
if (g == 'GSE153551') {
  meta <- read.csv(gzfile(file.path(out,'bulk_meta_counts.csv.gz')),check.names=FALSE)
  rownames(meta) <- meta$sample_name
  meta <- meta[colnames(x),]
  stopifnot(nrow(meta)==47, sum(meta$day=='d5')==23)
  meta$group <- factor(meta$group)
  keep <- rowSums(x>=10)>20
  write.table(data.frame(id=rownames(x),keep=keep), file.path(out,'author-code-filter.tsv'),sep='\t',quote=FALSE,row.names=FALSE)
  manifest$fits[[1]] <- run_fit('published_code_all47',x[keep,],meta,c('group','FGF1_d5','veh_d5'),~0+group)
  manifest$fits[[2]] <- run_fit('sensitivity_day5_only23',x[keep,rownames(ss)],ss,c('group','case','control'))
} else {
  # Published coding/result universe is pinned exactly, without a current remap.
  # Restricting before DE is a diagnostic assumption, not a claim of historical ordering.
  common <- intersect(a$id,rownames(x))
  manifest$fits[[1]] <- run_fit('sensitivity_registered_IP_cohort',x[common,rownames(ss)],ss,c('group','case','control'))
  meta <- data.frame(row.names=colnames(x),group=factor(sub('_[0-9]+$','',colnames(x))))
  if(g=='GSE210311') meta$group <- factor(sub('_[0-9]+_(input|ip)$','_\\1',colnames(x)))
  contrast <- if(g=='GSE185074') c('group','wt_hfd_ip','wt_ncd_ip') else c('group','drd2_ip','dre_ip')
  manifest$fits[[2]] <- run_fit('sensitivity_all_deposited_groups',x[common,],meta,contrast)
  if(g=='GSE185074') {
    ip <- grepl('_ip_',colnames(x))
    manifest$fits[[3]] <- run_fit('sensitivity_three_IP_groups',x[common,ip],meta[ip,,drop=FALSE],contrast)
  }
}
write_json(manifest,file.path(out,'refit-models.json'),auto_unbox=TRUE,pretty=TRUE,na='null')
capture.output(sessionInfo(),file=file.path(out,'R-sessionInfo.txt'))
print(manifest)
