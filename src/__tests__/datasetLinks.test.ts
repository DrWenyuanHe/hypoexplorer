import { describe, it, expect } from 'vitest';
import {
  repositoryName, repositoryUrl, doiUrl, parsePmid, pubmedUrl, datasetPmid, datasetExternalLinks,
  citationWithoutPmid,
} from '../utils/datasetLinks';
import { getDataset, listDatasets } from '../data/datasets';
import type { Dataset } from '../types';

// The link helpers turn the registry's `geo` / `doi` / `pmid` / `citation` fields
// into resolvable external URLs. The registry mixes NCBI GEO (GSE…) with one EBI
// ArrayExpress id (E-MTAB-…), carries a PMID for every dataset whose deposit has
// a paper (five do not), and leaves the default macaque set with a DOI but no
// accession — so these guard the edge cases the metadata-linking audit surfaced.

describe('repositoryName / repositoryUrl', () => {
  it('routes GEO accessions to the NCBI GEO viewer', () => {
    expect(repositoryName('GSE220533')).toBe('GEO');
    expect(repositoryUrl('GSE220533')).toBe('https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE220533');
  });

  it('routes ArrayExpress (E-) accessions to EBI BioStudies, not GEO', () => {
    expect(repositoryName('E-MTAB-6929')).toBe('ArrayExpress');
    expect(repositoryUrl('E-MTAB-6929')).toBe('https://www.ebi.ac.uk/biostudies/arrayexpress/studies/E-MTAB-6929');
  });

  it('returns null for missing or unrecognized accessions', () => {
    expect(repositoryName('')).toBeNull();
    expect(repositoryName(null)).toBeNull();
    expect(repositoryName(undefined)).toBeNull();
    expect(repositoryName('FOO123')).toBeNull();
    expect(repositoryUrl('FOO123')).toBeNull();
    expect(repositoryUrl(undefined)).toBeNull();
  });
});

describe('doiUrl', () => {
  it('builds a doi.org url', () => {
    expect(doiUrl('10.1016/j.cmet.2024.01.003')).toBe('https://doi.org/10.1016/j.cmet.2024.01.003');
  });
  it('strips a leading doi: prefix and treats empty as null', () => {
    expect(doiUrl('doi:10.1/x')).toBe('https://doi.org/10.1/x');
    expect(doiUrl('')).toBeNull();
    expect(doiUrl(undefined)).toBeNull();
  });
});

describe('parsePmid / pubmedUrl', () => {
  it('extracts a PMID from a citation string (space and colon forms)', () => {
    expect(parsePmid('… (GSE225038, PMID 38145289)')).toBe('38145289');
    expect(parsePmid('foo PMID: 35784876 bar')).toBe('35784876');
  });
  it('returns null when no PMID is present', () => {
    expect(parsePmid('Garrett et al. 2023 (GSE220533)')).toBeNull();
    expect(parsePmid('')).toBeNull();
    expect(parsePmid(undefined)).toBeNull();
  });
  it('builds a PubMed url for numeric ids only', () => {
    expect(pubmedUrl('38145289')).toBe('https://pubmed.ncbi.nlm.nih.gov/38145289/');
    expect(pubmedUrl('abc')).toBeNull();
    expect(pubmedUrl(null)).toBeNull();
  });
});

describe('datasetExternalLinks (against the real registry)', () => {
  it('macaque (no accession) yields a DOI and a PubMed link, no repository', () => {
    const links = datasetExternalLinks(getDataset('macaque_snrna')!);
    expect(links.map((l) => l.kind)).toEqual(['doi', 'pubmed']);
    expect(links[0].href).toBe('https://doi.org/10.1016/j.cmet.2024.01.003');
    expect(links[1].href).toBe('https://pubmed.ncbi.nlm.nih.gov/38325338/');
  });

  it('the lone ArrayExpress dataset links to BioStudies', () => {
    const links = datasetExternalLinks(getDataset('mouse_hypo_hfd_emtab6929')!);
    const repo = links.find((l) => l.kind === 'repository')!;
    expect(repo.label).toBe('E-MTAB-6929');
    expect(repo.href).toBe('https://www.ebi.ac.uk/biostudies/arrayexpress/studies/E-MTAB-6929');
  });

  it('a GEO set with a PMID but no DOI yields repository + PubMed', () => {
    const links = datasetExternalLinks(getDataset('mouse_arc_hfd_gse225038')!);
    expect(links.map((l) => l.kind)).toEqual(['repository', 'pubmed']);
    expect(links[1].href).toBe('https://pubmed.ncbi.nlm.nih.gov/38145289/');
  });

  it('a GEO set with both DOI and PMID yields all three links in order', () => {
    const links = datasetExternalLinks(getDataset('mouse_hypo_hfd_gse236077')!);
    expect(links.map((l) => l.kind)).toEqual(['repository', 'doi', 'pubmed']);
  });

  // An unpublished deposit. Absence of a PMID here is the study's own fact, not
  // a lookup we never got round to — so it must stay a repository-only record
  // rather than acquiring a link to some approximately-related paper.
  it('a GEO-only set with no publication yields just the repository link', () => {
    const links = datasetExternalLinks(getDataset('mouse_hypo_obob_gse167264')!);
    expect(links.map((l) => l.kind)).toEqual(['repository']);
  });

  // `label` is the chip text the three chip sites render verbatim. Pin it per
  // kind: the identifier itself for `repository` and `pubmed`, the literal "DOI"
  // for the one link with no short id. Those sites used to re-derive this from
  // `kind`; if the builder ever stops producing these strings, the chips change
  // and this fails.
  it('carries a ready-to-render chip label for every kind', () => {
    const links = datasetExternalLinks(getDataset('mouse_hypo_hfd_gse236077')!);
    const labelOf = (kind: string) => links.find((l) => l.kind === kind)?.label;
    expect(labelOf('repository')).toBe(getDataset('mouse_hypo_hfd_gse236077')!.geo);
    expect(labelOf('doi')).toBe('DOI');
    expect(labelOf('pubmed')).toBe('PMID 38184639');
  });
});

describe('datasetPmid', () => {
  const base = { citation: '', pmid: '' } as unknown as Dataset;

  it('prefers the registry field', () => {
    expect(datasetPmid({ ...base, pmid: '38145289', citation: 'no id here' })).toBe('38145289');
  });

  it('falls back to a PMID written into the citation prose', () => {
    expect(datasetPmid({ ...base, citation: 'Foo et al. (GSE1, PMID 35784876)' })).toBe('35784876');
  });

  it('is null when neither carries one', () => {
    expect(datasetPmid({ ...base, citation: 'Foo et al. (GSE1)' })).toBeNull();
  });

  // Every dataset that names a PMID in prose also declares it as a field, and
  // the two were reconciled against the source repository's own record. A future
  // edit that changes one and not the other is a registry bug, not a display one.
  it('agrees with the citation prose across the whole registry', () => {
    for (const dataset of listDatasets()) {
      const inProse = parsePmid(dataset.citation);
      if (inProse) expect(dataset.pmid, dataset.id).toBe(inProse);
    }
  });
});

describe('citationWithoutPmid', () => {
  // The two shapes the corpus actually uses: PMID closed by ")" and PMID
  // followed by "; GSE…".
  it('drops a PMID that closes the parenthetical', () => {
    expect(citationWithoutPmid('Klf4 deletion (GSE225038, PMID 38145289)'))
      .toBe('Klf4 deletion (GSE225038)');
  });

  it('drops a PMID that precedes the accession', () => {
    expect(citationWithoutPmid('PVN chow vs HFD (Yi et al., PMID 35784876; GSE198437)'))
      .toBe('PVN chow vs HFD (Yi et al.; GSE198437)');
  });

  it('leaves a citation with no PMID untouched', () => {
    expect(citationWithoutPmid('Foo et al. (GSE1)')).toBe('Foo et al. (GSE1)');
  });

  it('is empty for a missing citation', () => {
    expect(citationWithoutPmid(undefined)).toBe('');
    expect(citationWithoutPmid(null)).toBe('');
  });

  // Shapes no current citation uses, guarded so a future one degrades tidily
  // rather than leaving "(, GSE1)" or empty parens on screen.
  it('tidies up shapes the corpus does not yet use', () => {
    expect(citationWithoutPmid('Foo et al. (PMID 35784876)')).toBe('Foo et al.');
    expect(citationWithoutPmid('Foo et al. (GSE1; PMID: 35784876)')).toBe('Foo et al. (GSE1)');
  });

  // The whole point: no rendered citation may still name a PMID, because every
  // surface that prints one also renders it as a chip.
  it('leaves no PMID in prose anywhere in the registry', () => {
    for (const dataset of listDatasets()) {
      expect(parsePmid(citationWithoutPmid(dataset.citation)), dataset.id).toBeNull();
    }
  });

  // Stripping must not eat the accession, which shares the parenthetical.
  it('keeps the accession that sits beside the stripped PMID', () => {
    for (const dataset of listDatasets()) {
      if (!dataset.geo || !parsePmid(dataset.citation)) continue;
      if (!dataset.citation.includes(dataset.geo)) continue;
      expect(citationWithoutPmid(dataset.citation), dataset.id).toContain(dataset.geo);
    }
  });
});
