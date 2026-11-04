"""Prepare reviewed bulk contrasts from the September 5 source inventory."""
import gzip
import json
import re
import pandas as pd
import numpy as np
from intake_september5 import ROOT, DISCOVERY, OUT, dataset_dir, inventory, soft_records

STUDIES = []
LEDGER = {r['accession']: r for r in inventory()}


def add(acc, name, category, region, preparation, perturbation, frame, ids, symbols,
        groups, contrasts, sample_info, organism='Mus musculus', note='', kind='counts'):
    """Keep explicit source IDs, sample order, and all exclusions before modeling."""
    folder = dataset_dir(acc)
    folder.joinpath('processed').mkdir(exist_ok=True)
    samples = [s for group in groups for s in groups[group]['samples']]
    assert len(samples) == len(set(samples)) and all(s in frame for s in samples)
    mat = frame[samples].apply(pd.to_numeric, errors='raise')
    assert np.isfinite(mat.to_numpy()).all()
    if kind != 'matrix_log':
        assert (mat.to_numpy() >= 0).all() and (mat.sum(axis=0) > 0).all()
    assert len(ids) == len(mat) and not pd.Series(ids).duplicated().any()
    out = mat.copy()
    out.insert(0, 'symbol', pd.Series(symbols).fillna('').astype(str).to_numpy())
    out.insert(0, 'gene_id', pd.Series(ids).astype(str).to_numpy())
    matrix = folder / 'processed' / (acc + '_source_counts.tsv.gz')
    out.to_csv(matrix, sep='\t', index=False)
    sheet = []
    for group, data in groups.items():
        for sample in data['samples']:
            sheet.append({'sample': sample, 'group': group, **sample_info[sample], 'included': True, 'reason': ''})
    for sample, info in sample_info.items():
        if sample not in samples:
            sheet.append({'sample': sample, 'group': 'exclude', **info, 'included': False,
                          'reason': info.get('reason', 'Outside the declared tissue, assay, or comparison')})
    samplesheet = folder / 'metadata' / (acc + '_samples.tsv')
    pd.DataFrame(sheet).to_csv(samplesheet, sep='\t', index=False)
    r = LEDGER[acc]
    study = {'accession': acc, 'id': acc.lower().replace('-', ''), 'name': name,
             'category': category, 'region': region, 'preparation': preparation,
             'perturbation': perturbation, 'organism': organism, 'modality': 'bulk RNA-seq',
             'note': note, 'source': r.get('source', (r.get('sources') or [''])[0]),
             'pmid': (r.get('pubmed') or [''])[0], 'dir': str(folder.relative_to(ROOT)).replace('\\','/'),
             'groups': [{'key': k, 'label': v['label']} for k,v in groups.items()],
             'contrasts': contrasts, 'tracks': [{'id': 'hypothalamus', 'label': region,
                 'matrix': matrix.relative_to(ROOT).as_posix(),
                 'samplesheet': samplesheet.relative_to(ROOT).as_posix(), 'kind': kind}]}
    STUDIES.append(study)
    print(acc, mat.shape, {k:len(v['samples']) for k,v in groups.items()}, flush=True)


def contrast(key, label, baseline, case, covariate=None):
    return {'id': key, 'label': label, 'baseline': baseline, 'case': case,
            **({'covariate':covariate} if covariate else {})}


def groups(**kw):
    return {k:{'label':label,'samples':samples} for k,(label,samples) in kw.items()}


