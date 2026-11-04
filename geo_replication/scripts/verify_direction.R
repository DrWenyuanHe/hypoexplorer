#!/usr/bin/env Rscript
# DIRECTIONALITY AUDIT: independently re-derive IGFBP direction from raw per-group
# means (no edgeR/limma/fgsea), and check it agrees with the reported pathway NES.
# Confirms: positive NES == IGFBP genes genuinely HIGHER in the HFD/obese group.
suppressPackageStartupMessages({ library(AnnotationDbi); library(org.Mm.eg.db) })
gsd <- function(){a<-commandArgs(FALSE);f<-grep("^--file=",a,value=TRUE)
  if(length(f)) return(dirname(normalizePath(sub("^--file=","",f[1])))); getwd()}
ROOT <- normalizePath(file.path(gsd(),".."))
IGFBP <- c("Igfbp2","Igfbp5","Igfbp6","Igfbp7")

cols <- c("id","dir","organism","id_type","id_col","id_map","input_kind","input_path","samplesheet","batch_var","status")
a <- read.delim(file.path(ROOT,"config","datasets.tsv"), stringsAsFactors=FALSE)
b <- tryCatch(read.delim(file.path(ROOT,"config","archived_datasets.tsv"), stringsAsFactors=FALSE), error=function(e) NULL)
cfg <- rbind(a[,cols], if(!is.null(b)) b[,cols])
cfg <- cfg[!grepl("deferred", cfg$status), ]

read_expr <- function(path){
  if(grepl("series_matrix",path)){L<-readLines(gzfile(path));bb<-grep("!series_matrix_table_begin",L);e<-grep("!series_matrix_table_end",L)
    return(read.delim(text=L[(bb+1):(e-1)],check.names=FALSE,stringsAsFactors=FALSE))}
  con<-if(grepl("\\.gz$",path)) gzfile(path) else file(path); first<-readLines(con,n=1); close(con)
  sep<-if(grepl("\t",first))"\t" else if(grepl(",",first))"," else ""
  read.delim(if(grepl("\\.gz$",path)) gzfile(path) else path, sep=sep, check.names=FALSE, stringsAsFactors=FALSE)
}
out <- list()
for(i in seq_len(nrow(cfg))){
  r<-cfg[i,]; ss<-read.delim(file.path(ROOT,r$samplesheet),stringsAsFactors=FALSE)
  ss<-ss[ss$group%in%c("control","case"),]
  df<-read_expr(file.path(ROOT,r$input_path))
  idc<-r$id_col; ids<-if(!is.na(idc)&&nzchar(idc)&&idc!="NA"&&idc%in%colnames(df)) df[[idc]] else df[[1]]
  ids<-as.character(ids); ids[is.na(ids)|ids==""]<-paste0("U",which(is.na(ids)|ids==""))
  m<-matrix(as.numeric(as.matrix(df[,ss$sample,drop=FALSE])),nrow=nrow(df),dimnames=list(ids,ss$sample))
  idt<-toupper(r$id_type); sym<-ids
  if(idt=="ENSEMBL"){mm<-mapIds(org.Mm.eg.db,sub("\\..*","",ids),"SYMBOL","ENSEMBL",multiVals="first");sym<-ifelse(is.na(mm),ids,unname(mm))}
  if(idt=="ENTREZID"){mm<-mapIds(org.Mm.eg.db,ids,"SYMBOL","ENTREZID",multiVals="first");sym<-ifelse(is.na(mm),ids,unname(mm))}
  if(grepl("^PROBE",idt)&&!is.na(r$id_map)&&r$id_map!="NA"){pm<-read.delim(file.path(ROOT,r$id_map),header=FALSE,stringsAsFactors=FALSE);mm<-pm$V2[match(ids,pm$V1)];sym<-ifelse(is.na(mm),ids,mm)}
  # expression scale: counts -> CPM; matrix -> as-is (already normalized)
  expr <- if(r$input_kind=="counts") sweep(m,2,pmax(colSums(m),1),"/")*1e6 else m
  ctl<-ss$sample[ss$group=="control"]; cas<-ss$sample[ss$group=="case"]
  nhi<-0; lfc<-c()
  for(g in IGFBP){ idx<-which(toupper(sym)==toupper(g)); if(!length(idx)) next
    v<-if(length(idx)>1) colSums(expr[idx,,drop=FALSE]) else expr[idx,]
    mc<-mean(v[ctl]); mk<-mean(v[cas]); if(mk>mc) nhi<-nhi+1
    lfc<-c(lfc, if(r$input_kind=="counts") log2((mk+1)/(mc+1)) else (mk-mc)) }
  # reported NES
  fp<-file.path(ROOT,r$dir,"processed",paste0(r$id,"_fgsea.tsv"))
  nes<-NA; if(file.exists(fp)){fg<-read.delim(fp,stringsAsFactors=FALSE);row<-fg[grepl("IGF_TRANSPORT_AND_UPTAKE",fg$pathway),];if(nrow(row)) nes<-row$NES[1]}
  out[[r$id]]<-data.frame(dataset=r$id, n_ctrl=length(ctl), n_case=length(cas),
    IGFBPs_higher_in_HFD=sprintf("%d/4",nhi), mean_IGFBP_dir=ifelse(mean(lfc)>0,"UP in HFD","down in HFD"),
    NES=round(nes,2), NES_dir=ifelse(is.na(nes),"?",ifelse(nes>0,"UP in HFD","down in HFD")),
    consistent=ifelse(is.na(nes),"?", ifelse((mean(lfc)>0)==(nes>0),"YES","NO")))
}
res<-do.call(rbind,out)
cat("=== independent IGFBP direction (raw group means) vs reported pathway NES ===\n\n")
print(res, row.names=FALSE)
