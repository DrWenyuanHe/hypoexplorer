import { useMemo, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent } from 'react';
import { PageShell } from '../common/PageShell';
import { Modal } from '../common/Modal';
import { ExportButton } from '../common/ExportButton';
import { Spinner } from '../common/Spinner';
import { FONT_MONO, FONT_SANS } from '../styles/constants';
import { downloadFile, useExportAction } from '../utils/exportAction';
import { EXISTING_EXPRESSION_SOURCES } from './existingCatalog';
import {
  loadExpressionSources,
  loadExpressionValidation,
  loadExternalManifest,
  loadExternalSourceErrors,
} from './expressionData';
import { loadNeuroseqManifest } from './neuroseqExpression';
import { loadReferenceManifest } from './referenceExpression';
import { providerOf } from './externalReference';
import { EXTERNAL_PROVIDERS, EXTERNAL_REFERENCE_ROOTS } from './externalReferenceFormat';
import type { ExpressionGeneResult, ExpressionSource } from './expressionTypes';
import {
  barGeometry,
  catalogEntries as filterCatalog,
  catalogRegions,
  exportManifestNeeds,
  formatValue,
  groupValue,
  inReferenceScope,
  isBoundary,
  isSummary,
  missingLabel,
  panelGroups,
  sampleCount,
  sampleStatus,
  selectSources,
  sourceCollection,
  surveyExport,
  surveyPanel,
  VALUE_STATUS_LABEL,
} from './expressionSurvey';
import type { Collection, ExportFormat, ExportManifests, SurveySection, TissueKind } from './expressionSurvey';
import { useExternalValidation, useKeyedLoad, useSurveyLoad } from './useSurveyLoad';
import './expressionSurvey.css';

const SECTIONS: { id: SurveySection; label: string }[] = [
  { id: 'survey', label: 'Gene survey' },
  { id: 'catalog', label: 'Population catalog' },
  { id: 'tissue', label: 'Tissue & bulk' },
  { id: 'sources', label: 'Sources & validation' },
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
/** The study-library sources ship with the app, so the survey works before (or without) the catalog. */
const BUNDLED_SOURCES: ExpressionSource[] = [...EXISTING_EXPRESSION_SOURCES];
const MONO_STYLE = { '--ex-font-mono': FONT_MONO, fontFamily: FONT_SANS } as CSSProperties;

function ProviderCredit({ source }: { source: ExpressionSource }) {
  if (!source.provider) return null;
  return (
    <p className="ex-caption">
      {source.provider.attribution}{' '}
      <a href={source.provider.licenseUrl} target="_blank" rel="noreferrer">
        {source.provider.license} ↗
      </a>
    </p>
  );
}

function saveText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  downloadFile(filename, url);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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

function SourceDetail({
  source,
  results,
  referenceOnly,
  onClose,
}: {
  source: ExpressionSource;
  results: ExpressionGeneResult[];
  referenceOnly: boolean;
  onClose: () => void;
}) {
  const sourceResults = results.filter((result) => result.sourceId === source.id);
  const libraries = useKeyedLoad(
    source.collection === 'neuroseq' ? source.id : null,
    () => loadNeuroseqManifest().then((manifest) => manifest.samples.filter((sample) => sample.populationId === source.id)),
    'Sample metadata unavailable.',
  );
  const atlasSamples = useKeyedLoad(
    source.collection === 'external' && !isSummary(source) ? source.id : null,
    () => loadExternalManifest(providerOf(source)).then((manifest) => manifest.samples.filter((sample) => sample.sourceId === source.id)),
    'Sample metadata unavailable.',
  );
  const metadata = libraries.value;
  const externalSamples = atlasSamples.value;
  return (
    <Modal
      title={`${source.populationLabel} · source record`}
      onClose={onClose}
      width="960px"
      height="82vh"
    >
      <div className="ex-detail">
        <div className="ex-eyebrow">{sourceCollection(source)}</div>
        <h2>{source.label}</h2>
        <p className="ex-source-id">{source.id}</p>
        <dl className="ex-facts">
          <div>
            <dt>Region / species</dt>
            <dd>
              {source.region} · {source.species}
            </dd>
          </div>
          <div>
            <dt>Population definition</dt>
            <dd>
              {source.identityMethod}
              {source.driverOrMarker ? ` · ${source.driverOrMarker}` : ''}
            </dd>
          </div>
          <div>
            <dt>Assay / RNA fraction</dt>
            <dd>
              {source.assay} · {source.rnaFraction}
            </dd>
          </div>
          <div>
            <dt>Measurement</dt>
            <dd>{source.unit}</dd>
          </div>
          <div>
            <dt>Normalization</dt>
            <dd>{source.normalization}</dd>
          </div>
          <div>
            <dt>Replicate unit</dt>
            <dd>{source.replicateUnit}</dd>
          </div>
        </dl>
        <a href={source.sourceUrl} target="_blank" rel="noreferrer">
          Original source ↗
        </a>
        <p className="ex-note">{source.citation}</p>
        <p className="ex-note">{source.notes}</p>
        {source.collection === 'reference' && (
          <p className="ex-note">
            <a href="/expression/oxt-reference/manifest.json" target="_blank" rel="noreferrer">
              Original cell, animal/pool, plate and labeling metadata ↗
            </a>
          </p>
        )}
        {source.collection === 'external' && (
          <>
            <ProviderCredit source={source} />
            <p className="ex-note">
              {source.provider?.release} ·{' '}
              <a
                href={`${EXTERNAL_REFERENCE_ROOTS[providerOf(source)]}/manifest.json`}
                target="_blank"
                rel="noreferrer"
              >
                Source, sample and column metadata · JSON ↗
              </a>
            </p>
          </>
        )}
        {source.sharedSampleNote && <p className="ex-notice">{source.sharedSampleNote}</p>}
        <h3>Reported cohorts</h3>
        <div className="ex-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Source group / cohort</th>
                <th>Feeding state</th>
                <th>Reference eligibility</th>
                <th>Context</th>
              </tr>
            </thead>
            <tbody>
              {source.conditions.map((condition) => (
                <tr key={condition.key}>
                  <td>
                    {condition.label}
                    <span className="ex-subline ex-mono">
                      {condition.key} ·{' '}
                      {isSummary(source)
                        ? 'published summary'
                        : `${condition.sampleCount ?? 'unknown'} samples`}
                    </span>
                  </td>
                  <td>{condition.feedingState}</td>
                  <td>
                    {condition.referenceEligible
                      ? 'Eligible reference'
                      : 'Excluded from reference filter'}
                  </td>
                  <td>
                    {condition.notes}
                    <span className="ex-subline">
                      {[
                        condition.age,
                        condition.sex,
                        condition.timeOfDay,
                        condition.genotype,
                        condition.treatment,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {source.collection === 'neuroseq' && (
          <>
            <h3>Original library metadata</h3>
            {libraries.error ? (
              <p role="alert">{libraries.error}</p>
            ) : !metadata ? (
              <p role="status">Loading library metadata…</p>
            ) : (
              <div className="ex-table-scroll">
                <table className="ex-sample-table">
                  <thead>
                    <tr>
                      <th>Library / GEO accession</th>
                      <th>Sex / age</th>
                      <th>Sorted cells</th>
                      <th>Feeding state</th>
                      <th>Shared-sample candidate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metadata.map((sample) => (
                      <tr key={sample.id}>
                        <td>
                          <span className="ex-mono">{sample.id}</span>
                          <span className="ex-subline">{sample.label}</span>
                          <a
                            href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${encodeURIComponent(sample.geo)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {sample.geo} ↗
                          </a>
                        </td>
                        <td>
                          {sample.sex} ·{' '}
                          {sample.ageDays == null ? 'Age unknown' : `${sample.ageDays} days`}
                        </td>
                        <td className="ex-number">{sample.pooledCellCount ?? '—'}</td>
                        <td>{sample.feedingState}</td>
                        <td>
                          {sample.henryOverlapCandidate
                            ? `${sample.henryOverlapCandidate.henryColumn} · ${sample.henryOverlapCandidate.henryGeo}`
                            : 'None cataloged'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="ex-note">
              <a href="/expression/neuroseq/manifest.json" target="_blank" rel="noreferrer">
                Full source and sample metadata · JSON ↗
              </a>
            </p>
          </>
        )}
        {source.collection === 'external' && !isSummary(source) && (
          <>
            <h3>Original sample metadata</h3>
            {atlasSamples.error ? (
              <p role="alert">{atlasSamples.error}</p>
            ) : !externalSamples ? (
              <p role="status">Loading sample metadata…</p>
            ) : (
              <div className="ex-table-scroll">
                <table className="ex-sample-table">
                  <thead>
                    <tr>
                      <th>Sample</th>
                      {Object.keys(externalSamples[0]?.metadata ?? {}).map((field) => (
                        <th key={field}>
                          {field === 'rin'
                            ? 'RIN'
                            : field.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {externalSamples.map((sample) => (
                      <tr key={sample.id}>
                        <td className="ex-mono">{sample.label}</td>
                        {Object.entries(sample.metadata).map(([field, value]) => (
                          <td key={field}>{value}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        <h3>{isSummary(source) ? 'Published values' : 'Individual sample values'}</h3>
        <p className="ex-note">
          {isSummary(source)
            ? `${source.summaryStatistic ?? 'Published summary'}: one value per ${source.scope === 'population' ? 'cluster' : 'subregion'}, as stated by the provider. No sample values are distributed and no mean is computed.`
            : 'Original sample identifiers and stored values.'}{' '}
          A missing value is displayed as —.{' '}
          {referenceOnly
            ? 'Only explicitly eligible reference cohorts are shown.'
            : 'All reported cohorts are shown.'}
        </p>
        {!sourceResults.length ? (
          <p className="ex-empty">Survey this source to load expression values.</p>
        ) : (
          sourceResults.map((result) => (
            <section key={`${result.query}:${result.probe ?? ''}`} className="ex-detail-gene">
              <h4 className="ex-mono">
                {result.gene ?? result.query}
                {result.probe ? ` · probe ${result.probe}` : ''}{' '}
                <span className="ex-muted">· {result.unit}</span>
              </h4>
              {result.status !== 'available' ? (
                <p className="ex-empty">{missingLabel(result)}</p>
              ) : isSummary(source) ? (
                <div className="ex-table-scroll">
                  <table className="ex-sample-table">
                    <thead>
                      <tr>
                        <th>{source.scope === 'population' ? 'Cluster' : 'Subregion'}</th>
                        <th className="ex-number">Published value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.groups
                        .filter((group) => inReferenceScope(group, referenceOnly))
                        .map((group) => (
                          <tr key={group.key}>
                            <td>{group.label}</td>
                            <td className="ex-number">{formatValue(group.summary)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="ex-table-scroll">
                  <table className="ex-sample-table">
                    <thead>
                      <tr>
                        <th>Sample ID</th>
                        <th>Source cohort</th>
                        <th className="ex-number">Stored value</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.groups
                        .filter((group) => inReferenceScope(group, referenceOnly))
                        .flatMap((group) =>
                          group.samples.map((sample) => (
                            <tr key={`${group.key}:${sample.id}`}>
                              <td className="ex-mono">{sample.id}</td>
                              <td>{group.label}</td>
                              <td className="ex-number">{formatValue(sample.value)}</td>
                              <td>{VALUE_STATUS_LABEL[sampleStatus(sample.value)]}</td>
                            </tr>
                          )),
                        )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))
        )}
      </div>
    </Modal>
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

export function ExpressionSurveyView({ onHome }: { onHome: () => void }) {
  const [section, setSection] = useState<SurveySection>('survey');
  const [collection, setCollection] = useState<Collection>('neuroseq');
  const [region, setRegion] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [includeSfo, setIncludeSfo] = useState(false);
  const [referenceOnly, setReferenceOnly] = useState(false);
  const [input, setInput] = useState('');
  const [genes, setGenes] = useState<string[]>([]);
  const [queryError, setQueryError] = useState('');
  const [matrix, setMatrix] = useState(false);
  const [tissueKind, setTissueKind] = useState<TissueKind>('whole');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogCollection, setCatalogCollection] = useState('neuroseq');
  const [catalogRegion, setCatalogRegion] = useState('all');
  const [detail, setDetail] = useState<ExpressionSource | null>(null);
  const catalogExport = useExportAction();

  // Each request retries on its own: the catalog (with the atlas errors it
  // reports), the validation reports, and each source's survey values.
  const catalog = useKeyedLoad('catalog', loadExpressionSources, 'Source catalog could not be loaded.');
  const atlasErrors = useKeyedLoad('atlas-errors', loadExternalSourceErrors, 'Reference atlas status could not be loaded.');
  const retryCatalog = () => {
    catalog.retry();
    atlasErrors.retry();
  };
  const sources = catalog.value ?? BUNDLED_SOURCES;
  const externalErrors = atlasErrors.value ?? {};
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

  const { regions, choices, selected: selectedSources } = useMemo(
    () => selectSources(sources, { section, collection, region, includeSfo, selectedIds, tissueKind }),
    [sources, section, collection, region, includeSfo, selectedIds, tissueKind],
  );
  const isSurvey = section === 'survey' || section === 'tissue';
  const currentLoad = useSurveyLoad({ enabled: isSurvey, sources: selectedSources, genes });
  const groupedPanels = useMemo(() => panelGroups(selectedSources), [selectedSources]);
  const catalogEntries = useMemo(
    () => filterCatalog(sources, { collection: catalogCollection, region: catalogRegion, query: catalogQuery }),
    [sources, catalogCollection, catalogRegion, catalogQuery],
  );

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
    if (next.length > 12) {
      setQueryError('Survey up to 12 genes at a time.');
      return;
    }
    setQueryError('');
    setGenes(next);
    setMatrix(next.length > 1);
  }

  function changeCollection(next: Collection) {
    setCollection(next);
    setRegion('all');
    setSelectedIds(null);
  }

  function toggleSource(id: string) {
    const selected = new Set(selectedIds ?? choices.map((source) => source.id));
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    setSelectedIds([...selected]);
  }

  function surveySource(source: ExpressionSource) {
    setSection('survey');
    setCollection(source.collection);
    setRegion('all');
    setSelectedIds([source.id]);
    if (isBoundary(source)) setIncludeSfo(true);
  }

  function tabKey(event: KeyboardEvent<HTMLButtonElement>, current: SurveySection) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const index = SECTIONS.findIndex((tab) => tab.id === current);
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % SECTIONS.length
        : event.key === 'ArrowLeft'
          ? (index + SECTIONS.length - 1) % SECTIONS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? SECTIONS.length - 1
              : -1;
    if (next < 0) return;
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
        One gene, or up to 12 separated by commas. Stored identifiers are preserved.
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
      <div className="expression-survey" style={MONO_STYLE}>
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
          {catalog.error && (
            <div className="ex-notice" role="alert">
              <strong>NeuroSeq catalog could not be loaded.</strong> {catalog.error} Existing study
              sources remain available.{' '}
              <button type="button" onClick={retryCatalog}>
                Retry
              </button>
              <button
                type="button"
                onClick={() => {
                  changeCollection('existing');
                  setSection('survey');
                }}
              >
                Use study library
              </button>
            </div>
          )}
          {Object.keys(externalErrors).length > 0 && (
            <div className="ex-notice" role="alert">
              <strong>Reference atlas data could not be loaded.</strong>{' '}
              {Object.entries(externalErrors)
                .map(([provider, error]) => `${provider.toUpperCase()}: ${error}`)
                .join(' ')}{' '}
              Other sources remain available.{' '}
              <button type="button" onClick={retryCatalog}>
                Retry
              </button>
            </div>
          )}
          {isSurvey && (
            <section
              role="tabpanel"
              id={`ex-panel-${section}`}
              aria-labelledby={`ex-tab-${section}`}
              className="ex-survey-layout"
            >
              <div className="ex-query-panel">
                {geneForm}
                <aside className="ex-sidebar" aria-label="Survey filters">
                  {section === 'survey' ? (
                    <>
                      <label className="ex-field">
                        <span>Source collection</span>
                        <select
                          value={collection}
                          onChange={(event) => changeCollection(event.target.value as Collection)}
                        >
                          <option value="neuroseq">NeuroSeq</option>
                          <option value="reference">OXT cell reference</option>
                          <option value="existing">Existing study library</option>
                          <option value="external">Reference atlases (HPA)</option>
                          <option value="agrp">AgRP across studies</option>
                          <option value="all">All population sources</option>
                        </select>
                      </label>
                      <label className="ex-field">
                        <span>Anatomical region</span>
                        <select value={region} onChange={(event) => setRegion(event.target.value)}>
                          <option value="all">All regions</option>
                          {regions.map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <label className="ex-checkbox">
                        <input
                          type="checkbox"
                          checked={includeSfo}
                          onChange={(event) => setIncludeSfo(event.target.checked)}
                        />
                        <span>Include SFO boundary records</span>
                      </label>
                      <details className="ex-population-picker">
                        <summary>
                          Populations{' '}
                          <span className="ex-mono">
                            {selectedSources.length}/{choices.length}
                          </span>
                        </summary>
                        <div className="ex-picker-actions">
                          <button
                            type="button"
                            className="ex-text-button"
                            onClick={() => setSelectedIds(null)}
                          >
                            Select all
                          </button>
                          <button
                            type="button"
                            className="ex-text-button"
                            onClick={() => setSelectedIds([])}
                          >
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
                            onClick={() => setTissueKind(item.id)}
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
                <div className="ex-scope-footer">
                  <label className="ex-checkbox">
                    <input type="checkbox" checked={referenceOnly}
                      onChange={(event) => setReferenceOnly(event.target.checked)} />
                    <span>Fed / reference cohorts only</span>
                  </label>
                  <span className="ex-note" role="status">{selectedSources.length} source records selected</span>
                </div>
              </div>
              <div className="ex-results">
                {genes.length > 0 && (
                  <>
                    <div className="ex-results-heading">
                      <div>
                        <div className="ex-eyebrow">
                          {section === 'tissue'
                            ? 'Tissue & broadly isolated neurons'
                            : 'Population expression'}
                        </div>
                        <h2 className="ex-mono">{genes.join(' · ')}</h2>
                        <p className="ex-note">
                          {selectedSources.length} selected source records ·{' '}
                          {referenceOnly
                            ? 'Explicitly eligible reference cohorts'
                            : 'All reported states'}
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
                    <p className="ex-empty">
                      Choose your sources, enter a gene, then select Survey to load expression values.
                    </p>
                  ) : currentLoad.loading ||
                  (catalog.loading && collection === 'neuroseq' && section === 'survey') ? (
                    <div className="ex-loading">
                      <Spinner size={18} /> Loading source expression…
                    </div>
                  ) : selectedSources.length === 0 ? (
                    <p className="ex-empty">
                      Select a population or another source collection to begin.
                    </p>
                  ) : (
                    <span className="ex-sr-only">
                      Expression survey loaded for {genes.join(', ')}.
                    </span>
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
                      currentLoad.results.some((result) =>
                        panelSources.some((source) => source.id === result.sourceId),
                      ) && (
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
                  onClick={() => {
                    changeCollection('agrp');
                    setSection('survey');
                  }}
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
            results={currentLoad.results}
            referenceOnly={referenceOnly}
            onClose={() => setDetail(null)}
          />
        )}
      </div>
    </PageShell>
  );
}
