import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const here = path.dirname(fileURLToPath(import.meta.url));
// The dataset catalog lives in the gitignored research layer; read it live so the
// tracker always reflects the latest search/eval passes.
const CATALOG = path.resolve(here, '../nar-research/dataset-survey/scout_master_combined.json');
// HypoExplorer's bundled dataset registry — the SINGLE SOURCE OF TRUTH for which
// datasets are already integrated into the live explorer. We read it live so the
// tracker auto-flags any candidate that is already in the explorer (and surfaces
// the full "what's integrated" list) without anyone marking it by hand.
// NOTE: now a .ts module — the dynamic import below runs under plain Node, which
// can't import TS, so it falls back to the regex parse (designed for exactly this).
const REGISTRY = path.resolve(here, '../src/data/datasets.ts');
const DATA_DIR = path.resolve(here, 'data');
const STATUS_FILE = path.resolve(DATA_DIR, 'statuses.json');
// Tracker-only sidecar of provenance accessions (BioProject / CNGB / etc.) for the
// integrated datasets, so we catch the SAME raw data re-deposited under a different
// accession. Editing it does NOT touch the deployed explorer. See README.
const EXPLORER_ACC_FILE = path.resolve(DATA_DIR, 'explorer_accessions.json');

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => resolve(d)); });
}
function loadStatuses(): Record<string, unknown> {
  try { if (existsSync(STATUS_FILE)) return JSON.parse(readFileSync(STATUS_FILE, 'utf8')); } catch (e) { /* */ }
  return {};
}
function saveStatuses(obj: unknown): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATUS_FILE, JSON.stringify(obj, null, 2));
}

// --- Integration detection --------------------------------------------------
// Accession patterns we treat as cross-repository study identifiers. DOIs and
// PMIDs are matched separately (below) since they need their own normalization.
const ACC_RE = /\b(GSE\d{3,}|E-MTAB-\d+|E-GEOD-\d+|PRJ[NEDC][A-Z]?\d+|SRP\d+|ERP\d+|DRP\d+|EGAD\d+|EGAS\d+|CRA\d{3,}|OEP\d{5,}|HRA\d{3,})\b/gi;
const normAcc = (s: unknown) => String(s).toUpperCase().replace(/\s+/g, '');
const normDoi = (s: unknown) => String(s).toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/[).,;]+$/, '');
const digits = (s: unknown) => String(s).replace(/\D/g, '');

function accSet(...texts: unknown[]): Set<string> {
  const set = new Set<string>();
  for (const t of texts) { if (!t) continue; for (const m of String(t).match(ACC_RE) || []) set.add(normAcc(m)); }
  return set;
}

// Load the HypoExplorer registry. Primary path: load the ES module through Vite's
// own SSR module loader, which transforms TypeScript (a raw Node `import()` can't
// load the now-.ts datasets module). Fallback: a tolerant regex parse of the file
// text, so a future import-time dependency can't break the tracker.
async function loadRegistry(server: { ssrLoadModule: (id: string) => Promise<Record<string, unknown>> }) {
  let DATASETS = null;
  try {
    // ssrLoadModule wants a POSIX-style id; normalize the Windows path separators.
    const mod = await server.ssrLoadModule(REGISTRY.replace(/\\/g, '/'));
    DATASETS = mod.DATASETS;
  } catch (e) {
    try {
      const src = readFileSync(REGISTRY, 'utf8');
      DATASETS = [];
      const grab = (block, key) => { const m = block.match(new RegExp(key + "\\s*:\\s*'([^']*)'")); return m ? m[1] : ''; };
      // split into per-dataset object blocks at "id:" boundaries (best-effort).
      // Entries are authored as `defineDataset({ ... })`; accept a bare `{` too
      // so the fallback keeps working if the factory wrapper ever goes away.
      const blocks = src.split(/\n\s*(?:defineDataset\()?\{\s*\n/).filter((b) => /id\s*:/.test(b));
      for (const b of blocks) {
        const id = grab(b, 'id'); if (!id) continue;
        DATASETS.push({ id, name: grab(b, 'name'), organism: grab(b, 'organism'), modality: grab(b, 'modality'), geo: grab(b, 'geo'), doi: grab(b, 'doi'), citation: grab(b, 'citation') });
      }
    } catch (e2) { DATASETS = []; }
  }
  let sidecar = {};
  try { if (existsSync(EXPLORER_ACC_FILE)) sidecar = JSON.parse(readFileSync(EXPLORER_ACC_FILE, 'utf8')); } catch (e) { /* */ }
  return (DATASETS || []).map((d) => {
    const text = [d.geo, d.name, d.citation, d.doi].filter(Boolean).join(' ');
    const accs = accSet(d.geo, d.name, d.citation, d.doi);
    if (d.geo) accs.add(normAcc(d.geo));
    // Merge sidecar provenance accessions (BioProject / CNGB / SRA study / mirrors).
    const extra = sidecar[d.id];
    if (extra && Array.isArray(extra.accessions)) extra.accessions.forEach((a) => accs.add(normAcc(a)));
    const dois = new Set(); if (d.doi) dois.add(normDoi(d.doi));
    for (const m of text.match(/10\.\d{4,9}\/[^\s"');]+/g) || []) dois.add(normDoi(m));
    const pmids = new Set();
    for (const m of text.match(/pmid[:\s]*([0-9]{6,9})/gi) || []) pmids.add(digits(m));
    if (extra && Array.isArray(extra.pmids)) extra.pmids.forEach((p) => pmids.add(digits(p)));
    return {
      id: d.id, name: d.name || d.id, organism: d.organism || '', modality: d.modality || '',
      geo: d.geo || '', doi: d.doi || '',
      accessions: [...accs], dois: [...dois], pmids: [...pmids],
    };
  });
}

// Decide a catalog row's relationship to the integrated datasets, in two tiers:
//   tier "dataset"     — same accession (GEO/BioProject/CNGB/…) → genuinely the
//                        same dataset that is already in the explorer.
//   tier "publication" — only the DOI/PMID match → SAME PAPER but a DIFFERENT
//                        dataset (a paper can deposit several distinct series).
// Accession identity always wins over a publication-only match.
function integrationFor(r, registry) {
  const L = r.links || {};
  const accs = accSet(r.shortAcc, r.fullAcc, r.alsoAs, L.bioproject, L.sra, L.geo);
  if (r.shortAcc) accs.add(normAcc(r.shortAcc));
  const doi = L.doi ? normDoi(L.doi) : '';
  const pmid = L.pmid ? digits(L.pmid) : '';
  let pub = null;
  for (const d of registry) {
    const accHit = d.accessions.find((a) => accs.has(a));
    if (accHit) return { tier: 'dataset', id: d.id, name: d.name, via: 'accession ' + accHit };
    if (!pub) {
      if (doi && d.dois.includes(doi)) pub = { tier: 'publication', id: d.id, name: d.name, via: 'DOI ' + doi };
      else if (pmid && d.pmids.includes(pmid)) pub = { tier: 'publication', id: d.id, name: d.name, via: 'PMID ' + pmid };
    }
  }
  return pub;
}

// map a master record to the lean shape the UI needs (keeps full detail for the panel)
function trim(r) {
  return {
    acc: r.shortAcc, title: r.title || '', species: r.species || '', region: r.region || '',
    modality: r.modality || '', platform: r.platform || '', phenotype: r.phenotype || '',
    design: r.design || '', n: r.n || '', raw: r.raw || 'unknown', publication: r.publication || '',
    pass: r.pass || 1, searchTag: r.searchTag || '', method: r.method || '',
    repoUrl: r.repoUrl || '', evidenceUrl: r.evidenceUrl || '', links: r.links || {},
    alsoAs: r.alsoAs || '', correctionNotes: r.correctionNotes || '', verdict: r.verdict || '', confidence: r.confidence || '',
    score: r.score ? { fit: r.score.fit_score, rec: r.score.recommendation, tier: r.score.tier, rationale: r.score.rationale, risks: r.score.risks } : null,
    feas: r.feas || null, nadeq: r.nadeq || null,
  };
}

function trackerApi() {
  return {
    name: 'tracker-api',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = (req.url || '').split('?')[0];
        const json = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
        try {
          if (url === '/api/catalog' && req.method === 'GET') {
            const M = JSON.parse(readFileSync(CATALOG, 'utf8'));
            const registry = await loadRegistry(server);
            const rows = (M.confirmed || []).map((r) => {
              const row = trim(r);
              const m = integrationFor(r, registry);
              (row as any).match = m || null;
              (row as any).integrated = !!(m && m.tier === 'dataset');
              (row as any).related = !!(m && m.tier === 'publication');
              return row;
            });
            // The explorer registry itself, so the UI can always show what's integrated
            // even for datasets that were never survey candidates.
            const explorer = registry.map((d) => ({
              id: d.id, name: d.name, organism: d.organism, modality: d.modality,
              geo: d.geo, doi: d.doi, accessions: d.accessions,
            }));
            return json(200, {
              rows, count: rows.length, explorer,
              integratedCount: rows.filter((x) => (x as any).integrated).length,
              relatedCount: rows.filter((x) => (x as any).related).length,
            });
          }
          if (url === '/api/statuses' && req.method === 'GET') {
            return json(200, loadStatuses());
          }
          if (url === '/api/statuses' && (req.method === 'POST' || req.method === 'PUT')) {
            const body = await readBody(req);
            const obj = JSON.parse(body || '{}');
            saveStatuses(obj);
            return json(200, { ok: true, n: Object.keys(obj).length });
          }
        } catch (e) {
          return json(500, { error: String((e && (e as Error).message) || e) });
        }
        next();
      });
    },
  };
}

export default defineConfig({
  // Cast: the sub-app has its own vite install, so react()'s Plugin type (from the
  // root vite) and this config's expected Plugin type (sub-app vite) are nominally
  // distinct copies. The cast avoids that cross-package type clash.
  // biome-ignore lint/suspicious/noExplicitAny: dual vite install plugin-type clash
  plugins: [react(), trackerApi()] as any,
  server: { port: 5179, open: true },
});
