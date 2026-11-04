# Diagnostic only: rounded deposited gene estimates without tximport length offsets.
# Do not call this exact author reconstruction or use it as an Explorer replacement.
suppressPackageStartupMessages(library(DESeq2))
suppressPackageStartupMessages(library(jsonlite))
options(digits=17)
base <- "data/author-validation/continued-sources/five-dataset-followup-2026-09-04/GSE328990"
input <- read.csv(gzfile("geo_replication/datasets/GSE328990_mmus_hypo_pomc_estrogen/raw/GSE328990_gene_counts.csv.gz"),check.names=FALSE)
samples <- read.delim("geo_replication/datasets/GSE328990_mmus_hypo_pomc_estrogen/metadata/GSE328990_samplesheet.tsv")
estimated <- as.matrix(input[,samples$sample])
stopifnot(all(is.finite(estimated)),all(estimated>=0),!anyDuplicated(input$gene_id))
counts <- round(estimated)
rownames(counts) <- input$gene_id
meta <- data.frame(row.names=samples$sample,group=factor(samples$group,levels=c("control","case")))
dds <- DESeqDataSetFromMatrix(counts,meta,~group)
dds <- DESeq(dds,quiet=TRUE)
res <- as.data.frame(results(dds,contrast=c("group","case","control"),alpha=.05))
res$gene_id <- rownames(res)
write.table(res,file.path(base,"rounded_no_offsets_sensitivity.tsv"),sep="\t",quote=FALSE,row.names=FALSE,na="NA")
write_json(list(R=R.version.string,DESeq2=as.character(packageVersion("DESeq2")),target="rounded_gene_estimates_no_offsets_diagnostic",
  design="~ group",contrast="POMC-C451Af/f minus wildtype",alpha=.05,prefilter="none",rounding="R round, applied only in this sensitivity",
  settings="DESeq2 defaults; no tximport length offsets or effect shrinkage",fractionalCells=sum(estimated!=counts),maximumRoundingDelta=max(abs(estimated-counts)),
  caution="This diagnostic tests whether changing the DE framework alone explains residuals. It does not recover transcript quantification or establish the author's countsFromAbundance option.",
  sizeFactors=as.list(sizeFactors(dds))),file.path(base,"sensitivity-protocol.json"),pretty=TRUE,auto_unbox=TRUE)
writeLines(capture.output(sessionInfo()),file.path(base,"R-session.txt"))
print(c(genes=nrow(res),fdr05=sum(res$padj<=.05,na.rm=TRUE)))
