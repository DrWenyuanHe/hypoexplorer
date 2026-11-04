// Turnkey ingest of a discovery-pass result into the dataset-survey catalog.
//
// The successor to the archived, temp-path one-offs in
// `nar-research/dataset-survey/provenance/rebuild_master*.mjs`: a single,
// committed, deterministic, idempotent stage that folds a verified discovery
// pass (e.g. Pass 8 = net-new hypothalamus tissue, Pass 9 = hypothalamic
// cell-line treatment datasets) into
// `nar-research/dataset-survey/scout_master_combined.json`, refreshes the
// `counts` block, and writes a machine-readable per-pass CSV.
//
// Input shape: the JSON returned by the pass-8/9 discovery workflow — either the
// whole `{ counts, confirmed, rejected, ... }` object or a bare `{ confirmed: [] }`.
// Each `confirmed` record is already record-grounded + independently verified by
// the workflow, so ingestion only normalizes it to the catalog schema and dedups
// it against what is already catalogued (by accession / parent BioProject).
//
// Usage:
//   node scripts/ingest_survey_pass.mjs <pass-result.json> [--replace-pass] [--dry]
//     --replace-pass  drop existing catalog rows whose `pass` matches an incoming
//                     pass before adding (clean re-ingest); default is skip-existing
//                     (idempotent: re-running the same input is a no-op).
//     --dry           print what would change without writing.
//
// After ingest, regenerate the shipped tracker blob: `npm run build:tracker`.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const SURVEY = path.join(ROOT, 'nar-research/dataset-survey');
const MASTER = path.join(SURVEY, 'scout_master_combined.json');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const inputPath = argv.find((a) => !a.startsWith('--'));
const DRY = flags.has('--dry');
const REPLACE = flags.has('--replace-pass');
if (!inputPath) {
  console.error('usage: node scripts/ingest_survey_pass.mjs <pass-result.json> [--replace-pass] [--dry]');
  process.exit(2);
}

// Cross-repository study identifiers (same set the tracker matcher uses).
const ACC_RE =
  /\b(GSE\d{3,}|E-MTAB-\d+|E-GEOD-\d+|E-GEAD-\d+|PRJ[NEDC][A-Z]?\d+|SRP\d+|ERP\d+|DRP\d+|EGAD\d+|EGAS\d+|CRA\d{3,}|OEP\d{5,}|HRA\d{3,}|CNP\d{4,}|PXD\d{4,}|OMIX\d{3,}|E-MEXP-\d+)\b/gi;
const normAcc = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
const shortAccOf = (s) => String(s || '?').split(/[ ;,(]/)[0].trim();

function accsIn(...blobs) {
  const set = new Set();
  for (const b of blobs) for (const m of String(b || '').match(ACC_RE) || []) set.add(normAcc(m));
  return set;
}

function parseLinks(rec) {
  const text = [rec.publication, rec.correctionNotes, rec.fullAcc, rec.evidenceUrl, rec.sourceUrl, rec.shortAcc]
    .filter(Boolean)
    .join('  ');
  const out: Record<string, string> = {};
  const doi = rec.doi || (text.match(/\b10\.\d{4,9}\/[^\s;,)"'\]]+/) || [])[0];
  if (doi) out.doi = String(doi).replace(/[.,;)\]]+$/, '');
  const pmid = rec.pmid || (text.match(/PMID:?\s*(\d{5,9})/i) || [])[1];
  if (pmid) out.pmid = String(pmid).replace(/\D/g, '');
  const pmc = (text.match(/PMC(\d{5,9})/i) || [])[1];
  if (pmc) out.pmc = pmc;
  const prj = (text.match(/PRJ[NEDC][A-Z]?\d{4,9}/i) || [])[0];
  if (prj) out.bioproject = prj.toUpperCase();
  const srp = (text.match(/\b[SED]RP\d{5,}\b/i) || [])[0];
  if (srp) out.sra = srp.toUpperCase();
  if (rec.evidenceUrl) out.firstUrl = String(rec.evidenceUrl).split(/[ ;]/)[0];
  return out;
}

function repoUrl(a) {
  if (/^GSE\d+/i.test(a)) return `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${a}`;
  if (/^PRJN/i.test(a)) return `https://www.ncbi.nlm.nih.gov/bioproject/${a.toUpperCase()}`;
  if (/^(PRJE|PRJD|ERP|DRA|DRP|SRP|PRJC|CRA)/i.test(a))
    return `https://www.ebi.ac.uk/ena/browser/view/${a.toUpperCase()}`;
  if (/^E-(MTAB|GEOD|GEAD|MEXP)/i.test(a))
    return `https://www.ebi.ac.uk/biostudies/arrayexpress/studies/${a.toUpperCase()}`;
  if (/^(CNP|OMIX|HRA|CRA)/i.test(a)) return `https://db.cngb.org/search/?q=${a.toUpperCase()}`;
  if (/^EGAD/i.test(a)) return `https://ega-archive.org/datasets/${a.toUpperCase()}`;
  if (/^10\.\d{4,9}\//.test(a)) return `https://doi.org/${a}`;
  return '';
}

// --- Normalize one verified workflow record into the catalog record schema. ---
function toCatalogRecord(c) {
  const acc = shortAccOf(c.shortAcc || c.fullAcc);
  const links = parseLinks(c);
  const feasTier = c.feas?.tier || c.feasTier || '';
  return {
    kind: 'confirmed',
    pass: c.pass,
    searchTag: c.searchTag || '',
    shortAcc: acc,
    fullAcc: c.fullAcc || acc,
    repository: c.repository || '',
    title: c.title || '',
    species: c.species || '',
    region: c.region || '',
    modality: c.modality || '',
    platform: c.platform || '',
    phenotype: c.phenotype || '',
    design: c.design || '',
    n: c.n || '',
    raw: c.raw || (c.feas?.rawFiles ? 'yes' : 'unknown'),
    publication: c.publication || '',
    why: c.why || '',
    verdict: c.verdict || 'confirmed',
    confidence: c.confidence || '',
    isHypothalamus: c.isHypothalamus !== false,
    isCellLine: !!c.isCellLine,
    cellLine: c.cellLine || '',
    isPublic: c.isPublic !== false,
    correctionNotes: c.correctionNotes || '',
    angles: [c.searchTag].filter(Boolean),
    method: c.searchTag || '',
    alreadyKnown: false,
    sourceUrl: String(c.sourceUrl || '').split(/[ ;]/)[0],
    evidenceUrl: String(c.evidenceUrl || '').split(/[ ;]/)[0],
    repoUrl: c.repoUrl || repoUrl(acc) || String(c.evidenceUrl || '').split(/[ ;]/)[0],
    links,
    score: null,
    feas: {
      tier: feasTier,
      pipeline: c.feas?.pipeline || '',
      access: c.feas?.access || (c.isPublic ? 'open' : 'unknown'),
      raw_present: c.feas?.rawFiles ? 'yes' : c.raw || 'unknown',
    },
    nadeq: {
      min: c.nadeq?.min ?? null,
      ok: c.nadeq?.adequate ?? (typeof c.nadeq?.min === 'number' ? c.nadeq.min >= 3 : false),
      perGroup: c.nadeq?.note || '',
      contrast: c.phenotype || '',
    },
  };
}

const master = JSON.parse(readFileSync(MASTER, 'utf8'));
const raw = JSON.parse(readFileSync(path.resolve(inputPath), 'utf8'));
const incoming = raw.confirmed || raw.result?.confirmed || (Array.isArray(raw) ? raw : []);
if (!incoming.length) {
  console.error('no `confirmed` records in input — nothing to ingest.');
  process.exit(1);
}

const incomingPasses = new Set(incoming.map((c) => c.pass).filter((p) => p != null));

// Optional clean re-ingest: drop existing rows for the incoming pass(es).
if (REPLACE && incomingPasses.size) {
  const before = master.confirmed.length;
  master.confirmed = master.confirmed.filter((r) => !incomingPasses.has(r.pass));
  console.log(`--replace-pass: dropped ${before - master.confirmed.length} existing row(s) for pass(es) ${[...incomingPasses].join(', ')}`);
}

// Existing identity index (shortAcc + every embedded accession/BioProject).
const existing = new Set();
for (const r of master.confirmed) {
  existing.add(normAcc(r.shortAcc));
  for (const a of accsIn(r.shortAcc, r.fullAcc, r.alsoAs, JSON.stringify(r.links || {}))) existing.add(a);
}

const seen = new Set();
const added = [];
let dupCatalog = 0, dupSelf = 0, dropped = 0;
for (const c of incoming) {
  if (c.isHypothalamus === false) { dropped++; continue; }
  const acc = normAcc(shortAccOf(c.shortAcc || c.fullAcc));
  if (!acc || acc === '?') { dropped++; continue; }
  const accs = accsIn(c.shortAcc, c.fullAcc, c.repository, c.evidenceUrl, c.repoUrl);
  accs.add(acc);
  if ([...accs].some((a) => existing.has(a))) { dupCatalog++; continue; }
  if ([...accs].some((a) => seen.has(a))) { dupSelf++; continue; }
  for (const a of accs) seen.add(a);
  added.push(toCatalogRecord(c));
}

for (const rec of added) master.confirmed.push(rec);

// Refresh counts: per-pass totals + per-searchTag breakdown for the touched passes.
master.counts = master.counts || {};
for (const p of incomingPasses) {
  master.counts[`pass${p}`] = master.confirmed.filter((r) => r.pass === p).length;
}
const tagCounts = {};
for (const r of master.confirmed.filter((r) => incomingPasses.has(r.pass))) {
  const t = r.searchTag || `pass${r.pass}`;
  tagCounts[t] = (tagCounts[t] || 0) + 1;
}

// Per-pass CSV (one file per pass present in the input).
const q = (s) =>
  `"${String(s == null ? '' : s).replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`;
const COLS = ['accession', 'pass', 'searchTag', 'repository', 'species', 'region', 'modality', 'phenotype', 'design', 'n', 'raw', 'feas_tier', 'n_min', 'n_ok', 'is_cell_line', 'cell_line', 'publication', 'source_url', 'evidence_url'];
const csvFiles = [];
for (const p of incomingPasses) {
  const rows = master.confirmed.filter((r) => r.pass === p);
  let csv = `${COLS.join(',')}\n`;
  for (const r of rows) {
    csv += `${[r.shortAcc, r.pass, r.searchTag, r.repository, r.species, r.region, r.modality, r.phenotype, r.design, r.n, r.raw, r.feas?.tier, r.nadeq?.min, r.nadeq?.ok, r.isCellLine, r.cellLine, r.publication, r.sourceUrl, r.evidenceUrl].map(q).join(',')}\n`;
  }
  const file = path.join(SURVEY, `hypoexplorer_pass${p}.csv`);
  csvFiles.push([file, csv, rows.length]);
}

console.log(`ingest ${path.basename(inputPath)}: +${added.length} added · ${dupCatalog} already in catalog · ${dupSelf} intra-input dup · ${dropped} dropped`);
console.log('per-tag (touched passes):', JSON.stringify(tagCounts));
console.log('catalog total now:', master.confirmed.length);

if (DRY) {
  console.log('--dry: no files written. Would write CSV(s):', csvFiles.map((c) => `${path.relative(ROOT, c[0])} (${c[2]} rows)`).join(', '));
  process.exit(0);
}

writeFileSync(MASTER, JSON.stringify(master, null, 1));
for (const [file, csv, n] of csvFiles) {
  writeFileSync(file, csv);
  console.log('wrote', path.relative(ROOT, file), `(${n} rows)`);
}
console.log('done. Next: npm run build:tracker');
