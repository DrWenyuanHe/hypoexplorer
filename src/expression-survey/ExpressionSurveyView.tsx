import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent } from 'react';
import { PageShell } from '../common/PageShell';
import { Modal } from '../common/Modal';
import { ExportButton } from '../common/ExportButton';
import { Spinner } from '../common/Spinner';
import { FONT_MONO, FONT_SANS } from '../styles/constants';
import { downloadFile, exportFilename, useExportAction } from '../utils/exportAction';
import { EXISTING_EXPRESSION_SOURCES } from './existingCatalog';
import {
  loadExpressionGenes,
  loadExpressionSources,
  loadExpressionValidation,
  loadExternalManifest,
  loadExternalSourceErrors,
  loadExternalValidation,
} from './expressionData';
import { loadNeuroseqManifest } from './neuroseqExpression';
import type { NeuroseqSample } from './neuroseqExpression';
import { loadReferenceManifest } from './referenceExpression';
import { providerOf } from './externalReference';
import { EXTERNAL_PROVIDERS, EXTERNAL_REFERENCE_ROOTS } from './externalReferenceFormat';
import type { ExternalProvider, ExternalValidation } from './externalReferenceFormat';
import type { ExpressionGeneResult, ExpressionSource } from './expressionTypes';
import './expressionSurvey.css';

type Section = 'survey' | 'catalog' | 'tissue' | 'sources';
type Collection = 'neuroseq' | 'existing' | 'reference' | 'external' | 'all' | 'agrp';
type LoadState = {
  key: string;
  loading: boolean;
  results: ExpressionGeneResult[];
  errors: Record<string, string>;
};
type Validation = Awaited<ReturnType<typeof loadExpressionValidation>>;
type ResultGroup = ExpressionGeneResult['groups'][number];
type DisplayRow = { source: ExpressionSource; group: ResultGroup; result: ExpressionGeneResult };

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'survey', label: 'Gene survey' },
  { id: 'catalog', label: 'Population catalog' },
  { id: 'tissue', label: 'Tissue & bulk' },
  { id: 'sources', label: 'Sources & validation' },
];
const EMPTY_LOAD: LoadState = { key: '', loading: false, results: [], errors: {} };
const MONO_STYLE = { '--ex-font-mono': FONT_MONO, fontFamily: FONT_SANS } as CSSProperties;

/** Keep one queue across query changes; shared in-flight loads finish and warm the cache. */
function createSourceQueue(limit: number) {
  const waiting: Array<() => Promise<void>> = [];
  let active = 0;
  function drain() {
    while (active < limit && waiting.length) {
      const task = waiting.shift()!;
      active++;
      void task().finally(() => { active--; drain(); });
    }
  }
  return <T,>(work: () => Promise<T>, cancelled: () => boolean): Promise<T | null> =>
    new Promise((resolve, reject) => {
      waiting.push(async () => {
        if (cancelled()) { resolve(null); return; }
        try { resolve(await work()); } catch (error) { reject(error); }
      });
      drain();
    });
}

function sourceCollection(source: ExpressionSource): string {
  if (source.collection === 'neuroseq') return 'NeuroSeq';
  if (source.collection === 'external') return source.provider?.name ?? 'External reference';
  return source.sourceUrl.match(/[?&]acc=(GSE\d+)/i)?.[1] ?? 'Study library';
}

function isSummary(source: ExpressionSource | undefined): boolean {
  return source?.valueKind === 'summary';
}

/** A summary group's published value, otherwise the stored-value mean; never a mean of summaries. */
function groupValue(group: ResultGroup): number | null {
  return group.summary !== undefined ? group.summary : group.mean;
}

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

function isBoundary(source: ExpressionSource): boolean {
  return /\bSFO\b/i.test(source.region) || source.id.includes('.SFO_');
}

function isAgrp(source: ExpressionSource): boolean {
  return source.populationId === 'agrp';
}

function formatValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  return value < 0.01 || value >= 100000
    ? value.toExponential(2)
    : value.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  // Keep text identifiers literal in spreadsheet applications. Numeric values,
  // including negative transformed expression, retain their numeric spelling.
  const literal = typeof value === 'string' && /^[\t\r\n ]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${literal.replace(/"/g, '""')}"`;
}

function saveText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  downloadFile(filename, url);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sampleCount(source: ExpressionSource): string {
  // Counts belong to the catalog when provided; do not invent them from DE arms.
  const count = 'sampleCount' in source ? source.sampleCount : null;
  return typeof count === 'number' ? String(count) : 'See cohorts';
}

function missingLabel(result: ExpressionGeneResult | undefined): string {
  if (!result) return 'Unavailable';
  if (result.status === 'ambiguous')
    return `Ambiguous identifier${result.candidates?.length ? `: ${result.candidates.join(', ')}` : ''}`;
  return 'Not retained in this source';
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
  const [format, setFormat] = useState('samples');
  const [error, setError] = useState('');
  const exportData = async () => {
    const stamp = new Date().toISOString();
    const filtered = results.map((result) => ({
      ...result,
      groups: result.groups.filter((g) => !referenceOnly || g.referenceEligible),
    }));
    const filename = exportFilename(
      ['expression', genes.join('-'), format],
      format === 'metadata' ? 'json' : 'csv',
    );
    if (format === 'metadata') {
      const neuroseqIds = new Set(
        sources.filter((source) => source.collection === 'neuroseq').map((source) => source.id),
      );
      const referenceIds = new Set(sources.filter((source) => source.collection === 'reference').map((source) => source.id));
      const external = sources.filter((source) => source.collection === 'external');
      const externalIds = new Set(external.map((source) => source.id));
      const providers = [...new Set(external.map(providerOf))];
      const [neuroseq, reference, externalManifests] = await Promise.all([
        neuroseqIds.size ? loadNeuroseqManifest() : null,
        referenceIds.size ? loadReferenceManifest() : null,
        Promise.all(providers.map((provider) => loadExternalManifest(provider))),
      ]);
      // External groups are never reference-eligible, so the filter excludes their samples.
      const sampleMetadata = [...(neuroseq?.samples.filter(
        (sample) =>
          neuroseqIds.has(sample.populationId) && (!referenceOnly || sample.referenceEligible),
      ) ?? []), ...(reference?.samples.filter((sample) => referenceIds.has(sample.sourceId) && (!referenceOnly || sample.referenceEligible)) ?? []),
      ...(referenceOnly ? [] : externalManifests.flatMap((manifest) => manifest.samples.filter((sample) => externalIds.has(sample.sourceId))))];
      saveText(
        filename,
        JSON.stringify(
          {
            exportedAt: stamp,
            genes,
            referenceOnly,
            summary:
              'Arithmetic mean of available stored sample values within each source and cohort; no cross-study mean. Summary sources carry the provider\'s published value in `summary` and no computed mean.',
            sources,
            sampleMetadata,
            results: filtered,
          },
          null,
          2,
        ),
        'application/json',
      );
      return;
    }
    const sourceMap = new Map(sources.map((source) => [source.id, source]));
    const header = [
      'source_id',
      'source_url',
      'population',
      'species',
      'region',
      'assay',
      'rna_fraction',
      'query',
      'gene',
      'gene_id',
      'probe',
      'identifier_candidates',
      'gene_status',
      'cohort_key',
      'cohort',
      'reference_eligible',
      'unit',
      ...(format === 'samples'
        ? ['sample_id', 'value', 'value_status']
        : ['mean_stored_value', 'measured_samples', 'total_samples', 'value_kind']),
    ];
    const rows: unknown[][] = [];
    for (const result of filtered) {
      const source = sourceMap.get(result.sourceId);
      if (!source) continue;
      const base = [
        source.id,
        source.sourceUrl,
        source.populationLabel,
        source.species,
        source.region,
        source.assay,
        source.rnaFraction,
        result.query,
        result.gene,
        result.geneId,
        result.probe,
        result.candidates?.join('; '),
        result.status,
      ];
      if (!result.groups.length) rows.push([...base, '', '', '', result.unit, '', '', '', ...(format === 'samples' ? [] : [''])]);
      for (const group of result.groups) {
        const cohort = [...base, group.key, group.label, group.referenceEligible, result.unit];
        if (group.summary !== undefined) {
          // A published summary has no sample; it is exported as stated, never as a mean.
          rows.push(format === 'samples'
            ? [...cohort, '', group.summary, group.summary == null ? 'missing' : 'published-summary']
            : [...cohort, group.summary, '', '', 'published-summary']);
        } else if (format === 'samples') {
          for (const sample of group.samples)
            rows.push([
              ...cohort,
              sample.id,
              sample.value,
              sample.value == null ? 'missing' : sample.value === 0 ? 'measured-zero' : 'measured',
            ]);
        } else rows.push([...cohort, group.mean, group.n, group.totalSamples, 'mean']);
      }
    }
    saveText(
      filename,
      [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n'),
      'text/csv;charset=utf-8',
    );
  };
  return (
    <div className="ex-export-controls">
      <label className="ex-sr-only" htmlFor="expression-export-format">
        Export format
      </label>
      <select
        id="expression-export-format"
        value={format}
        onChange={(e) => setFormat(e.target.value)}
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
  const [metadata, setMetadata] = useState<NeuroseqSample[] | null>(null);
  const [metadataError, setMetadataError] = useState('');
  const [externalSamples, setExternalSamples] = useState<Array<{ id: string; label: string; metadata: Record<string, string> }> | null>(null);
  useEffect(() => {
    if (source.collection !== 'external' || isSummary(source)) return;
    let cancelled = false;
    loadExternalManifest(providerOf(source))
      .then((manifest) => {
        if (!cancelled) setExternalSamples(manifest.samples.filter((sample) => sample.sourceId === source.id));
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setMetadataError(error instanceof Error ? error.message : 'Sample metadata unavailable.');
      });
    return () => {
      cancelled = true;
    };
  }, [source]);
  useEffect(() => {
    if (source.collection !== 'neuroseq') return;
    let cancelled = false;
    loadNeuroseqManifest()
      .then((manifest) => {
        if (!cancelled)
          setMetadata(manifest.samples.filter((sample) => sample.populationId === source.id));
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setMetadataError(error instanceof Error ? error.message : 'Sample metadata unavailable.');
      });
    return () => {
      cancelled = true;
    };
  }, [source]);
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
            {metadataError ? (
              <p role="alert">{metadataError}</p>
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
            {metadataError ? (
              <p role="alert">{metadataError}</p>
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
                        .filter((group) => !referenceOnly || group.referenceEligible)
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
                        .filter((group) => !referenceOnly || group.referenceEligible)
                        .flatMap((group) =>
                          group.samples.map((sample) => (
                            <tr key={`${group.key}:${sample.id}`}>
                              <td className="ex-mono">{sample.id}</td>
                              <td>{group.label}</td>
                              <td className="ex-number">{formatValue(sample.value)}</td>
                              <td>
                                {sample.value == null
                                  ? 'Missing value'
                                  : sample.value === 0
                                    ? 'Measured zero'
                                    : 'Measured'}
                              </td>
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
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const panelResults = results.filter((result) => sourceMap.has(result.sourceId));
  const rows: DisplayRow[] = [];
  for (const result of panelResults.filter((r) => r.query === primary)) {
    const source = sourceMap.get(result.sourceId);
    if (source && result.status === 'available')
      for (const group of result.groups) {
        if (!referenceOnly || group.referenceEligible) rows.push({ source, group, result });
      }
  }
  rows.sort((a, b) => (groupValue(b.group) ?? -Infinity) - (groupValue(a.group) ?? -Infinity));
  // The axis changes between studies. Within NeuroSeq, populations share the
  // same source matrix and unit, so a common axis is scientifically meaningful.
  const maximum = Math.max(0, ...rows.map((row) => groupValue(row.group) ?? 0));
  const minimum = Math.min(0, ...rows.map((row) => groupValue(row.group) ?? 0));
  const range = maximum - minimum || 1;
  const unavailable = panelResults.filter((result) => result.status !== 'available');
  const summary = isSummary(first);
  // Name the matched feature whenever it differs from the query (case, species or ID).
  const matched = panelResults.filter(
    (result) => result.status === 'available' && result.gene && result.gene !== result.query,
  );
  const sourceGroups = matrix
    ? sources.flatMap((source) => {
        const result = panelResults.find(
          (r) => r.sourceId === source.id && r.status === 'available',
        );
        return (
          result?.groups
            .filter((group) => !referenceOnly || group.referenceEligible)
            .map((group) => ({ source, group })) ?? []
        );
      })
    : [];
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
      {matched.length > 0 && (
        <p className="ex-note">
          Matched{' '}
          {[...new Set(matched.map((result) => result.query))]
            .map((query) => {
              const hits = matched.filter((result) => result.query === query);
              const probes = hits.flatMap((result) => (result.probe ? [result.probe] : []));
              return `${query} → ${hits[0].gene} (${probes.length ? `${probes.length === 1 ? 'probe' : `${probes.length} probes`} ${probes.join(', ')}` : hits[0].geneId})`;
            })
            .join(' · ')}{' '}
          in {first.species}.
        </p>
      )}
      <div className="ex-axis-note">
        <span>
          {summary ? 'Published value' : 'Mean stored value'} · <strong>{first.unit}</strong>
        </span>
        <span>
          {matrix
            ? 'Values retain source units'
            : `Axis ${formatValue(minimum)}–${formatValue(maximum)}`}
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
              {sourceGroups.map(({ source, group }) => (
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
                  {genes.map((gene) => {
                    // A probe-level source has one result per probe; show each, never a merge.
                    const found = panelResults.filter(
                      (r) => r.sourceId === source.id && r.query === gene,
                    );
                    const result = found[0];
                    const cells = found.map((r) => r.groups.find((g) => g.key === group.key));
                    const probes = found.flatMap((r) => (r.probe ? [r.probe] : []));
                    return (
                      <td
                        className="ex-number"
                        key={gene}
                        title={
                          result?.status === 'available'
                            ? summary
                              ? `Published value · ${result.unit}`
                              : `${probes.length ? `Probes ${probes.join(', ')} · ` : ''}${cells[0]?.n ?? 0} measured samples · ${result.unit}`
                            : missingLabel(result)
                        }
                      >
                        {cells.length
                          ? cells.map((cell) => formatValue(cell ? groupValue(cell) : null)).join(' · ')
                          : formatValue(null)}
                      </td>
                    );
                  })}
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
                {rows.map(({ source, group, result }) => (
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
                        <span
                          className="ex-zero"
                          style={{ left: `${(-minimum / range) * 100}%` }}
                        />
                        <span
                          className="ex-bar"
                          style={{
                            left: `${((Math.min(0, groupValue(group) ?? 0) - minimum) / range) * 100}%`,
                            width: `${(Math.abs(groupValue(group) ?? 0) / range) * 100}%`,
                          }}
                        />
                      </div>
                    </td>
                    <td className="ex-number">{formatValue(groupValue(group))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {!rows.length && (!matrix || !sourceGroups.length) && (
        <p className="ex-empty">
          {referenceOnly && panelResults.some((r) => r.status === 'available')
            ? 'No explicitly eligible reference cohort in this selection. Use all reported states to inspect the source.'
            : 'No expression value is available for this selection.'}
        </p>
      )}
      {unavailable.length > 0 && (
        <details className="ex-unavailable">
          <summary>
            {unavailable.length} gene / source {unavailable.length === 1 ? 'lookup' : 'lookups'}{' '}
            unavailable
          </summary>
          {unavailable.map((result) => (
            <p key={`${result.sourceId}:${result.query}`}>
              <span className="ex-mono">{result.query}</span> ·{' '}
              {sourceMap.get(result.sourceId)?.populationLabel}: {missingLabel(result)}.
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
  const [section, setSection] = useState<Section>('survey');
  const [sources, setSources] = useState<ExpressionSource[]>([...EXISTING_EXPRESSION_SOURCES]);
  const [catalogError, setCatalogError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [collection, setCollection] = useState<Collection>('neuroseq');
  const [region, setRegion] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [includeSfo, setIncludeSfo] = useState(false);
  const [referenceOnly, setReferenceOnly] = useState(false);
  const [input, setInput] = useState('');
  const [genes, setGenes] = useState<string[]>([]);
  const [queueSource] = useState(() => createSourceQueue(4));
  const [queryError, setQueryError] = useState('');
  const [matrix, setMatrix] = useState(false);
  const [tissueKind, setTissueKind] = useState('whole');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogCollection, setCatalogCollection] = useState('neuroseq');
  const [catalogRegion, setCatalogRegion] = useState('all');
  const [detail, setDetail] = useState<ExpressionSource | null>(null);
  const [load, setLoad] = useState<LoadState>(EMPTY_LOAD);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [validationError, setValidationError] = useState('');
  const [externalErrors, setExternalErrors] = useState<Partial<Record<ExternalProvider, string>>>({});
  const [externalValidation, setExternalValidation] = useState<Partial<Record<ExternalProvider, ExternalValidation | string>>>({});
  const catalogExport = useExportAction();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is the explicit user retry token for failed catalog requests.
  useEffect(() => {
    let cancelled = false;
    loadExternalSourceErrors()
      .then((errors) => {
        if (!cancelled) setExternalErrors(errors);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reload]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload lets the user retry failed validation reports.
  useEffect(() => {
    if (section !== 'sources') return;
    let cancelled = false;
    for (const provider of EXTERNAL_PROVIDERS) {
      if (typeof externalValidation[provider] === 'object') continue;
      loadExternalValidation(provider)
        .then((report) => {
          if (!cancelled) setExternalValidation((current) => ({ ...current, [provider]: report }));
        })
        .catch((error: unknown) => {
          if (!cancelled)
            setExternalValidation((current) => ({
              ...current,
              [provider]: error instanceof Error ? error.message : 'Validation report could not be loaded.',
            }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [section, reload]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is the explicit user retry token for failed catalog requests.
  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError('');
    loadExpressionSources()
      .then((next) => {
        if (!cancelled) setSources(next);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setCatalogError(
            error instanceof Error ? error.message : 'Source catalog could not be loaded.',
          );
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload lets the user retry a failed validation report without changing tabs.
  useEffect(() => {
    if (section !== 'sources' || validation) return;
    let cancelled = false;
    setValidationError('');
    loadExpressionValidation()
      .then((report) => {
        if (!cancelled) setValidation(report);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setValidationError(
            error instanceof Error ? error.message : 'Validation report could not be loaded.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [section, validation, reload]);

  const populationSources = useMemo(
    () => sources.filter((source) => source.scope === 'population'),
    [sources],
  );
  const collectionSources = useMemo(
    () =>
      populationSources.filter(
        (source) =>
          (collection === 'all' ||
            (collection === 'agrp' ? isAgrp(source) : source.collection === collection)) &&
          (includeSfo || !isBoundary(source)),
      ),
    [populationSources, collection, includeSfo],
  );
  const regions = useMemo(
    () => [...new Set(collectionSources.map((source) => source.region))].sort(),
    [collectionSources],
  );
  const choices = useMemo(
    () => collectionSources.filter((source) => region === 'all' || source.region === region),
    [collectionSources, region],
  );
  const tissueSources = useMemo(
    () =>
      sources.filter((source) => {
        if (source.scope === 'population') return false;
        if (tissueKind === 'all') return true;
        if (tissueKind === 'external') return source.collection === 'external';
        if (tissueKind === 'isolated') return source.scope === 'isolated-neurons';
        if (source.scope !== 'tissue') return false;
        return tissueKind === 'arc'
          ? /arcuate|\bAR[CH]\b/i.test(source.region)
          : /whole|^hypothalamus$/i.test(source.region);
      }),
    [sources, tissueKind],
  );
  const selectedSources = useMemo(
    () =>
      section === 'tissue'
        ? tissueSources
        : choices.filter((source) => selectedIds == null || selectedIds.includes(source.id)),
    [section, tissueSources, choices, selectedIds],
  );
  const requestKey = JSON.stringify([selectedSources.map((source) => source.id), genes, reload]);
  const isSurvey = section === 'survey' || section === 'tissue';
  const currentLoad =
    load.key === requestKey ? load : { ...EMPTY_LOAD, loading: genes.length > 0 && selectedSources.length > 0 };

  useEffect(() => {
    if (!isSurvey || genes.length === 0) return;
    let cancelled = false;
    setLoad({ key: requestKey, loading: selectedSources.length > 0, results: [], errors: {} });
    Promise.all(
      selectedSources.map((source) => queueSource(async () => {
        try {
          return {
            sourceId: source.id,
            results: await loadExpressionGenes(source, genes),
            error: null,
          };
        } catch (error: unknown) {
          return {
            sourceId: source.id,
            results: [],
            error:
              error instanceof Error ? error.message : 'Expression values could not be loaded.',
          };
        }
      }, () => cancelled)),
    ).then((entries) => {
      if (cancelled) return;
      setLoad({
        key: requestKey,
        loading: false,
        results: entries.flatMap((entry) => entry?.results ?? []),
        errors: Object.fromEntries(
          entries.flatMap((entry) => entry?.error ? [[entry.sourceId, entry.error]] : []),
        ),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [requestKey, isSurvey, selectedSources, genes, queueSource]);

  const groupedPanels = useMemo(() => {
    const groups = new Map<string, ExpressionSource[]>();
    for (const source of selectedSources) {
      const key = source.collection === 'neuroseq' ? 'neuroseq' : source.id;
      groups.set(key, [...(groups.get(key) ?? []), source]);
    }
    return [...groups.entries()];
  }, [selectedSources]);
  const catalogEntries = useMemo(
    () =>
      populationSources.filter(
        (source) =>
          (catalogCollection === 'all' || source.collection === catalogCollection) &&
          (catalogRegion === 'all' || source.region === catalogRegion) &&
          [
            source.label,
            source.id,
            source.populationLabel,
            source.region,
            source.assay,
            source.datasetId,
            source.notes,
            source.driverOrMarker,
          ]
            .join(' ')
            .toLowerCase()
            .includes(catalogQuery.toLowerCase()),
      ),
    [populationSources, catalogCollection, catalogRegion, catalogQuery],
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

  function tabKey(event: KeyboardEvent<HTMLButtonElement>, current: Section) {
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
          {catalogError && (
            <div className="ex-notice" role="alert">
              <strong>NeuroSeq catalog could not be loaded.</strong> {catalogError} Existing study
              sources remain available.{' '}
              <button type="button" onClick={() => setReload((value) => value + 1)}>
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
              <button type="button" onClick={() => setReload((value) => value + 1)}>
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
                        {[
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
                        ].map((item) => (
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
                  (catalogLoading && collection === 'neuroseq' && section === 'survey') ? (
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
                    <button type="button" onClick={() => setReload((value) => value + 1)}>
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
                    {[...new Set(populationSources.map((source) => source.region))]
                      .sort()
                      .map((value) => (
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
              {catalogLoading && <p role="status">Loading source catalog…</p>}
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
                      <button type="button" onClick={() => setReload((value) => value + 1)}>
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
                      const report = externalValidation[provider];
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
