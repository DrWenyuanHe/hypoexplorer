#!/usr/bin/env Rscript
suppressPackageStartupMessages({library(Matrix);library(data.table);library(jsonlite)})
ds<-"geo_replication/datasets/GSE314184_discovery_20260905"
files<-list.files(file.path(ds,"raw"),pattern="\\.RDS$",full.names=TRUE)
stopifnot(length(files)==17L)
columns<-list();samples<-list();qc<-list()
groups<-c(ra="alloparental",rc="control",ri="infanticidal",rs="sire",rd="dam")
for(path in files) {
  name<-basename(path);gsm<-sub("_.*$","",name);animal<-sub(".*_([a-z]+[0-9]+)\\.RDS$","\\1",name)
  group<-unname(groups[substr(animal,1,2)]);stopifnot(!is.na(group))
  object<-readRDS(path)
  # Read the serialized, documented Assay5 counts slot. No Seurat analysis or
  # normalized assay is substituted for the deposited RNA counts.
  assay<-attr(object,"assays")[["RNA"]]
  layers<-attr(assay,"layers");stopifnot(identical(names(layers),"counts"))
  counts<-layers[["counts"]]
  genes<-attr(attr(assay,"features"),"dimnames")[[1]]
  cells<-attr(attr(assay,"cells"),"dimnames")[[1]]
  stopifnot(length(genes)==nrow(counts),length(cells)==ncol(counts),!anyDuplicated(genes),!anyDuplicated(cells))
  md<-attr(object,"meta.data");stopifnot(setequal(rownames(md),cells))
  md<-md[cells,,drop=FALSE]
  stopifnot(all(is.finite(counts@x)),all(counts@x>=0),all(counts@x==floor(counts@x)),
            max(abs(Matrix::colSums(counts)-md$nCount_RNA))<1e-6)
  keep<-md$scDblFinder.class=="singlet" & !is.na(md$scDblFinder.class)
  stopifnot(sum(keep)>=20L,length(unique(md$orig.ident))==1L)
  values<-Matrix::rowSums(counts[,keep,drop=FALSE]);names(values)<-genes
  columns[[gsm]]<-values
  samples[[gsm]]<-data.table(sample=gsm,animal=animal,group=group,unit="mouse",cells=sum(keep),included=TRUE)
  qc[[gsm]]<-list(source=name,genes=nrow(counts),sourceCells=ncol(counts),singlets=sum(keep),
                 excludedDoublets=sum(!keep),sourceCountSum=sum(counts),retainedCountSum=sum(values),
                 maxCellCountDelta=max(abs(Matrix::colSums(counts)-md$nCount_RNA)))
  cat(gsm,animal,group,sum(keep),"singlet nuclei\n");flush.console()
}
# Same whole-transcriptome assay in every mouse. A missing row in one submitted
# sparse object has no deposited counts in that mouse; record the row coverage.
genes<-sort(unique(unlist(lapply(columns,names))))
mat<-matrix(0,nrow=length(genes),ncol=length(columns),dimnames=list(genes,names(columns)))
for(gsm in names(columns)) mat[names(columns[[gsm]]),gsm]<-columns[[gsm]]
stopifnot(all(colSums(mat)==vapply(columns,sum,numeric(1))))
dir.create(file.path(ds,"processed"),showWarnings=FALSE)
matrix_path<-file.path(ds,"processed/GSE314184_mpoa_source_counts.tsv.gz")
ss_path<-file.path(ds,"metadata/GSE314184_samples.tsv")
fwrite(data.table(gene_id=genes,symbol=genes,as.data.table(mat)),matrix_path,sep="\t")
ss<-rbindlist(samples);fwrite(ss,ss_path,sep="\t")
write_json(qc,file.path(ds,"processed/matrix_qc.json"),pretty=TRUE,auto_unbox=TRUE)
manifest<-"data/intake/september5-2026/studies.json"
studies<-fromJSON(manifest,simplifyVector=FALSE)
labels<-c(control="Naive control males",alloparental="Naive alloparental males",infanticidal="Naive infanticidal males",sire="Sires",dam="Dams")
mk<-function(id,label,base,case) list(id=id,label=label,baseline=base,case=case)
s<-list(accession="GSE314184",id="gse314184",name="Mouse medial preoptic parental behavior",category="Reproduction & development",
  region="Preoptic area",preparation="Single-nucleus",perturbation="Environment & stress",organism="Mus musculus",modality="snRNA-seq",
  note="One animal per submitted Seurat object, with no pooling. RNA count layers are aggregated by mouse after excluding submitted doublet calls. Three naive control, three alloparental, three infanticidal males, four sires and four dams. Dam-versus-sire differences combine sex and parental-role differences; they are not an isolated hormone effect.",
  source="https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE314184",pmid="",dir=ds,
  groups=lapply(names(labels),function(k)list(key=k,label=unname(labels[k]))),
  contrasts=list(mk("alloparental_vs_control","Alloparental vs naive control males","control","alloparental"),
                 mk("infanticidal_vs_control","Infanticidal vs naive control males","control","infanticidal"),
                 mk("sire_vs_control","Sires vs naive control males","control","sire"),
                 mk("dam_vs_sire","Dams vs sires","sire","dam")),
  tracks=list(list(id="mpoa",label="Medial preoptic nuclei",matrix=matrix_path,samplesheet=ss_path,kind="counts")))
studies<-c(Filter(function(x)x$accession!="GSE314184",studies),list(s))
write_json(studies,manifest,pretty=TRUE,auto_unbox=TRUE)
