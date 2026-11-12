"""Local measured pair API. Run after build_comparison_index.py; bind loopback only."""
import argparse
import hashlib
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import numpy as np


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

KEYS = ('both', 'queryOnly', 'partnerOnly', 'neither')


def summary(n, a, b, both):
    counts = dict(zip(KEYS, (both, a-both, b-both, n-a-b+both)))
    if any(v < 0 for v in counts.values()) or sum(counts.values()) != n:
        raise ValueError('Invalid quadrant counts')
    return {'eligible': n, 'counts': counts,
            'percentages': {k: 100*v/n if n else None for k, v in counts.items()},
            'conditionalPercent': 100*both/a if a else None}


class ComparisonIndex:
    def __init__(self, root, processed_dir=None, export_dir=None):
        self.info = json.loads((root / 'manifest.json').read_text())
        if self.info['schema_version'] != 1:
            raise ValueError('Unsupported comparison index')
        if export_dir and digest(export_dir / 'manifest.json') != self.info['source_export_manifest_sha256']:
            raise ValueError('Navigation export changed; rebuild comparison index')
        self.genes = self.info['genes']
        self.lookup = {g[0]: i for i, g in enumerate(self.genes)}
        self.datasets = {}
        self.cohort = self.info.get('cohort')
        self.marginals = np.load(root / 'marginals.npy', mmap_mode='r') if self.cohort else None
        if self.marginals is not None and self.marginals.shape != (len(self.genes),):
            raise ValueError('Invalid atlas marginal count shape')
        for ds in self.info['datasets']:
            name = ds['id']
            key = ds.get('file_key', name)
            checksums = {f'{key}.npy': ds['bits_sha256'], f'{key}.json': ds['metadata_sha256']}
            if self.cohort:
                checksums.update({f'{key}.rows.npy': ds['rows_sha256'],
                                  f'{key}.columns.npy': ds['columns_sha256']})
            for filename, checksum in checksums.items():
                if digest(root / filename) != checksum:
                    raise ValueError(f'Index checksum mismatch: {filename}')
            if processed_dir:
                for filename, checksum in ds['source_sha256'].items():
                    if digest(processed_dir / name / filename) != checksum:
                        raise ValueError(f'Source changed: {name}/{filename}; rebuild index')
            meta = json.loads((root / f'{key}.json').read_text())
            bits = np.load(root / f'{key}.npy', mmap_mode='r')
            if bits.shape != (len(self.genes), (ds['n_cells']+7)//8) or bits.dtype != np.uint8:
                raise ValueError('Invalid bitset shape')
            self.datasets[name] = {'bits': bits, 'n': ds['n_cells'], 'states': meta['states'],
                                   'c7': {k: int.from_bytes(bytes.fromhex(v), 'little') for k, v in meta['c7'].items()},
                                   'regions': {k: int.from_bytes(bytes.fromhex(v), 'little') for k, v in meta['regions'].items()}}
            if self.cohort:
                self.datasets[name]['rows'] = np.load(root / f'{key}.rows.npy', mmap_mode='r')
                self.datasets[name]['columns'] = np.load(root / f'{key}.columns.npy', mmap_mode='r')

    @lru_cache(maxsize=512)
    def recommendations(self, gene_id):
        if self.marginals is None or gene_id not in self.lookup:
            raise ValueError('Atlas recommendations unavailable for this gene')
        i = self.lookup[gene_id]
        both = np.zeros(len(self.genes), dtype=np.int64)
        query_positive = 0
        for ds in self.datasets.values():
            flags = np.unpackbits(ds['bits'][i], bitorder='little')[:ds['n']]
            positive_rows = np.flatnonzero(flags)
            query_positive += len(positive_rows)
            ptr, columns = ds['rows'], ds['columns']
            for start in range(0, len(positive_rows), 256):
                rows = positive_rows[start:start+256]
                detected = np.concatenate([columns[ptr[row]:ptr[row+1]] for row in rows])
                both += np.bincount(detected, minlength=len(self.genes))
        if query_positive != self.marginals[i] or both[i] != query_positive:
            raise ValueError('Recommendation detection indexes disagree')
        both[i] = 0
        candidates = np.flatnonzero(both)
        ranking = np.lexsort((candidates, -self.marginals[candidates].astype(np.int64), -both[candidates]))
        partners = [[int(j), int(both[j])] for j in candidates[ranking[:5]]]
        return [i, list(range(len(self.datasets))), query_positive, partners]


    @lru_cache(maxsize=512)
    def compare(self, a_id, b_id, selected, region='Whole hypothalamus'):
        if a_id not in self.lookup or b_id not in self.lookup:
            raise ValueError('Unknown canonical gene ID')
        if a_id == b_id:
            raise ValueError('Choose two distinct genes')
        if not selected or len(set(selected)) != len(selected) or any(d not in self.datasets for d in selected):
            raise ValueError('Select valid, distinct datasets')
        if region != 'Whole hypothalamus' and not any(region in ds['regions'] for ds in self.datasets.values()):
            raise ValueError('Unknown region')
        ai, bi = self.lookup[a_id], self.lookup[b_id]
        rows, unsupported = [], []
        totals = [0, 0, 0, 0]
        groups = {}
        for name in selected:
            ds = self.datasets[name]
            if ds['states'] is not None and (ds['states'][ai] != 'supported' or ds['states'][bi] != 'supported'):
                unsupported.append({'dataset': name, 'query': ds['states'][ai], 'partner': ds['states'][bi]})
                continue
            a = int.from_bytes(ds['bits'][ai].tobytes(), 'little')
            b = int.from_bytes(ds['bits'][bi].tobytes(), 'little')
            mask = (1 << ds['n'])-1 if region == 'Whole hypothalamus' else ds['regions'].get(region, 0)
            values = (mask.bit_count(), (a & mask).bit_count(), (b & mask).bit_count(), (a & b & mask).bit_count())
            total = summary(*values)
            c7 = []
            for label, group in ds['c7'].items():
                group &= mask
                counts = (group.bit_count(), (a & group).bit_count(), (b & group).bit_count(), (a & b & group).bit_count())
                c7.append({'label': label, **summary(*counts)})
                accumulator = groups.setdefault(label, [0, 0, 0, 0])
                for j, value in enumerate(counts):
                    accumulator[j] += value
            if sum(r['eligible'] for r in c7) != total['eligible'] or any(sum(r['counts'][k] for r in c7) != total['counts'][k] for k in KEYS):
                raise ValueError('C7 partition does not reconcile')
            rows.append({'dataset': name, **total, 'c7': c7})
            for j, value in enumerate(values):
                totals[j] += value
        return {'query': a_id, 'partner': b_id, 'region': region, 'state': 'ready' if rows else 'unsupported',
                'datasets': rows, 'unsupported': unsupported, 'whole': summary(*totals),
                'c7': [{'label': label, **summary(*values)} for label, values in sorted(groups.items())],
                'method': f'raw_count >= 1; cell-pooled; {self.cohort or "all imported eligible cells"}',
                'cohort': self.cohort,
                'source_export_manifest_sha256': self.info['source_export_manifest_sha256']}


def handler_for(index):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            url = urlsplit(self.path)
            status = 200
            try:
                if url.path == '/api/health':
                    result = {'state': 'ready', 'datasets': list(index.datasets)}
                elif url.path == '/api/recommendations':
                    params = parse_qs(url.query, strict_parsing=True)
                    if set(params) != {'gene'} or len(params['gene']) != 1:
                        raise ValueError('Select one gene')
                    result = {'cohort': index.cohort, 'record': index.recommendations(params['gene'][0])}
                elif url.path == '/api/compare':
                    params = parse_qs(url.query, strict_parsing=True)
                    if set(params) - {'a', 'b', 'datasets', 'region'} or any(len(v) != 1 for v in params.values()):
                        raise ValueError('Invalid parameters')
                    result = index.compare(params['a'][0], params['b'][0],
                                           tuple(sorted(params.get('datasets', [','.join(index.datasets)])[0].split(','))),
                                           params.get('region', ['Whole hypothalamus'])[0])
                else:
                    status, result = 404, {'error': 'Unknown endpoint'}
            except (KeyError, ValueError) as error:
                status, result = 400, {'error': str(error)}
            except Exception:
                status, result = 500, {'error': 'Comparison failed'}
            payload = json.dumps(result, allow_nan=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
    return Handler


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--index-dir', type=Path, default=Path('processed/comparison_index'))
    parser.add_argument('--processed-dir', type=Path, default=Path('processed'))
    parser.add_argument('--export-dir', type=Path, default=Path('navigation_export'))
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    index = ComparisonIndex(args.index_dir, args.processed_dir, args.export_dir)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler_for(index))
    print(f'Comparison API ready at http://127.0.0.1:{args.port}', flush=True)
    server.serve_forever()
