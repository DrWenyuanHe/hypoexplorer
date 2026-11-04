"""Retrieve bounded public supplements discovered in retained primary-source XML."""
from pathlib import Path
import concurrent.futures
import hashlib
import io
import json
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/author-validation/continued-sources/advancement-sources-b-2026-09-05'
TARGETS = {
    'GSE198437': 'PMC9244633', 'GSE190712': 'PMC9755029',
    'GSE273038': 'PMC12519563', 'GSE329539': 'PMC13025380',
    'GSE123983': 'PMC6437596', 'GSE102471': 'PMC7819995',
}


def fetch(item):
    accession, pmc = item
    folder = OUT / accession
    folder.mkdir(parents=True, exist_ok=True)
    url = f'https://www.ebi.ac.uk/europepmc/webservices/rest/{pmc}/supplementaryFiles'
    archive = folder / 'supplementaryFiles.zip'
    result = {'accession': accession, 'sourceUrl': url, 'date': '2026-09-05'}
    try:
        if not archive.exists():
            with urllib.request.urlopen(url, timeout=45) as response:
                data = response.read(75_000_001)
            if len(data) > 75_000_000:
                raise ValueError('Public archive exceeds this pass\'s 75 MB retrieval bound')
            if not zipfile.is_zipfile(io.BytesIO(data)):
                raise ValueError('Response is not a ZIP archive')
            archive.write_bytes(data)
        result.update(status='retrieved', sha256=hashlib.sha256(archive.read_bytes()).hexdigest(), files=[])
        with zipfile.ZipFile(archive) as z:
            result['archiveEntries'] = z.namelist()
            for info in z.infolist():
                name = Path(info.filename).name
                if info.file_size > 40_000_000 or Path(name).suffix.lower() not in {'.xlsx', '.xls', '.csv', '.tsv', '.zip'}:
                    continue
                path = folder / name
                data = z.read(info)
                path.write_bytes(data)
                result['files'].append({'path': path.relative_to(ROOT).as_posix(), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    except Exception as error:
        result.update(status='retrieval_failed', error=str(error))
    (folder / 'supplement-retrieval.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf8')
    return {k: result[k] for k in ['accession', 'status']} | {'files': len(result.get('files', []))}


if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for result in pool.map(fetch, TARGETS.items()):
            print(json.dumps(result), flush=True)
