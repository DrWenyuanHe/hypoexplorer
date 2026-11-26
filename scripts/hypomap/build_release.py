"""Rebuild the pinned HypoMap atlas release from data/hypomap/provenance.json.

    python scripts/hypomap/build_release.py [--out data/hypomap/build]

Verifies every input (the CELLxGENE H5AD, the study card and the two MGI reports)
against its pinned size and SHA-256, runs export_atlas.py with the release's pinned
shard size and timestamp, packages the browser files and compares the archive and
manifest with the pins in provenance.json and hypomap-release.json. Exits non-zero
on any mismatch. Writes only under the output directory, which must not already
hold this tag. Runbook: data/hypomap/README.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

from export_atlas import build
from package_release import package

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'data' / 'hypomap'


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(16 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def verify(entry: dict, label: str, path: Path | None = None) -> Path:
    path = path or DATA / entry['file']
    if not path.is_file():
        raise SystemExit(f'{label}: {path} is missing; see data/hypomap/README.md for where it comes from')
    size = path.stat().st_size
    if size != entry['bytes']:
        raise SystemExit(f'{label}: {path.name} is {size:,} bytes, expected {entry["bytes"]:,}')
    actual = digest(path)
    if actual != entry['sha256']:
        raise SystemExit(f'{label}: {path.name} SHA-256 {actual} does not match the pin {entry["sha256"]}')
    print(f'verified {label}: {path.name}', flush=True)
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out', type=Path, default=DATA / 'build')
    parser.add_argument('--atlas', type=Path, help='An existing copy of the pinned H5AD (still verified against the pin)')
    parser.add_argument('--pin', action='store_true',
                        help='Cut a new release: after building, write its archive and manifest SHA-256 into '
                             'provenance.json and hypomap-release.json (set the new tag and generatedAt first)')
    args = parser.parse_args()
    pins_path, app_path = DATA / 'provenance.json', ROOT / 'hypomap-release.json'
    pins = json.loads(pins_path.read_text(encoding='utf-8'))
    release = pins['release']
    app_pin = json.loads(app_path.read_text(encoding='utf-8'))
    for key in ('tag', 'archive') if args.pin else ('tag', 'archive', 'archiveSha256', 'manifestSha256'):
        if app_pin[key] != release[key]:
            raise SystemExit(f'hypomap-release.json {key} differs from data/hypomap/provenance.json')

    atlas = verify(pins['atlas'], 'atlas', args.atlas)
    card = verify(pins['studyCard'], 'study card')
    mgi_paths = {verify(entry, f'MGI {entry["file"]}').parent for entry in pins['mgiReports']}
    if len(mgi_paths) != 1:
        raise SystemExit('The MGI reports must sit in one directory')

    target = args.out / release['tag']
    export_dir, pair_dir = target / 'export', target / 'comparison-index'
    build(atlas, export_dir, pair_dir, release['shardSize'], card, mgi_paths.pop(), release['generatedAt'])
    archive = target / release['archive']
    package(export_dir, archive)

    results = {'manifestSha256': digest(export_dir / 'manifest.json'), 'archiveSha256': digest(archive)}
    if args.pin:
        release.update(results)
        app_pin.update(results)
        for path, value in ((pins_path, pins), (app_path, app_pin)):
            path.write_bytes((json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8'))
        print(f'pinned {release["tag"]} in {pins_path.name} and {app_path.name}')
    for key, actual in results.items():
        print(f'{key}: {actual} ({"matches the pin" if actual == release[key] else "DIFFERS from the pin " + release[key]})')
    print(f'export: {export_dir}\ncomparison index: {pair_dir}\narchive: {archive}')
    if any(actual != release[key] for key, actual in results.items()):
        sys.exit(1)


if __name__ == '__main__':
    main()
