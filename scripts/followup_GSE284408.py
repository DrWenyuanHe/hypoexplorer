"""Evidence-only ARC diet follow-up. Original and registered files are read-only."""
from pathlib import Path
import gzip
import json
import hashlib
import re
import zipfile
import xml.etree.ElementTree as ET
import numpy as np
import pandas as pd
from scipy.stats import spearmanr

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "data/author-validation/continued-sources/five-dataset-followup-2026-09-04"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False)+"\n", encoding="utf-8")


def compare(author, other, effect="logFC", p="pvalue", q="padj"):
    joined = author[["id","log2(fc)","PValue","FDR"]].merge(other, on="id", validate="one_to_one")
    finite = np.isfinite(joined["log2(fc)"]) & np.isfinite(joined[effect])
    delta = joined.loc[finite,effect] - joined.loc[finite,"log2(fc)"]
    out = {"joinedRows":len(joined),"effectPairs":int(finite.sum()),
           "pearson":float(joined.loc[finite,["log2(fc)",effect]].corr().iloc[0,1]),
           "spearman":float(spearmanr(joined.loc[finite,"log2(fc)"],joined.loc[finite,effect]).statistic),
           "medianAbsEffectDelta":float(delta.abs().median()),"maxAbsEffectDelta":float(delta.abs().max())}
    for name, ac, oc in [("rawP","PValue",p),("FDR","FDR",q)]:
        pair = finite & np.isfinite(joined[ac]) & np.isfinite(joined[oc])
        a = pair & (joined[ac]<.05)
        b = pair & (joined[oc]<.05)
        out[name] = {"finitePairs":int(pair.sum()),"authorCalls":int(a.sum()),"otherCalls":int(b.sum()),
                     "sharedCalls":int((a&b).sum()),"jaccard":float((a&b).sum()/(a|b).sum()) if (a|b).any() else None,
                     "maxAbsDelta":float((joined.loc[pair,ac]-joined.loc[pair,oc]).abs().max()),
                     "authorCallsAbsentOtherRows":int((~author.id.isin(other.id)&(author[ac]<.05)).sum()),
                     "authorCallsMissingOtherStatistic":int(((joined[ac]<.05)&~np.isfinite(joined[oc])).sum()),
                     "otherCallsMissingAuthorStatistic":int(((joined[oc]<.05)&~np.isfinite(joined[ac])).sum()),
                     "oppositeAuthorSignificantDirections":int((a & (np.sign(joined['log2(fc)'])!=np.sign(joined[effect]))).sum())}
    # Fold-change ratio >1.5 in either direction, not abs(log2FC)>1.5.
    pair = finite & np.isfinite(joined.PValue) & np.isfinite(joined[p])
    a = pair & (joined.PValue<.05) & (joined["log2(fc)"].abs()>np.log2(1.5))
    b = pair & (joined[p]<.05) & (joined[effect].abs()>np.log2(1.5))
    out["paperRuleSharedFinite"]={"rule":"nominal P<.05 and abs(log2FC)>log2(1.5)","finitePairs":int(pair.sum()),
       "authorCalls":int(a.sum()),"otherCalls":int(b.sum()),"sharedCalls":int((a&b).sum()),
       "jaccard":float((a&b).sum()/(a|b).sum()) if (a|b).any() else None}
    out["statisticAvailability"]={"authorRawPFinite":int(np.isfinite(author.PValue).sum()),
      "authorFDRFinite":int(np.isfinite(author.FDR).sum()),"otherRawPMissingOnJoin":int((~np.isfinite(joined[p])).sum()),
      "otherFDRMissingOnJoin":int((~np.isfinite(joined[q])).sum()),
      "note":"Missing statistics excluded from paired inference, never classified as non-significant."}
    return out, joined


def audit():
    folder=BASE/"GSE284408"
    data=ROOT/"geo_replication/datasets/GSE284408_mmus_arc_hfd"
    source_path=folder/"GSE284408_author_table.txt.gz"
    source=pd.read_csv(source_path,sep="\t")
    local=pd.read_csv(data/"processed/GSE284408_DE.tsv",sep="\t")
    refit=pd.read_csv(folder/"deseq2_sensitivity.tsv",sep="\t")
    assert not source.id.duplicated().any() and not local.id.duplicated().any()
    assert digest(source_path)==digest(data/"raw/GSE284408_counts.txt.gz")
    with zipfile.ZipFile(folder/"europepmc_supplements.zip") as archive:
        (folder/"mmc2.xlsx").write_bytes(archive.read("mmc2.xlsx"))
    supplement=pd.read_excel(folder/"mmc2.xlsx",header=2)
    supplement=supplement.loc[supplement.id.notna()].copy()
    assert supplement.id.str.startswith("ENSMUSG").all() and not supplement.id.duplicated().any()
    supp_join=supplement[["id","Symbol","log2(fc)","PValue"]].merge(source,on="id",suffixes=("_supp",""),validate="one_to_one")
    supp_join[["id","Symbol","log2(fc)_supp","log2(fc)","PValue_supp","PValue"]].to_csv(folder/"supplement-vs-deposit.tsv",sep="\t",index=False,na_rep="NA")
    assert len(supp_join)==len(supplement)
    soft=gzip.open(folder/"GSE284408_family.soft.gz","rt").read()
    samples=[]
    for block in soft.split("^SAMPLE = ")[1:]:
        title=re.search(r"!Sample_title = (.+)",block).group(1)
        samples.append({"sample":title+"_count","gsm":block.splitlines()[0],"title":title,
          "author_group":"control" if title.startswith("C") else "case","sex":"male","tissue":"laser-captured ARC region enriched with Kiss1 neurons"})
    sheet=pd.read_csv(data/"metadata/GSE284408_samplesheet.tsv",sep="\t")
    cohort=sheet.merge(pd.DataFrame(samples),on="sample",validate="one_to_one")
    assert len(cohort)==len(sheet)==len(samples)==6 and (cohort.group==cohort.author_group).all()
    assert set(sheet['sample'])==set(c for c in source.columns if c.endswith("_count"))
    cohort.to_csv(folder/"cohort-audit.tsv",sep="\t",index=False)
    registered,j=compare(source,local)
    sensitivity,s=compare(source,refit,"log2FoldChange")
    inferred_unavailable=set(refit.loc[~np.isfinite(refit.padj),'id'])
    unavailable_source=source.loc[source.id.isin(inferred_unavailable)]
    assert ((unavailable_source.PValue==1)&(unavailable_source.FDR==1)).all()
    eligible_comparison,_=compare(source.loc[~source.id.isin(inferred_unavailable)],local.loc[~local.id.isin(inferred_unavailable)])
    local_unavailable=local.loc[local.id.isin(inferred_unavailable)]
    local_unavailable.to_csv(folder/'registered-with-author-one-coded-unavailable-tests.tsv',sep='\t',index=False)
    j.to_csv(folder/"registered-vs-author.tsv",sep="\t",index=False,na_rep="NA")
    s.to_csv(folder/"sensitivity-vs-author.tsv",sep="\t",index=False,na_rep="NA")
    missing=source.loc[~source.id.isin(local.id)].copy()
    missing.to_csv(folder/"author-rows-not-in-registered-output.tsv",sep="\t",index=False,na_rep="NA")
    a_sig=(source.PValue<.05)&(source["log2(fc)"].abs()>np.log2(1.5))
    extra=supplement.loc[~supplement.id.isin(source.loc[a_sig,'id']),['id','Symbol','log2(fc)','PValue']]
    extra.to_csv(folder/'supplement-below-published-fold-change-cutoff.tsv',sep='\t',index=False)
    # Test the author's reported effect definition directly from deposited group means.
    ratio=np.log2(source["HFD-Arc_mean"] / source["NCD-Arc_mean"])
    finite=np.isfinite(ratio)&np.isfinite(source["log2(fc)"])
    author_sig_ids=set(source.loc[source.FDR<.05,"id"])
    sensitivity_sig_ids=set(refit.loc[refit.padj<.05,"id"])
    result={"schemaVersion":1,"reviewedAt":"2026-09-04","productionFilesChanged":False,
      "cohort":{"matchedGEOAndCountLibraries":6,"NCD":3,"HFD":3,"omittedLibraries":0,"annotation":"male ARC laser-capture samples; region enrichment is not single-cell isolation"},
      "inputSha256":digest(source_path),"byteIdenticalToLocalSource":True,
      "authorRows":len(source),"registeredRows":len(local),"authorRowsOutsideLocalFilter":len(missing),
      "authorFDRCallsOutsideLocalFilter":int((missing.FDR<.05).sum()),
      "authorPaperCallsOutsideLocalFilter":int(((missing.PValue<.05)&(missing['log2(fc)'].abs()>np.log2(1.5))).sum()),
      "authorReportedEffects":{"testedDefinition":"log2(HFD FPKM group mean / NCD FPKM group mean)","finiteRows":int(finite.sum()),"maxAbsDelta":float((ratio[finite]-source.loc[finite,'log2(fc)']).abs().max()),"interpretation":"Deposit effect column uses expression means; do not assume it is the DESeq2 fitted coefficient."},
      "paperTableS1":{"rows":len(supplement),"up":int((supplement['log2(fc)']>0).sum()),"down":int((supplement['log2(fc)']<0).sum()),
        "matchedToDeposit":len(supp_join),"maxAbsEffectDelta":float((supp_join['log2(fc)_supp']-supp_join['log2(fc)']).abs().max()),"maxAbsPDelta":float((supp_join.PValue_supp-supp_join.PValue).abs().max()),
        "tableIdsEqualNominalP05FC1_5":set(supplement.id)==set(source.loc[a_sig,'id']),"nominalP05FC1_5Rows":int(a_sig.sum()),
        "strictRuleUp":int((source.loc[a_sig,'log2(fc)']>0).sum()),"strictRuleDown":int((source.loc[a_sig,'log2(fc)']<0).sum()),
        "extraTableRowsBelowPublishedFoldCutoff":len(extra),"extraRowMinAbsLog2FC":float(extra['log2(fc)'].abs().min()),"extraRowMaxAbsLog2FC":float(extra['log2(fc)'].abs().max()),
        "manuscriptNarrative":"389 total, 164 up and 125 down; these reported totals are internally inconsistent and must be checked against Table S1, not forced as fitting targets."},
      "registeredComparison":registered,"deseq2SensitivityComparison":sensitivity,
      "registeredModelInferredEligibility":eligible_comparison,
      "authorOneCodedMissingness":{"authorPAndFDR1CorrespondingToRefitNA":len(unavailable_source),"zeroCountRows":int((unavailable_source[sheet['sample']].sum(axis=1)==0).sum()),"registeredRowsAffected":len(local_unavailable),"registeredNominalPCallsAffected":int((local_unavailable.pvalue<.05).sum()),"registeredFDRCallsAffected":int((local_unavailable.padj<.05).sum()),"interpretation":"Original author P/FDR values are 1, not NA. Separate DESeq2 identifies these positions as unavailable; this is model-inferred eligibility, not original author missingness. Retain both the literal-export comparison and this restricted comparison."},
      "sensitivityFDR19IdsExact":author_sig_ids==sensitivity_sig_ids,
      "remainingStep":"Review ten Table S1 rows below the published 1.5-fold cutoff and resolve the 389-versus-289 narrative discrepancy. Author inference agrees numerically on 18,169 jointly finite tests in a separate DESeq2 sensitivity, but author 1-coded/refit-NA positions are not identical missingness. Registered edgeR has a different discovery set and effect definition; retain these differences before full-result sign-off."}
    write_json(folder/"followup-summary.json",result)
    paths=[p for p in folder.iterdir() if p.is_file() and p.name!='manifest.json']+[Path(__file__),ROOT/'scripts/followup_GSE284408.R',data/'raw/GSE284408_counts.txt.gz',data/'metadata/GSE284408_samplesheet.tsv',data/'processed/GSE284408_DE.tsv']
    write_json(folder/"manifest.json",{"schemaVersion":1,"reviewedAt":"2026-09-04","files":[{"path":p.relative_to(ROOT).as_posix(),"bytes":p.stat().st_size,"sha256":digest(p)} for p in paths]})
    print(json.dumps(result,indent=2))


def inspect_sources(accession, pmc, dataset):
    folder = BASE / accession
    soft = gzip.open(folder / f"{accession}_family.soft.gz", "rt").read()
    print(f"\n{accession} OFFICIAL METADATA")
    for line in soft.splitlines():
        if line.startswith(("^SAMPLE", "!Sample_title", "!Sample_source_name", "!Sample_characteristics", "!Sample_data_processing", "!Series_supplementary", "!Sample_treatment")):
            print(line)
    xml = ET.parse(folder / f"{pmc}.xml")
    print("RELEVANT MANUSCRIPT PARAGRAPHS")
    for para in xml.findall(".//p"):
        text = "".join(para.itertext())
        if any(term.lower() in text.lower() for term in ["DESeq", "tximport", "RNA-seq", "RNA sequencing", "differentially expressed", "code availability"]):
            print(text)
    for node in xml.findall(".//supplementary-material"):
        print("SUPPLEMENT", ET.tostring(node, encoding="unicode"))
    print("DATA HEADERS")
    paths = list((ROOT / "geo_replication/datasets" / dataset / "raw").glob("*.gz"))
    paths += [ROOT / "geo_replication/datasets" / dataset / "processed" / f"{accession}_DE.tsv"]
    paths += [p for p in folder.glob("*.gz") if "family" not in p.name]
    for path in paths:
        opener = gzip.open if path.suffix == ".gz" else open
        with opener(path, "rt", encoding="utf-8-sig") as stream:
            print(path.name, stream.readline().strip(), stream.readline().strip()[:1200])


if __name__ == "__main__":
    audit()
