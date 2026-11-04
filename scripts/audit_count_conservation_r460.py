"""Source-to-input count conservation for the inputs the R 4.6.0 regeneration re-prepared.

Successor of scripts/audit_count_conservation.py for the five count datasets whose
registered input changed on September 25, 2026 (rule B1: count estimates are no
longer rounded). The September 5 evidence in data/internal-qc/conservation-2026-09-05
describes the replaced, rounded inputs; it and its producer stay byte-identical.

- GSE235479, E-MTAB-6929, GSE229838: the September 5 comparison of the deposited
  matrix with every registered count, reused from the sealed producer, without the
  declared-rounding step. Conservation must now be exact.
- GSE205313: every hypothalamic Salmon transcript quantification in the GEO archive
  is summed per gene name of the pinned Ensembl GRCm38 release 102 GTF, parsed here
  independently of scripts/regen-r460/prep_GSE205313_r460.R.
- GSE282067: every Salmon gene quantification in the GEO archive is summed per
  symbol after the declared RefSeq-to-SYMBOL projection with org.Mm.eg.db (R).
- E-MTAB-12340, GSE128148: scripts/regen-r460/supported_matrix_r460.R rewrote the
  prepared analysis matrices (new symbol column, same counts). Every retained count
  is compared by original feature ID with the deposited matrix, as the September 5
  conservation replay (scripts/audit_internal_conservation.mts) did; E-MTAB-12340's
  92 ERCC spike-in rows are the only permitted exclusions.

Every registered count is compared, per-library source and output totals are
recorded, and no tolerance other than 1e-6 absolute per value is allowed.
Run from the repository root:

    python scripts/audit_count_conservation_r460.py            write the evidence
    python scripts/audit_count_conservation_r460.py --check    recompute and compare
"""
import argparse
import collections
import copy
import csv
import gzip
import importlib.util
import io
import json
import math
import os
import re
import shutil
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOLDER = 'data/internal-qc/conservation-r460-2026-09-25'
SCRIPT = 'scripts/audit_count_conservation_r460.py'
SEALED = 'scripts/audit_count_conservation.py'
VERSION = 'source-count-reconciliation-r460-v1'
EVIDENCE = FOLDER + '/conservation-evidence.json'
CONFIG = 'geo_replication/config/datasets.tsv'

_spec = importlib.util.spec_from_file_location('sealed_conservation', ROOT / SEALED)
sealed = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sealed)
pin, load_table, compare_rows, value = sealed.pin, sealed.load_table, sealed.compare_rows, sealed.value

PREPARATION = {
    'GSE235479': 'scripts/regen-r460/prep_2026batch2_r460.R',
    'E-MTAB-6929': 'scripts/regen-r460/prep_2026batch2_r460.R',
    'GSE229838': 'scripts/regen-r460/prep_GSE229838_r460.R',
    'GSE205313': 'scripts/regen-r460/prep_GSE205313_r460.R',
    'GSE282067': 'scripts/regen-r460/prep_GSE282067_r460.R',
    'E-MTAB-12340': 'scripts/regen-r460/supported_matrix_r460.R',
    'GSE128148': 'scripts/regen-r460/supported_matrix_r460.R',
}
DATASETS = {
    'GSE235479': 'mouse_hypo_hfhs_gse235479',
    'E-MTAB-6929': 'mouse_hypo_hfd_emtab6929',
    'GSE229838': 'mouse_hypo_pel_gse229838',
    'GSE205313': 'mouse_hypo_astro_hfhs_gse205313',
    'GSE282067': 'mouse_hypo_treg_gse282067',
    'E-MTAB-12340': 'mouse_hypo_puberty_emtab12340',
    'GSE128148': 'mouse_arc_corticosterone_gse128148',
}
PREPARED_SOURCES = {
    'E-MTAB-12340': ('raw/hypo_utr-seq_unfiltered_countmat.csv', r'ERCC-[0-9]+', 92),
    'GSE128148': ('raw/GSE128148_2019_Wray_4week_raw_counts.txt.gz', None, 0),
}


def registered(config):
    input_path = 'geo_replication/' + config['input_path']
    sheet_path = 'geo_replication/' + config['samplesheet']
    header, rows = load_table(sheet_path)
    sheet = [dict(zip(header, row)) for row in rows]
    sheet = [row for row in sheet if row.get('group') in ['control', 'case']]
    samples = [row['sample'] for row in sheet]
    if not samples or len(set(samples)) != len(samples):
        raise ValueError('registered samples missing or duplicated')
    output_header, output_rows = load_table(input_path)
    output_id = 0 if config['id_col'] == 'NA' else sealed.index(output_header, config['id_col'])
    ids = [row[output_id] for row in output_rows]
    values = [[value(row[sealed.index(output_header, s)]) for s in samples] for row in output_rows]
    return input_path, sheet_path, sheet, samples, ids, values


def matrix_record(config, record):
    """September 5 deposited-matrix comparison without the retired rounding step."""
    spec = sealed.source_spec(record, config)
    spec = {key: val for key, val in spec.items() if key != 'rounding'}
    spec['note'] = ('Complete deposited source rows compared with every registered count after explicit sample-column '
                    'selection; the R 4.6.0 preparation keeps count estimates unrounded (rule B1), so every value must match exactly.')
    result = sealed.audit(record, config, spec)
    if result.get('roundingRuntime') is not None:
        raise ValueError('unexpected rounding replay')
    del result['roundingRuntime']
    retained = sealed.FOLDER + '/preparation/'
    result['pins'] = [p for p in result['pins'] if not p['path'].startswith(retained)]
    result['specification'] = spec
    return result


def prepared_record(config, dataset_id):
    """Deposited matrix to the rewritten prepared analysis matrix, by original feature ID."""
    input_path, sheet_path, sheet, samples, ids, values = registered(config)
    relative, pattern, expected_exclusions = PREPARED_SOURCES[config['id']]
    source_path = 'geo_replication/' + config['dir'] + '/' + relative
    output_header, output_rows = load_table(input_path)
    output_ids = [row[0] for row in output_rows]
    header, rows = load_table(source_path)
    source_ids = [row[0] for row in rows]
    source_values = [[value(row[sealed.index(header, s)]) for s in samples] for row in rows]
    output_values = [[value(row[sealed.index(output_header, s)]) for s in samples] for row in output_rows]
    exclusions = set(source_ids) - set(output_ids)
    if len(exclusions) != expected_exclusions or (pattern and not all(re.fullmatch(pattern, key) for key in exclusions)):
        raise ValueError(f'source exclusion policy changed: {len(exclusions)} rows')
    sample_records, join = compare_rows(source_ids, source_values, output_ids, output_values, samples, exclusions)
    spec = {'source': source_path, 'mode': 'prepared-matrix', 'note': 'Retained gene counts compared by original feature identifier with the deposited source matrix. ' +
            ('All 92 technical ERCC spike-in rows are accounted for separately.' if pattern else 'No source rows are discarded.')}
    return {'datasetId': dataset_id, 'configId': config['id'], 'config': config, 'inputPath': input_path, 'samplesheetPath': sheet_path,
            'specification': spec, 'pins': [pin(p) for p in [source_path, input_path, sheet_path, PREPARATION[config['id']]]],
            'featureJoin': join, 'sourceColumns': {s: s for s in samples}, 'samples': sample_records,
            'comparedCells': len(output_ids) * len(samples), 'status': 'pass' if all(r['status'] == 'pass' for r in sample_records) else 'review'}


def archive_members(path, names):
    with tarfile.open(ROOT / path) as archive:
        inventory = archive.getnames()
        members = {}
        for name in names:
            if inventory.count(name) != 1:
                raise ValueError(f'{path}: member {name} is missing or duplicated')
            members[name] = gzip.decompress(archive.extractfile(name).read()).decode('utf8')
    return inventory, members


def read_sf(text, strip_version):
    rows = list(csv.DictReader(io.StringIO(text), delimiter='\t'))
    names = [row['Name'].split('.', 1)[0] if strip_version else row['Name'] for row in rows]
    if len(set(names)) != len(names):
        raise ValueError('duplicate quantification feature names')
    return dict(zip(names, (value(row['NumReads']) for row in rows)))


def sums_by_key(features, keys, columns):
    grouped = collections.OrderedDict()
    for feature, key in zip(features, keys):
        grouped.setdefault(key, []).append(feature)
    return grouped, {key: [math.fsum(columns[j][f] for f in members) for j in range(len(columns))] for key, members in grouped.items()}


def salmon_record(config, record, accession_rule):
    input_path, sheet_path, sheet, samples, ids, values = registered(config)
    raw = 'geo_replication/' + config['dir'] + '/raw/'
    if config['id'] == 'GSE205313':
        tar_path = raw + 'GSE205313_RAW.tar'
        sources = json.loads((ROOT / ('geo_replication/' + config['dir'] + '/metadata/r460_sources.json')).read_text())
        for entry in sources['files']:
            payload = (ROOT / entry['path']).read_bytes()
            if len(payload) != entry['bytes'] or sealed.hashlib.sha256(payload).hexdigest() != entry['sha256']:
                raise ValueError(f"source differs from r460_sources.json: {entry['path']}")
        members = {'HPT_SCdiet_1': 'GSM6210140_R_1.sf.gz', 'HPT_SCdiet_2': 'GSM6210141_R_2.sf.gz', 'HPT_SCdiet_3': 'GSM6210142_R_3.sf.gz',
                   'HPT_SCdiet_4': 'GSM6210143_R_4.sf.gz', 'HPT_SCdiet_5': 'GSM6210144_R_5.sf.gz', 'HPT_SCdiet_6': 'GSM6210145_R_6.sf.gz',
                   'HPT_HFHSdiet_1': 'GSM6210146_R_7.sf.gz', 'HPT_HFHSdiet_2': 'GSM6210147_R_8.sf.gz', 'HPT_HFHSdiet_3': 'GSM6210148_R_9.sf.gz',
                   'HPT_HFHSdiet_4': 'GSM6210149_R_11.sf.gz', 'HPT_HFHSdiet_5': 'GSM6210150_R_12.sf.gz'}
        authority = raw + 'Mus_musculus.GRCm38.102.gtf.gz'
        extra = ['geo_replication/' + config['dir'] + '/metadata/r460_sources.json', authority]
    else:
        tar_path = raw + 'GSE282067_RAW.tar'
        members = {'SD_Treg_67_71': 'GSM8635178_24L012443.quant.genes.sf.gz', 'SD_Treg_43_47': 'GSM8635180_24L012445.quant.genes.sf.gz',
                   'SD_Treg_11_15': 'GSM8635184_24L012449.quant.genes.sf.gz', 'SD_Treg_62_66': 'GSM8635186_24L012451.quant.genes.sf.gz',
                   'HFD_Treg_77_80': 'GSM8635179_24L012444.quant.genes.sf.gz', 'HFD_Treg_33_37': 'GSM8635181_24L012446.quant.genes.sf.gz',
                   'HFD_Treg_06_10': 'GSM8635182_24L012447.quant.genes.sf.gz', 'HFD_Treg_72_76': 'GSM8635183_24L012448.quant.genes.sf.gz'}
        authority = None
        extra = []
    if set(members) != set(samples):
        raise ValueError('registered samples differ from the declared archive members')
    inventory, texts = archive_members(tar_path, [members[s] for s in samples])
    columns = [read_sf(texts[members[s]], config['id'] == 'GSE205313') for s in samples]
    features = list(columns[0])
    if any(set(column) != set(features) for column in columns):
        raise ValueError('libraries were quantified against different references')
    if config['id'] == 'GSE205313':
        gene = {}
        for line in gzip.decompress((ROOT / authority).read_bytes()).decode('utf8').splitlines():
            if line.startswith('#'):
                continue
            fields = line.split('\t')
            if len(fields) < 9 or fields[2] != 'transcript':
                continue
            tx = re.search(r'transcript_id "([^"]*)"', fields[8])
            gid = re.search(r'gene_id "([^"]*)"', fields[8])
            name = re.search(r'gene_name "([^"]*)"', fields[8])
            if tx and tx[1] not in gene:
                gene[tx[1]] = name[1] if name and name[1] else gid[1]
        keys = [gene.get(f, f) for f in features]
        mapping_note = (f'{sum(f in gene for f in features):,} of {len(features):,} transcripts take the gene name of their Ensembl GRCm38 '
                        'release 102 GTF record (gene ID where no name is given); the rest keep their transcript ID')
        runtime = None
    else:
        requested = os.environ.get('RSCRIPT')
        rscript = (shutil.which(requested) or requested) if requested else shutil.which('Rscript')
        bases = [re.sub(r'^(N[MR]_[0-9]+).*$', r'\1', f) for f in features]
        code = ('suppressPackageStartupMessages(library(org.Mm.eg.db)); k <- readLines(file("stdin")); '
                'm <- AnnotationDbi::mapIds(org.Mm.eg.db, keys = k, keytype = "REFSEQ", column = "SYMBOL", multiVals = "first"); '
                'writeLines(ifelse(is.na(m), "", unname(m))); '
                'message(R.version.string); message("org.Mm.eg.db ", packageVersion("org.Mm.eg.db"))')
        run = subprocess.run([rscript, '--vanilla', '-e', code], input='\n'.join(bases) + '\n', text=True, capture_output=True, check=True)
        symbols = run.stdout.splitlines()
        if len(symbols) != len(bases):
            raise ValueError('incomplete RefSeq projection')
        keys = [s if s else b for s, b in zip(symbols, bases)]
        runtime = '\n'.join(line.strip() for line in run.stderr.splitlines() if line.startswith(('R version', 'org.Mm.eg.db')))
        if not runtime.startswith('R version 4.6.0') or 'org.Mm.eg.db 3.23.0' not in runtime:
            raise ValueError(f'RefSeq projection needs R 4.6.0 with org.Mm.eg.db 3.23.0: {runtime}')
        mapping_note = (f'{sum(bool(s) for s in symbols):,} of {len(features):,} RefSeq genes (version suffix removed) take their '
                        'org.Mm.eg.db 3.23.0 SYMBOL; the rest keep their RefSeq accession')
    grouped, sums = sums_by_key(features, keys, columns)
    if set(sums) != set(ids) or len(ids) != len(set(ids)):
        raise ValueError(f'feature coverage mismatch: {len(set(ids) - set(sums))} registered rows lack a source group, {len(set(sums) - set(ids))} source groups are absent')
    source_ids = list(sums)
    source_values = [sums[key] for key in source_ids]
    sample_records, join = compare_rows(source_ids, source_values, ids, values, samples)
    for j, row in enumerate(sample_records):
        row['original_source_rows'] = len(features)
        row['aggregated_source_rows'] = len(source_ids)
        row['original_source_library_size'] = math.fsum(columns[j].values())
        row['source_aggregation_delta'] = row['source_library_size'] - row['original_source_library_size']
        if abs(row['source_aggregation_delta']) > 1e-6:
            row['status'] = 'review'
    consumed = [tar_path, input_path, sheet_path, PREPARATION[config['id']], *extra]
    spec = {'source': tar_path, 'mode': 'salmon-archive', 'members': [members[s] for s in samples], 'mapping': mapping_note,
            'note': ('Every selected Salmon quantification in the GEO archive is summed, unrounded, per declared gene key and '
                     'compared with every registered count; the complete per-library NumReads totals are recorded next to the '
                     'aggregated totals. Upstream quantification is outside this check.')}
    result = {'datasetId': record['datasetId'], 'configId': config['id'], 'config': config,
              'inputPath': input_path, 'samplesheetPath': sheet_path, 'specification': spec,
              'pins': [pin(path) for path in consumed], 'featureJoin': join,
              'sourceColumns': {s: members[s] for s in samples}, 'sourceArchiveInventory': len(inventory),
              'samples': sample_records, 'comparedCells': len(ids) * len(samples),
              'status': 'pass' if all(row['status'] == 'pass' for row in sample_records) else 'review'}
    if runtime:
        result['mappingRuntime'] = runtime
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    with open(ROOT / CONFIG, encoding='utf-8-sig', newline='') as stream:
        configs = {row['id']: row for row in csv.DictReader(stream, delimiter='\t')}
    baseline = {row['configId']: row for row in json.loads((ROOT / sealed.BASELINE).read_text()) if row['configId']}
    records = []
    for config_id, dataset_id in DATASETS.items():
        config, record = configs[config_id], baseline.get(config_id)
        assert record is None or record['datasetId'] == dataset_id
        try:
            if config_id in PREPARED_SOURCES:
                result = prepared_record(config, dataset_id)
            elif config_id in ('GSE235479', 'E-MTAB-6929', 'GSE229838'):
                result = matrix_record(config, record)
            else:
                result = salmon_record(config, record, config_id)
            result['pins'].append(pin(PREPARATION[config_id])) if all(p['path'] != PREPARATION[config_id] for p in result['pins']) else None
        except (ValueError, KeyError, OSError, IndexError, subprocess.CalledProcessError) as error:
            result = {'datasetId': dataset_id, 'configId': config_id, 'status': 'not_assessed', 'blocker': str(error)}
        records.append(result)
        print(f"{config_id}: {result['status']} {result.get('blocker', str(result.get('comparedCells', 0)) + ' cells')}", flush=True)
    evidence = {'schemaVersion': 1, 'version': VERSION, 'fingerprintConvention': sealed.SCHEME,
                'scope': 'Deposited source counts to the registered inputs re-prepared by the R 4.6.0 regeneration (count estimates unrounded; prepared matrices rewritten), every selected analysis sample. Excludes upstream sequencing QC, biological identity and downstream gene mapping/normalization.',
                'supersedes': [sealed.EVIDENCE, 'data/internal-qc/advancement-2026-09-05/conservation-evidence.json', 'data/internal-qc/conservation-round2-2026-09-11/evidence.json'], 'script': pin(SCRIPT), 'sealedHelpers': pin(SEALED), 'records': records}
    encoded = json.dumps(evidence, indent=2, ensure_ascii=True) + '\n'
    target = ROOT / EVIDENCE
    if args.check:
        saved = json.loads(target.read_text())
        strip = lambda doc: [{k: v for k, v in r.items() if k != 'mappingRuntime'} for r in doc['records']]
        if {k: v for k, v in saved.items() if k != 'records'} != {k: v for k, v in evidence.items() if k != 'records'} or strip(saved) != strip(evidence):
            raise SystemExit('R 4.6.0 conservation evidence is stale or altered; regenerate after reviewing the difference.')
        print('Saved R 4.6.0 conservation evidence matches a complete independent recomputation.')
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(encoded, encoding='utf8', newline='\n')
    print(dict(collections.Counter(row['status'] for row in records)))


if __name__ == '__main__':
    main()
