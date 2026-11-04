"""Record primary-source findings without changing scientific results or pass criteria."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'data/author-validation'


def main():
    paths = {name: BASE / (name + '.json') for name in ['manual-review', 'verification-review', 'comparability-review']}
    documents = {name: json.loads(path.read_text(encoding='utf8')) for name, path in paths.items()}
    manual, verification, profiles = [documents[name]['records'] for name in paths]
    pvn = 'mouse_pvn_hfd_gse198437'
    manual[pvn].update({
        'summary': 'Original PVN selected-gene workbook recovered and compared',
        'sourceComparison': 'checksum_match', 'paperAccess': 'pmc_full_text',
        'reviewedAt': '2026-09-05',
        'note': 'The authentic original Table1.xlsx is now retained with its checksum, extraction script and complete 1,796-row selected universe. Original integer Geneid joins avoid symbol inference. The compared quantity is HFD-0 minus CTRL-0 from the published centered group coefficients. Numerical similarity is strong, but the workbook does not explicitly label coefficient units, so interpretation as log2 fold-change remains a review gate. Author omnibus P/FDR are not reused as pairwise significance. The primary methods explicitly identify three independent mice per RNA-seq group; the local comparison selects the same HFD and control arms and excludes minocycline.',
        'reviewFlags': ['The coefficient units require explicit confirmation; high correlation does not establish effect-definition compatibility.',
                        'This is a trajectory-selected list, with omnibus statistics, not a complete pairwise result table.'],
        'evidenceLinks': [{'label': 'Original published Table 1', 'url': 'https://pmc-oa-opendata.s3.amazonaws.com/PMC9244633.1/Table1.xlsx', 'kind': 'author_result'},
                          {'label': 'Primary methods and cohort', 'url': 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9244633/', 'kind': 'paper'}],
    })
    profiles[pvn]['dimensions']['cohort'] = {'status': 'compatible', 'note': 'The primary RNA-seq methods specify three independent mice per group. Exact HFD and control source profiles form the registered pairwise contrast; the minocycline arm is excluded from the local pairwise fit but contributes to the author model and selection.'}
    profiles[pvn]['dimensions']['features'] = {'status': 'compatible', 'note': '1,789 of all 1,796 original integer Geneid values join current registered effects exactly; seven remain unmatched. No local-result selection or symbol remapping is used.'}
    profiles[pvn]['dimensions']['effects'] = {'status': 'limited', 'note': 'The compared published quantity is HFD-0 minus CTRL-0 from centered coefficients. Log2 units are plausible from the edgeR methods but not explicitly labeled; numerical agreement alone is insufficient to establish the definition.'}
    profiles[pvn]['criteria'] = 'All published selected rows remain in the comparison denominator. Require explicit effect-definition confirmation; omit author omnibus P/FDR from pairwise inference. Author concordance criteria are unchanged.'
    profiles[pvn]['conclusion'] = 'Selected effects are numerically similar; the coefficient-unit definition remains unresolved.'
    verification[pvn] = {'resultAvailability': 'partial', 'comparisonOutcome': 'method_differences',
        'reason': 'The original selected workbook is checksum-pinned and numerically compared, but its centered coefficient units are not explicitly declared and omnibus FDR is not a pairwise reference.',
        'nextStep': 'Recover the exact coefficient-generation definition and, if available, the complete HFD-versus-control author result; do not infer units or pairwise FDR from agreement alone.'}
    hamster = 'hamster_tanycyte_photoperiod_gse204883'
    manual[hamster].update({
        'summary': 'Tanycyte author code recovered; SPIP19 exclusion differs from the registered cohort',
        'paperAccess': 'publisher_full_text', 'reviewedAt': '2026-09-05',
        'note': 'The public Zenodo 10285435 author archive is retained with SHA-256 and verified against its repository MD5. Its R script excludes SPIP19 for poor sequencing quality and fits all four photoperiod groups with edgeR TMM/QL after a whole-experiment median CPM >=1 filter. The registered SP-IP-minus-LP-IP fit includes SPIP19 and only those two arms. The archive contains analysis code and promoter resources, but no saved DE tables. The publisher inventory identifies Data S1, including the relevant pairwise contrast; retrieving that workbook remains blocked by a human CAPTCHA. Search-accessible publisher text clarified the inventory; the interactive browser still displayed the challenge. No alternate cohort is silently substituted.',
        'reviewFlags': ['The published analysis explicitly excludes SPIP19, which is retained in the current registered comparison.',
                        'Original Data S1 remains access-blocked; the public code archive does not contain its saved DE tables.'],
    })
    manual[hamster]['evidenceLinks'].append({'label': 'Recovered original author code archive', 'url': 'https://zenodo.org/records/10285435', 'kind': 'author_result'})
    verification[hamster] = {'resultAvailability': 'access_blocked', 'comparisonOutcome': 'not_tested',
        'reason': 'Exact author code and the Data S1 inventory are recovered, but numerical results remain behind a publisher challenge. SPIP19 is author-excluded and locally retained.',
        'nextStep': 'Obtain the original Data S1 workbook through an accessible authorized source. Reconcile the SPIP19 exclusion and four-group model before any registered-concordance pass.'}
    astro = 'mouse_hypo_astro_hfhs_gse205313'
    manual[astro].update({
        'summary': 'Astrocyte author notebook recovered; saved DE table and cohort mapping remain unresolved',
        'paperAccess': 'publisher_full_text', 'reviewedAt': '2026-09-05',
        'note': 'The author GitHub repository is pinned to commit 145e6b10ed16cd7e4e4cc1a63b4ec84e90428a07. Its transcriptomics notebook describes a six-group, three-brain-region DESeq2 fit, gene-symbol conversion, filtering, and exclusion of original columns 10,13,19,34. The hypothalamus analysis consequently has six chow and five HFHS profiles, matching local counts of profiles but not yet proving exact identity mapping from the unpublished new_counts1.csv column order to the deposited GSM files. The notebook loads dds.RData and dge.RData, neither present in the archive. Primary methods identify each bulk RNA profile as a pool of two mice. Publisher Table S1 is listed as overlap gene lists and GO pathways; its workbook download returned HTTP 403. The normal browser later displayed the full article and supplement inventory; clicking its Table S1 link did not deliver a retrievable file in this tool session. Count matching and a code archive do not establish author result concordance.',
        'reviewFlags': ['Saved author DE result objects are not present in the pinned public repository.',
                        'Exact source sample correspondence for the author exclusions is unresolved; equal cohort sizes are not sufficient.',
                        'Two-mouse pools are the RNA analysis units; individual animals cannot be counted as independent profiles.'],
        'evidenceLinks': [{'label': 'Publisher primary methods and supplement inventory', 'url': 'https://onlinelibrary.wiley.com/doi/full/10.1002/glia.24237', 'kind': 'paper'},
                          {'label': 'Pinned original author transcriptomics notebook', 'url': 'https://github.com/viktormiok/AstrocytesHeterogenityARC/tree/145e6b10ed16cd7e4e4cc1a63b4ec84e90428a07', 'kind': 'author_result'}],
    })
    verification[astro] = {'resultAvailability': 'access_blocked', 'comparisonOutcome': 'not_tested',
        'reason': 'Primary methods and author code are recovered, but original DE objects are not in the repository and the publisher supplement download is unavailable. Exact author/local sample correspondence remains unresolved.',
        'nextStep': 'Recover the original hypothalamus dge result and source column order, or an equivalent published numerical table. Link the author-excluded columns to GSM identities before comparing the registered fit.'}
    for name, path in paths.items():
        # Keep repeated execution from adding duplicate source links.
        if name == 'manual-review':
            for record in [manual[hamster]]:
                record['evidenceLinks'] = list({link['url']: link for link in record['evidenceLinks']}.values())
        path.write_text(json.dumps(documents[name], indent=2) + '\n', encoding='utf8')
    print('Recorded GSE198437, GSE204883 and GSE205313 primary-source findings')


if __name__ == '__main__':
    main()
