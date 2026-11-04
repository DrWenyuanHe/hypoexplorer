"""Publish source-review findings without modifying any registered expression or DE data."""
from pathlib import Path
import collections
import csv
import hashlib
import json
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/author-validation'
OUT = DATA / 'continued-sources/advancement-sources-b-2026-09-05'


def read(path):
    return json.loads(path.read_text(encoding='utf8'))


def write(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf8')


manual = read(DATA / 'manual-review.json')
verification = read(DATA / 'verification-review.json')
comparability = read(DATA / 'comparability-review.json')

pig = OUT / 'GSE245146'
source = pig / 'HypoD60_supplemental_oct302023.docx'
with zipfile.ZipFile(source) as archive:
    xml = archive.read('word/document.xml')
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
document = ET.fromstring(xml)
tables = []
for i, table in enumerate(document.findall('.//w:tbl', ns), 1):
    rows = [[' '.join(''.join(p.itertext()) for p in cell.findall('.//w:t', ns)) for cell in row.findall('w:tc', ns)] for row in table.findall('w:tr', ns)]
    with (pig / f'table-{i}.tsv').open('w', encoding='utf8', newline='') as f:
        csv.writer(f, delimiter='\t', lineterminator='\n').writerows(rows)
    tables.append(rows)
effects = dict(collections.Counter(row[0] for row in tables[0] if row and row[0] != 'Effect'))
write(pig / 'scope-audit.json', {'sourceUrl': 'https://databank.illinois.edu/datafiles/xr3yz/download', 'sourcePath': source.relative_to(ROOT).as_posix(), 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'date': '2026-09-05', 'tableRows': [len(table) for table in tables], 'effectRowCounts': effects, 'finding': '159 MIA rows are control-minus-PRRSV factorial main effects. The registered contrast is PRRSV-minus-control within saline, adjusted for sex. Reversing sign alone cannot turn a whole-factorial main effect into that simple effect. No equivalent saline-specific result is identified.'})
pid = 'pig_hypo_mia_gse245146'
manual['records'][pid].update(summary='Illinois supplement recovered; factorial results differ from the registered saline contrast', note='Public Illinois Data Bank download succeeded on 2026-09-05 through its dataset record. Original DOCX bytes and all three tables are retained with SHA-256 evidence. Table S1 contains 159 maternal immune-activation main-effect rows (control minus PRRSV), plus treatment, sex and interaction effects. The author design spans fasting, poly(I:C) and saline. The registered result is the saline-only PRRSV-minus-control effect adjusted for sex. No equivalent simple-effect author table was identified, so neither a direction reversal nor a whole-factorial comparison is used to claim concordance. The former download-access blocker is resolved. Evidence: continued-sources/advancement-sources-b-2026-09-05/GSE245146/scope-audit.json.', reviewedAt='2026-09-05', reviewFlags=['Retrieved author main and interaction effects do not identify the registered saline-only maternal simple effect.'])
for link in manual['records'][pid]['evidenceLinks']:
    if 'xr3yz/download' in link['url']:
        link['label'] = 'Retrieved original Illinois author supplement'
verification['records'][pid].update(resultAvailability='partial', comparisonOutcome='not_comparable', reason='The official supplement has been retrieved and inspected. Its whole-factorial main/interaction effects do not provide the registered saline-only sex-adjusted maternal effect.', nextStep='Locate author simple-effect results or original fitted-model contrasts for saline-only PRRSV minus control. Retain the recovered factorial table as source evidence, without treating it as a matching comparator.')

fid = 'zebrafish_hypo_fluoxetine_gse141144'
direction = read(OUT / 'GSE141144/direction-comparison.json')
assert (direction['selectedGenes'], direction['pairedNonzeroGenes'], direction['sameDirectionGenes']) == (96, 86, 86)
manual['records'][fid].update(summary='Fluoxetine workbook recovered; all 86 matched selected gene directions agree', note='Retrieved the authentic Table_1.xlsx from the official Europe PMC supplementary archive. All eight sheets were inspected. Supp 5 and Supp 7 encode directions by colored cells; the legend identifies red as up and green as down. The unstressed hypothalamus column provides 96 unique selected Danio rerio symbols. Of these, 86 exactly join registered nonzero effects and all 86 agree in direction; ten are unassessed. Coverage is 89.6%, below the project 90% threshold. These are selected lifelong/depressive-disorder gene lists, with no numerical gene fold changes or adjusted P values. No effect magnitudes, correlations or FDR values are invented from colors. Supp 1-4 and 8 are enrichment tables, not full DE references. The local cohort is six unstressed adult male fish pools per lineage; author joint FLX/stress model scope still requires reconciliation. Evidence: continued-sources/advancement-sources-b-2026-09-05/GSE141144/direction-comparison.json.', reviewFlags=['Selected direction-only evidence covers 86 of 96 genes; no full gene-effect/FDR table is present in this workbook.', 'Author joint FLX/stress model scope is not fully reconciled with the registered unstressed-only fit.'], reviewedAt='2026-09-05')
manual['records'][fid]['evidenceLinks'] = [link for link in manual['records'][fid]['evidenceLinks'] if 'supplementaryFiles' not in link['url']] + [{'label': 'Retrieved official author supplement archive', 'url': direction['sourceUrl'], 'kind': 'author_result'}]
verification['records'][fid].update(resultAvailability='partial', comparisonOutcome='method_differences', reason='The workbook is now retrieved. All 86 exactly matched selected gene directions agree, but ten selected genes are unassessed and the file contains no full numerical gene-effect/FDR reference.', nextStep='Recover the full unstressed-hypothalamus author DE table and exact FLX/stress coefficient scope. Resolve the ten unmatched selected symbols with authoritative mappings before extending direction coverage.')

# Feature identity and reference coverage are distinct. Missing rows remain explicit
# and are measured against the unchanged 90% policy; they do not imply ambiguous IDs.
eid = 'mouse_mbh_maternal_emulsifier_gse231769'
comparability['records'][eid]['dimensions']['features'] = {'status': 'compatible', 'note': '14,483 unique named author symbols join exactly, without alias inference or duplicate resolution. The 109 absent local genes and one unidentified author statistical row remain unassessed; the separate measured coverage check uses the full registered denominator (14,592).'}

for filename, value in [('manual-review', manual), ('verification-review', verification), ('comparability-review', comparability)]:
    write(DATA / f'{filename}.json', value)

specs = {row['datasetId']: row for row in read(OUT / 'additional-comparison-specs.json')['comparisons']}
inventory = read(OUT / 'source-inventory.json')
lines = ['# Author-source advancement: group B', '', 'Date: 2026-09-05. All 58 assigned records were reviewed against their existing evidence and next steps. The current pass retrieved 37 primary-paper XML files; ten paper requests failed and eleven records have no linked PMC identifier. These outcomes describe this retrieval pass, not absence of a publication or author data. Existing unresolved evidence is preserved.', '', 'Eight complete-scope table extractions now feed the shared comparison generator: six full author tables and two author-selected tissue lists. Full source rows are retained before joining the registered output. Two previously blocked sources were recovered: the pig factorial DOCX and zebrafish direction-only workbook. No registered DE output was modified.', '', '| Dataset | Work completed this pass | Remaining requirement |', '|---|---|---|']
for row in inventory['records']:
    dataset_id = row['datasetId']
    if dataset_id in specs:
        action = 'Re-extracted original author table with pinned source and script hashes; connected current registered comparison to the tracker.'
    elif dataset_id == pid:
        action = 'Retrieved original DOCX, extracted three tables, established factorial/simple-effect incompatibility.'
    elif dataset_id == fid:
        action = 'Retrieved all eight workbook sheets; measured 86/86 same directions across 96 unique selected genes.'
    else:
        action = {'retrieved': 'Retrieved and inventoried primary full text and linked supplementary/code sources; retained the existing scoped finding.', 'retrieval_failed': 'Retained existing evidence; this pass could not retrieve the linked primary XML (failure recorded).', 'no_pmc_identifier': 'Reviewed existing publication/evidence links; no PMC identifier was available for automated full-text retrieval.'}.get(row['paper']['status'], 'Retained prior scoped evidence; no new numerical reference recovered.')
    next_step = verification['records'].get(dataset_id, {}).get('nextStep', row['priorNextStep'])
    row.update(currentAction=action, remainingRequirement=next_step)
    lines.append(f"| {row['accession']} / {dataset_id} | {action.replace('|', '/')} | {next_step.replace('|', '/')} |")
write(OUT / 'source-inventory.json', inventory)
(OUT / 'README.md').write_text('\n'.join(lines) + '\n', encoding='utf8')
print('Updated two recovered-source records, one feature-identity review, and the 58-dataset source report.')
