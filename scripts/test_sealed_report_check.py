"""Isolation and tamper tests for the sealed September 11 report runner."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import historical_evidence
from historical_evidence import ARCHIVES, close_supersessions, read_sealed_input, read_superseded, supersession_names
from run_sealed_report_check import (CONFIG, FIRST, PRODUCERS, ROOT, SCIENCE, key, main, project, sealed_ledger,
                                     sealed_science, through_runner)
import supersession_fixture as fixture
from supersession_fixture import SupersessionRepo

QUALITY = 'data/quality/assessments.generated.json'
VALIDATION = 'data/author-validation/validation-records.generated.json'
SPECS = 'data/author-validation/additional-comparison-specs.json'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def dumps(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf8')


class SealedReportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.write(f'{FIRST}/baseline.json', dumps({'originalDatasetIds': ['a', 'b'], 'intakeDatasetIds': ['c']}))
        self.write(f'{ARCHIVES}/manifest.json', dumps({'records': []}))
        self.write('data/intake/hfd-2026-09-12/studies.json', dumps([{'tracks': [{'analysisId': 'NEW'}]}]))

    def write(self, relative, data):
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return target

    def archive(self, relative, data):
        manifest = json.loads((self.root / ARCHIVES / 'manifest.json').read_bytes())
        manifest['records'].append({'path': relative, 'sha256': sha(data), 'bytes': len(data),
                                    'archivePath': f'{ARCHIVES}/{sha(data)}.gz'})
        self.write(f'{ARCHIVES}/{sha(data)}.gz', gzip.compress(data, mtime=0))
        self.write(f'{ARCHIVES}/manifest.json', dumps(manifest))
        return sha(data)

    # Ledgers
    def quality(self, *records):
        return {'schemaVersion': 2, 'policy': 'unchanged', 'records': [{'datasetId': i, 'status': s} for i, s in records]}

    def test_unchanged_ledger_is_read_as_is(self):
        body = dumps(self.quality(('a', 'pass')))
        self.write(QUALITY, body)
        self.assertEqual(sealed_ledger(self.root, QUALITY, sha(body)), (body, 'current'))

    def test_added_datasets_are_projected_away(self):
        sealed = dumps(self.quality(('a', 'pass'), ('b', 'review'), ('c', 'pass')))
        self.write(QUALITY, dumps(self.quality(('a', 'pass'), ('b', 'review'), ('c', 'pass'), ('hfd', 'pass'))))
        self.assertEqual(sealed_ledger(self.root, QUALITY, sha(sealed)),
                         (sealed, 'current restricted to the sealed datasets'))

    def test_changed_sealed_record_is_not_projected(self):
        sealed = dumps(self.quality(('a', 'pass'), ('b', 'review'), ('c', 'pass')))
        self.write(QUALITY, dumps(self.quality(('a', 'pass'), ('b', 'pass'), ('c', 'pass'), ('hfd', 'pass'))))
        with self.assertRaisesRegex(AssertionError, 'No sealed historical input'):
            sealed_ledger(self.root, QUALITY, sha(sealed))

    def test_changed_policy_is_not_projected(self):
        sealed = dumps(self.quality(('a', 'pass'), ('b', 'review'), ('c', 'pass')))
        self.write(QUALITY, dumps({**self.quality(('a', 'pass'), ('b', 'review'), ('c', 'pass')), 'policy': 'new'}))
        with self.assertRaisesRegex(AssertionError, 'No sealed historical input'):
            sealed_ledger(self.root, QUALITY, sha(sealed))

    def validation(self, records, scope=159, generated='2026-09-11', label='dataset x registered contrast'):
        return {'generatedAt': generated, 'scope': {'registryDatasets': scope, 'inScopeDatasets': scope - 1, 'unit': label},
                'counts': {'review_required': len(records)}, 'records': [{'datasetId': i} for i in records]}

    def test_validation_ledger_may_grow_its_inventory(self):
        sealed = dumps(self.validation(['a', 'b']))
        pin = self.archive(VALIDATION, sealed)
        self.write(VALIDATION, dumps(self.validation(['a', 'b', 'hfd'], scope=161, generated='2026-09-14')))
        self.assertEqual(sealed_ledger(self.root, VALIDATION, pin), (sealed, 'archived'))

    def test_validation_ledger_rejects_a_shrunk_or_redefined_scope(self):
        pin = self.archive(VALIDATION, dumps(self.validation(['a', 'b'])))
        self.write(VALIDATION, dumps(self.validation(['a', 'b'], scope=158)))
        with self.assertRaisesRegex(AssertionError, 'scope shrank'):
            read_sealed_input(self.root, VALIDATION, pin)
        self.write(VALIDATION, dumps(self.validation(['a', 'b'], label='dataset')))
        with self.assertRaisesRegex(AssertionError, 'semantics changed'):
            read_sealed_input(self.root, VALIDATION, pin)

    def test_validation_ledger_rejects_a_changed_record(self):
        pin = self.archive(VALIDATION, dumps(self.validation(['a', 'b'])))
        changed = self.validation(['a', 'b', 'hfd'], scope=161)
        changed['records'][0]['note'] = 'rewritten'
        self.write(VALIDATION, dumps(changed))
        with self.assertRaisesRegex(AssertionError, 'Historical dataset evidence changed'):
            read_sealed_input(self.root, VALIDATION, pin)

    def test_specifications_may_only_gain_comparisons(self):
        rows = [{'datasetId': 'a', 'contrast': 'x'}, {'datasetId': 'b', 'contrast': 'y'}]
        sealed = dumps({'schemaVersion': 1, 'comparisons': rows})
        pin = self.archive(SPECS, sealed)
        self.write(SPECS, dumps({'schemaVersion': 1, 'comparisons': rows + [{'datasetId': 'hfd', 'contrast': 'z'}]}))
        self.assertEqual(read_sealed_input(self.root, SPECS, pin), sealed)
        self.write(SPECS, dumps({'schemaVersion': 1, 'comparisons': [rows[0], {'datasetId': 'b', 'contrast': 'q'}]}))
        with self.assertRaisesRegex(AssertionError, 'Historical dataset evidence changed'):
            read_sealed_input(self.root, SPECS, pin)

    # Scientific files
    def snapshot(self, files):
        self.write(SCIENCE, dumps({'files': [{'path': p, 'bytes': len(b), 'sha256': sha(b)} for p, b in files.items()]}))

    def test_only_proven_differences_are_served_pinned_bytes(self):
        crlf = b'gene,logFC\r\nA,1\r\n'
        self.snapshot({'exact.csv': b'x\n', 'newline.csv': crlf, 'edited.csv': crlf, 'lone-cr.csv': b'a\rb\n\r\n',
                       'missing.csv': b'gone\n'})
        self.write('exact.csv', b'x\n')
        newline = self.write('newline.csv', b'gene,logFC\nA,1\n')
        self.write('edited.csv', b'gene,logFC\nA,2\n')
        self.write('lone-cr.csv', b'a\rb\n\n')
        views, reasons = sealed_science(self.root)
        self.assertEqual(views, {key(newline): crlf})
        self.assertEqual(sum(reasons.values()), 1)

    def test_configuration_needs_only_reviewed_appended_rows(self):
        original = b'id\tdir\r\nOLD\tx\r\n'
        self.archive(CONFIG, original)
        self.snapshot({CONFIG: original})
        self.write(CONFIG, original + b'NEW\ty\r\n')
        views, _ = sealed_science(self.root)
        self.assertEqual(list(views.values()), [original])
        self.write(CONFIG, original + b'UNREVIEWED\ty\r\n')
        with self.assertRaises(AssertionError):
            sealed_science(self.root)

    def test_projection_covers_binary_reads_and_size_only(self):
        pinned, other = self.write('pinned.csv', b'a\nb\n'), self.write('other.csv', b'other\n')
        with project({key(pinned): b'a\r\nb\r\n'}):
            self.assertEqual(pinned.read_bytes(), b'a\r\nb\r\n')
            with pinned.open('rb') as stream:
                self.assertEqual(hashlib.file_digest(stream, 'sha256').hexdigest(), sha(b'a\r\nb\r\n'))
            self.assertEqual(pinned.stat().st_size, 6)
            self.assertTrue(pinned.is_file())
            self.assertEqual(pinned.read_text('utf8'), 'a\nb\n')
            self.assertEqual(other.read_bytes(), b'other\n')
            self.assertEqual(other.stat().st_size, 6)
        self.assertEqual(pinned.read_bytes(), b'a\nb\n')

    def test_edit_during_check_is_rejected(self):
        pinned = self.write('pinned.csv', b'a\nb\n')
        with project({key(pinned): b'a\r\nb\r\n'}):
            pinned.write_bytes(b'a\nchanged\n')
            with self.assertRaisesRegex(AssertionError, 'changed during historical check'):
                pinned.read_bytes()

    # Runner
    def test_only_pinned_producers_are_rerouted(self):
        calls = []
        run = through_runner(lambda args, *rest, **kwargs: calls.append(args))
        verify = f'{FIRST}/verify_scientific_files.py'
        run([sys.executable, '-X', 'utf8', str(ROOT / verify), '--check'])
        run([sys.executable, '-X', 'utf8', str(ROOT / 'scripts/other.py'), '--check'])
        run(['git', 'status'])
        runner = str(ROOT / 'scripts/run_sealed_report_check.py')
        self.assertEqual(calls[0], [sys.executable, '-X', 'utf8', runner, verify, '--check'])
        self.assertEqual(calls[1], [sys.executable, '-X', 'utf8', str(ROOT / 'scripts/other.py'), '--check'])
        self.assertEqual(calls[2], ['git', 'status'])

    def test_produce_mode_unscoped_and_changed_producers_are_refused(self):
        with self.assertRaisesRegex(AssertionError, 'Only a sealed producer'):
            main([f'{FIRST}/build_report.py'])
        with self.assertRaisesRegex(AssertionError, 'outside the sealed report scope'):
            main(['scripts/other.py', '--check'])
        with patch.dict(PRODUCERS, {f'{FIRST}/build_report.py': ('0' * 64, 'ledgers')}):
            with self.assertRaisesRegex(AssertionError, 'Historical producer changed'):
                main([f'{FIRST}/build_report.py', '--check'])


class SupersessionTests(unittest.TestCase):
    """Pinned outputs and ledgers replaced by the R 4.6.0 regeneration."""

    def setUp(self):
        self.repo = SupersessionRepo()
        self.addCleanup(self.repo.cleanup)
        self.root = self.repo.root
        self.pinned = patch.object(historical_evidence, 'SUPERSESSION_SHA', self.repo.manifest_sha)

    def read(self, pin, **kwargs):
        return read_superseded(self.root, fixture.OUTPUT, pin, self.repo.manifest_sha, **kwargs)

    def test_exact_and_crlf_pins_receive_the_committed_old_bytes(self):
        self.assertEqual(self.read(sha(fixture.OLD)), fixture.OLD)
        crlf = fixture.OLD.replace(b'\n', b'\r\n')
        self.assertEqual(self.read(sha(crlf)), crlf)
        with self.assertRaisesRegex(AssertionError, 'Pin is not the superseded bytes'):
            self.read(sha(b'another pin'))

    def test_current_bytes_must_be_the_recorded_regeneration(self):
        self.repo.write(fixture.OUTPUT, fixture.NEW + b'C\t3\n')
        with self.assertRaisesRegex(AssertionError, 'not the recorded R 4.6.0 regeneration'):
            self.read(sha(fixture.OLD))

    def test_manifest_naming_another_blob_is_refused(self):
        manifest_sha = self.repo.manifest(oldGitBlob=self.repo.other_blob)
        with self.assertRaisesRegex(AssertionError, 'Superseded blob is not the recorded one'):
            read_superseded(self.root, fixture.OUTPUT, sha(fixture.OLD), manifest_sha)

    def test_manifest_with_rewritten_old_bytes_is_refused(self):
        forged = b'gene\tlogFC\nA\t9\n'
        manifest_sha = self.repo.manifest(oldSha256=sha(forged), oldBytes=len(forged))
        with self.assertRaisesRegex(AssertionError, 'Superseded bytes changed'):
            read_superseded(self.root, fixture.OUTPUT, sha(forged), manifest_sha)

    def test_edited_manifest_is_refused(self):
        pinned = self.repo.manifest_sha
        self.repo.manifest(datasetId='a')
        with self.assertRaisesRegex(AssertionError, 'Supersession manifest changed'):
            read_superseded(self.root, fixture.OUTPUT, sha(fixture.OLD), pinned)

    def test_unfinalized_manifest_serves_nothing(self):
        with patch.object(historical_evidence, 'SUPERSESSION_SHA', None):
            self.assertFalse(supersession_names(self.root, fixture.OUTPUT))
            with self.assertRaisesRegex(AssertionError, 'not finalized'):
                read_superseded(self.root, fixture.OUTPUT, sha(fixture.OLD))

    def test_only_the_manifest_pinned_in_the_reader_is_accepted(self):
        # The repository's own constant pins the real manifest, not this fixture's.
        with self.assertRaisesRegex(AssertionError, 'Supersession manifest changed'):
            read_superseded(self.root, fixture.OUTPUT, sha(fixture.OLD))

    def test_checkout_crlf_rendering_of_lf_regenerated_bytes_is_accepted(self):
        rendered = fixture.NEW.replace(b'\n', b'\r\n')
        self.repo.write(fixture.OUTPUT, rendered)
        self.assertEqual(self.read(sha(fixture.OLD)), fixture.OLD)
        self.repo.write(fixture.OUTPUT, rendered + b'\r')
        with self.assertRaisesRegex(AssertionError, 'not the recorded R 4.6.0 regeneration'):
            self.read(sha(fixture.OLD))

    def test_shallow_clone_fails_closed(self):
        clone = self.root.parent / f'{self.root.name}-shallow'
        subprocess.run(['git', '-c', 'core.autocrlf=false', 'clone', '-q', '--depth', '1', self.root.as_uri(), str(clone)], check=True, capture_output=True)
        self.addCleanup(shutil.rmtree, clone, onexc=lambda f, p, e: (os.chmod(p, 0o700), f(p)))
        with self.assertRaisesRegex(AssertionError, 'shallow clone.*git fetch --unshallow'):
            read_superseded(clone, fixture.OUTPUT, sha(fixture.OLD), self.repo.manifest_sha)
        close_supersessions()

    def test_snapshot_pins_of_superseded_outputs_are_served_old_bytes(self):
        crlf = fixture.OLD.replace(b'\n', b'\r\n')
        self.repo.write(SCIENCE, dumps({'files': [{'path': fixture.OUTPUT, 'bytes': len(crlf), 'sha256': sha(crlf)},
                                                  {'path': fixture.OTHER, 'bytes': 1, 'sha256': sha(b'x')}]}))
        with self.pinned:
            views, reasons = sealed_science(self.root)
        self.assertEqual(views, {key(self.root / fixture.OUTPUT): crlf})
        self.assertEqual(reasons, {'superseded by the R 4.6.0 regeneration': 1})
        with project(views):
            self.assertEqual((self.root / fixture.OUTPUT).read_bytes(), crlf)
            (self.root / fixture.OUTPUT).write_bytes(fixture.NEW + b'edited\n')
            with self.assertRaisesRegex(AssertionError, 'changed during historical check'):
                (self.root / fixture.OUTPUT).read_bytes()

    def test_snapshot_rejects_a_superseded_output_changed_again(self):
        self.repo.write(SCIENCE, dumps({'files': [{'path': fixture.OUTPUT, 'bytes': len(fixture.OLD), 'sha256': sha(fixture.OLD)}]}))
        self.repo.write(fixture.OUTPUT, b'gene\tlogFC\nA\t0\nB\t0\nC\t0\n')
        with self.pinned, self.assertRaisesRegex(AssertionError, 'not the recorded R 4.6.0 regeneration'):
            sealed_science(self.root)

    def restricted(self, document):
        self.repo.write(f'{FIRST}/baseline.json', dumps({'originalDatasetIds': ['a', 'b'], 'intakeDatasetIds': ['c']}))
        return dumps({**document, 'records': [row for row in document['records'] if row['datasetId'] in 'abc']})

    def test_regenerated_ledger_resolves_against_the_pre_regeneration_ledger(self):
        pin = sha(self.restricted(fixture.ledger()))
        with self.pinned:
            body, reason = sealed_ledger(self.root, fixture.LEDGER, pin)
        self.assertEqual(sha(body), pin)
        self.assertEqual(reason, 'current restricted to the sealed datasets before the R 4.6.0 regeneration')
        with self.pinned:  # A pin of the whole pre-regeneration ledger.
            self.assertEqual(sealed_ledger(self.root, fixture.LEDGER, sha(self.repo.before))[0], self.repo.before)

    def test_regenerated_ledger_may_not_change_other_datasets_or_policy(self):
        pin = sha(self.restricted(fixture.ledger()))
        self.repo.write(fixture.LEDGER, dumps(fixture.ledger(a='review', b='pass')))
        with self.pinned, self.assertRaisesRegex(AssertionError, 'dataset outside the regeneration: .*/records/a'):
            sealed_ledger(self.root, fixture.LEDGER, pin)
        self.repo.write(fixture.LEDGER, dumps({**fixture.ledger(b='pass'), 'policy': 'new'}))
        with self.pinned, self.assertRaisesRegex(AssertionError, 'Regenerated ledger semantics changed'):
            sealed_ledger(self.root, fixture.LEDGER, pin)
        self.repo.write(fixture.LEDGER, dumps(fixture.ledger(b='pass', new='pass')))
        with self.pinned, self.assertRaisesRegex(AssertionError, 'record count changed'):
            sealed_ledger(self.root, fixture.LEDGER, pin)

    def test_archived_ledger_must_hold_its_recorded_bytes(self):
        pin = sha(self.restricted(fixture.ledger()))
        self.repo.write(self.repo.ledger_row['archivePath'], gzip.compress(dumps(fixture.ledger(a='fail')), mtime=0))
        with self.pinned, self.assertRaisesRegex(AssertionError, 'Archived ledger changed'):
            sealed_ledger(self.root, fixture.LEDGER, pin)


if __name__ == '__main__':
    unittest.main()
