from september5_common import *

acc='GSE135007';files=sorted((dataset_dir(acc)/'raw').glob('*.genes.results.txt.gz'))
assert len(files)==20
counts=[];lengths=[];abundance=[];names=[];ids=None
for file in files:
    f=pd.read_csv(file,sep='\t')
    if ids is None:ids=f.gene_id
    else:assert ids.equals(f.gene_id)
    counts.append(f.expected_count.to_numpy());lengths.append(f.effective_length.to_numpy());abundance.append(f.TPM.to_numpy());names.append(file.name.split('_')[0])
c=np.column_stack(counts);l=np.column_stack(lengths);t=np.column_stack(abundance)
assert np.isfinite(c).all() and (c>=0).all() and (l>=0).all() and (t>=0).all()
scaled=t*l.mean(axis=1)[:,None];scaled=scaled/scaled.sum(axis=0)*c.sum(axis=0)
assert np.allclose(scaled.sum(axis=0),c.sum(axis=0),rtol=1e-12,atol=1e-6)
frame=pd.DataFrame(scaled,columns=names);info={};arm={'control':[],'gough':[]}
for s in soft_records(ROOT/LEDGER[acc]['metadata']):
    if s['kind']!='SAMPLE' or s['accession'] not in names:continue
    char=dict(x.split(': ',1) for x in s['Sample_characteristics_ch1'])
    assert char['tissue']=='hypothalamus' and char['age']=='4 weeks'
    group='gough' if char['strain']=='Gough' else 'control'
    assert char['strain'] in ['Gough','WSB/EiJ','WSB'],char
    arm[group].append(s['accession']);info[s['accession']]={'animal':s['Sample_title'][0].split('(')[1].rstrip(')'),
        'gsm':s['accession'],'sex':char['Sex'],'unit':'mouse'}
assert len(arm['control'])==len(arm['gough'])==10
add(acc,'Mouse hypothalamus Gough Island divergence','Reproduction & development','Whole hypothalamus','Bulk tissue','Genetic',
    frame,ids,['']*len(ids),groups(control=('WSB strain',arm['control']),gough=('Gough Island',arm['gough'])),
    [contrast('gough_vs_wsb','Gough Island vs WSB, adjusted for sex','control','gough','sex')],info,
    note='Ten four-week-old Gough Island and ten WSB hypothalamus samples, each strain with five females and five males. RSEM expected counts, TPM and effective lengths supply a lengthScaledTPM import that preserves library totals. The model adjusts for sex. Litter identity is unavailable in the deposited sample metadata, so litter effects cannot be separated.',kind='counts')
pd.DataFrame({'sample':names,'source_expected_counts':c.sum(axis=0),'length_scaled_counts':scaled.sum(axis=0)}).to_csv(
    dataset_dir(acc)/'processed/length_correction_qc.tsv',sep='\t',index=False)
path=OUT/'studies.json';previous=json.loads(path.read_text(encoding='utf-8'))
path.write_text(json.dumps([s for s in previous if s['accession']!=acc]+STUDIES,indent=2)+'\n',encoding='utf-8')
