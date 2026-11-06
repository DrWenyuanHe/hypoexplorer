// Shared, pure integration-matching logic for the dataset tracker.
//
// Decides, for each survey candidate, whether it is the SAME study already
// integrated into HypoExplorer (src/data/datasets.js). Ported verbatim (logic
// unchanged) from the standalone tracker's dev-server, then made pure: the
// functions here take already-loaded data (the DATASETS array, the provenance
// sidecar object, a catalog record) and never touch the filesystem — so the same
// code runs in the build generator (scripts/build_tracker_catalog.mjs) and is
// trivially unit-testable.
//
// Two tiers of match:
//   tier "dataset"     — a shared accession / BioProject / CNGB id → genuinely the
//                        same dataset that is already in the explorer.
//   tier "publication" — only the DOI/PMID matches → SAME PAPER but a DIFFERENT
//                        dataset (one publication can deposit several series).
// Accession identity always wins over a publication-only match.

// Accession patterns we treat as cross-repository study identifiers. DOIs and
// PMIDs are matched separately since they need their own normalization.
export const ACC_RE =
  /\b(GSE\d{3,}|E-MTAB-\d+|E-GEOD-\d+|PRJ[NEDC][A-Z]?\d+|SRP\d+|ERP\d+|DRP\d+|EGAD\d+|EGAS\d+|CRA\d{3,}|OEP\d{5,}|HRA\d{3,})\b/gi;

export const normAcc = (s: unknown) => String(s).toUpperCase().replace(/\s+/g, '');
export const normDoi = (s: unknown) =>
  String(s)
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/[).,;]+$/, '');
export const digits = (s: unknown) => String(s).replace(/\D/g, '');

export function accSet(...texts: unknown[]) {
  const set = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of String(t).match(ACC_RE) || []) set.add(normAcc(m));
  }
  return set;
}

// Build the matchable identity index for the explorer's registry.
//   datasets — the DATASETS array from src/data/datasets.js
//   sidecar  — provenance accessions keyed by dataset id (explorerAccessions.json)
// Returns one entry per dataset: { id, name, organism, modality, geo, doi,
// accessions[], dois[], pmids[] }.
export function buildRegistry(datasets: any[], sidecar: Record<string, any> = {}) {
  return (datasets || []).map((d: any) => {
    const text = [d.geo, d.name, d.citation, d.doi].filter(Boolean).join(' ');
    const accs = accSet(d.geo, d.name, d.citation, d.doi);
    if (d.geo) accs.add(normAcc(d.geo));
    // Merge sidecar provenance accessions (BioProject / CNGB / SRA study / mirrors).
    const extra = sidecar[d.id];
    if (extra && Array.isArray(extra.accessions))
      for (const a of extra.accessions) accs.add(normAcc(a));
    const dois = new Set<string>();
    if (d.doi) dois.add(normDoi(d.doi));
    for (const m of text.match(/10\.\d{4,9}\/[^\s"');]+/g) || []) dois.add(normDoi(m));
    const pmids = new Set<string>();
    for (const m of text.match(/pmid[:\s]*([0-9]{6,9})/gi) || []) pmids.add(digits(m));
    if (extra && Array.isArray(extra.pmids)) for (const p of extra.pmids) pmids.add(digits(p));
    return {
      id: d.id,
      name: d.name || d.id,
      organism: d.organism || '',
      modality: d.modality || '',
      geo: d.geo || '',
      doi: d.doi || '',
      accessions: [...accs],
      dois: [...dois],
      pmids: [...pmids],
    };
  });
}

// Classify a single catalog record against the registry. Returns the match
// object { tier, id, name, via } or null.
export function integrationFor(r: any, registry: any[]) {
  const L = r.links || {};
  const accs = accSet(r.shortAcc, r.fullAcc, r.alsoAs, L.bioproject, L.sra, L.geo);
  if (r.shortAcc) accs.add(normAcc(r.shortAcc));
  const doi = L.doi ? normDoi(L.doi) : '';
  const pmid = L.pmid ? digits(L.pmid) : '';
  let pub = null;
  for (const d of registry) {
    const accHit = d.accessions.find((a: string) => accs.has(a));
    if (accHit) return { tier: 'dataset', id: d.id, name: d.name, via: `accession ${accHit}` };
    if (!pub) {
      if (doi && d.dois.includes(doi))
        pub = { tier: 'publication', id: d.id, name: d.name, via: `DOI ${doi}` };
      else if (pmid && d.pmids.includes(pmid))
        pub = { tier: 'publication', id: d.id, name: d.name, via: `PMID ${pmid}` };
    }
  }
  return pub;
}

// Trim a master survey record to the lean shape the tracker UI needs (keeps full
// detail for the dossier panel). Ported from the standalone dev-server.
export function trimRecord(r: any) {
  return {
    acc: r.shortAcc,
    title: r.title || '',
    species: r.species || '',
    region: r.region || '',
    isCellLine: !!r.isCellLine,
    cellLine: r.cellLine || '',
    modality: r.modality || '',
    platform: r.platform || '',
    phenotype: r.phenotype || '',
    design: r.design || '',
    n: r.n || '',
    raw: r.raw || 'unknown',
    publication: r.publication || '',
    pass: r.pass || 1,
    searchTag: r.searchTag || '',
    method: r.method || '',
    repoUrl: r.repoUrl || '',
    evidenceUrl: r.evidenceUrl || '',
    links: r.links || {},
    alsoAs: r.alsoAs || '',
    correctionNotes: r.correctionNotes || '',
    verdict: r.verdict || '',
    confidence: r.confidence || '',
    // The survey's score rationale and risks are internal publication-strategy
    // notes, so the public catalog carries only the fit score and recommendation.
    score: r.score
      ? {
          fit: r.score.fit_score,
          rec: r.score.recommendation,
          tier: r.score.tier,
        }
      : null,
    feas: r.feas || null,
    nadeq: r.nadeq || null,
  };
}
