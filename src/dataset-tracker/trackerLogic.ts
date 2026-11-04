// Pure helpers for the Dataset Tracker view. No React, no I/O — easy to unit-test
// and shared by the table, board, and detail panel. Ported from the standalone
// tracker app; behaviour unchanged.

import type { Reviews, TrackerRow } from '../types';
import {
  getAuthorValidation,
  type AuthorValidationRecord,
} from '../data/authorValidation';
import { VERIFICATION_CLAIMS, getVerificationClaim, RESULT_AVAILABILITY, EVIDENCE_LEVELS } from '../data/authorVerification';
import { datasetQuality, qualitySearchText } from '../data/datasetQualityR460';

export interface StatusDef {
  key: string;
  label: string;
  cls: string;
}

export const STATUSES: StatusDef[] = [
  { key: 'new', label: 'New', cls: 'new' },
  { key: 'reviewed', label: 'Reviewed', cls: 'reviewed' },
  { key: 'pipeline', label: 'In pipeline', cls: 'pipeline' },
  { key: 'added', label: 'Added', cls: 'added' },
  { key: 'rejected', label: 'Rejected', cls: 'rejected' },
];
export const STATUS_KEYS = STATUSES.map((s) => s.key);

// The single spelling of "resolve a stored status string to its definition".
// An unrecognised status degrades to STATUSES[0] (New) rather than rendering a
// blank badge — review state is user-editable JSON, so it can hold anything.
export function statusDef(status: string): StatusDef {
  return STATUSES.find((s) => s.key === status) || STATUSES[0];
}

export interface TrackerFilterState {
  q?: string;
  status: string;
  feas: string;
  nok: string;
  mod: string;
  sp: string;
  model?: string;
  tag: string;
  integ: string;
  validation: string;
  pipelineQc?: string;
  experimentalDesign?: string;
  authorConcordance?: string;
  availability?: string;
}

export interface TrackerSort {
  key: string;
  dir: number;
}

export function speciesGroup(sp?: string): string {
  const s = (sp || '').toLowerCase();
  if (s.includes('homo') || s.includes('human')) return 'Human';
  if (/macaca|callithrix|papio|marmoset|baboon|rhesus|cynomolgus|primate/.test(s)) return 'Primate';
  if (/mus |mouse/.test(s)) return 'Mouse';
  if (/rattus|\brat\b/.test(s)) return 'Rat';
  if (
    /ovis|sheep|capra|goat|bos|cattle|bovine|sus|pig|porcine|gallus|chick|duck|goose|quail|equus|horse/.test(
      s,
    )
  )
    return 'Livestock/bird';
  return 'Other';
}

// Tissue vs. hypothalamus-derived cell model. The pass-9 sweep added immortalized
// hypothalamic lines (GT1-7, GN11, the Belsham mHypo/rHypo clones), iPSC/hESC-derived
// hypothalamic neurons and organoids — a scope expansion from "tissue" the explorer
// should be able to filter on. New records carry an explicit `isCellLine` flag; the
// regex is a fallback so legacy rows (catalogued before the flag existed) classify too.
const CELL_LINE_RE =
  /\bGT1-?7\b|\bGN11\b|mHypo|rHypo|immortali[sz]|cell line|cell-line|\biPSC\b|\bhESC\b|ESC-derived|organoid|assembloid|HypoE-|HypoA-/i;
export function modelGroup(r: TrackerRow): string {
  if (r.isCellLine) return 'Cell line';
  return CELL_LINE_RE.test(`${r.region || ''} ${r.title || ''}`) ? 'Cell line' : 'Tissue';
}
export const MODEL_GROUPS = ['Tissue', 'Cell line'];

export function modGroup(m?: string): string {
  const s = (m || '').toLowerCase();
  if (/mirna|small-rna|small rna|microrna|non-coding/.test(s)) return 'miRNA';
  if (/spatial|visium|xenium|stereo-seq|merfish|slide-seq/.test(s)) return 'Spatial';
  if (
    /snrna|single-nucleus|single nucleus|scrna|single-cell|single cell|drop-seq|dronc|10x|chromium/.test(
      s,
    )
  )
    return 'Single-cell';
  if (/trap|ribosome|bactrap|nutrap|ribotag/.test(s)) return 'TRAP/sorted';
  if (/microarray|\barray\b/.test(s)) return 'Microarray';
  if (/bulk|expression profiling by high/.test(s)) return 'Bulk';
  return 'Other';
}

interface FeasMeta {
  label: string;
  cls: string;
  rank: number;
}

const FEAS: Record<string, FeasMeta> = {
  'drop-in': { label: 'Existing pipeline', cls: 'fz-drop', rank: 0 },
  'modified-pipeline': { label: 'Pipeline changes', cls: 'fz-mod', rank: 1 },
  'heavy-lift': { label: 'Major rework', cls: 'fz-heavy', rank: 2 },
  blocked: { label: 'Blocked', cls: 'fz-block', rank: 3 },
};
export function feasMeta(r: TrackerRow): FeasMeta {
  const t = r.feas?.tier;
  return (t && FEAS[t]) || { label: '—', cls: 'fz-na', rank: 4 };
}

// n>=3 state keyed off the immutable catalog fact nadeq.min (NOT review status).
export function nState(r: TrackerRow): { s: 'unknown' | 'excluded' | 'ok'; min: number | null } {
  if (!r.nadeq || r.nadeq.min == null) return { s: 'unknown', min: null };
  return { s: r.nadeq.min < 3 ? 'excluded' : 'ok', min: r.nadeq.min };
}

export function firstN(n?: string | number): string {
  const m = String(n || '').match(/\d[\d,]*/);
  return m ? m[0] : '—';
}

export const SPECIES_GROUPS = ['Human', 'Primate', 'Mouse', 'Rat', 'Livestock/bird', 'Other'];
export const MOD_GROUPS = [
  'Bulk',
  'Single-cell',
  'miRNA',
  'Spatial',
  'TRAP/sorted',
  'Microarray',
  'Other',
];

/** Validation belongs to explorer datasets, keyed by the registry id carried by
 *  an integrated tracker match. Candidates outside the explorer have no local
 *  pipeline output to validate and are kept as an explicit filter bucket. */
export function validationForTrackerRow(r: TrackerRow): AuthorValidationRecord | undefined {
  if (!r.integrated || !r.match) return undefined;
  return getAuthorValidation(r.match.id);
}

export function trackerValidationKey(r: TrackerRow): string {
  const record = validationForTrackerRow(r);
  return record ? getVerificationClaim(record.verification) : 'not_in_explorer';
}

// Source links for the dossier panel: [label, url] pairs.
export function linkChips(r: TrackerRow): Array<[string, string]> {
  const L = r.links || {};
  const out: Array<[string, string]> = [];
  if (r.repoUrl) out.push(['Repository', r.repoUrl]);
  if (L.doi) out.push(['DOI', `https://doi.org/${L.doi}`]);
  if (L.pmid) out.push(['PubMed', `https://pubmed.ncbi.nlm.nih.gov/${L.pmid}/`]);
  if (L.pmc) out.push(['PMC', `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${L.pmc}/`]);
  if (L.bioproject)
    out.push([L.bioproject, `https://www.ncbi.nlm.nih.gov/bioproject/${L.bioproject}`]);
  if (L.sra) out.push([L.sra, `https://www.ncbi.nlm.nih.gov/sra/?term=${L.sra}`]);
  if (L.cellxgene)
    out.push(['CELLxGENE', `https://cellxgene.cziscience.com/collections/${L.cellxgene}`]);
  if (r.evidenceUrl && r.evidenceUrl !== r.repoUrl) out.push(['Source evidence', r.evidenceUrl]);
  return out;
}

export const statusOf = (reviews: Reviews, acc: string): string => reviews[acc]?.status || 'new';

// The single source of truth for filtering + sorting the catalog rows, so the
// table and board stay consistent. `f` is the filter state; `sort` is {key,dir}.
export function filterAndSort(
  rows: TrackerRow[] | null | undefined,
  reviews: Reviews,
  f: TrackerFilterState,
  sort: TrackerSort,
): TrackerRow[] {
  if (!rows) return [];
  const q = (f.q || '').trim().toLowerCase();
  const sOf = (acc: string) => statusOf(reviews, acc);
  let out = rows.filter((r) => {
    if (f.status !== 'all' && sOf(r.acc) !== f.status) return false;
    if (f.feas !== 'all' && (r.feas?.tier ? r.feas.tier : 'not-surveyed') !== f.feas) return false;
    const ns = nState(r).s;
    if (f.nok === 'ok' && ns !== 'ok') return false;
    if (f.nok === 'excluded' && ns !== 'excluded') return false;
    if (f.nok === 'unknown' && ns !== 'unknown') return false;
    if (f.mod !== 'all' && modGroup(r.modality) !== f.mod) return false;
    if (f.sp !== 'all' && speciesGroup(r.species) !== f.sp) return false;
    if (f.model && f.model !== 'all' && modelGroup(r) !== f.model) return false;
    if (f.tag !== 'all' && (r.searchTag || `pass${r.pass}`) !== f.tag) return false;
    if (f.integ === 'yes' && !r.integrated) return false;
    if (f.integ === 'related' && !r.related) return false;
    if (f.integ === 'no' && (r.integrated || r.related)) return false;
    const legacyPartial = f.validation === 'partial'
      && validationForTrackerRow(r)?.verification.state === 'partial';
    if (f.validation !== 'all' && trackerValidationKey(r) !== f.validation && !legacyPartial) return false;
    for (const key of ['pipelineQc', 'experimentalDesign', 'authorConcordance'] as const) {
      if (f[key] && f[key] !== 'all') {
        const record = validationForTrackerRow(r);
        if (!record || datasetQuality(record)[key].status !== f[key]) return false;
      }
    }
    if (f.availability && f.availability !== 'all'
      && validationForTrackerRow(r)?.verification.resultAvailability !== f.availability) return false;
    if (
      q &&
      !(
        r.acc +
        ' ' +
        r.title +
        ' ' +
        r.species +
        ' ' +
        r.region +
        ' ' +
        r.phenotype +
        ' ' +
        (r.method || '')
        + ' '
        + trackerVerificationSearch(r)
      )
        .toLowerCase()
        .includes(q)
    )
      return false;
    return true;
  });
  const dir = sort.dir;
  const keyFns: Record<string, (r: TrackerRow) => string | number> = {
    acc: (r) => r.acc.toLowerCase(),
    sp: (r) => speciesGroup(r.species),
    reg: (r) => r.region || '',
    mod: (r) => modGroup(r.modality),
    n: (r) => parseInt(firstN(r.n).replace(/,/g, ''), 10) || 0,
    feas: (r) => feasMeta(r).rank,
    nok: (r) => nState(r).min ?? -1,
    fit: (r) => (r.score ? r.score.fit ?? -1 : -1),
    status: (r) => STATUS_KEYS.indexOf(sOf(r.acc)),
    validation: (r) => {
      const record = validationForTrackerRow(r);
      return record ? VERIFICATION_CLAIMS[getVerificationClaim(record.verification)].rank : 99;
    },
  };
  const key = keyFns[sort.key] || ((r: TrackerRow) => r.acc);
  out = [...out].sort((a, b) => {
    const av = key(a),
      bv = key(b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
  return out;
}

function trackerVerificationSearch(r: TrackerRow): string {
  const record = validationForTrackerRow(r);
  if (!record) return 'not in explorer';
  return [record.summary, record.note, record.verification.reason,
    qualitySearchText(record),
    VERIFICATION_CLAIMS[getVerificationClaim(record.verification)].label,
    RESULT_AVAILABILITY[record.verification.resultAvailability].label,
    EVIDENCE_LEVELS[record.verification.evidenceLevel].label].join(' ');
}
