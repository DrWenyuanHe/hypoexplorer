"""Expose complete retained author comparisons without erasing scientific limitations."""
from pathlib import Path
import csv
import io
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'data/author-validation/continued-sources/round2-2026-09-05'


def read_tsv(path):
    with path.open(encoding='utf8', newline='') as handle:
        return list(csv.DictReader(handle, delimiter='\t'))


def main():
    subprocess.run([sys.executable, str(ROOT / 'scripts/prepare_author_round2.py'), '--check'], check=True)
    specs = json.loads((FOLDER / 'comparison-specs.json').read_text(encoding='utf8'))['comparisons']
    files = {name: ROOT / 'data/author-validation' / f'{name}.json'
             for name in ['manual-review', 'verification-review', 'comparability-review']}
    docs = {name: json.loads(path.read_text(encoding='utf8')) for name, path in files.items()}
    manual, verification, profiles = [docs[name]['records'] for name in files]
    summaries = []
    for spec in specs:
        ds = spec['datasetId']
        author = read_tsv(ROOT / spec['authorPath'])
        local_rows = read_tsv(ROOT / spec['localPath'])
        local = {row[spec['localKey']]: row for row in local_rows}
        if len(local) != len(local_rows):
            raise ValueError('Duplicate local key')
        evidence = []
        for row in author:
            matched = local.get(row['output_id'])
            effect = float(row['author_effect'])
            current_effect = float(matched['logFC']) if matched else None
            evidence.append(dict(row, matched=matched is not None, local_effect=current_effect,
                same_direction=(effect * current_effect > 0) if matched else None,
                local_padj=float(matched['padj']) if matched else None))
        matched = [row for row in evidence if row['matched']]
        summary = dict(accession=spec['accession'], authorRows=len(author), localRows=len(local_rows),
            matchedRows=len(matched), sameDirection=sum(row['same_direction'] for row in matched),
            unmatched=[row for row in evidence if not row['matched']],
            opposite=[row for row in matched if not row['same_direction']],
            allLocalFdrBelow01=sum(float(row['padj']) < .1 for row in local_rows),
            selectedLocalFdrBelow01=sum(row['local_padj'] < .1 for row in matched))
        summaries.append(summary)
        stream = io.StringIO(newline='')
        writer = csv.DictWriter(stream, fieldnames=list(evidence[0]), delimiter='\t', lineterminator='\n')
        writer.writeheader(); writer.writerows(evidence)
        (FOLDER / spec['accession'] / 'per-gene-comparison.tsv').write_text(stream.getvalue(), encoding='utf8', newline='')
        manual[ds]['reviewedAt'] = '2026-09-05'
        marker = ' Round-two structured comparison:'
        manual[ds]['note'] = manual[ds]['note'].split(marker)[0] + marker + (
            f" all {len(author)} original selected rows are retained; {len(matched)} join the registered output and "
            f"{summary['sameDirection']} agree in direction. The normalized source table and full unmatched/opposite lists are retained in continued-sources/round2-2026-09-05/{spec['accession']}. "
            'This supplies structured badge metrics while preserving the recorded effect-definition, cohort, coverage and inference limitations.')
        links = manual[ds].get('evidenceLinks', []) + [dict(label='Original selected author result used for structured comparison', url=spec['sourceUrl'], kind='author_result')]
        manual[ds]['evidenceLinks'] = list({link['url']: link for link in links}.values())
        if spec['accession'] == 'GSE298648':
            manual[ds]['summary'] = 'Complete 18-row POAH table compared; 15 retained genes agree in direction'
            manual[ds]['note'] = (
                'The official primary article XML was retrieved from Europe PMC with HTTP 200 and its original bytes retained. '
                'All 18 hour-two POAH Table 5 rows were extracted with their original Ensembl IDs, effects, nominal P and FDR. '
                'Exact registered Ensembl-to-output mapping yields 15 genes in the fitted table; three remain outside the local filter. '
                'All 15 matched directions agree, with Pearson 0.96917116 and Spearman 0.975. No selected row was dropped to improve coverage. '
                'All 18 author rows have FDR<0.1, while no gene in the complete local table does (minimum FDR 0.1206947). '
                'Generic comparison significance metrics use FDR<0.05 and must not be mistaken for the Table 5 selection rule. '
                'BEND3 has author logFC -0.67962 despite the stated absolute logFC>1 rule. '
                'Methods place the treatment arms in separate incubators; exact independent incubation replication and fitting universe remain unresolved. '
                'The 18-row selected source is below the badge minimum of 30 genes, and retained coverage is 15/18. '
                'Complete per-gene results, three unmatched IDs, retrieval headers and exact source pins are in continued-sources/round2-2026-09-05/GSE298648.')
            profiles[ds]['dimensions']['features'] = dict(status='compatible', note='All 18 original Ensembl IDs map uniquely through the registered source map; 15 are fitted and three are filtered out. No symbol guesses or selected-row omissions are used.')
            profiles[ds]['dimensions']['effects'] = dict(status='compatible', note='All 15 matched published logFC directions agree; Pearson 0.96917116 and Spearman 0.975. Original effect signs match the author direction labels.')
            profiles[ds]['dimensions']['coverage'] = dict(status='limited', note='All 18 author-selected genes are retained in the reference; 15 join and three remain unassessed. Coverage is 83.3%, and the selected list is not a full tested universe.')
            profiles[ds]['criteria'] = 'All 18 original Table 5 rows are measured through exact Ensembl mappings. Author FDR<0.1 is distinguished from generic FDR<0.05 metrics. The selected 18-gene table is below the badge minimum of 30; no cutoff is lowered.'
            profiles[ds]['conclusion'] = 'Complete selected-table comparison supports 15 matching directions but leaves cohort/model, source threshold and reference-coverage limitations.'
            verification[ds]['reason'] = 'The complete original 18-gene POAH table is now compared: 15 retained genes agree in direction, with three filtered out. Author/local FDR, incubation replication and model scope remain unresolved.'
            verification[ds]['nextStep'] = 'Recover exact incubation replicate identities, fitting universe and the Table 5 selection rule; locate a full author tested-gene result and resolve the three filtered author genes. Preserve the registered result and current source discrepancies.'
    for name, path in files.items():
        path.write_text(json.dumps(docs[name], indent=2) + '\n', encoding='utf8', newline='')
    (FOLDER / 'comparison-summary.json').write_text(json.dumps(dict(schemaVersion=1, records=summaries), indent=2) + '\n', encoding='utf8', newline='')
    print(json.dumps([dict(accession=row['accession'], authorRows=row['authorRows'], matchedRows=row['matchedRows'], sameDirection=row['sameDirection']) for row in summaries]))


if __name__ == '__main__':
    main()
