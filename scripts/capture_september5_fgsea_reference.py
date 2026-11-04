"""Initial references for new studies that have no pre-migration output.

These are explicitly post-migration pipeline references, never author evidence.
Existing reference bytes are immutable: reruns fail if an output has changed.
"""
import hashlib
import json
import shutil
from datetime import datetime, timezone
from intake_september5 import ROOT, OUT

base=ROOT/'data/author-validation'
path=base/'fgsea-baselines/manifest.json'
manifest=json.loads(path.read_text(encoding='utf-8'))
studies=json.loads((OUT/'studies.json').read_text(encoding='utf-8'))
analyses=json.loads((OUT/'analyses.json').read_text(encoding='utf-8'))
for s in studies:
    existing=next((r for r in manifest['records'] if r['datasetId']==s['id']),None)
    files=[]
    for a in analyses:
        if a['studyId']!=s['id'] or a['track']!=s['tracks'][0]['id']:continue
        for suffix in ['DE']+['FGSEA_'+db for db in ['HALLMARK','KEGG','GO_BP','REACTOME']]:
            source=f"{s['dir']}/processed/{a['analysisId']}_{suffix}.tsv"
            target=f"fgsea-baselines/september5-2026/{s['accession']}/{a['analysisId']}_{suffix}.tsv"
            b=(ROOT/source).read_bytes();digest=hashlib.sha256(b).hexdigest()
            if (base/target).exists():assert (base/target).read_bytes()==b, 'Initial reference changed: '+target
            else:
                (base/target).parent.mkdir(parents=True,exist_ok=True)
                shutil.copyfile(ROOT/source,base/target)
            files.append({'sourcePath':source,'snapshotPath':target,'bytes':len(b),'sha256':digest})
    if existing:assert existing['files']==files
    else:manifest['records'].append({'datasetId':s['id'],'accession':s['accession'],
      'capturedAt':datetime.now(timezone.utc).isoformat(),
      'note':'Initial post-migration reference for a September 5 intake study, computed with the corrected schema-3 workflow. This study was added after the migration and has no pre-migration result. The reference preserves initial pipeline outputs; it is not author validation or evidence of a migration improvement.',
      'files':files})
path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8',newline='\n')
print(f'Initial post-migration references saved for {len(studies)} new studies')
