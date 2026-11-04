"""Independently reconcile deposited counts to every registered sample, without writing inputs.

This audit is deliberately upstream of run_dataset.R: it proves preservation into the
registered input, not sequencing QC, biological independence, or source authenticity.
Run from the repository root. --check recomputes the saved evidence without changing it.
"""
import argparse
import collections
import copy
import csv
import gzip
import hashlib
import io
import json
import math
import re
import tarfile
import subprocess
import os
import shutil
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
FOLDER = 'data/internal-qc/conservation-2026-09-05'
SCRIPT = 'scripts/audit_count_conservation.py'
VERSION = 'source-count-reconciliation-v1'
SCHEME = 'sha256-exact-binary-or-utf8-crlf-to-lf-v1'
CONFIG = 'geo_replication/config/datasets.tsv'
BASELINE = FOLDER + '/baseline.json'
EVIDENCE = FOLDER + '/conservation-evidence.json'


def pin(path):
    payload = (ROOT / path).read_bytes()
    # Binary scientific originals remain byte-exact; known UTF-8 audit/metadata text
    # has explicit CRLF portability and no other whitespace or numeric normalization.
    text = Path(path).suffix in {'.py', '.mts', '.json', '.tsv', '.md', '.R'}
    canonical = payload.decode('utf8').replace('\r\n', '\n').encode('utf8') if text else payload
    return {'path': path, 'sha256': hashlib.sha256(canonical).hexdigest(),
            'bytes': len(canonical), 'scheme': 'utf8-crlf-to-lf' if text else 'exact-bytes'}


def value(x):
    n = float(x)
    if not math.isfinite(n) or n < 0:
        raise ValueError('non-finite or negative count')
    return n


def evidence_matches(saved, recomputed):
    """Runtime diagnostic differences are permitted; every scientific field is exact.

    Both documents must retain a well-formed original/current R version and the
    exact tested rounding semantics. The saved artifact is never rewritten by --check.
    """
    documents = [copy.deepcopy(saved), copy.deepcopy(recomputed)]
    runtime_pattern = r'R version [0-9]+\.[0-9]+\.[0-9]+ \([0-9]{4}-[0-9]{2}-[0-9]{2}(?: [A-Za-z0-9.-]+)?\)\nround\(x\), digits=0; IEEE 60559 nearest with ties to even'
    for document in documents:
        for record in document.get('records', []):
            if record.get('specification', {}).get('rounding'):
                diagnostic = record.get('roundingRuntime')
                if not isinstance(diagnostic, str) or not re.fullmatch(runtime_pattern, diagnostic):
                    return False
                del record['roundingRuntime']
    return documents[0] == documents[1]


def load_table(path, sheet=None, drop_empty_headers=False, encoding='utf-8-sig'):
    if Path(path).suffix == '.xlsx':
        import openpyxl
        book = openpyxl.load_workbook(ROOT / path, read_only=True, data_only=True)
        table = book[sheet] if sheet else book[book.sheetnames[0]]
        rows = [[str(c) if c is not None else '' for c in row] for row in table.values]
        book.close()
    else:
        payload = (ROOT / path).read_bytes()
        if path.endswith('.gz'):
            payload = gzip.decompress(payload)
        text = payload.decode(encoding)
        lines = [line for line in text.splitlines() if line.strip() and not line.startswith('#')]
        first = lines[0]
        delimiter = '\t' if '\t' in first else ',' if ',' in first else None
        rows = list(csv.reader(lines, delimiter=delimiter)) if delimiter else [line.split() for line in lines]
    header = [x.strip() for x in rows.pop(0)]
    if drop_empty_headers:
        header = [x for x in header if x]
    # R write.table(row.names=TRUE,col.names=NA/FALSE) can omit the first header cell.
    if rows and all(len(row) == len(header) + 1 for row in rows):
        header.insert(0, '')
    if not rows or any(len(row) != len(header) for row in rows):
        lengths = dict(collections.Counter(len(row) for row in rows))
        raise ValueError(f'nonrectangular table {path}: {len(header)} headers versus {lengths}')
    return header, rows


def index(header, name):
    if isinstance(name, int):
        if name < 0 or name >= len(header):
            raise ValueError('invalid explicit column index')
        return name
    if header.count(name) != 1:
        raise ValueError(f'source/output column {name!r} has {header.count(name)} matches')
    return header.index(name)


def compare_rows(source_ids, source_values, output_ids, output_values, samples, exclusions=None):
    """Compare every retained value and separately account for every excluded row."""
    exclusions = exclusions or set()
    if len(source_ids) != len(source_values) or len(output_ids) != len(output_values):
        raise ValueError('incomplete row/value coverage')
    # Row order is a legitimate join for unmodified source files with duplicate IDs,
    # but only when the complete ID sequence agrees; otherwise a unique key is required.
    if not exclusions and source_ids == output_ids:
        aligned = source_values
        excluded = []
        join = 'entire feature-id sequence and row ordinal'
    else:
        if len(set(source_ids)) != len(source_ids) or len(set(output_ids)) != len(output_ids):
            raise ValueError('duplicate feature IDs cannot support a reordered/subset join')
        source = dict(zip(source_ids, source_values))
        missing = set(output_ids) - set(source)
        discarded = set(source) - set(output_ids)
        if missing or discarded != exclusions:
            raise ValueError(f'feature coverage mismatch: {len(missing)} unmatched output, {len(discarded)} excluded source rows; examples {sorted(missing)[:3]} / {sorted(discarded)[:3]}')
        aligned = [source[key] for key in output_ids]
        excluded = [source[key] for key in source_ids if key in exclusions]
        join = 'unique feature identifier'
    records = []
    for j, sample in enumerate(samples):
        before = math.fsum(row[j] for row in source_values)
        removed = math.fsum(row[j] for row in excluded)
        after = math.fsum(row[j] for row in output_values)
        deltas = [abs(left[j] - right[j]) for left, right in zip(aligned, output_values)]
        maximum = max(deltas, default=0)
        # No relative tolerance: even a one-count change in a huge library is visible.
        mismatches = sum(delta > 1e-6 for delta in deltas)
        delta = after + removed - before
        records.append({'sample': sample, 'source_rows': len(source_ids), 'output_rows': len(output_ids),
                        'excluded_rows': len(excluded), 'source_library_size': before,
                        'excluded_count_sum': removed, 'output_library_size': after,
                        'count_conservation_delta': delta, 'maximum_retained_count_delta': maximum,
                        'mismatching_retained_cells': mismatches,
                        'status': 'pass' if maximum <= 1e-6 and abs(delta) <= 1e-6 else 'review'})
    return records, join


def source_spec(record, config):
    raw = 'geo_replication/' + config['dir'] + '/raw/'
    id = config['id']
    recovered = {
        'GSE201207_young_vs_old': ('GSE201207', 'GSE201207_count_216.csv.gz'),
        'GSE314817_6v27mo': ('GSE314817', 'GSE314817_mouse_raw_counts_wo_muscle.txt.gz'),
        'GSE245727': ('GSE245727', 'GSE245727_RAW.tar'),
        'GSE254155': ('GSE254155', 'GSE254155_RAW.tar'),
        'GSE289833': ('GSE289833', 'GSE289833_RAW.tar'),
    }
    if id in recovered:
        accession, filename = recovered[id]
        folder = 'data/internal-qc/source-authenticity-2026-09-05/round2/downloads/' + accession + '/'
        archive = filename.endswith('.tar')
        spec = {'source': folder + filename, 'accession': accession,
                'mode': 'recovered-featurecounts' if archive else 'recovered-symbol-matrix',
                'sourceLogs': [folder + filename + '.download.json'],
                'featureRule': 'strip-ensembl-version-then-unique-key' if accession == 'GSE245727' else
                    'complete-unique-feature-key' if archive else 'sum-identical-source-symbols',
                'note': 'Every selected deposited count is independently reread from the original source and compared by complete unique feature identity; no intersection, imputation or unaccounted feature exclusion. This numerical conservation result is distinct from exact-byte input reconstruction.'}
        if accession != 'GSE201207':
            spec['series'] = folder + accession + '_family.soft.gz'
            spec['sourceLogs'].append(spec['series'] + '.download.json')
        if not archive:
            spec['preparationScript'] = 'scripts/prep_' + accession + '.R'
            spec['note'] += ' Exact duplicate source symbols are summed according to the retained original preparation; complete original and aggregated totals are separately accounted. Fractional estimates are preserved without rounding.'
        if accession == 'GSE254155':
            spec['note'] += ' The registered row collation differs from the independent assembly. All unique gene keys and every selected integer value are compared directly; strict reconstruction remains unassessed in its separate evidence.'
        return spec
    if id == 'GSE285906':
        return {'source': FOLDER + '/downloads/GSE285906_Hypothalamus_raw_counts.txt.gz',
                'downloadLog': FOLDER + '/downloads/GSE285906.download.json',
                'downloadScript': FOLDER + '/downloads/fetch_GSE285906.py',
                'columnRule': 'same', 'featureRule': 'same',
                'note': 'Every selected count is compared with a fresh independent download from the exact official GEO source URL; source SHA also matches the retained original download manifest.'}
    if record['sourceDownload']:
        return {'source': record['sourceDownload'], 'columnRule': 'same', 'featureRule': 'same',
                'note': 'Independently downloaded deposited matrix; all source rows and every registered analysis sample compared.'}
    if id in ['GSE181204', 'GSE212299', 'GSE224780', 'GSE242245', 'GSE208722', 'GSE266472']:
        return {'source': raw + (id + '_RAW.tar' if id != 'GSE266472' else ''),
                'mode': 'sample-files', 'memberRule': id,
                'note': 'Every selected sample is reconstructed directly from its original per-sample counts. Only explicit HTSeq technical summary rows may be excluded; their counts are separately accounted.' +
                (' The three date-like identifier substitutions exactly follow the retained original prep script; their biological naming validity is outside this count-accounting check.' if id == 'GSE242245' else '')}
    sources = {
        'GSE225038': ('GSE225038_GeneCount.xlsx', 'same'),
        'GSE235479': ('GSE235479_counts_matrix.csv.gz', 'same'),
        'E-MTAB-6929': ('Final_Counts.txt', 'diet-prefix'),
        'GSE167264': ('GSE167264_counts.txt.gz', 'bam-suffix'),
        'GSE329539': ('GSE329539_HP_OB.csv.gz', 'same'),
        'GSE123983': ('GSE123983_Stat3_counts.csv.gz', 'S-prefix'),
        'GSE305688': ('GSE305688_count.csv.gz', 'S-prefix'),
        'GSE185074': ('GSE185074_counts.xlsx', 'same'),
        'GSE160802': ('GSE160802_Gene_counts.txt.gz', 'S-prefix'),
        'GSE295250': ('GSE295250_FtoE3KO_Fed_Adult_CountsEns_Fed2023.txt.gz', 'same'),
        'GSE217420': ('GSE217420_reads_processed_all_samples.csv.gz', 'same'),
        'GSE229838': ('GSE229838_Processed_data_file.txt.gz', 'count-suffix'),
        'GSE234483': ('GSE234483_GEO_rawCounts.txt.gz', 'same'),
        'GSE95243': ('GSE95243_raw_read_counts.csv.gz', 'raw-prefix'),
        'GSE98519': ('GSE98519_12400R_counts.txt.gz', 'same'),
        'GSE99690': ('GSE99690_GT1-7-OxR1-RNA-Seq_mm10_Results.xlsx', 'same'),
        'GSE132308': ('GSE132308_master_list_of_gene_counts_MIN.sense.UNNORMQUANT.txt.gz', 'same'),
        'GSE214877': ('GSE214877_processed.csv.gz', 'samplesheet'),
        'GSE229159': ('GSE229159_featurecounttrim24.txt.gz', 'samplesheet'),
        'GSE141144': ('GSE141144_sampleCounts.txt.gz', 'samplesheet'),
        'GSE202003': ('GSE202003_Expression.xlsx', 'samplesheet'),
        'GSE299412': ('GSE299412_data.txt.gz', 'samplesheet'),
        'GSE314029': ('GSE314029_lani_bulk_counts.tsv.gz', 'series-library'),
        'GSE242187': ('GSE242187_5A_vs_3A_control_vs_comparison.deseq.counts.csv.gz', 'Mona-suffix'),
        'GSE190389': ('GSE190389_raw.csv.gz', 'same'),
        'GSE104255': ('GSE104255_raw.genes.csv.gz', 'samplesheet'),
    }
    if id not in sources:
        return None
    name, column_rule = sources[id]
    spec = {'source': raw + name, 'columnRule': column_rule, 'featureRule': 'same',
            'note': 'Complete deposited source rows compared after explicit sample-column selection/renaming; no unaccounted gene filtering is permitted.'}
    if id in ['GSE295250','GSE214877','GSE141144','GSE299412','GSE95243','GSE98519','GSE132308']:
        spec['sourceId'] = 0
    if id == 'GSE99690':
        spec.update(sheet='RawGeneCounts', sourceId=0, featureRule='strip-literal-tab')
    if id in ['GSE190389', 'GSE242187', 'GSE104255']:
        spec['sourceId'] = 0
    if id == 'GSE190389':
        spec.update(encoding='latin1', aggregateDuplicates=True,
                    note='All 24,537 original rows are retained; the two duplicated symbols are summed into 24,535 output rows without changing any library total. Latin-1 source decoding and fractional count estimates are preserved; technical resequencings were already collapsed by the deposited source and are not summed again.')
    if id == 'GSE314029':
        spec['series'] = 'geo_replication/' + config['dir'] + '/metadata/GSE314029_series_matrix.txt.gz'
    if id == 'GSE229159':
        spec.update(dropEmptyHeaders=True, featureRule='trim')
    if id == 'GSE202003':
        spec.update(sourceId='Gene_ID', featureRule='chicken-workbook',
                    mapping='geo_replication/' + config['dir'] + '/metadata/GSE202003_identifier_mapping.tsv')
    if id in ['GSE104255', 'GSE141144', 'GSE299412']:
        spec.update(featureRule='authority-map', mapping='geo_replication/' + config['dir'] + '/metadata/' + id + '_identifier_mapping.tsv')
        spec['authority'] = (raw + 'GSE104255_res.pod.csv.gz' if id == 'GSE104255' else
            'geo_replication/' + config['dir'] + '/metadata/' + ('Danio_rerio.GRCz11.92.gtf.gz' if id == 'GSE141144' else 'Danio_rerio.gene_info.gz'))
    if id in ['GSE235479', 'E-MTAB-6929', 'GSE229838']:
        spec['rounding'] = 'R-round-digits0-ties-to-even'
    if id == 'GSE95243':
        spec.update(duplicateColumns='require-identical-complete-values', sourceId=0)
    return spec


def retained_preparation(path):
    """Retain the actual prior preparation code so a Git checkout can review it."""
    saved = FOLDER + '/preparation/' + Path(path).name
    original = ROOT / path
    target = ROOT / saved
    if not target.exists():
        if not original.exists():
            return None
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(original.read_bytes())
    if original.exists() and original.read_text(encoding='utf8') != target.read_text(encoding='utf8'):
        raise ValueError('original preparation code differs from its retained snapshot')
    return saved


def require_unique_features(ids):
    if not ids or any(not key.strip() or key == 'NA' for key in ids) or len(set(ids)) != len(ids):
        raise ValueError('Complete unique nonempty feature identifiers are required')


def read_geo_samples(path):
    """Parse complete GEO sample blocks, refusing ambiguous identity fields."""
    text = gzip.decompress((ROOT / path).read_bytes()).decode('utf8')
    samples = []
    for block in text.split('^SAMPLE = ')[1:]:
        lines = block.splitlines()
        item = {'gsm': lines[0]}
        def assign(key, val):
            if key in item and item[key] != val:
                raise ValueError('Conflicting GEO sample identity field: ' + key)
            item[key] = val
        for line in lines:
            if line.startswith('!Sample_title = '):
                assign('title', line.split(' = ', 1)[1])
            if line.startswith('!Sample_description = Library name: '):
                assign('library', line.split('Library name: ', 1)[1])
            if line.startswith('!Sample_characteristics_ch1 = '):
                key, sep, val = line.split(' = ', 1)[1].partition(': ')
                if sep:
                    assign(key.lower(), val)
            if re.match(r'!Sample_supplementary_file_[0-9]+ = ', line):
                assign('source_file', line.split('/')[-1])
        samples.append(item)
    if not samples or len({s['gsm'] for s in samples}) != len(samples):
        raise ValueError('Missing or duplicated GEO sample accession')
    return samples


def selected_recovered_samples(accession, metadata):
    selected = []
    for item in metadata:
        if item.get('tissue', '').lower() != 'hypothalamus':
            continue
        if accession == 'GSE245727':
            if item.get('treatment') not in ['vehicle', 'GLP-1']:
                continue
            match = re.fullmatch(r'Hypothalamus, (vehicle|GLP-1), rep([1-6])', item['title'])
            if not match or match[1] != item['treatment']:
                raise ValueError('GLP-1 sample title/treatment disagree')
            case, rep = match[1] == 'GLP-1', int(match[2])
            expected = {'sample': ('GLP1' if case else 'Vehicle') + '_rep' + str(rep), 'group': 'case' if case else 'control'}
        elif accession == 'GSE254155':
            if item.get('genotype') != 'Control':
                continue
            match = re.fullmatch(r'Ctrl\.(AL|Fast)\.(10|[1-9])', item['title'])
            if not match or item.get('treatment') != ('16 hour Fast' if match[1] == 'Fast' else 'Ad Libitum Fed'):
                raise ValueError('Fed/fast sample title/treatment disagree')
            case, rep = match[1] == 'Fast', int(match[2])
            expected = {'sample': item['title'], 'group': 'case' if case else 'control',
                        'treatment': 'Fast16h' if case else 'AdLibitumFed'}
        elif accession == 'GSE289833':
            match = re.fullmatch(r'GSM[0-9]+_(FASTED|FED)([1-3])-Hypo_counts.tsv.gz', item.get('source_file', ''))
            if not match or item.get('treatment') != ('fasted, 18h' if match[1] == 'FASTED' else 'fed, 18h'):
                raise ValueError('Fasting file/treatment disagree')
            case, rep = match[1] == 'FASTED', int(match[2])
            expected = {'sample': match[1] + str(rep) + '_Hypo', 'group': 'case' if case else 'control'}
        else:
            if item.get('age') not in ['6 months', '27 months']:
                continue
            case, rep = item['age'] == '27 months', item['gsm']
            expected = {'sample': 'LIB_' + item['library'], 'group': 'case' if case else 'control',
                        'age': item['age'], 'sex': item['sex'], 'gsm': item['gsm'], 'library': item['library']}
        selected.append({'metadata': item, 'expectedSheet': expected, 'order': (case, rep)})
    expected_count = {'GSE245727': 12, 'GSE254155': 20, 'GSE289833': 6, 'GSE314817': 36}[accession]
    if len(selected) != expected_count or len({s['expectedSheet']['sample'] for s in selected}) != expected_count:
        raise ValueError('Incomplete or duplicate metadata-selected sample set')
    return sorted(selected, key=lambda item: item['order'])


def compare_unique_rows(source_ids, source_values, output_ids, output_values, samples):
    require_unique_features(source_ids)
    require_unique_features(output_ids)
    return compare_rows(source_ids, source_values, output_ids, output_values, samples)


def audit_recovered(record, config, spec, sheet, output_header, output_rows, input_path, sheet_path):
    """Reread every selected original cell; never use a replay status or scalar total."""
    accession = spec['accession']
    samples = [row['sample'] for row in sheet]
    output_ids = [row[index(output_header, config['id_col'])] for row in output_rows]
    require_unique_features(output_ids)
    output_values = [[value(row[index(output_header, sample)]) for sample in samples] for row in output_rows]
    consumed = [input_path, sheet_path, spec['source'], *spec['sourceLogs']]
    if spec.get('series'):
        consumed.append(spec['series'])
    if spec.get('preparationScript'):
        consumed.append(spec['preparationScript'])
    for source in [spec['source'], *([spec['series']] if spec.get('series') else [])]:
        log = json.loads((ROOT / (source + '.download.json')).read_text(encoding='utf8'))
        expected_url = 'https://ftp.ncbi.nlm.nih.gov/geo/series/' + accession[:-3] + 'nnn/' + accession + ('/soft/' if source.endswith('_family.soft.gz') else '/suppl/') + Path(source).name
        payload = (ROOT / source).read_bytes()
        if (log.get('status') != 'downloaded' or log.get('httpStatus') != 200 or log.get('sourceUrl') != expected_url
                or log.get('download') != {'path': source, 'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)}):
            raise ValueError('Recovered original download/log binding changed')
    selected = selected_recovered_samples(accession, read_geo_samples(spec['series'])) if spec.get('series') else None
    if selected is not None:
        expected = {item['expectedSheet']['sample']: item for item in selected}
        if set(expected) != set(samples) or any(row != expected[row['sample']]['expectedSheet'] for row in sheet):
            raise ValueError('Current sheet differs from complete independently selected GEO sample metadata')
        selected = [expected[sample] for sample in samples]
    members, mapping = [], []
    if spec['mode'] == 'recovered-featurecounts':
        source_ids, columns = None, []
        with tarfile.open(ROOT / spec['source']) as archive:
            all_members = archive.getmembers()
            archive_names = [member.name for member in all_members]
            expected_archive_count = {'GSE245727': 23, 'GSE254155': 35, 'GSE289833': 12}[accession]
            if (len(all_members) != expected_archive_count or len(set(archive_names)) != len(archive_names)
                    or any(not m.isfile() or Path(m.name).name != m.name for m in all_members)):
                raise ValueError('Complete original archive inventory is missing, duplicate or non-file')
            for sample, selection in zip(samples, selected):
                name = selection['metadata']['source_file']
                if not name.startswith(selection['metadata']['gsm'] + '_'):
                    raise ValueError('Selected source filename does not bind to GEO sample accession')
                raw = archive.extractfile(name).read()
                table = csv.reader((line for line in gzip.decompress(raw).decode('utf8').splitlines() if not line.startswith('#')), delimiter='\t')
                header = next(table)
                if header[:6] != ['Geneid', 'Chr', 'Start', 'End', 'Strand', 'Length'] or len(header) != 7 or not header[6].strip():
                    raise ValueError('Expected exactly one featureCounts count column')
                ids, counts = [], []
                for row in table:
                    if len(row) != 7 or not re.fullmatch(r'[0-9]+', row[6]) or int(row[6]) > 2 ** 53 - 1:
                        raise ValueError('Incomplete, noninteger or unsafe featureCounts value')
                    ids.append(re.sub(r'\.[0-9]+$', '', row[0]) if accession == 'GSE245727' else row[0])
                    counts.append(int(row[6]))
                require_unique_features(ids)
                if source_ids is None:
                    source_ids = ids
                if ids != source_ids:
                    raise ValueError('Per-library source gene universe/order differs; no intersection allowed')
                columns.append(counts)
                members.append({'sample': sample, 'member': name, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)})
                mapping.append({'sample': sample, 'group': selection['expectedSheet']['group'], 'gsm': selection['metadata']['gsm'],
                                'sourceFile': name, 'sourceCountColumn': header[6], 'sourceCountColumnIndex': 6})
        if len({m['member'] for m in members}) != len(members):
            raise ValueError('Duplicate selected original count member')
        source_values = [list(row) for row in zip(*columns)]
        source_columns = {item['sample']: item['sourceFile'] for item in mapping}
        original_rows, original_sums = len(source_ids), [math.fsum(column) for column in columns]
    else:
        # Stream the wide deposited matrix; never materialize its unrelated libraries.
        delimiter = ',' if accession == 'GSE201207' else '\t'
        with gzip.open(ROOT / spec['source'], 'rt', encoding='utf-8-sig', newline='') as stream:
            table = csv.reader(stream, delimiter=delimiter)
            header = next(table)
            if accession == 'GSE201207':
                pattern = r'ct([0-9]+)-(young|old)-hypothalamus'
                selected_names = [name for name in header if re.fullmatch(pattern, name)]
                expected = [{'sample': name, 'group': 'control' if '-young-' in name else 'case',
                             'age': '6_months' if '-young-' in name else '27_months',
                             'circadian_time': 'ct' + re.fullmatch(pattern, name)[1]} for name in selected_names]
                if (len(expected) != 24 or sheet != expected
                        or set(collections.Counter(r['circadian_time'] for r in expected).values()) != {2}
                        or collections.Counter(r['group'] for r in expected) != {'control': 12, 'case': 12}):
                    raise ValueError('Current circadian sheet differs from complete original column selection')
                source_columns = dict(zip(samples, samples))
            else:
                if len([r for r in read_geo_samples(spec['series']) if r.get('tissue', '').lower() == 'hypothalamus']) != 103:
                    raise ValueError('Expected complete 103-library hypothalamus metadata scope')
                source_columns = {sample: item['metadata']['library'] for sample, item in zip(samples, selected)}
            indices = [index(header, source_columns[sample]) for sample in samples]
            if len(set(indices)) != len(indices):
                raise ValueError('Multiple samples select one deposited count column')
            source_ids, source_values = [], []
            for row in table:
                if len(row) != len(header) or not row[0].strip() or row[0] == 'NA':
                    raise ValueError('Nonrectangular matrix or undefined source gene: no implicit filtering allowed')
                counts = [value(row[j]) for j in indices]
                if accession == 'GSE201207' and any(v != round(v) for v in counts):
                    raise ValueError('Circadian source contains unexpected fractional counts')
                source_ids.append(row[0])
                source_values.append(counts)
        original_rows = len(source_ids)
        original_sums = [math.fsum(row[j] for row in source_values) for j in range(len(samples))]
        grouped = collections.defaultdict(list)
        for gene, values in zip(source_ids, source_values):
            grouped[gene].append(values)
        source_ids = list(grouped)
        source_values = [[math.fsum(row[j] for row in grouped[key]) for j in range(len(samples))] for key in source_ids]
    measured, join = compare_unique_rows(source_ids, source_values, output_ids, output_values, samples)
    for j, row in enumerate(measured):
        row.update(original_source_rows=original_rows, aggregated_source_rows=len(source_ids),
                   original_source_library_size=original_sums[j],
                   source_aggregation_delta=row['source_library_size'] - original_sums[j])
        if abs(row['source_aggregation_delta']) > 1e-6:
            row['status'] = 'review'
    return {'datasetId': record['datasetId'], 'configId': config['id'], 'config': config,
            'inputPath': input_path, 'samplesheetPath': sheet_path, 'specification': spec,
            'pins': [pin(path) for path in consumed], 'featureJoin': join,
            'sourceColumns': source_columns,
            **({'sourceMembers': members, 'sampleSourceMapping': mapping, 'sourceArchiveInventory': archive_names} if members else {}),
            'samples': measured, 'comparedCells': len(output_rows) * len(samples),
            'status': 'pass' if all(row['status'] == 'pass' for row in measured) else 'review'}


def audit_files(record, config, spec, sheet, output_header, output_rows, input_path, sheet_path):
    id = config['id']
    samples = [row['sample'] for row in sheet]
    output_ids = [row[0] for row in output_rows]
    counts = []
    consumed = [input_path, sheet_path]
    members = []
    archive = tarfile.open(ROOT / spec['source']) if id != 'GSE266472' else None
    if archive:
        consumed.append(spec['source'])
    for row in sheet:
        sample = row['sample']
        if id == 'GSE266472':
            path = spec['source'] + row['source_file']
            payload = (ROOT / path).read_bytes()
            member_name = row['source_file']
            consumed.append(path)
        else:
            patterns = {
                'GSE181204': '_' + sample + '_htseq-count.tabular.txt.gz',
                'GSE212299': '_' + sample.replace('Hypo_', 'Hypothalamus_').replace('Abi3WT', 'Abi3-WT').replace('Abi3KO', 'Abi3-KO') + '.txt.gz',
                'GSE224780': '_200d' + sample.replace('_Hypo_', 'Hypothalamus_') + '.txt.gz',
                'GSE242245': '_' + sample.split('_')[-1] + '.tsv.gz',
                'GSE208722': row.get('file', ''),
            }
            pattern = patterns[id]
            matches = [name for name in archive.getnames() if name.endswith(pattern)]
            if len(matches) != 1 or not pattern:
                raise ValueError(f'ambiguous source member for {sample}')
            member_name = matches[0]
            payload = archive.extractfile(member_name).read()
        rows = [line.split('\t') for line in gzip.decompress(payload).decode('utf-8-sig').splitlines() if line.strip()]
        if id in ['GSE224780', 'GSE242245']:
            rows.pop(0)
        if any(len(cells) != 2 for cells in rows):
            raise ValueError(f'nonrectangular per-sample count source {member_name}')
        source_ids = [cells[0] for cells in rows]
        if id == 'GSE242245':
            aliases = {'10/01/19': 'Oct-1', '10/01/20': 'Oct-1', '10/03/04': 'Oct-3/4'}
            source_ids = [aliases.get(key, key) for key in source_ids]
        source_values = [[value(cells[1])] for cells in rows]
        output_values = [[value(cells[index(output_header, sample)])] for cells in output_rows]
        excluded = {key for key in source_ids if key.startswith('__')}
        valid_summary = {'__no_feature', '__ambiguous', '__too_low_aQual', '__not_aligned', '__alignment_not_unique'}
        if not excluded <= valid_summary:
            raise ValueError('unknown excluded technical summary row')
        result, join = compare_rows(source_ids, source_values, output_ids, output_values, [sample], excluded)
        counts.extend(result)
        members.append({'sample': sample, 'member': member_name, 'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)})
    if archive:
        archive.close()
    prep = 'geo_replication/scripts/prep_' + id + '.R'
    saved_prep = retained_preparation(prep)
    if saved_prep:
        consumed.append(saved_prep)
    return {'datasetId': record['datasetId'], 'configId': id, 'config': config,
            'inputPath': input_path, 'samplesheetPath': sheet_path, 'specification': spec,
            'pins': [pin(path) for path in consumed], 'featureJoin': join,
            'sourceColumns': {s: 'second column in original count file' for s in samples}, 'sourceMembers': members,
            'samples': counts, 'comparedCells': len(output_rows) * len(samples),
            'status': 'pass' if all(row['status'] == 'pass' for row in counts) else 'review'}


def audit(record, config, spec):
    input_path = 'geo_replication/' + config['input_path']
    sheet_path = 'geo_replication/' + config['samplesheet']
    if input_path == spec['source']:
        raise ValueError('source is the registered input itself; independent source copy required')
    sheet_header, sheet_rows = load_table(sheet_path)
    sheet = [dict(zip(sheet_header, row)) for row in sheet_rows]
    sheet = [row for row in sheet if row.get('group') in ['control', 'case']]
    samples = [row['sample'] for row in sheet]
    if not samples or len(set(samples)) != len(samples):
        raise ValueError('registered samples missing or duplicated')
    output_header, output_rows = load_table(input_path)
    if spec.get('mode') in ['recovered-featurecounts', 'recovered-symbol-matrix']:
        return audit_recovered(record, config, spec, sheet, output_header, output_rows, input_path, sheet_path)
    if spec.get('mode') == 'sample-files':
        return audit_files(record, config, spec, sheet, output_header, output_rows, input_path, sheet_path)
    source_header, source_rows = load_table(spec['source'], spec.get('sheet'), spec.get('dropEmptyHeaders', False), spec.get('encoding', 'utf-8-sig'))
    source_columns = []
    consumed = [spec['source'], input_path, sheet_path]
    if spec.get('downloadLog'):
        log = json.loads((ROOT / spec['downloadLog']).read_text())
        payload = (ROOT / spec['source']).read_bytes()
        url = 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE285nnn/GSE285906/suppl/GSE285906_Hypothalamus_raw_counts.txt.gz'
        if log['status'] != 200 or log['url'] != url or log['finalUrl'] != url or log['bytes'] != len(payload) or log['sha256'] != hashlib.sha256(payload).hexdigest():
            raise ValueError('independent GEO download log is inconsistent with retained source')
        consumed.extend([spec['downloadLog'], spec['downloadScript']])
    series_libraries = {}
    if spec['columnRule'] == 'series-library':
        rows = [next(csv.reader([line], delimiter='\t')) for line in gzip.decompress((ROOT / spec['series']).read_bytes()).decode('utf8').splitlines() if line.strip()]
        titles = next(row[1:] for row in rows if row[0] == '!Sample_title')
        descriptions = next(row[1:] for row in rows if row[0] == '!Sample_description')
        if len(titles) != len(set(titles)) or len(titles) != len(descriptions):
            raise ValueError('ambiguous GEO library/title join')
        series_libraries = dict(zip(titles, descriptions))
        consumed.append(spec['series'])
    for row in sheet:
        sample, rule = row['sample'], spec['columnRule']
        column = {'same': lambda: sample, 'samplesheet': lambda: row['source_column'],
                  'diet-prefix': lambda: sample.split('_')[-1], 'S-prefix': lambda: sample[1:],
                  'bam-suffix': lambda: sample + '.bam', 'count-suffix': lambda: sample + '_count',
                  'raw-prefix': lambda: 'raw-' + sample,
                  'Mona-suffix': lambda: sample.split('_')[-1] + 'Mona_totalmRNAseq',
                  'series-library': lambda: 'Sample_' + series_libraries[sample].removeprefix('Library name: ')}[rule]()
        source_columns.append(column)
    if len(set(source_columns)) != len(source_columns):
        raise ValueError('multiple registered samples mapped to the same source column')
    source_indices = []
    duplicate_columns = {}
    for col in source_columns:
        matches = [j for j, name in enumerate(source_header) if name == col]
        if len(matches) > 1 and spec.get('duplicateColumns') == 'require-identical-complete-values':
            if any(any(value(row[j]) != value(row[matches[0]]) for j in matches[1:]) for row in source_rows):
                raise ValueError(f'duplicate source columns for {col} contain different values')
            source_indices.append(matches[0])
            duplicate_columns[col] = matches
        else:
            source_indices.append(index(source_header, col))
    output_indices = [index(output_header, col) for col in samples]
    output_id = 0 if config['id_col'] == 'NA' else index(output_header, config['id_col'])
    source_id = index(source_header, spec.get('sourceId', 0 if config['id_col'] == 'NA' else config['id_col']))
    source_ids = [row[source_id] for row in source_rows]
    output_ids = [row[output_id] for row in output_rows]
    if spec['featureRule'] == 'trim':
        source_ids = [key.strip() for key in source_ids]
    if spec['featureRule'] == 'strip-literal-tab':
        source_ids = [key.removeprefix('\t') for key in source_ids]
    if spec['featureRule'] == 'chicken-workbook':
        names = [row[index(source_header, 'Name')] for row in source_rows]
        counts = collections.Counter(names)
        expected = [name if re.fullmatch(r'(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._-]*', name) and counts[name] == 1 else '__UNMAPPED_GALG_' + key for key, name in zip(source_ids, names)]
        mh, mr = load_table(spec['mapping'])
        mapping = [dict(zip(mh, row)) for row in mr]
        if [(row['source_ensembl_id'], row['source_name'], row['output_label']) for row in mapping] != list(zip(source_ids, names, expected)):
            raise ValueError('retained chicken identifier mapping differs from independent workbook mapping')
        source_ids = expected
        consumed.append(spec['mapping'])
    if spec['featureRule'] == 'authority-map':
        pairs = set()
        if config['id'] == 'GSE104255':
            ah, ar = load_table(spec['authority'])
            pairs = {(row[index(ah, 'ensembl_gene_id')], row[index(ah, 'gene_id')]) for row in ar}
            mapping_key = 'source_ensembl_id'
            prefix = '__UNMAPPED_GALG_'
        elif config['id'] == 'GSE141144':
            for line in gzip.decompress((ROOT / spec['authority']).read_bytes()).decode('utf8').splitlines():
                gene = re.search(r'gene_id "([^"]+)"', line)
                name = re.search(r'gene_name "([^"]+)"', line)
                if gene and name:
                    pairs.add((gene[1], name[1]))
            mapping_key = 'source_gene_id'
            prefix = '__UNMAPPED_DRER_'
        else:
            # NCBI gene_info has a #tax_id header, not a comment to discard.
            text = gzip.decompress((ROOT / spec['authority']).read_bytes()).decode('utf8')
            data = list(csv.DictReader(text.splitlines(), delimiter='\t'))
            if any(row['#tax_id'] != '7955' for row in data):
                raise ValueError('unexpected species in NCBI authority')
            pairs = {(row['GeneID'], row['Symbol']) for row in data}
            mapping_key = 'source_symbol'
            prefix = '__UNMAPPED_DRER_ROW_'
        pairs = {(key, name) for key, name in pairs if re.fullmatch(r'(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._-]*', name)}
        key_counts = collections.Counter(key for key, _ in pairs)
        pairs = {(key, name) for key, name in pairs if key_counts[key] == 1}
        name_counts = collections.Counter(name for _, name in pairs)
        valid = {key: name for key, name in pairs if name_counts[name] == 1}
        if config['id'] == 'GSE299412':
            valid_symbols = set(valid.values())
            expected = [key if key in valid_symbols else prefix + f'{j + 1:05d}' for j, key in enumerate(source_ids)]
        else:
            expected = [valid.get(key, prefix + key) for key in source_ids]
        mh, mr = load_table(spec['mapping'])
        mapping = [dict(zip(mh, row)) for row in mr]
        if [(row[mapping_key], row['output_label']) for row in mapping] != list(zip(source_ids, expected)):
            raise ValueError('retained identifier map differs from independent authority reconstruction')
        source_ids = expected
        consumed.extend([spec['mapping'], spec['authority']])
    source_values = [[value(row[j]) for j in source_indices] for row in source_rows]
    output_values = [[value(row[j]) for j in output_indices] for row in output_rows]
    original_rows = len(source_ids)
    original_sums = [math.fsum(row[j] for row in source_values) for j in range(len(samples))]
    rounding_runtime = None
    if spec.get('rounding'):
        requested_rscript = os.environ.get('RSCRIPT')
        rscript = (shutil.which(requested_rscript) or requested_rscript) if requested_rscript else shutil.which('Rscript')
        if not rscript and Path('C:/Program Files/R/R-4.4.1/bin/Rscript.exe').exists():
            rscript = 'C:/Program Files/R/R-4.4.1/bin/Rscript.exe'
        if not rscript or not Path(rscript).is_file():
            raise ValueError('An R replay runtime is required: set RSCRIPT or put Rscript on PATH (the original evidence used R 4.4.1).')
        original = [v for row in source_values for v in row]
        run = subprocess.run([str(rscript), str(ROOT / 'scripts/round_conservation_values.R')],
            input='\n'.join(format(v, '.17g') for v in original), text=True, capture_output=True, check=True)
        rounded = [value(v) for v in run.stdout.splitlines()]
        if len(rounded) != len(original) or any(round(v) != actual for v, actual in zip(original, rounded)):
            raise ValueError('complete R round replay disagrees with independent nearest/even rounding')
        source_values = [rounded[j:j + len(samples)] for j in range(0, len(rounded), len(samples))]
        rounding_runtime = '\n'.join(line.strip() for line in run.stderr.splitlines()
                                     if line.startswith(('R version ', 'round(x), digits=0;')))
        consumed.append('scripts/round_conservation_values.R')
    if spec.get('aggregateDuplicates'):
        grouped = {}
        for key, values in zip(source_ids, source_values):
            grouped.setdefault(key, []).append(values)
        source_ids = list(grouped)
        source_values = [[math.fsum(row[j] for row in grouped[key]) for j in range(len(samples))] for key in source_ids]
    sample_records, join = compare_rows(source_ids, source_values, output_ids, output_values, samples)
    for row in sample_records:
        row['original_source_rows'] = original_rows
        row['aggregated_source_rows'] = len(source_ids)
        if spec.get('rounding'):
            j = samples.index(row['sample'])
            row['transformed_source_library_size'] = row['source_library_size']
            row['source_library_size'] = original_sums[j]
            row['declared_rounding_delta'] = row['transformed_source_library_size'] - original_sums[j]
            row['original_unadjusted_delta'] = row['output_library_size'] - original_sums[j]
            row['rounded_source_cells'] = sum(value(source_rows[i][source_indices[j]]) != source_values[i][j] for i in range(original_rows))
    prep = 'geo_replication/scripts/prep_' + config['id'] + '.R'
    if config['id'] in ['GSE235479', 'E-MTAB-6929']:
        prep = 'geo_replication/scripts/prep_2026batch2.R'
    saved_prep = retained_preparation(prep)
    if saved_prep:
        consumed.append(saved_prep)
    if spec.get('rounding') and not saved_prep:
        raise ValueError('declared rounding requires retained original preparation code')
    return {'datasetId': record['datasetId'], 'configId': config['id'], 'config': config,
            'inputPath': input_path, 'samplesheetPath': sheet_path, 'specification': spec,
            'pins': [pin(path) for path in consumed], 'featureJoin': join,
            'sourceColumns': dict(zip(samples, source_columns)), 'samples': sample_records,
            'duplicateColumnsVerifiedIdentical': duplicate_columns, 'roundingRuntime': rounding_runtime,
            'comparedCells': len(output_rows) * len(samples),
            'status': 'pass' if all(row['status'] == 'pass' for row in sample_records) else 'review'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--only', help='comma-separated config IDs for diagnostic output only')
    args = parser.parse_args()
    with open(ROOT / CONFIG, encoding='utf-8-sig', newline='') as stream:
        configs = {row['id']: row for row in csv.DictReader(stream, delimiter='\t')}
    baseline = json.loads((ROOT / BASELINE).read_text())
    plan_path = FOLDER + '/specifications.json'
    plan = [{'datasetId': record['datasetId'], 'configId': record['configId'],
             'inputPath': record['input'], 'specification': source_spec(record, configs[record['configId']]) if record['configId'] else None}
            for record in baseline]
    if not args.only:
        if args.check:
            if json.loads((ROOT / plan_path).read_text()) != plan:
                raise SystemExit('Reviewed conservation specifications differ from the audit implementation')
        else:
            (ROOT / plan_path).write_text(json.dumps(plan, indent=2) + '\n', encoding='utf8', newline='\n')
    records = []
    for record in baseline:
        id = record['configId']
        if args.only and id not in args.only.split(','):
            continue
        config = configs.get(id)
        spec = source_spec(record, config) if config else None
        if not spec:
            blockers = {
                None: 'No original atlas raw or pseudobulk count object is retained; data/raw/results contains downstream DE/CPM exports only. See advancement-2026-09-05/macaque/INPUT_SEARCH.md.',
                'GSE282067': 'Original raw/GSE282067_RAW.tar and prep_GSE282067.R are present. Selected Salmon NumReads require R rounding, RefSeq suffix removal, the exact org.Mm.eg.db REFSEQ-to-SYMBOL projection, and symbol summation; a complete independently bound mapping replay is not retained in this audit.',
                'GSE236077': 'Original raw/GSE236077_counts.csv.gz repeats each selected GSM across five regional columns. prep_GSE236077.R chooses the first occurrence as hypothalamus, supported by marker maxima in only 10/12 libraries. An authoritative region-to-column key is not retained; this audit does not infer biological identity from marker expression.',
            }
            if id == 'GSE205313':
                blockers[id] = 'Complete deposited Salmon counts were authenticated for all 11 selected hypothalamus libraries (140,948 transcripts each), but the exact transcript annotation release, transcript-to-symbol map and original gene summarization/rounding remain absent. No current annotation or fitted mapping is substituted; transcript-source totals alone cannot prove registered gene-count conservation. See data/internal-qc/source-authenticity-2026-09-05/round2/replays/GSE205313/salmon-source-audit.json.'
            result = {'datasetId': record['datasetId'], 'configId': id, 'status': 'not_assessed',
                      'blocker': blockers.get(id, 'No independently audited source-to-input transformation implemented; original source/cohort/count conversion requires further inspection.'),
                      'searchedInput': record['input'], 'rawFilesInspected': record['rawFiles']}
        else:
            try:
                result = audit(record, config, spec)
            except (ValueError, KeyError, OSError, IndexError) as error:
                result = {'datasetId': record['datasetId'], 'configId': id, 'status': 'not_assessed',
                          'specification': spec, 'blocker': str(error)}
        records.append(result)
        print(f"{id}: {result['status']} {result.get('blocker', str(result.get('comparedCells', 0)) + ' cells')}", flush=True)
    if args.only:
        return
    evidence = {'schemaVersion': 1, 'version': VERSION, 'fingerprintConvention': SCHEME,
                'scope': 'Complete deposited source feature counts to current registered input, every selected analysis sample. Excludes upstream sequencing QC, biological identity and downstream gene mapping/normalization.',
                'script': pin(SCRIPT), 'baseline': pin(BASELINE), 'plan': pin(plan_path), 'records': records}
    encoded = json.dumps(evidence, indent=2, ensure_ascii=True) + '\n'
    if args.check:
        if not evidence_matches(json.loads((ROOT / EVIDENCE).read_text()), evidence):
            raise SystemExit('Conservation evidence is stale or altered; regenerate after reviewing the difference.')
        print('Saved conservation evidence matches a complete independent recomputation.')
        for runtime in sorted({row['roundingRuntime'] for row in records if row.get('roundingRuntime')}):
            print('Current rounding replay runtime (original run provenance remains unchanged in the artifact):\n' + runtime)
    else:
        (ROOT / EVIDENCE).write_text(encoded, encoding='utf8', newline='\n')
    print(dict(collections.Counter(row['status'] for row in records)))


if __name__ == '__main__':
    main()
