#!/usr/bin/env Rscript
# Cross-check our GSE292416 edgeR-QL DE (Pnoc-LepR KO vs WT, Pulldown) against the
# authors' own DESeq2 table (column log2FoldChange_ko_vs_wt_in_ip) — the SAME contrast.
ROOT <- normalizePath(file.path(dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value=TRUE)[1])), ".."))
mine <- read.delim(file.path(ROOT, "datasets/GSE292416_mmus_arc_pnoc_bactrap/processed/GSE292416_DE.tsv"), stringsAsFactors=FALSE)
au   <- read.csv(gzfile(file.path(ROOT, "datasets/_author_de/GSE292416_deseq2_results.csv.gz")), stringsAsFactors=FALSE)

m <- merge(mine[, c("symbol","logFC","padj","direction")],
           au[, c("external_gene_name","log2FoldChange_ko_vs_wt_in_ip","padj_ko_vs_wt_in_ip")],
           by.x="symbol", by.y="external_gene_name")
m <- m[is.finite(m$logFC) & is.finite(m$log2FoldChange_ko_vs_wt_in_ip), ]
cat(sprintf("shared genes: %d\n", nrow(m)))
cat(sprintf("logFC correlation  Pearson=%.3f  Spearman=%.3f\n",
            cor(m$logFC, m$log2FoldChange_ko_vs_wt_in_ip),
            cor(m$logFC, m$log2FoldChange_ko_vs_wt_in_ip, method="spearman")))

# direction concordance among genes the authors call significant
sig <- m[is.finite(m$padj_ko_vs_wt_in_ip) & m$padj_ko_vs_wt_in_ip < 0.05, ]
conc <- sign(sig$logFC) == sign(sig$log2FoldChange_ko_vs_wt_in_ip)
cat(sprintf("direction concordance on authors' sig genes (padj<0.05, n=%d): %.1f%%\n",
            nrow(sig), 100*mean(conc)))

cat("\n-- registered target check: Lepr (direction must agree with the author table) --\n")
print(m[m$symbol=="Lepr", ], row.names=FALSE)
cat("\n-- IGF panel: ours vs authors (ko_vs_wt_in_ip) --\n")
panel <- c("Igfbp2","Igfbp5","Igfbp6","Igfbp7","Igf1r","Irs2","Igf1")
print(m[m$symbol %in% panel, ], row.names=FALSE)
cat("\n-- top 12 author genes by padj: direction agreement --\n")
top <- au[order(au$padj_ko_vs_wt_in_ip), "external_gene_name"][1:12]
t2 <- m[match(top, m$symbol), ]
t2$agree <- ifelse(sign(t2$logFC)==sign(t2$log2FoldChange_ko_vs_wt_in_ip), "YES","NO")
print(t2[!is.na(t2$symbol), c("symbol","logFC","log2FoldChange_ko_vs_wt_in_ip","agree")], row.names=FALSE)
