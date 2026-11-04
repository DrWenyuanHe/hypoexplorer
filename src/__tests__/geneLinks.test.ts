import { describe, it, expect } from 'vitest';
import { geneAuthorityUrl } from '../utils/geneLinks';
import { NOMENCLATURE_AUTHORITIES, type NomenclatureAuthority } from '../data/nomenclature';

// geneAuthorityUrl turns the nomenclature table's authority id into the
// registry's own record page. Each expected URL below was verified live (HTTP
// 200) against its authority, using a gene whose id is stable and well known.
//
// The point of these is the SPECIES trap: the corpus spans four namespaces whose
// symbols collide, and three organisms are stored under a projected namespace.
// The id is what makes the link unambiguous, so the tests pin the id→URL mapping
// per authority and pin the failure modes that would otherwise produce a
// confident link to the wrong record.

describe('geneAuthorityUrl', () => {
  it('routes HGNC ids to the genenames.org gene-symbol report', () => {
    // POMC. HGNC's report param wants the QUALIFIED id, unlike the other three.
    expect(geneAuthorityUrl('HGNC', 'HGNC:9201')).toBe(
      'https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id/HGNC:9201',
    );
  });

  it('routes MGI ids to the informatics.jax.org marker page', () => {
    // Mouse Pomc. MGI accessions are conventionally written with the prefix.
    expect(geneAuthorityUrl('MGI', 'MGI:97742')).toBe(
      'https://www.informatics.jax.org/marker/MGI:97742',
    );
  });

  it('routes RGD ids to the rgd.mcw.edu gene report', () => {
    // Rat Pomc. RGD's report takes the bare numeric id as a query param.
    expect(geneAuthorityUrl('RGD', 'RGD:3366')).toBe(
      'https://rgd.mcw.edu/rgdweb/report/gene/main.html?id=3366',
    );
  });

  it('routes every native NCBI taxon to the NCBI gene viewer', () => {
    // The accession IS the Entrez id, so one template serves all four taxa and
    // the id alone determines the species.
    expect(geneAuthorityUrl('NCBI Gene (Danio rerio)', 'GeneID:30295')).toBe(
      'https://www.ncbi.nlm.nih.gov/gene/30295',
    );
    for (const authority of [
      'NCBI Gene (Gallus gallus)',
      'NCBI Gene (Sus scrofa)',
      'NCBI Gene (Bos taurus)',
    ] as NomenclatureAuthority[]) {
      expect(geneAuthorityUrl(authority, 'GeneID:12345')).toBe(
        'https://www.ncbi.nlm.nih.gov/gene/12345',
      );
    }
  });

  it('accepts a bare accession as well as a qualified one', () => {
    // The wire stores ids prefix-stripped; only the client restores the prefix.
    // Both spellings must resolve to the same record.
    expect(geneAuthorityUrl('RGD', '3366')).toBe(geneAuthorityUrl('RGD', 'RGD:3366'));
    expect(geneAuthorityUrl('HGNC', '9201')).toBe(geneAuthorityUrl('HGNC', 'HGNC:9201'));
  });

  it('returns null for a missing authority or id', () => {
    expect(geneAuthorityUrl('HGNC', '')).toBeNull();
    expect(geneAuthorityUrl('HGNC', null)).toBeNull();
    expect(geneAuthorityUrl('HGNC', undefined)).toBeNull();
    expect(geneAuthorityUrl(null, 'HGNC:9201')).toBeNull();
    expect(geneAuthorityUrl(undefined, 'HGNC:9201')).toBeNull();
  });

  it('returns null rather than guessing when the accession is not numeric', () => {
    // All four authorities use numeric accessions. A non-numeric one means the
    // row's id is malformed, and a URL built from it would 404 at best.
    expect(geneAuthorityUrl('HGNC', 'HGNC:')).toBeNull();
    expect(geneAuthorityUrl('HGNC', 'HGNC:abc')).toBeNull();
    expect(geneAuthorityUrl('MGI', 'MGI:not-a-number')).toBeNull();
    expect(geneAuthorityUrl('RGD', 'RGD:12a')).toBeNull();
  });

  it("does not rewrite an id carrying another authority's prefix", () => {
    // Only the row's OWN prefix is stripped. A cross-prefixed id keeps its
    // colon, fails the numeric check, and yields null — instead of being
    // silently rewritten into a plausible link to the wrong registry.
    expect(geneAuthorityUrl('MGI', 'HGNC:9201')).toBeNull();
    expect(geneAuthorityUrl('HGNC', 'MGI:97742')).toBeNull();
    expect(geneAuthorityUrl('RGD', 'GeneID:30295')).toBeNull();
  });

  it('returns null for an authority with no template', () => {
    expect(geneAuthorityUrl('Ensembl' as NomenclatureAuthority, '123')).toBeNull();
  });

  it('resolves a link for every authority the wire can encode', () => {
    // Guards the fail-closed default: adding an authority to
    // NOMENCLATURE_AUTHORITIES without adding its template here drops the link
    // silently, and this is what catches that.
    for (const authority of NOMENCLATURE_AUTHORITIES) {
      const url = geneAuthorityUrl(authority, '1');
      expect(url, `no URL template for ${authority}`).toBeTruthy();
      expect(url).toMatch(/^https:\/\//);
    }
  });
});
