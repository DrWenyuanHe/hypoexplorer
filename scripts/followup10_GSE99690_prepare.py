"""Read-only source audit and separate TSV inputs for three bounded model checks."""
import gzip
import json
from pathlib import Path
import numpy as np
import pandas as pd
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'data/author-validation/continued-sources/ten-dataset-followup-2026-09-04'
DIRS = {'GSE99690':'GSE99690_mmus_gt17_orexin','GSE242187':'GSE242187_mmus_hypo_maternal_hcd','GSE295250':'GSE295250_mmus_hypo_hibernation'}

def soft_records(path):
    records = []
    for block in gzip.open(path, 'rt').read().split('^SAMPLE = ')[1:]:
        item = {'gsm':block.splitlines()[0]}
        for line in block.splitlines()[1:]:
            if line.startswith('!Sample_') and ' = ' in line:
                key, val = line.split(' = ', 1)
                item.setdefault(key[8:], []).append(val)
        records.append(item)
    return records

for g, dirname in DIRS.items():
    out = BASE/g
    ds = ROOT/'geo_replication/datasets'/dirname
    ss = pd.read_csv(ds/'metadata'/f'{g}_samplesheet.tsv', sep='\t')
    local = pd.read_csv(ds/'processed'/f'{g}_DE.tsv', sep='\t')
    soft = ds/'metadata'/f'{g}_family.soft.gz' if g == 'GSE99690' else out/f'{g}_family.soft.gz'
    records = soft_records(soft)
    if g == 'GSE99690':
        workbook = openpyxl.load_workbook(ds/'raw/GSE99690_GT1-7-OxR1-RNA-Seq_mm10_Results.xlsx', read_only=True, data_only=True)
        def sheet(name):
            values = iter(workbook[name].values)
            frame = pd.DataFrame(values, columns=next(values))
            frame.iloc[:,0] = frame.iloc[:,0].astype(str).str.strip()
            return frame.set_index(frame.columns[0])
        raw_all = sheet('RawGeneCounts')
        raw_all.to_csv(out/'source-counts-all-nine.tsv', sep='\t', index_label='id')
        counts = raw_all[ss['sample']]
        author = sheet('Oxa3h_VS_Neg')
        normalized = sheet('NormalizedGeneCounts')
        normalized.to_csv(out/'author-normalized.tsv', sep='\t', index_label='id')
        clean = pd.read_csv(ds/'processed/GSE99690_raw_counts_3h.tsv.gz', sep='\t', index_col=0)
        cohort = [r for r in records if r['gsm'] in set(ss['gsm'])]
    elif g == 'GSE242187':
        counts = pd.read_csv(ds/'raw/GSE242187_5A_vs_3A_control_vs_comparison.deseq.counts.csv.gz', index_col=0)
        mapping = {f'{int(s.rsplit("_",1)[1])}Mona_totalmRNAseq':s for s in ss['sample']}
        counts = counts.rename(columns=mapping)[ss['sample']]
        clean = pd.read_csv(ds/'raw/GSE242187_hypo_male_5Avs3A_counts.tsv.gz', sep='\t', index_col=0)
        author = pd.read_csv(out/'GSE242187_5A_vs_3A_control_vs_comparison.deseq.res.csv.gz', index_col=0)
        cohort = [r for r in records if any('5A_vs_3A' in d for d in r.get('description',[]))]
    else:
        counts = pd.read_csv(ds/'raw/GSE295250_FtoE3KO_Fed_Adult_CountsEns_Fed2023.txt.gz', sep='\t', index_col=0)[ss['sample']]
        clean = pd.read_csv(ds/'raw/GSE295250_counts.clean.txt.gz', sep='\t', index_col=0)
        author = pd.read_csv(out/'GSE295250_FtoE3KO_Fed_edgeR_Ens_Feb2023.txt.gz', sep='\t', index_col=0)
        author = author.set_index('ensembl_gene_id')
        cohort = [r for r in records if r['title'][0].startswith('RNAseq_Fed_E3_')]
    assert counts.index.is_unique and author.index.is_unique
    common = counts.index.intersection(clean.index)
    differences = int((counts.loc[common].to_numpy() != clean.loc[common,ss['sample']].to_numpy()).sum())
    assert differences == 0
    assert set(counts.index) == set(clean.index)
    assert counts.notna().all().all() and (counts >= 0).all().all()
    assert (counts == counts.round()).all().all()
    assert len(cohort) == len(ss) == 6
    counts.to_csv(out/'source-counts.tsv', sep='\t', index_label='id')
    author.to_csv(out/'author-results.tsv', sep='\t', index_label='id')
    local.to_csv(out/'registered-results.tsv', sep='\t', index=False)
    ss.to_csv(out/'samples.tsv', sep='\t', index=False)
    (out/'geo-cohort.json').write_text(json.dumps(cohort, indent=2)+'\n')
    summary={'sourceRows':len(counts),'sourceColumns':list(counts.columns),'registeredRows':len(local),'authorRows':len(author),'checkedCountCells':counts.size,'differentCountCells':differences,'geoSamples':len(cohort),'countsOnlyRows':len(counts.index.difference(author.index)),'authorOnlyRows':len(author.index.difference(counts.index))}
    (out/'input-audit.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(g,json.dumps(summary))
