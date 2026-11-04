"""Read retained primary sources and prepare a bounded, separate author-method check.

Run from repository root with bundled Python. Does not change production data.
"""
from pathlib import Path
import gzip
import json
import re
import xml.etree.ElementTree as ET
import pandas as pd
import numpy as np
import sys
import hashlib

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'data/author-validation/continued-sources/ten-dataset-followup-2026-09-04'
CONFIG = {
    'GSE185074': ('mmus_tanycyte_insulin', 'PMC8688146'),
    'GSE210311': ('mmus_arc_pomc_drd2', 'PMC9675440'),
    'GSE153551': ('mmus_hypo_obob_fgf1', 'PMC7477234'),
}

def read_soft(path):
    rows, row = [], None
    text = gzip.open(path, 'rt', encoding='utf-8').read()
    for line in text.splitlines():
        if line.startswith('^SAMPLE = '):
            if row: rows.append(row)
            row = {'gsm': line.split(' = ', 1)[1]}
        elif row is not None and line.startswith('!Sample_') and ' = ' in line:
            key, value = line.split(' = ', 1)
            key = key.removeprefix('!Sample_')
            row[key] = row.get(key, '') + (' | ' if key in row else '') + value
    if row: rows.append(row)
    return pd.DataFrame(rows), text

def prepare():
    for g, (folder, pmc) in CONFIG.items():
        out = BASE/g
        ds = ROOT/'geo_replication/datasets'/f'{g}_{folder}'
        samples = pd.read_csv(ds/'metadata'/f'{g}_samplesheet.tsv', sep='\t')
        soft, text = read_soft(out/'family.soft.gz')
        soft.to_csv(out/'geo-samples.tsv', sep='\t', index=False)
        methods = list(dict.fromkeys(x.split(' = ', 1)[1] for x in text.splitlines()
                                    if x.startswith(('!Series_overall_design', '!Sample_data_processing'))))
        tree = ET.parse(out/f'{pmc}.xml').getroot()
        paragraphs = [''.join(e.itertext()) for e in tree.iter('p')]
        selected = [s for s in paragraphs if any(t in s.lower() for t in
                    ['deseq', 'bulk rna', 'pooled per', 'biological replic', 'covariate', 'principal component', 'excluded'])]
        (out/'primary-methods.txt').write_text('\n\n'.join(methods+selected), encoding='utf-8')
        links = [e.attrib for e in tree.iter('ext-link') if any(t in str(e.attrib) for t in ['github', 'zenodo'])]
        print(g, 'CODE LINKS', links)
        if g == 'GSE185074':
            counts = pd.read_excel(ds/'raw/GSE185074_counts.xlsx', index_col=0)
            prepared = pd.read_csv(ds/'raw/GSE185074_counts.tsv.gz', sep='\t', index_col=0)
            author = pd.read_excel(out/'author_wt_hfd_ncd.xlsx')
            author = author.rename(columns={'ensembl_gene_id':'id', 'log2FoldChange':'author_lfc', 'padj':'author_fdr'})
        elif g == 'GSE210311':
            counts = pd.read_csv(ds/'raw/GSE210311_counts.csv.gz', index_col=0)
            prepared = counts.copy()
            author_all = pd.read_csv(out/'author_de.csv.gz')
            print('COMPARISONS', author_all.groupby('comparison').size().to_dict())
            author = author_all[author_all.comparison == 'drd2_dre_ip'].copy()
            author = author.rename(columns={'ensembl_gene_id':'id', 'log2FoldChange':'author_lfc', 'padj':'author_fdr'})
        else:
            counts = pd.read_csv(ds/'raw/GSE153549_bulk_raw_counts.csv.gz', index_col=0)
            prepared = counts.copy()
            author = pd.read_excel(out/'author_Data11.xlsx', sheet_name='b.d5_deg')
            author = author.rename(columns={'gene':'id', 'log2FoldChange':'author_lfc', 'padj':'author_fdr'})
        assert not counts.index.duplicated().any()
        counts.to_csv(out/'source-counts.tsv', sep='\t', index_label='id')
        samples.to_csv(out/'registered-samples.tsv', sep='\t', index=False)
        author.to_csv(out/'author-target.tsv', sep='\t', index=False)
        local = pd.read_csv(ds/'processed'/f'{g}_DE.tsv', sep='\t')
        if g == 'GSE153551':
            local['id'] = local['symbol']
        assert not local.id.duplicated().any()
        assert not author.id.duplicated().any()
        local.to_csv(out/'registered-result.tsv', sep='\t', index=False)
        vals = counts[samples['sample']].to_numpy()
        aligned = prepared.loc[counts.index, samples['sample']].to_numpy()
        summary = {
            'source_rows':len(counts), 'source_columns':len(counts.columns),
            'registered_samples':samples.to_dict('records'),
            'source_sample_names':list(counts.columns),
            'source_selected_count_cells':int(vals.size),
            'prepared_count_differences':int((vals != aligned).sum()),
            'noninteger_selected_count_cells':int((vals != np.round(vals)).sum()),
            'all_zero_selected_genes':int((vals.sum(axis=1) == 0).sum()),
            'author_rows':len(author), 'author_comparison_values':author.get('comparison', pd.Series(dtype=str)).unique().tolist(),
            'author_nonfinite_effect':int((~np.isfinite(author.author_lfc)).sum()),
            'author_nonfinite_fdr':int((~np.isfinite(author.author_fdr)).sum()),
            'registered_rows':len(local),
            'gene_id_overlap':len(set(local.id)&set(author.id)),
            'paper_code_links':links,
        }
        (out/'source-audit.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
        print(g, json.dumps(summary, indent=2))

def provenance_and_eligibility():
    for g,(folder,pmc) in CONFIG.items():
        out=BASE/g
        ds=ROOT/'geo_replication/datasets'/f'{g}_{folder}'
        original=(ds/'raw'/('GSE185074_counts.xlsx' if g=='GSE185074' else
                  'GSE210311_counts.csv.gz' if g=='GSE210311' else 'GSE153549_bulk_raw_counts.csv.gz'))
        official=out/('official-counts.xlsx' if g=='GSE185074' else 'official-counts.csv.gz')
        sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
        assert sha(original)==sha(official)
        samples=pd.read_csv(out/'registered-samples.tsv',sep='\t')
        geo=pd.read_csv(out/'geo-samples.tsv',sep='\t')
        if g=='GSE185074':
            def source_name(row):
                genotype='ko' if 'IR deleted' in row.title else 'wt'
                diet='hfd' if 'HFD-fed' in row.title else 'ncd'
                fraction='in' if 'Input' in row.title else 'ip'
                replicate=re.search(r'(\d+)\s*$',row.title).group(1)
                return f'{genotype}_{diet}_{fraction}_{replicate}'
            geo['sample']=geo.apply(source_name,axis=1)
        elif g=='GSE210311':
            geo['sample']=geo.title.str.lower().str.replace(' ','_')
        else:
            geo['sample']=geo.title
        assert not geo['sample'].duplicated().any()
        counts=pd.read_csv(out/'source-counts.tsv',sep='\t',index_col=0)
        assert set(geo['sample'])==set(counts.columns)
        selected=geo[['gsm','sample','title','characteristics_ch1']].merge(samples,on='sample',how='left',validate='one_to_one')
        selected['registered_eligible']=selected.group.notna()
        if g=='GSE153551':
            selected['GEO_control_diabetes_label']=np.select([
              selected.characteristics_ch1.str.contains('Non-Diabetic'),
              selected.characteristics_ch1.str.contains('vehicle. Diabetic',regex=False)],
              ['Non-Diabetic','Diabetic'],default='FGF1, baseline label not provided')
        selected.to_csv(out/'cohort-eligibility.tsv',sep='\t',index=False)
        info={'source_sha256':sha(original),'local_source':str(original.relative_to(ROOT)),
              'fresh_official_file':official.name,'fresh_official_bytes_equal_local':True,
              'all_GEO_samples_map_exactly_to_count_columns':True,
              'source_samples':len(geo),'registered_samples':len(samples),'registered_sample_groups':samples.group.value_counts().to_dict()}
        if g=='GSE153551':
            info['day5_GEO_control_diabetes_labels']=selected[selected.registered_eligible & (selected.group=='control')].GEO_control_diabetes_label.value_counts().to_dict()
            info['paper_caption_day5_group_sizes']={'FGF1':9,'vehicle':7}
            info['published_code_day5_group_sizes']={'FGF1':9,'vehicle':14}
            info['author_code_commit']='52d88678668db304f946a6a33e34a56f22ddea6a'
            assert sha(out/'author-figure_7.Rmd')==sha(out/'author-figure_7.commit-pinned.Rmd')
        (out/'cohort-provenance-summary.json').write_text(json.dumps(info,indent=2),encoding='utf-8')

def compare(a, r, r_lfc, r_fdr, output):
    j = a.merge(r, on='id', how='inner', suffixes=('', '_refit'), validate='one_to_one')
    ef = np.isfinite(j.author_lfc) & np.isfinite(j[r_lfc])
    fq = np.isfinite(j.author_fdr) & np.isfinite(j[r_fdr])
    z = j.loc[ef]
    aa = set(j.loc[fq & (j.author_fdr<.05),'id'])
    rr = set(j.loc[fq & (j[r_fdr]<.05),'id'])
    strong = z.author_lfc.abs()>=.5
    j['paired_finite_effect'] = ef
    j['paired_finite_FDR'] = fq
    j['abs_effect_difference'] = abs(j.author_lfc-j[r_lfc])
    j['abs_fdr_difference'] = abs(j.author_fdr-j[r_fdr])
    j.to_csv(output, sep='\t', index=False)
    m = {
        'author_rows':len(a), 'comparison_rows':len(r), 'exact_id_joins':len(j),
        'paired_finite_effect':int(ef.sum()), 'paired_finite_FDR':int(fq.sum()),
        'effect_pearson':float(z.author_lfc.corr(z[r_lfc])),
        'effect_median_abs_delta':float(j.loc[ef,'abs_effect_difference'].median()),
        'effect_max_abs_delta':float(j.loc[ef,'abs_effect_difference'].max()),
        'effects_within_1e_6':int((j.loc[ef,'abs_effect_difference']<=1e-6).sum()),
        'effects_within_0p01':int((j.loc[ef,'abs_effect_difference']<=.01).sum()),
        'strong_author_effects':int(strong.sum()),
        'strong_effect_same_direction':int((np.sign(z.loc[strong,'author_lfc'])==np.sign(z.loc[strong,r_lfc])).sum()),
        'author_sig_finite_effects':int((ef & (j.author_fdr<.05)).sum()),
        'author_sig_same_direction':int((ef & (j.author_fdr<.05) & (np.sign(j.author_lfc)==np.sign(j[r_lfc]))).sum()),
        'all_author_finite_fdr':int(np.isfinite(a.author_fdr).sum()),
        'all_author_FDR_lt05':int((a.author_fdr<.05).sum()),
        'all_comparison_FDR_lt05':int((r[r_fdr]<.05).sum()),
        'paired_author_FDR_lt05':len(aa), 'paired_comparison_FDR_lt05':len(rr),
        'paired_overlap':len(aa&rr), 'paired_jaccard':len(aa&rr)/len(aa|rr) if aa|rr else None,
        'paired_author_only':len(aa-rr), 'paired_comparison_only':len(rr-aa),
        'fdr_within_1e_6':int((j.loc[fq,'abs_fdr_difference']<=1e-6).sum()),
        'fdr_max_abs_delta':float(j.loc[fq,'abs_fdr_difference'].max()),
        'shared_author_FDR_missing':int((~np.isfinite(j.author_fdr)).sum()),
        'comparison_calls_among_author_FDR_missing':int(((j[r_fdr]<.05)&~np.isfinite(j.author_fdr)).sum()),
        'shared_comparison_FDR_missing':int((~np.isfinite(j[r_fdr])).sum()),
        'author_calls_among_comparison_FDR_missing':int(((j.author_fdr<.05)&~np.isfinite(j[r_fdr])).sum()),
        'author_ids_absent_comparison':int((~a.id.isin(r.id)).sum()),
        'author_calls_absent_comparison':int(((a.author_fdr<.05)&~a.id.isin(r.id)).sum()),
        'comparison_ids_absent_author':int((~r.id.isin(a.id)).sum()),
        'comparison_calls_absent_author':int(((r[r_fdr]<.05)&~r.id.isin(a.id)).sum()),
    }
    for name, ap, rp in [('paper_effect_threshold', 'author_fdr', r_fdr)]:
        a_set=set(j.loc[fq & (j[ap]<.05)&(j.author_lfc.abs()>.5),'id'])
        r_set=set(j.loc[fq & (j[rp]<.05)&(j[r_lfc].abs()>.5),'id'])
        m[name]={'note':'FDR<.05 and |log2FC|>.5, applicable to FGF1 Fig7, not a replacement for other paper criteria',
                 'author':len(a_set),'comparison':len(r_set),'overlap':len(a_set&r_set)}
    return m

def comparisons():
    for g in CONFIG:
        out=BASE/g
        a=pd.read_csv(out/'author-target.tsv',sep='\t')
        r=pd.read_csv(out/'registered-result.tsv',sep='\t')
        summary={'registered':compare(a,r,'logFC','padj',out/'compare-registered.tsv')}
        for f in sorted(out.glob('*.tsv')):
            if f.stem.startswith(('sensitivity_', 'published_code_')) and not f.stem.endswith(('.samples','.count-replacements')):
                d=pd.read_csv(f,sep='\t')
                summary[f.stem]=compare(a,d,'log2FoldChange','padj',out/f'compare-{f.stem}.tsv')
                masks=a[['id','author_lfc','author_fdr']].merge(d[['id','log2FoldChange','padj','eligible_reason']],on='id',validate='one_to_one')
                summary[f.stem]['shared_effect_missing_mask_disagreements']=int((np.isfinite(masks.author_lfc)!=np.isfinite(masks.log2FoldChange)).sum())
                summary[f.stem]['shared_FDR_missing_mask_disagreements']=int((np.isfinite(masks.author_fdr)!=np.isfinite(masks.padj)).sum())
                missing_registered=r[~r.id.isin(a.id)].merge(d[['id','eligible_reason']],on='id',how='left')
                missing_registered['author_omission_basis']=missing_registered.eligible_reason.fillna('not_in_model_feature_universe')
                missing_registered.to_csv(out/f'author-omitted-registered-{f.stem}.tsv',sep='\t',index=False)
                if g=='GSE153551':
                    j=a.merge(d,on='id',suffixes=('_author','_refit'),validate='one_to_one')
                    summary[f.stem]['full_stat_columns']={}
                    for key in ['baseMean','lfcSE','stat','pvalue']:
                        x,y=j[f'{key}_author'],j[f'{key}_refit']
                        finite=np.isfinite(x)&np.isfinite(y)
                        summary[f.stem]['full_stat_columns'][key]={'paired_finite':int(finite.sum()),
                            'allclose_rtol1e_6_atol1e_8':bool(np.allclose(x[finite],y[finite],rtol=1e-6,atol=1e-8)),
                            'max_abs_difference':float(abs(x[finite]-y[finite]).max())}
        if g=='GSE185074':
            subset=a[a.tanycyte_marker==True]
            summary['published_tanycyte_marker_subset']=compare(subset,r,'logFC','padj',out/'compare-marker-subset.tsv')
        if g=='GSE210311':
            all_a=pd.read_csv(out/'author_de.csv.gz')
            wide=all_a.pivot(index='ensembl_gene_id',columns='comparison',values='log2FoldChange')
            good=wide.dropna()
            # Verify separate interaction effects are not silently called the direct IP estimand.
            residual=good.interaction_effect-(good.drd2_dre_ip-good.drd2_dre_input)
            summary['interaction_identity']={'finite_five_contrasts':len(good),
                'max_abs_interaction_minus_IP_minus_input':float(residual.abs().max()),
                'within_1e_6':int((residual.abs()<=1e-6).sum())}
            wide.assign(interaction_residual=wide.interaction_effect-(wide.drd2_dre_ip-wide.drd2_dre_input)).to_csv(out/'author-five-contrast-identity.tsv',sep='\t')
        (out/'comparison-summary.json').write_text(json.dumps(summary,indent=2,allow_nan=False),encoding='utf-8')
        print(g,json.dumps(summary,indent=2))

if __name__ == '__main__':
    if '--compare' in sys.argv:
        comparisons()
        provenance_and_eligibility()
    else:
        prepare()
