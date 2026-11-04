"""Hash every original scientific reference and compare every original analysis configuration."""
import csv
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'data/quality/remaining-2026-09-05'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


before_path = FOLDER / 'scientific-files.before.json'
before = read(before_path)
baseline = read(FOLDER / 'baseline.json')
ids = set(baseline['originalDatasetIds'])
assert len(ids) == 145
config_path = 'geo_replication/config/datasets.tsv'
files = []
for old in before['files']:
    path = (ROOT / old['path']).resolve()
    assert path.is_relative_to(ROOT), 'Scientific reference escapes workspace'
    current = digest(path)
    files.append({**old, 'currentBytes': path.stat().st_size, 'currentSha256': current,
                  'unchanged': current == old['sha256'] and path.stat().st_size == old['bytes']})
changed = [row['path'] for row in files if not row['unchanged'] and row['path'] != config_path]
assert not changed, f'Original scientific file changed: {changed}'
normalization_path = ROOT / 'data/internal-qc/advancement-2026-09-05/normalization-evidence.json'
normalization = read(normalization_path)
with (ROOT / config_path).open(encoding='utf-8-sig', newline='') as stream:
    configs = list(csv.DictReader(stream, delimiter='\t'))
assert len({row['id'] for row in configs}) == len(configs), 'Duplicate current config ID'
current_configs = {row['id']: row for row in configs}
original_configs = {}
for row in normalization['records']:
    if row['datasetId'] in ids:
        old = original_configs.setdefault(row['configId'], row['config'])
        assert old == row['config'], 'Conflicting original configuration'
assert len(original_configs) == 142
mismatches = [key for key, old in original_configs.items() if current_configs.get(key) != old]
assert not mismatches, f'Original full configuration changed: {mismatches}'
result = {'schemaVersion': 1, 'datasets': 145, 'filesChecked': len(files),
          'bytesChecked': sum(row['currentBytes'] for row in files),
          'unexpectedScientificChanges': changed, 'originalConfigurationChanges': mismatches,
          'originalConfigurationsChecked': len(original_configs),
          'currentConfigurations': len(configs),
          'configurationRowsOutsideAudit': [row['id'] for row in configs if row['id'] not in original_configs],
          'files': files,
          'dependencies': [{'path': path.relative_to(ROOT).as_posix(), 'sha256': digest(path)}
                           for path in [before_path, FOLDER / 'baseline.json', normalization_path, Path(__file__)]]}
text = json.dumps(result, indent=2) + '\n'
output = FOLDER / 'scientific-files.after.json'
if '--check' in sys.argv:
    assert output.read_text(encoding='utf-8') == text, 'Stale scientific preservation report'
else:
    output.write_text(text, encoding='utf-8')
print(json.dumps({key: result[key] for key in ['datasets', 'filesChecked', 'bytesChecked', 'unexpectedScientificChanges', 'originalConfigurationChanges']}))
