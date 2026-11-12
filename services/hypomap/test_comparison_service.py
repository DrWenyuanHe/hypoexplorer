"""Small edge-case checks supplement independent full-input validation."""
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from comparison_service import ComparisonIndex, digest


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
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
