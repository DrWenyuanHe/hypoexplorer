"""Pin and verify the three bounded follow-up bundles. No shared ledger edits.

Run from repository root with bundled Python; --check only reads pinned files.
"""
from pathlib import Path
import hashlib
import json
import sys

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'data/author-validation/continued-sources/ten-dataset-followup-2026-09-04'
CONFIG={
    'GSE185074':('mmus_tanycyte_insulin','GSE185074_counts.xlsx','PMC8688146','GSE185074_wt_hfd_ncd.xlsx'),
    'GSE210311':('mmus_arc_pomc_drd2','GSE210311_counts.csv.gz','PMC9675440','GSE210311_de.csv.gz'),
    'GSE153551':('mmus_hypo_obob_fgf1','GSE153549_bulk_raw_counts.csv.gz','PMC7477234',''),
}
PREFIX='scripts/followup10_GSE185074_GSE210311_GSE153551'
SCRIPTS=[ROOT/(PREFIX+s) for s in ['.py','.R','_manifest.py']]

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def validate_content(g):
    out=BASE/g
    p=json.loads((out/'proposed-updates.json').read_text(encoding='utf-8'))
    profile=p['profileUpdates']
    assert set(profile['dimensions'])=={'cohort','contrast','features','effects','inference','coverage'}
    assert profile['target']=='registered_output' and profile['assessment']=='limited'
    assert p['verificationReview']['fullyVerifiedContrasts']==[]
    assert p['verificationReview']['resultAvailability']=='available'
    assert all(x['status'] in {'matched','compatible','limited','different','not_tested'} for x in profile['dimensions'].values())
    s=json.loads((out/'comparison-summary.json').read_text(encoding='utf-8'))
    r=s['registered']
    assert r['paired_overlap']<=min(r['paired_author_FDR_lt05'],r['paired_comparison_FDR_lt05'])
    provenance=json.loads((out/'cohort-provenance-summary.json').read_text(encoding='utf-8'))
    assert provenance['fresh_official_bytes_equal_local']
    if g=='GSE210311':
        m=s['sensitivity_registered_IP_cohort']
        assert m['paired_overlap']==m['all_author_FDR_lt05']==m['all_comparison_FDR_lt05']==5757
        assert m['shared_FDR_missing_mask_disagreements']==m['shared_effect_missing_mask_disagreements']==0
        assert r['paired_finite_FDR']==14383 and r['comparison_calls_among_author_FDR_missing']==7
    if g=='GSE153551':
        m=s['published_code_all47']
        assert m['paired_overlap']==m['all_author_FDR_lt05']==m['all_comparison_FDR_lt05']==1766
        assert m['effect_max_abs_delta']<1e-6 and m['fdr_max_abs_delta']<1e-6
        assert r['paired_comparison_FDR_lt05']==4973 and r['all_comparison_FDR_lt05']==4978

for g,(folder,countfile,pmc,resultfile) in CONFIG.items():
    out=BASE/g
    manifest=out/'manifest.json'
    validate_content(g)
    if '--check' in sys.argv:
        files=json.loads(manifest.read_text(encoding='utf-8'))['files']
        failures=[r['path'] for r in files if not (ROOT/r['path']).is_file() or sha(ROOT/r['path'])!=r['sha256']]
        if failures:
            raise SystemExit(f'{g}: SHA mismatch: {failures}')
        print(f'{g}: {len(files)} SHA-256 hashes and scientific/schema assertions passed')
        continue
    ds=ROOT/'geo_replication/datasets'/f'{g}_{folder}'
    inputs=[ds/'raw'/countfile,ds/'metadata'/f'{g}_samplesheet.tsv',ds/'processed'/f'{g}_DE.tsv']
    if g=='GSE185074': inputs.append(ds/'raw/GSE185074_counts.tsv.gz')
    accession='GSE153549' if g=='GSE153551' else g
    urlbase=f'https://ftp.ncbi.nlm.nih.gov/geo/series/{accession[:6]}nnn/{accession}/'
    urls={f'{pmc}.xml':f'https://www.ebi.ac.uk/europepmc/webservices/rest/{pmc}/fullTextXML',
          'family.soft.gz':urlbase+f'soft/{accession}_family.soft.gz',
          ('official-counts.xlsx' if g=='GSE185074' else 'official-counts.csv.gz'):urlbase+'suppl/'+countfile}
    if resultfile:
        urls['author_wt_hfd_ncd.xlsx' if g=='GSE185074' else 'author_de.csv.gz']=urlbase+'suppl/'+resultfile
    if g=='GSE185074':
        urls['github-response.html']='https://github.com/bruening-lab/insulin-receptors-in-tanycytes-gate-hypothalamic-insulin-uptake-and-regulate-agrp-neuronal-activity'
    if g=='GSE210311': urls['zenodo-record.json']='https://zenodo.org/api/records/6587789'
    if g=='GSE153551':
        urls.update({
          'author_Data11.xlsx':'https://pmc-oa-opendata.s3.amazonaws.com/PMC7477234.1/41467_2020_17720_MOESM13_ESM.xlsx',
          'bulk_meta_counts.csv.gz':urlbase+'suppl/GSE153549_bulk_meta_counts.csv.gz',
          'GEO-inventory.html':urlbase+'suppl/',
          'github-tree.json':'https://api.github.com/repos/perslab/bentsen-rausch-2020/git/trees/master?recursive=1',
          'author-figure_7.Rmd':'https://raw.githubusercontent.com/perslab/bentsen-rausch-2020/master/analysis/figure_7.Rmd',
          'author-figure_7.commit-pinned.Rmd':'https://raw.githubusercontent.com/perslab/bentsen-rausch-2020/52d88678668db304f946a6a33e34a56f22ddea6a/analysis/figure_7.Rmd',
          'author-data-README.md':'https://raw.githubusercontent.com/perslab/bentsen-rausch-2020/master/data/README.md'})
    retrieval=[{'file':name,'url':url,'http_status':404 if name=='github-response.html' else 200,
                'retrieved_on':'2026-09-04','sha256':sha(out/name)} for name,url in urls.items()]
    (out/'retrieval-log.json').write_text(json.dumps(retrieval,indent=2),encoding='utf-8')
    files=sorted(set(inputs+SCRIPTS+[f for f in out.iterdir() if f.is_file() and f.name!='manifest.json']))
    records=[{'path':str(f.relative_to(ROOT)).replace('\\','/'),'bytes':f.stat().st_size,
              'sha256':sha(f),**({'source_url':urls[f.name]} if f.parent==out and f.name in urls else {})} for f in files]
    manifest.write_text(json.dumps({'schemaVersion':1,'dataset':g,'generated_on':'2026-09-04',
      'registered_outputs_modified':False,'files':records},indent=2),encoding='utf-8')
    print(f'{g}: pinned {len(records)} files; largest {max(r["bytes"] for r in records):,} bytes')
