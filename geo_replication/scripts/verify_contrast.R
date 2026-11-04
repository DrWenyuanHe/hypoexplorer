#!/usr/bin/env Rscript
# CONTRAST-DIRECTION AUDIT. Two independent checks that "case" = HFD/obese and the
# comparison is HFD-vs-chow (not flipped):
#  (1) print the actual sample names in each group (they encode the diet);
#  (2) biological positive controls that are KNOWN to rise in obese/HFD hypothalamus
#      (Gfap astrogliosis; Aif1/Cd68 microglia) -> reported as log2 effect size + magnitude
#      verdict (negligible/weak/clear) + t-test p, NOT a binary "is it higher" test, so a
#      trivially-positive difference is not mistaken for biological validation.
suppressPackageStartupMessages({ library(AnnotationDbi); library(org.Mm.eg.db) })
gsd <- function(){a<-commandArgs(FALSE);f<-grep("^--file=",a,value=TRUE)
  if(length(f)) return(dirname(normalizePath(sub("^--file=","",f[1])))); getwd()}
ROOT <- normalizePath(file.path(gsd(),".."))
POS <- c("Gfap","Aif1","Cd68")   # expected UP in HFD/obese hypothalamus

cols <- c("id","dir","organism","id_type","id_col","id_map","input_kind","input_path","samplesheet","batch_var","status")
a <- read.delim(file.path(ROOT,"config","datasets.tsv"),stringsAsFactors=FALSE)
b <- tryCatch(read.delim(file.path(ROOT,"config","archived_datasets.tsv"),stringsAsFactors=FALSE),error=function(e) NULL)
cfg <- rbind(a[,cols], if(!is.null(b)) b[,cols]); cfg <- cfg[!grepl("deferred",cfg$status),]

read_expr <- function(path){
  if(grepl("series_matrix",path)){L<-readLines(gzfile(path));bb<-grep("!series_matrix_table_begin",L);e<-grep("!series_matrix_table_end",L)
    return(read.delim(text=L[(bb+1):(e-1)],check.names=FALSE,stringsAsFactors=FALSE))}
  con<-if(grepl("\\.gz$",path)) gzfile(path) else file(path); first<-readLines(con,n=1); close(con)
  sep<-if(grepl("\t",first))"\t" else if(grepl(",",first))"," else ""
  read.delim(if(grepl("\\.gz$",path)) gzfile(path) else path,sep=sep,check.names=FALSE,stringsAsFactors=FALSE)}

for(i in seq_len(nrow(cfg))){
  r<-cfg[i,]; ss<-read.delim(file.path(ROOT,r$samplesheet),stringsAsFactors=FALSE); ss<-ss[ss$group%in%c("control","case"),]
  df<-read_expr(file.path(ROOT,r$input_path))
  idc<-r$id_col; ids<-if(!is.na(idc)&&nzchar(idc)&&idc!="NA"&&idc%in%colnames(df)) df[[idc]] else df[[1]]
  ids<-as.character(ids); ids[is.na(ids)|ids==""]<-paste0("U",which(is.na(ids)|ids==""))
  m<-matrix(as.numeric(as.matrix(df[,ss$sample,drop=FALSE])),nrow=nrow(df),dimnames=list(ids,ss$sample))
  idt<-toupper(r$id_type); sym<-ids
  if(idt=="ENSEMBL"){mm<-mapIds(org.Mm.eg.db,sub("\\..*","",ids),"SYMBOL","ENSEMBL",multiVals="first");sym<-ifelse(is.na(mm),ids,unname(mm))}
  if(idt=="ENTREZID"){mm<-mapIds(org.Mm.eg.db,ids,"SYMBOL","ENTREZID",multiVals="first");sym<-ifelse(is.na(mm),ids,unname(mm))}
  if(grepl("^PROBE",idt)&&!is.na(r$id_map)&&r$id_map!="NA"){pm<-read.delim(file.path(ROOT,r$id_map),header=FALSE,stringsAsFactors=FALSE);mm<-pm$V2[match(ids,pm$V1)];sym<-ifelse(is.na(mm),ids,mm)}
  expr<-if(r$input_kind=="counts") sweep(m,2,pmax(colSums(m),1),"/")*1e6 else m
  ctl<-ss$sample[ss$group=="control"]; cas<-ss$sample[ss$group=="case"]
  cat(sprintf("\n==================== %s (%s) ====================\n", r$id, r$input_kind))
  cat(sprintf("  CONTROL (n=%d): %s\n", length(ctl), paste(head(ctl,4),collapse=", ")))
  cat(sprintf("  CASE    (n=%d): %s\n", length(cas), paste(head(cas,4),collapse=", ")))
  for(g in POS){ idx<-which(toupper(sym)==toupper(g)); if(!length(idx)){cat(sprintf("  %-5s: not found\n",g));next}
    v<-if(length(idx)>1) colSums(expr[idx,,drop=FALSE]) else expr[idx,]
    mc<-mean(v[ctl]); mk<-mean(v[cas])
    lfc<-if(r$input_kind=="counts") log2((mk+1)/(mc+1)) else (mk-mc)              # log2 effect size
    pv<-tryCatch(stats::t.test(v[cas], v[ctl])$p.value, error=function(e) NA_real_)
    mag<-if(is.na(lfc)) "?" else if(abs(lfc)<0.2) "NEGLIGIBLE" else if(abs(lfc)<0.5) "weak" else "clear"
    cat(sprintf("  %-5s: ctrl=%8.2f case=%8.2f | log2FC=%+.2f (%s in case, %s)  t-test p=%.3g\n",
        g, mc, mk, lfc, ifelse(mk>mc,"up","down"), mag, pv)) }
}
