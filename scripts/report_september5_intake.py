"""Close the discovery ledger against actual fits and registered studies."""
import json
from intake_september5 import ROOT, OUT, inventory

HOLDS = {
 'GSE344527': ('adapter_required', 'Targeted Xenium assay: needs panel-aware analysis and an animal/section/slide map before the RNA-seq explorer can represent it.'),
 'GSE337251': ('annotation_required', 'Goat counts, lengths and CPM were downloaded. The current intake adapter supports mouse and rat annotation; goat identifiers and pathway ortholog coverage require a validated mapping.'),
 'GSE335323': ('annotation_required', 'Sheep expression matrix was downloaded. Sheep gene annotation and pathway ortholog mapping are not implemented in this intake adapter.'),
 'GSE329974': ('design_review_required', 'Companion allelic-expression series. Requires explicit allele, animal and tissue bindings and a suitable normalized-expression or raw-read workflow.'),
 'GSE329973': ('design_review_required', 'Allelic-expression design requires explicit parental-allele and animal bindings before standard contrasts can be fitted.'),
 'GSE266965': ('raw_reprocessing_required', 'Public processed inputs are coverage tracks rather than a gene-by-sample count matrix; raw reads must be quantified first.'),
 'GSE214011': ('annotation_required', 'Hamster RSEM data use de novo Trinity identifiers. A validated gene/transcript annotation and length-aware import are required.'),
 'GSE181298': ('annotation_required', 'Hamster RSEM data use de novo Trinity identifiers. A validated gene/transcript annotation and length-aware import are required.'),
 'GSE137737': ('raw_reprocessing_required', 'Deposited differential-expression tables cannot replace sample-level input; raw reads need gene quantification.'),
 'GSE137626': ('raw_reprocessing_required', 'Deposited differential-expression tables cannot replace sample-level input; raw reads need gene quantification.'),
 'E-MTAB-16695': ('length_metadata_required', 'Unscaled Salmon gene counts were downloaded, but effective lengths or quant.sf files are absent from the reviewed processed deposit. This non-3-prime assay needs length-aware import.'),
 'E-MTAB-8012': ('raw_reprocessing_required', 'The reviewed deposit supplies raw sequencing reads without a processed gene matrix.'),
 'E-ERAD-404': ('raw_reprocessing_required', 'The reviewed deposit supplies raw sequencing reads; technical runs must be combined within the ten biological mice before analysis.'),
 'E-MTAB-14688': ('raw_reprocessing_required', 'The reviewed deposit supplies raw sequencing reads without a processed gene matrix. The actual sample table supports three mice per arm.'),
}

studies=json.loads((OUT/'studies.json').read_text(encoding='utf-8'))
analyses=json.loads((OUT/'analyses.json').read_text(encoding='utf-8'))
registered={s['id'] for s in json.loads((ROOT/'src/data/september5Studies.generated.json').read_text(encoding='utf-8-sig'))}
by_acc={s['accession']:s for s in studies}
records=inventory()
for r in records:
    acc=r['accession']
    if acc in by_acc:
        s=by_acc[acc]; aa=[a for a in analyses if a['accession']==acc]
        assert len(aa)==len(s['tracks'])*len(s['contrasts'])
        r.update(status='added_to_explorer' if s['id'] in registered else 'analysis_complete',
                 datasetId=s['id'],tracks=len(s['tracks']),analyses=len(aa),
                 intakeReason=s['note'],analysisIds=[a['analysisId'] for a in aa])
    elif acc in HOLDS:
        r['status'],r['intakeReason']=HOLDS[acc]
    else:
        assert r['status']=='already_integrated',acc
(OUT/'ledger.json').write_text(json.dumps({'batch':'2026-09-05','records':records},indent=2)+'\n',encoding='utf-8')

lines=['# September 5 discovery intake','',
 f"{len(studies)} new studies, {sum(len(s['tracks']) for s in studies)} tracks and {len(analyses)} fitted comparisons. {sum(s['id'] in registered for s in studies)} new studies are registered in the explorer.",'',
 'The original discovery files are preserved. Download manifests record source URLs, file sizes and SHA-256 checksums. Animal or independent pool identifiers define replication; cells and technical runs are never promoted to independent animals.','',
 'Count analyses use edgeR quasi-likelihood with TMM normalization; deposited normalized matrices use limma. RSEM imports use lengthScaledTPM. Each comparison has an explicit direction, sample sheet, design, DE table, standard errors and input/output checksums. Pathways use the repository’s schema-3 FGSEA workflow and four MSigDB collections.','',
 'These are local pipeline results. Source and bundle checks do not constitute agreement with independently published author results, which remains a separate review.','',
 '| Study | Tracks | Comparisons | Source and design notes |','|---|---:|---:|---|']
for s in studies:
    aa=[a for a in analyses if a['accession']==s['accession']]
    lines.append(f"| {s['accession']} | {len(s['tracks'])} | {len(aa)} | {s['note'].replace('|','/')} |")
lines+=['','## Candidates retained for further processing','',
 'These records are retained in the discovery tracker and have not been presented as analyzed explorer studies.','',
 '| Study | Hold | Required next step |','|---|---|---|']
for acc,(status,reason) in HOLDS.items():lines.append(f'| {acc} | {status.replace("_"," ")} | {reason} |')
lines+=['','GSE214683 was already integrated and was not duplicated. Initial discovery exclusions and exploratory atlas/pilot leads remain documented in the source discovery report; they are not promoted to eligible studies by this intake.','',
 '## Reproduce','',
 'Run the source fetcher and accession-specific preparers, then:',
 '```powershell','Rscript scripts/run_september5_pipeline.R',
 '$ids = (Get-Content data/intake/september5-2026/analyses.json -Raw | ConvertFrom-Json).analysisId',
 'Rscript scripts/run_mouse_fgsea.R @ids --force','npx tsx scripts/build_september5_bundles.mts',
 'npx tsx scripts/audit_september5_intake.mts','python scripts/report_september5_intake.py','```','',
 'The prepared study manifest and per-study source notes specify the importer and analysis lane. Downloading and preparing raw-read-only or unsupported-species candidates requires the additional work listed above.','']
(OUT/'REPORT.md').write_text('\n'.join(lines),encoding='utf-8')

# Use the existing catalog ingester to preserve earlier reviews and deduplicate
# cross-repository accessions. Discovery eligibility is distinct from readiness.
confirmed=[]
for r in records:
    acc=r['accession'];s=by_acc.get(acc,{})
    confirmed.append({'shortAcc':acc,'pass':14,'searchTag':'September 5 discovery',
      'title':r['title'],'species':s.get('organism',r.get('organism','')),
      'repository':'GEO' if acc.startswith('GSE') else 'ArrayExpress / ENA',
      'region':s.get('region','Hypothalamus'),'modality':s.get('modality','RNA-seq'),
      'design':r.get('biologicalReplication',''),'n':r.get('biologicalReplication',''),
      'why':r.get('discoveryReason',''),'correctionNotes':r.get('intakeReason',r.get('status','')),
      'sourceUrl':r.get('source',(r.get('sources') or [''])[0]),
      'evidenceUrl':r.get('source',(r.get('sources') or [''])[0]),
      'feas':{'tier':'modified-pipeline','pipeline':r['status']},
      'isPublic':True,'isHypothalamus':True})
(OUT/'survey-pass.json').write_text(json.dumps({'confirmed':confirmed},indent=2)+'\n',encoding='utf-8')
print(f'{len(studies)} studies; {len(analyses)} analyses; {len(HOLDS)} holds; {len(records)} reviewed records')
