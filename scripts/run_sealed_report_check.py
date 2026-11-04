"""Run the sealed September 11 report checks against the exact bytes they pin.

The first and second September 11 reports compare current evidence with fixed
159-dataset baselines, and the scientific preservation check hashes the 2,332
files captured for them. Independent reviews pin all three producers, so they
stay byte-identical. Later work changed three kinds of pinned input without
changing anything those reports describe:

- the HFD intake added two datasets to each shared ledger;
- the snapshot recorded CRLF copies of files whose committed bytes are LF;
- the HFD intake appended three rows to the configuration table;
- the R 4.6.0 regeneration replaced pinned outputs and rewrote the ledgers
  derived from them (data/quality/regeneration-r460-2026-09-25).

A read of such an input receives its pinned bytes only after this runner proves
that the difference is exactly one of these. Every other read, and every check
the producer makes, stays current.
"""
from collections import Counter
from contextlib import contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
from unittest.mock import patch

from historical_evidence import read_sealed_input, read_superseded, superseded_ledger, supersession_names

ROOT = Path(__file__).resolve().parents[1]
FIRST = 'data/quality/continuation-2026-09-11'
SCIENCE = f'{FIRST}/scientific-files.before.json'
CONFIG = 'geo_replication/config/datasets.tsv'
# Producer path -> (SHA-256, which pinned inputs it reads).
PRODUCERS = {
    f'{FIRST}/verify_scientific_files.py':
        ('d2699d214f4aa717899525c2e79efefe057aa727179af85ec90fa374070f0a64', 'science'),
    f'{FIRST}/build_report.py':
        ('0f751222a1c714cebb82df49d6eaed167987f5406b780dc3f8497b30923a05f8', 'ledgers'),
    'data/quality/continuation-round2-2026-09-11/build_report.py':
        ('e3c6ece48e6abf8dcdd896713ac15339311d12a328ef92df85e3d96aa5450930', 'ledgers'),
}
# The ledger states both reports record as their dependencies.
LEDGERS = {
    'data/quality/assessments.generated.json': '8f31a32d24d5d6a4ceef87a7f48cc502c1111fc613c63e05de376e51afd64441',
    'data/internal-qc/assessments.generated.json': 'e221814d052e61ab7797e5d8390c169cf9b34707751371ca2ab1f2b926d071e5',
    'data/author-validation/validation-records.generated.json': '448c66332d823df52e267f5ae2e52fd65cc7c920b4fdc3419d9cfd10de486ba3',
    'data/author-validation/additional-comparison-specs.json': '1e09348ffd1e0976d259c228b7927779f8865f6e105b5f7fee39a812e523c6e9',
}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def key(path) -> str:
    # Not Path.resolve(): it calls stat(), which the projection patches.
    return os.path.normcase(os.path.abspath(path))


def sealed_ledger(root: Path, path: str, expected: str) -> tuple[bytes, str]:
    """The pinned ledger bytes, once the current ledger is shown to keep every sealed record."""
    current = (root / path).read_bytes()
    try:
        return _sealed_ledger(root, path, expected, current)
    except AssertionError as error:
        if not supersession_names(root, path):
            raise
        try:
            # The R 4.6.0 regeneration rewrote this ledger: resolve the pin against
            # the archived pre-regeneration ledger, once the rewrite is proven in scope.
            before = superseded_ledger(root, path, current=current)
            body, reason = _sealed_ledger(root, path, expected, before)
        except AssertionError as fallback:
            raise AssertionError(f'{error}; R 4.6.0 supersession: {fallback}') from fallback
        return body, f'{reason} before the R 4.6.0 regeneration'


def _sealed_ledger(root: Path, path: str, expected: str, current: bytes) -> tuple[bytes, str]:
    if sha(current) == expected:
        return current, 'current'
    document = json.loads(current)
    if isinstance(document, dict) and isinstance(document.get('records'), list):
        # Restricted to the 159 baseline datasets, the current ledger may be the
        # pinned one exactly: every sealed record, and nothing else, unchanged.
        baseline = json.loads((root / f'{FIRST}/baseline.json').read_bytes())
        sealed = set(baseline['originalDatasetIds'] + baseline['intakeDatasetIds'])
        projected = {**document, 'records': [row for row in document['records'] if row['datasetId'] in sealed]}
        body = (json.dumps(projected, indent=2, ensure_ascii=False) + '\n').encode('utf8')
        if sha(body) == expected:
            return body, 'current restricted to the sealed datasets'
    return read_sealed_input(root, path, expected, current=current), 'archived'


def sealed_science(root: Path) -> tuple[dict[str, bytes], Counter]:
    """Pinned bytes for each captured file whose only difference is a proven one."""
    views, reasons = {}, Counter()
    for pin in json.loads((root / SCIENCE).read_bytes())['files']:
        path = root / pin['path']
        superseded = supersession_names(root, pin['path'])
        try:
            if path.stat().st_size == pin['bytes'] and not superseded:
                continue  # Newline and row changes alter the size; the producer hashes the rest.
        except FileNotFoundError:
            continue  # The producer reports it.
        if pin['path'] == CONFIG:
            views[key(path)] = read_sealed_input(root, CONFIG, pin['sha256'])
            reasons['configuration with only reviewed rows appended'] += 1
            continue
        current = path.read_bytes()
        rendered = current.replace(b'\n', b'\r\n')
        if b'\r' not in current and sha(rendered) == pin['sha256']:
            views[key(path)] = rendered
            reasons['pinned as the CRLF rendering of the current LF bytes'] += 1
        elif superseded and sha(current) != pin['sha256']:
            # An output: its verified pre-swap blob. A ledger the regeneration rewrote (such as a
            # live intake audit): its archived bytes, once the rewrite is proven in scope.
            views[key(path)] = read_sealed_input(root, pin['path'], pin['sha256'], current=current)
            reasons['superseded by the R 4.6.0 regeneration'] += 1
    return views, reasons


@contextmanager
def project(views: dict[str, bytes]):
    """Serve `views` to binary reads of those exact paths; reject edits made meanwhile."""
    actual_read, actual_open, actual_stat = Path.read_bytes, Path.open, Path.stat
    before = {name: os.stat(name) for name in views}

    def view(path):
        name = key(path)
        if name not in views:
            return None
        now = os.stat(name)
        assert (now.st_size, now.st_mtime_ns) == (before[name].st_size, before[name].st_mtime_ns), \
            f'Pinned input changed during historical check: {path}'
        return views[name]

    def read_bytes(path):
        data = view(path)
        return actual_read(path) if data is None else data

    def open_(path, mode='r', *args, **kwargs):
        data = view(path) if mode == 'rb' else None
        return actual_open(path, mode, *args, **kwargs) if data is None else io.BytesIO(data)

    def stat(path, *args, **kwargs):
        result = actual_stat(path, *args, **kwargs)
        data = views.get(key(path))
        if data is None:
            return result
        fields = list(result)
        fields[6] = len(data)  # st_size
        return os.stat_result(fields)

    with patch.object(Path, 'read_bytes', read_bytes), patch.object(Path, 'open', open_), \
            patch.object(Path, 'stat', stat):
        yield


def through_runner(actual_run):
    """Route the round-two report's fresh checks of pinned producers back through this runner."""
    def run(args, *rest, **kwargs):
        if (isinstance(args, list) and len(args) == 5 and args[:3] == [sys.executable, '-X', 'utf8']
                and args[4] == '--check'):
            relative = Path(os.path.relpath(args[3], ROOT)).as_posix()
            if relative in PRODUCERS:
                args = [sys.executable, '-X', 'utf8', str(Path(__file__).resolve()), relative, '--check']
        return actual_run(args, *rest, **kwargs)
    return run


def main(args=None):
    args = sys.argv[1:] if args is None else args
    assert len(args) == 2 and args[1] == '--check', 'Only a sealed producer with --check is allowed'
    relative = args[0]
    assert relative in PRODUCERS, 'Producer is outside the sealed report scope'
    expected, inputs = PRODUCERS[relative]
    producer = ROOT / relative
    assert sha(producer.read_bytes()) == expected, 'Historical producer changed'
    if inputs == 'science':
        views, reasons = sealed_science(ROOT)
    else:
        views, reasons = {}, Counter()
        for path, pin in LEDGERS.items():
            views[key(ROOT / path)], reason = sealed_ledger(ROOT, path, pin)
            reasons[f'ledger: {reason}'] += 1
    summary = '; '.join(f'{count:,} {reason}' for reason, count in sorted(reasons.items())) or 'none'
    print(f'[sealed-report] {relative}: pinned inputs served: {summary}', file=sys.stderr)
    previous_argv, previous_path = sys.argv, sys.path[:]
    try:
        sys.argv = [str(producer), '--check']
        sys.path.insert(0, str(producer.parent))
        with project(views), patch.object(subprocess, 'run', through_runner(subprocess.run)):
            runpy.run_path(str(producer), run_name='__main__')
    finally:
        sys.argv = previous_argv
        sys.path[:] = previous_path


if __name__ == '__main__':
    main()
