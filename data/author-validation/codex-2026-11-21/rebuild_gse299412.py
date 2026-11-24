"""Rebuild GSE299412's withheld identifier mapping and author-effects table.

Both outputs must match the SHA-256 the comparison spec pins; nothing is written otherwise.
The mapping follows geo_replication/scripts/prep_GSE299412.R. Promotion comes from the released
feature map; gene IDs come from a current NCBI gene_info, where 11 symbols have since been
renamed and are listed here with their GeneIDs (the pinned hash confirms the choices).

    python rebuild_gse299412.py <Danio_rerio.gene_info.gz> [--write]
"""
import gzip
import hashlib
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DS = ROOT / 'geo_replication/datasets/GSE299412_drer_hypothalamus'
COUNTS = ROOT / 'data/author-validation/continued-sources/GSE299412/codex-2026-11-21/GSE299412_data.txt.gz'
COUNTS_SHA = '54623a5ff238b8bd228704ad41662f745ed497a0d14c9b701bf1d845142c3e3f'
MAPPING = DS / 'metadata/GSE299412_identifier_mapping.tsv'
MAPPING_SHA = '254ff0f71c5e531cb1fcfc03699bdcda30de1808f0cc44c606dcca6a9763a2d0'
EFFECTS = ROOT / 'data/author-validation/continued-sources/round2-2026-09-05/GSE299412/author-effects.tsv'
EFFECTS_SHA = '09aae865c1810d05f367611791c6ae0c36f95390c8c6342cf6198274dab43890'
RENAMED = {'LOC100149563': '100149563', 'atp6v1b2': '359840', 'atp6v1ba': '359839', 'dap1b': '58094',
           'fam49a': '378872', 'fam49ba': '337591', 'h3f3a': '406269', 'ipp': '570768', 'lnpa': '326761',
           'lnpk': '337509', 'tbrg1': '573117'}


def verified(name, data, expected):
    if hashlib.sha256(data).hexdigest() != expected:
        raise SystemExit(f'{name}: rebuilt bytes differ from the pin')
    print(f'{name}: {len(data)} bytes, matches the pin')
    return data


def lines(path):
    return gzip.decompress(path.read_bytes()).decode('utf8').split('\n')


verified('count matrix', COUNTS.read_bytes(), COUNTS_SHA)
symbols = [row.split('\t')[0] for row in lines(COUNTS)[1:] if row]
feature_map = [row.split('\t') for row in lines(DS / 'processed/GSE299412_feature_map.tsv.gz')[1:] if row]
promoted = {row[0] for row in feature_map if row[2] == 'mapped'}
gene_ids = dict(RENAMED)
for row in lines(Path(sys.argv[1])):
    cells = row.split('\t')
    if cells[0] == '7955' and cells[2] not in RENAMED:
        gene_ids.setdefault(cells[2], cells[1])
out = ['source_symbol\toutput_label\tmapping_status\tofficial_gene_id']
for number, symbol in enumerate(symbols, start=1):
    if symbol in promoted:
        out.append(f'{symbol}\t{symbol}\tmapped_exact_current_NCBI_official_symbol\t{gene_ids[symbol]}')
    else:
        out.append(f'{symbol}\t__UNMAPPED_DRER_ROW_{number:05d}\treserved_noncurrent_or_ambiguous_source_symbol\tNA')
mapping = verified('identifier mapping', ('\n'.join(out) + '\n').encode(), MAPPING_SHA)
if '--write' in sys.argv:
    MAPPING.write_bytes(mapping)
if not MAPPING.exists():
    raise SystemExit('run with --write to rebuild author-effects.tsv from the mapping')
spec = importlib.util.spec_from_file_location('round2', ROOT / 'scripts/prepare_author_round2.py')
round2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(round2)
effects = verified('author-effects.tsv', round2.table_text(round2.fish()['rows']).encode(), EFFECTS_SHA)
if '--write' in sys.argv:
    EFFECTS.parent.mkdir(parents=True, exist_ok=True)
    EFFECTS.write_bytes(effects)
