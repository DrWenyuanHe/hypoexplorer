"""Isolation and tamper tests for the historical check adapter's projections."""
import gzip
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from historical_evidence import JOB_PATH_FIELDS, JOBS_MANIFEST, SEALED_JOBS_ROOT
from run_historical_check import (CHILD_SCRIPTS, CONFIG, PRODUCERS, REPLAY_LOG, ROOT, main, project_child_processes, project_config_pin,
                                  project_jobs_manifest, project_replay_log, project_superseded, served_jobs_manifest,
                                  without_locale_warnings)
import run_historical_check
import historical_evidence
import supersession_fixture as fixture
from supersession_fixture import SupersessionRepo

LOCALE_BLOCK = (b'During startup - Warning messages:\r\n1: Setting LC_COLLATE=C.UTF-8 failed \r\n'
                b'2: Setting LC_CTYPE=C.UTF-8 failed \r\n')


def additive_study():
    directory = 'geo_replication/datasets/GSE30733_rnor_son_lactation'
    return {'id': 'rat_son_lactation_gse30733', 'accession': 'GSE30733', 'dir': directory,
            'organism': 'Rattus norvegicus',
            'tracks': [{'id': 'son', 'analysisId': 'GSE30733', 'matrix': f'{directory}/processed/expression.tsv.gz',
                        'samplesheet': f'{directory}/metadata/samplesheet.tsv'}],
            'contrasts': [{'id': 'lactating_vs_control'}, {'id': 'dehydrated_vs_control'}]}


def write_additive_intake(root, studies=None):
    target = root / historical_evidence.ADDITIVE_INTAKE
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps([additive_study()] if studies is None else studies), encoding='utf8')
    return target


class HistoricalCheckTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        archive_dir = 'data/quality/hfd-intake-2026-09-12/preserved-inputs'
        manifest = json.loads((ROOT / archive_dir / 'manifest.json').read_text('utf8'))
        self.reference = next(r for r in manifest['records'] if r['path'] == CONFIG)
        for relative in [CONFIG, f'{archive_dir}/manifest.json', self.reference['archivePath'],
                         'data/intake/hfd-2026-09-12/studies.json']:
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((ROOT / relative).read_bytes())
        self.original = gzip.decompress((self.root / self.reference['archivePath']).read_bytes())
        self.config = self.root / CONFIG
        self.current = self.config.read_bytes()
        # CONFIG is copied from the current checkout, so carry the source-bound
        # declarations for its admitted additions into this isolated checkout.
        # Otherwise a legitimate current row becomes undeclared in the fixture.
        intake = ROOT / historical_evidence.ADDITIVE_INTAKE
        self.current_intake = json.loads(intake.read_text('utf8')) if intake.exists() else []
        if self.current_intake:
            write_additive_intake(self.root, self.current_intake)

    def test_only_config_binary_pin_is_projected(self):
        other = self.root / 'source.tsv'
        other.write_bytes(b'authentic source bytes\n')
        with project_config_pin(self.root):
            self.assertEqual(self.config.read_bytes(), self.original)
            self.assertEqual(self.config.read_text('utf8'), self.current.decode('utf8').replace('\r\n', '\n'))
            self.assertEqual(other.read_bytes(), b'authentic source bytes\n')
        self.assertEqual(self.config.read_bytes(), self.current)

    def test_original_row_edit_is_rejected(self):
        lines = self.current.decode('utf8').splitlines()
        cells = lines[1].split('\t')
        cells[-1] += '_changed'
        lines[1] = '\t'.join(cells)
        self.config.write_text('\n'.join(lines) + '\n', encoding='utf8')
        with self.assertRaisesRegex(AssertionError, 'Historical configuration changed'):
            with project_config_pin(self.root):
                self.fail('Tampered original row accepted')

    def test_original_row_deletion_is_rejected(self):
        lines = self.current.decode('utf8').splitlines()
        self.config.write_text('\n'.join([lines[0]] + lines[2:]) + '\n', encoding='utf8')
        with self.assertRaisesRegex(AssertionError, 'Historical configuration changed'):
            with project_config_pin(self.root):
                self.fail('Deleted original row accepted')

    def test_unknown_new_config_is_rejected(self):
        lines = self.current.decode('utf8').splitlines()
        row = lines[-1].split('\t')
        row[0] = 'UNDECLARED_HFD_CONFIGURATION'
        self.config.write_text('\n'.join(lines + ['\t'.join(row)]) + '\n', encoding='utf8')
        with self.assertRaises(AssertionError):
            with project_config_pin(self.root):
                self.fail('Undeclared new row accepted')

    def test_current_addition_still_requires_its_copied_source_declaration(self):
        if not self.current_intake:
            self.skipTest('The current configuration has no additive intake')
        (self.root / historical_evidence.ADDITIVE_INTAKE).unlink()
        with self.assertRaisesRegex(AssertionError, 'Unreviewed added configuration'):
            with project_config_pin(self.root):
                self.fail('Current additive rows accepted without source declarations')

    def added_config(self):
        lines = self.current.decode('utf8').splitlines()
        headers = lines[0].split('\t')
        directory = additive_study()['dir'].removeprefix('geo_replication/')
        row = dict(zip(headers, lines[-1].split('\t')))
        row.update(id='GSE30733_dehydrated_vs_control', dir=directory, organism='Rattus norvegicus',
                   input_kind='matrix', input_path=f'{directory}/processed/expression.tsv.gz',
                   samplesheet=f'{directory}/metadata/analysis_samplesheet.tsv')
        return lines, headers, row

    def test_source_bound_new_contrast_configuration_is_projected(self):
        write_additive_intake(self.root, self.current_intake + [additive_study()])
        lines, headers, row = self.added_config()
        self.config.write_text('\n'.join(lines + ['\t'.join(row[key] for key in headers)]) + '\n', encoding='utf8')
        with project_config_pin(self.root):
            self.assertEqual(self.config.read_bytes(), self.original)

    def test_new_configuration_cannot_bind_another_dataset_or_escape_its_directory(self):
        write_additive_intake(self.root, self.current_intake + [additive_study()])
        lines, headers, row = self.added_config()
        for field, value in [('dir', 'datasets/GSE65663_rnor_son_salt'), ('organism', 'Mus musculus'),
                             ('input_kind', 'counts'), ('input_path', '../elsewhere/expression.tsv.gz'),
                             ('samplesheet', row['dir'] + '/metadata/../other.tsv')]:
            with self.subTest(field=field):
                changed = {**row, field: value}
                self.config.write_text('\n'.join(lines + ['\t'.join(changed[key] for key in headers)]) + '\n', encoding='utf8')
                with self.assertRaises(AssertionError):
                    with project_config_pin(self.root):
                        self.fail('Rebound additive configuration accepted')

    def test_source_declaration_cannot_authorize_an_unrelated_or_duplicate_identity(self):
        for edit in [lambda s: s.update(id='macaque_snrna'), lambda s: s.update(accession='GSE000000'),
                     lambda s: s.update(dir='geo_replication/datasets/GSE65663_rnor_son_salt'),
                     lambda s: s['tracks'][0].update(analysisId='GSE65663'),
                     lambda s: s['tracks'][0].update(matrix=s['dir'] + '/../../another.tsv'),
                     lambda s: s['contrasts'].append(s['contrasts'][0])]:
            study = additive_study()
            edit(study)
            write_additive_intake(self.root, [study])
            with self.assertRaises(AssertionError):
                historical_evidence.read_additive_intake(self.root)
        write_additive_intake(self.root, [additive_study(), additive_study()])
        with self.assertRaisesRegex(AssertionError, 'Duplicate additive intake dataset'):
            historical_evidence.read_additive_intake(self.root)

    def test_change_during_check_is_rejected(self):
        with project_config_pin(self.root):
            self.config.write_bytes(self.current + b'changed')
            with self.assertRaisesRegex(AssertionError, 'Configuration changed during'):
                self.config.read_bytes()

    def test_produce_mode_and_unscoped_scripts_are_refused(self):
        with self.assertRaisesRegex(AssertionError, 'Only a sealed producer'):
            main(['anything.py'])
        with self.assertRaisesRegex(AssertionError, 'outside the historical'):
            main(['anything.py', '--check'])


class AdditiveLedgerTests(unittest.TestCase):
    def setUp(self):
        self.repo = SupersessionRepo()
        self.addCleanup(self.repo.cleanup)
        write_additive_intake(self.repo.root)
        self.added = additive_study()['id']
        self.ids = historical_evidence.read_additive_intake(self.repo.root)[0]

    def check(self, path, before, after):
        historical_evidence.check_ledger_transition(path, before, after, {'b'}, set(), additive_ids=self.ids)

    def test_declared_rows_are_removed_only_from_the_historical_view(self):
        body = fixture.ledger(b='pass', **{self.added: 'not_assessed'})
        self.repo.write(fixture.LEDGER, fixture.dumps(body))
        self.assertEqual(historical_evidence.superseded_ledger(self.repo.root, fixture.LEDGER, self.repo.manifest_sha), self.repo.before)
        self.assertEqual(json.loads((self.repo.root / fixture.LEDGER).read_bytes()), body)

    def test_addition_does_not_relax_old_record_policy_order_or_uniqueness_checks(self):
        before = fixture.ledger()
        after = fixture.ledger(b='pass', **{self.added: 'not_assessed'})
        mutations = []
        edited = json.loads(json.dumps(after)); edited['records'][0]['status'] = 'fail'; mutations.append(edited)
        edited = json.loads(json.dumps(after)); edited['policy'] = 'new'; mutations.append(edited)
        edited = json.loads(json.dumps(after)); edited['records'][0:2] = reversed(edited['records'][0:2]); mutations.append(edited)
        edited = json.loads(json.dumps(after)); edited['records'].pop(0); mutations.append(edited)
        edited = json.loads(json.dumps(after)); edited['records'].append(edited['records'][-1]); mutations.append(edited)
        edited = json.loads(json.dumps(after)); edited['records'][-1]['datasetId'] = 'unreviewed'; mutations.append(edited)
        for document in mutations:
            with self.subTest(document=document):
                with self.assertRaises(AssertionError):
                    self.check(fixture.LEDGER, before, document)

    def test_an_undeclared_or_out_of_scope_addition_is_not_projected(self):
        before, after = fixture.ledger(), fixture.ledger(b='pass', **{self.added: 'pass'})
        with self.assertRaisesRegex(AssertionError, 'record count changed'):
            self.check('data/internal-qc/advancement-2026-09-05/normalization-evidence.json', before, after)
        (self.repo.root / historical_evidence.ADDITIVE_INTAKE).unlink()
        self.repo.write(fixture.LEDGER, fixture.dumps(after))
        with self.assertRaisesRegex(AssertionError, 'record count changed'):
            historical_evidence.superseded_ledger(self.repo.root, fixture.LEDGER, self.repo.manifest_sha)
        with self.assertRaisesRegex(AssertionError, 'Unreviewed additive ledger identities'):
            historical_evidence.check_ledger_transition(fixture.LEDGER, before, after, {'b'}, set(), additive_ids={'arbitrary'})

    def test_validation_scope_grows_by_exactly_the_added_rows(self):
        path = 'data/author-validation/validation-records.generated.json'
        before = {'schemaVersion': 2, 'scope': {'registryDatasets': 2, 'inScopeDatasets': 1, 'unit': 'dataset x registered contrast'},
                  'records': [{'datasetId': 'a'}, {'datasetId': 'b'}]}
        after = {**before, 'scope': {**before['scope'], 'registryDatasets': 3, 'inScopeDatasets': 2},
                 'records': before['records'] + [{'datasetId': self.added}]}
        self.check(path, before, after)
        for scope in [{**after['scope'], 'registryDatasets': 4}, {**after['scope'], 'unit': 'different'}, before['scope']]:
            with self.assertRaisesRegex(AssertionError, 'Additive validation scope changed'):
                self.check(path, before, {**after, 'scope': scope})

    def test_mechanical_counts_follow_actual_added_comparisons(self):
        path = 'data/author-validation/mechanical-audit.generated.json'
        before = {'schemaVersion': 2, 'datasetCount': 1, 'contrastCount': 1,
                  'datasets': [{'datasetId': 'a', 'contrasts': [{'contrastId': 'old'}]}]}
        after = {**before, 'datasetCount': 2, 'contrastCount': 3,
                 'datasets': before['datasets'] + [{'datasetId': self.added, 'contrasts': [{'contrastId': 'x'}, {'contrastId': 'y'}]}]}
        self.check(path, before, after)
        for changed in [{**after, 'datasetCount': 3}, {**after, 'contrastCount': 2}]:
            with self.assertRaisesRegex(AssertionError, 'Additive mechanical'):
                self.check(path, before, changed)


class JobManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.manifest = self.root / JOBS_MANIFEST
        self.manifest.parent.mkdir(parents=True)
        self.sealed = self.jobs(SEALED_JOBS_ROOT)
        self.seal = hashlib.sha256(self.sealed).hexdigest()

    @staticmethod
    def jobs(root, label='Case – control'):
        job = {field: str(root / 'geo_replication/datasets/GSE000001' / f'{field}.tsv') for field in JOB_PATH_FIELDS}
        job.update(analysisId='GSE000001', contrast=dict(id='case_vs_control', label=label))
        return (json.dumps(dict(jobs=[job]), sort_keys=True, indent=2, allow_nan=False) + '\n').encode('utf8')

    def test_manifest_written_here_pins_sealed_bytes_and_reads_local_jobs(self):
        written = self.jobs(self.root)
        self.manifest.write_bytes(written)
        other = self.root / 'source.tsv'
        other.write_bytes(b'authentic source bytes\n')
        with project_jobs_manifest(self.root, self.seal):
            self.assertEqual(self.manifest.read_bytes(), self.sealed)
            self.assertEqual(self.manifest.read_text('utf8'), written.decode('utf8'))
            self.assertEqual(other.read_bytes(), b'authentic source bytes\n')
        self.assertEqual(self.manifest.read_bytes(), written)

    def test_manifest_copied_from_sealed_checkout_reads_local_jobs(self):
        self.manifest.write_bytes(self.sealed)
        with project_jobs_manifest(self.root, self.seal):
            self.assertEqual(self.manifest.read_bytes(), self.sealed)
            self.assertEqual(self.manifest.read_text('utf8'), self.jobs(self.root).decode('utf8'))

    def test_changed_job_is_rejected(self):
        self.manifest.write_bytes(self.jobs(self.root, label='Substituted contrast'))
        with self.assertRaisesRegex(AssertionError, 'Historical job manifest changed'):
            with project_jobs_manifest(self.root, self.seal):
                self.fail('Changed job accepted')

    def test_job_from_another_checkout_is_rejected(self):
        self.manifest.write_bytes(self.jobs(self.root.parent / 'another-checkout'))
        with self.assertRaisesRegex(AssertionError, 'outside the checkout'):
            with project_jobs_manifest(self.root, self.seal):
                self.fail('Foreign job paths accepted')

    def test_change_during_check_is_rejected(self):
        self.manifest.write_bytes(self.sealed)
        with project_jobs_manifest(self.root, self.seal):
            self.manifest.write_bytes(self.jobs(self.root))
            with self.assertRaisesRegex(AssertionError, 'Job manifest changed during'):
                self.manifest.read_bytes()


class ReplayLogTests(unittest.TestCase):
    def test_only_locale_setting_startup_warnings_are_removed(self):
        self.assertEqual(without_locale_warnings(b'result\r\n' + LOCALE_BLOCK + b'mapping note\r\n'),
                         b'result\r\nmapping note\r\n')
        self.assertEqual(without_locale_warnings(b'During startup - Warning message:\nSetting LC_TIME=C.UTF-8 failed \nx\n'), b'x\n')
        mixed = without_locale_warnings(LOCALE_BLOCK + b'3: package built under R version 4.6.1\r\n')
        self.assertIn(b'package built under R version 4.6.1', mixed)
        other = b'During startup - Warning message:\r\npackage built under R version 4.6.1\r\n'
        self.assertEqual(without_locale_warnings(other), other)

    def test_both_sides_of_the_replay_log_comparison_are_projected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            log = root / REPLAY_LOG
            log.parent.mkdir(parents=True)
            log.write_bytes(b'numeric match\r\n' + LOCALE_BLOCK + b'mapping note\r\n')
            other = root / 'other.log'
            other.write_bytes(LOCALE_BLOCK)
            emit = [sys.executable, '-c', 'import sys; sys.stderr.buffer.write(sys.argv[1].encode())',
                    'During startup - Warning message:\nSetting LC_CTYPE=C.UTF-8 failed \nmapping note\n']
            with project_replay_log(root):
                self.assertEqual(log.read_bytes(), b'numeric match\r\nmapping note\r\n')
                self.assertEqual(other.read_bytes(), LOCALE_BLOCK)
                self.assertEqual(subprocess.run(emit, capture_output=True).stderr, b'mapping note\n')
            self.assertEqual(log.read_bytes(), b'numeric match\r\n' + LOCALE_BLOCK + b'mapping note\r\n')
            self.assertIn(b'LC_CTYPE', subprocess.run(emit, capture_output=True).stderr)


class SupersededProjectionTests(unittest.TestCase):
    """Sealed producers read outputs and ledgers the R 4.6.0 regeneration replaced."""

    def setUp(self):
        self.repo = SupersessionRepo()
        self.addCleanup(self.repo.cleanup)
        self.output = self.repo.root / fixture.OUTPUT
        self.ledger = self.repo.root / fixture.LEDGER
        self.other = self.repo.root / fixture.OTHER
        self.crlf = fixture.OLD.replace(b'\n', b'\r\n')  # the fixture's pin form

    def test_every_read_path_receives_the_verified_old_bytes(self):
        current_ledger = self.ledger.read_bytes()
        with project_superseded(self.repo.root, self.repo.manifest_sha):
            self.assertEqual(self.output.read_bytes(), self.crlf)
            with self.output.open('rb') as stream:
                self.assertEqual(stream.read(), self.crlf)
            with open(str(self.output), 'rb') as stream:
                self.assertEqual(stream.read(), self.crlf)
            with open(self.output, encoding='utf8', newline='') as stream:
                self.assertEqual(stream.read(), self.crlf.decode('utf8'))
            self.assertEqual(self.output.read_text('utf8'), fixture.OLD.decode('utf8'))
            self.assertEqual(self.output.stat().st_size, len(self.crlf))
            self.assertEqual(self.ledger.read_bytes(), self.repo.before)
            self.assertEqual(self.other.read_bytes(), b'gene\tlogFC\nC\t2\n')
            with open(self.repo.root / 'written.txt', 'w', encoding='utf8') as stream:
                stream.write('writes are not projected')
        self.assertEqual(self.output.read_bytes(), fixture.NEW)
        self.assertEqual(self.ledger.read_bytes(), current_ledger)

    def test_nothing_is_served_until_the_manifest_is_pinned(self):
        with patch.object(historical_evidence, 'SUPERSESSION_SHA', None), project_superseded(self.repo.root):
            self.assertEqual(self.output.read_bytes(), fixture.NEW)

    def test_edited_manifest_is_refused(self):
        self.repo.manifest(datasetId='a')
        with self.assertRaisesRegex(AssertionError, 'Supersession manifest changed'):
            with project_superseded(self.repo.root, self.repo.manifest_sha):
                self.fail('Edited manifest accepted')

    def test_regenerated_output_changed_again_is_refused(self):
        self.output.write_bytes(fixture.NEW + b'C\t1\n')
        with project_superseded(self.repo.root, self.repo.manifest_sha):
            with self.assertRaisesRegex(AssertionError, 'not the recorded R 4.6.0 regeneration'):
                self.output.read_bytes()

    def test_ledger_changed_outside_the_regeneration_is_refused(self):
        self.ledger.write_bytes(fixture.dumps(fixture.ledger(b='pass', c='fail')))
        with project_superseded(self.repo.root, self.repo.manifest_sha):
            with self.assertRaisesRegex(AssertionError, 'dataset outside the regeneration'):
                self.ledger.read_bytes()

    def test_change_during_check_is_rejected(self):
        with project_superseded(self.repo.root, self.repo.manifest_sha):
            self.assertEqual(self.output.read_bytes(), self.crlf)
            self.output.write_bytes(fixture.NEW + b'changed\n')
            with self.assertRaisesRegex(AssertionError, 'changed during historical check'):
                self.output.read_bytes()

    def jobs_manifest(self):
        job = {field: str(self.repo.root / f'geo_replication/datasets/GSE000001_mmus_test/{field}.tsv') for field in JOB_PATH_FIELDS}
        job.update(de=str(self.output), se=str(self.other), analysisId='GSE000001')
        path = self.repo.root / 'data/internal-qc/intake-numeric-2026-09-11/jobs-0.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(json.dumps({'jobs': [job]}, indent=2).encode('utf8'))
        return path, job

    # A child that opens the paths of its job manifest itself, as replay.R does.
    CHILD = ('import json,sys;job=json.load(open(sys.argv[1],encoding="utf8"))["jobs"][0];'
             'print(json.dumps({k:(open(v,"rb").read().hex() if k in ("de","se") else v) for k,v in job.items()}))')

    def test_child_processes_read_superseded_job_paths_as_verified_copies(self):
        manifest, job = self.jobs_manifest()
        written = manifest.read_bytes()
        with project_child_processes(self.repo.root, self.repo.manifest_sha):
            result = subprocess.run([sys.executable, '-c', self.CHILD, str(manifest)], capture_output=True, check=True)
            served = json.loads(result.stdout)
            # Only the superseded path is swapped, for a copy of its pinned bytes.
            self.assertEqual(bytes.fromhex(served['de']), self.crlf)
            served.pop('de')
            self.assertEqual(bytes.fromhex(served.pop('se')), b'gene\tlogFC\nC\t2\n')
            self.assertEqual(served, {k: v for k, v in job.items() if k not in ('de', 'se')})
            # Arguments that are not job manifests pass unchanged.
            echo = subprocess.run([sys.executable, '-c', 'import sys;print(sys.argv[1])', str(self.output)], capture_output=True, check=True, text=True)
            self.assertEqual(echo.stdout.strip(), str(self.output))
        self.assertEqual(manifest.read_bytes(), written, 'the manifest the producer wrote stays as written')
        self.output.write_bytes(fixture.NEW + b'C\t1\n')
        with project_child_processes(self.repo.root, self.repo.manifest_sha):
            with self.assertRaisesRegex(AssertionError, 'not the recorded R 4.6.0 regeneration'):
                subprocess.run([sys.executable, '-c', self.CHILD, str(manifest)], capture_output=True)

    def test_served_job_manifest_differs_only_in_superseded_paths(self):
        _, job = self.jobs_manifest()
        targets = {os.path.normcase(os.path.abspath(self.output)): fixture.OUTPUT}
        served = served_jobs_manifest({'jobs': [job]}, targets, lambda name: '/tmp/copy/GSE000001_DE.tsv')
        self.assertEqual(served['jobs'][0], {**job, 'de': '/tmp/copy/GSE000001_DE.tsv'})
        self.assertIsNone(served_jobs_manifest({'jobs': [{**job, 'de': str(self.other)}]}, targets, lambda name: 'unused'))
        # A copy callback that does not return the same copy for a path is refused.
        calls = iter(['/tmp/a', '/tmp/b'])
        with self.assertRaisesRegex(AssertionError, 'changed more than superseded paths'):
            served_jobs_manifest({'jobs': [job]}, targets, lambda name: next(calls))

    def test_allow_listed_child_scripts_run_through_this_runner(self):
        child = 'data/internal-qc/intake-numeric-2026-09-11/source_replay.py'
        seen = []
        with patch.object(subprocess, 'run', lambda args, *rest, **kwargs: seen.append(args)):
            with patch.dict(CHILD_SCRIPTS, {child: 'fixture'}), project_child_processes(self.repo.root, self.repo.manifest_sha):
                subprocess.run([sys.executable, '-X', 'utf8', str(self.repo.root / child), '--output', 'x.json'])
                subprocess.run([sys.executable, str(self.repo.root / 'other.py')])
        runner = str(Path(run_historical_check.__file__).resolve())
        self.assertEqual(seen[0], [sys.executable, '-X', 'utf8', runner, '--superseded-child', child, '--output', 'x.json'])
        self.assertEqual(seen[1], [sys.executable, str(self.repo.root / 'other.py')])
        with self.assertRaisesRegex(AssertionError, 'outside the historical compatibility scope'):
            main(['--superseded-child', 'scripts/other.py'])
        self.assertEqual(hashlib.sha256((ROOT / child).read_bytes()).hexdigest(), CHILD_SCRIPTS[child])

    def test_every_sealed_producer_receives_the_projection(self):
        self.assertTrue(all(project_superseded in projections for _, projections in PRODUCERS.values()))

    def test_python_producers_spawned_by_sealed_typescript_checks_are_pinned_here(self):
        # scripts/run_sealed_ts_check.mts routes `<python> <producer> --check` of SEALED_CHILDREN through this runner.
        source = (ROOT / 'scripts/run_sealed_ts_check.mts').read_text(encoding='utf8')
        block = re.search(r'export const SEALED_CHILDREN: Record<string, string> = \{(.*?)\n\};', source, re.S)
        children = dict(re.findall(r"'([^']+)': '([^']+)'", block.group(1)))
        self.assertTrue(children)
        for producer, runner in children.items():
            self.assertEqual(runner, 'scripts/run_historical_check.py')
            self.assertIn(producer, PRODUCERS)
            expected, projections = PRODUCERS[producer]
            self.assertEqual(hashlib.sha256((ROOT / producer).read_bytes()).hexdigest(), expected, producer)
            self.assertIn(project_superseded, projections)


if __name__ == '__main__':
    unittest.main()
