"""Append new source-inventory records from the checked public intake manifests."""
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from intake_september5 import ROOT, OUT

base=ROOT/'data/author-validation'
path=base/'source-inventory.generated.json'
data=json.loads(path.read_text(encoding='utf-8'))
studies=json.loads((OUT/'studies.json').read_text(encoding='utf-8'))
ledger={r['accession']:r for r in json.loads((OUT/'ledger.json').read_text(encoding='utf-8'))['records']}
ids={s['id'] for s in studies}
data['datasets']=[r for r in data['datasets'] if r['datasetId'] not in ids]
for s in studies:
    acc=s['accession'];pmid=s.get('pmid') or next(iter(ledger[acc].get('pubmed',[])),None)
    manifest=ROOT/s['dir']/'metadata'/f'{acc}_source_files.tsv'
    files=list(csv.DictReader(manifest.open(encoding='utf-8'),delimiter='\t'))
    assert files and all((ROOT/f['local_path']).stat().st_size==int(f['bytes']) for f in files)
    url=f'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={acc}' if acc.startswith('GSE') else f'https://www.ebi.ac.uk/biostudies/arrayexpress/studies/{acc}'
    data['datasets'].append({'datasetId':s['id'],'accession':acc,'processedDataAccession':acc,
      'database':'GEO' if acc.startswith('GSE') else 'BioStudies','databaseRecordUrl':url,
      'processedInventoryUrl':url,'processedInventoryAccess':'listed','processedInventoryHttpStatus':None,
      'depositedFiles':[{'name':Path(f['local_path']).name,'url':f['source_url'],
        'bytes':int(f['bytes']),'repositorySection':'intake source manifest'} for f in files],
      'pmid':pmid,'paperAccess':'pubmed_record_only' if pmid else 'no_linked_publication',
      'pubmedUrl':f'https://pubmed.ncbi.nlm.nih.gov/{pmid}/' if pmid else None,
      'pmcId':None,'pmcUrl':None,
      'inventoryEvidence':manifest.relative_to(ROOT).as_posix(),
      'inventoryNote':'Official deposited files downloaded during September 5 intake; this list covers the selected analysis inputs, not every assay in the study. Publication access has not been independently refreshed.'})
data['generatedAt']=datetime.now(timezone.utc).isoformat()
data['sources']['september5']='Cached official GEO/BioStudies metadata and checksum-pinned download manifests; selected analysis inputs only.'
path.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
print(f'Official source inventory extended to {len(data["datasets"])} studies')
