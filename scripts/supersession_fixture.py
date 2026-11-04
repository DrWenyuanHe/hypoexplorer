"""A temporary git repository holding one R 4.6.0 supersession, for the sealed-check tests."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

from historical_evidence import ARCHIVES, SUPERSESSION_DIR, SUPERSESSION_MANIFEST, close_supersessions

OUTPUT = 'geo_replication/datasets/GSE000001_mmus_test/processed/GSE000001_DE.tsv'
OTHER = 'geo_replication/datasets/GSE000002_mmus_other/processed/GSE000002_DE.tsv'
LEDGER = 'data/quality/assessments.generated.json'
OLD = b'gene\tlogFC\nA\t1.25\nB\t-0.5\n'
NEW = b'gene\tlogFC\nA\t1.2501\nB\t-0.4999\n'
SCOPE_ID = 'b'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def dumps(value) -> bytes:
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf8')


def ledger(**changes) -> dict:
    statuses = {'a': 'pass', 'b': 'review', 'c': 'pass', 'hfd': 'pass', **changes}
    return {'schemaVersion': 2, 'policy': 'unchanged', 'records': [{'datasetId': i, 'status': s} for i, s in statuses.items()]}


class SupersessionRepo:
    """Commit the pre-swap outputs, then the regeneration and a finalized manifest."""

    def __init__(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.git('init', '-q')
        for name, value in (('core.autocrlf', 'false'), ('user.name', 'fixture'), ('user.email', 'fixture@example.invalid')):
            self.git('config', name, value)
        self.write(OUTPUT, OLD)
        self.write(OTHER, b'gene\tlogFC\nC\t2\n')
        self.before = dumps(ledger())
        self.write(LEDGER, self.before)
        self.write(f'{ARCHIVES}/manifest.json', dumps({'records': []}))  # no HFD archives
        self.git('add', '-A')
        self.git('commit', '-q', '-m', 'pre-swap')
        self.commit = self.git('rev-parse', 'HEAD').strip()
        self.old_blob = self.git('rev-parse', f'HEAD:{OUTPUT}').strip()
        self.other_blob = self.git('rev-parse', f'HEAD:{OTHER}').strip()
        self.write(OUTPUT, NEW)
        self.write(LEDGER, dumps(ledger(b='pass')))
        archive = f'{SUPERSESSION_DIR}/preserved-inputs/{sha(self.before)}.json.gz'
        self.write(archive, gzip.compress(self.before, mtime=0))
        self.record = {'path': OUTPUT, 'datasetId': SCOPE_ID, 'oldSha256': sha(OLD), 'oldBytes': len(OLD),
                       'oldGitBlob': self.old_blob, 'oldPinForm': 'crlf', 'pinnedBy': ['evidence.json'],
                       'newSha256': sha(NEW), 'newBytes': len(NEW)}
        self.ledger_row = {'path': LEDGER, 'sha256': sha(self.before), 'bytes': len(self.before),
                           'gitBlob': self.git('rev-parse', f'HEAD:{LEDGER}').strip(), 'pinForm': 'exact',
                           'archivePath': archive}
        self.manifest_sha = self.manifest()
        self.git('add', '-A')
        self.git('commit', '-q', '-m', 'R 4.6.0 regeneration')

    def git(self, *args: str) -> str:
        return subprocess.run(['git', '-C', str(self.root), *args], check=True, capture_output=True, text=True).stdout

    def write(self, relative: str, data: bytes) -> Path:
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return target

    def manifest(self, **record) -> str:
        body = dumps({'schemaVersion': 1, 'record': 'fixture', 'state': 'finalized', 'preSwapCommit': self.commit,
                      'tag': 'superseded/fixture', 'ledgers': [self.ledger_row], 'records': [{**self.record, **record}]})
        self.write(SUPERSESSION_MANIFEST, body)
        return sha(body)

    def cleanup(self):
        close_supersessions()
        self.temp.cleanup()
