"""Read original sealed review bytes and reject changes to earlier dataset rows.

Pinned outputs replaced by the R 4.6.0 regeneration are read through
`read_superseded`; see data/quality/regeneration-r460-2026-09-25/README.md.
"""
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePath, PureWindowsPath
import subprocess

ARCHIVES = 'data/quality/hfd-intake-2026-09-12/preserved-inputs'
# produce.py writes every job path as str(ROOT / path). The September 11 author
# comparisons pinned the manifest it wrote in this checkout.
JOBS_MANIFEST = 'data/internal-qc/intake-numeric-2026-09-11/jobs.json'
SEALED_JOBS_ROOT = PureWindowsPath('D:/Monkey Brain/MONKEYBRAIN')
JOB_PATH_FIELDS = ('source', 'sourceSheet', 'geneMap', 'input', 'expression', 'sheet', 'normalization', 'de', 'se')
ADDITIVE_INTAKE = 'data/intake/oxt-avp-2026-10-19/studies.json'
# The new intake is additive only. Its manifest cannot redefine an old dataset
# or authorize an unrelated accession merely by declaring another identifier.
ADDITIVE_IDENTITIES = {
    'GSE30733': ('rat_son_lactation_gse30733', 'geo_replication/datasets/GSE30733_rnor_son_lactation'),
    'GSE65663': ('rat_son_salt_gse65663', 'geo_replication/datasets/GSE65663_rnor_son_salt'),
}
ADDITIVE_CONTAINERS = {
    'data/internal-qc/assessments.generated.json': 'records',
    'data/quality/assessments.generated.json': 'records',
    'data/author-validation/validation-records.generated.json': 'records',
    'data/author-validation/direct-comparisons.generated.json': 'comparisons',
    'data/author-validation/mechanical-audit.generated.json': 'datasets',
    'data/author-validation/source-inventory.generated.json': 'datasets',
    'data/author-validation/fgsea-migration.generated.json': 'datasets',
}


def _intake_child(path, directory):
    assert isinstance(path, str) and path.startswith(directory + '/') and '\\' not in path \
        and all(part not in ('', '.', '..') for part in path.split('/')), f'Intake path outside its source dataset: {path}'


def read_additive_intake(root: Path) -> tuple[set, dict]:
    """Return only the two source-bound OXT/AVP identities and their declared analysis IDs.

    Analysis IDs follow the intake producers: the track's analysisId for the
    first contrast, then <analysisId>_<contrast.id>. No scientific pass is
    inferred; these declarations authorize additions, never changes to history.
    """
    target = Path(root) / ADDITIVE_INTAKE
    if not target.is_file():
        return set(), {}
    studies = json.loads(target.read_bytes())
    assert isinstance(studies, list) and 0 < len(studies) <= len(ADDITIVE_IDENTITIES), 'Invalid additive intake studies'
    dataset_ids, configs = set(), {}
    for study in studies:
        assert isinstance(study, dict), 'Invalid additive intake study'
        accession = study.get('accession')
        assert isinstance(accession, str) and accession in ADDITIVE_IDENTITIES, f'Unreviewed additive intake accession: {accession}'
        identity, directory = ADDITIVE_IDENTITIES[accession]
        assert study.get('id') == identity and study.get('dir') == directory \
            and study.get('organism') == 'Rattus norvegicus', f'Additive intake source identity changed: {accession}'
        assert identity not in dataset_ids, f'Duplicate additive intake dataset: {identity}'
        dataset_ids.add(identity)
        tracks, contrasts = study.get('tracks'), study.get('contrasts')
        assert isinstance(tracks, list) and tracks and isinstance(contrasts, list) and contrasts, 'Incomplete additive intake bindings'
        contrast_ids = [contrast.get('id') for contrast in contrasts if isinstance(contrast, dict)]
        assert len(contrast_ids) == len(contrasts) \
            and all(isinstance(name, str) and name and all(c.isascii() and (c.isalnum() or c == '_') for c in name)
                    for name in contrast_ids) and len(set(contrast_ids)) == len(contrast_ids), 'Invalid additive intake contrast IDs'
        track_ids = set()
        for track in tracks:
            assert isinstance(track, dict) and isinstance(track.get('id'), str) and track['id'] \
                and track['id'] not in track_ids, 'Invalid or duplicate additive intake track'
            track_ids.add(track['id'])
            analysis = track.get('analysisId')
            assert isinstance(analysis, str) and (analysis == accession or analysis.startswith(accession + '_')) \
                and all(c.isascii() and (c.isalnum() or c == '_') for c in analysis), 'Analysis ID belongs to another source accession'
            for field in ('matrix', 'samplesheet'):
                _intake_child(track.get(field), directory)
            for index, contrast in enumerate(contrast_ids):
                config_id = analysis if index == 0 else f'{analysis}_{contrast}'
                assert config_id not in configs, f'Duplicate additive intake analysis: {config_id}'
                configs[config_id] = directory.removeprefix('geo_replication/')
    return dataset_ids, configs


def relocate_jobs_manifest(body: bytes, source: PurePath, target: PurePath) -> bytes:
    """Move every job path from one checkout root to another, in produce.py's canonical bytes."""
    manifest = json.loads(body)
    assert list(manifest) == ['jobs'], 'Job manifest schema changed'
    for job in manifest['jobs']:
        for field in JOB_PATH_FIELDS:
            path = type(source)(job[field])
            assert path.is_absolute() and path.is_relative_to(source), f'Job path is outside the checkout: {job[field]}'
            job[field] = str(target.joinpath(*path.relative_to(source).parts))
    return (json.dumps(manifest, sort_keys=True, indent=2, allow_nan=False) + '\n').encode('utf8')


def read_sealed_input(root: Path, path: str, expected_sha: str, current: bytes | None = None) -> bytes:
    current = (root / path).read_bytes() if current is None else current
    if hashlib.sha256(current).hexdigest() == expected_sha:
        return current
    try:
        return _read_archived_input(root, path, expected_sha, current)
    except AssertionError as error:
        if not supersession_names(root, path):
            raise
        try:
            return _read_superseded_pin(root, path, expected_sha, current)
        except AssertionError as fallback:
            raise AssertionError(f'{error}; R 4.6.0 supersession: {fallback}') from fallback


def _read_archived_input(root: Path, path: str, expected_sha: str, current: bytes) -> bytes:
    if path == JOBS_MANIFEST:
        # Only the checkout prefix of the job paths may differ from the pinned manifest.
        sealed = relocate_jobs_manifest(current, root, SEALED_JOBS_ROOT)
        assert hashlib.sha256(sealed).hexdigest() == expected_sha, f'Historical job manifest changed: {path}'
        return sealed
    manifest = json.loads((root / ARCHIVES / 'manifest.json').read_text(encoding='utf-8'))
    refs = [row for row in manifest['records'] if row['path'] == path and row['sha256'] == expected_sha]
    assert len(refs) == 1, f'No sealed historical input for {path}'
    ref = refs[0]
    assert ref['archivePath'] == f'{ARCHIVES}/{expected_sha}.gz'
    original = gzip.decompress((root / ref['archivePath']).read_bytes())
    assert hashlib.sha256(original).hexdigest() == expected_sha and len(original) == ref['bytes'], path
    if path == 'geo_replication/config/datasets.tsv':
        def table(body):
            header, *lines = body.decode('utf-8').rstrip().splitlines()
            width = len(header.split('\t'))
            assert all(len(line.split('\t')) == width for line in lines), 'Malformed configuration row'
            rows = {line.split('\t')[0]: line for line in lines}
            assert len(rows) == len(lines), 'Duplicate configuration ID'
            return header, rows
        old_header, old_rows = table(original)
        new_header, new_rows = table(current)
        assert new_header == old_header, 'Configuration schema changed'
        for identity, row in old_rows.items():
            assert new_rows.get(identity) == row, f'Historical configuration changed: {identity}'
        intake = json.loads((root / 'data/intake/hfd-2026-09-12/studies.json').read_text(encoding='utf-8'))
        allowed = {track['analysisId'] for study in intake for track in study['tracks']}
        _, additive_configs = read_additive_intake(root)
        assert new_rows.keys() - old_rows.keys() <= allowed | additive_configs.keys(), 'Unreviewed added configuration'
        for identity in (new_rows.keys() - old_rows.keys()) & additive_configs.keys():
            row = dict(zip(new_header.split('\t'), new_rows[identity].split('\t')))
            directory = additive_configs[identity]
            assert row.get('dir') == directory and row.get('organism') == 'Rattus norvegicus' \
                and row.get('input_kind') == 'matrix', f'Added configuration source binding changed: {identity}'
            for field in ('input_path', 'samplesheet'):
                _intake_child(row.get(field), directory)
        return original
    before, after = json.loads(original), json.loads(current)
    # The same rules as readSealedHistoricalInput in lib/historicalEvidence.mts.
    container = 'records' if 'records' in before else 'comparisons'
    assert container in before and container in after, f'Preserved non-registry evidence changed: {path}'
    assert before.keys() == after.keys(), f'Historical document schema changed: {path}'
    # Only registry containers and their derived inventory fields may grow.
    mutable = {
        'data/internal-qc/assessments.generated.json': {'records', 'summary', 'inputs'},
        'data/author-validation/validation-records.generated.json': {'records', 'generatedAt', 'counts', 'scope'},
        'data/author-validation/direct-comparisons.generated.json': {'comparisons', 'generatedAt'},
    }.get(path, {container})
    for key in before:
        if key not in mutable:
            assert before[key] == after[key], f'Historical document semantics changed: {path}/{key}'
    if path == 'data/author-validation/validation-records.generated.json':
        counted = {'registryDatasets', 'inScopeDatasets'}

        def static(scope):
            return {key: value for key, value in scope.items() if key not in counted}

        assert static(after['scope']) == static(before['scope']), f'Historical document semantics changed: {path}/scope'
        for key in counted:
            value = after['scope'][key]
            assert type(value) is int and value >= before['scope'][key], f'Historical registry scope shrank: {path}/{key}'

    def keyed(records):
        if isinstance(records, dict):
            return records
        rows = {row['datasetId']: row for row in records}
        assert len(rows) == len(records), f'Duplicate dataset records in {path}'
        return rows

    for identity, row in keyed(before[container]).items():
        assert keyed(after[container]).get(identity) == row, f'Historical dataset evidence changed: {path}/{identity}'
    return original


# R 4.6.0 regeneration. The manifest names every pinned output the regeneration
# replaced and archives the ledgers it rewrote; its own SHA-256 is pinned here.
SUPERSESSION_DIR = 'data/quality/regeneration-r460-2026-09-25'
SUPERSESSION_MANIFEST = f'{SUPERSESSION_DIR}/supersession.json'
# Written by `npx tsx scripts/regen-r460/build_supersession_manifest.mts --finalize`.
# None until the regenerated outputs are recorded: nothing is superseded.
SUPERSESSION_SHA = '48b10701d44588a28c16a70645f727fb554e379f6583b4df74bfd1274a4ff93d'

# A bounded second successor preserves the exact September regeneration bytes.
# The original supersession manifest remains immutable; finalized only after
# canonical serialization and a separate-process model replay both pass.
GSE135007_SERIALIZATION_SUCCESSOR = 'data/quality/gse135007-serialization-2026-10-23/successor.json'
GSE135007_SERIALIZATION_SUCCESSOR_SHA = '473ac2a97966c6fa1b5a3ebe666ea319d14f832fa9cb391b1e246498a8c0aa00'
FULL_HISTORY = ('Superseded bytes are read from the pre-regeneration commit, which this clone cannot provide ({}). '
                'Fetch full history first: git fetch --unshallow --tags origin '
                '(a partial clone must be re-cloned without --filter).')
# Ledger keys that state a schema or policy. A regenerated ledger must keep them.
PROTECTED_LEDGER_KEYS = {
    'schemaVersion', 'policyVersion', 'policy', 'scope', 'coverage', 'purpose', 'method', 'script', 'version',
    'auditVersion', 'fingerprintConventions', 'fingerprintConvention', 'fingerprintScheme', 'thresholdDefinitions',
    'legacyInternalQc', 'datasetId', 'contrastId', 'baselineCommit', 'baselineDescription',
}
# Inventory keys derived from the records; they follow the records they count.
DERIVED_LEDGER_KEYS = {'generatedAt', 'summary', 'counts', 'totals'}
# Successor evidence. Some ledgers are rebuilt from successor evidence written by new
# producers (the sealed producers stay byte-identical), so their path -> fingerprint
# inventory retires the replaced evidence and names its successors. The declaration
# lists exactly which inventory entries were retired, which were added, and the new
# fingerprint of every other changed entry outside the supersession manifest; its
# SHA-256 is pinned here. Written by
# `npx tsx scripts/regen-r460/build_successor_inventory.mts --finalize`.
SUCCESSOR_INVENTORY = f'{SUPERSESSION_DIR}/successor-inventory.json'
SUCCESSOR_INVENTORY_SHA = '16579bd001fcd6b545925fa08c8faec3593c016507ae39f828862e56ce9dae60'
# The supersession manifest the declaration belongs to; any other manifest (a test fixture) has none.
SUCCESSOR_INVENTORY_MANIFEST_SHA = '48b10701d44588a28c16a70645f727fb554e379f6583b4df74bfd1274a4ff93d'
_PINNED = object()
_CACHE: dict = {}


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def crlf(data: bytes) -> bytes:
    return data.replace(b'\n', b'\r\n')


def is_recorded_regeneration(current: bytes, row: dict) -> bool:
    """The recorded regenerated bytes, or a checkout's CRLF rendering of recorded LF bytes (text=auto on Windows)."""
    if len(current) == row['newBytes'] and _sha(current) == row['newSha256']:
        return True
    if b'\r\n' not in current:
        return False
    lf = current.replace(b'\r\n', b'\n')
    return b'\r' not in lf and len(lf) == row['newBytes'] and _sha(lf) == row['newSha256']


def _manifest_path(root: Path) -> Path:
    return Path(root) / SUPERSESSION_MANIFEST


def superseded_paths(root: Path, manifest_sha=_PINNED) -> frozenset:
    """Paths a pinned manifest names. Routing only: every read verifies the manifest and the bytes."""
    expected = SUPERSESSION_SHA if manifest_sha is _PINNED else manifest_sha
    target = _manifest_path(root)
    if not expected or not target.is_file():
        return frozenset()
    stat = target.stat()
    cache_key = ('paths', str(target), stat.st_size, stat.st_mtime_ns)
    if cache_key not in _CACHE:
        document = json.loads(target.read_bytes())
        _CACHE[cache_key] = frozenset(row['path'] for row in document.get('records', []) + document.get('ledgers', []))
    return _CACHE[cache_key]


def supersession_names(root: Path, path: str, manifest_sha=_PINNED) -> bool:
    return path in superseded_paths(root, manifest_sha)


def check_successor_inventory(where: str, old: dict, new: dict, paths: set, declared: dict):
    """A path -> fingerprint map that retired evidence for declared successors."""
    retired, added, updated = set(declared['retired']), set(declared['added']), declared['updated']
    assert retired <= old.keys() and not added & old.keys(), f'Successor inventory does not match the archived ledger: {where}'
    assert new.keys() == (old.keys() - retired) | added, f'Regenerated ledger inventory differs from its successor declaration: {where}'
    for name in old.keys() & new.keys():
        if old[name] != new[name] and name not in paths:
            assert updated.get(name) == new[name], f'Regenerated ledger changed outside the regeneration and its successor declaration: {where}: {name}'


def check_ledger_transition(path: str, before, after, dataset_ids: set, paths: set, successors: dict | None = None,
                            additive_ids: set | None = None):
    """Reject any ledger difference other than regenerated datasets' records and their derived inventory.

    `successors` maps an inventory key of this ledger to its pinned successor declaration.
    `additive_ids` is read_additive_intake(root)'s bounded source-identity set.
    """
    assert isinstance(before, dict) and isinstance(after, dict), f'Ledger is not a JSON object: {path}'
    assert before.keys() == after.keys(), f'Regenerated ledger schema changed: {path}'
    additive_ids = set() if additive_ids is None else additive_ids
    assert additive_ids <= {identity for identity, _ in ADDITIVE_IDENTITIES.values()}, 'Unreviewed additive ledger identities'
    container = ADDITIVE_CONTAINERS.get(path)
    added_count = 0
    if additive_ids and container and isinstance(before.get(container), list) and isinstance(after.get(container), list):
        old_rows, new_rows = before[container], after[container]
        old_ids = [row.get('datasetId') for row in old_rows if isinstance(row, dict)]
        new_ids = [row.get('datasetId') for row in new_rows if isinstance(row, dict)]
        assert len(old_ids) == len(old_rows) and len(new_ids) == len(new_rows) \
            and all(isinstance(identity, str) and identity for identity in old_ids + new_ids), f'Invalid dataset identity: {path}/{container}'
        assert len(set(old_ids)) == len(old_ids) and len(set(new_ids)) == len(new_ids), f'Duplicate dataset records: {path}/{container}'
        additions = set(new_ids) - set(old_ids)
        assert additions <= additive_ids, f'Unreviewed added ledger dataset: {path}/{container}'
        assert [identity for identity in new_ids if identity not in additions] == old_ids, f'Historical ledger dataset removed or reordered: {path}/{container}'
        added_count = len(additions)
        after = {**after, container: [row for row in new_rows if row['datasetId'] not in additions]}
    if added_count:
        # Only the validation scope has corpus counts inside a protected field.
        # Its scientific unit and exclusions remain exact, and both counts grow
        # by precisely the number of declared, actually appended dataset rows.
        if path == 'data/author-validation/validation-records.generated.json':
            old_scope, new_scope = before.get('scope'), after.get('scope')
            assert isinstance(old_scope, dict) and isinstance(new_scope, dict) and old_scope.keys() == new_scope.keys(), 'Additive validation scope schema changed'
            for key in old_scope:
                expected = old_scope[key] + added_count if key in ('registryDatasets', 'inScopeDatasets') else old_scope[key]
                assert new_scope[key] == expected, f'Additive validation scope changed: {key}'
            after = {**after, 'scope': old_scope}
        if path == 'data/author-validation/mechanical-audit.generated.json':
            assert after.get('datasetCount') == before.get('datasetCount') + added_count, 'Additive mechanical dataset count changed'
            old_total = sum(len(row.get('contrasts', [])) for row in before[container])
            new_total = sum(len(row.get('contrasts', [])) for row in new_rows)
            assert after.get('contrastCount') == before.get('contrastCount') + new_total - old_total, 'Additive mechanical contrast count changed'
            after = {**after, 'datasetCount': before['datasetCount'], 'contrastCount': before['contrastCount']}
    single = before.get('datasetId') if isinstance(before.get('datasetId'), str) else None
    for key in before:
        old, new = before[key], after[key]
        if old == new:
            continue
        where = f'{path}/{key}'
        assert key not in PROTECTED_LEDGER_KEYS and not key.endswith('Policy'), \
            f'Regenerated ledger semantics changed: {where}'
        if key in DERIVED_LEDGER_KEYS:
            continue
        if single is not None:
            # A single-dataset document: every non-policy field belongs to that dataset.
            assert single in dataset_ids, f'Regenerated ledger belongs to a dataset outside the regeneration: {where}'
            continue
        if isinstance(old, dict) and isinstance(new, dict) and old and all('/' in name for name in old):
            if successors and key in successors:
                check_successor_inventory(where, old, new, paths, successors[key])
                continue
            # A path -> fingerprint map: only regenerated outputs and archived ledgers may change.
            assert old.keys() == new.keys(), f'Regenerated ledger inventory changed: {where}'
            changed = {name for name in old if old[name] != new[name]}
            assert changed <= paths, \
                f'Regenerated ledger changed outside the regeneration: {where}: {sorted(changed - paths)[:3]}'
            continue
        if isinstance(old, list) and isinstance(new, list):
            assert len(old) == len(new), f'Regenerated ledger record count changed: {where}'
            pairs = list(zip(old, new))
        elif isinstance(old, dict) and isinstance(new, dict):
            assert old.keys() == new.keys(), f'Regenerated ledger record set changed: {where}'
            pairs = [({'datasetId': name, **old[name]} if isinstance(old[name], dict) else old[name],
                      {'datasetId': name, **new[name]} if isinstance(new[name], dict) else new[name]) for name in old]
        else:
            raise AssertionError(f'Regenerated ledger changed outside the regeneration: {where}')
        for a, b in pairs:
            if a == b:
                continue
            assert isinstance(a, dict) and isinstance(b, dict) and a.get('datasetId') == b.get('datasetId'), \
                f'Regenerated ledger record identity changed: {where}'
            assert a.get('datasetId') in dataset_ids, \
                f'Regenerated ledger changed a dataset outside the regeneration: {where}/{a.get("datasetId")}'


def load_successor_inventory(root: Path, manifest_sha: str, declaration_sha=_PINNED) -> dict:
    """The pinned successor declaration, by ledger path; empty until one is finalized."""
    expected = SUCCESSOR_INVENTORY_SHA if declaration_sha is _PINNED else declaration_sha
    if not expected or (declaration_sha is _PINNED and manifest_sha != SUCCESSOR_INVENTORY_MANIFEST_SHA):
        return {}
    body = (Path(root) / SUCCESSOR_INVENTORY).read_bytes()
    assert _sha(body) == expected, f'Successor inventory declaration changed: {SUCCESSOR_INVENTORY}'
    document = json.loads(body)
    assert document.get('schemaVersion') == 1 and document.get('supersessionSha256') == manifest_sha,         'Successor inventory declaration belongs to another supersession manifest'
    return document['ledgers']


def read_gse135007_serialization_predecessor(root: Path, path: str, current: bytes,
                                           prior_sha: str, manifest_sha: str) -> bytes | None:
    """Verify one explicitly pinned GSE135007 successor and return its prior bytes.

    Neither a free-form lineage file nor a passing status alone authorizes a
    replacement. Producer/verification files, unchanged numerical tolerances,
    exact roundtrip, current output and archived predecessor are all checked.
    """
    if not GSE135007_SERIALIZATION_SUCCESSOR_SHA:
        return None
    def in_scope(name):
        return name.startswith('geo_replication/datasets/GSE135007_discovery_20260905/') \
            or name == 'public/datasets/gse135007/track_hypothalamus.js'
    if not in_scope(path):
        return None
    root = Path(root)
    body = (root / GSE135007_SERIALIZATION_SUCCESSOR).read_bytes()
    assert _sha(body) == GSE135007_SERIALIZATION_SUCCESSOR_SHA, 'GSE135007 successor manifest changed'
    doc = json.loads(body)
    assert doc.get('schemaVersion') == 1 and doc.get('state') == 'finalized' \
        and doc.get('analysisId') == 'GSE135007' and doc.get('datasetId') == 'gse135007', 'Invalid GSE135007 successor identity'
    parent = doc.get('predecessorManifest', {})
    assert parent.get('path') == SUPERSESSION_MANIFEST and parent.get('sha256') == manifest_sha \
        and _sha((root / SUPERSESSION_MANIFEST).read_bytes()) == manifest_sha, 'GSE135007 successor predecessor differs'
    producer = doc.get('producer', {})
    assert producer.get('path') == 'scripts/regen-r460/run_gse135007_serialized_r460.R', 'Invalid GSE135007 successor producer'
    assert _sha((root / producer['path']).read_bytes()) == producer.get('sha256'), 'GSE135007 successor producer changed'
    verification = doc.get('verification', {})
    target = 'data/quality/gse135007-serialization-2026-10-23/verification.json'
    assert verification.get('path') == target, 'Invalid GSE135007 verification path'
    proof = (root / target).read_bytes()
    assert _sha(proof) == verification.get('sha256'), 'GSE135007 verification changed'
    proof = json.loads(proof)
    replay = proof.get('separateProcessReplay', {})
    roundtrip = proof.get('roundtrip', {})
    mapping = proof.get('sourceMapping', {})
    assert proof.get('schemaVersion') == 1 and proof.get('status') == 'PASS' \
        and proof.get('analysisId') == 'GSE135007' and proof.get('canonicalSchema') == 'hypo-counts-tsv17-v1', 'GSE135007 verification did not pass'
    assert roundtrip.get('exactValues') is True and roundtrip.get('maxAbsoluteDelta') == 0 \
        and roundtrip.get('nValues') == 501080, 'GSE135007 canonical roundtrip was not exact'
    assert mapping.get('status') == 'PASS' and mapping.get('authority') == 'org.Mm.eg.db' \
        and mapping.get('version') == '3.23.0' and mapping.get('retainedMapIdentical') is True, 'GSE135007 annotation mapping was not verified'
    assert replay.get('status') == 'PASS' and replay.get('absoluteTolerance') == 1e-6 \
        and replay.get('relativeTolerance') == 1e-6 and replay.get('matchedRows') == 15568 \
        and replay.get('modelMismatches') == 0 and replay.get('normalizationMismatches') == 0, 'GSE135007 separate-process model replay did not pass'
    records = doc.get('records', [])
    assert records and len({r['path'] for r in records}) == len(records), 'Duplicate or empty GSE135007 successor records'
    assert all(in_scope(r['path']) and '\\' not in r['path']
               and all(p not in ('', '.', '..') for p in r['path'].split('/')) for r in records), 'GSE135007 successor exceeds declared scope'
    canonical = 'geo_replication/datasets/GSE135007_discovery_20260905/processed/GSE135007_counts.tsv.gz'
    canonical_record = next((r for r in records if r['path'] == canonical), None)
    assert canonical_record and proof.get('canonicalInput') == canonical \
        and proof.get('canonicalInputSha256') == canonical_record.get('newSha256') \
        and is_recorded_regeneration((root / canonical).read_bytes(), canonical_record), 'GSE135007 current canonical input differs from replay proof'
    record = next((r for r in records if r['path'] == path), None)
    if record is None:
        return None
    assert record['priorSha256'] == prior_sha, f'GSE135007 predecessor identity changed: {path}'
    assert is_recorded_regeneration(current, record), f'Current bytes are not the GSE135007 successor: {path}'
    archive = f'data/quality/gse135007-serialization-2026-10-23/preserved/{prior_sha}.gz'
    assert record.get('archivePath') == archive, f'GSE135007 predecessor archive path changed: {path}'
    prior = gzip.decompress((root / archive).read_bytes())
    assert _sha(prior) == prior_sha and len(prior) == record['priorBytes'], f'GSE135007 archived predecessor changed: {path}'
    return prior


class Supersession:
    """A verified supersession manifest and the pre-regeneration git objects it names."""

    def __init__(self, root: Path, manifest_sha: str | None):
        assert manifest_sha, 'The R 4.6.0 supersession manifest is not finalized; SUPERSESSION_SHA is unset'
        self.root = Path(root)
        self.manifest_sha = manifest_sha
        body = _manifest_path(self.root).read_bytes()
        assert _sha(body) == manifest_sha, f'Supersession manifest changed: {SUPERSESSION_MANIFEST}'
        manifest = json.loads(body)
        assert manifest.get('schemaVersion') == 1 and manifest.get('state') == 'finalized', \
            'Supersession manifest is not finalized'
        self.commit, self.tag = manifest['preSwapCommit'], manifest['tag']
        self.records = {row['path']: row for row in manifest['records']}
        self.ledgers = {row['path']: row for row in manifest['ledgers']}
        assert len(self.records) == len(manifest['records']) and len(self.ledgers) == len(manifest['ledgers']), \
            'Duplicate supersession path'
        self.dataset_ids = {row['datasetId'] for row in manifest['records'] if row.get('datasetId')}
        self.paths = set(self.records) | set(self.ledgers)
        self.successors = load_successor_inventory(self.root, manifest_sha)
        self._batch = None
        self._history_checked = False

    def _git(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(['git', '-C', str(self.root), *args], capture_output=True,
                              env={**os.environ, 'GIT_NO_LAZY_FETCH': '1'})

    def _check_history(self):
        if self._history_checked:
            return
        shallow = self._git('rev-parse', '--is-shallow-repository')
        assert shallow.returncode == 0, FULL_HISTORY.format('not a git checkout')
        assert shallow.stdout.strip() != b'true', FULL_HISTORY.format('shallow clone')
        assert self._git('config', '--get', 'extensions.partialClone').returncode != 0, \
            FULL_HISTORY.format('partial clone')
        assert self._git('cat-file', '-e', f'{self.commit}^{{commit}}').returncode == 0, \
            FULL_HISTORY.format(f'commit {self.commit} is missing')
        tag = self._git('rev-parse', '-q', '--verify', f'refs/tags/{self.tag}^{{commit}}')
        if tag.returncode == 0:
            assert tag.stdout.decode().strip() == self.commit, f'Tag {self.tag} does not name {self.commit}'
        self._history_checked = True

    def _object(self, spec: str) -> tuple[str, bytes]:
        if self._batch is None:
            self._batch = subprocess.Popen(['git', '-C', str(self.root), 'cat-file', '--batch'],
                                           stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                           env={**os.environ, 'GIT_NO_LAZY_FETCH': '1'})
        self._batch.stdin.write(spec.encode('utf8') + b'\n')
        self._batch.stdin.flush()
        header = self._batch.stdout.readline().split()
        assert len(header) == 3 and header[1] == b'blob', FULL_HISTORY.format(f'{spec} is missing')
        data = self._batch.stdout.read(int(header[2]))
        self._batch.stdout.read(1)
        return header[0].decode(), data

    def close(self):
        if self._batch is not None:
            self._batch.stdin.close()
            self._batch.stdout.close()
            self._batch.wait()
            self._batch = None

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass

    def old_bytes(self, path: str) -> bytes:
        """The committed pre-regeneration bytes of a superseded output."""
        row = self.records[path]
        self._check_history()
        oid, data = self._object(f'{self.commit}:{path}')
        assert oid == row['oldGitBlob'], f'Superseded blob is not the recorded one: {path}'
        assert len(data) == row['oldBytes'] and _sha(data) == row['oldSha256'], f'Superseded bytes changed: {path}'
        return data

    def read(self, path: str, pin: str, current: bytes | None = None) -> bytes:
        row = self.records.get(path)
        assert row, f'Not superseded by the R 4.6.0 regeneration: {path}'
        assert row['newSha256'], f'The R 4.6.0 regeneration removed {path}'
        current = (self.root / path).read_bytes() if current is None else current
        if not is_recorded_regeneration(current, row):
            prior = read_gse135007_serialization_predecessor(self.root, path, current, row['newSha256'], self.manifest_sha)
            assert prior is not None, f'Current bytes are not the recorded R 4.6.0 regeneration: {path}'
            if pin == row['newSha256']:
                return prior
            if b'\r' not in prior and _sha(crlf(prior)) == pin:
                return crlf(prior)
        old = self.old_bytes(path)
        if pin == row['oldSha256']:
            return old
        if b'\r' not in old and _sha(crlf(old)) == pin:
            return crlf(old)
        raise AssertionError(f'Pin is not the superseded bytes of {path}')

    def served_pin(self, path: str) -> str:
        """The pin served to a producer that reads a superseded output without naming one."""
        row = self.records[path]
        return _sha(crlf(self.old_bytes(path))) if row.get('oldPinForm') == 'crlf' else row['oldSha256']

    def ledger(self, path: str, current: bytes | None = None) -> bytes:
        """The archived pre-regeneration ledger, once the current one differs only for regenerated datasets."""
        row = self.ledgers.get(path)
        assert row, f'Ledger is not archived for the R 4.6.0 regeneration: {path}'
        assert row['archivePath'] == f'{SUPERSESSION_DIR}/preserved-inputs/{row["sha256"]}.json.gz', path
        before = gzip.decompress((self.root / row['archivePath']).read_bytes())
        assert _sha(before) == row['sha256'] and len(before) == row['bytes'], f'Archived ledger changed: {path}'
        current = (self.root / path).read_bytes() if current is None else current
        check_ledger_transition(path, json.loads(before), json.loads(current), self.dataset_ids, self.paths,
                                self.successors.get(path), read_additive_intake(self.root)[0])
        return before


def supersession(root: Path, manifest_sha=_PINNED) -> Supersession:
    """The verified manifest for `root`, loaded once per manifest state."""
    expected = SUPERSESSION_SHA if manifest_sha is _PINNED else manifest_sha
    target = _manifest_path(root)
    stat = target.stat() if target.is_file() else None
    cache_key = (os.path.normcase(os.path.abspath(root)), expected, stat and (stat.st_size, stat.st_mtime_ns))
    if cache_key not in _CACHE:
        _CACHE[cache_key] = Supersession(Path(root), expected)
    return _CACHE[cache_key]


def close_supersessions():
    """Stop cached git readers, e.g. before a test removes its repository."""
    for value in _CACHE.values():
        if isinstance(value, Supersession):
            value.close()
    _CACHE.clear()


def read_superseded(root: Path, path: str, pin: str, manifest_sha=_PINNED, current: bytes | None = None) -> bytes:
    """The pinned pre-regeneration bytes of an output the R 4.6.0 regeneration replaced.

    Served only when the current bytes are the recorded regeneration, the pin is
    the recorded old bytes (exact or CRLF rendering), the pre-regeneration git
    blob hashes to them, and the manifest itself is the pinned one.
    """
    return supersession(root, manifest_sha).read(path, pin, current)


def superseded_ledger(root: Path, path: str, manifest_sha=_PINNED, current: bytes | None = None) -> bytes:
    """The pre-regeneration bytes of a ledger the regeneration rewrote, after the transition is verified."""
    return supersession(root, manifest_sha).ledger(path, current)


def _read_superseded_pin(root: Path, path: str, pin: str, current: bytes) -> bytes:
    state = supersession(root)
    if path in state.records:
        return state.read(path, pin, current)
    before = state.ledger(path, current)
    if _sha(before) == pin:
        return before
    if b'\r' not in before and _sha(crlf(before)) == pin:
        return crlf(before)
    # Older pins resolve against the pre-regeneration ledger exactly as they did before the regeneration.
    return _read_archived_input(root, path, pin, before)
