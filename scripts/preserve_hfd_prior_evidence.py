"""Preserve the exact sealed September 11 inputs before adding new studies.

Existing snapshots are immutable. The original review seals remain the authority;
this only relocates their historical bytes away from regenerating ledgers.
"""
import gzip
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/quality/hfd-intake-2026-09-12/preserved-inputs'
BASELINE = ROOT / 'data/quality/pipeline-separation-2026-09-11/baseline.json.gz'
baseline = json.loads(gzip.decompress(BASELINE.read_bytes()))
scoped = json.loads((ROOT / 'data/author-validation/continuation-round2-2026-09-11/intake-author/GSE148252/scoped-comparisons.json').read_text(encoding='utf-8'))
references = baseline['sourceFiles'] + [row for row in scoped['dependencyClosure'] if row['path'] == 'geo_replication/config/datasets.tsv']
records = []
for reference in references:
    archive = OUT / (reference['sha256'] + '.gz')
    source = archive if archive.exists() else ROOT / reference['path']
    payload = gzip.decompress(source.read_bytes()) if archive.exists() else source.read_bytes()
    if hashlib.sha256(payload).hexdigest() != reference['sha256'] and reference['path'] == 'geo_replication/config/datasets.tsv':
        committed = subprocess.check_output(['git', 'show', 'HEAD:geo_replication/config/datasets.tsv'], cwd=ROOT)
        candidates = [committed, committed.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')]
        payload = next(value for value in candidates if hashlib.sha256(value).hexdigest() == reference['sha256'])
    assert hashlib.sha256(payload).hexdigest() == reference['sha256'], reference['path']
    assert len(payload) == reference['bytes'], reference['path']
    if not archive.exists():
        OUT.mkdir(parents=True, exist_ok=True)
        archive.write_bytes(gzip.compress(payload, mtime=0))
    records.append({**reference, 'archivePath': archive.relative_to(ROOT).as_posix()})
manifest = {'schemaVersion': 1, 'purpose': 'Immutable original inputs for the sealed September 11 review; these are historical evidence, not current dataset assessments.', 'records': records}
path = OUT / 'manifest.json'
text = json.dumps(manifest, indent=2) + '\n'
if path.exists():
    prior = json.loads(path.read_text(encoding='utf-8'))
    assert all(row in records for row in prior['records']), 'Historical input reference changed'
path.write_text(text, encoding='utf-8', newline='\n')
print(f'Preserved and verified {len(records)} sealed historical inputs.')
