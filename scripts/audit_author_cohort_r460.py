"""Recheck the GSE167105 author cohort on the R 4.6.0 regenerated outputs.

Successor to the sealed scripts/audit_author_cohort_round4.py, which audits the
R 4.4.1 outputs and runs through scripts/run_historical_check.py. This check
repeats its cohort and transform tests on the current bytes. The regenerated
analysis matrix keeps every source row and value and adds the public symbol in
its symbol column; identity is therefore checked through gene_id. Symbols the
regeneration sums over several source rows are listed with the source gene
description of each row, because they bear on the effect comparison.

    python scripts/audit_author_cohort_r460.py [--check]
"""
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
OUT = ROOT / 'data/author-validation/regeneration-r460-2026-09-25/GSE167105-cohort-audit.json'
PRIOR = ROOT / 'data/author-validation/continued-sources/round4-2026-09-05/GSE167105'
BASE = ROOT / 'geo_replication/datasets/GSE167105_mmus_hypothalamus_thrb'


def content(path):
    data = path.read_bytes()
    return (gzip.decompress(data) if path.suffix == '.gz' else data).decode('utf-8')


def rows(path):
    return list(csv.DictReader(io.StringIO(content(path)), delimiter='\t'))


def pin(path):
    data = path.read_bytes()
    return {'path': path.relative_to(ROOT).as_posix(), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def audit():
    paper_path = PRIOR / 'PMC8410017.xml'
    soft_path = BASE / 'metadata/GSE167105_family.soft.gz'
    sheet_path = BASE / 'metadata/GSE167105_samplesheet.tsv'
    source_path = BASE / 'raw/GSE167105_Hypothalamus_3Hb_vs_3WT_all.txt.gz'
    matrix_path = BASE / 'processed/GSE167105_analysis_matrix.tsv.gz'
    map_path = BASE / 'processed/GSE167105_feature_map.tsv.gz'
    de_path = BASE / 'processed/GSE167105_DE.tsv'
    paper = ET.fromstring(content(paper_path))
    paragraphs = [' '.join(''.join(p.itertext()).split()) for p in paper.iter('p')]
    assert len([t for t in paragraphs if 'at 3 months of age (n = 3/group) were euthanized' in t and 'GSE167105' in t]) == 1
    soft = content(soft_path)
    assert 'Tissues from 3 mice of each genotype were desected and used in RNA-seq.' in soft
    sheet, source, matrix = rows(sheet_path), rows(source_path), rows(matrix_path)
    samples = [row['sample'] for row in sheet]
    assert len(sheet) == 6 and all(sum(row['group'] == arm for row in sheet) == 3 for arm in ['control', 'case'])
    assert all(row['analysis_keep'] == 'TRUE' and not row['exclusion_reason'] for row in sheet)
    assert len({row['gsm'] for row in sheet}) == len({row['biosample'] for row in sheet}) == 6
    assert all(f'^SAMPLE = {row["gsm"]}' in soft for row in sheet)
    assert list(matrix[0]) == ['gene_id', 'symbol', *samples]
    assert len(source) == len(matrix) == 24054
    maximum = 0.0
    for index, (original, registered) in enumerate(zip(source, matrix), 1):
        assert registered['gene_id'].split('__dup')[0] == original['Gene_symbol'], f'Changed row identity at {index}'
        for sample in samples:
            value, result = float(original[sample]), float(registered[sample])
            assert math.isfinite(value) and value >= 0 and math.isfinite(result)
            maximum = max(maximum, abs(math.log2(value + 1) - result))
    assert maximum <= 1e-12, 'Changed transformation'
    description = {row['gene_id']: source[index]['NAME'] for index, row in enumerate(matrix)}
    features = {}
    for row in rows(map_path):
        if row['status'] == 'mapped' or row['status'].startswith('disambiguated_by_'):
            features.setdefault(row['symbol'], []).append(row['feature_id'])
    de = rows(de_path)
    assert len(de) == len({row['symbol'] for row in de}) and all(row['symbol'] in features for row in de)
    summed = [{'symbol': symbol, 'sourceRows': [{'featureId': feature, 'description': description[feature]} for feature in ids],
               'published': any(row['symbol'] == symbol for row in de)}
              for symbol, ids in sorted(features.items()) if len(ids) > 1]
    assert not summed, 'Summed symbols changed; revise the findings'
    disambiguated = [{'featureId': row['feature_id'], 'symbol': row['symbol'], 'status': row['status'], 'description': description[row['feature_id']]}
                     for row in rows(map_path) if row['status'].startswith('disambiguated_by_')]
    assert sorted(item['symbol'] for item in disambiguated) == ['Marchf1', 'Marchf2', 'Mtarc1', 'Mtarc2'], 'Date-label resolution changed; revise the findings'
    assert all(item['symbol'].startswith('Mtarc') == item['description'].startswith('mitochondrial amidoxime') for item in disambiguated)
    files = [paper_path, soft_path, sheet_path, source_path, matrix_path, map_path, de_path,
             ROOT / 'scripts/regen-r460/supported_matrix_r460.R', ROOT / 'scripts/lib/de_common.R', Path(__file__)]
    return {
        'schemaVersion': 1, 'datasetId': 'mouse_hypo_thrb_k146q_gse167105', 'contrastId': 'thrb_k146q_vs_wild_type',
        'reason': 'R 4.6.0 regeneration 2026-09-25', 'cohort': 'compatible',
        'priorAudit': 'data/author-validation/continued-sources/round4-2026-09-05/GSE167105/cohort-audit.json',
        'sourceRows': len(source), 'registeredModelGenes': len(de), 'sourceExpressionColumns': samples,
        'transformedValuesChecked': len(source) * len(samples), 'maximumLog2TransformationDelta': maximum,
        'log2CheckTolerance': 1e-12, 'summedSymbols': summed, 'disambiguatedDateLabels': disambiguated,
        'scope': 'The same six libraries, three terminal mice per genotype, and every source expression value enter the regenerated analysis. Only the published row identity changed: symbols are normalized to current nomenclature, and each row is published under its own symbol.',
        'findings': ['Excel date labels 1-Mar and 2-Mar each name two different genes in the source table. Rule A3.1/M1 resolves all four rows by the source gene-name column (Mtarc1/Mtarc2 for mitochondrial amidoxime reducing component 1/2, Marchf1/Marchf2 for membrane-associated ring finger 1/2); each is fitted and published separately and no source rows are summed.'],
        'pins': [pin(path) for path in files],
    }


if __name__ == '__main__':
    result = audit()
    text = json.dumps(result, indent=2) + '\n'
    if '--check' in sys.argv:
        assert OUT.read_text(encoding='utf-8') == text, 'Stale GSE167105 R 4.6.0 cohort audit'
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_bytes(text.encode('utf-8'))
    print(json.dumps({key: result[key] for key in ['cohort', 'sourceRows', 'registeredModelGenes', 'transformedValuesChecked', 'maximumLog2TransformationDelta']}))
