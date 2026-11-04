"""Extract complete author-selected tables without selecting by local results."""
from pathlib import Path
import csv
import hashlib
import io
import json
import math
import sys
import xml.etree.ElementTree as ET
import zipfile

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/author-validation/continued-sources/round2-2026-09-05'
CHECK = '--check' in sys.argv
W = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def original(path, expected, url):
    path = ROOT / path
    if sha(path) != expected:
        raise ValueError(f'Changed original source: {path}')
    return path, pin(path, url)


def pin(path, url):
    return dict(path=path.relative_to(ROOT).as_posix(), sourceUrl=url,
                sha256=sha(path), bytes=path.stat().st_size)


def emit(path, text):
    if CHECK:
        if not path.exists() or path.read_text(encoding='utf8') != text:
            raise ValueError(f'Stale extraction: {path}')
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf8', newline='')


def numeric(value):
    if isinstance(value, bool) or value is None or str(value).strip() == '':
        raise ValueError('Missing or invalid author number')
    result = float(value)
    if not math.isfinite(result):
        raise ValueError('Nonfinite author number')
    return result


def require_unique(values, expected=None):
    if any(not isinstance(value, str) or not value.strip() for value in values):
        raise ValueError('Blank or invalid source identifier')
    if len(set(values)) != len(values) or (expected is not None and len(values) != expected):
        raise ValueError('Source identifier count or uniqueness changed')


def table_text(rows):
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fieldnames=list(rows[0]), delimiter='\t', lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue()


def rat():
    url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC7588867/supplementaryFiles'
    path, source = original('data/author-validation/continued-sources/GSE156859/mmc1.docx',
        '35ee817e58fd3dd03f7e2816a74f0b787fb6c3ec0316feac6b3d937b8f546c52', url)
    with zipfile.ZipFile(path) as archive:
        document = ET.fromstring(archive.read('word/document.xml'))
    tables = document.findall('.//w:tbl', W)
    rows = [[ ''.join(cell.itertext()) for cell in row.findall('w:tc', W)]
            for row in tables[4].findall('w:tr', W)]
    if rows[0] != ['Gene ID', '0.8 ppm Ozone Average', 'Air Average', 'Fold Change from Air', 'P-value']:
        raise ValueError('Female Table S5 header changed')
    require_unique([row[0] for row in rows[1:]], 168)
    extracted = []
    for row_number, (gene, ozone, air, fold, rounded_p) in enumerate(rows[1:], start=2):
        o, a, f, p = map(numeric, [ozone, air, fold, rounded_p])
        if min(o, a) <= 0 or abs(f) < 1 or not 0 <= p <= 1:
            raise ValueError('Invalid signed ratio, group mean or rounded P')
        if (o > a) != (f > 0):
            raise ValueError('Published ratio and mean direction disagree')
        # Convert a signed LINEAR ratio to log2; do not substitute a local mean-log effect.
        extracted.append(dict(output_id=gene, author_effect=math.copysign(math.log2(abs(f)), f),
            source_signed_linear_ratio=f, source_ozone_mean=o, source_air_mean=a,
            source_rounded_nominal_p=rounded_p, source_row=row_number))
    return dict(accession='GSE156859', datasetId='rat_fetal_hypo_ozone_gse156859',
        contrast='female_fetal_ozone_vs_air', rows=extracted, sources=[source],
        localPath='geo_replication/datasets/GSE156859_rnor_fetal_hypothalamus_ozone/processed/GSE156859_DE.tsv',
        localKey='symbol', localMethod='limma mean-log effect', authorMethod='Partek; signed arithmetic-mean ratios converted to log2',
        orientation='Female fetal hypothalamus: ozone minus air; sign(author ratio) times log2(abs(author ratio)).',
        note='All 168 original female Table S5 rows retained before local joining. Arithmetic-mean ratios and mean-log effects are different estimators. All author nominal P values are rounded; none is supplied as FDR. The previously documented nine nominal-call differences and estimator discrepancy remain in the scientific review.')


def fish():
    url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12376962/supplementaryFiles'
    path, source = original('data/author-validation/continued-sources/final-numerical-batch-d/JNC-169-0-s006.xlsx',
        'da25bd90c2554881da65db414ab71ccef6a200cf9e50b5665798da1ea6964c87', url)
    mapping_path, mapping_pin = original('geo_replication/datasets/GSE299412_drer_hypothalamus/metadata/GSE299412_identifier_mapping.tsv',
        '254ff0f71c5e531cb1fcfc03699bdcda30de1808f0cc44c606dcca6a9763a2d0',
        'Registered exact source-symbol-to-output mapping; not a new author identifier assignment')
    with mapping_path.open(encoding='utf8', newline='') as handle:
        mapping_rows = list(csv.DictReader(handle, delimiter='\t'))
    require_unique([row['source_symbol'] for row in mapping_rows])
    require_unique([row['output_label'] for row in mapping_rows])
    mapping = {row['source_symbol']: row['output_label'] for row in mapping_rows}
    workbook = load_workbook(path, read_only=True, data_only=True)
    if workbook.sheetnames != ['STRATEGY2.LIMMA_suptable_export']:
        raise ValueError('Author fish worksheet changed')
    values = list(workbook.active.values)
    workbook.close()
    indexes = {name: i for i, name in enumerate(values[0])}
    required = ['gene', 'Adult_Hypo_male_ko vs Adult_Hypo_male_wt', 'Adult_Hypo_male_wt', 'Adult_Hypo_male_ko']
    if any(name not in indexes for name in required):
        raise ValueError('Missing author tissue/sex/contrast columns')
    populated = [(number, row) for number, row in enumerate(values[1:], start=2)
                 if any(value is not None for value in row)]
    require_unique([row[indexes['gene']] for _, row in populated], 703)
    extracted = []
    for row_number, row in populated:
        flag = row[indexes[required[1]]]
        if flag not in ['UP', 'DOWN', '-']:
            raise ValueError('Unknown source contrast flag')
        if flag == '-':
            continue  # Selection is solely the author's male-hypothalamus contrast flag.
        symbol = row[indexes['gene']]
        if symbol not in mapping:
            raise ValueError('Author symbol missing from registered source map; retain and review explicitly')
        wt, ko = numeric(row[indexes[required[2]]]), numeric(row[indexes[required[3]]])
        if ko == wt or (ko > wt) != (flag == 'UP'):
            raise ValueError('Author rlog mean difference and direction flag disagree')
        extracted.append(dict(output_id=mapping[symbol], source_symbol=symbol, author_effect=ko-wt,
            source_direction=flag, source_wt_rlog_mean=wt, source_ko_rlog_mean=ko, source_row=row_number))
    require_unique([row['output_id'] for row in extracted], 231)
    return dict(accession='GSE299412', datasetId='zebrafish_hypo_cyp19a1b_gse299412',
        contrast='cyp19a1b_mutant_vs_wild_type_male', rows=extracted, sources=[source, mapping_pin],
        localPath='geo_replication/datasets/GSE299412_drer_hypothalamus/processed/GSE299412_DE.tsv',
        localKey='id', localMethod='edgeR-QL', authorMethod='Published rlog group means; limma-selected union',
        orientation='Male hypothalamus mutant minus WT: author rlog group-mean difference, checked against each UP/DOWN flag.',
        note='All 231 source-selected male-hypothalamus genes retained before local joining, including 52 outside the registered fitted table. The 703-row cross-comparison union is not this contrast. Differences of rlog group means are not unshrunk edgeR logFC. Nine previously observed opposite directions remain explicit; no author P/FDR columns exist.')


def chicken():
    url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12208832/fullTextXML'
    path, source = original('data/author-validation/continued-sources/round2-2026-09-05/GSE298648/PMC12208832.xml',
        'a76cbc1fab0020f1ffb6b70e248c9f20e7740f3122cc2b713d12059c29acd306', url)
    mapping_path, mapping_pin = original('geo_replication/datasets/GSE298648_ggal_poah_ehc/metadata/GSE298648_identifier_mapping.tsv',
        'b91e895d2eea402561f9a21c56506380b631bd4474a2485bb2977d286fe84e70',
        'Registered exact original Ensembl-to-output map; author symbols are not used to invent matches')
    with mapping_path.open(encoding='utf8', newline='') as handle:
        mapping_rows = list(csv.DictReader(handle, delimiter='\t'))
    require_unique([row['source_ensembl_id'] for row in mapping_rows])
    mapping = {row['source_ensembl_id']: row['output_label'] for row in mapping_rows}
    document = ET.parse(path)
    table = document.find('.//table-wrap[@id="T5"]')
    if table is None or 'hour 2 in the POAH' not in ''.join(table.find('caption').itertext()):
        raise ValueError('Exact hour-two POAH table missing')
    header = [''.join(cell.itertext()) for cell in table.findall('./table/thead/tr/th')]
    if header != ['Direction', 'Ensembl ID', 'Name', 'Description', 'logFC', 'P-value', 'FDR']:
        raise ValueError('POAH author table header changed')
    extracted = []
    for row_number, row in enumerate(table.findall('./table/tbody/tr'), start=1):
        cells = [''.join(cell.itertext()) for cell in row.findall('td')]
        direction, gene, symbol, _, effect, p, fdr = cells
        if gene not in mapping:
            raise ValueError('Original author Ensembl ID missing from registered input map')
        effect, p, fdr = numeric(effect.replace('\u2212', '-')), numeric(p), numeric(fdr)
        if direction not in ['Upregulated', 'Downregulated'] or (effect > 0) != (direction == 'Upregulated'):
            raise ValueError('Inconsistent author effect direction')
        if not 0 <= p <= 1 or not 0 <= fdr <= 1:
            raise ValueError('Invalid published probabilities')
        extracted.append(dict(output_id=mapping[gene], author_effect=effect, source_ensembl_id=gene,
            source_symbol=symbol, source_direction=direction, source_pvalue=p, author_padj=fdr, source_row=row_number))
    require_unique([row['source_ensembl_id'] for row in extracted], 18)
    require_unique([row['output_id'] for row in extracted], 18)
    return dict(accession='GSE298648', datasetId='chicken_poah_ehc_gse298648',
        contrast='ehc_vs_control_poah_hour2_sex_adjusted', rows=extracted, sources=[source, mapping_pin],
        localPath='geo_replication/datasets/GSE298648_ggal_poah_ehc/processed/GSE298648_DE.tsv', localKey='id',
        localMethod='Sex-adjusted eight-sample edgeR-QL', authorMethod='Published hour-two POAH effects; edgeR/DESeq2 methods',
        orientation='Published EHC minus control at hour two in POAH; signs checked against original Upregulated/Downregulated labels.',
        note='All 18 original Table 5 rows retained, with exact original Ensembl mapping rather than six example symbols. The table selects FDR<0.1; generic comparison significance counts use FDR<0.05 and are contextual. BEND3 violates the manuscript stated absolute logFC>1 cutoff. Exact fitting universe and treatment/replicate independence remain unresolved.')


def main():
    comparisons = []
    inputs = [rat(), fish(), chicken()]
    for item in inputs:
        path = OUT / item['accession'] / 'author-effects.tsv'
        emit(path, table_text(item['rows']))
        comparisons.append({key: item[key] for key in ['datasetId', 'accession', 'contrast', 'localPath', 'localKey', 'localMethod', 'authorMethod', 'orientation', 'note']} | dict(
            authorPath=path.relative_to(ROOT).as_posix(), sourceUrl=item['sources'][0]['sourceUrl'], sha256=sha(path),
            format='tsv', authorKey='output_id', authorEffect='author_effect', orientationSign=1,
            interpretation='effects_compared', resultScope='selected_results',
            originalReferences=item['sources'] + [pin(Path(__file__).resolve(), 'Complete author-only extraction; no local result filtering')],
            normalizationScript='scripts/prepare_author_round2.py'))
        if item['accession'] == 'GSE298648':
            comparisons[-1]['authorAdjustedP'] = 'author_padj'
    emit(OUT / 'comparison-specs.json', json.dumps(dict(schemaVersion=1, comparisons=comparisons), indent=2) + '\n')
    if CHECK:
        master = json.loads((ROOT / 'data/author-validation/additional-comparison-specs.json').read_text(encoding='utf8'))
        for comparison in comparisons:
            matches = [item for item in master['comparisons'] if item['datasetId'] == comparison['datasetId']]
            if matches != [comparison]:
                raise ValueError('Registered comparison spec differs from complete source extraction')
    print(json.dumps(dict(checked=CHECK, comparisons=[dict(accession=item['accession'], rows=len(item['rows'])) for item in inputs])))


if __name__ == '__main__':
    main()
