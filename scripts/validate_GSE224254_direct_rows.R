# Final bounded tximport duplicate-row/default-Galaxy-settings sensitivity.
# Requires audit_GSE224254_direct_lengths.py; exact source IDs, no guessed map.
suppressPackageStartupMessages({library(DESeq2);library(data.table)})
arg <- grep("^--file=",commandArgs(FALSE),value=TRUE)
root <- normalizePath(file.path(dirname(sub("^--file=","",arg)),".."))
out <- file.path(root,"data/author-validation/continued-sources/GSE224254")
ds <- file.path(root,"geo_replication/datasets/GSE224254_mouse_sst_neuron_sex")
sheet <- fread(file.path(ds,"metadata/GSE224254_samplesheet.tsv"))
sample_names <- sheet$sample
raw <- fread(file.path(ds,"raw/GSE224254_sst_neuron_gene_expected_counts.tsv.gz"))
length_table <- fread(file.path(out,"direct_deposited_row_gene_lengths.tsv"))
author <- as.data.frame(fread(file.path(root,"data/author-validation/continued-sources/GSE224254_hypothalamus_FoverM.csv")))
raw <- raw[gene_id%in%author$EnsID]
counts <- as.matrix(raw[,..sample_names]); rownames(counts) <- raw$gene_id
lengths <- as.matrix(length_table[match(raw$gene_id,gene_id),..sample_names]); rownames(lengths) <- raw$gene_id
stopifnot(nrow(raw)==24822,all(lengths>0),all(is.finite(lengths)))
coldata <- data.frame(sex=factor(sheet$sex,levels=c("female","male")),row.names=sheet$sample)
summaries <- comparisons <- list()
for(prior in c(FALSE,TRUE)) {
  dds <- DESeqDataSetFromTximport(list(counts=counts,length=lengths,countsFromAbundance="no"),coldata,~sex)
  dds <- DESeq(dds,betaPrior=prior,quiet=TRUE)
  for(alpha in c(.05,.1)) {
    # alpha changes independent-filter optimization, never the FDR<.05 call rule.
    r <- as.data.frame(results(dds,contrast=c("sex","male","female"),alpha=alpha));r$EnsID<-rownames(r)
    j<-merge(author,r,by="EnsID");j$betaPrior<-prior;j$independent_filter_alpha<-alpha
    good<-is.finite(j$LogFC)&is.finite(j$log2FoldChange)
    asig<-!is.na(j$adjP)&j$adjP<.05;rsig<-!is.na(j$padj)&j$padj<.05
    key<-paste(prior,alpha)
    summaries[[key]]<-data.frame(betaPrior=prior,independent_filter_alpha=alpha,DESeq2_version=as.character(packageVersion("DESeq2")),
      tested=nrow(r),nonNA_padj=sum(!is.na(r$padj)),author_significant=sum(asig),refit_FDR_lt_005=sum(rsig),
      significant_overlap=sum(asig&rsig),significant_Jaccard=sum(asig&rsig)/sum(asig|rsig),
      shared_author_significant_directions=sum(asig&sign(-j$LogFC)==sign(j$log2FoldChange),na.rm=TRUE),
      effect_Pearson=cor(-j$LogFC[good],j$log2FoldChange[good]),
      author_significant_effect_Pearson=cor(-j$LogFC[asig],j$log2FoldChange[asig]),
      median_abs_effect_difference=median(abs(j$LogFC[good]+j$log2FoldChange[good])),
      max_abs_effect_difference=max(abs(j$LogFC[good]+j$log2FoldChange[good])),
      raw_p_Pearson=cor(j[["p val"]],j$pvalue,use="complete.obs"),
      max_absolute_raw_p_difference=max(abs(j[["p val"]]-j$pvalue),na.rm=TRUE),
      max_absolute_adjusted_p_difference=max(abs(j$adjP-j$padj),na.rm=TRUE),
      median_baseMean_ratio=median(j$baseMean/j$Basemean,na.rm=TRUE))
    comparisons[[key]]<-j
    print(summaries[[key]])
  }
}
fwrite(rbindlist(summaries),file.path(out,"direct_row_sensitivity.summary.tsv"),sep="\t")
fwrite(rbindlist(comparisons),file.path(out,"direct_row_sensitivity.per-gene.tsv"),sep="\t")
capture.output(sessionInfo(),file=file.path(out,"direct_row_sensitivity.sessionInfo.txt"))
