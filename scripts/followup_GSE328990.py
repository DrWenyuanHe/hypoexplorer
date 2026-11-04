"""Read-only source/cohort audit and supplement extraction for POMC estrogen."""
from pathlib import Path
import gzip
import json
import re
import zipfile
import numpy as np
import pandas as pd
from pypdf import PdfReader
from followup_GSE284408 import compare, write_json, digest

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "data/author-validation/continued-sources/five-dataset-followup-2026-09-04/GSE328990"
DATA = ROOT / "geo_replication/datasets/GSE328990_mmus_hypo_pomc_estrogen"


def main():
    with zipfile.ZipFile(BASE / "europepmc_supplements.zip") as archive:
        # Fixed member only. Never extract arbitrary archive paths.
        with (BASE / "supplementary_materials.pdf").open("wb") as stream:
            stream.write(archive.read("supplementary_materials.pdf"))
    pdf = PdfReader(BASE / "supplementary_materials.pdf")
    assert len(pdf.pages)==10
    assert 'Supplementary table 4.' in pdf.pages[9].extract_text()
    soft = gzip.open(BASE / "GSE328990_family.soft.gz", "rt").read()
    source_samples = []
    for block in soft.split("^SAMPLE = ")[1:]:
        gsm = block.splitlines()[0]
        title = re.search(r"!Sample_title = (.+)",block).group(1)
        pool = re.search(r"Library name: (Pool\d+)",block).group(1).lower()
        genotype = re.search(r"genotype: (.+)",block).group(1)
        source_samples.append(dict(sample=pool, gsm=gsm, author_title=title, genotype=genotype,
                                   author_group="control" if genotype=="wildtype" else "case",
                                   animals_per_pool=2, unit="independent two-animal RNA pool"))
    source = pd.DataFrame(source_samples)
    local = pd.read_csv(DATA / "metadata/GSE328990_samplesheet.tsv", sep="\t")
    joined = local.merge(source,on="sample",validate="one_to_one")
    assert len(joined)==len(local)==len(source)==8
    assert (joined.group==joined.author_group).all()
    joined.to_csv(BASE / "cohort-audit.tsv",sep="\t",index=False)
    result={"schemaVersion":1,"reviewedAt":"2026-09-04","sampleMapping":"8/8 exact pool-to-genotype matches using each GEO Sample_description Library name, not sample order inference", "replication":"four independent two-animal pools per genotype, not eight independent libraries per genotype", "sourceSupplementaryFiles":re.findall(r"!Series_supplementary_file = (.+)",soft), "matchedPools":8, "omittedGeoPools":0, "localGenotypeErrors":0, "hypothesis":"bulk hypothalamus POMC-C451Af/f minus wildtype in 16-week-old females; not isolated POMC cells"}
    (BASE / "cohort-summary.json").write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(result,indent=2))


def audit_results():
    author=pd.read_csv(BASE/'GSE328990_DESeq2_KO_vs_WT.csv.gz').rename(columns={'gene_id':'id','log2FoldChange':'log2(fc)','pvalue':'PValue','padj':'FDR'})
    local=pd.read_csv(DATA/'processed/GSE328990_DE.tsv',sep='\t')
    sensitivity=pd.read_csv(BASE/'rounded_no_offsets_sensitivity.tsv',sep='\t').rename(columns={'gene_id':'id'})
    registered,j=compare(author,local)
    diagnostic,s=compare(author,sensitivity,'log2FoldChange')
    # ARC's nominal-P/1.5-fold rule is not the POMC manuscript rule.
    del registered['paperRuleSharedFinite'],diagnostic['paperRuleSharedFinite']
    j.to_csv(BASE/'registered-vs-author.tsv',sep='\t',index=False,na_rep='NA')
    s.to_csv(BASE/'no-offset-sensitivity-vs-author.tsv',sep='\t',index=False,na_rep='NA')
    calls=author.loc[(author.FDR<=.05)&(author['log2(fc)'].abs()>.5)].copy()
    assert len(calls)==18
    # Visually checked Supplementary Table 4, PDF page 10. Symbol correspondence
    # is identified by unique effect and P-value pairs, since the PDF omits IDs.
    printed=[('Gm49510',1.34,2.53e-5),('Trim34b',2.75,3.41e-5),('Hddc3',.82,1.47e-9),
       ('Gm44675',4.94,1.75e-11),('Efr3b',1.02,1.61e-86),('Mrpl48-ps',9.11,2.42e-18),
       ('Th',.55,4.18e-5),('Gm35082',1.51,1.45e-7),('Gbp4',.80,4.36e-5),('Cenpf',-2.27,1.35e-5),
       ('Mutyh',-.78,2.51e-5),('Myo7a',-.77,4.64e-20),('Nlrp5-ps',-1.11,5e-5),
       ('Fam205a3',-22.8,1.73e-11),('Gm44677',-1.33,1.22e-6),('Trim12a',-1.,2.29e-5),
       ('Gm8116',-3.96,6.93e-6),('Best1',-.64,1.03e-5)]
    rows=[]
    for symbol,effect,pvalue in printed:
        tol=.05 if symbol=='Fam205a3' else .005
        match=calls.loc[(calls['log2(fc)']-effect).abs()<=tol]
        match=match.loc[np.isclose(match.PValue,pvalue,rtol=.005,atol=0)]
        assert len(match)==1,(symbol,len(match))
        row=match.iloc[0].to_dict()
        row.update(table4_symbol=symbol,table4_log2FC=effect,table4_pvalue=pvalue)
        rows.append(row)
    table=pd.DataFrame(rows)
    assert set(table.id)==set(calls.id) and not table.id.duplicated().any()
    table=table.merge(local[['id','symbol','logFC','pvalue','padj']],on='id',how='left',validate='one_to_one')
    table.to_csv(BASE/'table4-vs-deposit-and-registered.tsv',sep='\t',index=False,na_rep='NA')
    counts=pd.read_csv(DATA/'raw/GSE328990_gene_counts.csv.gz')
    assert digest(DATA/'raw/GSE328990_gene_counts.csv.gz')==digest(BASE/'GSE328990_gene_counts.csv.gz')
    missing=calls.loc[~calls.id.isin(local.id)].merge(counts,left_on='id',right_on='gene_id',validate='one_to_one')
    missing.to_csv(BASE/'paper-calls-outside-registered-filter.tsv',sep='\t',index=False,na_rep='NA')
    local_rule=(local.padj<=.05)&(local.logFC.abs()>.5)
    comparison={'rule':'FDR<=.05 and abs(log2FC)>.5, on each output separately',
      'authorCalls':len(calls),'localCalls':int(local_rule.sum()),'sharedCalls':int(local.loc[local_rule,'id'].isin(calls.id).sum()),
      'authorCallsAbsentLocal':missing.id.tolist(),'matchedAuthorDirections':int((np.sign(table['log2(fc)'])==np.sign(table.logFC)).sum()),
      'directionDenominator':int(table.logFC.notna().sum()),
      'sourceTable4Rows':18,'table4NumericalIdentityMatches':18,
      'table4MatchCaveat':'Unique effect/P-value correspondence at printed precision. PDF omits Ensembl IDs. Gm49510 printed FDR .0267 differs slightly from deposited .0265844; no all-statistics exact claim.'}
    result={'schemaVersion':1,'reviewedAt':'2026-09-04','registeredOutputChanged':False,'byteIdenticalCountSource':True,
      'countRows':len(counts),'authorResultRows':len(author),'registeredRows':len(local),'registeredComparison':registered,
      'paperRule':comparison,'noOffsetDiagnostic':diagnostic,
      'noOffsetDiagnosticAllFDRCalls':int((sensitivity.padj<=.05).sum()),
      'authorAllFDRCalls':int((author.FDR<=.05).sum()),
      'conclusion':'Eight pool/genotype assignments and published 18-gene reference reconciled. Two paper hits lie outside the registered filter. Rounded gene-estimate DESeq2 without offsets does not recover the author output, so changing framework alone does not resolve inference.',
      'remainingStep':'Recover Salmon quant.sf files or a tximport object and exact countsFromAbundance, filtering, Cook handling and design settings; then reconcile the two excluded paper hits and registered effect/FDR residuals. Missing offsets/settings are a reconstruction-input gap, not missing processed author results.'}
    write_json(BASE/'followup-summary.json',result)
    paths=[p for p in BASE.iterdir() if p.is_file() and p.name!='manifest.json']+[Path(__file__),ROOT/'scripts/followup_GSE328990.R',ROOT/'scripts/followup_GSE284408.py',DATA/'raw/GSE328990_gene_counts.csv.gz',DATA/'metadata/GSE328990_samplesheet.tsv',DATA/'processed/GSE328990_DE.tsv']
    write_json(BASE/'manifest.json',{'schemaVersion':1,'files':[{'path':p.relative_to(ROOT).as_posix(),'bytes':p.stat().st_size,'sha256':digest(p)} for p in paths]})
    print(json.dumps(result,indent=2))


if __name__ == "__main__":
    main()
    audit_results()
