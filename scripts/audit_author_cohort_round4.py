"""Audit the complete GSE167105 deposited cohort and unchanged expression transform."""
import csv
import gzip
import hashlib
import io
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'data/author-validation/continued-sources/round4-2026-09-05/GSE167105'
BASE = ROOT / 'geo_replication/datasets/GSE167105_mmus_hypothalamus_thrb'


def content(path):
    data = path.read_bytes()
    return (gzip.decompress(data) if path.suffix == '.gz' else data).decode('utf-8')


def rows(path):
    return list(csv.DictReader(io.StringIO(content(path)), delimiter='\t'))


def audit():
    paper_path = FOLDER / 'PMC8410017.xml'
    soft_path = BASE / 'metadata/GSE167105_family.soft.gz'
    sheet_path = BASE / 'metadata/GSE167105_samplesheet.tsv'
    source_path = BASE / 'raw/GSE167105_Hypothalamus_3Hb_vs_3WT_all.txt.gz'
    matrix_path = BASE / 'processed/GSE167105_analysis_matrix.tsv.gz'
    de_path = BASE / 'processed/GSE167105_DE.tsv'
    paper = ET.fromstring(content(paper_path))
    paragraphs = [' '.join(''.join(p.itertext()).split()) for p in paper.iter('p')]
    methods = [text for text in paragraphs if 'at 3 months of age (n = 3/group) were euthanized' in text and 'GSE167105' in text]
    assert len(methods) == 1, 'Original manuscript does not establish the selected terminal cohort'
    soft = content(soft_path)
    assert '!Series_geo_accession = GSE167105' in soft and '!Series_pubmed_id = 34237030' in soft
    assert 'Tissues from 3 mice of each genotype were desected and used in RNA-seq.' in soft
    samples = {}
    for block in soft.split('^SAMPLE = ')[1:]:
        lines = block.splitlines()
        key = lines[0].strip()
        assert key not in samples
        fields = {}
        for line in lines[1:]:
            if ' = ' in line:
                name, value = line.split(' = ', 1)
                fields.setdefault(name, []).append(value)
        samples[key] = fields
    sheet = rows(sheet_path)
    source = rows(source_path)
    matrix = rows(matrix_path)
    assert len(sheet) == 6 and len(samples) == 18
    assert len(source) == len(matrix) == 24054
    expected_columns = ['Gene_symbol', 'NAME', 'logFC', 'logCPM', 'LR', 'PValue', 'FDR',
                        'Hypothalamus.Hb60', 'Hypothalamus.Hb62', 'Hypothalamus.Hb83',
                        'Hypothalamus.WT1', 'Hypothalamus.WT2', 'Hypothalamus.WT43']
    assert list(source[0]) == expected_columns
    assert set(row['sample'] for row in sheet) == set(expected_columns[7:])
    assert list(matrix[0]) == ['gene_id', 'symbol', *[row['sample'] for row in sheet]]
    joins = []
    for row in sheet:
        fields = samples[row['gsm']]
        assert fields['!Sample_title'] == [row['title']]
        assert row['sample'].replace('.', '-').lower() == row['title'].lower()
        expected_genotype = 'Wt' if row['group'] == 'control' else 'TRbK146Q mutant'
        assert row['group'] in ['control', 'case'] and row['genotype'] == expected_genotype
        assert fields['!Sample_source_name_ch1'] == [expected_genotype]
        assert all(item in fields['!Sample_characteristics_ch1'] for item in ['tissue: Hypothalamus', 'age: 3 months', 'treatment: None'])
        assert f'BioSample: https://www.ncbi.nlm.nih.gov/biosample/{row["biosample"]}' in fields['!Sample_relation']
        assert row['analysis_keep'] == 'TRUE' and not row['exclusion_reason']
        joins.append({key: row[key] for key in ['sample', 'gsm', 'title', 'group', 'genotype', 'biosample']})
    assert all(sum(row['group'] == arm for row in sheet) == 3 for arm in ['control', 'case'])
    assert len({row['gsm'] for row in sheet}) == len({row['biosample'] for row in sheet}) == 6
    maximum = 0.0
    for index, (original, registered) in enumerate(zip(source, matrix), 1):
        assert original['Gene_symbol'] == registered['symbol'], f'Changed row identity at {index}'
        for sample in expected_columns[7:]:
            value = float(original[sample])
            result = float(registered[sample])
            assert math.isfinite(value) and value >= 0 and math.isfinite(result)
            delta = abs(math.log2(value + 1) - result)
            maximum = max(maximum, delta)
            assert delta <= 1e-12, f'Changed transformation at {index}/{sample}'
    source_genes = {row['Gene_symbol'] for row in source}
    de = rows(de_path)
    assert len(de) == len({row['symbol'] for row in de}) == 19771
    assert all(row['symbol'] in source_genes for row in de)
    # The original table reuses two date-like labels for different genes. The
    # comparator keeps the last source occurrence; verify the local ID selects
    # that same physical row instead of assuming the labels are unambiguous.
    positions = {}
    for index, row in enumerate(source):
        positions.setdefault(row['Gene_symbol'], []).append(index)
    duplicates = {key: value for key, value in positions.items() if len(value) > 1}
    assert set(duplicates) == {'1-Mar', '2-Mar'}
    duplicate_bindings = []
    for symbol, indices in duplicates.items():
        selected = [row for row in de if row['symbol'] == symbol]
        assert len(indices) == 2 and len(selected) == 1
        assert selected[0]['id'] == matrix[indices[-1]]['gene_id'] == f'{symbol}__dup1'
        duplicate_bindings.append({'sourceLabel': symbol, 'sourceRows': [index + 1 for index in indices],
                                   'selectedSourceRow': indices[-1] + 1, 'localId': selected[0]['id'],
                                   'selectedSourceDescription': source[indices[-1]]['NAME']})
    files = [paper_path, soft_path, sheet_path, source_path, matrix_path, de_path,
             ROOT / 'scripts/prep_supported_matrix_batch1.R', Path(__file__)]
    return {'schemaVersion': 1, 'datasetId': 'mouse_hypo_thrb_k146q_gse167105',
            'contrastId': 'thrb_k146q_vs_wild_type', 'cohort': 'compatible',
            'sourceUrl': 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC8410017/fullTextXML',
            'sourceRows': len(source), 'registeredModelGenes': len(de), 'sourceExpressionColumns': expected_columns[7:],
            'sampleJoins': joins, 'transformedValuesChecked': len(source) * 6,
            'duplicateSourceLabelBindings': duplicate_bindings,
            'maximumLog2TransformationDelta': maximum, 'log2CheckTolerance': 1e-12,
            'scope': 'All six expression columns embedded in the original author-result table match the six registered hypothalamus libraries. The original paper establishes three terminal mice per genotype. All retained gene effects are still measured by the existing full-table comparator.',
            'limitations': ['Raw counts and the exact author count-model reconstruction remain unavailable.',
                           'GEO describes both TMM normalization and RPKM output; these labels are not reconciled by this cohort audit.',
                           'The registered log2(expression + 1) transform can compress low-expression effect magnitudes.',
                           'This audit does not substitute an expressed-gene subset or equate P values or FDR.',
                           'The legacy edgeR method classification is inferred from the deposited table; the primary methods do not explicitly name edgeR.',
                           'Explicit log2FC labeling comes from the same study transcriptome figures, not a recovered hypothalamus-specific model specification.',
                           'Two date-like source labels are duplicated; exact retained row IDs are checked without inventing new gene identities.'],
            'pins': [{'path': path.relative_to(ROOT).as_posix(), 'bytes': path.stat().st_size,
                      'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for path in files]}


if __name__ == '__main__':
    result = audit()
    output = FOLDER / 'cohort-audit.json'
    text = json.dumps(result, indent=2) + '\n'
    if '--check' in sys.argv:
        assert output.read_text(encoding='utf-8') == text, 'Stale GSE167105 cohort audit'
    else:
        output.write_text(text, encoding='utf-8')
    print(json.dumps({key: result[key] for key in ['cohort', 'sourceRows', 'registeredModelGenes', 'transformedValuesChecked', 'maximumLog2TransformationDelta']}))
