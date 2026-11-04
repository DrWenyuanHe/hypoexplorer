"""Extract original workbook and audit author-versus-registered results. No production writes."""
import argparse
import gzip
import hashlib
import json
import re
import tarfile
from pathlib import Path

import numpy as np
import openpyxl
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/author-validation/continued-sources/ten-dataset-followup-2026-09-04/GSE240484'
DS = ROOT / 'geo_replication/datasets/GSE240484_mmus_arc_agrp_nutrap'


def compare(author, local):
    both = author.merge(local, on='genes', validate='one_to_one', suffixes=('_author', '_local'))
    effects = both[np.isfinite(both.logFC_author) & np.isfinite(both.logFC_local)].copy()
    finite = both[np.isfinite(both.FDR_author) & np.isfinite(both.FDR_local)
                  & np.isfinite(both.PValue_author) & np.isfinite(both.PValue_local)].copy()
    a, b = finite.FDR_author < .05, finite.FDR_local < .05
    strong = effects[effects.logFC_author.abs() >= .5]
    result = dict(shared_rows=len(both), finite_effect_pairs=len(effects), finite_test_pairs=len(finite),
                  author_significant=int(a.sum()), local_significant=int(b.sum()), shared_significant=int((a & b).sum()),
                  author_only=int((a & ~b).sum()), local_only=int((b & ~a).sum()),
                  pearson=float(effects.logFC_author.corr(effects.logFC_local)),
                  median_abs_effect_delta=float((effects.logFC_author-effects.logFC_local).abs().median()),
                  max_abs_effect_delta=float((effects.logFC_author-effects.logFC_local).abs().max()),
                  strong_effects=len(strong), strong_sign_agree=int((np.sign(strong.logFC_author)==np.sign(strong.logFC_local)).sum()),
                  max_abs_p_delta=float((finite.PValue_author-finite.PValue_local).abs().max()),
                  max_abs_fdr_delta=float((finite.FDR_author-finite.FDR_local).abs().max()))
    ap = a & (finite.logFC_author.abs() > .5)
    bp = b & (finite.logFC_local.abs() > .5)
    result['fdr_and_effect_rule_without_abundance'] = dict(author=int(ap.sum()),local=int(bp.sum()),shared=int((ap & bp).sum()))
    return result, both


def run(prepare=False):
    archive=OUT/'dea-rna-ffl-agrp.tar.gz'
    if archive.exists():
        assert hashlib.md5(archive.read_bytes()).hexdigest()=='b917852f3a1ca25a23202df7b7761fb1'
        # Extract only inspected, regular source-data/code members. Never execute archived code.
        with tarfile.open(archive) as tar:
            for name in ['dea.r','design.tsv','samples.tsv','exclude.tsv','stats.txt','comparisons.tsv','1_Init/fed_fasted.txt','cpm.txt']:
                member=tar.getmember('dea-rna/'+name)
                assert member.isfile()
                target=OUT/'zenodo'/name
                assert target.resolve().is_relative_to((OUT/'zenodo').resolve())
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(tar.extractfile(member).read())
    workbook = OUT / '41467_2024_48885_MOESM4_ESM.xlsx'
    sheet = openpyxl.load_workbook(workbook,read_only=True,data_only=True)['Supp Table 2']
    rows = list(sheet.values)
    author = pd.DataFrame(rows[1:],columns=rows[0])
    assert author.genes.notna().all()
    # Numeric Excel-date IDs are ambiguous. Preserve them, but never join them as gene symbols.
    invalid = author[~author.genes.map(lambda x: isinstance(x,str))].copy()
    invalid.to_csv(OUT/'author_unmapped_numeric_ids.tsv',sep='\t',index=False,na_rep='NA')
    author.to_csv(OUT/'author_table2.tsv',sep='\t',index=False,na_rep='NA')
    if prepare:
        print('Extracted',len(author),'unchanged author rows')
        return
    raw = pd.read_csv(DS/'raw/GSE240484_rna_counts.tsv.gz',sep='\t')
    assert (OUT/'GSE240484_rna_counts.source.tsv.gz').read_bytes()==(DS/'raw/GSE240484_rna_counts.tsv.gz').read_bytes()
    cpm = pd.read_csv(OUT/'GSE240484_rna_cpms_agrp-ffl.tsv.gz',sep='\t')
    cpm = cpm.rename(columns={cpm.columns[0]:'genes'})
    cpm.columns=[name.replace('AgRP_pos','AgRP-pos') for name in cpm.columns]
    assert not raw.Geneid.duplicated().any() and not cpm.genes.duplicated().any()
    ss = pd.read_csv(DS/'metadata/GSE240484_samplesheet.tsv',sep='\t')
    soft = gzip.open(OUT/'GSE240484_family.soft.gz','rt').read()
    cohort=[]
    for block in soft.split('^SAMPLE = ')[1:]:
        title = re.search(r'^!Sample_title = (.+)$',block,re.M).group(1)
        match = re.fullmatch(r'AgRP neurons, (fasted|fed|leptin), RNA, rep(\d+)',title)
        if not match:
            continue
        group,rep = match.groups()
        sample=f'AgRP-pos_{group}_{int(rep):03d}'
        assert sample in raw and sample in cpm
        cohort.append(dict(gsm=block.splitlines()[0],title=title,sample=sample,
                           condition=group,registered=sample in set(ss['sample']),mice_per_pool=4))
    assert len(cohort)==11 and sum(x['registered'] for x in cohort)==7
    assert set(ss['sample']) == {x['sample'] for x in cohort if x['condition']!='leptin'}
    assert all((row.group=='control')==('_fed_' in row.sample) for row in ss.itertuples())
    pd.DataFrame(cohort).to_csv(OUT/'cohort.tsv',sep='\t',index=False)
    original = pd.read_csv(OUT/'zenodo/1_Init/fed_fasted.txt',sep='\t')
    assert len(original)==len(author) and not original.genes.duplicated().any()
    # A unique five-statistic match links each workbook row to an original-code row.
    # This does not infer a gene from a date label or from the diagnostic refit.
    columns=['logFC','logCPM','F','PValue','FDR']
    source_values=original[columns].to_numpy(float)
    mapping=[]
    for row in author.itertuples(index=False,name=None):
        values=np.asarray(row[1:6],dtype=float)
        candidates=np.flatnonzero(np.all(np.isclose(source_values,values,rtol=1e-12,atol=1e-10),axis=1))
        assert len(candidates)==1, (row[0],len(candidates))
        recovered=original.iloc[candidates[0]].genes
        if isinstance(row[0],str):
            assert row[0]==recovered
        mapping.append(dict(workbook_label=str(row[0]),source_symbol=recovered,numeric_label=not isinstance(row[0],str)))
    assert len({x['source_symbol'] for x in mapping})==len(author)
    pd.DataFrame(mapping).to_csv(OUT/'workbook_to_original_ids.tsv',sep='\t',index=False)
    a = original[['genes','logFC','PValue','FDR']]
    full_a = a.copy()
    registered=pd.read_csv(DS/'processed/GSE240484_DE.tsv',sep='\t').rename(columns={'id':'genes','logFC':'logFC','pvalue':'PValue','padj':'FDR'})
    registered=registered[['genes','logFC','PValue','FDR']]
    summary=dict(schemaVersion=1,accession='GSE240484',notProduction=True,
                 source_rows=len(raw),author_rows=len(author),deposited_cpm_rows=len(cpm),
                 author_unmapped_numeric_ids=len(invalid),
                 author_numeric_id_fdr_calls=int((invalid.FDR_FvF<.05).sum()),
                 author_numeric_id_paper_calls=int(((invalid.FDR_FvF<.05)&(invalid.logFC_FvF.abs()>.5)).sum()),
                 workbook_numeric_ids_recovered=len(invalid),
                 original_author_cpm_gene_sets_identical=set(original.genes)==set(cpm.genes),
                 registered_rows=len(registered),author_absent_from_registered=sorted(set(a.genes)-set(registered.genes)),
                 registered_absent_from_author=sorted(set(registered.genes)-set(a.genes)),
                 author_missing_fdr=int(a.FDR.isna().sum()),author_missing_p=int(a.PValue.isna().sum()),
                 author_full_fdr_calls=int((full_a.FDR<.05).sum()),
                 author_fdr_and_effect_up_before_abundance_rule=int(((full_a.FDR<.05)&(full_a.logFC>.5)).sum()),
                 author_fdr_and_effect_down_before_abundance_rule=int(((full_a.FDR<.05)&(full_a.logFC<-.5)).sum()),
                 author_label_counts=author['Fasting induced '].fillna('unlabeled').value_counts().to_dict(),models={})
    summary['registered'], pairs=compare(a,registered)
    summary['registered_full_fdr_calls']=int((registered.FDR<.05).sum())
    summary['registered_calls_without_author_row']=int(((registered.FDR<.05)&~registered.genes.isin(a.genes)).sum())
    pairs.to_csv(OUT/'registered_comparison.tsv',sep='\t',index=False,na_rep='NA')
    paper=(original.FDR<=.05)&(original.logFC.abs()>=.5)&(original.logCPM>=1)
    summary['source_code_paper_rule']=dict(total=int(paper.sum()),up=int((paper&(original.logFC>0)).sum()),down=int((paper&(original.logFC<0)).sum()))
    labeled={x['source_symbol'] for x,label in zip(mapping,author['Fasting induced ']) if label in ('Up','Down')}
    assert labeled==set(original.loc[paper,'genes'])
    summary['paper_labels_exactly_recovered_by_source_code_rule']=True
    source_refit=pd.read_csv(OUT/'source_code_refit.tsv',sep='\t')
    summary['source_code_refit'],fit_pairs=compare(a,source_refit)
    assert summary['source_code_refit']['shared_significant']==3255
    assert summary['source_code_refit']['author_only']==summary['source_code_refit']['local_only']==0
    assert summary['source_code_refit']['max_abs_effect_delta']<1e-5
    assert summary['source_code_refit']['max_abs_fdr_delta']<1e-5
    fit_paper=(source_refit.FDR<=.05)&(source_refit.logFC.abs()>=.5)&(source_refit.logCPM>=1)
    assert set(source_refit.loc[fit_paper,'genes'])==labeled
    fit_pairs.to_csv(OUT/'source_code_refit_comparison.tsv',sep='\t',index=False)
    for path in sorted(OUT.glob('*groups_*.tsv')):
        if path.stem.endswith('_comparison'):
            continue
        model=pd.read_csv(path,sep='\t')
        summary['models'][path.stem], pairs=compare(a,model)
        pairs.to_csv(OUT/(path.stem+'_comparison.tsv'),sep='\t',index=False,na_rep='NA')
    for groups in (2,3):
        calc=pd.read_csv(OUT/f'cpm_{groups}groups.tsv',sep='\t').set_index('genes')
        original=cpm.set_index('genes').loc[calc.index,calc.columns]
        summary[f'cpm_{groups}groups_max_abs_delta']=float(np.max(np.abs(calc.values-original.values)))
        summary[f'cpm_{groups}groups_within_printed_precision']=int((np.abs(calc.values-original.values)<=.005+1e-12).sum())
    calc=pd.read_csv(OUT/'source_code_logcpm.tsv',sep='\t').set_index('genes')
    original_cpm=cpm.set_index('genes').loc[calc.index,calc.columns]
    summary['source_code_logcpm_max_abs_delta']=float(np.abs(calc.values-original_cpm.values).max())
    summary['source_code_logcpm_cells']=int(calc.size)
    summary['source_code_logcpm_cells_within_printed_precision']=int((np.abs(calc.values-original_cpm.values)<=.005+1e-12).sum())
    (OUT/'comparison.summary.json').write_text(json.dumps(summary,indent=2,allow_nan=False)+'\n')
    paths=[p for p in OUT.rglob('*') if p.is_file() and p.name!='manifest.json']
    paths += [DS/'raw/GSE240484_rna_counts.tsv.gz',DS/'metadata/GSE240484_samplesheet.tsv',DS/'processed/GSE240484_DE.tsv',Path(__file__),ROOT/'scripts/followup10_GSE240484.R']
    manifest=[dict(path=p.relative_to(ROOT).as_posix(),sha256=hashlib.sha256(p.read_bytes()).hexdigest(),bytes=p.stat().st_size) for p in paths]
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({k:v for k,v in summary.items() if k not in ('registered_absent_from_author','author_absent_from_registered')},indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--prepare',action='store_true')
    run(parser.parse_args().prepare)
