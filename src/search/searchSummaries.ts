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
// The summaries keep the report's groups; the portal lists them at render
// through statistics/crossStudyListing, the listing the full reports use, and
// each row's tier and direction come from crossDatasetRows. So the portal and
// the reports cannot disagree about what counts as a change, or what leads.
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
import { effectDirection } from '../statistics/policy';
import { GENE_KEYS, listCrossStudy } from '../statistics/crossStudyListing';
import { mapLimit } from '../utils/mapLimit';
import { pathwaySpecificity, type CorpusRate, type Specificity } from './pathwaySpecificity';
import { loadNeuroseqExpression, loadNeuroseqManifest, neuroseqSources } from '../expression-survey/neuroseqExpression';
import { EXISTING_EXPRESSION_SOURCES } from '../expression-survey/existingCatalog';
import { loadExpressionGenes } from '../expression-survey/expressionData';
import { isBoundary } from '../expression-survey/expressionSurvey';
import { loadExternalExpression, loadExternalSources } from '../expression-survey/externalReference';
import type {
  Dataset, DatasetGroup, Direction, ExpressionGeneResult, ExpressionGroupResult, ExpressionSource,
  PathwayDatasetGroup, ResolvedContrast, TrackRow,
} from '../types';

/** One track's result, with the study and comparison it belongs to. */
export interface SummaryRow<Row> {
  dataset: Dataset;
  contrast: ResolvedContrast | null;
  track: Row;
}

/**
 * One gene's results across the indexed studies: the report's groups, kept as
 * they came so the portal can list them for whichever listing mode is set
 * (statistics/crossStudyListing). A study with no result has no tracks.
 */
export interface GeneSummary { symbol: string; groups: DatasetGroup[] }
export interface PathwaySummary { pathwayId: string; groups: PathwayDatasetGroup[] }

/** Rows the portal's table shows at most. */
export const SUMMARY_TOP = 8;

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
    return { symbol: SYMBOL, groups: report.groups };
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
    return { pathwayId: ID, groups: report.groups };
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
  /** The tracks followed: the CONDITION_LIMIT strongest by q-value, ties by |log2FC|. */
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
    // The FDR survivors alone, in the listing's order: q, then |log2FC|.
    const groups = ids ? gene.groups.filter((g) => ids.has(g.dataset.id)) : gene.groups;
    const inScope: SummaryRow<TrackRow>[] = listCrossStudy(groups, 'fdr', GENE_KEYS, 'significance').lead
      .map(({ group, track }) => ({ dataset: group.dataset, contrast: group.contrast, track }));
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
// value no group measured. SFO boundary records are left out, as the survey
// leaves them out by default: the SFO lies outside the hypothalamus proper.

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
    const sources = neuroseqSources(await loadNeuroseqManifest()).filter((source) => !isBoundary(source));
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
export interface ReferenceSpread {
  median: number; low: number; high: number; donors: number; samples: number;
  /** Mean over the same values (donors, or donor means): the value the survey's bars rank. */
  mean: number;
}

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

function meanOf(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function spreadOf(groups: ExpressionGroupResult[]): ReferenceSpread | null {
  const samples = groups.reduce((sum, group) => sum + group.n, 0);
  if (groups.length === 1) {
    const sorted = groups[0].samples.flatMap((sample) => (sample.value == null ? [] : [sample.value])).sort((a, b) => a - b);
    if (!sorted.length) return null;
    return { median: quantile(sorted, 0.5), low: quantile(sorted, 0.25), high: quantile(sorted, 0.75), donors: sorted.length, samples, mean: meanOf(sorted) };
  }
  const means = groups.flatMap((group) => (group.mean == null ? [] : [group.mean])).sort((a, b) => a - b);
  if (!means.length) return null;
  return { median: quantile(means, 0.5), low: means[0], high: means[means.length - 1], donors: means.length, samples, mean: meanOf(means) };
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

// ── Study populations and tissue (the survey's own sources) ───────────────
//
// The gene page's study-library and tissue tiles: each source's highest cohort
// mean, read through the survey's loaders (one expression-index shard serves
// every study-library source). Sources keep their own units, so the tile ranks
// only the sources in the family's most common unit and counts the others.

export type SourceFamily = 'studies' | 'tissue';

export interface FamilyLevel {
  sourceId: string;
  /** The population or tissue: 'ARC POMC'. */
  label: string;
  /** The study it comes from: 'GSE68177', or the atlas. */
  study: string;
  /** The cohort whose mean this is. */
  cohort: string;
  mean: number;
  n: number;
}

export interface FamilyTeaser {
  /** Sources in the family that measured the gene. */
  measured: number;
  /** Sources in the family. */
  total: number;
  /** The unit the levels share, and how many measured sources use it. */
  unit: string;
  inUnit: number;
  /** One level per source in `unit`, its highest cohort mean, highest first. */
  levels: FamilyLevel[];
  /**
   * Sources whose values could not be read: a failed load, which says nothing
   * about the gene, so it is counted apart from the sources that lack it.
   */
  unread: number;
  /** The species the family's sources come from, the most sources first. */
  species: string[];
}

function studyOf(source: ExpressionSource): string {
  return source.label.split(' · ').slice(1).join(' · ') || source.label;
}

function familyTeaser(sources: ExpressionSource[], results: Array<ExpressionGeneResult[] | null>): FamilyTeaser {
  const best = sources.flatMap((source, i): Array<FamilyLevel & { unit: string }> => {
    const available = (results[i] ?? []).filter((result) => result.status === 'available');
    const cohorts = available.flatMap((result) => result.groups.flatMap((group) => (group.mean == null ? [] : [{ group, unit: result.unit }])));
    if (!cohorts.length) return [];
    const top = cohorts.reduce((a, b) => (b.group.mean! > a.group.mean! ? b : a));
    return [{
      sourceId: source.id,
      label: source.populationLabel,
      study: studyOf(source),
      cohort: top.group.label,
      mean: top.group.mean!,
      n: top.group.n,
      unit: top.unit,
    }];
  });
  const counts = new Map<string, number>();
  for (const level of best) counts.set(level.unit, (counts.get(level.unit) ?? 0) + 1);
  const [unit = '', inUnit = 0] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  const levels = best.filter((level) => level.unit === unit)
    .map(({ unit: _unit, ...level }) => level)
    .sort((a, b) => b.mean - a.mean);
  const perSpecies = new Map<string, number>();
  for (const source of sources) perSpecies.set(source.species, (perSpecies.get(source.species) ?? 0) + 1);
  const species = [...perSpecies].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  const unread = results.filter((result) => result === null).length;
  return { measured: best.length, total: sources.length, unit, inUnit, levels, unread, species };
}

/** The family's sources: study-library populations, or non-human tissue and broad neuronal preparations (mouse, rat and pig today). */
async function familySources(family: SourceFamily): Promise<ExpressionSource[]> {
  if (family === 'studies') return EXISTING_EXPRESSION_SOURCES.filter((source) => source.scope === 'population');
  const { sources: external } = await loadExternalSources();
  return [...EXISTING_EXPRESSION_SOURCES, ...external]
    .filter((source) => source.scope !== 'population' && source.species !== 'Homo sapiens');
}

const familyCache = new Map<string, Promise<FamilyTeaser | null>>();

/**
 * A gene across one family of survey sources; null when none of their values
 * could be read. A source that fails to load is counted in `unread`, never as
 * a source that lacks the gene: a transport failure is retryable, and saying
 * the gene is absent would be a claim the data never made.
 */
export function loadFamilyTeaser(symbol: string, family: SourceFamily): Promise<FamilyTeaser | null> {
  const key = `${family}:${symbol.trim()}`;
  return cached(familyCache, key, async () => {
    const sources = await familySources(family);
    const results = await mapLimit(sources, 4, (source) =>
      loadExpressionGenes(source, [symbol]).catch((): ExpressionGeneResult[] | null => null));
    // Nothing read is a failure: null is not cached, so a later visit retries.
    if (sources.length > 0 && results.every((result) => result === null)) return null;
    const teaser = familyTeaser(sources, results);
    // A partial answer is shown but not kept, so the next visit reads the
    // failed sources again instead of repeating a transient gap.
    if (teaser.unread > 0) familyCache.delete(key);
    return teaser;
  });
}

/** Test seam: forget every cached summary. */
export function resetSearchSummaries(): void {
  geneCache.clear();
  pathwayCache.clear();
  conditionCache.clear();
  baselineCache.clear();
  referenceCache.clear();
  familyCache.clear();
}
