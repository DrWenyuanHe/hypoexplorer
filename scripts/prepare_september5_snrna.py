"""Aggregate submitted single-nucleus counts by animal with alignment checks."""
import argparse
import gzip
import json
from pathlib import Path
import numpy as np
import pandas as pd
from intake_september5 import ROOT, OUT, DISCOVERY, dataset_dir, inventory, soft_records


def aggregate_mtx(path, gene_count, cell_count, assignments, n_units):
    """Stream sparse coordinates; never densify the cells-by-genes matrix."""
    sums = np.zeros((gene_count, n_units), dtype=np.float64)
    observed = 0
    with gzip.open(path, 'rt', encoding='utf-8') as handle:
        header = next(handle).strip()
        assert header.startswith('%%MatrixMarket matrix coordinate')
        line = next(handle)
        while line.startswith('%'): line = next(handle)
        nr, nc, nnz = map(int, line.split())
        assert (nr, nc) == (gene_count, cell_count), (path.name, (nr,nc), (gene_count,cell_count))
        for chunk in pd.read_csv(handle, sep=r'\s+', names=['row','col','value'], chunksize=1000000):
            row=chunk.row.to_numpy(); col=chunk.col.to_numpy(); value=chunk.value.to_numpy()
            assert np.isfinite(value).all() and (value>=0).all() and (value==np.floor(value)).all()
            assert (row>=1).all() and (row<=nr).all() and (col>=1).all() and (col<=nc).all()
            for assignment in (assignments if assignments.ndim==2 else [assignments]):
                units=assignment[col-1]
                keep=units>=0
                np.add.at(sums,(row[keep]-1,units[keep]),value[keep])
            observed+=len(chunk)
        assert observed==nnz, (observed,nnz)
    return sums, {'matrix':path.name,'genes':nr,'cells':nc,'entries':nnz,'retained_counts':float(sums.sum())}


def write_track(acc, track, label, features, counts, samples):
    folder=dataset_dir(acc)
    (folder/'processed').mkdir(exist_ok=True)
    matrix=folder/'processed'/f'{acc}_{track}_source_counts.tsv.gz'
    sheet=folder/'metadata'/f'{acc}_{track}_samples.tsv'
    frame=pd.DataFrame(counts,columns=samples['sample'])
    frame.insert(0,'symbol',features.iloc[:,1].fillna('').to_numpy())
    frame.insert(0,'gene_id',features.iloc[:,0].to_numpy())
    assert not frame.gene_id.duplicated().any()
    frame.to_csv(matrix,sep='\t',index=False)
    samples.to_csv(sheet,sep='\t',index=False)
    return {'id':track,'label':label,'matrix':matrix.relative_to(ROOT).as_posix(),
            'samplesheet':sheet.relative_to(ROOT).as_posix(),'kind':'counts'}


def prep_poa():
    acc='GSE337822'; folder=dataset_dir(acc); source=DISCOVERY/f'{acc}.soft.txt'
    records=[s for s in soft_records(source) if s['kind']=='SAMPLE']
    tracks=[];qc=[]
    for cls,label in [('excitatory','Excitatory neurons'),('inhibitory','Inhibitory neurons'),('nonneu','Non-neuronal cells')]:
        rows=[];columns=[];features_ref=None
        for s in records:
            urls=[u for k,v in s.items() if k.startswith('Sample_supplementary_file') for u in v]
            files={suffix:folder/'raw'/next(u.rsplit('/',1)[1] for u in urls if u.endswith(f'.{cls}.{suffix}'))
                   for suffix in ['matrix.mtx.gz','features.tsv.gz','barcodes.tsv.gz']}
            features=pd.read_csv(files['features.tsv.gz'],sep='\t',header=None)
            barcodes=pd.read_csv(files['barcodes.tsv.gz'],sep='\t',header=None)
            assert not barcodes.iloc[:,0].duplicated().any()
            assert len(barcodes)>=20
            if features_ref is None:features_ref=features
            else:assert features.equals(features_ref)
            sums,detail=aggregate_mtx(files['matrix.mtx.gz'],len(features),len(barcodes),np.zeros(len(barcodes),dtype=int),1)
            title=s['Sample_title'][0]
            sex='Female' if 'female' in title else 'Male'
            group='isoflurane' if 'isoflurane' in title else 'control'
            rows.append({'sample':s['accession'],'animal':s['accession'],'gsm':s['accession'],
                         'group':group,'sex':sex,'cells':len(barcodes),'included':True,'unit':'mouse'})
            columns.append(sums[:,0]);qc.append(detail)
            print(acc,cls,s['accession'],len(barcodes),'cells',flush=True)
        samples=pd.DataFrame(rows)
        assert samples.groupby(['sex','group']).size().tolist()==[5,5,5,5]
        tracks.append(write_track(acc,cls,label,features_ref,np.column_stack(columns),samples))
    (folder/'processed/matrix_qc.json').write_text(json.dumps(qc,indent=2)+'\n',encoding='utf-8')
    return {'accession':acc,'id':acc.lower(),'name':'Mouse preoptic response to isoflurane',
        'category':'Circadian','region':'Preoptic area','preparation':'Single-nucleus',
        'perturbation':'Drug & hormone','organism':'Mus musculus','modality':'snRNA-seq',
        'note':'Twenty independently sequenced mice, five of each sex per oxygen/isoflurane arm. Submitted excitatory, inhibitory and non-neuronal nuclei are summed within each mouse. Treatment models adjust for sex. GSE243489 supplies the reference taxonomy and contributes no samples.',
        'source':f'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={acc}','pmid':'',
        'dir':folder.relative_to(ROOT).as_posix(),'groups':[{'key':'control','label':'Oxygen control'},{'key':'isoflurane','label':'Isoflurane'}],
        'contrasts':[{'id':'isoflurane_vs_oxygen','label':'Isoflurane vs oxygen, adjusted for sex',
                      'baseline':'control','case':'isoflurane','covariate':'sex'}], 'tracks':tracks}


def prep_arc():
    acc='GSE262407';folder=dataset_dir(acc)
    features=pd.read_csv(folder/'raw'/f'{acc}_features.tsv.gz',sep='\t',header=None)
    if features.shape[1]==1: features[1]=features[0]
    barcodes=pd.read_csv(folder/'raw'/f'{acc}_barcodes.tsv.gz',sep='\t',header=None).iloc[:,0]
    meta=pd.read_csv(folder/'raw'/f'{acc}_metadata.csv.gz',low_memory=False).set_index('Unnamed: 0')
    assert not barcodes.duplicated().any() and not meta.index.duplicated().any()
    assert set(meta.index)<=set(barcodes)
    meta=meta.reindex(barcodes)
    valid=(meta.brainR=='ARC') & meta['sample.ID'].str.match(r'^Arc\d+$',na=False) & ~meta.discard.fillna(True) & ~meta.doublet.fillna(True)
    kept=meta[valid].copy()
    assert len(kept)==42933
    animals=kept[['sample.ID','diet','treatment']].drop_duplicates().set_index('sample.ID')
    assert len(animals)==20 and not animals.index.duplicated().any()
    samples=sorted(animals.index)
    # One whole-ARC population plus submitted major classes, using at least
    # 20 retained nuclei per mouse for class tracks. Ghrh has a disclosed
    # 10-nucleus threshold, matching the discovery feasibility calculation.
    populations=[('arcuate','Arcuate/VMH cells',valid,0)]
    for cls in sorted(kept['major.class'].dropna().unique()):
        populations.append((cls.lower().replace('_',''),cls,valid & (meta['major.class']==cls),20))
    populations.append(('ghrh','Ghrh neurons',valid & (meta['arc.vmh.labels']=='Ghrh'),10))
    accepted=[]; units=[];qc=[]
    for track,label,mask,minimum in populations:
        coverage=meta[mask]['sample.ID'].value_counts()
        donors=[s for s in samples if coverage.get(s,0)>=max(1,minimum)]
        rows=[]
        for s in donors:
            a=animals.loc[s];group=('hfd' if a.diet=='H' else 'chow')+'_'+('glucose' if a.treatment=='G' else 'saline')
            rows.append({'sample':s,'animal':s,'group':group,'cells':int(coverage[s]),'included':True,'unit':'mouse'})
        frame=pd.DataFrame(rows)
        group_counts=frame.groupby('group').size().to_dict() if len(frame) else {}
        eligible=len(group_counts)==4 and min(group_counts.values())>=3
        qc.append({'track':track,'minimumCells':minimum,'groupN':group_counts,'accepted':eligible})
        if not eligible:continue
        accepted.append((track,label,mask,donors,frame))
        units.extend([(track,s) for s in donors])
    # A nucleus can contribute to a tissue, class and Ghrh view. Accumulate all
    # views during one sparse-matrix read, preserving each mouse as the unit.
    tracks=[];assignments=[];offset=0;slices=[]
    for track,label,mask,donors,frame in accepted:
        assignment=np.full(len(meta),-1,dtype=int)
        donor_index={s:i+offset for i,s in enumerate(donors)}
        selected=mask & meta['sample.ID'].isin(donors)
        assignment[selected.to_numpy()]=meta.loc[selected,'sample.ID'].map(donor_index).to_numpy()
        assignments.append(assignment);slices.append(slice(offset,offset+len(donors)));offset+=len(donors)
    sums,detail=aggregate_mtx(folder/'raw'/f'{acc}_counts.mtx.gz',len(features),len(barcodes),np.array(assignments),offset)
    qc.append(detail)
    for (track,label,mask,donors,frame),cols in zip(accepted,slices):
        tracks.append(write_track(acc,track,label,features,sums[:,cols],frame))
        print(acc,track,frame.groupby('group').size().to_dict(),flush=True)
    (folder/'processed/matrix_qc.json').write_text(json.dumps(qc,indent=2)+'\n',encoding='utf-8')
    groups=[('chow_saline','Chow + saline'),('hfd_saline','HFD + saline'),('chow_glucose','Chow + glucose'),('hfd_glucose','HFD + glucose')]
    contrasts=[('hfd_vs_chow_saline','HFD vs chow with saline','chow_saline','hfd_saline'),
               ('hfd_vs_chow_glucose','HFD vs chow with glucose','chow_glucose','hfd_glucose'),
               ('glucose_vs_saline_chow','Glucose vs saline on chow','chow_saline','chow_glucose'),
               ('glucose_vs_saline_hfd','Glucose vs saline on HFD','hfd_saline','hfd_glucose')]
    return {'accession':acc,'id':acc.lower(),'name':'Mouse arcuate diet and glucose response',
        'category':'Diet-induced obesity','region':'Arcuate nucleus','preparation':'Single-nucleus',
        'perturbation':'Diet & obesity','organism':'Mus musculus','modality':'snRNA-seq',
        'note':'ARC/VMH cells aggregated by hashed mouse after submitted discard/doublet filtering. DVC cells are excluded using cell anatomy and Arc animal IDs. Major classes require 20 nuclei per mouse; Ghrh requires 10. Each displayed population retains at least three mice in all four arms. The pilot GSE262408 is a separate cohort and is not included.',
        'source':f'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={acc}','pmid':'',
        'dir':folder.relative_to(ROOT).as_posix(),'groups':[{'key':k,'label':v} for k,v in groups],
        'contrasts':[{'id':k,'label':l,'baseline':b,'case':c} for k,l,b,c in contrasts],'tracks':tracks}


def prep_sex():
    acc='GSE113576';folder=dataset_dir(acc)
    features=pd.read_csv(folder/'raw'/f'{acc}_genes.tsv.gz',sep='\t',header=None)
    barcodes=pd.read_csv(folder/'raw'/f'{acc}_barcodes.tsv.gz',sep='\t',header=None).iloc[:,0]
    assert not barcodes.duplicated().any()
    assignment=barcodes.str.extract(r'-(\d+)$')[0].astype(int).to_numpy()-1
    assert set(assignment)==set(range(6))
    counts,qc=aggregate_mtx(folder/'raw'/f'{acc}_matrix.mtx.gz',len(features),len(barcodes),assignment,6)
    coverage=np.bincount(assignment);assert min(coverage)>=20
    # GEO explicitly maps barcode suffixes 1-3 to female pools and 4-6 to male
    # pools. The three mice within each capture remain one replicate.
    ss=pd.DataFrame([{'sample':f'GSM{3109253+i}','animal':f'pool_{i+1}',
        'group':'female' if i<3 else 'male','unit':'independent pool of three mice',
        'cells':int(coverage[i]),'included':True} for i in range(6)])
    tr=write_track(acc,'preoptic','Preoptic cells',features,counts,ss)
    (folder/'processed/matrix_qc.json').write_text(json.dumps(qc,indent=2)+'\n',encoding='utf-8')
    return {'accession':acc,'id':acc.lower(),'name':'Mouse preoptic sex differences',
        'category':'Reproduction & development','region':'Preoptic area','preparation':'Single-cell',
        'perturbation':'Sex','organism':'Mus musculus','modality':'scRNA-seq',
        'note':'Three independent female pools and three independent male pools, each containing three mice. GEO explicitly maps matrix barcode suffixes 1-6 to the six pools. Cells are summed within each pool; the 18 mice do not provide 18 independent transcriptomic replicates. This track aggregates all submitted preoptic cell types.',
        'source':f'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={acc}','pmid':'',
        'dir':folder.relative_to(ROOT).as_posix(),'groups':[{'key':'female','label':'Female pools'},{'key':'male','label':'Male pools'}],
        'contrasts':[{'id':'male_vs_female','label':'Male vs female pools','baseline':'female','case':'male'}],'tracks':[tr]}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('accession',choices=['GSE337822','GSE262407','GSE113576'])
    args=parser.parse_args();s={'GSE337822':prep_poa,'GSE262407':prep_arc,'GSE113576':prep_sex}[args.accession]()
    path=OUT/'studies.json';studies=json.loads(path.read_text(encoding='utf-8'))
    studies=[x for x in studies if x['accession']!=s['accession']]+[s]
    path.write_text(json.dumps(studies,indent=2)+'\n',encoding='utf-8')
