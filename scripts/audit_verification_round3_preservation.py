"""Compare the entire retained round-three scientific inventory; isolate concurrent config additions."""
import csv
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'data/quality/round3-2026-09-05'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


before = read(FOLDER / 'scientific-files.before.json')
baseline = read(FOLDER / 'baseline.json')
dataset_ids = {row['datasetId'] for row in baseline['quality']['records']}
config_path = 'geo_replication/config/datasets.tsv'
rows = []
for old in before['files']:
    path = (ROOT / old['path']).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError('Scientific inventory path is outside the repository')
    current = digest(path)
    rows.append({**old, 'currentBytes': path.stat().st_size, 'currentSha256': current,
                 'unchangedSinceBefore': current == old['sha256']})
unexpected = [row['path'] for row in rows
              if row['path'] != config_path and (not row['unchangedSinceBefore'] or not row['baselineMatches'])]
source_path = ROOT / 'data/internal-qc/advancement-2026-09-05/normalization-evidence.json'
source = read(source_path)
with (ROOT / config_path).open(encoding='utf-8-sig', newline='') as stream:
    configs = list(csv.DictReader(stream, delimiter='\t'))
if len({row['id'] for row in configs}) != len(configs):
    raise ValueError('Duplicate configuration ID')
current_configs = {row['id']: row for row in configs}
expected_configs = {}
for row in source['records']:
    if row['datasetId'] in dataset_ids:
        prior = expected_configs.setdefault(row['configId'], row['config'])
        if prior != row['config']:
            raise ValueError('Conflicting original configuration snapshot')
mismatches = [key for key, old in expected_configs.items() if current_configs.get(key) != old]
config_review = {
    'originalRegisteredConfigsChecked': len(expected_configs), 'mismatches': mismatches,
    'configurationRowsOutsideAuditedCorpus': [key for key in current_configs if key not in expected_configs],
    'source': source_path.relative_to(ROOT).as_posix(), 'sourceSha256': digest(source_path),
    'note': 'The shared configuration file includes concurrent intake. Every original registered configuration row is compared with its retained full scientific configuration.',
}
report = {
    'schemaVersion': 1, 'scope': 'Scientific references from the immutable 145-dataset round-three baseline.',
    'filesChecked': len(rows), 'bytesChecked': sum(row['currentBytes'] for row in rows),
    'unexpectedScientificChanges': unexpected, 'originalConfigurationChanges': mismatches,
    'sharedConfigurationChangedSinceBaseline': hashlib.sha256((ROOT / config_path).read_bytes().replace(b'\r\n', b'\n')).hexdigest()
        != baseline['internalQc']['inputs'][config_path],
    'configurationReview': config_review,
    'dependencies': [{'path': path.relative_to(ROOT).as_posix(), 'sha256': digest(path)} for path in
                     [FOLDER / 'scientific-files.before.json', FOLDER / 'baseline.json', source_path, Path(__file__)]],
    'files': rows,
}
if unexpected or mismatches:
    raise ValueError(f'Scientific changes found: {unexpected}; original config changes: {mismatches}')
for name, value in [('scientific-files.after.json', report), ('CONCURRENT_CONFIG_REVIEW.json', config_review)]:
    (FOLDER / name).write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: report[key] for key in ['filesChecked', 'bytesChecked', 'unexpectedScientificChanges', 'originalConfigurationChanges']}))
