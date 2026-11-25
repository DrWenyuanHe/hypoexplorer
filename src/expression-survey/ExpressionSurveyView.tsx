import { useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { PageShell } from '../common/PageShell';
import { ExportButton } from '../common/ExportButton';
import { Spinner } from '../common/Spinner';
import { useExportAction } from '../utils/exportAction';
import { tabKeyTarget } from '../utils/tabKeys';
import { loadExpressionValidation } from './expressionData';
import { providerOf } from './externalReference';
import { EXTERNAL_PROVIDERS, EXTERNAL_REFERENCE_ROOTS } from './externalReferenceFormat';
import type { ExpressionSource } from './expressionTypes';
import {
  catalogEntries as filterCatalog,
  catalogRegions,
  DEFAULT_SURVEY_SCOPE,
  formatValue,
  isBoundary,
  isSummary,
  sampleCount,
  sourceCollection,
} from './expressionSurvey';
import type { Collection, SurveyScope, SurveySection } from './expressionSurvey';
import { CatalogNotices, GeneSurvey, SURVEY_STYLE, useSurveyCatalog, withCollection } from './GeneSurvey';
import { SourceDetail, saveText } from './SourceDetail';
import { useExternalValidation, useKeyedLoad } from './useSurveyLoad';
import './expressionSurvey.css';

// The expression survey page: several genes compared across the survey's
// sources, the population catalog, and the sources with their validation. One
// gene is not surveyed here: it opens on its gene page, where "Where <gene> is
// expressed" carries every source and sample, starting from this page's scope.

const SECTIONS: { id: SurveySection; label: string }[] = [
  { id: 'survey', label: 'Gene survey' },
  { id: 'catalog', label: 'Population catalog' },
  { id: 'sources', label: 'Sources & validation' },
];
const MAX_GENES = 12;
/** A stable Ensembl gene ID; the gene page is keyed on symbols, so an ID is surveyed here. */
const STABLE_ID = /^ENS[A-Z]*G\d{6,}(\.\d+)?$/i;

export function ExpressionSurveyView({ onHome, onOpenGene }: {
  onHome: () => void;
  /** Opens a gene's page with this survey's scope; a single symbol is surveyed there. */
  onOpenGene: (symbol: string, scope: SurveyScope) => void;
}) {
  const [section, setSection] = useState<SurveySection>('survey');
  const [scope, setScope] = useState<SurveyScope>(DEFAULT_SURVEY_SCOPE);
  const [input, setInput] = useState('');
  const [genes, setGenes] = useState<string[]>([]);
  const [queryError, setQueryError] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogCollection, setCatalogCollection] = useState('neuroseq');
  const [catalogRegion, setCatalogRegion] = useState('all');
  const [detail, setDetail] = useState<ExpressionSource | null>(null);
  const catalogExport = useExportAction();

  // Each request retries on its own: the catalog (with the atlas errors it
  // reports), the validation reports, and each source's survey values.
  const catalog = useSurveyCatalog();
  const { sources } = catalog;
  const validationReport = useKeyedLoad(
    section === 'sources' ? 'validation' : null,
    loadExpressionValidation,
    'Validation report could not be loaded.',
  );
  const validation = validationReport.value ?? null;
  const validationError = validationReport.error;
  const externalValidation = useExternalValidation(section === 'sources');
  const retryReports = () => {
    validationReport.retry();
    externalValidation.retry();
  };
  const catalogEntries = filterCatalog(sources, { collection: catalogCollection, region: catalogRegion, query: catalogQuery });

  function search(event?: FormEvent) {
    event?.preventDefault();
    const next = [
      ...new Set(
        input
          .split(/[\s,;]+/)
          .map((gene) => gene.trim())
          .filter(Boolean),
      ),
    ];
    if (!next.length) {
      setQueryError('Enter at least one gene symbol or Ensembl gene ID.');
      return;
    }
    if (next.length > MAX_GENES) {
      setQueryError(`Survey up to ${MAX_GENES} genes at a time.`);
      return;
    }
    setQueryError('');
    if (next.length === 1 && !STABLE_ID.test(next[0])) {
      onOpenGene(next[0], scope);
      return;
    }
    setGenes(next);
  }

  function surveyCollection(collection: Collection) {
    setScope((current) => withCollection({ ...current, mode: 'populations' }, collection));
    setSection('survey');
  }

  function surveySource(source: ExpressionSource) {
    setScope((current) => ({
      ...withCollection({ ...current, mode: 'populations' }, source.collection),
      selectedIds: [source.id],
      includeSfo: current.includeSfo || isBoundary(source),
    }));
    setSection('survey');
  }

  function tabKey(event: KeyboardEvent<HTMLButtonElement>, current: SurveySection) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const next = tabKeyTarget(event.key, SECTIONS.findIndex((tab) => tab.id === current), SECTIONS.length);
    if (next === null) return;
    event.preventDefault();
    setSection(SECTIONS[next].id);
    document.getElementById(`ex-tab-${SECTIONS[next].id}`)?.focus();
  }

  const geneForm = (
    <form className="ex-gene-form" onSubmit={search}>
      <label htmlFor="expression-gene-input">Gene symbol or Ensembl ID</label>
      <div className="ex-search-row">
        <input
          id="expression-gene-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          spellCheck={false}
          placeholder="Lepr, Agrp, Pomc"
          autoComplete="off"
        />
        <button className="ex-primary" type="submit">
          Survey →
        </button>
      </div>
      <p className="ex-note">
        One gene opens its gene page, which surveys every source and sample. Compare up to{' '}
        {MAX_GENES} here, separated by commas. Stored identifiers are preserved.
      </p>
      {queryError && (
        <p role="alert" className="ex-error">
          {queryError}
        </p>
      )}
    </form>
  );

  return (
    <PageShell
      onHome={onHome}
      breadcrumbs={[{ label: 'Expression survey', current: true }]}
      mainStyle={{ minWidth: 0 }}
    >
      <div className="expression-survey" style={SURVEY_STYLE}>
        <header className="ex-page-heading">
          <h1>Expression survey</h1>
        </header>
        <div className="ex-tabs" role="tablist" aria-label="Expression survey sections">
          {SECTIONS.map((tab) => (
            <button
              type="button"
              role="tab"
              key={tab.id}
              id={`ex-tab-${tab.id}`}
              aria-selected={section === tab.id}
              aria-controls={`ex-panel-${tab.id}`}
              tabIndex={section === tab.id ? 0 : -1}
              onKeyDown={(event) => tabKey(event, tab.id)}
              onClick={() => setSection(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="ex-content">
          <CatalogNotices catalog={catalog} onUseLibrary={() => surveyCollection('existing')} />
          {section === 'survey' && (
            <section role="tabpanel" id="ex-panel-survey" aria-labelledby="ex-tab-survey">
              <GeneSurvey
                genes={genes}
                catalog={catalog}
                scope={scope}
                onScopeChange={setScope}
                form={geneForm}
                empty="Choose your sources, then enter one gene to open its gene page, or several to compare them here."
              />
            </section>
          )}

          {section === 'catalog' && (
            <section role="tabpanel" id="ex-panel-catalog" aria-labelledby="ex-tab-catalog">
              <div className="ex-screen-heading">
                <div>
                  <div className="ex-eyebrow">Population definitions</div>
                  <h2>Hypothalamic population catalog</h2>
                  <p>
                    Anatomy, population label and isolation method travel with every source record.
                  </p>
                </div>
                <ExportButton
                  busy={catalogExport.busy}
                  busyLabel="Exporting…"
                  onClick={() =>
                    catalogExport.run(() =>
                      saveText(
                        'expression-population-catalog.json',
                        JSON.stringify(catalogEntries, null, 2),
                        'application/json',
                      ),
                    )
                  }
                >
                  Export catalog ↓
                </ExportButton>
              </div>
              <div className="ex-catalog-filters">
                <label className="ex-field">
                  <span>Search catalog</span>
                  <input
                    type="search"
                    value={catalogQuery}
                    onChange={(event) => setCatalogQuery(event.target.value)}
                    placeholder="Population, reporter, region or accession"
                  />
                </label>
                <label className="ex-field">
                  <span>Source collection</span>
                  <select
                    value={catalogCollection}
                    onChange={(event) => {
                      setCatalogCollection(event.target.value);
                      setCatalogRegion('all');
                    }}
                  >
                    <option value="neuroseq">NeuroSeq</option>
                    <option value="reference">OXT cell reference</option>
                    <option value="existing">Existing study library</option>
                    <option value="external">Reference atlases (HPA)</option>
                    <option value="all">All sources</option>
                  </select>
                </label>
                <label className="ex-field">
                  <span>Region</span>
                  <select
                    value={catalogRegion}
                    onChange={(event) => setCatalogRegion(event.target.value)}
                  >
                    <option value="all">All regions</option>
                    {catalogRegions(sources).map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="ex-reading-note">
                <span className="ex-mono">{catalogEntries.length} visible records</span>
                <span>
                  NeuroSeq retains all 15 HY display labels, 17 source groups and 54 libraries,
                  including 2 SFO boundary records.
                </span>
              </div>
              {catalog.loading && <p role="status">Loading source catalog…</p>}
              <div className="ex-table-scroll">
                <table className="ex-catalog-table">
                  <thead>
                    <tr>
                      <th>Population</th>
                      <th>Region</th>
                      <th>Source / definition</th>
                      <th>Libraries / samples</th>
                      <th>Context</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalogEntries.map((source) => (
                      <tr key={source.id}>
                        <td>
                          <button
                            type="button"
                            className="ex-text-button"
                            onClick={() => setDetail(source)}
                          >
                            {source.populationLabel}
                          </button>
                          <span className="ex-subline">{source.species}</span>
                        </td>
                        <td className="ex-mono">{source.region}</td>
                        <td>
                          <span className="ex-source-id">{source.id}</span>
                          <span className="ex-subline">{source.assay}</span>
                        </td>
                        <td className="ex-mono">{sampleCount(source)}</td>
                        <td>
                          <span className="ex-tag">
                            {isBoundary(source)
                              ? 'SFO boundary'
                              : source.collection === 'neuroseq'
                                ? 'Source-defined'
                                : isSummary(source)
                                  ? 'Published summary'
                                  : 'Cohorts retained'}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="ex-text-button"
                            onClick={() => surveySource(source)}
                          >
                            Survey →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!catalogEntries.length && (
                <p className="ex-empty">
                  No matching population records. Try a reporter such as AVP or an arcuate region
                  label such as ARH / ARC.
                </p>
              )}
              <p className="ex-caption">
                Catalog records describe the sources included in this module. They are not an
                exhaustive taxonomy of every hypothalamic neuron. NeuroSeq uses ARH for the arcuate
                nucleus; other studies may use ARC.
              </p>
              <section className="ex-related">
                <div>
                  <h3>AgRP across studies</h3>
                  <p>
                    Browse NeuroSeq NPY-reporter neurons, the Henry study, NuTRAP and RiboTag under
                    one population heading. Source labels and fed / fasted cohorts retain their own
                    values; shared Henry / NeuroSeq libraries remain flagged.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => surveyCollection('agrp')}
                >
                  Survey AgRP →
                </button>
              </section>
            </section>
          )}

          {section === 'sources' && (
            <section role="tabpanel" id="ex-panel-sources" aria-labelledby="ex-tab-sources">
              <div className="ex-screen-heading">
                <div>
                  <div className="ex-eyebrow">Provenance and agreement</div>
                  <h2>Sources & validation</h2>
                  <p>Trace expression values to the source and inspect the numerical checks.</p>
                </div>
                <a
                  href="https://neuroseq.janelia.org/heatmap/d/gene_tpm"
                  target="_blank"
                  rel="noreferrer"
                >
                  NeuroSeq gene expression ↗
                </a>
              </div>
              <div className="ex-validation-layout">
                <section>
                  <h3>NeuroSeq reference comparison</h3>
                  <div className="ex-check">
                    <span>01</span>
                    <div>
                      <h4>Population coverage</h4>
                      <p>
                        15 HY display populations map to 17 original source groups and 54 libraries.
                        SFO records remain in the catalog; the population survey excludes them by
                        default.
                      </p>
                    </div>
                  </div>
                  <div className="ex-check">
                    <span>02</span>
                    <div>
                      <h4>Measurement provenance</h4>
                      <p>
                        Gene-level TPM from the NeuroSeq portal retains source gene identifiers and
                        individual library values. Original source groups and feeding-state
                        eligibility are preserved.
                      </p>
                    </div>
                  </div>
                  <div className="ex-check">
                    <span>03</span>
                    <div>
                      <h4>Numerical agreement</h4>
                      <p>
                        {validation
                          ? `${validation.comparedValues.toLocaleString()} imported values compared with the retained source. Maximum absolute difference: ${formatValue(validation.maxAbsoluteDifference)} TPM.`
                          : 'Load the retained comparison report to inspect matrix fidelity and the browser checkpoints.'}
                      </p>
                    </div>
                  </div>
                  <div className="ex-check">
                    <span>04</span>
                    <div>
                      <h4>Shared biological samples</h4>
                      <p>
                        Ten Henry / NeuroSeq fed libraries have metadata-supported overlap.
                        Raw-library fingerprint confirmation remains pending. These records are not
                        counted as independent replication.
                      </p>
                    </div>
                  </div>
                </section>
                <section className="ex-validation-report">
                  <div className="ex-panel-head">
                    <h3>Agreement report</h3>
                    <span className="ex-tag">
                      {validation
                        ? 'Report available'
                        : validationError
                          ? 'Unavailable'
                          : 'Loading'}
                    </span>
                  </div>
                  {validationError ? (
                    <div role="alert">
                      <p>{validationError}</p>
                      <button type="button" onClick={retryReports}>
                        Retry report
                      </button>
                    </div>
                  ) : !validation ? (
                    <p className="ex-loading">
                      <Spinner size={16} /> Loading retained validation…
                    </p>
                  ) : (
                    <>
                      <dl className="ex-facts">
                        <div>
                          <dt>Genes</dt>
                          <dd className="ex-mono">{validation.geneCount.toLocaleString()}</dd>
                        </div>
                        <div>
                          <dt>Libraries</dt>
                          <dd className="ex-mono">{validation.sampleCount}</dd>
                        </div>
                        <div>
                          <dt>Exact matches</dt>
                          <dd className="ex-mono">{validation.exactMatches.toLocaleString()}</dd>
                        </div>
                        <div>
                          <dt>Source precision</dt>
                          <dd>{validation.precision}</dd>
                        </div>
                      </dl>
                      <h4>Browser display checkpoints</h4>
                      <div className="ex-table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Gene / library</th>
                              <th className="ex-number">Portal</th>
                              <th className="ex-number">Imported</th>
                              <th>Result</th>
                            </tr>
                          </thead>
                          <tbody>
                            {validation.checkpoints.map((check) => (
                              <tr key={`${check.gene}:${check.sampleId}`}>
                                <td className="ex-mono">
                                  {check.gene}
                                  <span className="ex-subline">{check.sampleId}</span>
                                </td>
                                <td className="ex-number">{formatValue(check.expected)}</td>
                                <td className="ex-number">{formatValue(check.actual)}</td>
                                <td>{check.passed ? 'Matches display' : 'Difference'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {validation.notes.map((note) => (
                        <p className="ex-note" key={note}>
                          {note}
                        </p>
                      ))}
                      <a href="/expression/neuroseq/validation.json" target="_blank" rel="noreferrer">
                        Retained comparison evidence ↗
                      </a>
                    </>
                  )}
                </section>
              </div>
              <div className="ex-source-list-heading">
                <h3>Reference atlases</h3>
                <p className="ex-note">
                  Public atlases imported from retained, hash-pinned releases. Every stored value is
                  read back and compared with its source at build time; the reports below record
                  that comparison and an independent check against each provider's API.
                </p>
              </div>
              <div className="ex-table-scroll">
                <table className="ex-source-table">
                  <thead>
                    <tr>
                      <th>Provider / release</th>
                      <th>Sources</th>
                      <th>Values compared</th>
                      <th>Independent checks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {EXTERNAL_PROVIDERS.map((provider) => {
                      const report = externalValidation.reports[provider];
                      const providerSources = sources.filter(
                        (source) => source.collection === 'external' && providerOf(source) === provider,
                      );
                      const credit = providerSources[0]?.provider;
                      return (
                        <tr key={provider}>
                          <td>
                            <strong>{credit?.name ?? provider.toUpperCase()}</strong>
                            <span className="ex-subline">{credit?.release}</span>
                            {credit && (
                              <a className="ex-subline" href={credit.licenseUrl} target="_blank" rel="noreferrer">
                                {credit.license} ↗
                              </a>
                            )}
                          </td>
                          <td>
                            {providerSources.map((source) => (
                              <button
                                type="button"
                                key={source.id}
                                className="ex-text-button ex-subline"
                                onClick={() => setDetail(source)}
                              >
                                {source.label}
                              </button>
                            ))}
                          </td>
                          <td>
                            {typeof report === 'object' ? (
                              <>
                                {report.exactMatches.toLocaleString()} exact of{' '}
                                {report.comparedValues.toLocaleString()}
                                <a
                                  className="ex-subline"
                                  href={`${EXTERNAL_REFERENCE_ROOTS[provider]}/validation.json`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Agreement report ↗
                                </a>
                              </>
                            ) : (
                              <span role={report ? 'alert' : 'status'}>{report ?? 'Loading…'}</span>
                            )}
                          </td>
                          <td>
                            {typeof report === 'object'
                              ? report.notes.slice(0, 4).map((note) => (
                                  <span className="ex-subline" key={note}>
                                    {note}
                                  </span>
                                ))
                              : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="ex-source-list-heading">
                <h3>Existing study sources</h3>
                <p className="ex-note">
                  Per-sample arrays from the explorer's retained study bundles. A missing gene can
                  reflect the retained analysis universe. This panel does not claim that every study
                  has been independently revalidated.
                </p>
              </div>
              <div className="ex-table-scroll">
                <table className="ex-source-table">
                  <thead>
                    <tr>
                      <th>Source / population</th>
                      <th>Preparation</th>
                      <th>Expression unit</th>
                      <th>Reported cohorts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources
                      .filter((source) => source.collection === 'existing')
                      .map((source) => (
                        <tr key={source.id}>
                          <td>
                            <button
                              type="button"
                              className="ex-text-button"
                              onClick={() => setDetail(source)}
                            >
                              {source.populationLabel}
                            </button>
                            <a
                              className="ex-subline"
                              href={source.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {sourceCollection(source)} ↗
                            </a>
                          </td>
                          <td>
                            {source.assay}
                            <span className="ex-subline">
                              {source.rnaFraction} · {source.region}
                            </span>
                          </td>
                          <td>{source.unit}</td>
                          <td>
                            {source.conditions.map((condition) => condition.label).join(' · ')}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <p className="ex-caption">
                Further population taxonomies:{' '}
                <a
                  href="https://www.nature.com/articles/s42255-022-00657-y"
                  target="_blank"
                  rel="noreferrer"
                >
                  HypoMap
                </a>{' '}
                and the{' '}
                <a
                  href="https://www.nature.com/articles/s41586-023-06812-z"
                  target="_blank"
                  rel="noreferrer"
                >
                  Allen whole-brain cell atlas
                </a>
                . These references provide additional nomenclature; their full expression matrices
                are not included in this module.
              </p>
            </section>
          )}
        </div>
        {detail && (
          <SourceDetail
            source={detail}
            results={[]}
            referenceOnly={scope.referenceOnly}
            onClose={() => setDetail(null)}
          />
        )}
      </div>
    </PageShell>
  );
}
