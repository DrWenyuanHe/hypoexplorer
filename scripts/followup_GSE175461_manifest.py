"""Build or verify the narrowly scoped follow-up evidence SHA-256 manifest."""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/author-validation/continued-sources/five-dataset-followup-2026-09-04/GSE175461'
MANIFEST = OUT / 'artifact-manifest.json'
DS = ROOT / 'geo_replication/datasets/GSE175461_rnor_son_dehydration'

def entry(path):
    content = path.read_bytes()
    return {'path': path.relative_to(ROOT).as_posix(), 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}

if '--check' in sys.argv:
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    errors = []
    for item in manifest['files']:
        path = (ROOT / item['path']).resolve()
        if not path.is_relative_to(ROOT.resolve()) or not path.is_file() or entry(path) != item:
            errors.append(item['path'])
    if errors:
        raise SystemExit('Manifest mismatch: ' + ', '.join(errors))
    print(f"PASS: {len(manifest['files'])} evidence/input/script hashes verified")
else:
    external_inputs = [
        DS / 'raw/GSE175461_Pauza_et_al_2021_J-Neuroendocrinology_Raw_read_counts.csv.gz',
        DS / 'raw/GSE175461_counts.tsv.gz', DS / 'metadata/GSE175461_family.soft.gz',
        DS / 'metadata/GSE175461_samplesheet.tsv', DS / 'metadata/GSE175461_source_files.tsv',
        DS / 'processed/GSE175461_DE.tsv',
        ROOT / 'geo_replication/datasets/_author_de/GSE175461_author_DE.csv.gz',
        ROOT / 'geo_replication/datasets/_author_de/source_manifest.tsv',
        ROOT / 'geo_replication/scripts/prep_GSE175461.R',
        ROOT / 'geo_replication/scripts/run_dataset.R',
    ]
    paths = set(external_inputs) | set(ROOT.glob('scripts/followup_GSE175461*')) | {p for p in OUT.rglob('*') if p.is_file() and p != MANIFEST}
    result = {'schemaVersion': 1, 'datasetId': 'rat_son_dehydration_gse175461', 'hashAlgorithm': 'SHA-256',
              'note': 'Relative paths resolve from project root. Inputs are retained in their original locations. Sensitivity outputs are not production outputs.',
              'files': [entry(p) for p in sorted(paths)]}
    MANIFEST.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(f"Wrote manifest for {len(result['files'])} evidence/input/script files")
