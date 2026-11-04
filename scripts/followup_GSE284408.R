# Evidence-only DESeq2 sensitivity, not a registered-output replacement.
# The paper names DESeq2 but does not disclose its version, design or filtering.
suppressPackageStartupMessages(library(DESeq2))
suppressPackageStartupMessages(library(jsonlite))
options(digits=17)
base <- "data/author-validation/continued-sources/five-dataset-followup-2026-09-04/GSE284408"
input <- read.delim(gzfile(file.path(base, "GSE284408_author_table.txt.gz")), check.names=FALSE)
samples <- read.delim("geo_replication/datasets/GSE284408_mmus_arc_hfd/metadata/GSE284408_samplesheet.tsv")
counts <- as.matrix(input[,samples$sample])
stopifnot(all(is.finite(counts)), all(counts >= 0), all(counts == round(counts)), !anyDuplicated(input$id))
rownames(counts) <- input$id
metadata <- data.frame(row.names=samples$sample, group=factor(samples$group, levels=c("control","case")))
dds <- DESeqDataSetFromMatrix(counts, metadata, design=~group)
dds <- DESeq(dds, quiet=TRUE)
res <- as.data.frame(results(dds, contrast=c("group","case","control"), alpha=0.05))
res$id <- rownames(res)
write.table(res, file.path(base,"deseq2_sensitivity.tsv"), sep="\t", quote=FALSE, row.names=FALSE, na="NA")
write_json(list(R=R.version.string, DESeq2=as.character(packageVersion("DESeq2")),
  target="author_method_sensitivity_not_registered_output", design="~ group", contrast="case minus control (HFD minus NCD)",
  prefilter="none; all deposited count rows", counts="six integer *_count columns, never FPKM", alpha=0.05,
  settings="DESeq2 defaults, parametric dispersion fit, Wald test, default independent filtering and Cook's handling; no effect shrinkage",
  caveat="Published method names DESeq2 without exact version, filtering or code. This is a labeled sensitivity, not an exact author rerun.",
  sizeFactors=as.list(sizeFactors(dds)), genes=nrow(res), finiteRawP=sum(is.finite(res$pvalue)),finiteFDR=sum(is.finite(res$padj))),
  file.path(base,"deseq2_protocol.json"),pretty=TRUE,auto_unbox=TRUE)
writeLines(capture.output(sessionInfo()),file.path(base,"R-session.txt"))
print(c(genes=nrow(res),fdr05=sum(res$padj<0.05,na.rm=TRUE)))
