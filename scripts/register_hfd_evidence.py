"""Append source reviews and preserve first-release pathway references for HFD intake."""
import csv
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'data/author-validation'
studies = json.loads((ROOT / 'data/intake/hfd-2026-09-12/studies.json').read_text(encoding='utf-8'))
analyses = json.loads((ROOT / 'data/intake/hfd-2026-09-12/analyses.json').read_text(encoding='utf-8'))


def read(name):
    return json.loads((BASE / name).read_text(encoding='utf-8'))


def save(name, value):
    (BASE / name).write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8', newline='\n')


def pin(path):
    body = (ROOT / path).read_bytes()
    return {'path': path, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}


if '--snapshots-only' not in sys.argv:
    inventory, manual, verification, comparability = [read(name) for name in ['source-inventory.generated.json', 'manual-review.json', 'verification-review.json', 'comparability-review.json']]
    for study in studies:
        identity, accession = study['id'], study['accession']
        manifest_path = f"{study['dir']}/metadata/{accession}_source_files.tsv"
        with (ROOT / manifest_path).open(encoding='utf-8') as handle:
            sources = list(csv.DictReader(handle, delimiter='\t'))
        for row in sources:
            row['local_path'] = row.get('local_path') or row.get('file')
            row['source_url'] = row.get('source_url') or row.get('source')
        for row in sources:
            current = pin(row['local_path'])
            assert current['sha256'] == row['sha256'] and current['bytes'] == int(row['bytes'])
        review = study['authorReview']
        pmid, pmc = review.get('pmid') or study.get('pmid'), review.get('pmcId')
        url = f'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={accession}'
        if not any(row['datasetId'] == identity for row in inventory['datasets']):
            inventory['datasets'].append({'datasetId': identity, 'accession': accession, 'processedDataAccession': accession,
                'database': 'GEO', 'databaseRecordUrl': url, 'processedInventoryUrl': url,
                'processedInventoryAccess': 'listed', 'processedInventoryHttpStatus': None,
                'depositedFiles': [{'name': Path(row['local_path']).name, 'url': row['source_url'], 'bytes': int(row['bytes']), 'repositorySection': 'retained intake source'} for row in sources],
                'pmid': pmid, 'paperAccess': 'pmc_full_text' if pmc else 'pubmed_record_only',
                'pubmedUrl': f'https://pubmed.ncbi.nlm.nih.gov/{pmid}/' if pmid else None,
                'pmcId': pmc, 'pmcUrl': f'https://pmc.ncbi.nlm.nih.gov/articles/{pmc}/' if pmc else None,
                'inventoryEvidence': manifest_path, 'inventoryNote': 'Selected retrieved source files; not a claim of complete repository inventory.'})
        manual['records'].setdefault(identity, {'status': 'processed_source_match', 'comparisonLevel': 'processed_source',
            'sourceComparison': 'checksum_match', 'auditState': 'complete', 'reviewedAt': '2026-09-12',
            'summary': 'Source and pipeline verified; author comparison scope recorded separately',
            'note': study['sourceReview']['note'] + ' ' + review['note'], 'reviewFlags': []})
        availability = review.get('availability', 'not_assessed')
        if accession == 'GSE104709':
            author_source = read('hfd-intake-2026-09-12/GSE104709/author-source-review.json')
            availability = 'access_blocked'
            note = author_source['reason'] + ' The linked Dryad processed-data download returned HTTP 401/403; no missing-data or concordance claim is inferred.'
            next_step = 'Retrieve the accessible chronic-HFD author effect table or document its absence in the original downloadable archive; keep the separate limma replay as internal verification.'
        else:
            note, next_step = review['note'], review['nextStep']
        verification['records'].setdefault(identity, {'resultAvailability': availability, 'comparisonOutcome': 'not_tested',
            'reason': note, 'nextStep': next_step, 'fullyVerifiedContrasts': []})
        comparability['records'].setdefault(identity, {'target': 'not_tested', 'resultScope': 'not_tested',
            'registeredContrastIds': [], 'basis': 'Registered Explorer outputs; internal source and numerical replay checks do not establish author-result agreement.',
            'reference': note, 'assessment': 'not_established',
            'dimensions': {key: {'status': 'not_tested', 'note': 'No full author-result comparison is claimed by this source registration.'} for key in ['cohort', 'contrast', 'features', 'effects', 'inference', 'coverage']},
            'criteria': 'Comparable author effects and coverage must be assessed separately from file identity and numerical replay.', 'conclusion': note})
    inventory['generatedAt'] = datetime.now(timezone.utc).isoformat()
    rat_id = 'rat_hypo_maternal_hfd_gse107324'
    rat = next(study for study in studies if study['id'] == rat_id)
    paper_url = 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0189492'
    next(row for row in inventory['datasets'] if row['datasetId'] == rat_id).update(paperAccess='publisher_full_text', publisherUrl=paper_url)
    measurements = [read(f'hfd-intake-2026-09-12/GSE107324/{sex}-measurement.json') for sex in ['male', 'female']]
    effects_note = '; '.join(f"{row['track']}: {row['nPaired']} named gene pairs, Pearson {row['pearson']:.8f}, direction agreement {row['directionAgreement']:.3%}, author/registered FDR<0.05 calls {row['authorFdr05InPairedUniverse']}/{row['pipelineFdr05InPairedUniverse']}" for row in measurements)
    note = ('The default-track author record compares male offspring. Both sexes also have independent workbook-based paired measurements retained in data/author-validation/hfd-intake-2026-09-12/GSE107324. ' + effects_note + '. Author control-minus-HFD effects are reversed once. High effect agreement does not reproduce author significance; filtered author genes and damaged identifiers remain explicit omissions.')
    manual['records'][rat_id].update(status='validated_with_notes', comparisonLevel='direct',
        summary='Author effects agree; coverage and significance differ', note=note,
        paperAccess='publisher_full_text', evidenceLinks=[{'label': 'Primary PLOS ONE paper', 'url': paper_url, 'kind': 'paper'}])
    verification['records'][rat_id].update(resultAvailability='available', comparisonOutcome='method_differences', reason=note,
        nextStep='Review the different QL-versus-author inference and the deposited/filtering universe before any full reproduction sign-off; keep the two sex-specific comparisons separate.')
    comparability['records'][rat_id] = {'target': 'registered_output', 'resultScope': 'full_results',
        'registeredContrastIds': ['hfd_vs_control'], 'basis': 'Default male track against the complete deposited male author table; female results retained separately, never reused as male evidence.',
        'reference': 'Original GEO male differential-count workbook, with control-minus-HFD logFC reversed according to the primary paper.',
        'assessment': 'limited', 'dimensions': {
            'cohort': {'status': 'compatible', 'note': 'The twelve male samples in the workbook supply the registered six-per-diet columns. The paper defines n as litters; GSM-to-litter pairing across sexes is not available.'},
            'contrast': {'status': 'matched', 'note': 'Maternal HFD minus control in PN10 male hypothalamus; source control-minus-HFD effects are negated once.'},
            'features': {'status': 'limited', 'note': 'Exact source feature IDs are joined. Author-only filtered genes and Excel-damaged identifiers remain visible exclusions; the complete author reference is not reduced to shared genes to inflate coverage.'},
            'effects': {'status': 'compatible', 'note': effects_note + '. Both quantities are modeled log2 diet effects; differences in inferential method are reported separately.'},
            'inference': {'status': 'different', 'note': 'The original likelihood-ratio-style author output has discoveries that the standardized edgeR quasi-likelihood fits do not reproduce: eight male and 86 female paired author FDR<0.05 genes versus zero in either registered fit.'},
            'coverage': {'status': 'limited', 'note': 'All deposited author effect rows remain the reference denominator. The registered expression filter retains about 81% of source genes; no full-universe author concordance claim is made.'}},
        'criteria': 'Report paired effect correlations and direction, complete reference/output coverage, missing identifiers and FDR separately. Never tune the expression filter to force author significance or a coverage threshold.',
        'conclusion': note}
    specs = read('additional-comparison-specs.json')
    if not any(row['datasetId'] == rat_id for row in specs['comparisons']):
        author_path = f"{rat['dir']}/processed/GSE107324_male_author_results.tsv"
        local_path = f"{rat['dir']}/processed/GSE107324_male_DE.tsv"
        source_refs = [dict(pin(ref['path']), sourceUrl=measurements[0]['sourceUrl'] if key == 'sourceWorkbook' else measurements[0]['paperUrl'])
                       for key, ref in measurements[0].items() if key in ['sourceWorkbook', 'paper']]
        specs['comparisons'].append({'datasetId': rat_id, 'accession': 'GSE107324', 'contrast': 'hfd_vs_control',
            'localPath': local_path, 'localKey': 'id', 'authorPath': author_path,
            'sourceUrl': measurements[0]['sourceUrl'], 'sha256': pin(author_path)['sha256'], 'format': 'tsv',
            'authorKey': 'gene_id', 'authorEffect': 'logFC_hfd_vs_control', 'authorAdjustedP': 'padj',
            'orientationSign': 1, 'orientation': 'Extraction already negated original control-minus-HFD logFC once; no second reversal.',
            'localMethod': 'edgeR-QL', 'authorMethod': 'Deposited edgeR likelihood-ratio-style result',
            'note': note, 'interpretation': 'effect_match_inference_differs',
            'originalReferences': source_refs, 'localSnapshot': pin(local_path)})
    save('additional-comparison-specs.json', specs)
    for name, value in [('source-inventory.generated.json', inventory), ('manual-review.json', manual), ('verification-review.json', verification), ('comparability-review.json', comparability)]:
        save(name, value)
    print(f'Source and author-availability records registered for {len(studies)} new studies.')

if '--sources-only' not in sys.argv:
    manifest = read('fgsea-baselines/manifest.json')
    for study in studies:
        files = []
        # The historical migration ledger covers default-track contrasts. The
        # current intake audit independently verifies all tracks and pathways.
        for analysis in [row for row in analyses if row['studyId'] == study['id'] and row['track'] == study['tracks'][0]['id']]:
            for suffix in ['DE', 'FGSEA_HALLMARK', 'FGSEA_KEGG', 'FGSEA_GO_BP', 'FGSEA_REACTOME']:
                source = f"{study['dir']}/processed/{analysis['analysisId']}_{suffix}.tsv"
                target = f"fgsea-baselines/hfd-2026-09-12/{study['accession']}/{analysis['analysisId']}_{suffix}.tsv"
                current = pin(source)
                if (BASE / target).exists():
                    assert (BASE / target).read_bytes() == (ROOT / source).read_bytes(), f'Initial output reference changed: {target}'
                else:
                    (BASE / target).parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(ROOT / source, BASE / target)
                files.append({'sourcePath': source, 'snapshotPath': target, 'bytes': current['bytes'], 'sha256': current['sha256']})
        existing = next((row for row in manifest['records'] if row['datasetId'] == study['id']), None)
        if existing:
            assert existing['files'] == files, 'Initial HFD reference changed'
        else:
            manifest['records'].append({'datasetId': study['id'], 'accession': study['accession'], 'capturedAt': '2026-09-12',
                'note': 'Initial post-migration reference for a new HFD intake study. No pre-migration output exists. These immutable first-release pipeline outputs are not author validation or evidence of migration improvement. Default-track scope; the HFD intake audit covers every track.', 'files': files})
    save('fgsea-baselines/manifest.json', manifest)
    print(f'Immutable initial FGSEA references captured for {len(studies)} new studies.')
