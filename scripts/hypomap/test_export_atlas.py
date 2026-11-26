"""Checks the atlas exporter end to end on a small synthetic H5AD.

The real input is the 3.8 GB CELLxGENE file (data/hypomap/README.md). This fixture keeps
its layout (categorical obs columns, raw/var, CSR raw/X) and checks every exported
count and log sum against a dense recomputation, the comparison index against the
co-detection service that serves it, and the packaged archive against its manifest.
"""
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

import h5py
import numpy as np

from export_atlas import NO_C7, NO_REGION, WHOLE, build, gzip_bytes
from package_release import package

DATA = Path(__file__).resolve().parents[2] / 'data' / 'hypomap'

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'services' / 'hypomap'))
from comparison_service import ComparisonIndex  # noqa: E402

# Two studies in contiguous row blocks, as in the atlas. 'NA' marks a cell HypoMap left unassigned.
STUDIES = [('StudyA', 'GSE100001'), ('StudyB', 'GSE100002')]
LABELS = ['StudyA'] * 4 + ['StudyB'] * 3
REGIONS = ['Arcuate hypothalamic nucleus', 'NA', 'Ventromedial hypothalamic nucleus',
           'Arcuate hypothalamic nucleus', 'Ventromedial hypothalamic nucleus', 'NA', 'Arcuate hypothalamic nucleus']
C7 = ['GABA', 'GLU', 'NA', 'GABA', 'GLU', 'GLU', 'GABA']
SAMPLES = ['a1', 'a1', 'a2', 'NA', 'b1', 'b1', 'b2']
FEATURES = [('ENSMUSG00000020660', 'Pomc'), ('ENSMUSG00000005705', 'Agrp'), ('ENSMUSG00000086503', 'Xist')]
COUNTS = np.array([
    [5, 0, 1], [0, 2, 0], [1, 1, 0], [3, 0, 2],
    [0, 4, 0], [2, 0, 1], [0, 1, 7],
], dtype=np.float32)

MRK_HEADER = ['MGI Accession ID', 'Chr', 'cM Position', 'genome coordinate start', 'genome coordinate end',
              'strand', 'Marker Symbol', 'Status', 'Marker Name', 'Marker Type', 'Feature Type',
              'Marker Synonyms (pipe-separated)', 'Current MGI Accession ID (if withdrawn)',
              'Current Marker Symbol (if withdrawn)']
MRK_ROWS = [
    {'MGI Accession ID': 'MGI:97606', 'Marker Symbol': 'Pomc', 'Status': 'O', 'Marker Name': 'pro-opiomelanocortin-alpha',
     'Marker Type': 'Gene', 'Marker Synonyms (pipe-separated)': 'Pomc1|Pomc-1'},
    {'MGI Accession ID': 'MGI:892013', 'Marker Symbol': 'Agrp', 'Status': 'O', 'Marker Name': 'agouti related neuropeptide',
     'Marker Type': 'Gene', 'Marker Synonyms (pipe-separated)': 'Agrt|Art|Agrpx'},
    # An official gene outside the atlas whose symbol is also an alias of Agrp (as Cldn25 is of Cldnd1).
    {'MGI Accession ID': 'MGI:1000002', 'Marker Symbol': 'Agrpx', 'Status': 'O', 'Marker Name': 'fixture official gene',
     'Marker Type': 'Gene'},
    # Withdrawn rows share the placeholder accession "NULL", as in the MGI report.
    {'MGI Accession ID': 'NULL', 'Marker Symbol': 'Pomc-w1', 'Status': 'W', 'Marker Name': 'withdrawn, = Pomc',
     'Marker Type': 'Gene', 'Current MGI Accession ID (if withdrawn)': 'MGI:97606', 'Current Marker Symbol (if withdrawn)': 'Pomc'},
    {'MGI Accession ID': 'NULL', 'Marker Symbol': 'Pomc-w2', 'Status': 'W', 'Marker Name': 'withdrawn, = Pomc',
     'Marker Type': 'Gene', 'Current MGI Accession ID (if withdrawn)': 'MGI:97606', 'Current Marker Symbol (if withdrawn)': 'Pomc'},
    {'MGI Accession ID': 'NULL', 'Marker Symbol': 'Gone1', 'Status': 'W', 'Marker Name': 'withdrawn without successor',
     'Marker Type': 'Gene'},
    # A second current gene sharing the synonym "Art": the alias must stay ambiguous.
    {'MGI Accession ID': 'MGI:1000001', 'Marker Symbol': 'Artx', 'Status': 'O', 'Marker Name': 'fixture gene outside the atlas',
     'Marker Type': 'Gene', 'Marker Synonyms (pipe-separated)': 'Art'},
    {'MGI Accession ID': 'MGI:2000002', 'Marker Symbol': 'Agrp-old', 'Status': 'W', 'Marker Name': 'withdrawn, = Agrp',
     'Marker Type': 'Gene', 'Current MGI Accession ID (if withdrawn)': 'MGI:892013',
     'Current Marker Symbol (if withdrawn)': 'Agrp'},
]
COORD = [('MGI:97606', 'ENSMUSG00000020660'), ('MGI:892013', 'ENSMUSG00000005705')]


def write_strings(group, name, values):
    group.create_dataset(name, data=np.array(values, dtype=object), dtype=h5py.string_dtype())


def write_categorical(group, name, values):
    categories = sorted(set(values))
    column = group.create_group(name)
    write_strings(column, 'categories', categories)
    column.create_dataset('codes', data=np.array([categories.index(v) for v in values], dtype=np.int8))


def write_inputs(root):
    atlas = root / 'atlas.h5ad'
    with h5py.File(atlas, 'w') as f:
        obs = f.create_group('obs')
        for name, values in [('Dataset', LABELS), ('Region_summarized', REGIONS), ('C7_named', C7)]:
            write_categorical(obs, name, values)
        write_strings(obs, 'Sample_ID', SAMPLES)
        var = f.create_group('raw/var')
        write_strings(var, '_index', [feature for feature, _ in FEATURES])
        write_categorical(var, 'feature_name', [name for _, name in FEATURES])
        rows, cols = np.nonzero(COUNTS)
        x = f.create_group('raw/X')
        x.create_dataset('data', data=COUNTS[rows, cols])
        x.create_dataset('indices', data=cols.astype(np.int32))
        x.create_dataset('indptr', data=np.concatenate([[0], np.cumsum(np.count_nonzero(COUNTS, axis=1))]).astype(np.int64))
        x.attrs['shape'] = COUNTS.shape
    card = root / 'study_card.csv'
    with card.open('w', newline='', encoding='utf-8') as stream:
        writer = csv.writer(stream)
        writer.writerow(['HypoMap_label', 'GEO_Acc', 'N_cells_in_HypoMap'])
        for label, accession in STUDIES:
            writer.writerow([label, accession, LABELS.count(label)])
    mgi = root / 'mgi'
    mgi.mkdir()
    with gzip.open(mgi / 'MRK_List1.rpt.gz', 'wt', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, MRK_HEADER, delimiter='\t', restval='')
        writer.writeheader()
        writer.writerows(MRK_ROWS)
    with (mgi / 'MGI_Gene_Model_Coord.rpt').open('w', newline='', encoding='utf-8') as stream:
        stream.write('1. MGI accession id\t11. Ensembl gene id\n')
        stream.writelines(f'{mgi_id}\t{ensembl}\n' for mgi_id, ensembl in COORD)
    return atlas, card, mgi


def read_gz(path):
    return json.loads(gzip.decompress(path.read_bytes()))


class ExportAtlasTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        root = Path(cls.temp.name)
        atlas, card, mgi = write_inputs(root)
        cls.out, cls.pairs = root / 'export', root / 'pairs'
        build(atlas, cls.out, cls.pairs, 2, card, mgi, '2026-01-01T00:00:00+00:00')
        cls.manifest = json.loads((cls.out / 'manifest.json').read_text())
        cls.metadata = read_gz(cls.out / 'metadata.json.gz')
        cls.search = read_gz(cls.out / 'search-index.json.gz')
        cls.records = [record for start in range(0, len(FEATURES), 2)
                       for record in read_gz(cls.out / f'genes-{start // 2:04d}.json.gz')]

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def position(self, symbol):
        [position] = self.search['current_symbols'][symbol.casefold()]
        return position

    def test_contexts_and_eligible_cells(self):
        contexts = self.metadata['contexts']
        self.assertEqual(contexts, [WHOLE, 'Arcuate hypothalamic nucleus', 'Ventromedial hypothalamic nucleus', NO_REGION])
        self.assertEqual(self.metadata['c7_labels'], ['GABA', 'GLU', NO_C7])
        self.assertEqual(self.metadata['datasets'], [accession for _, accession in STUDIES])
        self.assertEqual(self.metadata['eligible_cells'], {'GSE100001': [4, 2, 1, 1], 'GSE100002': [3, 1, 1, 1]})
        self.assertEqual(self.metadata['c7_eligible_cells'], {'GSE100001': [2, 1, 1], 'GSE100002': [1, 2, 0]})
        self.assertEqual(self.metadata['annotation_coverage']['GSE100001']['blank_sample_id'], 1)

    def test_every_count_and_log_sum_matches_a_dense_recomputation(self):
        contexts = self.metadata['contexts']
        library = COUNTS.astype(np.float64).sum(axis=1)
        for record in self.records:
            feature = self.search['genes'][record[0]][0]
            column = [f for f, _ in FEATURES].index(feature)
            for d, (label, _) in enumerate(STUDIES):
                rows = [i for i, value in enumerate(LABELS) if value == label]
                positive, log_sum = record[2][d]
                for c, context in enumerate(contexts):
                    scope = [i for i in rows if context == WHOLE
                             or (REGIONS[i] if REGIONS[i] != 'NA' else NO_REGION) == context]
                    detected = [i for i in scope if COUNTS[i, column] >= 1]
                    self.assertEqual(positive[c], len(detected), f'{feature} {label} {context}')
                    expected = sum(np.log1p(10000 * COUNTS[i, column] / library[i]) for i in detected)
                    self.assertAlmostEqual(log_sum[c], expected, places=9)

    def test_symbols_resolve_through_mgi(self):
        genes = self.search['genes']
        pomc = genes[self.position('Pomc')]
        self.assertEqual(pomc[:3], ['ENSMUSG00000020660', 'Pomc', 'pro-opiomelanocortin-alpha'])
        # A feature MGI does not map keeps the atlas's own name.
        self.assertEqual(genes[self.position('Xist')][1:3], ['Xist', 'Xist'])
        self.assertEqual(self.search['aliases']['pomc1'], [self.position('Pomc')])
        self.assertEqual(self.search['aliases']['agrp-old'], [self.position('Agrp')])
        # "Art" names Agrp in the atlas and Artx outside it, so it stays ambiguous for the client.
        self.assertEqual(self.search['aliases']['art'], [self.position('Agrp')])
        self.assertEqual([c['canonical_symbol'] for c in self.search['outside_export_candidates']['art']], ['Artx'])

    def test_official_symbol_never_resolves_to_another_gene(self):
        # "Agrpx" is an official gene outside the atlas, and an alias of Agrp: it must not return Agrp.
        self.assertNotIn('agrpx', self.search['aliases'])
        self.assertNotIn('agrpx', self.search['current_symbols'])
        self.assertEqual([c['canonical_symbol'] for c in self.search['outside_export_candidates']['agrpx']], ['Agrpx'])

    def test_withdrawn_rows_sharing_the_null_accession_all_resolve(self):
        for key in ('pomc-w1', 'pomc-w2'):
            self.assertEqual(self.search['aliases'][key], [self.position('Pomc')])
        everything = json.dumps(self.search).lower()
        self.assertNotIn('"null"', everything)
        self.assertNotIn('gone1', self.search['current_symbols'])

    def test_output_bytes_do_not_depend_on_the_platform(self):
        # Fixed gzip header (no name, mtime 0, OS 255) and fixed bytes for a known payload.
        self.assertEqual(gzip_bytes(b'{"a":1}', 9).hex(), '1f8b08000000000002ffab564a54b232ac0500afac1b5607000000')
        self.assertEqual(gzip_bytes(b'{"a":1}', 4).hex()[:20], '1f8b08000000000000ff')
        for entry in self.manifest['files']:
            header = (self.out / entry['path']).read_bytes()[:10]
            self.assertEqual((header[:4], header[4:8], header[9]), (b'\x1f\x8b\x08\x00', b'\x00' * 4, 0xff), entry['path'])
        for path in (self.out / 'manifest.json', self.pairs / 'manifest.json', *self.pairs.glob('*.json')):
            self.assertNotIn(b'\r', path.read_bytes(), path.name)

    def test_tracked_study_card_matches_its_pin(self):
        pin = json.loads((DATA / 'provenance.json').read_text(encoding='utf-8'))['studyCard']
        data = (DATA / pin['file']).read_bytes()
        self.assertEqual((len(data), hashlib.sha256(data).hexdigest()), (pin['bytes'], pin['sha256']))

    def test_manifest_lists_every_file_with_its_bytes(self):
        names = {entry['path'] for entry in self.manifest['files']}
        self.assertEqual(names, {'metadata.json.gz', 'search-index.json.gz', 'genes-0000.json.gz', 'genes-0001.json.gz'})
        for entry in self.manifest['files']:
            data = (self.out / entry['path']).read_bytes()
            self.assertEqual((len(data), hashlib.sha256(data).hexdigest()), (entry['bytes'], entry['sha256']))
        self.assertEqual(self.manifest['shard_size'], 2)
        self.assertEqual(self.manifest['generated_at'], '2026-01-01T00:00:00+00:00')

    def test_comparison_index_serves_measured_quadrants(self):
        index = ComparisonIndex(self.pairs, export_dir=self.out)
        pomc, agrp = (self.search['genes'][self.position(s)][0] for s in ('Pomc', 'Agrp'))
        result = index.compare(pomc, agrp, tuple(sorted(ds for _, ds in STUDIES)))
        a, b = COUNTS[:, 0] >= 1, COUNTS[:, 1] >= 1
        self.assertEqual(result['whole']['counts'], {
            'both': int((a & b).sum()), 'queryOnly': int((a & ~b).sum()),
            'partnerOnly': int((~a & b).sum()), 'neither': int((~a & ~b).sum())})
        self.assertEqual(result['source_export_manifest_sha256'], hashlib.sha256((self.out / 'manifest.json').read_bytes()).hexdigest())
        arc = index.compare(pomc, agrp, ('GSE100001',), 'Arcuate hypothalamic nucleus')
        self.assertEqual(arc['whole']['eligible'], 2)
        record = index.recommendations(pomc)
        self.assertEqual(record[2], int(a.sum()))

    def test_package_holds_exactly_the_manifest_and_its_files(self):
        archive = Path(self.temp.name) / 'hypomap-atlas.tar.gz'
        package(self.out, archive)
        with tarfile.open(archive, 'r:gz') as tar:
            members = {m.name: tar.extractfile(m).read() for m in tar.getmembers()}
        self.assertEqual(next(iter(members)), 'manifest.json')
        self.assertEqual(members['manifest.json'], (self.out / 'manifest.json').read_bytes())
        for entry in self.manifest['files']:
            self.assertEqual(hashlib.sha256(members[entry['path']]).hexdigest(), entry['sha256'])
        with self.assertRaises(FileExistsError):
            package(self.out, archive)


if __name__ == '__main__':
    unittest.main()
