"""Inventory and retrieve the assigned public sources without changing scientific outputs."""
from pathlib import Path
import concurrent.futures
import hashlib
import json
import sys
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/author-validation/continued-sources/advancement-sources-b-2026-09-05'
ASSIGN = json.loads((ROOT / 'data/quality/advancement-2026-09-05/assignments.json').read_text(encoding='utf8'))['sourceB']
BASE = json.loads((ROOT / 'data/quality/advancement-2026-09-05/baseline.json').read_text(encoding='utf8'))['validation']['records']


def inspect(record):
    accession = record['accession']
    folder = OUT / accession
    folder.mkdir(parents=True, exist_ok=True)
    pmc = record.get('pmcId')
    result = {'datasetId': record['datasetId'], 'accession': accession,
              'priorAvailability': record['verification']['resultAvailability'],
              'priorFinding': record['note'], 'priorNextStep': record['verification']['nextStep'],
              'linksReviewed': record['evidenceLinks'], 'paper': None}
    if not pmc:
        result['paper'] = {'status': 'no_pmc_identifier', 'note': 'Requires linked publisher/publication search, not evidence of absence.'}
        return result
    url = f'https://www.ebi.ac.uk/europepmc/webservices/rest/{pmc}/fullTextXML'
    file = folder / f'{pmc}.xml'
    result['paper'] = {'url': url}
    try:
        if '--fetch' in sys.argv and not file.exists():
            with urllib.request.urlopen(url, timeout=30) as response:
                data = response.read()
            article = ET.fromstring(data)
            if article.tag != 'article':
                raise ValueError(f'Expected article XML, received {article.tag}')
            file.write_bytes(data)
        if not file.exists():
            result['paper']['status'] = 'not_retrieved_this_pass'
            return result
        data = file.read_bytes()
        article = ET.fromstring(data)
        links = []
        for element in article.iter():
            href = element.get('{http://www.w3.org/1999/xlink}href')
            if href:
                links.append({'element': element.tag, 'href': href,
                              'label': ' '.join(''.join(element.itertext()).split())[:500]})
        result['paper'].update(status='retrieved', path=file.relative_to(ROOT).as_posix(),
                               sha256=hashlib.sha256(data).hexdigest(), links=links)
        sections = []
        for sec in article.iter('sec'):
            title = sec.findtext('title', '')
            if any(word in title.lower() for word in ['rna', 'data avail', 'bioinform', 'statistical', 'sequenc']):
                sections.append({'title': title, 'text': ' '.join(''.join(sec.itertext()).split())})
        (folder / 'method-sections.json').write_text(json.dumps(sections, indent=2) + '\n', encoding='utf8')
    except Exception as error:
        result['paper'].update(status='retrieval_failed', error=str(error))
    return result


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    records = [record for record in BASE if record['datasetId'] in ASSIGN]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(inspect, records))
    results.sort(key=lambda row: row['datasetId'])
    (OUT / 'source-inventory.json').write_text(json.dumps({'date': '2026-09-05', 'records': results}, indent=2) + '\n', encoding='utf8')
    from collections import Counter
    print(json.dumps(dict(Counter(row['paper']['status'] for row in results))))
