"""Tamper/isolation tests of the bounded second-generation historical reader."""
import gzip
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import historical_evidence as evidence
import supersession_fixture as fixture

CANONICAL = 'geo_replication/datasets/GSE135007_discovery_20260905/processed/GSE135007_counts.tsv.gz'
BASE = 'data/quality/gse135007-serialization-2026-10-23'
PRODUCER = 'scripts/regen-r460/run_gse135007_serialized_r460.R'
CURRENT = b'gene\tvalue\nA\t1.2501000000000001\nB\t-0.49990000000000001\n'


class SerializationSuccessorTests(unittest.TestCase):
    def setUp(self):
        # Synthetic miniature lineage; these bytes are not scientific evidence.
        with patch.object(fixture, 'OUTPUT', CANONICAL):
            self.repo = fixture.SupersessionRepo()
        self.addCleanup(self.repo.cleanup)
        self.root = self.repo.root
        self.repo.write(CANONICAL, CURRENT)
        self.repo.write(PRODUCER, b'# synthetic producer fixture\n')
        self.proof = dict(schemaVersion=1, status='PASS', analysisId='GSE135007',
            canonicalSchema='hypo-counts-tsv17-v1', canonicalInput=CANONICAL,
            canonicalInputSha256=fixture.sha(CURRENT),
            roundtrip=dict(exactValues=True, nValues=501080, maxAbsoluteDelta=0),
            sourceMapping=dict(status='PASS', authority='org.Mm.eg.db', version='3.23.0', retainedMapIdentical=True),
            separateProcessReplay=dict(status='PASS', absoluteTolerance=1e-6, relativeTolerance=1e-6,
                matchedRows=15568, modelMismatches=0, normalizationMismatches=0))
        archive = f'{BASE}/preserved/{fixture.sha(fixture.NEW)}.gz'
        self.repo.write(archive, gzip.compress(fixture.NEW, mtime=0))
        self.document = dict(schemaVersion=1, state='finalized', analysisId='GSE135007', datasetId='gse135007',
            predecessorManifest=dict(path=evidence.SUPERSESSION_MANIFEST, sha256=self.repo.manifest_sha),
            producer=dict(path=PRODUCER, sha256=fixture.sha((self.root / PRODUCER).read_bytes())),
            verification=dict(path=f'{BASE}/verification.json'),
            records=[dict(path=CANONICAL, priorSha256=fixture.sha(fixture.NEW), priorBytes=len(fixture.NEW),
                archivePath=archive, newSha256=fixture.sha(CURRENT), newBytes=len(CURRENT))])
        self.pin = patch.object(evidence, 'GSE135007_SERIALIZATION_SUCCESSOR_SHA', None)
        self.pin.start()
        self.addCleanup(self.pin.stop)
        self.finalize()

    def finalize(self):
        proof = fixture.dumps(self.proof)
        self.repo.write(f'{BASE}/verification.json', proof)
        self.document['verification']['sha256'] = fixture.sha(proof)
        body = fixture.dumps(self.document)
        self.repo.write(evidence.GSE135007_SERIALIZATION_SUCCESSOR, body)
        evidence.GSE135007_SERIALIZATION_SUCCESSOR_SHA = fixture.sha(body)

    def read(self):
        return evidence.read_gse135007_serialization_predecessor(self.root, CANONICAL,
            (self.root / CANONICAL).read_bytes(), fixture.sha(fixture.NEW), self.repo.manifest_sha)

    def test_exact_intermediate_and_pre_regeneration_pins_remain_available(self):
        self.assertEqual(self.read(), fixture.NEW)
        state = evidence.Supersession(self.root, self.repo.manifest_sha)
        self.addCleanup(state.close)
        self.assertEqual(state.read(CANONICAL, fixture.sha(fixture.NEW)), fixture.NEW)
        self.assertEqual(state.read(CANONICAL, fixture.sha(fixture.OLD)), fixture.OLD)

    def test_unrelated_path_is_not_authorized(self):
        self.assertIsNone(evidence.read_gse135007_serialization_predecessor(self.root,
            fixture.OTHER, b'unrelated', 'unrelated', self.repo.manifest_sha))

    def test_current_canonical_input_tampering_is_rejected(self):
        self.repo.write(CANONICAL, CURRENT + b'changed')
        with self.assertRaisesRegex(AssertionError, 'canonical input differs'):
            self.read()

    def test_producer_tampering_is_rejected(self):
        self.repo.write(PRODUCER, b'changed producer')
        with self.assertRaisesRegex(AssertionError, 'producer changed'):
            self.read()

    def test_archive_tampering_is_rejected(self):
        self.repo.write(self.document['records'][0]['archivePath'], gzip.compress(b'wrong'))
        with self.assertRaisesRegex(AssertionError, 'archived predecessor changed'):
            self.read()

    def test_rehashed_weak_tolerance_or_failed_replay_is_rejected(self):
        for key, value in [('absoluteTolerance', 1e-5), ('relativeTolerance', 1e-5),
                           ('modelMismatches', 1), ('normalizationMismatches', 1), ('status', 'review')]:
            old = self.proof['separateProcessReplay'][key]
            self.proof['separateProcessReplay'][key] = value
            self.finalize()
            with self.subTest(field=key), self.assertRaisesRegex(AssertionError, 'separate-process model replay'):
                self.read()
            self.proof['separateProcessReplay'][key] = old

    def test_rehashed_inexact_roundtrip_or_mapping_is_rejected(self):
        self.proof['roundtrip']['maxAbsoluteDelta'] = 1e-16
        self.finalize()
        with self.assertRaisesRegex(AssertionError, 'roundtrip was not exact'):
            self.read()
        self.proof['roundtrip']['maxAbsoluteDelta'] = 0
        self.proof['sourceMapping']['retainedMapIdentical'] = False
        self.finalize()
        with self.assertRaisesRegex(AssertionError, 'annotation mapping'):
            self.read()

    def test_rehashed_out_of_scope_record_is_rejected(self):
        self.document['records'].append({**self.document['records'][0], 'path': fixture.OTHER})
        self.finalize()
        with self.assertRaisesRegex(AssertionError, 'exceeds declared scope'):
            self.read()


if __name__ == '__main__':
    unittest.main()
