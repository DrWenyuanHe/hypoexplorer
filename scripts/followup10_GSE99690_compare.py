"""Compare unchanged published statistics and separate diagnostic models."""
import json
from pathlib import Path
import numpy as np
import pandas as pd

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'data/author-validation/continued-sources/ten-dataset-followup-2026-09-04'
def result(frame, effect, p, q):
    return frame[[effect,p,q]].rename(columns={effect:'effect',p:'pvalue',q:'padj'})
def compare(author, other):
    j=author.add_prefix('author_').join(other.add_prefix('other_'),how='inner')
    e=j[np.isfinite(j.author_effect)&np.isfinite(j.other_effect)]
    f=e[np.isfinite(e.author_pvalue)&np.isfinite(e.author_padj)&np.isfinite(e.other_pvalue)&np.isfinite(e.other_padj)]
    a=set(f.index[f.author_padj<0.05]); b=set(f.index[f.other_padj<0.05])
    full_a=set(author.index[np.isfinite(author.pvalue)&(author.padj<0.05)])
    full_b=set(other.index[np.isfinite(other.pvalue)&(other.padj<0.05)])
    strong=e[e.author_effect.abs()>=0.5]
    x={'joinedRows':len(j),'finiteEffectRows':len(e),'pairedFiniteInferenceRows':len(f),'joinedMissingAuthorP':int(j.author_pvalue.isna().sum()),'joinedMissingAuthorFDR':int(j.author_padj.isna().sum()),'effectPearson':float(e.author_effect.corr(e.other_effect)),'effectMedianAbsoluteDifference':float((e.author_effect-e.other_effect).abs().median()),'effectMaxAbsoluteDifference':float((e.author_effect-e.other_effect).abs().max()),'strongEffectRows':len(strong),'strongDirectionAgreements':int((np.sign(strong.author_effect)==np.sign(strong.other_effect)).sum()),'pairedAuthorFDR05':len(a),'pairedOtherFDR05':len(b),'pairedSharedFDR05':len(a&b),'pairedJaccard':len(a&b)/len(a|b) if a|b else None,'fullAuthorFDR05':len(full_a),'fullOtherFDR05':len(full_b),'fullSharedFDR05':len(full_a&full_b),'fullAuthorOnlyFDR05':sorted(full_a-full_b),'fullOtherOnlyFDR05':sorted(full_b-full_a),'authorDiscoveriesOutsideOtherUniverse':sorted(full_a-set(other.index)),'otherDiscoveriesWithoutAuthorFDR':sorted(full_b&set(j.index[j.author_padj.isna()])),'finitePMaxDifference':float((f.author_pvalue-f.other_pvalue).abs().max()),'finiteFDRMaxDifference':float((f.author_padj-f.other_padj).abs().max())}
    return x,j
for g in ['GSE99690','GSE242187','GSE295250']:
    out=BASE/g
    a=pd.read_csv(out/'author-results.tsv',sep='\t',index_col=0)
    local=pd.read_csv(out/'registered-results.tsv',sep='\t',index_col=0)
    a=result(a,'logFC','PValue','QValue') if g=='GSE295250' else result(a,'log2FoldChange','pvalue','padj')
    if g=='GSE295250': a['effect']=-a['effect']
    comparisons={'registered':result(local,'logFC','pvalue','padj')}
    for path in out.glob('*DESeq2-*.tsv'):
        if 'normalized' not in path.stem and not path.stem.startswith('comparison-'):
            d=pd.read_csv(path,sep='\t',index_col=0)
            comparisons[path.stem]=result(d,'log2FoldChange','pvalue','padj')
    for path in out.glob('*-edgeR-*.tsv'):
        if path.stem.startswith('comparison-'): continue
        d=pd.read_csv(path,sep='\t',index_col=0)
        comparisons[path.stem]=result(d,'logFC','PValue','FDR')
    summary={}
    for name,d in comparisons.items():
        summary[name],joined=compare(a,d)
        joined.to_csv(out/f'comparison-{name}.tsv',sep='\t',index_label='id')
    (out/'comparison-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(g,json.dumps({k:{a:b for a,b in v.items() if not isinstance(b,list)} for k,v in summary.items()}))
