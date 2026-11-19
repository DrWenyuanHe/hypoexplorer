// The search portal's at-a-glance summaries: one gene's or one pathway's
// results across the studies, a gene's baseline expression in sorted mouse
// hypothalamic populations, and its values in the human reference atlases.
//
// INDEX ONLY. The cross-study summaries read the precomputed query index (a
// manifest and one shard, two small requests) through crossDataset's
// queryGeneViaIndex / queryPathwayViaIndex, the same rows the full reports
// render. When the index is unavailable they resolve null and the portal says
// so; they never fall back to the per-track download (about 284 MB) that the
// full reports may use. That cost belongs to an explicit "Open full report".
//
// Significance and direction come from the rows (crossDatasetRows), so the
// portal and the reports cannot disagree about what counts as a change.
//
// The condition-pathways card chains the two: the gene's significant tracks,
// then each track's significant pathways from the index's track-pathways
// family (one small file per track, loaded only for the tracks it follows).
// Those rows are copies of the pathway index's own, so a pathway listed here
// is one the pathway portal also calls significant in that track. Each row also
// carries the pathway's corpus base rate, which ranks pathways by how specific
// their recurrence is to the gene's conditions, still without another request.

import { queryGeneViaIndex, queryPathwayViaIndex } from '../data/crossDataset';
import { listDatasets } from '../data/datasets';
import { manifestFreshness } from '../data/indexFreshness';
import { peekDatasetMeta } from '../data/loadDatasetMeta';
import { loadQueryManifest, loadTrackPathways, manifestSupportsTrackPathways } from '../data/queryIndex';
import { effectDirection, significanceTier } from '../statistics/policy';
import { mapLimit } from '../utils/mapLimit';
import { pathwaySpecificity, type CorpusRate, type Specificity } from './pathwaySpecificity';
import { loadNeuroseqExpression, loadNeuroseqManifest, neuroseqSources } from '../expression-survey/neuroseqExpression';
import { loadExternalExpression, loadExternalSources } from '../expression-survey/externalReference';
import type {
  Dataset, DatasetGroup, Direction, ExpressionGeneResult, ExpressionGroupResult, ExpressionSource,
  PathwayDatasetGroup, PathwayTrackRow, ResolvedContrast, TrackRow,
} from '../types';

/** One track's result, with the study and comparison it belongs to. */
export interface SummaryRow<Row> {
  dataset: Dataset;
  contrast: ResolvedContrast | null;
  track: Row;
}

export interface CrossStudySummary<Row> {
  /** Studies where the gene or pathway has at least one result. */
  studiesMeasured: number;
  /** Studies with at least one significant track. */
  studiesSignificant: number;
  tracksMeasured: number;
  tracksSignificant: number;
  /** Significant tracks by direction. */
  up: number;
  down: number;
  /**
   * Tracks with raw p < NOMINAL_P_CUTOFF that do NOT pass the FDR call: the
   * nominal tier, disjoint from tracksSignificant. Uncorrected for multiple
   * testing; shown and labelled, never counted as significant.
   */
  tracksNominal: number;
  /** Studies whose best track is nominal: one or more nominal tracks and no significant one. */
  studiesNominal: number;
  /** Nominal tracks by direction. */
  nominalUp: number;
  nominalDown: number;
  /**
   * The rows the portal lists, at most SUMMARY_TOP: the significant tracks by
   * q-value, then the nominal tracks by p-value. When there are neither, the
   * lowest p-values (all 'none') so the portal can still show where the term
   * came closest.
   */
  top: SummaryRow<Row>[];
  /**
   * The rows the portal lists in FDR-only mode (listingModeStore), at most
   * SUMMARY_TOP: the significant tracks by q-value, or, when there are none,
   * the lowest q-values.
   */
  topFdr: SummaryRow<Row>[];
  /** Every significant track, by q-value. What the condition-pathways card follows. */
  significant: SummaryRow<Row>[];
}

export type GeneSummary = CrossStudySummary<TrackRow> & { symbol: string };
export type PathwaySummary = CrossStudySummary<PathwayTrackRow> & { pathwayId: string };

/** Rows the portal's table shows at most. */
export const SUMMARY_TOP = 8;

function byQ<Row>(q: (row: Row) => number | null) {
  return (a: SummaryRow<Row>, b: SummaryRow<Row>) => {
    const qa = q(a.track) ?? Number.POSITIVE_INFINITY;
    const qb = q(b.track) ?? Number.POSITIVE_INFINITY;
    return qa - qb;
  };
}

function summarize<Row extends { significant: boolean; direction: string }>(
  groups: ReadonlyArray<{ dataset: Dataset; contrast: ResolvedContrast | null; tracks: Row[] }>,
  q: (row: Row) => number | null,
  p: (row: Row) => number | null,
): CrossStudySummary<Row> {
  let studiesMeasured = 0, studiesSignificant = 0, studiesNominal = 0, tracksMeasured = 0;
  let up = 0, down = 0, nominalUp = 0, nominalDown = 0;
  const sig: SummaryRow<Row>[] = [];
  const nominal: SummaryRow<Row>[] = [];
  const all: SummaryRow<Row>[] = [];
  for (const g of groups) {
    if (g.tracks.length === 0) continue;
    studiesMeasured++;
    let anySig = false, anyNominal = false;
    for (const track of g.tracks) {
      tracksMeasured++;
      const row = { dataset: g.dataset, contrast: g.contrast, track };
      all.push(row);
      // `track.significant` is the row builder's FDR call; the tier agrees with
      // it by construction, and adds the nominal raw-p tier beneath it.
      const tier = track.significant ? 'fdr' : significanceTier(null, p(track));
      if (tier === 'fdr') {
        anySig = true;
        sig.push(row);
        if (track.direction === 'up') up++;
        else if (track.direction === 'down') down++;
      } else if (tier === 'nominal') {
        anyNominal = true;
        nominal.push(row);
        if (track.direction === 'up') nominalUp++;
        else if (track.direction === 'down') nominalDown++;
      }
    }
    if (anySig) studiesSignificant++;
    else if (anyNominal) studiesNominal++;
  }
  sig.sort(byQ(q));
  nominal.sort(byQ(p));
  const listed = sig.length + nominal.length ? [...sig, ...nominal] : all.slice().sort(byQ(p));
  const listedFdr = sig.length ? sig : all.slice().sort(byQ(q));
  return {
    studiesMeasured, studiesSignificant, tracksMeasured, tracksSignificant: sig.length, up, down,
    tracksNominal: nominal.length, studiesNominal, nominalUp, nominalDown,
    top: listed.slice(0, SUMMARY_TOP), topFdr: listedFdr.slice(0, SUMMARY_TOP), significant: sig,
  };
}

const geneCache = new Map<string, Promise<GeneSummary | null>>();
const pathwayCache = new Map<string, Promise<PathwaySummary | null>>();

/** Cache a load, but forget a failure so a later visit can retry it. */
function cached<T>(cache: Map<string, Promise<T | null>>, key: string, load: () => Promise<T | null>): Promise<T | null> {
  const hit = cache.get(key);
  if (hit) return hit;
  const p = load().catch(() => null).then((value) => {
    if (value === null) cache.delete(key);
    return value;
  });
  cache.set(key, p);
  return p;
}

/**
 * One gene's differential expression across every indexed study, or null when
 * the query index is unavailable. Never downloads track bundles.
 */
export function loadGeneSummary(symbol: string): Promise<GeneSummary | null> {
  const SYMBOL = symbol.toUpperCase();
  return cached(geneCache, SYMBOL, async () => {
    const report = await queryGeneViaIndex(SYMBOL, listDatasets());
    if (!report) return null;
    return { symbol: SYMBOL, ...summarize<TrackRow>(report.groups as DatasetGroup[], (t) => t.fdr, (t) => t.pval) };
  });
}

/**
 * One pathway's enrichment across every indexed pathway-capable study, or null
 * when the query index is unavailable. Never downloads pathway siblings.
 */
export function loadPathwaySummary(pathwayId: string): Promise<PathwaySummary | null> {
  const ID = pathwayId.toUpperCase();
  return cached(pathwayCache, ID, async () => {
    const report = await queryPathwayViaIndex(ID, listDatasets().filter((d) => d.supportsPathways));
    if (!report) return null;
    return { pathwayId: ID, ...summarize<PathwayTrackRow>(report.groups as PathwayDatasetGroup[], (t) => t.padj, (t) => t.pval) };
  });
}

// ── Condition pathways: gene -> its conditions -> what else changes there ──

/** Conditions (significant tracks) the card follows at most, strongest first. */
export const CONDITION_LIMIT = 12;

/** Concurrent track-pathway requests. Each file is small; a few at once is plenty. */
const CONDITION_FANOUT = 4;

/** One condition the gene changes in, and what reading its pathways gave. */
export interface ConditionRef extends SummaryRow<TrackRow> {
  /**
   * 'read': its significant pathways are in hand (possibly none).
   * 'no-analysis': the study ships no pathway result for this track.
   * 'unreadable': the index file could not be read or did not match.
   */
  status: 'read' | 'no-analysis' | 'unreadable';
  /** Significant pathways in this condition; 0 unless status is 'read'. */
  pathways: number;
}

/** One pathway's result in one of the followed conditions. */
export interface ConditionPathwayHit {
  /** Index into ConditionPathways.conditions. */
  condition: number;
  NES: number;
  padj: number;
  direction: Direction;
}

export interface ConditionPathway {
  /** Stored gs_name (the pathway index key); routes use it. */
  id: string;
  db: string;
  /** One entry per followed condition where the pathway is significant. */
  hits: ConditionPathwayHit[];
  /** Distinct studies among those conditions. */
  studies: number;
  up: number;
  down: number;
  /** The most significant hit. */
  best: ConditionPathwayHit;
  /** Significant of tested tracks across the corpus; null if the rows lack it. */
  corpus: CorpusRate | null;
  /** Recurrence here against that base rate; null when it cannot be computed. */
  specificity: Specificity | null;
}

export interface ConditionPathways {
  symbol: string;
  /** Every track where the gene is significant. */
  conditionsTotal: number;
  /** The tracks followed: the CONDITION_LIMIT strongest by q-value. */
  conditions: ConditionRef[];
  /** Followed conditions whose pathways were read. */
  read: number;
  /** Pathway-capable tracks in the corpus, the base rate's frame of reference. */
  corpusTracks: number;
  /**
   * Pathways significant in at least one read condition, most specific to
   * these conditions first (see rankPathways).
   */
  pathways: ConditionPathway[];
}

/**
 * Specificity first: the hypergeometric tail of the pathway's recurrence among
 * the read conditions given its corpus base rate (./pathwaySpecificity), so a
 * pathway enriched in half of all tracks does not lead just because it recurs
 * here too. Ties, and pathways without a base rate (ranked after those with
 * one), fall back to raw recurrence: studies, then conditions, then direction
 * agreement, then best padj. Studies count before conditions because tracks of
 * one study share animals, so recurrence across its tracks is weaker evidence.
 */
function rankPathways(a: ConditionPathway, b: ConditionPathway): number {
  return (a.specificity?.tail ?? 2) - (b.specificity?.tail ?? 2)
    || b.studies - a.studies
    || b.hits.length - a.hits.length
    || Math.max(b.up, b.down) - Math.max(a.up, a.down)
    || a.best.padj - b.best.padj
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

const conditionCache = new Map<string, Promise<ConditionPathways | null>>();

/**
 * The pathways enriched in the conditions where a gene changes: the gene's
 * significant tracks (FDR < 0.05, as geneRow decides), then each track's
 * significant pathways (padj < 0.05) from the index's track-pathways family.
 *
 * `studies` limits the conditions to those studies (the gene page's study
 * selection); omitted, every indexed study counts.
 *
 * Index only, like the other summaries. Null when the index or the family is
 * unavailable, stale for these studies, or no followed condition could be
 * read; the card then falls back to a sentence. Never loads a pathway sibling.
 */
export function loadConditionPathways(symbol: string, studies?: readonly Dataset[]): Promise<ConditionPathways | null> {
  const SYMBOL = symbol.toUpperCase();
  const ids = studies ? new Set(studies.map((d) => d.id)) : null;
  const key = ids ? `${SYMBOL}\u0000${[...ids].sort().join(',')}` : SYMBOL;
  return cached(conditionCache, key, async () => {
    const gene = await loadGeneSummary(SYMBOL);
    if (!gene) return null;
    const inScope = ids ? gene.significant.filter((c) => ids.has(c.dataset.id)) : gene.significant;
    const followed = inScope.slice(0, CONDITION_LIMIT);
    if (followed.length === 0) {
      return { symbol: SYMBOL, conditionsTotal: 0, conditions: [], read: 0, corpusTracks: 0, pathways: [] };
    }

    const datasets = listDatasets();
    const manifest = await loadQueryManifest(datasets);
    if (!manifest || !manifestSupportsTrackPathways(manifest)) return null;
    const studies = [...new Set(followed.map((c) => c.dataset))];
    if (!manifestFreshness(manifest, studies, ['coverage', 'trackCounts', 'contrast'], { metaFor: peekDatasetMeta }).ok) {
      return null;
    }

    const position = new Map(manifest.tracks.map((t, i) => [`${t.ds}\u0000${t.trackId}`, i]));
    const withFile = new Set(manifest.trackPathways?.tracks);
    const loaded = await mapLimit(followed, CONDITION_FANOUT, async (c) => {
      const idx = position.get(`${c.dataset.id}\u0000${c.track.trackId}`);
      if (idx === undefined) return { status: 'unreadable' as const, rows: null };
      if (!withFile.has(idx)) return { status: 'no-analysis' as const, rows: null };
      const rows = await loadTrackPathways(datasets, manifest, idx).catch(() => null);
      return rows ? { status: 'read' as const, rows } : { status: 'unreadable' as const, rows: null };
    });

    const conditions: ConditionRef[] = followed.map((c, i) => ({
      ...c, status: loaded[i].status, pathways: loaded[i].rows?.length ?? 0,
    }));
    const read = conditions.filter((c) => c.status === 'read').length;
    if (read === 0 && conditions.some((c) => c.status === 'unreadable')) return null;

    const byId = new Map<string, { id: string; db: string; hits: ConditionPathwayHit[]; corpus: CorpusRate | null }>();
    loaded.forEach(({ rows }, condition) => {
      for (const [id, NES, padj, , dbIdx, significant, tested] of rows ?? []) {
        let p = byId.get(id);
        if (!p) {
          const corpus = Number.isInteger(significant) && Number.isInteger(tested) ? { significant, tested } : null;
          p = { id, db: manifest.dbNames[dbIdx] ?? '', hits: [], corpus };
          byId.set(id, p);
        }
        p.hits.push({ condition, NES, padj, direction: effectDirection(NES) });
      }
    });
    const pathways: ConditionPathway[] = [...byId.values()].map((p) => ({
      ...p,
      studies: new Set(p.hits.map((h) => conditions[h.condition].dataset.id)).size,
      up: p.hits.filter((h) => h.direction === 'up').length,
      down: p.hits.filter((h) => h.direction === 'down').length,
      best: p.hits.reduce((a, b) => (b.padj < a.padj ? b : a)),
      specificity: pathwaySpecificity(p.hits.length, read, p.corpus),
    })).sort(rankPathways);

    return {
      symbol: SYMBOL, conditionsTotal: inScope.length, conditions, read,
      corpusTracks: manifest.trackPathways?.tracks.length ?? 0, pathways,
    };
  });
}

// ── Baseline expression teaser (NeuroSeq, through the survey's reader) ────
//
// A projection of the expression survey's own results: one
// loadNeuroseqExpression read per population (the gene index and its shard are
// fetched once and shared), then one row per source group carrying the
// survey's group mean. Source groups stay separate, as the survey keeps them:
// within one population they can differ several-fold (Agrp in the AgRP
// population's fed and feeding-unreported groups), so a pooled mean would be a
// value no group measured.

export interface SourceGroupLevel {
  /** The source group's key in the survey; unique across NeuroSeq. */
  id: string;
  populationId: string;
  /** Friendly population name, e.g. 'PVH oxytocin'. */
  label: string;
  /** The survey's source-group label, named only when the population has more than one group. */
  group: string | null;
  region: string;
  /** The survey's group mean: mean TPM across the group's libraries. */
  meanTpm: number;
  libraries: number;
}

export type BaselineTeaser =
  | { status: 'available'; gene: string; groups: SourceGroupLevel[]; populationCount: number; max: number }
  | { status: 'absent' }
  | { status: 'ambiguous'; candidates: string[] };

function baselineTeaser(sources: ExpressionSource[], results: ExpressionGeneResult[]): BaselineTeaser | null {
  const [first] = results;
  if (!first) return null;
  if (first.status === 'not-retained') return { status: 'absent' };
  if (first.status === 'ambiguous') return { status: 'ambiguous', candidates: first.candidates ?? [] };
  const groups = sources.flatMap((source, i) => results[i].groups.flatMap((group): SourceGroupLevel[] => (group.mean == null ? [] : [{
    id: group.key,
    populationId: source.id,
    label: source.populationLabel ?? source.label,
    group: results[i].groups.length > 1 ? group.label : null,
    region: source.region ?? '',
    meanTpm: group.mean,
    libraries: group.n,
  }]))).sort((a, b) => b.meanTpm - a.meanTpm);
  return { status: 'available', gene: first.gene ?? first.query, groups, populationCount: sources.length, max: groups[0]?.meanTpm ?? 0 };
}

const baselineCache = new Map<string, Promise<BaselineTeaser | null>>();

/**
 * A gene's mean expression in each NeuroSeq source group, highest first; null
 * when the expression files could not be read or were inconsistent. Each value
 * is the group mean the expression survey reports for the same query.
 */
export function loadBaselineTeaser(symbol: string): Promise<BaselineTeaser | null> {
  // Keyed exactly as typed: NeuroSeq prefers an exact spelling before a case-insensitive match.
  return cached(baselineCache, symbol.trim(), async () => {
    const sources = neuroseqSources(await loadNeuroseqManifest());
    const results = await Promise.all(sources.map(async (source) => (await loadNeuroseqExpression(source.id, [symbol]))[0]));
    return baselineTeaser(sources, results);
  });
}

// ── Human reference atlases (GTEx, HPA, Allen; same-origin JSON) ───────────
//
// The external reference products the expression survey reads: one manifest
// per provider, then one lookup and one value shard per source. A mouse symbol
// reaches the human gene of the same symbol; the card says so and never pools
// the values with mouse data.

/** The human hypothalamus sources the gene page summarizes. */
export const REFERENCE_ATLAS_SOURCES = {
  gtex: 'gtex-v10-brain-hypothalamus',
  subregions: 'hpa-human-hypothalamic-subregions',
  allen: 'allen-human-hypothalamus-microarray',
  clusters: 'hpa-human-hypothalamus-snrna-clusters',
} as const;
export type ReferenceAtlasKey = keyof typeof REFERENCE_ATLAS_SOURCES;

export interface ReferenceLevel { key: string; label: string; value: number }

/** Middle and spread of a sample source's values, over donors (never over pooled tissue samples). */
export interface ReferenceSpread { median: number; low: number; high: number; donors: number; samples: number }

export interface ReferenceRow {
  /** The probe behind the row, for a probe-level source; one row per probe. */
  probe?: string;
  /** Summary sources: each group's published value, highest first. */
  levels: ReferenceLevel[];
  /**
   * Sample sources. One group of one sample per donor (GTEx): the median and
   * quartiles across donors. Several groups that are donors (Allen): the
   * median, minimum and maximum of the donor means.
   */
  spread: ReferenceSpread | null;
}

export type ReferenceAtlas =
  | { status: 'available'; source: ExpressionSource; gene: string; rows: ReferenceRow[] }
  | { status: 'not-retained'; source: ExpressionSource }
  | { status: 'ambiguous'; source: ExpressionSource; candidates: string[] }
  | { status: 'unavailable' };

export type ReferenceAtlases = Record<ReferenceAtlasKey, ReferenceAtlas>;

/** Linear-interpolation quantile of sorted values. */
function quantile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const below = Math.floor(at);
  return below + 1 < sorted.length ? sorted[below] + (sorted[below + 1] - sorted[below]) * (at - below) : sorted[below];
}

function spreadOf(groups: ExpressionGroupResult[]): ReferenceSpread | null {
  const samples = groups.reduce((sum, group) => sum + group.n, 0);
  if (groups.length === 1) {
    const sorted = groups[0].samples.flatMap((sample) => (sample.value == null ? [] : [sample.value])).sort((a, b) => a - b);
    if (!sorted.length) return null;
    return { median: quantile(sorted, 0.5), low: quantile(sorted, 0.25), high: quantile(sorted, 0.75), donors: sorted.length, samples };
  }
  const means = groups.flatMap((group) => (group.mean == null ? [] : [group.mean])).sort((a, b) => a - b);
  if (!means.length) return null;
  return { median: quantile(means, 0.5), low: means[0], high: means[means.length - 1], donors: means.length, samples };
}

function referenceRow(result: ExpressionGeneResult, source: ExpressionSource): ReferenceRow {
  if (source.valueKind === 'summary') {
    const levels = result.groups.flatMap((group) => (group.summary == null ? [] : [{ key: group.key, label: group.label, value: group.summary }]));
    return { probe: result.probe, levels: levels.sort((a, b) => b.value - a.value), spread: null };
  }
  return { probe: result.probe, levels: [], spread: spreadOf(result.groups) };
}

async function referenceAtlas(sources: ExpressionSource[], id: string, symbol: string): Promise<ReferenceAtlas> {
  const source = sources.find((candidate) => candidate.id === id);
  if (!source) return { status: 'unavailable' };
  try {
    const results = await loadExternalExpression(source, [symbol]);
    const [first] = results;
    if (!first || first.status === 'not-retained') return { status: 'not-retained', source };
    if (first.status === 'ambiguous') return { status: 'ambiguous', source, candidates: first.candidates ?? [] };
    return { status: 'available', source, gene: first.gene ?? symbol, rows: results.map((result) => referenceRow(result, source)) };
  } catch {
    return { status: 'unavailable' };
  }
}

const referenceCache = new Map<string, Promise<ReferenceAtlases | null>>();

/**
 * A gene's values in the human hypothalamus reference atlases; null only when
 * no provider's products could be read. A provider that fails leaves its
 * sources 'unavailable' and the others still answer.
 */
export function loadReferenceAtlases(symbol: string): Promise<ReferenceAtlases | null> {
  return cached(referenceCache, symbol.toUpperCase(), async () => {
    const { sources } = await loadExternalSources();
    if (!sources.length) return null;
    const keys = Object.keys(REFERENCE_ATLAS_SOURCES) as ReferenceAtlasKey[];
    const atlases = await Promise.all(keys.map((key) => referenceAtlas(sources, REFERENCE_ATLAS_SOURCES[key], symbol)));
    return Object.fromEntries(keys.map((key, index) => [key, atlases[index]])) as ReferenceAtlases;
  });
}

/** Test seam: forget every cached summary. */
export function resetSearchSummaries(): void {
  geneCache.clear();
  pathwayCache.clear();
  conditionCache.clear();
  baselineCache.clear();
  referenceCache.clear();
}
