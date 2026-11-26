// A gene survey: one or more genes across the survey's sources, each source in
// its own unit and cohorts. The gene page shows it for its gene ("Where <gene>
// is expressed" → every source and sample); the expression survey page shows it
// for several genes at once. Both read the same catalog, scope and loaders.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ExportButton } from '../common/ExportButton';
import { Spinner } from '../common/Spinner';
import { FONT_MONO, FONT_SANS } from '../styles/constants';
import { useExportAction } from '../utils/exportAction';
import { EXISTING_EXPRESSION_SOURCES } from './existingCatalog';
import { loadExpressionSources, loadExternalManifest, loadExternalSourceErrors } from './expressionData';
import { loadNeuroseqManifest } from './neuroseqExpression';
import { loadReferenceManifest } from './referenceExpression';
import type { ExpressionGeneResult, ExpressionSource } from './expressionTypes';
import {
  barGeometry,
  DEFAULT_SURVEY_SCOPE,
  exportManifestNeeds,
  formatValue,
  groupValue,
  isSummary,
  missingLabel,
  panelGroups,
  selectSources,
  sourceCollection,
  surveyExport,
  surveyPanel,
} from './expressionSurvey';
import type { Collection, ExportFormat, ExportManifests, SurveyMode, SurveyScope, TissueKind } from './expressionSurvey';
import { ProviderCredit, SourceDetail, saveText } from './SourceDetail';
import { useKeyedLoad, useSurveyLoad } from './useSurveyLoad';
import './expressionSurvey.css';

function ExportControls({
  sources,
  results,
  genes,
  referenceOnly,
  disabled = false,
  disabledReason,
}: {
  sources: ExpressionSource[];
  results: ExpressionGeneResult[];
  genes: string[];
  referenceOnly: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const { busy, run } = useExportAction();
  const [format, setFormat] = useState<ExportFormat>('samples');
  const [error, setError] = useState('');
  const exportData = async () => {
    const exportedAt = new Date().toISOString();
    let manifests: ExportManifests | undefined;
    if (format === 'metadata') {
      const needs = exportManifestNeeds(sources);
      const [neuroseq, reference, external] = await Promise.all([
        needs.neuroseq ? loadNeuroseqManifest() : null,
        needs.reference ? loadReferenceManifest() : null,
        Promise.all(needs.providers.map((provider) => loadExternalManifest(provider))),
      ]);
      manifests = { neuroseq, reference, external };
    }
    const file = surveyExport(format, { sources, results, genes, referenceOnly, exportedAt, manifests });
    saveText(file.filename, file.content, file.type);
  };
  return (
    <div className="ex-export-controls">
      <label className="ex-sr-only" htmlFor="expression-export-format">
        Export format
      </label>
      <select
        id="expression-export-format"
        value={format}
        onChange={(e) => setFormat(e.target.value as ExportFormat)}
      >
        <option value="samples">Sample values · CSV</option>
        <option value="summary">Cohort means · CSV</option>
        <option value="metadata">Values + metadata · JSON</option>
      </select>
      <ExportButton
        onClick={() =>
          run(async () => {
            setError('');
            try {
              await exportData();
            } catch (cause: unknown) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : 'Export could not be created. Please retry.',
              );
            }
          })
        }
        busy={busy}
        busyLabel="Exporting…"
        disabled={disabled || !results.length}
        title={disabledReason}
      >
        Export ↓
      </ExportButton>
      {disabledReason && <span className="ex-note">{disabledReason}</span>}
      {error && (
        <span role="alert" className="ex-error">
          {error}
        </span>
      )}
    </div>
  );
}

function ResultPanel({
  sources,
  results,
  genes,
  referenceOnly,
  matrix,
  onDetail,
}: {
  sources: ExpressionSource[];
  results: ExpressionGeneResult[];
  genes: string[];
  referenceOnly: boolean;
  matrix: boolean;
  onDetail: (source: ExpressionSource) => void;
}) {
  const [first] = sources;
  const primary = genes[0];
  const summary = isSummary(first);
  const panel = surveyPanel(sources, results, genes, { referenceOnly, matrix });
  const { rows, axis } = panel;
  const populationLabel = (id: string) => sources.find((source) => source.id === id)?.populationLabel;
  return (
    <section className="ex-result-panel">
      <header className="ex-panel-head">
        <div>
          <div className="ex-eyebrow">
            {first.collection === 'neuroseq'
              ? 'NeuroSeq · manually isolated neurons'
              : `${first.populationLabel} · ${first.region}`}
          </div>
          <h3>{first.collection === 'neuroseq' ? 'Hypothalamic populations' : first.label}</h3>
          <p className="ex-note">
            {first.collection === 'neuroseq'
              ? first.unit
              : `${first.assay} · ${first.rnaFraction} · ${first.species}`}
          </p>
        </div>
        <a href={first.sourceUrl} target="_blank" rel="noreferrer">
          Source ↗
        </a>
      </header>
      {panel.matched && (
        <p className="ex-note">
          Matched {panel.matched} in {first.species}.
        </p>
      )}
      <div className="ex-axis-note">
        <span>
          {summary ? 'Published value' : 'Mean stored value'} · <strong>{first.unit}</strong>
        </span>
        <span>
          {matrix
            ? 'Values retain source units'
            : `Axis ${formatValue(axis.minimum)}–${formatValue(axis.maximum)}`}
        </span>
      </div>
      {matrix ? (
        <div className="ex-table-scroll">
          <table className="ex-matrix">
            <thead>
              <tr>
                <th>Population / cohort</th>
                {genes.map((gene) => (
                  <th className="ex-number" key={gene}>
                    {gene}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {panel.matrix.map(({ source, group, cells }) => (
                <tr key={`${source.id}:${group.key}`}>
                  <td>
                    <button
                      type="button"
                      className="ex-text-button"
                      onClick={() => onDetail(source)}
                    >
                      {source.populationLabel}
                    </button>
                    <span className="ex-subline">{group.label}</span>
                  </td>
                  {cells.map((cell) => (
                    <td className="ex-number" key={cell.gene} title={cell.title}>
                      {cell.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        rows.length > 0 && (
          <div className="ex-table-scroll">
            <table className="ex-rank-table">
              <thead>
                <tr>
                  <th>Population / cohort</th>
                  <th className="ex-number">n</th>
                  <th>
                    {primary} · {summary ? 'published value' : 'mean'}
                  </th>
                  <th className="ex-number">{first.unit}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ source, group, result }) => {
                  const bar = barGeometry(groupValue(group), axis);
                  return (
                  <tr key={`${source.id}:${result.probe ?? ''}:${group.key}`}>
                    <td>
                      <button
                        type="button"
                        className="ex-text-button"
                        onClick={() => onDetail(source)}
                      >
                        {source.populationLabel}
                      </button>
                      <span className="ex-subline">
                        {group.label}
                        {result.probe ? ` · probe ${result.probe}` : ''}
                      </span>
                    </td>
                    {group.summary !== undefined ? (
                      <td className="ex-number" title="Published summary; no sample values">
                        —
                      </td>
                    ) : (
                      <td
                        className="ex-number"
                        title={`${group.n} measured / ${group.totalSamples} selected samples`}
                      >
                        {group.n}
                        {group.n !== group.totalSamples ? `/${group.totalSamples}` : ''}
                      </td>
                    )}
                    <td>
                      <div
                        className="ex-bar-track"
                        aria-label={`${formatValue(groupValue(group))} ${first.unit}`}
                        role="img"
                      >
                        <span className="ex-zero" style={{ left: `${bar.zero}%` }} />
                        <span className="ex-bar" style={{ left: `${bar.left}%`, width: `${bar.width}%` }} />
                      </div>
                    </td>
                    <td className="ex-number">{formatValue(groupValue(group))}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
      {panel.empty && <p className="ex-empty">{panel.empty}</p>}
      {panel.unavailable.length > 0 && (
        <details className="ex-unavailable">
          <summary>
            {panel.unavailable.length} gene / source {panel.unavailable.length === 1 ? 'lookup' : 'lookups'}{' '}
            unavailable
          </summary>
          {panel.unavailable.map((result) => (
            <p key={`${result.sourceId}:${result.query}`}>
              <span className="ex-mono">{result.query}</span> ·{' '}
              {populationLabel(result.sourceId)}: {missingLabel(result)}.
            </p>
          ))}
        </details>
      )}
      <p className="ex-caption">
        {summary
          ? `${first.summaryStatistic ?? 'Published summary'} as stated by the provider; no mean is computed.`
          : 'Arithmetic mean of available profile values within each source cohort.'}{' '}
        {/\.\s*$/.test(first.normalization) ? first.normalization : `${first.normalization}.`}{' '}
        {first.collection !== 'neuroseq'
          ? `Replicate unit: ${first.replicateUnit}.`
          : 'Original source groups remain separate.'}
      </p>
      <ProviderCredit source={first} />
      {sources.some((source) => source.sharedSampleNote) && (
        <p className="ex-caption">
          <strong>Shared sample provenance:</strong>{' '}
          {sources.find((source) => source.sharedSampleNote)?.sharedSampleNote}
        </p>
      )}
    </section>
  );
}

// ── Source catalog ─────────────────────────────────────────────────────────

/** The study-library sources ship with the app, so the survey works before (or without) the catalog. */
const BUNDLED_SOURCES: ExpressionSource[] = [...EXISTING_EXPRESSION_SOURCES];

export interface SurveyCatalog {
  /** Every survey source; the bundled study-library sources until the catalog loads. */
  sources: ExpressionSource[];
  loading: boolean;
  error: string;
  /** Reference-atlas providers whose products could not be read, with the reason. */
  externalErrors: Partial<Record<string, string>>;
  /** Re-requests the catalog and the atlas status, and nothing else. */
  retry: () => void;
}

/** The survey's source catalog and the reference-atlas status, each with its own retry. */
export function useSurveyCatalog(): SurveyCatalog {
  const catalog = useKeyedLoad('catalog', loadExpressionSources, 'Source catalog could not be loaded.');
  const atlasErrors = useKeyedLoad('atlas-errors', loadExternalSourceErrors, 'Reference atlas status could not be loaded.');
  const { retry: retryCatalog } = catalog;
  const { retry: retryAtlases } = atlasErrors;
  const retry = useCallback(() => {
    retryCatalog();
    retryAtlases();
  }, [retryCatalog, retryAtlases]);
  return {
    sources: catalog.value ?? BUNDLED_SOURCES,
    loading: catalog.loading,
    error: catalog.error,
    externalErrors: atlasErrors.value ?? {},
    retry,
  };
}

/** Catalog and atlas failures, each with a retry; the study library stays usable without the catalog. */
export function CatalogNotices({ catalog, onUseLibrary }: { catalog: SurveyCatalog; onUseLibrary: () => void }) {
  const atlasFailures = Object.entries(catalog.externalErrors);
  return (
    <>
      {catalog.error && (
        <div className="ex-notice" role="alert">
          <strong>NeuroSeq catalog could not be loaded.</strong> {catalog.error} Existing study
          sources remain available.{' '}
          <button type="button" onClick={catalog.retry}>
            Retry
          </button>
          <button type="button" onClick={onUseLibrary}>
            Use study library
          </button>
        </div>
      )}
      {atlasFailures.length > 0 && (
        <div className="ex-notice" role="alert">
          <strong>Reference atlas data could not be loaded.</strong>{' '}
          {atlasFailures.map(([provider, error]) => `${provider.toUpperCase()}: ${error}`).join(' ')} Other
          sources remain available.{' '}
          <button type="button" onClick={catalog.retry}>
            Retry
          </button>
        </div>
      )}
    </>
  );
}

// ── Gene survey workspace ──────────────────────────────────────────────────

const MODES: { id: SurveyMode; label: string }[] = [
  { id: 'populations', label: 'Populations' },
  { id: 'tissue', label: 'Tissue & bulk' },
];
const TISSUE_CHOICES: { id: TissueKind; label: string; note: string }[] = [
  { id: 'whole', label: 'Whole hypothalamus', note: 'Bulk tissue' },
  { id: 'arc', label: 'Arcuate nucleus', note: 'Regional dissection' },
  {
    id: 'isolated',
    label: 'Broad neuronal isolation',
    note: 'Sorted neurons / nuclei',
  },
  {
    id: 'external',
    label: 'Reference atlases',
    note: 'GTEx, HPA, Allen · human, mouse, pig',
  },
  {
    id: 'all',
    label: 'All tissue sources',
    note: 'Includes other hypothalamic regions',
  },
];
export const SURVEY_STYLE = { '--ex-font-mono': FONT_MONO, fontFamily: FONT_SANS } as CSSProperties;

/**
 * A survey held to one source or family, as the gene page's tiles open it: the
 * scope's mode and collection are fixed, and `include` narrows its sources.
 * Region, populations and the fed / reference filter still apply.
 */
export interface SurveyFocus {
  include?: (source: ExpressionSource) => boolean;
}

/** A collection change starts its population choice and region afresh. */
export function withCollection(scope: SurveyScope, collection: Collection): SurveyScope {
  return { ...scope, collection, region: 'all', selectedIds: null };
}

/**
 * A gene survey: its source scope (populations or tissue, collection, region,
 * populations, fed / reference cohorts), then every selected source's values
 * for `genes`, ranked or as a gene matrix, with exports and source records.
 * The host owns the genes and the scope; `form` is the host's gene input, shown
 * above the scope. Values load as soon as there is a gene and a source.
 */
export function GeneSurvey({
  genes,
  catalog,
  scope,
  onScopeChange,
  form,
  empty,
  showGenes = true,
  focus,
  onResults,
}: {
  genes: string[];
  catalog: SurveyCatalog;
  scope: SurveyScope;
  onScopeChange: (next: SurveyScope) => void;
  form?: ReactNode;
  /** What the results say before any gene is given. */
  empty?: string;
  /** Name the genes above the results; a host that already names them turns this off. */
  showGenes?: boolean;
  /** Hold the survey to one source or family; omitted, every scope control shows. */
  focus?: SurveyFocus;
  /** Told the loaded results whenever a load settles, so a host can show them elsewhere (the catalog's source details). */
  onResults?: (results: ExpressionGeneResult[]) => void;
}) {
  const genesKey = genes.join('\u0000');
  // Several genes open as a matrix, one as ranked bars; the reader's pick holds until the genes change.
  const [display, setDisplay] = useState({ key: genesKey, matrix: genes.length > 1 });
  const matrix = display.key === genesKey ? display.matrix : genes.length > 1;
  const setMatrix = (next: boolean) => setDisplay({ key: genesKey, matrix: next });
  const [detail, setDetail] = useState<ExpressionSource | null>(null);
  const { mode, collection, region, includeSfo, selectedIds, tissueKind, referenceOnly } = scope;
  const update = (patch: Partial<SurveyScope>) => onScopeChange({ ...scope, ...patch });

  const include = focus?.include;
  const { regions, choices, selected: selectedSources } = useMemo(() => {
    const selection = selectSources(catalog.sources, { mode, collection, region, includeSfo, selectedIds, tissueKind });
    return include
      ? { ...selection, choices: selection.choices.filter(include), selected: selection.selected.filter(include) }
      : selection;
  }, [catalog.sources, mode, collection, region, includeSfo, selectedIds, tissueKind, include]);
  const focused = Boolean(focus);
  const currentLoad = useSurveyLoad({ enabled: true, sources: selectedSources, genes });
  useEffect(() => {
    if (!currentLoad.loading) onResults?.(currentLoad.results);
  }, [currentLoad.loading, currentLoad.results, onResults]);
  const groupedPanels = useMemo(() => panelGroups(selectedSources), [selectedSources]);

  function toggleSource(id: string) {
    const picked = new Set(selectedIds ?? choices.map((source) => source.id));
    if (picked.has(id)) picked.delete(id);
    else picked.add(id);
    update({ selectedIds: [...picked] });
  }

  return (
    <div className="ex-survey-layout">
      <div className={`ex-query-panel${focused && mode === 'tissue' ? ' ex-query-panel--slim' : ''}`}>
        {form}
        {!focused && (
        <fieldset className="ex-segment ex-mode">
          <legend className="ex-sr-only">Sources to survey</legend>
          {MODES.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={mode === item.id}
              onClick={() => update({ mode: item.id })}
            >
              {item.label}
            </button>
          ))}
        </fieldset>
        )}
        {!(focused && mode === 'tissue') && (
        <aside className="ex-sidebar" aria-label="Survey filters">
          {mode === 'populations' ? (
            <>
              {!focused && (
              <label className="ex-field">
                <span>Source collection</span>
                <select
                  value={collection}
                  onChange={(event) => onScopeChange(withCollection(scope, event.target.value as Collection))}
                >
                  <option value="neuroseq">NeuroSeq</option>
                  <option value="reference">OXT cell reference</option>
                  <option value="existing">Existing study library</option>
                  <option value="external">Reference atlases (HPA)</option>
                  <option value="agrp">AgRP across studies</option>
                  <option value="all">All population sources</option>
                </select>
              </label>
              )}
              <label className="ex-field">
                <span>Anatomical region</span>
                <select value={region} onChange={(event) => update({ region: event.target.value })}>
                  <option value="all">All regions</option>
                  {regions.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              {(!focused || collection === 'neuroseq') && (
              <label className="ex-checkbox">
                <input
                  type="checkbox"
                  checked={includeSfo}
                  onChange={(event) => update({ includeSfo: event.target.checked })}
                />
                <span>Include SFO boundary records</span>
              </label>
              )}
              <details className="ex-population-picker">
                <summary>
                  Populations{' '}
                  <span className="ex-mono">
                    {selectedSources.length}/{choices.length}
                  </span>
                </summary>
                <div className="ex-picker-actions">
                  <button type="button" className="ex-text-button" onClick={() => update({ selectedIds: null })}>
                    Select all
                  </button>
                  <button type="button" className="ex-text-button" onClick={() => update({ selectedIds: [] })}>
                    Clear
                  </button>
                </div>
                <div className="ex-population-options">
                  {choices.map((source) => (
                    <label className="ex-population-option" key={source.id}>
                      <input
                        type="checkbox"
                        checked={selectedIds == null || selectedIds.includes(source.id)}
                        onChange={() => toggleSource(source.id)}
                      />
                      <span>
                        <strong>{source.populationLabel}</strong>
                        <small>
                          {source.region} · {sourceCollection(source)}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </details>
            </>
          ) : (
            <>
              <div className="ex-eyebrow">Tissue preparation</div>
              <div className="ex-tissue-choices">
                {TISSUE_CHOICES.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-pressed={tissueKind === item.id}
                    onClick={() => update({ tissueKind: item.id })}
                  >
                    <strong>{item.label}</strong>
                    <span>{item.note}</span>
                  </button>
                ))}
              </div>
              <p className="ex-sidebar-note">
                Bulk values include the sampled cell mixture. A broad neuronal isolation is
                distinct from a genetically defined population.
              </p>
            </>
          )}
        </aside>
        )}
        <div className="ex-scope-footer">
          <label className="ex-checkbox">
            <input
              type="checkbox"
              checked={referenceOnly}
              onChange={(event) => update({ referenceOnly: event.target.checked })}
            />
            <span>Fed / reference cohorts only</span>
          </label>
          <span className="ex-note" role="status">
            {selectedSources.length} source records selected
          </span>
        </div>
      </div>
      <div className="ex-results">
        {genes.length > 0 && (
          <>
            <div className="ex-results-heading">
              <div>
                <div className="ex-eyebrow">
                  {mode === 'tissue' ? 'Tissue & broadly isolated neurons' : 'Population expression'}
                </div>
                {showGenes && <h2 className="ex-mono">{genes.join(' · ')}</h2>}
                <p className="ex-note">
                  {selectedSources.length} selected source records ·{' '}
                  {referenceOnly ? 'Explicitly eligible reference cohorts' : 'All reported states'}
                </p>
              </div>
              <ExportControls
                sources={selectedSources}
                results={currentLoad.results}
                genes={genes}
                referenceOnly={referenceOnly}
                disabled={currentLoad.loading || Object.keys(currentLoad.errors).length > 0}
                disabledReason={
                  Object.keys(currentLoad.errors).length > 0
                    ? 'Export unavailable until the failed sources are retried or removed from the selection.'
                    : undefined
                }
              />
            </div>
            <div className="ex-controls">
              <fieldset className="ex-segment">
                <legend className="ex-sr-only">Result display</legend>
                <button type="button" aria-pressed={!matrix} onClick={() => setMatrix(false)}>
                  Ranked bars
                </button>
                <button type="button" aria-pressed={matrix} onClick={() => setMatrix(true)}>
                  Gene matrix
                </button>
              </fieldset>
            </div>
          </>
        )}
        {!matrix && genes.length > 1 && (
          <p className="ex-note">
            Bars display {genes[0]}. Open the gene matrix to view all {genes.length} genes.
          </p>
        )}
        <div aria-live="polite" aria-atomic="true">
          {genes.length === 0 ? (
            <p className="ex-empty">{empty ?? 'Enter a gene to load expression values.'}</p>
          ) : currentLoad.loading || (catalog.loading && collection === 'neuroseq' && mode === 'populations') ? (
            <div className="ex-loading">
              <Spinner size={18} /> Loading source expression…
            </div>
          ) : selectedSources.length === 0 ? (
            <p className="ex-empty">Select a population or another source collection to begin.</p>
          ) : (
            <span className="ex-sr-only">Expression survey loaded for {genes.join(', ')}.</span>
          )}
        </div>
        {Object.entries(currentLoad.errors).map(([id, error]) => (
          <div className="ex-notice" role="alert" key={id}>
            <strong>{selectedSources.find((source) => source.id === id)?.label}</strong>
            <p>{error}</p>
            <button type="button" onClick={() => currentLoad.retry(id)}>
              Retry source data
            </button>
          </div>
        ))}
        {!currentLoad.loading &&
          groupedPanels.map(
            ([id, panelSources]) =>
              currentLoad.results.some((result) => panelSources.some((source) => source.id === result.sourceId)) && (
                <ResultPanel
                  key={id}
                  sources={panelSources}
                  results={currentLoad.results}
                  genes={genes}
                  referenceOnly={referenceOnly}
                  matrix={matrix}
                  onDetail={setDetail}
                />
              ),
          )}
        <details className="ex-interpretation">
          <summary>How to read expression values</summary>
          <p className="ex-reading-note">
            {referenceOnly
              ? 'NeuroSeq excludes libraries with unreported feeding state. Existing studies use their curated control cohorts; reference eligibility does not imply a shared physiological state.'
              : 'Fed, fasted and other reported conditions stay separate. A source control is not a universal physiological baseline.'}
          </p>
          <p className="ex-caption">
            Each study retains its own units and scale. Transformed values are averaged on
            their stored scale. Missing or filtered genes are never replaced with zero.
            Library counts do not imply independent animals.
          </p>
          <p className="ex-caption">
            Reference atlases (GTEx, HPA, Allen) are human, mouse or pig tissue references, not
            controls for any study here. A rodent symbol can match its human counterpart; the
            matched gene and species are named on each panel, and rows are never merged.
            Published summaries are shown as stated, with no computed mean. Allen microarray
            values are log2 intensities, one row per probe.
          </p>
        </details>
      </div>
      {detail && (
        <SourceDetail
          source={detail}
          results={currentLoad.results}
          referenceOnly={referenceOnly}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

/**
 * One gene's survey on its gene page: every cohort and sample of the source a
 * tile opened (`focus`), or of `initialScope` (the survey page's scope when it
 * handed the gene over).
 */
export function GenePageSurvey({ symbol, initialScope, focus, onUseLibrary }: {
  symbol: string;
  initialScope?: SurveyScope;
  /** Hold the survey to the source a tile opened; omitted, every scope control shows. */
  focus?: SurveyFocus;
  /**
   * The host's half of "Use study library" while a tile holds the survey to
   * its source: the library has none of that source's populations, so the host
   * releases the tile (and its heading) and reopens on this scope.
   */
  onUseLibrary?: (scope: SurveyScope) => void;
}) {
  const catalog = useSurveyCatalog();
  const [scope, setScope] = useState<SurveyScope>(initialScope ?? DEFAULT_SURVEY_SCOPE);
  // Released here when no host takes the fallback, so the library is never
  // filtered through another source's predicate.
  const [released, setReleased] = useState(false);
  const genes = useMemo(() => [symbol], [symbol]);
  const chooseLibrary = () => {
    const library = withCollection({ ...scope, mode: 'populations' }, 'existing');
    if (focus && !released && onUseLibrary) return onUseLibrary(library);
    setReleased(true);
    setScope(library);
  };
  return (
    <div className="expression-survey expression-survey--embedded" style={SURVEY_STYLE}>
      <CatalogNotices catalog={catalog} onUseLibrary={chooseLibrary} />
      <GeneSurvey genes={genes} catalog={catalog} scope={scope} onScopeChange={setScope} showGenes={false} focus={released ? undefined : focus} />
    </div>
  );
}
