"""Additional public normalized matrices and RSEM count import."""
from september5_common import *

acc='GSE224274'
f=pd.read_csv(dataset_dir(acc)/'raw'/f'{acc}_CPM-Gys.txt.gz',sep='\t')
assert len(f)==5764, 'The deposited gene universe changed; review its scope before reprocessing'
info={c:{'animal':c.split('-')[0],'unit':'mouse'} for c in f.columns[1:]}
add(acc,'Mouse POMC response to food cues','Feeding & fasting','Arcuate nucleus','Translatome','Fasting & feeding',
    f,f.iloc[:,0],f.iloc[:,0],groups(control=('Nonedible object',[c for c in f if '-NEO-' in c]),
    food=('Inaccessible food cues',[c for c in f if '-SENS-' in c])),
    [contrast('food_cues_vs_object','Food cues vs nonedible object','control','food')],info,
    note='Six POMC-RiboTag mice per condition after a 16-hour fast. Only the 5,764 genes in the deposited CPM matrix are available; results and pathway coverage are restricted to that gene universe. The matrix is summed on the linear scale for duplicate symbols and transformed as log2(CPM+1) for limma. Counts are not reconstructed from CPM. Cage identifiers are not deposited.',kind='matrix')
STUDIES[-1]['expressionUnit']='log2(CPM + 1)'

acc='GSE308884';file=dataset_dir(acc)/'raw'/f'{acc}_raw_and_normalized_counts.xlsx'
f=pd.read_excel(file,sheet_name='log2_cpms');genes=pd.read_excel(file,sheet_name='genes').set_index('feature_id');ss=pd.read_excel(file,sheet_name='samples')
assert set(f.feature_id)==set(genes.index) and not f.feature_id.duplicated().any()
mapped=genes.loc[f.feature_id]
info={r.sample_id:{'animal':r.sample_id,'unit':'mouse','sex':r.sex} for r in ss.itertuples()}
arms={k:ss.loc[ss['group']==v,'sample_id'].tolist() for k,v in [('vehicle','Vehicle'),('drug','TN-783'),('lean','Control')]}
add(acc,'Mouse hypothalamus TN-783 in diet-induced obesity','Incretin & pharmacology','Whole hypothalamus','Bulk tissue','Drug & hormone',
    f,mapped.gene_id.to_list(),mapped.symbol.to_list(),groups(vehicle=('DIO vehicle',arms['vehicle']),drug=('DIO TN-783',arms['drug']),lean=('Lean untreated',arms['lean'])),
    [contrast('tn783_vs_vehicle','TN-783 vs vehicle in DIO','vehicle','drug'),contrast('dio_vs_lean','DIO vehicle vs lean untreated','lean','vehicle')],info,
    note='Six mice each in lean untreated, diet-induced obese vehicle and DIO TN-783 groups. Limma uses the author-supplied log2 CPM sheet without a second logarithm or count model. Duplicate gene-symbol rows are averaged on the supplied log scale. Salmon estimates are retained in the workbook but are not treated as integer raw counts.',kind='matrix_log')
STUDIES[-1]['expressionUnit']='Author log2 CPM'

acc='GSE281701';files=sorted((dataset_dir(acc)/'raw').glob('*.genes.results.gz'))
assert len(files)==6
counts=[];lengths=[];abundance=[];names=[];ids=None
for file in files:
    f=pd.read_csv(file,sep='\t')
    if ids is None:ids=f.gene_id
    else:assert ids.equals(f.gene_id)
    counts.append(f.expected_count.to_numpy());lengths.append(f.effective_length.to_numpy());abundance.append(f.TPM.to_numpy());names.append(file.name.split('_')[0])
c=np.column_stack(counts);l=np.column_stack(lengths);t=np.column_stack(abundance)
assert np.isfinite(c).all() and (c>=0).all() and (l>=0).all() and (t>=0).all()
# tximport lengthScaledTPM formula: gene TPM * across-sample mean effective
# length, scaled back to each source library's expected-count total.
scaled=t*l.mean(axis=1)[:,None];scaled=scaled/scaled.sum(axis=0)*c.sum(axis=0)
assert np.allclose(scaled.sum(axis=0),c.sum(axis=0),rtol=1e-12,atol=1e-6)
frame=pd.DataFrame(scaled,columns=names);info={};arm={'control':[],'cachexia':[]}
record=LEDGER[acc]
for s in soft_records(ROOT/record['metadata']):
    if s['kind']!='SAMPLE' or s['accession'] not in names:continue
    title=s['Sample_title'][0];group='cachexia' if 'CT-26 cell injection' in s.get('Sample_characteristics_ch1',[])[-1] or 'cachectic' in title.lower() else 'control'
    arm[group].append(s['accession']);info[s['accession']]={'animal':title,'gsm':s['accession'],'unit':'mouse'}
assert len(arm['control'])==len(arm['cachexia'])==3, arm
add(acc,'Mouse hypothalamus cancer cachexia','Stress, immune & disease','Whole hypothalamus','Bulk tissue','Environment & stress',
    frame,ids,['']*len(ids),groups(control=('Healthy control',arm['control']),cachexia=('CT-26 cachexia',arm['cachexia'])),
    [contrast('cachexia_vs_control','CT-26 cachexia vs healthy control','control','cachexia')],info,
    note='Three CT-26 cachexia and three healthy mice. Only hypothalamus samples are included. Deposited RSEM gene TPM, effective lengths and expected counts are imported with lengthScaledTPM correction; fractional estimates are retained. Each corrected library preserves its original expected-count total.')
pd.DataFrame({'sample':names,'source_expected_counts':c.sum(axis=0),'length_scaled_counts':scaled.sum(axis=0)}).to_csv(
    dataset_dir(acc)/'processed/length_correction_qc.tsv',sep='\t',index=False)

path=OUT/'studies.json';previous=json.loads(path.read_text(encoding='utf-8'))
replaced={s['accession'] for s in STUDIES}
path.write_text(json.dumps([s for s in previous if s['accession'] not in replaced]+STUDIES,indent=2)+'\n',encoding='utf-8')
