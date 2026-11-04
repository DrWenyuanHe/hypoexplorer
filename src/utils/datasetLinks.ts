// External-link helpers for dataset provenance metadata. The registry carries a
// repository accession (`geo` — usually an NCBI GEO "GSE…" id, occasionally an
// EBI ArrayExpress "E-MTAB-…" id), an optional `doi`, an optional `pmid`, and a
// free-text `citation` that often also names the PMID in prose. These resolve
// those into clickable URLs so every dataset's source is reachable from inside
// the explorer, not just the Data Sources tab.

import type { Dataset } from '../types';

export interface ExternalLink {
  /**
   * The chip text, ready to render as-is — the identifier itself for the
   * `repository` and `pubmed` kinds ("GSE225038", "PMID 38145289"), the literal
   * "DOI" for a doi.org link, which has no short human-readable id. This is the
   * ONE spelling of the kind→label rule: three chip sites (the explorer hero,
   * the DatasetInfoPanel, the cross-dataset GeneReport) each re-derived it from
   * `kind` with an identical ternary that only reproduced what the builder had
   * already put here.
   */
  label: string;
  href: string;
  kind: 'repository' | 'doi' | 'pubmed';
  /** Hover/title text (full accession or id). */
  title: string;
}

/** Which repository an accession belongs to, or null if unrecognized. */
export function repositoryName(accession: string | undefined | null): string | null {
  if (!accession) return null;
  const a = accession.trim().toUpperCase();
  if (/^(GSE|GDS|GPL|GSM)\d/.test(a)) return 'GEO';
  if (/^E-\w+-/.test(a)) return 'ArrayExpress';
  return null;
}

/**
 * Resolve a repository accession to its landing-page URL. NCBI GEO series/dataset/
 * platform/sample ids go to the GEO accession viewer; EBI ArrayExpress ids (now
 * served from BioStudies) go to the ArrayExpress study page. Unknown → null.
 */
export function repositoryUrl(accession: string | undefined | null): string | null {
  if (!accession) return null;
  const a = accession.trim();
  const repo = repositoryName(a);
  if (repo === 'GEO') return `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${encodeURIComponent(a)}`;
  if (repo === 'ArrayExpress') return `https://www.ebi.ac.uk/biostudies/arrayexpress/studies/${encodeURIComponent(a)}`;
  return null;
}

/** Resolve a DOI (with or without a leading "doi:") to a doi.org URL. */
export function doiUrl(doi: string | undefined | null): string | null {
  if (!doi) return null;
  const d = doi.trim().replace(/^doi:\s*/i, '');
  return d ? `https://doi.org/${d}` : null;
}

/**
 * Extract a PubMed id embedded in a citation as "PMID 12345678" / "PMID: 12345678".
 *
 * A FALLBACK, not the source of truth — see `datasetPmid`. Kept exported because
 * it is also the only route to a PMID for a citation string that has no Dataset
 * behind it.
 */
export function parsePmid(text: string | undefined | null): string | null {
  if (!text) return null;
  const m = text.match(/PMID:?\s*(\d{5,9})/i);
  return m ? m[1] : null;
}

/**
 * A citation with its inline "PMID …" mention removed, for callers that render
 * the PMID separately as a link.
 *
 * 24 of the corpus's citations name the PMID in prose ("…(Yi et al., PMID
 * 35784876; GSE198437)"). A card that prints the citation verbatim AND appends
 * a PMID chip shows the same id twice. Stripping the prose copy rather than
 * suppressing the chip is the better trade: every card then carries exactly one
 * PMID and it is always the clickable one, instead of 24 cards carrying a dead
 * plain-text id.
 *
 * Every current mention is ", PMID <n>" closed by ";" or ")", but the pattern
 * below also absorbs a leading ";", a "PMID:" colon, and any parentheses left
 * empty by the strip, so a citation authored in a slightly different shape
 * degrades to a tidy string rather than "(, GSE123)".
 */
export function citationWithoutPmid(citation: string | undefined | null): string {
  if (!citation) return '';
  return citation
    .replace(/[,;]?\s*\bPMID:?\s*\d{5,9}/gi, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([;,.)])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Resolve a numeric PMID to its PubMed URL. */
export function pubmedUrl(pmid: string | undefined | null): string | null {
  if (!pmid) return null;
  const p = String(pmid).trim();
  return /^\d+$/.test(p) ? `https://pubmed.ncbi.nlm.nih.gov/${p}/` : null;
}

/**
 * A dataset's PubMed id: the registry's own `pmid` field, falling back to one
 * mined out of the citation prose.
 *
 * The fallback exists because the two disagree in coverage, not in content —
 * every citation-embedded PMID in the corpus was checked against the source
 * repository's record and hoisted into `pmid`, so the field is a superset. It
 * stays so that a citation authored with a "PMID …" but no field still links,
 * rather than silently losing the link a reader can plainly see in the text.
 */
export function datasetPmid(dataset: Dataset): string | null {
  const declared = dataset.pmid?.trim();
  return declared || parsePmid(dataset.citation);
}

/**
 * The full set of resolvable external links for a dataset, in display order:
 * repository (GEO/ArrayExpress) → DOI → PubMed. Omits any that don't resolve, so
 * the caller can render whatever is available without per-field guards.
 */
export function datasetExternalLinks(dataset: Dataset): ExternalLink[] {
  const out: ExternalLink[] = [];

  const repoUrl = repositoryUrl(dataset.geo);
  if (repoUrl && dataset.geo) {
    out.push({
      label: dataset.geo,
      href: repoUrl,
      kind: 'repository',
      title: `${repositoryName(dataset.geo)} accession ${dataset.geo}`,
    });
  }

  const dUrl = doiUrl(dataset.doi);
  if (dUrl) out.push({ label: 'DOI', href: dUrl, kind: 'doi', title: `doi:${dataset.doi}` });

  const pmid = datasetPmid(dataset);
  const pUrl = pubmedUrl(pmid);
  if (pUrl && pmid) {
    // Labelled with the id rather than "PubMed" so the chip states the same
    // kind of thing the accession chip beside it does: an identifier you can
    // quote, not just a destination you can click.
    out.push({ label: `PMID ${pmid}`, href: pUrl, kind: 'pubmed', title: `PubMed record ${pmid}` });
  }

  return out;
}
