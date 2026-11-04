// External-link helpers for GENE nomenclature records, the per-gene counterpart
// to datasetLinks.ts.
//
// The nomenclature table already carries, for 174,148 of its 200,806 rows, the
// authority's own identifier for the gene — 'HGNC:9201', 'MGI:97742',
// 'RGD:3366', 'GeneID:30295'. Until now that id was rendered as hover text and
// nothing else, so a reader who wanted the authoritative record had to retype
// the symbol into a search engine and hope they landed in the right species.
//
// WHY THE ID AND NEVER THE SYMBOL
// -------------------------------
// The corpus spans eleven organisms across four namespaces whose symbols collide
// case-insensitively, and three of those organisms are stored under a PROJECTED
// namespace: macaque rows carry human HGNC records, hamster and dormouse rows
// carry mouse MGI records (see NOMENCLATURE_AUTHORITY_BY_ORGANISM). A link built
// by searching the symbol would therefore be wrong in two different ways —
// silently returning the human gene for a mouse row, or the biological species
// for a row whose namespace is a projection. The authority id is the only key
// that cannot be either, because the generator resolved it against the authority
// that governs the row's own namespace.
//
// So there is no symbol-based fallback here on purpose. A row without an id gets
// no link, which is the honest outcome: 26,658 of the corpus's symbols are ones
// no authority recognizes at all, and inventing a search URL for them would
// promise a record that does not exist.

import { NOMENCLATURE_AUTHORITY_ID_PREFIX, type NomenclatureAuthority } from '../data/nomenclature';

/**
 * Strip the authority prefix from a qualified id, returning the bare accession.
 *
 * The wire stores ids WITHOUT their prefix and the client restores it
 * (see nomenclature.ts), so callers hold the qualified form 'HGNC:9201' while
 * three of the four URL templates want the bare '9201'. Matching is anchored and
 * case-insensitive on the expected prefix only: an id carrying some OTHER
 * authority's prefix is left intact, so it fails the numeric check below rather
 * than being silently rewritten into a plausible-looking wrong link.
 */
function bareId(authority: NomenclatureAuthority, authorityId: string): string {
  const prefix = NOMENCLATURE_AUTHORITY_ID_PREFIX[authority];
  const at = authorityId.indexOf(':');
  if (at === -1) return authorityId;
  return authorityId.slice(0, at).toUpperCase() === prefix.toUpperCase()
    ? authorityId.slice(at + 1)
    : authorityId;
}

/**
 * The authority's own record page for one gene, or null when it cannot be built.
 *
 * `authorityId` is the qualified form the client hands out ('HGNC:9201'), and
 * every template below is verified live against its authority. Returns null for
 * an empty id, an unknown authority, or an id whose accession is not numeric —
 * all four authorities use numeric accessions, so a non-numeric one means the
 * row's id is malformed and any URL built from it would 404 or, worse, resolve
 * to an unrelated record.
 */
export function geneAuthorityUrl(
  authority: NomenclatureAuthority | null | undefined,
  authorityId: string | null | undefined,
): string | null {
  if (!authority || !authorityId) return null;
  const prefix = NOMENCLATURE_AUTHORITY_ID_PREFIX[authority];
  if (!prefix) return null;

  const id = bareId(authority, authorityId.trim());
  if (!/^\d+$/.test(id)) return null;

  switch (authority) {
    // genenames.org routes gene reports through a hash fragment, and its param
    // is the QUALIFIED id — the one place the prefix is wanted back.
    case 'HGNC':
      return `https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id/HGNC:${encodeURIComponent(id)}`;
    case 'MGI':
      return `https://www.informatics.jax.org/marker/MGI:${encodeURIComponent(id)}`;
    case 'RGD':
      return `https://rgd.mcw.edu/rgdweb/report/gene/main.html?id=${encodeURIComponent(id)}`;
    // The four native NCBI taxa share one template: their accession IS the
    // Entrez gene id, and NCBI's gene viewer is taxon-agnostic because the id
    // already determines the species.
    case 'NCBI Gene (Gallus gallus)':
    case 'NCBI Gene (Danio rerio)':
    case 'NCBI Gene (Sus scrofa)':
    case 'NCBI Gene (Bos taurus)':
      return `https://www.ncbi.nlm.nih.gov/gene/${encodeURIComponent(id)}`;
    default:
      // Unreachable while NOMENCLATURE_AUTHORITIES and this switch agree. Fails
      // closed rather than defaulting, so ADDING an authority without adding its
      // template here drops the link instead of pointing it at the wrong registry.
      return null;
  }
}
