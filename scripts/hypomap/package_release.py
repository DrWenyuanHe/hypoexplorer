"""Package and verify the browser-only HypoMap export.

The archive is what scripts/fetch/fetch_hypomap.mts installs and hypomap-release.json pins.
Written by Helene Li (DrWenyuanHe/hypoexplorer-data#1, 51755a3).
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import tarfile


def package(source: Path, output: Path) -> None:
    manifest = json.loads((source / 'manifest.json').read_text())
    files = manifest['files']
    names = {entry['path'] for entry in files}
    expected = {'metadata.json.gz', 'search-index.json.gz'}
    expected.update(f'genes-{i:04d}.json.gz' for i in range(
        (manifest['gene_count'] + manifest['shard_size'] - 1) // manifest['shard_size']))
    if names != expected or len(names) != len(files):
        raise ValueError('Unexpected atlas release files')
    for entry in files:
        data = (source / entry['path']).read_bytes()
        if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise ValueError(f"Atlas checksum or size mismatch: {entry['path']}")
    with output.open('xb') as destination, gzip.GzipFile(filename='', mode='wb', fileobj=destination, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w|') as archive:
            for name in ['manifest.json', *sorted(names)]:
                if not re.fullmatch(r'[\w.-]+', name):
                    raise ValueError('Invalid release path')
                path = source / name
                info = tarfile.TarInfo(name)
                info.size = path.stat().st_size
                info.mode = 0o644
                with path.open('rb') as member:
                    archive.addfile(info, member)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    package(args.source, args.output)
