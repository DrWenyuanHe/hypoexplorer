"""Mechanically derive normalization, multiple-testing and source hash audits."""
import hashlib
import json
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.stats import false_discovery_control, chi2

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'data/author-validation/continued-sources/ten-dataset-followup-2026-09-04'
dirs={'GSE99690':'GSE99690_mmus_gt17_orexin','GSE242187':'GSE242187_mmus_hypo_maternal_hcd','GSE295250':'GSE295250_mmus_hypo_hibernation'}
for g,dirname in dirs.items():
    out=BASE/g
    a=pd.read_csv(out/'author-results.tsv',sep='\t',index_col=0)
    c=pd.read_csv(out/'source-counts.tsv',sep='\t',index_col=0)
    l=pd.read_csv(out/'registered-results.tsv',sep='\t',index_col=0)
    detail={}
    if g=='GSE99690':
        n=pd.read_csv(out/'author-normalized.tsv',sep='\t',index_col=0)
        refit=pd.read_csv(out/'nine-library-DESeq2-normalized.tsv',sep='\t',index_col=0)
        detail={'authorBaseMeanMaxDifferenceFromNineNormalizedMean':float((a.baseMean-n.mean(axis=1)).abs().max()),'authorBaseMeanMaxDifferenceFromSixNormalizedMean':float((a.baseMean-n[c.columns].mean(axis=1)).abs().max()),'sourceNormalizedVsNineRefitMaxDifference':float((n-refit).abs().max().max()),'eightHourOnlyExpressedGenes':int(((n[c.columns].sum(axis=1)==0)&(n.sum(axis=1)>0)).sum()),'fullAuthorFiniteEffects':int(a.log2FoldChange.notna().sum()),'fullAuthorFiniteP':int(a.pvalue.notna().sum()),'fullAuthorFiniteFDR':int(a.padj.notna().sum())}
    elif g=='GSE242187':
        n=pd.read_csv(out/'DESeq2-normalized.tsv',sep='\t',index_col=0)
        detail={'authorBaseMeanVsSixSampleDESeq2MaxDifference':float((a.baseMean-n.mean(axis=1)).abs().max()),'fullAuthorFDR05':int((a.padj<.05).sum()),'fullAuthorFDR05Up':int(((a.padj<.05)&(a.log2FoldChange>0)).sum()),'fullAuthorFDR05Down':int(((a.padj<.05)&(a.log2FoldChange<0)).sum()),'paperReportedTotal':25,'paperReportedUp':7,'paperReportedDown':18,'authorDiscoveriesOutsideRegistered':sorted(a.index[(a.padj<.05)&~a.index.isin(l.index)]),'registeredMissingAuthorFDR':sorted(l.index.intersection(a.index[a.padj.isna()]))}
    else:
        bh=false_discovery_control(a.PValue)
        order=np.argsort(a.PValue)
        holm=np.empty(len(a))
        holm[order]=np.minimum(np.maximum.accumulate(a.PValue.to_numpy()[order]*(len(a)-np.arange(len(a)))),1)
        detail={'authorRows':len(a),'QValueToBHMinRatio':float(np.min(a.QValue/bh)),'QValueToBHMaxRatio':float(np.max(a.QValue/bh)),'PAdjustVsHolmMaxDifference':float(np.max(np.abs(a.PAdjust-holm))),'LRvsChiSquared1PMaxDifference':float(np.max(np.abs(chi2.sf(a.LR,1)-a.PValue))),'fullQValue05':int((a.QValue<.05).sum()),'registeredSharedQValue05':int(((a.QValue<.05)&a.index.isin(l.index)).sum()),'fullRecomputedBH05':int((bh<.05).sum()),'registeredSharedRecomputedBH05':int(((bh<.05)&a.index.isin(l.index)).sum()),'fullHolm05':int((holm<.05).sum()),'registeredSharedHolm05':int(((holm<.05)&a.index.isin(l.index)).sum()),'registeredMissingAuthorStatistics':int(a.reindex(l.index)[['PValue','QValue']].isna().any(axis=1).sum()),'sourceCountRows':len(c),'sourceRowsAbsentAuthor':len(c.index.difference(a.index)),'authorRowsOutsideRegistered':len(a.index.difference(l.index))}
        pd.DataFrame({'id':a.index,'author_PValue':a.PValue,'author_QValue':a.QValue,'author_PAdjust':a.PAdjust,'recomputed_BH':bh,'recomputed_Holm':holm,'in_registered':a.index.isin(l.index)}).to_csv(out/'multiple-testing-audit.tsv',sep='\t',index=False)
    (out/'detail-audit.json').write_text(json.dumps(detail,indent=2)+'\n')
    inputs=list(out.glob('*'))+list((ROOT/'geo_replication/datasets'/dirname/'raw').glob('*'))+list((ROOT/'geo_replication/datasets'/dirname/'metadata').glob('*'))+[ROOT/'geo_replication/datasets'/dirname/'processed'/f'{g}_DE.tsv']
    if g=='GSE99690': inputs.append(ROOT/'geo_replication/datasets'/dirname/'processed/GSE99690_raw_counts_3h.tsv.gz')
    inputs+=list((ROOT/'scripts').glob('followup10_GSE99690*'))
    hashes=[]
    for path in sorted(set(inputs)):
        if path.is_file() and path.name!='artifact-manifest.json':
            hashes.append({'path':path.relative_to(ROOT).as_posix(),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    (out/'artifact-manifest.json').write_text(json.dumps({'schemaVersion':1,'dataset':g,'artifacts':hashes},indent=2)+'\n')
    print(g,json.dumps({k:v for k,v in detail.items() if not isinstance(v,list)}))
