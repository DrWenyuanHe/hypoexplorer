"""Build navigation metric shards and comparison data from the published atlas.

Reads the CELLxGENE mouse HypoMap H5AD (raw counts in raw/X) and writes the browser
export src/search/hypomap/atlas.ts reads plus the comparison index services/hypomap
serves. Inputs and their pins: data/hypomap/provenance.json; runbook: data/hypomap/README.md.

Written by Helene Li (DrWenyuanHe/hypoexplorer-data#1, 51755a3); the export logic is
unchanged so that the pinned release can be reproduced byte for byte.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
from collections import defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path

import h5py
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix

from gene_sources import load_gene_source_indexes


def _decode_array(values) -> np.ndarray:
    return np.array(
        [x.decode() if isinstance(x, bytes) else str(x) for x in values],
        dtype=object,
    )


def _obs_column(obs, key: str) -> np.ndarray:
    obj = obs[key]
    if isinstance(obj, h5py.Group) and {"categories", "codes"}.issubset(obj.keys()):
        categories = _decode_array(obj["categories"][:])
        codes = obj["codes"][:]
        return np.array([categories[c] if c >= 0 else "" for c in codes], dtype=object)
    return _decode_array(obj[:])


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def write_json(root, name, value, compresslevel=9):
    payload = json.dumps(value, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()
    compressed = gzip.compress(payload, compresslevel=compresslevel, mtime=0)
    (root / name).write_bytes(compressed)
    return {'path': name, 'bytes': len(compressed), 'uncompressed_bytes': len(payload),
            'sha256': hashlib.sha256(compressed).hexdigest()}


WHOLE = 'Whole hypothalamus'
NO_REGION = 'No HypoMap region'
NO_C7 = 'Unannotated C7'


def gene_index(var, mgi_source):
    ids = _obs_column(var, '_index')
    names = _obs_column(var, 'feature_name')
    if len(set(ids)) != len(ids):
        raise ValueError('Duplicate atlas feature IDs')
    source, current, aliases = load_gene_source_indexes(mgi_source)
    by_ensembl = defaultdict(list)
    for gene in source.values():
        if gene.ensembl_gene_id:
            by_ensembl[gene.ensembl_gene_id].append(gene)
    genes, lookup = [], {}
    symbols = defaultdict(set)
    for col in sorted(range(len(ids)), key=lambda i: (names[i].casefold(), ids[i])):
        feature, name = ids[col], names[col]
        candidates = by_ensembl[feature]
        gene = candidates[0] if len(candidates) == 1 else None
        symbol = gene.canonical_symbol if gene else name or feature
        index = len(genes)
        genes.append([feature, symbol, gene.marker_name if gene else name, feature])
        for key in (feature, symbol, name):
            if key:
                symbols[key.casefold()].add(index)
        if gene:
            lookup[gene.canonical_gene_id] = index
    alias_lookup = {}
    outside = {}
    for key, candidates in aliases.items():
        positions = sorted(lookup[i] for i in candidates if i in lookup)
        if positions:
            alias_lookup[key] = positions
            if key not in current:
                outside[key] = [source[i].as_candidate() for i in sorted(candidates) if i not in lookup]
    return {'genes': genes, 'current_symbols': {k: sorted(v) for k, v in symbols.items()},
            'aliases': alias_lookup, 'outside_export_candidates': outside}, ids, names


def masks(values):
    return {str(label): np.packbits(values == label, bitorder='little').tobytes().hex()
            for label in np.unique(values)}


def summarize(raw, library, columns, region_codes, region_count, bits):
    counts = np.zeros((len(columns), region_count + 1), dtype=np.uint32)
    sums = np.zeros(counts.shape)
    flags = np.zeros(raw.shape[0], dtype=np.uint8)
    for i, col in enumerate(columns):
        start, stop = raw.indptr[col:col + 2]
        rows = raw.indices[start:stop]
        values = np.log1p(10000.0 * raw.data[start:stop] / library[rows])
        counts[i, 0] = len(rows)
        counts[i, 1:] = np.bincount(region_codes[rows], minlength=region_count)
        sums[i, 1:] = np.bincount(region_codes[rows], weights=values, minlength=region_count)
        flags.fill(0)
        flags[rows] = 1
        bits[i] = np.packbits(flags, bitorder='little')
    sums[:, 0] = sums[:, 1:].sum(axis=1)
    return counts, sums


def build(atlas, out, pair_out, shard_size, cards_path, mgi_source, generated_at):
    if shard_size < 1:
        raise ValueError('Shard size must be positive')
    for folder in (out, pair_out):
        folder.mkdir(parents=True, exist_ok=False)
    cards = pd.read_csv(cards_path, dtype=str).fillna('').set_index('HypoMap_label', drop=False)
    datasets = cards.GEO_Acc.tolist()
    if not cards.index.is_unique or len(set(datasets)) != len(cards):
        raise ValueError('Study card dataset IDs must be unique')
    with h5py.File(atlas, 'r') as f:
        obs = f['obs']
        labels = _obs_column(obs, 'Dataset')
        regions = _obs_column(obs, 'Region_summarized')
        c7 = _obs_column(obs, 'C7_named')
        samples = _obs_column(obs, 'Sample_ID')
        regions[np.isin(regions, ['', 'NA'])] = NO_REGION
        c7[np.isin(c7, ['', 'NA'])] = NO_C7
        if set(labels) != set(cards.index):
            raise ValueError('Atlas and study card datasets differ')
        contexts = [WHOLE, *sorted(set(regions) - {NO_REGION}), NO_REGION]
        c7_labels = [*sorted(set(c7) - {NO_C7}), NO_C7]
        search, features, names = gene_index(f['raw/var'], mgi_source)
        cols_by_id = {feature: i for i, feature in enumerate(features)}
        columns = np.array([cols_by_id[g[0]] for g in search['genes']])
        inverse = np.argsort(columns).astype(np.int32)
        mappings = [[str(features[i]), str(names[i]), 'atlas_feature_id'] for i in columns]
        matrix = f['raw/X']
        ptr = matrix['indptr'][:]
        shape = tuple(matrix.attrs['shape'])
        if shape != (len(labels), len(features)):
            raise ValueError('Atlas expression and metadata dimensions differ')
        eligible, c7_eligible, coverage = {}, {}, {}
        all_counts, all_sums, pair_datasets = [], [], []
        for label, ds in zip(cards.index, datasets):
            file_key = ds.replace('/', '_')
            rows = np.flatnonzero(labels == label)
            n = len(rows)
            if n != int(cards.at[label, 'N_cells_in_HypoMap']):
                raise ValueError(f'{label}: atlas count differs from the study card')
            if rows[-1] - rows[0] + 1 != n:
                raise ValueError(f'{label}: atlas dataset rows must be contiguous')
            print(f'{label}: summarizing {n:,} cells', flush=True)
            lo, hi = ptr[rows[0]], ptr[rows[-1] + 1]
            data = matrix['data'][lo:hi]
            if np.any(~np.isfinite(data) | (data <= 0) | (data != np.floor(data))):
                raise ValueError(f'{label}: invalid stored raw counts')
            raw = csr_matrix((data, matrix['indices'][lo:hi], ptr[rows[0]:rows[-1]+2]-lo),
                             shape=(n, len(features)))
            if not raw.has_canonical_format:
                raise ValueError(f'{label}: unordered or duplicate count entries')
            library = np.asarray(raw.sum(axis=1, dtype=np.float64)).ravel()
            if np.any(library <= 0):
                raise ValueError(f'{label}: nonpositive library size')
            local_regions, local_c7 = regions[rows], c7[rows]
            region_map = {v: i for i, v in enumerate(contexts[1:])}
            region_codes = np.array([region_map[v] for v in local_regions])
            eligible[ds] = [n, *np.bincount(region_codes, minlength=len(contexts)-1).tolist()]
            c7_eligible[ds] = [int(np.count_nonzero(local_c7 == v)) for v in c7_labels]
            coverage[ds] = {'total_cells': n, 'blank_hypomap_region': eligible[ds][-1],
                            'blank_hypomap_C7': c7_eligible[ds][-1],
                            'blank_sample_id': int(np.isin(samples[rows], ['', 'NA']).sum())}
            np.save(pair_out / f'{file_key}.rows.npy', raw.indptr)
            np.save(pair_out / f'{file_key}.columns.npy', inverse[raw.indices])
            raw = raw.tocsc()
            bits_path = pair_out / f'{file_key}.npy'
            bits = np.lib.format.open_memmap(bits_path, mode='w+', dtype=np.uint8,
                                              shape=(len(features), (n+7)//8))
            counts, sums = summarize(raw, library, columns, region_codes, len(contexts)-1, bits)
            bits.flush()
            del bits, raw, data
            if (counts > eligible[ds]).any() or not np.array_equal(counts[:, 0], counts[:, 1:].sum(1)):
                raise ValueError(f'{label}: expression totals do not reconcile')
            all_counts.append(counts)
            all_sums.append(sums)
            meta_path = pair_out / f'{file_key}.json'
            meta_path.write_text(json.dumps({'states': None,
                                             'regions': masks(local_regions), 'c7': masks(local_c7)}))
            pair_datasets.append({'id': ds, 'file_key': file_key, 'n_cells': n, 'source_sha256': {},
                                  'bits_sha256': digest(bits_path), 'metadata_sha256': digest(meta_path),
                                  'rows_sha256': digest(pair_out / f'{file_key}.rows.npy'),
                                  'columns_sha256': digest(pair_out / f'{file_key}.columns.npy')})
    np.save(pair_out / 'marginals.npy', np.stack([counts[:, 0] for counts in all_counts]).sum(axis=0))
    source_hash = digest(atlas)
    metadata = {'datasets': datasets, 'study_cards': cards.to_dict('records'), 'contexts': contexts,
                'eligible_cells': eligible, 'c7_labels': c7_labels, 'c7_eligible_cells': c7_eligible,
                'annotation_coverage': coverage, 'cohort': 'Published HypoMap atlas',
                'count_source': 'HypoMap raw/X', 'atlas_cells': len(labels)}
    files = [write_json(out, 'metadata.json.gz', metadata), write_json(out, 'search-index.json.gz', search)]
    for start in range(0, len(features), shard_size):
        records = []
        for i in range(start, min(start + shard_size, len(features))):
            records.append([i, [mappings[i]] * len(datasets),
                            [[c[i].tolist(), s[i].tolist()] for c, s in zip(all_counts, all_sums)]])
        files.append(write_json(out, f'genes-{start//shard_size:04d}.json.gz', records, compresslevel=4))
    manifest = {'schema_version': 1, 'generated_at': generated_at or datetime.now(timezone.utc).isoformat(),
                'gene_count': len(features), 'shard_size': shard_size, 'files': files,
                'compressed_payload_bytes': sum(item['bytes'] for item in files),
                'recommendations': {'state': 'on_demand'},
                'metric_contract': {'positivity': 'raw count >= 1',
                                    'normalization': 'ln(1 + 10000 * count / sum of raw/X counts)',
                                    'feature_scope': 'shared atlas feature axis'},
                'source_sha256': {'hypomap_h5ad': source_hash, 'study_card': digest(cards_path)}}
    path = out / 'manifest.json'
    path.write_text(json.dumps(manifest, indent=2) + '\n')
    (pair_out / 'manifest.json').write_text(json.dumps({
        'schema_version': 1, 'genes': search['genes'], 'datasets': pair_datasets,
        'source_export_manifest_sha256': digest(path), 'cohort': metadata['cohort'],
        'positivity': 'raw_count >= 1', 'bitorder': 'little'}))
    print(f'{len(features):,} features, {len(labels):,} atlas cells, {len(datasets)} datasets', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--atlas', type=Path, required=True)
    parser.add_argument('--out-dir', type=Path, default=Path('tmp/atlas_navigation_export'))
    parser.add_argument('--pair-dir', type=Path, default=Path('tmp/atlas_comparison_index'))
    parser.add_argument('--shard-size', type=int, default=256)
    parser.add_argument('--study-card', type=Path, required=True)
    parser.add_argument('--mgi-source', type=Path, required=True)
    parser.add_argument('--generated-at', help='Use the original ISO timestamp when reproducing a release')
    args = parser.parse_args()
    build(args.atlas, args.out_dir, args.pair_dir, args.shard_size, args.study_card, args.mgi_source, args.generated_at)
