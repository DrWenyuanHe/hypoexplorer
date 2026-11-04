# Bounded author-compatible sensitivity; no production outputs are modified.
# GEO specifies Kallisto 0.46.2 -> tximport 1.10.0 -> Galaxy DESeq2.
# Exact Galaxy history, transcript map and countsFromAbundance are not supplied.
# Test standard counts and abundance-weighted length offsets explicitly, not as
# a claimed historical replay. The expected-count rounding is DESeq2's normal
# DESeqDataSetFromTximport conversion, confined to this sensitivity.
suppressPackageStartupMessages({library(DESeq2); library(data.table)})
arg <- grep("^--file=", commandArgs(FALSE), value=TRUE)
root <- normalizePath(file.path(dirname(sub("^--file=", "", arg)), ".."))
dataset <- file.path(root,"geo_replication/datasets/GSE224254_mouse_sst_neuron_sex")
out <- file.path(root,"data/author-validation/continued-sources/GSE224254")
sheet <- fread(file.path(dataset,"metadata/GSE224254_samplesheet.tsv"))
sample_names <- sheet$sample
mapping <- fread(file.path(dataset,"metadata/GSE224254_transcript_to_gene.tsv.gz"))
prepared <- fread(file.path(dataset,"raw/GSE224254_sst_neuron_gene_expected_counts.tsv.gz"))
author <- fread(file.path(root,"data/author-validation/continued-sources/GSE224254_hypothalamus_FoverM.csv"))
local <- fread(file.path(dataset,"processed/GSE224254_DE.tsv"))
stopifnot(nrow(sheet)==8, identical(sheet$sex,c(rep("female",4),rep("male",4))),
          !anyDuplicated(author$EnsID), !anyDuplicated(prepared$gene_id))
files <- file.path(dataset,"raw",paste0(sheet$geo_accession,"_",3297:3304,".tsv.gz"))
sources <- lapply(files, fread)
n <- nrow(mapping)
keep <- !is.na(mapping$gene_id) & mapping$mapping_status=="retained unique release-97 mapping"
g <- mapping$gene_id[keep]
tc <- ta <- tl <- matrix(NA_real_,n,8,dimnames=list(mapping$source_transcript_id,sheet$sample))
qc <- list()
for(i in seq_len(8)) {
  z <- sources[[i]]
  stopifnot(nrow(z)==2*n, identical(z$target_id[seq_len(n)],mapping$source_transcript_id),
            identical(z$target_id[n+seq_len(n)],mapping$source_transcript_id),
            identical(z$eff_length[seq_len(n)],z$eff_length[n+seq_len(n)]))
  tc[,i] <- z$est_counts[seq_len(n)]+z$est_counts[n+seq_len(n)]
  # Weight TPM by each run's estimated library size before pooling technical runs.
  # Lengths are identical between the two run blocks by an explicit source check.
  lib <- c(sum(z$est_counts[seq_len(n)]),sum(z$est_counts[n+seq_len(n)]))
  ta[,i] <- (z$tpm[seq_len(n)]*lib[1]+z$tpm[n+seq_len(n)]*lib[2])/sum(lib)
  tl[,i] <- z$eff_length[seq_len(n)]
  qc[[i]] <- data.frame(sample=sheet$sample[i],run1_total=lib[1],run2_total=lib[2],
      run1_tpm_total=sum(z$tpm[seq_len(n)]),run2_tpm_total=sum(z$tpm[n+seq_len(n)]),
      identical_expected_count_rows=sum(z$est_counts[seq_len(n)]==z$est_counts[n+seq_len(n)]),
      transcript_rows=n,exact_same_effective_lengths=TRUE)
}
counts <- rowsum(tc[keep,,drop=FALSE],g)
stopifnot(isTRUE(all.equal(unname(counts),unname(as.matrix(prepared[match(rownames(counts),gene_id),..sample_names])),tolerance=1e-10)))
abundance <- rowsum(ta[keep,,drop=FALSE],g)
lengths <- rowsum(ta[keep,,drop=FALSE]*tl[keep,,drop=FALSE],g)/abundance
# Standard tximport missing-length logic: geometric mean over observed samples;
# for a wholly unexpressed gene, average constituent effective lengths instead.
fallback <- tapply(rowMeans(tl[keep,,drop=FALSE]),g,mean)
for(j in seq_len(nrow(lengths))) {
  missing <- !is.finite(lengths[j,]) | lengths[j,]<=0
  if(any(missing)) lengths[j,missing] <- if(all(missing)) fallback[j] else exp(mean(log(lengths[j,!missing])))
}
stopifnot(all(is.finite(lengths)),all(lengths>0))
fwrite(rbindlist(qc),file.path(out,"technical_run_audit.tsv"),sep="\t")
fwrite(data.table(gene_id=rownames(lengths),as.data.table(lengths)),file.path(out,"gene_effective_length_sensitivity.tsv"),sep="\t")
inventory <- data.table(gene_id=unique(c(author$EnsID,rownames(counts))))
inventory[,`:=`(in_author=gene_id%in%author$EnsID,in_prepared=gene_id%in%rownames(counts),in_local_tested=gene_id%in%local$id)]
fwrite(inventory,file.path(out,"author_source_gene_inventory.tsv"),sep="\t")
coldata <- data.frame(sex=factor(sheet$sex,levels=c("female","male")),row.names=sheet$sample)
author <- as.data.frame(author)
author$author_logFC_male_minus_female <- -author$LogFC
author_sig <- author$EnsID[!is.na(author$adjP)&author$adjP<.05]
summaries <- comparisons <- list()
for(scope in c("summed_counts_no_length_offset","summed_counts_tximport_length_offset","observed_author_ID_subset_length_offset","observed_author_ID_subset_length_offset_beta_prior")) {
  sel <- if(startsWith(scope,"observed_author_ID_subset")) rownames(counts)%in%author$EnsID else rep(TRUE,nrow(counts))
  offset <- scope!="summed_counts_no_length_offset"
  txi <- list(counts=counts[sel,,drop=FALSE],length=lengths[sel,,drop=FALSE],countsFromAbundance="no")
  if(offset) dds <- DESeqDataSetFromTximport(txi,coldata,~sex) else dds <- DESeqDataSetFromMatrix(round(txi$counts),coldata,~sex)
  # A bounded sensitivity for the optional Galaxy beta-prior setting. The
  # public author export has low-count effects consistent with shrinkage;
  # this is a hypothesis, not a recovered setting or a tuned DEG cutoff.
  dds <- DESeq(dds,quiet=TRUE,betaPrior=grepl("beta_prior$",scope))
  r <- as.data.frame(results(dds,contrast=c("sex","male","female"),alpha=.05))
  r$gene_id <- rownames(r)
  joined <- merge(author,r,by.x="EnsID",by.y="gene_id")
  joined$scope <- scope
  good <- is.finite(joined$author_logFC_male_minus_female)&is.finite(joined$log2FoldChange)
  a_sig <- !is.na(joined$adjP)&joined$adjP<.05
  r_sig <- !is.na(joined$padj)&joined$padj<.05
  significant <- r$gene_id[!is.na(r$padj)&r$padj<.05]
  base <- is.finite(joined$Basemean)&joined$Basemean>0&is.finite(joined$baseMean)&joined$baseMean>0
  summary <- data.frame(scope=scope,DESeq2_version=as.character(packageVersion("DESeq2")),
     genes_in_fit=nrow(r),nonNA_padj=sum(!is.na(r$padj)),significant_FDR_005=length(significant),
     significant_up=sum(r$padj<.05&r$log2FoldChange>0,na.rm=TRUE),significant_down=sum(r$padj<.05&r$log2FoldChange<0,na.rm=TRUE),
     author_IDs_joined=nrow(joined),shared_finite_effects=sum(good),
     effect_Pearson=cor(joined$author_logFC_male_minus_female[good],joined$log2FoldChange[good]),
     author_significant_effect_Pearson=cor(joined$author_logFC_male_minus_female[a_sig&good],joined$log2FoldChange[a_sig&good]),
     raw_p_Pearson=cor(joined[["p val"]],joined$pvalue,use="complete.obs"),
     median_abs_effect_difference=median(abs(joined$author_logFC_male_minus_female[good]-joined$log2FoldChange[good])),
     max_abs_effect_difference=max(abs(joined$author_logFC_male_minus_female[good]-joined$log2FoldChange[good])),
     shared_author_significant=sum(a_sig),shared_author_significant_same_direction=sum(a_sig&good&sign(joined$author_logFC_male_minus_female)==sign(joined$log2FoldChange),na.rm=TRUE),
     significant_intersection=length(intersect(significant,author_sig)),
     full_significant_Jaccard=length(intersect(significant,author_sig))/length(union(significant,author_sig)),
     baseMean_log_Pearson=cor(log2(joined$Basemean[base]),log2(joined$baseMean[base])),
     median_refit_to_author_baseMean_ratio=median(joined$baseMean[base]/joined$Basemean[base]))
  summaries[[scope]] <- summary; comparisons[[scope]] <- joined
  print(summary)
}
fwrite(rbindlist(summaries),file.path(out,"DESeq2_sensitivity.summary.tsv"),sep="\t")
fwrite(rbindlist(comparisons),file.path(out,"DESeq2_sensitivity.per-gene.tsv"),sep="\t")
capture.output(sessionInfo(),file=file.path(out,"DESeq2_sensitivity.sessionInfo.txt"))
