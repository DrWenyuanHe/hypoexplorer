"""Evidence-only follow-up of three fixed datasets; never writes registered outputs."""
from pathlib import Path
import gzip
import hashlib
import json
import re
import sys
import numpy as np
import pandas as pd
from lxml import etree
from openpyxl import load_workbook
from scipy.stats import pearsonr,spearmanr

ROOT=Path.cwd()
BASE=ROOT/'data/author-validation/continued-sources/ten-dataset-followup-2026-09-04'
CONFIG={
 'GSE98519':('GSE98519_mmus_hypothalamus_lef1','PMC5570277','GSE98519_P22_S6_Table.xlsx'),
 'GSE160467':('GSE160467_mmus_gt17_mkrn3','PMC8053111','GSE160467_author_DE.csv.gz'),
 'GSE270378':('GSE270378_mmus_mhypoa_cbd','PMC12605594','GSE270378_13353_2025_970_MOESM3_ESM.xlsx'),
}

def dump(path,value):
 def clean(v):
  if isinstance(v,dict):return {k:clean(x) for k,x in v.items()}
  if isinstance(v,(list,tuple)):return [clean(x) for x in v]
  if isinstance(v,np.integer):return int(v)
  if isinstance(v,(float,np.floating)):return float(v) if np.isfinite(v) else None
  if isinstance(v,np.bool_):return bool(v)
  return v
 path.write_text(json.dumps(clean(value),indent=2,ensure_ascii=False,allow_nan=False)+'\n',encoding='utf-8')

def inspect_sources():
 for acc,(folder,pmc,authorfile) in CONFIG.items():
  out=BASE/acc; source=ROOT/'geo_replication/datasets'/folder
  paper=etree.parse(str(out/(pmc+'.xml')))
  blocks=[]
  for node in paper.xpath('//body//sec'):
   title=' '.join(node.xpath('./title//text()'))
   if re.search('RNA|sequenc|bioinformat|transcript|animal|statistic|treatment|cell culture|data avail',title,re.I):
    blocks.append({'title':title,'text':' '.join(node.itertext())})
  dump(out/'paper-methods-extracted.json',blocks)
  print(acc,'PAPER sections',[(b['title'],len(b['text'])) for b in blocks])
  soft=gzip.open(source/'metadata'/(acc+'_family.soft.gz'),'rt',encoding='utf-8').read()
  samples=[]
  for block in re.split(r'(?m)^\^SAMPLE = ',soft)[1:]:
   fields={}
   for line in block.splitlines()[1:]:
    if line.startswith('!Sample_') and ' = ' in line:
     key,val=line.split(' = ',1)
     if any(s in key for s in ['title','source_name','characteristics','data_processing','extract_protocol','treatment_protocol','growth_protocol']):
      fields.setdefault(key.replace('!Sample_',''),[]).append(val)
   samples.append({'accession':block.splitlines()[0],'fields':fields})
  dump(out/'GEO-sample-metadata.json',samples)
  print(acc,'GEO samples',len(samples))
  author=ROOT/'geo_replication/datasets/_author_de'/authorfile
  if author.suffix=='.xlsx':
   book=load_workbook(author,read_only=True,data_only=True)
   print(acc,'WORKBOOK',[(s.title,s.max_row,s.max_column,list(s.values)[:2]) for s in book])
   book.close()
  else:
   d=pd.read_csv(author)
   print(acc,'AUTHOR',d.shape,d.head(2).to_dict('records'))
  for path in sorted((source/'raw').glob('*.gz')):
   with gzip.open(path,'rt',encoding='utf-8') as f:
    print(acc,'RAW',path.name,[next(f).strip() for _ in range(3)])

def prepare():
 for acc,(folder,pmc,authorfile) in CONFIG.items():
  source=ROOT/'geo_replication/datasets'/folder; out=BASE/acc
  authorpath=ROOT/'geo_replication/datasets/_author_de'/authorfile
  ss=pd.read_csv(source/'metadata'/(acc+'_samplesheet.tsv'),sep='\t')
  ss.to_csv(out/'registered-samples.tsv',sep='\t',index=False)
  if acc=='GSE98519':
   a=pd.read_excel(authorpath,sheet_name='Analyzed Genes').set_index('IGB HyperLink')
   c=pd.read_csv(source/'raw/GSE98519_12400R_counts.txt.gz',sep='\t').set_index('id')
   assert a.index.is_unique and c.index.is_unique and set(a.index)==set(c.index)
   for acol,ccol in zip(['Counts Mut_1','Counts Mut_2','Counts Mut_3','Counts WT_1','Counts WT_2','Counts WT_3'],['12400X2','12400X4','12400X6','12400X1','12400X3','12400X5']):
    assert np.array_equal(a[acol],c.loc[a.index,ccol]), f'Author raw counts mismatch {acol}'
   aout=pd.DataFrame({'feature_id':a.index,'symbol':a['Associated Gene Name'],'effect':a['Log2Ratio Mut_vs_WT'],'p':a['pvalue Mut_vs_WT'],'q':10.**(-a['-10lg(AdjP) Mut_vs_WT']/10)}).reset_index(drop=True)
   aout['reported_transformed_q']=a['-10lg(AdjP) Mut_vs_WT'].to_numpy()
   aout['reported_q_including_ambiguous_zero_score']=aout.q
   # USeq's prepublication parser writes missing adjusted P as transformed 0.
   # A 0 score cannot distinguish a missing q from q=1. Exclude both possibilities.
   aout.loc[aout.reported_transformed_q==0,'q']=np.nan
   audit={'all_author_source_counts_equal':True,'count_values_checked':len(a)*6,'source_rows':len(c),'author_rows':len(a)}
   fit=c.loc[:,ss['sample']].copy()
  elif acc=='GSE160467':
   a=pd.read_csv(authorpath); c=pd.read_csv(source/'raw/GSE160467_MKRN3_vs_WT_counts.tsv.gz',sep='\t').set_index('gene_id')
   for sample in ss['sample']:
    paths=list((source/'raw/source').glob(sample+'_*.gz')); assert len(paths)==1
    original=pd.read_csv(paths[0],sep='\t',header=None,names=['feature_id','count']).set_index('feature_id')
    assert original.index.is_unique and set(c.index)<=set(original.index)
    assert np.array_equal(original.loc[c.index,'count'],c[sample])
   ncols=['con_1','con_2','con_3','exp_1','exp_2','exp_3']
   shared=a[a.Gene.isin(c.index)].copy(); rawshared=c.loc[shared.Gene,ss['sample']].to_numpy(float)
   norm=shared[ncols].to_numpy(float)
   ratios=np.divide(rawshared,norm,out=np.full_like(rawshared,np.nan),where=norm>0)
   sf=np.nanmedian(ratios,axis=0)
   recovered_counts=np.rint(a[ncols].to_numpy(float)*sf)
   error=np.abs(a[ncols].to_numpy(float)*sf-recovered_counts)
   # The CSV rounds normalized values. Even million-count rows must recover
   # within 0.01 count, then match the actual integer source vector exactly.
   assert np.nanmax(error)<.01
   candidates={}
   for gene,values in zip(c.index,c[ss['sample']].to_numpy()):
    candidates.setdefault(tuple(values),[]).append(gene)
   mapped=[]; recoveries=[]
   for i,row in a.iterrows():
    candidate=candidates.get(tuple(recovered_counts[i]),[])
    if row.Gene in c.index:
     assert row.Gene in candidate
     gene=row.Gene
    else:
     assert len(candidate)==1, f'Ambiguous damaged label {i}: {candidate}'
     gene=candidate[0]
     recoveries.append({'source_row_index':i,'original_author_label':row.Gene,'recovered_source_gene_id':gene,'max_raw_count_recovery_error':float(error[i].max()),'basis':'Unique exact six-library integer count vector after reversing author normalization; no date-name guessing'})
    mapped.append(gene)
   assert len(set(mapped))==len(mapped)
   aout=pd.DataFrame({'feature_id':mapped,'original_author_label':a.Gene,'symbol':mapped,'effect':a.log2FoldChange,'p':a.pvalue,'q':a.padj})
   for col in ncols:aout['author_normalized_'+col]=a[col]
   dump(out/'recovered-author-labels.json',recoveries)
   elig=c[(c>0).sum(axis=1)>=3]
   eligible_only=elig.loc[~elig.index.isin(mapped)]
   eligible_only.to_csv(out/'paper-count-filter-genes-absent-author.tsv',sep='\t',index_label='feature_id')
   audit={'source_rows':len(c),'all_registered_source_counts_equal':True,'registered_count_values_checked':int(c.size),'paper_detected_in_at_least_3_rows':len(elig),'author_rows':len(a),'recovered_labels':len(recoveries),'max_raw_count_recovery_error':float(error.max()),'normalization_size_factors_from_author':sf.tolist(),'paper_filter_rows_missing_author':eligible_only.index.tolist(),'author_genes_outside_paper_count_filter':sorted(set(mapped)-set(elig.index))}
   fit=c.loc[mapped,ss['sample']].copy()
   pd.DataFrame({'sample':ss['sample'],'size_factor':sf}).to_csv(out/'author-normalization-size-factors.tsv',sep='\t',index=False)
  else:
   a=pd.read_excel(authorpath,sheet_name='24h').set_index('ensembl_ID')
   aout=pd.DataFrame({'feature_id':a.index,'symbol':a.symbol.str.strip(),'effect':-a['CTR_24h_A-CBD3_24h_A_log2FC'],'p':np.nan,'q':a['CTR_24h_A-CBD3_24h_A_adjPval']}).reset_index(drop=True)
   libs=[]; info=[]
   for p in sorted((source/'raw/source').glob('GSM*_A*count.txt.gz')):
    number=int(re.search(r'_A(\d+)count',p.name)[1])
    if number<16:continue
    d=pd.read_csv(p,sep='\t',header=None,names=['feature_id','count']).set_index('feature_id')
    assert d.index.is_unique
    gsm=p.name.split('_')[0]
    libs.append(d['count'].rename(gsm))
    condition='control' if number>=28 else 'CBD3' if number<=18 else 'CBD1p5' if number<=21 else 'CBD0p75' if number<=24 else 'CBD0p325'
    info.append({'sample':gsm,'group':condition,'source_library':'A'+str(number),'replicate':(number-16)%3+1})
   c=pd.concat(libs,axis=1); assert c.notna().all().all()
   selected=pd.read_csv(source/'raw/GSE270378_CBD3_24h_vs_CTR_24h_counts.tsv.gz',sep='\t').set_index('gene_id')
   assert np.array_equal(c.loc[selected.index,selected.columns],selected)
   eligible=a.index[a['CTR_24h_A-CBD3_24h_A_log2FC'].notna()]
   assert set(eligible)<=set(c.index)
   fit=c.loc[eligible].copy()
   pd.DataFrame(info).to_csv(out/'all-24h-samples.tsv',sep='\t',index=False)
   expr=a.loc[eligible,a.columns[a.columns.str.contains(r'_A\d+$')]].copy()
   expr.to_csv(out/'author-processed-expression.tsv',sep='\t',index_label='feature_id')
   audit={'source_rows':len(c),'author_annotation_rows':len(a),'author_finite_effects':len(eligible),'author_finite_FDR':int(aout.q.notna().sum()),'author_finite_effects_missing_FDR':int((aout.effect.notna()&aout.q.isna()).sum()),'all_registered_source_counts_equal':True,'registered_count_values_checked':int(selected.size),'all_24h_libraries':len(info),'author_raw_P_available':False}
  aout.to_csv(out/'author-canonical.tsv',sep='\t',index=False,na_rep='NA')
  fit.to_csv(out/'author-universe-counts.tsv',sep='\t',index_label='feature_id')
  dump(out/'source-reconciliation.json',audit)
  print(acc,json.dumps(audit))

def metric(a,b,rules):
 assert a.index.is_unique and b.index.is_unique
 j=a[['effect','p','q']].add_prefix('author_').join(b[['effect','p','q']].add_prefix('tested_'),how='outer')
 j['author_row_present']=j.index.isin(a.index);j['tested_row_present']=j.index.isin(b.index)
 fe=np.isfinite(j.author_effect)&np.isfinite(j.tested_effect)
 fq=np.isfinite(j.author_q)&np.isfinite(j.tested_q)
 fp=np.isfinite(j.author_p)&np.isfinite(j.tested_p)
 out={'author_rows':len(a),'tested_rows':len(b),'shared_rows':int((j.author_row_present&j.tested_row_present).sum()),'paired_finite_effects':int(fe.sum()),'paired_finite_raw_P':int(fp.sum()),'paired_finite_FDR':int(fq.sum()),'author_finite_FDR':int(a.q.notna().sum()),'tested_finite_FDR':int(b.q.notna().sum()),'effects':{},'inference':{} }
 if fe.sum()>1:
  x,y=j.loc[fe,'author_effect'],j.loc[fe,'tested_effect'];d=abs(x-y)
  out['effects']={'pearson':pearsonr(x,y).statistic,'spearman':spearmanr(x,y).statistic,'median_abs_delta':d.median(),'max_abs_delta':d.max(),'same_direction':int((np.sign(x)==np.sign(y)).sum()),'n_abs_delta_gt_0p001':int((d>.001).sum()),'n_abs_delta_gt_0p01':int((d>.01).sum())}
 for which,mask in [('raw_P',fp),('FDR',fq)]:
  if mask.sum():
   d=abs(j.loc[mask,'author_'+('p' if which=='raw_P' else 'q')]-j.loc[mask,'tested_'+('p' if which=='raw_P' else 'q')])
   out['inference'][which]={'median_abs_delta':d.median(),'max_abs_delta':d.max()}
 out['rules']={}
 for label,q,lfc,operator in rules:
  aq=j.author_q<q if operator=='<' else j.author_q<=q
  bq=j.tested_q<q if operator=='<' else j.tested_q<=q
  ac=np.isfinite(j.author_q)&aq&np.isfinite(j.author_effect)&(j.author_effect.abs()>=lfc)
  bc=np.isfinite(j.tested_q)&bq&np.isfinite(j.tested_effect)&(j.tested_effect.abs()>=lfc)
  eligible=fq&fe
  union=(ac|bc)&eligible;overlap=ac&bc&eligible
  out['rules'][label]={'FDR_threshold':q,'FDR_operator':operator,'absolute_log2FC_gte':lfc,'paired_finite_tested_universe':int(eligible.sum()),'all_observed_author_calls':int(ac.sum()),'all_observed_tested_calls':int(bc.sum()),'all_observed_called_ID_overlap':int((ac&bc).sum()),'paired_author_calls':int((ac&eligible).sum()),'paired_tested_calls':int((bc&eligible).sum()),'paired_overlap':int(overlap.sum()),'paired_jaccard':overlap.sum()/union.sum() if union.any() else None,'author_only_finite_IDs':j.index[ac&~bc&eligible].tolist(),'tested_only_finite_IDs':j.index[bc&~ac&eligible].tolist(),'author_called_tested_FDR_missing_IDs':j.index[ac&~np.isfinite(j.tested_q)].tolist(),'tested_called_author_FDR_missing_IDs':j.index[bc&~np.isfinite(j.author_q)].tolist()}
  j['author_call_'+label]=pd.array(np.where(np.isfinite(j.author_q)&np.isfinite(j.author_effect),ac,None),dtype='boolean')
  j['tested_call_'+label]=pd.array(np.where(np.isfinite(j.tested_q)&np.isfinite(j.tested_effect),bc,None),dtype='boolean')
 j['paired_finite_FDR']=fq;j['paired_finite_effects']=fe
 return out,j

def compare():
 for acc,(folder,pmc,authorfile) in CONFIG.items():
  out=BASE/acc;a=pd.read_csv(out/'author-canonical.tsv',sep='\t').set_index('feature_id')
  localpath=ROOT/'geo_replication/datasets'/folder/'processed'/(acc+'_DE.tsv')
  local=pd.read_csv(localpath,sep='\t').set_index('id').rename(columns={'logFC':'effect','pvalue':'p','padj':'q'})
  rules=[('FDR05',.05,0,'<=')]
  if acc=='GSE160467':rules.append(('paper',.05,1,'<='))
  if acc=='GSE270378':rules.append(('paper',.1,0,'<'))
  result={'dataset':acc,'mapping':'Exact source IDs; GSE160467 damaged labels recovered by unique six-count vectors','source':json.loads((out/'source-reconciliation.json').read_text()),'comparisons':{}}
  for label,b in [('registered',local)]+[(p.stem,pd.read_csv(p,sep='\t').set_index('feature_id').rename(columns={'log2FoldChange':'effect','pvalue':'p','padj':'q'})) for p in sorted(out.glob('DESeq2-*.tsv')) if not p.stem.endswith(('normalized-counts','comparison'))]:
   m,j=metric(a,b,rules)
   result['comparisons'][label]=m
   j.to_csv(out/(label+'-comparison.tsv'),sep='\t',index_label='feature_id',na_rep='NA')
  if acc=='GSE98519':
   zero=a.reported_transformed_q==0
   result['ambiguous_zero_transformed_q_rows']=int(zero.sum())
   result['ambiguous_zero_transformed_q_ids']=a.index[zero].tolist()
  dump(out/'comparison-summary.json',result)
  print(acc)
  for label,m in result['comparisons'].items():
   print(label,{k:m[k] for k in ['paired_finite_effects','paired_finite_raw_P','paired_finite_FDR','effects','inference']})
   print('calls',{r:{k:v for k,v in x.items() if not k.endswith('IDs')} for r,x in m['rules'].items()})

AUTHOR_URLS={
 'GSE98519':'https://journals.plos.org/plosbiology/article/file?type=supplementary&id=info:doi/10.1371/journal.pbio.2002257.s012',
 'GSE160467':'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE160nnn/GSE160467/suppl/GSE160467_MKRN3_control_DEseq2.csv.gz',
 'GSE270378':'https://pmc-oa-opendata.s3.amazonaws.com/PMC12605594.1/13353_2025_970_MOESM3_ESM.xlsx',
}

def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()

def manifest():
 for acc,(folder,pmc,authorfile) in CONFIG.items():
  out=BASE/acc; source=ROOT/'geo_replication/datasets'/folder
  existing_manifest=source/'metadata'/(acc+'_source_files.tsv')
  recorded=pd.read_csv(existing_manifest,sep='\t') if existing_manifest.exists() else None
  urls=dict(zip(recorded['file'],recorded['source'])) if recorded is not None else {}
  soft=source/'metadata'/(acc+'_family.soft.gz')
  if soft.name not in urls:urls[soft.name]='https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc='+acc
  for line in gzip.open(soft,'rt',encoding='utf-8'):
   if 'supplementary_file' in line and ' = ' in line:
    url=line.strip().split(' = ',1)[1]
    if url.startswith(('http','ftp')):urls[url.rsplit('/',1)[-1]]=url
  urls[authorfile]=AUTHOR_URLS[acc]
  urls[pmc+'.xml']='https://www.ebi.ac.uk/europepmc/webservices/rest/'+pmc+'/fullTextXML'
  commit='df88a0d960a84d68087a917828712ef9280ab80d'
  prefix='https://raw.githubusercontent.com/HuntsmanCancerInstitute/USeq/'
  urls['DefinedRegionDifferentialSeq-2016.java']=prefix+commit+'/Source/edu/utah/seq/analysis/DefinedRegionDifferentialSeq.java'
  urls['PairedCondition-2016.java']=prefix+commit+'/Source/edu/utah/seq/analysis/multi/PairedCondition.java'
  urls['DefinedRegionDifferentialSeq-current.java']=prefix+'master/Source/edu/utah/seq/analysis/DefinedRegionDifferentialSeq.java'
  urls['USeq-prepublication-commit.json']='https://api.github.com/repos/HuntsmanCancerInstitute/USeq/commits?path=Source/edu/utah/seq/analysis/DefinedRegionDifferentialSeq.java&until=2017-04-28T00:00:00Z&per_page=1'
  files={ROOT/'geo_replication/datasets/_author_de'/authorfile:'original_author_result',soft:'original_GEO_metadata',source/'metadata'/(acc+'_samplesheet.tsv'):'registered_sample_metadata',source/'processed'/(acc+'_DE.tsv'):'registered_result_input'}
  if existing_manifest.exists():files[existing_manifest]='existing_source_manifest'
  else:files[source/'README.md']='existing_source_hash_documentation'
  for p in (source/'raw').glob('*.gz'):files[p]='source_counts' if acc=='GSE98519' else 'registered_merged_source_counts'
  if acc!='GSE98519':
   for p in (source/'raw/source').glob('*.gz'):
    if acc=='GSE270378' and int(re.search(r'_A(\d+)count',p.name)[1])<16:continue
    files[p]='original_GEO_count_file'
  for p in ROOT.glob('scripts/followup10_GSE98519_GSE160467_GSE270378.*'):files[p]='reproduction_script'
  for p in out.iterdir():
   if p.is_file() and p.name!='manifest.json':files[p]='retained_public_reference' if p.name in urls else 'evidence_only_output'
  entries=[{'path':p.relative_to(ROOT).as_posix(),'role':role,'bytes':p.stat().st_size,'sha256':sha(p),'sourceURL':urls.get(p.name)} for p,role in sorted(files.items(),key=lambda pair:str(pair[0]))]
  dump(out/'manifest.json',{'schemaVersion':1,'dataset':acc,'reviewDate':'2026-09-04','scope':'Evidence-only audit; registered_result_input is read-only, never an author source','Python':sys.version,'numpy':np.__version__,'pandas':pd.__version__,'files':entries})
  print(acc,'manifest entries',len(entries))

def check():
 expected={'GSE98519':(16819,16818,4,2),'GSE160467':(6252,6252,760,1129),'GSE270378':(11242,9373,7,1)}
 for acc in CONFIG:
  out=BASE/acc; man=json.loads((out/'manifest.json').read_text())
  for entry in man['files']:
   path=ROOT/entry['path'];assert path.is_file() and path.stat().st_size==entry['bytes'] and sha(path)==entry['sha256'], 'Manifest mismatch: '+str(path)
  proposal=json.loads((out/'proposed-updates.json').read_text())
  assert set(proposal)=={'datasetId','manualReview','verificationReview','profileUpdates'}
  profile=proposal['profileUpdates']
  assert set(profile['dimensions'])=={'cohort','contrast','features','effects','inference','coverage'}
  assert profile['target']=='registered_output' and profile['assessment']=='limited'
  assert not proposal['verificationReview']['fullyVerifiedContrasts']
  summary=json.loads((out/'comparison-summary.json').read_text())
  registered=summary['comparisons']['registered'];rule=registered['rules']['FDR05']
  assert (registered['paired_finite_effects'],registered['paired_finite_FDR'],rule['paired_author_calls'],rule['paired_tested_calls'])==expected[acc]
  assert registered['paired_finite_FDR']<=registered['paired_finite_effects']
  if acc=='GSE98519':
   assert summary['ambiguous_zero_transformed_q_rows']==2
   assert summary['comparisons']['DESeq2-current-default']['rules']['FDR05']['paired_jaccard']==1
  elif acc=='GSE160467':
   assert len(json.loads((out/'recovered-author-labels.json').read_text()))==20
   fit=summary['comparisons']['DESeq2-author-normalization']
   assert fit['paired_finite_FDR']==9500 and fit['rules']['paper']['all_observed_author_calls']==749
   assert fit['rules']['paper']['paired_jaccard']==1
  else:
   assert registered['rules']['paper']['FDR_operator']=='<'
   fit=summary['comparisons']['DESeq2-all-24h-groups']
   assert fit['paired_finite_FDR']==9374 and fit['rules']['paper']['all_observed_author_calls']==13
   assert fit['rules']['paper']['paired_jaccard']==1
  print(acc,'PASS: source/output SHA-256, reviewed counts, finite-FDR denominators, exact reconstruction call sets, proposal scope')

if __name__=='__main__':
 if '--inspect' in sys.argv: inspect_sources()
 elif '--compare' in sys.argv:compare()
 elif '--manifest' in sys.argv:manifest()
 elif '--check' in sys.argv:check()
 else: prepare()
