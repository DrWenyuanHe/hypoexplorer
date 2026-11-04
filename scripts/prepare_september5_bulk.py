from september5_common import *

acc='GSE317867'
f=pd.read_csv(dataset_dir(acc)/'raw'/f'{acc}_merged.gene_count_matrix.csv.gz')
info={}
for s in soft_records(ROOT/LEDGER[acc]['metadata']):
    if s['kind']!='SAMPLE': continue
    title=s['Sample_title'][0]
    n=int(re.search(r'rep#(\d+)',title)[1])
    rebound='rebound' in title
    ip='(IP)' in title
    col=(f'RS{n}_IP' if ip else f'RS{n}Input') if rebound else f'C{n}_'+('IP' if ip else 'Input')
    info[col]={'gsm':s['accession'],'animal':('RS' if rebound else 'C')+str(n),'unit':'pool of 7 mice',
               'reason':'' if ip else 'Paired input assay; not an additional biological replicate'}
add(acc,'Mouse PVN sleep-rebound ensembles','Circadian','Paraventricular nucleus (BacTRAP IP)',
    'TRAP / RiboTag','Circadian & sleep',f,f.gene_id,f.gene_name,
    groups(control=('Control sleep',[f'C{i}_IP' for i in range(1,6)]),rebound=('Rebound sleep',[f'RS{i}_IP' for i in range(1,5)])),
    [contrast('rebound_vs_control','Rebound vs control sleep','control','rebound')], info,
    note='Five control and four rebound pools, each containing seven mice. Only immunoprecipitated RNA is compared. Input assays are paired to these pools and excluded from this track.')

acc='GSE278158'
f=pd.read_csv(dataset_dir(acc)/'raw'/f'{acc}_counts.txt.gz',sep='\t',comment='#')
info={}; arm={'control':[],'ko':[]}
for s in soft_records(ROOT/LEDGER[acc]['metadata']):
    if s['kind']!='SAMPLE': continue
    code=s['Sample_description'][0]
    hits=[c for c in f.columns if '/'+code+'_' in c]
    assert len(hits)==1
    col=hits[0]; group='ko' if 'KO' in s['Sample_title'][0] else 'control'
    arm[group].append(col); info[col]={'gsm':s['accession'],'animal':code,'unit':'mouse'}
add(acc,'Mouse hypothalamus SRC-1 deletion','Stress, immune & disease','Whole hypothalamus',
    'Bulk tissue','Genetic perturbation',f,f.Geneid,f.Geneid,
    groups(control=('Wild type',arm['control']),ko=('SRC-1 knockout',arm['ko'])),
    [contrast('ko_vs_wt','SRC-1 knockout vs wild type','control','ko')],info,
    note='Three wild-type and three SRC-1 knockout hypothalamus samples. GEO sample descriptions explicitly map YX3878-YX3883 to the featureCounts columns.')

acc='GSE309435'
f=pd.read_csv(dataset_dir(acc)/'raw'/f'{acc}_Raw_Conts.csv.gz')
info={}; arm={'control':[],'shr':[]}
for s in soft_records(ROOT/LEDGER[acc]['metadata']):
    if s['kind']!='SAMPLE':continue
    title=s['Sample_title'][0]; n=int(title.rsplit(', ',1)[1]); sex='Female' if 'Female' in title else 'Male'
    prefix=('S' if title.startswith('SHR') else 'W')+str(n)+'D'+sex[0]
    hits=[c for c in f if c.startswith(prefix+'_')]; assert len(hits)==1
    col=hits[0];arm['shr' if title.startswith('SHR') else 'control'].append(col)
    info[col]={'gsm':s['accession'],'animal':prefix,'sex':sex,'unit':'rat'}
add(acc,'Rat PVN hypertension','Stress, immune & disease','Paraventricular nucleus','Bulk tissue',
    'Disease model',f,f.iloc[:,0],['']*len(f),
    groups(control=('Wistar',arm['control']),shr=('Spontaneously hypertensive',arm['shr'])),
    [contrast('shr_vs_wistar','SHR vs Wistar, adjusted for sex','control','shr','sex')],info,
    organism='Rattus norvegicus',note='Nine Wistar and ten spontaneously hypertensive rats. Sex is a model covariate; the deposited cohort lacks Wistar male 1.')

acc='GSE148252'
f=pd.read_csv(dataset_dir(acc)/'raw'/f'{acc}_Raw_Counts_NPAS4.txt.gz',sep='\t',index_col=0)
info={}
for s in soft_records(ROOT/LEDGER[acc]['metadata']):
    if s['kind']=='SAMPLE' and s['Sample_title'][0] in f.columns:
        col=s['Sample_title'][0];info[col]={'gsm':s['accession'],'animal':col,'unit':'independent pool of six SCN pairs'}
add(acc,'Mouse SCN NPAS4 and light response','Circadian','Suprachiasmatic nucleus','Bulk tissue',
    'Circadian & sleep',f,f.index.tolist(),f.index.tolist(),
    groups(wt_dark=('Wild type, dark',[f'WD{i}' for i in range(1,4)]),
           ko_dark=('NPAS4 knockout, dark',[f'KD{i}' for i in range(1,4)]),
           wt_light=('Wild type, light',[f'WL{i}' for i in range(1,4)]),
           ko_light=('NPAS4 knockout, light',[f'KL{i}' for i in range(1,4)])),
    [contrast('ko_vs_wt_dark','Knockout vs wild type in dark','wt_dark','ko_dark'),
     contrast('ko_vs_wt_light','Knockout vs wild type after light','wt_light','ko_light'),
     contrast('light_vs_dark_wt','Light vs dark in wild type','wt_dark','wt_light'),
     contrast('light_vs_dark_ko','Light vs dark in knockout','ko_dark','ko_light')],info,
    note='NPAS4 bulk experiment only. Each genotype/light arm has three independent pools of six SCN pairs. Time-course and ChIP assays are separate experiments and excluded.')

for acc in ['E-MTAB-15488','E-MTAB-15489']:
    f=pd.read_csv(dataset_dir(acc)/'raw/raw_counts.tsv',sep='\t')
    mapping=pd.read_csv(DISCOVERY/'extensive/secondary'/f'{acc}-hypothalamus-count-map.csv')
    sdrf=pd.read_csv(dataset_dir(acc)/'metadata'/f'{acc}.sdrf.tsv',sep='\t').drop_duplicates('Source Name').set_index('Source Name')
    arm={};info={}
    for _,row in mapping.iterrows():
        col=row['Source Name'];gen=row['Characteristics[genotype]'];condition=row['Factor Value[disease]']
        key=('flox' if gen=='Opa1_flox' else 'opa1') if col.startswith('Op') else ('control' if condition=='Ctrl' else 'dss')
        info[col]={'animal':col.replace('Hy','').replace('_Hp',''),'unit':'mouse',
                   'biosample':str(sdrf.loc[col].get('Comment[ENA_SAMPLE]','')),
                   'reason':'' if col in f else 'Absent from deposited processed count matrix'}
        if col in f:arm.setdefault(key,[]).append(col)
    gs=groups(control=('Control',arm['control']),dss=('DSS colitis',arm['dss']))
    contrasts=[contrast('dss_vs_control','DSS colitis vs control','control','dss')]
    if 'opa1' in arm:
        gs.update(groups(flox=('Opa1 floxed control',arm['flox']),opa1=('Intestinal Opa1 deletion',arm['opa1'])))
        contrasts.append(contrast('opa1_vs_flox','Intestinal Opa1 deletion vs floxed control','flox','opa1'))
    add(acc,'Mouse hypothalamus '+('chronic colitis and intestinal Opa1 deletion' if acc.endswith('488') else 'acute colitis'),
        'Microbiome & gut–brain axis','Whole hypothalamus','Bulk tissue','Inflammation & immune',f,f.Geneid,['']*len(f),
        gs,contrasts,info,note='Only hypothalamus is included. Multiple organs from the same mouse are not extra replicates.'+
        (' D09Hy and Op57Hy are absent from processed counts. WT/DSS and Opa1/flox cohorts are analyzed separately.' if acc.endswith('488') else ''))

path=OUT/'studies.json'
previous=json.loads(path.read_text(encoding='utf-8')) if path.exists() else []
replaced={s['accession'] for s in STUDIES}
path.write_text(json.dumps([s for s in previous if s['accession'] not in replaced]+STUDIES,indent=2)+'\n',encoding='utf-8')
