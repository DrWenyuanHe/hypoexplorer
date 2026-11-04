"""Retain the complete published GSE198437 selected universe before any local join."""
from pathlib import Path
import hashlib
import json
import math
import sys

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/author-validation/continued-sources/continuation-2026-09-05'
SOURCE = OUT / 'GSE198437/Table1.xlsx'
SOURCE_HASH = '8da225dc9b7befd46bc9d775e7e950f494a7bb969c9d84be33c6e395f850061e'
URL = 'https://pmc-oa-opendata.s3.amazonaws.com/PMC9244633.1/Table1.xlsx'
LOCAL = 'geo_replication/archive/GSE198437_mmus_hypothalamus_rnaseq/processed/GSE198437_DE.tsv'
CHECK = '--check' in sys.argv


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pin(path, url):
    return {'path': path.relative_to(ROOT).as_posix(), 'sourceUrl': url,
            'sha256': digest(path), 'bytes': path.stat().st_size}


def output(path, text):
    if CHECK:
        if not path.exists() or path.read_text(encoding='utf8') != text:
            raise ValueError(f'Stale continuation extraction: {path}')
    else:
        path.write_text(text, encoding='utf8', newline='')


def main():
    if digest(SOURCE) != SOURCE_HASH:
        raise ValueError('Original GSE198437 workbook checksum mismatch')
    workbook = openpyxl.load_workbook(SOURCE, read_only=True, data_only=True)
    expected_sheets = ['Dwn-Up-Dwn_FC1.5_FDR0.01_edgeRY', 'Up-Dwn-Up_FC1.5_FDR0.01_edgeRYu']
    if workbook.sheetnames != expected_sheets:
        raise ValueError('Unexpected author sheets')
    expected_header = ('SYMBOL', 'GENENAME', 'Geneid', 'CTRL-0', 'HFD-0', 'HFDMIN-0', 'FDR', 'AveExpr', 'P value')
    lines = ['output_id\tsymbol\tpublished_hfd_minus_ctrl\tctrl_coefficient\thfd_coefficient\thfdmino_coefficient\tsheet\tsource_row']
    seen = set()
    sheet_rows = {}
    for sheet in workbook:
        values = iter(sheet.values)
        if next(values) != expected_header:
            raise ValueError('Unexpected author columns')
        n = 0
        for row_number, row in enumerate(values, start=2):
            symbol, _, gene, ctrl, hfd, mino, *_ = row
            if not isinstance(gene, int) or isinstance(gene, bool) or gene <= 0:
                raise ValueError(f'Invalid author Geneid at {sheet.title}:{row_number}')
            if str(gene) in seen:
                raise ValueError(f'Duplicate author Geneid: {gene}')
            seen.add(str(gene))
            if any(not isinstance(x, (float, int)) or isinstance(x, bool) or not math.isfinite(x) for x in [ctrl, hfd, mino]):
                raise ValueError('Invalid published coefficient')
            if abs(ctrl + hfd + mino) > 1e-8:
                raise ValueError('Published group coefficients are not centered')
            # Preserve the source subtraction. Do not infer a pairwise FDR from the omnibus columns.
            safe_symbol = str(symbol).replace('\t', '\\t').replace('\r', '\\r').replace('\n', '\\n')
            lines.append('\t'.join([str(gene), safe_symbol, repr(hfd - ctrl), repr(ctrl), repr(hfd), repr(mino), sheet.title, str(row_number)]))
            n += 1
        sheet_rows[sheet.title] = n
    if len(seen) != 1796:
        raise ValueError('Published selected universe changed')
    author = OUT / 'GSE198437/author-effects.tsv'
    output(author, '\n'.join(lines) + '\n')
    paper = ROOT / 'data/author-validation/continued-sources/advancement-sources-b-2026-09-05/GSE198437/PMC9244633.xml'
    references = [pin(SOURCE, URL), pin(paper, 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC9244633/fullTextXML'),
                  pin(Path(__file__).resolve(), 'Reproducible extraction of all published selected rows; no local-result filtering')]
    spec = {
        'datasetId': 'mouse_pvn_hfd_gse198437', 'accession': 'GSE198437', 'contrast': 'hfd_vs_chow',
        'localPath': LOCAL, 'localKey': 'id', 'authorPath': author.relative_to(ROOT).as_posix(),
        'sourceUrl': URL, 'sha256': digest(author), 'format': 'tsv',
        'authorKey': 'output_id', 'authorEffect': 'published_hfd_minus_ctrl', 'orientationSign': 1,
        'localMethod': 'edgeR-QL', 'authorMethod': 'Published centered group coefficients; edgeR methods; trajectory-selected table',
        'orientation': 'Published HFD-0 minus CTRL-0. Same original integer Geneid; no symbol remapping.',
        'note': 'All 1,796 published trajectory-selected genes are retained before joining. The compared quantity is explicitly HFD-0 minus CTRL-0 from the published centered group columns. Its interpretation as a log2 fold-change is consistent with the reported edgeR analysis, but the workbook does not explicitly state the coefficient units. This unresolved effect-definition detail remains a review gate; high numerical similarity alone does not resolve it. Author omnibus P/FDR are omitted from pairwise inference.',
        'interpretation': 'effects_compared', 'originalReferences': references,
        'normalizationScript': 'scripts/prepare_author_continuation.py', 'resultScope': 'selected_results',
    }
    output(OUT / 'comparison-specs.json', json.dumps({'schemaVersion': 1, 'comparisons': [spec]}, indent=2) + '\n')
    output(OUT / 'GSE198437/extraction-manifest.json', json.dumps({
        'schemaVersion': 1, 'source': references[0], 'script': references[-1],
        'publishedRows': len(seen), 'sheetRows': sheet_rows, 'normalized': pin(author, URL),
        'join': 'Original integer Geneid; complete author universe retained independently of current local DE.',
        'effect': 'HFD-0 minus CTRL-0; units require author definition confirmation.',
        'inference': 'No pairwise author adjusted P values; original omnibus columns are not paired-negative calls.',
    }, indent=2) + '\n')
    print(f'{"Checked" if CHECK else "Prepared"} GSE198437: {len(seen)} original selected genes')


if __name__ == '__main__':
    main()
