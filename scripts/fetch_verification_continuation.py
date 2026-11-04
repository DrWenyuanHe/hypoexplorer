"""Fetch named public primary sources, retaining exact bytes and retrieval outcomes."""
from pathlib import Path
import concurrent.futures
import hashlib
import json
import urllib.request
import zipfile
import io
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/author-validation/continued-sources/continuation-2026-09-05'
TARGETS = [
    ('GSE198437', 'Table1.xlsx', 'https://pmc-oa-opendata.s3.amazonaws.com/PMC9244633.1/Table1.xlsx', 'xlsx'),
    ('GSE128660', 'fj.201901045R.sd1.xlsx', 'https://pmc-oa-opendata.s3.amazonaws.com/PMC6902726.1/fj.201901045R.sd1.xlsx', 'xlsx'),
    ('GSE227689_GSE212336', 'PMC10528304.xml', 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC10528304/fullTextXML', 'xml'),
    ('GSE254155', 'PMC13035106.xml', 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC13035106/fullTextXML', 'xml'),
    ('GSE205313', 'github-repo.json', 'https://api.github.com/repos/viktormiok/AstrocytesHeterogenityARC', 'json'),
    ('GSE204883', 'zenodo-record.json', 'https://zenodo.org/api/records/10285435', 'json'),
    ('GSE204883', 'article.pdf', 'https://munin.uit.no/bitstream/10037/35128/2/article.pdf', 'pdf'),
]


def fetch(item):
    accession, name, url, kind = item
    folder = OUT / accession
    folder.mkdir(parents=True, exist_ok=True)
    file = folder / Path(name).name
    result = {'accession': accession, 'sourceUrl': url, 'path': file.relative_to(ROOT).as_posix()}
    try:
        if not file.exists():
            req = urllib.request.Request(url, headers={'User-Agent': 'HypoExplorer scientific source verification; public download'})
            with urllib.request.urlopen(req, timeout=40) as response:
                data = response.read(60_000_001)
            if len(data) > 60_000_000:
                raise ValueError('Source exceeds the 60 MB retrieval bound')
            if kind in {'xlsx', 'zip'} and not zipfile.is_zipfile(io.BytesIO(data)):
                raise ValueError('Expected ZIP container, received other content')
            if kind == 'pdf' and not data.startswith(b'%PDF'):
                raise ValueError('Expected PDF, received other content')
            if kind == 'json':
                json.loads(data)
            if kind == 'xml':
                import xml.etree.ElementTree as ET
                if ET.fromstring(data).tag != 'article':
                    raise ValueError('Expected article XML')
            file.write_bytes(data)
        data = file.read_bytes()
        result.update(status='retrieved', sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
    except Exception as error:
        result.update(status='retrieval_failed', error=str(error))
    return result


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    targets = TARGETS
    if len(sys.argv) == 2:
        targets = json.loads(Path(sys.argv[1]).read_text(encoding='utf8'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(fetch, targets))
    log = OUT / 'retrieval-log.json'
    history = json.loads(log.read_text(encoding='utf8')) if log.exists() else []
    history.extend(results)
    log.write_text(json.dumps(history, indent=2) + '\n', encoding='utf8')
    for result in results:
        print(json.dumps(result), flush=True)
