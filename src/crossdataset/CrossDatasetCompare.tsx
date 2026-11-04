// Cross-dataset gene-expression comparison: the single-cell "Compare" idea
// generalized from populations-of-one-dataset to one-track-per-dataset. Pick a
// gene and see its baseline-vs-case expression side by side across datasets
// (e.g. the diet-induced-obesity cohort), each rendered with that dataset's own
// contrast, group colours and expression unit.
//
// Each dataset is represented by its DEFAULT track (the whole-tissue/sorted
// track for the bulk mouse sets; the default cell population for macaque). The
// heavy lift — per-dataset PopData — is built via the shared track-data seam,
// and BarSEMChart is reused verbatim, so this view is pure composition.
//
// NOTE: absolute expression is NOT comparable across datasets (units differ:
// CPM vs log2-normalized vs translatome). The bars are honest WITHIN a dataset
// (baseline vs case); the cross-dataset signal is the direction + effect size,
// shown in the summary table. The same effects on one shared axis live in the
// gene page (GeneReport / "View gene page"), reachable from the
// header button. Neither view combines datasets into a single number: they are
// not comparable enough for that.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { DatasetVerificationLink } from '../common/DatasetVerificationContext';
import {
  listDatasets, datasetCategory, DATASET_CATEGORIES,
  type DatasetCategory,
} from '../data/datasets';
import { getActiveContrast } from '../data/contrasts';
import { loadTrackData, popDataFor } from '../data/trackData';
import { loadCompareEntriesViaIndex, type CompareEntry } from '../data/crossDatasetCompare';
import { loadQueryManifest, loadGeneNames } from '../data/queryIndex';
import { mapLimit } from '../utils/mapLimit';
import { fmtP, fmtFDR, fmtSigned, pToStar } from '../utils/format';
import { FONT_MONO, DIRECTION_UP_COLOR as UP, DIRECTION_DOWN_COLOR as DOWN } from '../styles/constants';
import { contrastLabel, useCategoryScope, useReportQuery, FilterChip, ReportLoading } from './forestReport';
import { PageShell } from '../common/PageShell';
import { BarSEMChart } from '../gene-explorer/BarSEMChart';
import { GeneSearchBox } from '../gene-explorer/GeneSearchBox';
import { EmptyState } from '../common/EmptyState';
import { ChartScaleToggle } from '../common/ChartScaleToggle';
import type { Dataset, GeneDERecord } from '../types';
import { effectDirection } from '../statistics/policy';
import { useStudySelection, type GeneStudyFilters } from './geneStudyScope';
import { ShareAnalysisButton } from '../common/ShareAnalysisButton';

type DatasetEntry = CompareEntry;

/** What a load produced: the charts, plus any dataset it could not produce one
 *  for. `failed` is rendered, never swallowed - see loadDatasetEntries. */
interface CompareLoad {
  entries: DatasetEntry[];
  /** Datasets, not names: the view filters these by the active category scope
   *  exactly as it filters the charts, so a chip selection is never told about
   *  failures outside it. */
  failed: Dataset[];
}

// The FALLBACK path: load each dataset's DEFAULT track in full and build its
// PopData. 43 requests and 148.4 MB on the shipping corpus, which is why it is
// the fallback and not the path - see ../data/crossDatasetCompare.
//
// Kept, and kept correct, because a stale or absent index must degrade to SLOW,
// never to wrong. Everything it touches is memoized for the session (loadTrack
// caches raw bundles, getPopData caches transforms by raw-object identity), so
// a second gene re-walks 43 cache hits and downloads nothing.
async function loadFullDatasetEntries(
  datasets: Dataset[],
  onProgress: (loaded: number, total: number) => void,
): Promise<CompareLoad> {
  onProgress(0, datasets.length);
  let done = 0;
  const failed: Dataset[] = [];
  // Same fan-out budget as the cross-dataset queries: one unbounded <script>
  // injection per dataset floods the network and the main thread as each
  // bundle parses, and the corpus keeps growing.
  const rows = await mapLimit(datasets, 8, async (ds): Promise<DatasetEntry | null> => {
    try {
      // pathways: 'omit' - this is a gene-level view, so the pathway sibling
      // bundle is deliberately not downloaded (one sibling per dataset
      // is the payload the split exists to avoid). The resulting popData has
      // an empty allPathways by design, not by oversight.
      const { raw } = await loadTrackData(ds, ds.defaultTrack, { pathways: 'omit' });
      const contrast = getActiveContrast(ds);
      const popData = popDataFor(raw, ds, contrast);
      if (!popData) { failed.push(ds); return null; }
      return { dataset: ds, contrast, popData };
    } catch {
      // A dataset that fails to load is NOT a dataset without the gene. This
      // used to return null and vanish, so a 404 on one bundle rendered as a
      // complete-looking report with one study quietly missing - the exact
      // shape of wrongness the index guards are written against. Name it.
      failed.push(ds);
      return null;
    } finally {
      done++;
      onProgress(done, datasets.length);
    }
  });
  return { entries: rows.filter((r): r is DatasetEntry => r !== null), failed };
}

/**
 * Load one gene's charts: the precomputed index first (3 small requests), the
 * full download when it cannot answer.
 *
 * Keyed by GENE, because the index path is per-gene. That re-runs the fallback
 * on a gene switch too, which is free: every bundle and transform it touches is
 * already memoized for the session.
 */
async function loadDatasetEntries(
  key: string,
  { onProgress }: { onProgress: (loaded: number, total: number) => void },
): Promise<CompareLoad> {
  const [gene, ids]: [string, string[]] = JSON.parse(key);
  const datasets = listDatasets().filter((dataset) => ids.includes(dataset.id));
  if (datasets.length === 0) return { entries: [], failed: [] };
  const fromIndex = await loadCompareEntriesViaIndex(gene, datasets).catch(() => null);
  if (fromIndex) {
    onProgress(datasets.length, datasets.length);
    // No `failed` list on this path: the index answers for every dataset or for
    // none (loadCompareEntriesViaIndex resolves null rather than skipping one).
    return { entries: fromIndex, failed: [] };
  }
  return loadFullDatasetEntries(datasets, onProgress);
}

interface CrossDatasetCompareProps {
  gene: string;
  /** Optional category scope the view opens with (null = all datasets). */
  scope?: DatasetCategory[] | null;
  /** Resolved cohort from the gene page. Category chips can only narrow it. */
  datasetScope?: string[] | null;
  studyFilters?: GeneStudyFilters;
  onScopeChange?: (scope: DatasetCategory[] | null) => void;
  onGeneChange?: (gene: string) => void;
  onHome: () => void;
  /** Jump to the gene page for the same gene. */
  onShowReport?: (gene: string) => void;
}

export function CrossDatasetCompare({ gene, scope, datasetScope = null, studyFilters, onScopeChange, onGeneChange, onHome, onShowReport }: CrossDatasetCompareProps) {
  const [activeGene, setActiveGene] = useState(gene);
  const categoriesScope = useCategoryScope(scope, onScopeChange);
  const { activeCats, toggleCat } = categoriesScope;
  const { selectedDatasets: cohort, awaitingCounts, queryKey, reset } = useStudySelection({
    kind: 'bars', term: activeGene, categories: categoriesScope, datasetScope, studyFilters,
  });

  // Keyed by the GENE, uppercased, because the index path fetches that gene's
  // slice — this is a query per gene, not one library load that later genes
  // filter. The fallback re-runs on a gene switch too and that is free: every
  // bundle and transform it touches is memoized for the session.
  //
  // useReportQuery's own cancellation guard is what makes rapid gene switching
  // safe: a superseded load cannot publish its result over a newer one.
  const { result: load, loading, progress, bytes, error } = useReportQuery(
    queryKey,
    loadDatasetEntries,
    'Could not load datasets.',
  );
  const entries = load?.entries ?? null;
  useEffect(() => { setActiveGene(gene); }, [gene]);

  // The gene picker's vocabulary.
  //
  // On the index path each entry knows only the ONE gene it was queried for, so
  // the union of the loaded entries is not a picker — it is the current gene.
  // The index publishes the corpus-wide union as its own small file instead,
  // fetched independently of the charts so autocomplete never delays a bar.
  // Its failure is not worth 148 MB: fall through to whatever the loaded
  // entries know, which on the fallback path IS the full union.
  const [indexGeneNames, setIndexGeneNames] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const datasets = listDatasets();
    loadQueryManifest(datasets)
      .then((m) => (m ? loadGeneNames(datasets, m.buildId) : null))
      .then((names) => { if (!cancelled && names) setIndexGeneNames(names); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const loadedGeneNames = useMemo(() => {
    if (!entries) return [];
    const set = new Set<string>();
    for (const e of entries) for (const g of e.popData.geneNames) set.add(g);
    return [...set].sort();
  }, [entries]);
  const geneNames = indexGeneNames ?? loadedGeneNames;

  // Match the active gene case-insensitively per dataset (macaque POMC vs mouse Pomc).
  const geneUC = activeGene.toUpperCase();
  const resolveDe = useCallback((e: DatasetEntry) => {
    const direct = e.popData.deByGene[activeGene];
    if (direct) return direct;
    // Fall back to a case-insensitive scan (cheap: deByGene is a small map).
    const key = e.popData.geneNames.find((g) => g.toUpperCase() === geneUC);
    return key ? e.popData.deByGene[key] : undefined;
  }, [activeGene, geneUC]);

  // Categories present among loaded datasets, in canonical order.
  const categories = useMemo(() => {
    if (!entries) return [];
    const present = new Set(entries.map((e) => datasetCategory(e.dataset.id)));
    return DATASET_CATEGORIES.filter((c) => present.has(c));
  }, [entries]);

  const inScope = useCallback(
    (ds: Dataset) => !activeCats || activeCats.has(datasetCategory(ds.id)),
    [activeCats],
  );

  const visible = useMemo(() => {
    if (!entries) return [];
    return entries.filter((e) => inScope(e.dataset));
  }, [entries, inScope]);

  // Datasets that could not be READ, narrowed to the chips in play. Never
  // folded into "not detected": those are opposite claims and only one of them
  // is about data. Scoped through the SAME predicate as the charts, because a
  // failure outside the selection is not this view's news to report - and
  // counting it here would also mean comparing it against `visible`, a
  // different population entirely.
  const failedVisible = useMemo(
    () => (load?.failed ?? []).filter(inScope),
    [load, inScope],
  );
  // Naming the studies is the point (a bare count is not actionable), but the
  // total-failure case names all 43 and buries the message. Lead with a
  // readable few and count the rest.
  const failedSummary = failedVisible.length > 6
    ? `${failedVisible.slice(0, 6).map((d) => d.name).join(', ')}, and ${failedVisible.length - 6} more`
    : failedVisible.map((d) => d.name).join(', ');

  // Split into datasets that detect the gene (get a chart) vs not.
  const withGene = useMemo(() => visible.filter((e) => resolveDe(e)), [visible, resolveDe]);
  const withoutGene = useMemo(() => visible.filter((e) => !resolveDe(e)), [visible, resolveDe]);

  return (
    <PageShell
      onHome={onHome}
      headerRight={<ShareAnalysisButton />}
      breadcrumbs={[
        { label: 'Compare across datasets' },
        { label: activeGene, current: true },
      ]}
      mainStyle={{ maxWidth: 1180, width: '100%', margin: '0 auto', padding: '24px 24px 64px' }}
    >
        {/* Gene header + picker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)', lineHeight: 1 }}>{activeGene}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>expression across datasets · baseline vs case, per dataset</div>
          </div>
          <div style={{ minWidth: 240, maxWidth: 360 }}>
            {geneNames.length > 0 && (
              <GeneSearchBox geneNames={geneNames} selectedGenes={[]} onAdd={(next) => { setActiveGene(next); onGeneChange?.(next); }} />
            )}
          </div>
          {onShowReport && (
            <button type="button" onClick={() => onShowReport(activeGene)}
              style={{ marginLeft: 'auto', fontSize: 12, padding: '7px 12px', border: '1px solid var(--border-dark)', borderRadius: 'var(--r-lg)', background: 'var(--bg-panel)', color: 'var(--text-mono)', cursor: 'pointer', fontFamily: 'inherit' }}>
              View gene page →
            </button>
          )}
        </div>

        <p role="status" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {awaitingCounts ? 'Loading sample counts…' : `${cohort.filter((dataset) => !activeCats || activeCats.has(dataset.category)).length} datasets selected`}
          {datasetScope !== null && ' · Study selection preserved from the gene page.'}
          {!!studyFilters?.minSamples && ` At least ${studyFilters.minSamples} samples per group in the default population and comparison.`}
          {!!studyFilters?.requiredChecks.length && ' Selected quality checks remain applied.'}
        </p>

        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14, maxWidth: '74ch', lineHeight: 1.5 }}>
          Bars show baseline and case group means ± SEM in each dataset&apos;s expression unit.
          Compare direction and effect size across datasets. Absolute expression levels are not comparable.{' '}
          <span style={{ color: UP }}>Red = up in case</span> · <span style={{ color: DOWN }}>blue = down</span>.
        </div>

        {/* Category filter chips */}
        {categories.length > 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
            <FilterChip label={datasetScope === null ? 'All datasets' : 'All selected studies'} count={cohort.length} active={activeCats === null} onClick={reset} />
            {categories.map((c) => (
              <FilterChip key={c} label={c} count={(entries ?? []).filter((e) => datasetCategory(e.dataset.id) === c).length}
                active={!!activeCats?.has(c)} onClick={() => toggleCat(c)} />
            ))}
          </div>
        )}

        {!activeGene ? (
          // Idle, not empty. `useReportQuery` now reports an empty key as "no
          // query has run" rather than as a query still in flight, so without
          // this branch the chain below would fall through to "not detected in
          // any selected dataset" — evidence of absence about a gene nobody
          // searched for, which is the exact claim the branches under it exist
          // to avoid making.
          <EmptyState title="Search a gene to compare." hint="Pick a gene above to see its expression side by side across datasets." />
        ) : loading || awaitingCounts ? (
          <ReportLoading label="Loading datasets…" progress={progress} bytes={bytes} unit="datasets" />
        ) : error ? (
          <EmptyState title="Could not load datasets." hint={error} />
        ) : cohort.length === 0 ? (
          <EmptyState title="No datasets selected." hint="Return to the gene page to change the study filters." />
        ) : withGene.length === 0 ? (
          // "Not detected" is a claim about data that was READ. When datasets
          // failed to load it is not available to make: with every bundle 404ing
          // this branch used to announce that the gene is in none of them —
          // evidence of absence, manufactured out of a network error. Say what
          // actually happened instead, and only mention detection for the
          // datasets that did load.
          failedVisible.length > 0 ? (
            <EmptyState
              title={`Could not load ${failedVisible.length} dataset${failedVisible.length === 1 ? '' : 's'}.`}
              hint={
                `${failedSummary}. Data is unavailable, so this report cannot show whether `
                + `${activeGene} is present in them.`
                // `visible` holds the in-scope datasets that DID load, and
                // failures produce no entry — so these are disjoint sets and
                // "any of them loaded" is `visible.length > 0`, not a
                // comparison between the two counts.
                + (visible.length > 0
                  ? ` Of the datasets that did load, none detects ${activeGene}.`
                  : '')
              }
            />
          ) : (
            <EmptyState title={`${activeGene} is not detected in any selected dataset.`} hint="Try another gene, or widen the category filter." />
          )
        ) : (
          <>
            {/* The one grid where the units differ the most — a CPM atlas beside
                a dozen log2 bulk studies — so the control sits directly above it. */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <ChartScaleToggle />
            </div>

            {/* Bar grid */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 24,
            }}>
              {withGene.map((e) => (
                <div key={e.dataset.id} style={{ minWidth: 0 }}>
                  <div style={{ margin: '0 0 6px' }}><DatasetVerificationLink datasetId={e.dataset.id} /></div>
                  <BarSEMChart
                    gene={resolveDe(e)?.gene ?? activeGene}
                    popData={e.popData}
                    popLabel={e.dataset.name}
                    contrast={e.contrast}
                  />
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: FONT_MONO, padding: '2px 8px' }}>
                    {contrastLabel(e.contrast)} · {e.dataset.organism}
                  </div>
                </div>
              ))}
            </div>

            {/* Summary table */}
            <SummaryTable entries={withGene} resolveDe={resolveDe} />

            {withoutGene.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 14, lineHeight: 1.6 }}>
                Not detected in {withoutGene.length} other dataset{withoutGene.length === 1 ? '' : 's'}:{' '}
                {withoutGene.map((e) => e.dataset.name).join(', ')}.
              </div>
            )}

            {/* A dataset that failed to LOAD is not a dataset without the gene,
                and must never be filed under "not detected" or silently left
                out — that would read as evidence of absence for data nobody
                managed to open. It gets its own line, in warning colour. */}
            {failedVisible.length > 0 && (
              <div role="status" style={{ fontSize: 11, color: 'var(--color-warn, #B45309)', marginTop: 10, lineHeight: 1.6 }}>
                Could not load {failedVisible.length} dataset{failedVisible.length === 1 ? '' : 's'}:{' '}
                {failedSummary}. Data is unavailable, so this report cannot show whether{' '}
                {activeGene} is present in them.
              </div>
            )}
          </>
        )}
    </PageShell>
  );
}

function SummaryTable({ entries, resolveDe }: { entries: DatasetEntry[]; resolveDe: (e: DatasetEntry) => GeneDERecord | undefined }) {
  const th: React.CSSProperties = { padding: '6px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '6px 10px', fontSize: 12, borderBottom: '1px solid var(--border)' };
  const tdMono: React.CSSProperties = { ...td, fontFamily: FONT_MONO, textAlign: 'right' };
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Dataset</th>
            <th style={th}>Contrast</th>
            <th style={{ ...th, textAlign: 'right' }}>log2FC</th>
            <th style={{ ...th, textAlign: 'right' }}>p</th>
            <th style={{ ...th, textAlign: 'right' }}>FDR</th>
            {/* RAW-p stars, deliberately — not the FDR call the gene page
                makes one click away. This table is a per-dataset side-by-side of
                ONE named gene, and the bar chart above it already annotates raw
                p (BarSEMChartImpl); an FDR pill here would disagree with the
                chart it captions. The heading says which statistic it is, so the
                two views read as two questions rather than a contradiction. */}
            <th style={{ ...th, textAlign: 'center' }} title="Stars use the raw p-value. See the gene page for FDR-adjusted significance.">Raw-p</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const de = resolveDe(e);
            if (!de) return null;
            // Sign only: colour encodes DIRECTION here, never confidence.
            const d = effectDirection(de.logFC);
            const dir = d === 'up' ? UP : d === 'down' ? DOWN : 'var(--text-muted)';
            return (
              <tr key={e.dataset.id}>
                <td style={{ ...td, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {e.dataset.name}<div style={{ marginTop: 4 }}><DatasetVerificationLink datasetId={e.dataset.id} /></div>
                </td>
                <td style={{ ...td, color: 'var(--text-muted)' }}>{contrastLabel(e.contrast)}</td>
                <td style={{ ...tdMono, color: dir, fontWeight: 600 }}>{fmtSigned(de.logFC, 2)}</td>
                <td style={{ ...tdMono, color: 'var(--text-mono)' }}>{fmtP(de.PValue)}</td>
                <td style={{ ...tdMono, color: 'var(--text-mono)' }}>{fmtFDR(de.FDR)}</td>
                <td style={{ ...td, textAlign: 'center', fontFamily: FONT_MONO }}>{pToStar(de.PValue)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
