"""Create/check a SHA-256 evidence manifest for the bounded final batch D."""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/author-validation/continued-sources/final-numerical-batch-d'
files = [p for p in OUT.iterdir() if p.is_file() and p.name != 'artifact-manifest.json']
files += [ROOT / 'scripts' / name for name in [
    'inspect_final_numerical_d.py', 'validate_final_numerical_d.py',
    'validate_GSE301692_author.R', 'validate_GSE299412_author.R', 'hash_final_numerical_d.py']]
for ds, relative_files in [
    ('GSE299412_drer_hypothalamus', [
        'raw/GSE299412_data.txt.gz', 'processed/GSE299412_DE.tsv',
        'metadata/GSE299412_identifier_mapping.tsv', 'metadata/GSE299412_samplesheet.tsv']),
    ('GSE301692_hsap_hypothalamus_pituitary_organoid', [
        'raw/GSE301692_30_HTSeq.COUNT.txt.gz', 'processed/GSE301692_DE.tsv',
        'metadata/GSE301692_sample_inventory.tsv', 'metadata/GSE301692_samplesheet.tsv']),
]:
    files += [ROOT / 'geo_replication/datasets' / ds / rel for rel in relative_files]
records = []
for path in sorted(set(files)):
    raw = path.read_bytes()
    records.append({'path': path.relative_to(ROOT).as_posix(), 'bytes': len(raw),
                    'sha256': hashlib.sha256(raw).hexdigest()})
manifest = {'schemaVersion': 1, 'reviewedAt': '2026-09-04', 'sourceUrls': [
    'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12376962/supplementaryFiles',
    'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12461651/supplementaryFiles',
    'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12376962/fullTextXML',
    'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12461651/fullTextXML',
    'https://zenodo.org/api/records/15453478'], 'files': records}
target = OUT / 'artifact-manifest.json'
if '--check' in sys.argv:
    assert json.loads(target.read_text(encoding='utf-8')) == manifest, 'Evidence manifest is stale'
    print(f'{len(records)} evidence hashes verified; no files changed')
else:
    target.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {len(records)} evidence hashes')
