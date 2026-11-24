"""Check GSE179663's aligned author sign against library-size-scaled deposited counts."""
import csv
import gzip
import io
import math
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parents[1] / 'continued-sources/GSE179663/codex-2026-11-21'
counts = {}
with tarfile.open(HERE / 'GSE179663_RAW.tar') as archive:
    for member in archive:
        text = gzip.decompress(archive.extractfile(member).read()).decode()
        counts[member.name] = {row['gene_id']: float(row['expected_count'])
                               for row in csv.DictReader(io.StringIO(text), delimiter='\t')}
torpor = [name for name in counts if 'SPHT' in name]
normothermic = [name for name in counts if 'SPNT' in name]
size = {name: sum(values.values()) for name, values in counts.items()}


def mean(names, gene):
    return sum(counts[name][gene] / size[name] for name in names) / len(names)


same = opposite = 0
with (HERE / 'refute/author-torpor-ht-minus-nt.tsv').open(encoding='utf8', newline='') as handle:
    for row in csv.DictReader(handle, delimiter='\t'):
        gene, effect = row['GeneID'], float(row['HT_minus_NT_log2FC'])
        if any(gene not in counts[name] for name in torpor + normothermic):
            continue
        case, control = mean(torpor, gene), mean(normothermic, gene)
        if case <= 0 or control <= 0 or case == control or effect == 0:
            continue
        agree = (math.log2(case / control) > 0) == (effect > 0)
        same, opposite = same + agree, opposite + (not agree)
print(f'{len(torpor)} torpor, {len(normothermic)} normothermic; same direction {same}, opposite {opposite}')
