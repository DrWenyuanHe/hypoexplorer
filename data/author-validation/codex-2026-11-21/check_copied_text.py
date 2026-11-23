"""Find publication text copied into this pass's evidence records.

usage: python -I check_copied_text.py <unpacked release part> [--write]

For each accession folder, extracts text from every downloaded source (XML, HTML, PDF via
pdftotext, DOCX/XLSX/PPTX, plain text and API responses) and finds runs of at least 12
consecutive normalized words that a redistributed file shares with them. Runs are classed as
prose (many function words), table content (mostly numbers) or identifiers (URLs, query strings,
hashes). A file other than SOURCES.tsv and SEARCH_LOG.md, the folder's source index, with a
prose or table run of 40 or more words is listed in copied-text.json; build_release_bundle.mts
withholds those files as derived records. --write updates copied-text.json.
"""
import html, json, re, subprocess, sys, zipfile
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SOURCES = ROOT / 'data/author-validation/continued-sources'
PART = Path(sys.argv[1])
N, LIMIT = 12, 40
INDEX = {'SOURCES.tsv', 'SEARCH_LOG.md'}
TEXT_EXT = {'.xml', '.html', '.htm', '.txt', '.md', '.json', '.nxml', '.csv', '.tsv'}
WORD = re.compile(r"[a-z0-9]+(?:['’][a-z]+)?")
STOP = set('the of and in to a with for was were is are by from on at as that this be or an not which after '
           'than between into using we our their its these those both each but also had has have been during per all'.split())
URLISH = re.compile(r'\b(https?|www|com|org|gov|doi|pdf|xlsx|zip|html|ftp|ncbi|nlm|nih|geo|suppl|gse\d*|gsm\d*|download|static|content|media|esm)\b')


def words(text):
    return WORD.findall(text.lower())


def source_text(p):
    ext = p.suffix.lower()
    try:
        if p.stat().st_size > 60_000_000:
            return ''
        if ext == '.pdf':
            return subprocess.run(['pdftotext', '-q', '-enc', 'UTF-8', str(p), '-'], capture_output=True, timeout=120).stdout.decode('utf8', 'replace')
        if ext in ('.docx', '.pptx', '.xlsx'):
            with zipfile.ZipFile(p) as z:
                names = [n for n in z.namelist() if n.endswith('.xml') and ('word/' in n or 'ppt/slides/' in n or 'sharedStrings' in n)]
                return html.unescape(re.sub(r'<[^>]+>', ' ', ' '.join(z.read(n).decode('utf8', 'replace') for n in names)))
        if ext in TEXT_EXT or ext == '' or p.name.endswith('.response'):
            raw = p.read_bytes()
            if b'\0' in raw[:4096]:
                return ''
            text = raw.decode('utf8', 'replace')
            if ext in ('.xml', '.html', '.htm', '.nxml') or text.lstrip().startswith('<'):
                text = html.unescape(re.sub(r'<[^>]+>', ' ', re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', text)))
            return text
    except Exception:
        return ''
    return ''


def kind(text):
    w = text.split()
    stop = sum(t in STOP for t in w) / len(w)
    num = sum(t.isdigit() for t in w) / len(w)
    if len(URLISH.findall(text)) / len(w) >= 0.12 or re.search(r'\b[0-9a-f]{20,}\b', text):
        return 'identifier'
    if num >= 0.3:
        return 'table'
    if stop >= 0.12:
        return 'prose'
    return 'identifier' if num < 0.1 and stop < 0.05 else 'table'


def runs_in(w, shingles):
    i, out = 0, []
    while i <= len(w) - N:
        if hash(' '.join(w[i:i + N])) in shingles:
            j = i
            while j + 1 <= len(w) - N and hash(' '.join(w[j + 1:j + 1 + N])) in shingles:
                j += 1
            out.append(' '.join(w[i:j + N]))
            i = j + N
        else:
            i += 1
    return out


listed, summary = [], Counter()
part_sources = PART / 'data/author-validation/continued-sources'
for acc in sorted(part_sources.iterdir()):
    shipped_dir, local_dir = acc / 'codex-2026-11-21', SOURCES / acc.name / 'codex-2026-11-21'
    # Compare only against third-party downloads (SOURCES.tsv rows with a URL), never the
    # pass's own records, so withholding a record cannot flag the files it was built from.
    downloads = []
    index = local_dir / 'SOURCES.tsv'
    for row in (index.read_text('utf8', 'replace').splitlines()[1:] if index.exists() else []):
        cols = row.split('\t')
        if len(cols) > 1 and re.match(r'https?://', cols[1].strip()):
            p = Path(cols[0])
            downloads.append(ROOT / p if cols[0].startswith('data/') else local_dir / p)
    shingles = set()
    for f in downloads:
        if f.is_file():
            w = words(source_text(f))
            shingles.update(hash(' '.join(w[i:i + N])) for i in range(len(w) - N + 1))
    for f in sorted(shipped_dir.rglob('*')):
        if not f.is_file():
            continue
        for run in runs_in(words(f.read_text('utf8', 'replace')), shingles):
            summary[kind(run)] += 1
        if f.name in INDEX:
            continue
        worst = max(((len(r.split()), kind(r)) for r in runs_in(words(f.read_text('utf8', 'replace')), shingles)
                     if kind(r) != 'identifier'), default=(0, ''))
        if worst[0] >= LIMIT:
            listed.append({'path': str(f.relative_to(PART)).replace('\\', '/'), 'longestCopiedRun': worst[0], 'kind': worst[1]})

print(f'shared runs by kind: {dict(summary)}; files over the {LIMIT}-word limit: {len(listed)}')
for e in listed:
    print(f"  {e['longestCopiedRun']:4d} {e['kind']:5s} {e['path']}")
if '--write' in sys.argv:
    (HERE / 'copied-text.json').write_text(json.dumps({'limitWords': LIMIT, 'shingleWords': N, 'files': listed}, indent=1) + '\n', encoding='utf8')
