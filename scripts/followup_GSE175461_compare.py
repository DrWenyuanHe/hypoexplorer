"""Audit registered results and standalone DESeq2 against the original CSV.

Run after followup_GSE175461.R. Exact Ensembl joins only. Missing author
statistics never count as negative calls. Decimal precision is read from the
original CSV strings, not chosen from observed reconstruction residuals.
"""
from pathlib import Path
from decimal import Decimal, InvalidOperation
import hashlib
import gzip
import json
import re
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DS = ROOT / 'geo_replication/datasets/GSE175461_rnor_son_dehydration'
OUT = ROOT / 'data/author-validation/continued-sources/five-dataset-followup-2026-09-04/GSE175461'
AUTHOR = ROOT / 'geo_replication/datasets/_author_de/GSE175461_author_DE.csv.gz'
RAW = DS / 'raw/GSE175461_Pauza_et_al_2021_J-Neuroendocrinology_Raw_read_counts.csv.gz'
LOCAL = DS / 'processed/GSE175461_DE.tsv'
OUT.mkdir(parents=True, exist_ok=True)
assert hashlib.sha256(AUTHOR.read_bytes()).hexdigest() == '17deeb67843128f351d3fe0d2f9f85bcd3cbf6c011afcf0eb6c8976875c29942'
assert hashlib.sha256(RAW.read_bytes()).hexdigest() == '63fe5a34520d7b706bcb571ed5f091638a6d9df6d43c70527f600109f68478ae'

def dump(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2, allow_nan=False) + '\n', encoding='utf-8')

def records(frame):
    return json.loads(frame.reset_index().to_json(orient='records'))

def quantum(token):
    try:
        value = Decimal(token)
        return float(Decimal(10) ** value.as_tuple().exponent) if value.is_finite() else np.nan
    except (InvalidOperation, TypeError):
        return np.nan

def precision_report(tokens, expected):
    observed = pd.to_numeric(tokens, errors='coerce').to_numpy(float)
    expected = np.asarray(expected, dtype=float)
    half_unit = tokens.map(quantum).to_numpy(float) / 2
    finite = np.isfinite(observed) & np.isfinite(expected)
    delta = np.abs(observed - expected)
    # Numerical floating-point slack only. This is far below source precision.
    slack = np.finfo(float).eps * np.maximum(1, np.abs(observed)) * 8
    outside = finite & (delta > half_unit + slack)
    return {
        'pairedFinite': int(finite.sum()),
        'missingnessDisagreements': int((np.isfinite(observed) != np.isfinite(expected)).sum()),
        'outsideSourceRoundingInterval': int(outside.sum()),
        'maxAbsoluteDifference': float(delta[finite].max()) if finite.any() else None,
        'medianAbsoluteDifference': float(np.median(delta[finite])) if finite.any() else None,
        'maxFractionOfHalfRoundingUnit': float(np.max(delta[finite] / half_unit[finite])) if finite.any() else None,
    }, outside

def effect_metrics(x, y):
    good = np.isfinite(x) & np.isfinite(y)
    x, y = np.asarray(x)[good], np.asarray(y)[good]
    strong = np.abs(x) >= .5
    return {'pairedFinite': int(good.sum()), 'pearson': float(np.corrcoef(x, y)[0, 1]),
            'medianAbsoluteDifference': float(np.median(np.abs(x-y))),
            'maxAbsoluteDifference': float(np.max(np.abs(x-y))),
            'directionAgree': int((np.sign(x) == np.sign(y)).sum()),
            'strongAuthorGenes': int(strong.sum()),
            'strongDirectionAgree': int((np.sign(x[strong]) == np.sign(y[strong])).sum())}

author_text = pd.read_csv(AUTHOR, dtype=str, encoding='utf-8-sig', keep_default_na=False).set_index('ENSEMBL_gene.id')
author = pd.read_csv(AUTHOR, encoding='utf-8-sig').set_index('ENSEMBL_gene.id')
raw = pd.read_csv(RAW, encoding='utf-8-sig').set_index('Ensembl_geneID')
prepared = pd.read_csv(DS / 'raw/GSE175461_counts.tsv.gz', sep='\t').set_index('Ensembl_geneID')
local = pd.read_csv(LOCAL, sep='\t').set_index('id')
sample = pd.read_csv(DS / 'metadata/GSE175461_samplesheet.tsv', sep='\t')
assert author.index.is_unique and raw.index.is_unique and local.index.is_unique
assert set(author.index) == set(raw.index)
assert raw.equals(prepared)
assert list(raw.columns) == sample['sample'].tolist()
assert len(sample) == 10 and sample.analysis_keep.all()
soft = gzip.open(DS / 'metadata/GSE175461_family.soft.gz', 'rt', encoding='utf-8').read()
blocks = re.split(r'\^SAMPLE = ', soft)[1:]
assert len(blocks) == 10
by_gsm = {block.splitlines()[0]: block for block in blocks}
for _, row in sample.iterrows():
    block = by_gsm[row.geo_accession]
    treatment = 'Euhydrated (control)' if row.group == 'control' else '72h dehydrated'
    title = f"Wistar_SON_{'euhydrated' if row.group == 'control' else 'dehydrated'}_rep{row.biological_replicate}"
    assert f'!Sample_title = {title}\n' in block
    assert f'!Sample_description = {row.source_library_token}\n' in block
    assert f'!Sample_characteristics_ch1 = treatment: {treatment}\n' in block
assert len(local) == 15305 and set(local.index) <= set(author.index)
raw = raw.loc[author.index]
shared = author.loc[local.index]
author_sample_names = [f'Control {i}' for i in range(1, 6)] + [f'Dehydrated {i}' for i in range(1, 6)]

registered = pd.DataFrame({
    'author_symbol': shared['ENSEMBL_gene.name'], 'registered_symbol': local.symbol,
    'author_log2FC': shared.log2FoldChange, 'registered_log2FC': local.logFC,
    'author_pvalue': shared.pvalue, 'registered_pvalue': local.pvalue,
    'author_padj': shared.padj, 'registered_padj': local.padj,
    'both_finite_padj': shared.padj.notna() & local.padj.notna(),
})
paired = registered.both_finite_padj
a_sig, l_sig = shared.padj.lt(.05), local.padj.lt(.05)
both = a_sig & l_sig & paired
either = (a_sig | l_sig) & paired
half_fdr = author_text.padj.map(quantum) / 2
ambiguous = author.padj.notna() & (author.padj - half_fdr <= .05) & (author.padj + half_fdr >= .05)
ambiguous_shared = ambiguous.loc[local.index]
unambiguous = paired & ~ambiguous_shared
stable_author = (shared.padj + half_fdr.loc[local.index]) < .05
registered['author_padj_rounding_straddles_threshold'] = ambiguous_shared
registered['registered_sig_author_padj_missing'] = l_sig & ~paired
registered['finite_padj_call_difference'] = paired & (a_sig != l_sig)
registered.to_csv(OUT / 'registered_vs_author.per-gene.tsv', sep='\t', index_label='id', na_rep='NA')
registered.loc[l_sig & ~paired].to_csv(OUT / 'registered_significant_author_FDR_unavailable.tsv', sep='\t', index_label='id', na_rep='NA')

nonzero = raw.sum(axis=1) > 0
pd.DataFrame({'source_total_counts':raw.sum(axis=1),'source_nonzero':nonzero,
              'author_finite_effect':author.log2FoldChange.notna(),'author_finite_raw_P':author.pvalue.notna(),
              'author_finite_FDR':author.padj.notna(),'registered_gene':author.index.isin(local.index),
              'author_strict_FDR_below_0_05':author.padj.lt(.05),
              'author_threshold_ambiguous_after_rounding':ambiguous}).to_csv(
                  OUT/'gene_universe_eligibility.tsv',sep='\t',index_label='id')
summary = {
    'schemaVersion': 1, 'accession': 'GSE175461', 'datasetId': 'rat_son_dehydration_gse175461',
    'registeredUnchanged': True,
    'authorFile': {'rows': len(author), 'uniqueIDs': int(author.index.nunique()),
                   'nonzeroSourceRows': int(nonzero.sum()), 'allZeroSourceRows': int((~nonzero).sum()),
                   'finiteEffects': int(author.log2FoldChange.notna().sum()),
                   'finiteRawP': int(author.pvalue.notna().sum()), 'finiteFDR': int(author.padj.notna().sum()),
                   'strictParsedFDRBelow0.05': int(author.padj.lt(.05).sum()),
                   'inclusiveParsedFDRAtMost0.05': int(author.padj.le(.05).sum()),
                   'roundingAmbiguousAt0.05': int(ambiguous.sum())},
    'source': {'allAuthorIDsExactlyEqualCountIDs': True, 'preparedCountsExactlyEqualDepositedCounts': True,
               'countCellsChecked': int(raw.size), 'sampleColumns': list(raw.columns),
               'samplesPerGroup': sample.groupby('group').size().astype(int).to_dict()},
    'registered': {
        'genes': len(local), 'exactIDJoins': len(shared), 'authorRowsOutsideLocal': len(author)-len(local),
        'nonzeroAuthorRowsOutsideLocal': int((nonzero & ~author.index.isin(local.index)).sum()),
        'authorFiniteFDRRowsOutsideLocal': int((author.padj.notna() & ~author.index.isin(local.index)).sum()),
        'strictAuthorSignificantOutsideLocal': int((author.padj.lt(.05) & ~author.index.isin(local.index)).sum()),
        'pairedFiniteFDR': int(paired.sum()), 'authorFDRMissingOnLocalRows': int((~paired).sum()),
        'authorRawPMissingOnLocalRows': int(shared.pvalue.isna().sum()),
        'allRegisteredSignificant': int(l_sig.sum()),
        'localSignificantWithAuthorFDRUnavailable': int((l_sig & ~paired).sum()),
        'sharedFinite': {'authorCalls': int((a_sig & paired).sum()), 'localCalls': int((l_sig & paired).sum()),
                         'both': int(both.sum()), 'union': int(either.sum()), 'jaccard': float(both.sum()/either.sum()),
                         'authorOnly': int((a_sig & ~l_sig & paired).sum()), 'localOnly': int((~a_sig & l_sig & paired).sum())},
        'roundingUnambiguousSharedFinite': {'genes': int(unambiguous.sum()),
            'authorCalls': int((stable_author & unambiguous).sum()), 'localCalls': int((l_sig & unambiguous).sum()),
            'both': int((stable_author & l_sig & unambiguous).sum()),
            'union': int(((stable_author | l_sig) & unambiguous).sum()),
            'jaccard': float((stable_author & l_sig & unambiguous).sum()/((stable_author | l_sig) & unambiguous).sum())},
        'effects': effect_metrics(shared.log2FoldChange, local.logFC),
        'authorSignificantDirectionAgreement': int(((np.sign(shared.log2FoldChange) == np.sign(local.logFC)) & a_sig).sum()),
    },
    'reconstructions': {},
}
for label in ['default_alpha0.1', 'threshold_alpha0.05']:
    refit = pd.read_csv(OUT / f'DESeq2_{label}.tsv', sep='\t').set_index('id').loc[author.index]
    cols = ['baseMean', 'log2FoldChange', 'lfcSE', 'stat', 'pvalue', 'padj']
    precision = {}
    residual = pd.DataFrame(index=author.index)
    for col in cols:
        report, outside = precision_report(author_text[col], refit[col])
        precision[col] = report
        residual[f'author_{col}'] = author[col]
        residual[f'refit_{col}'] = refit[col]
        residual[f'{col}_outside_rounding'] = outside
    refit_sig = refit.padj.lt(.05)
    summary['reconstructions'][label] = {
        'precision': precision, 'significant': int(refit_sig.sum()),
        'up': int((refit_sig & refit.log2FoldChange.gt(0)).sum()),
        'down': int((refit_sig & refit.log2FoldChange.lt(0)).sum()),
        'parsedAuthorCallDifference': records(pd.DataFrame({'symbol': author['ENSEMBL_gene.name'], 'author_padj': author.padj, 'refit_padj': refit.padj}).loc[refit_sig != author.padj.lt(.05)]),
        'unambiguousAuthorCallDisagreements': int(((refit_sig != author.padj.lt(.05)) & author.padj.notna() & ~ambiguous).sum()),
    }
    residual.to_csv(OUT / f'{label}_rounding_audit.tsv', sep='\t', index_label='id', na_rep='NA')
    if label == 'threshold_alpha0.05':
        # The model is compatible within the source's displayed precision, not
        # an exact historical package replay or replacement of registered FDR.
        boundary = pd.DataFrame({'symbol':author['ENSEMBL_gene.name'], 'author_padj_token':author_text.padj,
                                 'author_padj':author.padj, 'rounding_half_unit':half_fdr,
                                 'refit_padj':refit.padj, 'registered_padj':local.padj.reindex(author.index)})
        boundary.loc[ambiguous].to_csv(OUT / 'author_FDR_rounding_boundary.tsv', sep='\t', index_label='id', na_rep='NA')
        summary['thresholdBoundary'] = records(boundary.loc[ambiguous])

norm = pd.read_csv(OUT / 'DESeq2_normalized_counts.tsv', sep='\t').set_index('id').loc[author.index]
factors = pd.read_csv(OUT / 'DESeq2_sample_factors.tsv', sep='\t').set_index('sample')
sample_audit = []
for i, row in sample.iterrows():
    token, author_col = row['sample'], author_sample_names[i]
    report, _ = precision_report(author_text[author_col], norm[token])
    item = row.to_dict() | {'author_column': author_col, 'size_factor': float(factors.loc[token,'sizeFactor']), **report}
    sample_audit.append(item)
pd.DataFrame(sample_audit).to_csv(OUT / 'sample_normalization_audit.tsv', sep='\t', index=False)
summary['normalizedSamples'] = {'cellsCompared': int(norm.size), 'allWithinAuthorRounding': all(x['outsideSourceRoundingInterval']==0 and x['missingnessDisagreements']==0 for x in sample_audit),
                                'maxAbsoluteDifference': max(x['maxAbsoluteDifference'] for x in sample_audit)}
summary['unavailableNonzeroRawPGenes'] = records(author.loc[nonzero & author.pvalue.isna(), ['ENSEMBL_gene.name','baseMean','pvalue','padj']])
eligibility = pd.read_csv(OUT / 'DESeq2_inference_eligibility.tsv',sep='\t').set_index('id').loc[author.index]
unavailable_local = shared.padj.isna()
significant_unavailable_ids = local.index[l_sig & unavailable_local]
summary['missingStatisticsExplanation'] = {
    'authorNonzeroRawPMissing': int((nonzero & author.pvalue.isna()).sum()),
    'nonzeroRawPMissingWithReconstructedCooksAboveCutoff': int((nonzero & author.pvalue.isna() & (eligibility.maxCooks > eligibility.defaultCooksCutoff)).sum()),
    'localFDRMissingWithFiniteRawPAndBelowIndependentFilter': int((unavailable_local & shared.pvalue.notna() & eligibility.belowIndependentFilter.loc[local.index]).sum()),
    'localSignificantFDRMissingBelowIndependentFilter': int(eligibility.loc[significant_unavailable_ids,'belowIndependentFilter'].sum()),
    'localSignificantFDRMissingBecauseRawPUnavailable': int(author.loc[significant_unavailable_ids,'pvalue'].isna().sum()),
    'caution': 'These are missing results in the published table, not author-negative calls. The separate reconstruction reproduces the author missingness pattern.'
}
dump('comparison.summary.json',summary)
print(json.dumps({'authorFile':summary['authorFile'],'registered':summary['registered'],'normalizedSamples':summary['normalizedSamples'],
                  'reconstructionPrecision':{k:v['precision'] for k,v in summary['reconstructions'].items()},'thresholdBoundary':summary['thresholdBoundary']},indent=2))
