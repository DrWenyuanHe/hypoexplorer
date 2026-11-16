"""Small edge-case checks supplement independent full-input validation."""
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np
from comparison_service import ComparisonIndex, digest, handler_for

WIRE = Path(__file__).with_name('codetection_wire.json')


def mask_hex(cells, n):
    """A cell set as the service's little-endian hex bitmask."""
    return sum(1 << cell for cell in cells).to_bytes((n + 7) // 8, 'little').hex()


def build_wire_index(spec, root):
    """Write a cohort comparison index (with recommendation inputs) described by the wire fixture."""
    genes = spec['genes']
    marginals = np.zeros(len(genes), dtype=np.int64)
    datasets = []
    for ds in spec['datasets']:
        cells, key = ds['cells'], ds['id']
        flags = np.array([[gene in cell for cell in cells] for gene in range(len(genes))])
        marginals += flags.sum(axis=1)
        np.save(root / f'{key}.npy', np.packbits(flags, axis=1, bitorder='little'))
        np.save(root / f'{key}.rows.npy', np.cumsum([0, *map(len, cells)]).astype(np.int64))
        np.save(root / f'{key}.columns.npy', np.array([gene for cell in cells for gene in cell], dtype=np.int64))
        (root / f'{key}.json').write_text(json.dumps({
            'states': ds['states'],
            'c7': {label: mask_hex(group, len(cells)) for label, group in ds['c7'].items()},
            'regions': {label: mask_hex(group, len(cells)) for label, group in ds['regions'].items()}}))
        datasets.append({'id': key, 'n_cells': len(cells), 'source_sha256': {},
                         **{f'{field}_sha256': digest(root / f'{key}{suffix}') for field, suffix in
                            [('bits', '.npy'), ('metadata', '.json'), ('rows', '.rows.npy'), ('columns', '.columns.npy')]}})
    np.save(root / 'marginals.npy', marginals)
    (root / 'manifest.json').write_text(json.dumps({
        'schema_version': 1, 'cohort': spec['cohort'], 'genes': [gene[:2] for gene in genes],
        'source_export_manifest_sha256': spec['source_export_manifest_sha256'], 'datasets': datasets}))
    return ComparisonIndex(root)


def serve(index):
    """Serve the index on an ephemeral loopback port; returns a GET helper and the server."""
    class Quiet(handler_for(index)):
        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    def get(endpoint, params):
        with urlopen(f'http://127.0.0.1:{server.server_port}/api/{endpoint}?{urlencode(params)}') as response:
            return response.status, json.loads(response.read())
    return get, server


class WireContractTests(unittest.TestCase):
    """The golden responses the browser client is tested against are what the service serves."""

    def test_service_serves_the_golden_responses(self):
        wire = json.loads(WIRE.read_text(encoding='utf-8'))
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp:
            get, server = serve(build_wire_index(wire['index'], Path(temp)))
            try:
                self.assertTrue(wire['requests'])
                for request in wire['requests']:
                    with self.subTest(request['name']):
                        status, body = get(request['endpoint'], request['params'])
                        self.assertEqual(status, 200)
                        self.assertEqual(body, request['response'])
            finally:
                server.shutdown()
                server.server_close()


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        # The index memory-maps its .npy files; Windows cannot delete a mapped file.
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.root = Path(self.temp.name)
        np.save(self.root / 'fixture.npy', np.array([[3], [6], [0], [0]], dtype=np.uint8))
        (self.root / 'fixture.json').write_text(json.dumps({
            'states': ['supported', 'supported', 'gene_not_found', 'duplicate_dataset_mapping'],
            'c7': {'GLU': '03', 'Unannotated C7': '0c'},
            'regions': {'ARC': '01', 'Empty': '00'}}))
        manifest = {'schema_version': 1, 'genes': [[str(i), str(i)] for i in range(4)],
                    'source_export_manifest_sha256': '', 'datasets': [
                        {'id': 'fixture', 'n_cells': 4, 'source_sha256': {},
                         'bits_sha256': digest(self.root / 'fixture.npy'),
                         'metadata_sha256': digest(self.root / 'fixture.json')}]}
        (self.root / 'manifest.json').write_text(json.dumps(manifest))
        self.index = ComparisonIndex(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def test_partition_and_unsupported(self):
        result = self.index.compare('0', '1', ('fixture',))
        self.assertEqual(result['whole']['counts'], dict(both=1, queryOnly=1, partnerOnly=1, neither=1))
        self.assertEqual(sum(r['eligible'] for r in result['c7']), 4)
        for partner, state in [('2', 'gene_not_found'), ('3', 'duplicate_dataset_mapping')]:
            unsupported = self.index.compare('0', partner, ('fixture',))
            self.assertEqual(unsupported['state'], 'unsupported')
            self.assertEqual(unsupported['unsupported'][0]['partner'], state)
            self.assertIsNone(unsupported['whole']['conditionalPercent'])

    def test_empty_and_zero_detection(self):
        empty = self.index.compare('0', '1', ('fixture',), 'Empty')['whole']
        self.assertEqual(empty['eligible'], 0)
        self.assertTrue(all(v is None for v in empty['percentages'].values()))
        # B has no positives in this region; its conditional score is undefined.
        zero = self.index.compare('1', '0', ('fixture',), 'ARC')['whole']
        self.assertEqual(zero['counts']['partnerOnly'], 1)
        self.assertIsNone(zero['conditionalPercent'])

    def test_reverse_rank_includes_partners_outside_top_five(self):
        # Gene 0 shares one cell with gene 1. Genes 2–7 each share two.
        cells = [[0, 1], [1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6, 7], [2]]
        self.index.genes = [[str(i), str(i)] for i in range(8)]
        self.index.lookup = {str(i): i for i in range(8)}
        self.index.marginals = np.bincount([gene for cell in cells for gene in cell], minlength=8)
        flags = np.array([[gene in cell for cell in cells] for gene in range(8)])
        self.index.datasets = {'fixture': {
            'bits': np.packbits(flags, axis=1, bitorder='little'),
            'n': len(cells),
            'rows': np.cumsum([0, *map(len, cells)]),
            'columns': np.array([gene for cell in cells for gene in cell]),
        }}
        self.assertEqual(self.index.recommendations('0')[3], [[1, 1, 7]])
        self.assertEqual(self.index.ranked_partners(1).tolist(), [2, 3, 4, 5, 6, 7, 0])

    def test_invalid_requests_and_integrity(self):
        for a, b, ds in [('0', '0', ('fixture',)), ('bad', '1', ('fixture',)),
                          ('0', '1', ()), ('0', '1', ('fixture', 'fixture'))]:
            with self.assertRaises(ValueError):
                self.index.compare(a, b, ds)
        (self.root / 'fixture.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            ComparisonIndex(self.root)


if __name__ == '__main__':
    unittest.main()
