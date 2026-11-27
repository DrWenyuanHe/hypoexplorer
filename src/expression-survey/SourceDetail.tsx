// A survey source's record: its definition, cohorts, original sample metadata
// and, once a survey has loaded them, its stored values. Opened from a result
// panel on the gene page or the survey page, and from the population catalog.
import { Modal } from '../common/Modal';
import { downloadFile } from '../utils/exportAction';
import { loadExternalManifest } from './expressionData';
import { providerOf } from './externalReference';
import { EXTERNAL_REFERENCE_ROOTS } from './externalReferenceFormat';
import { loadNeuroseqManifest } from './neuroseqExpression';
import type { ExpressionGeneResult, ExpressionSource } from './expressionTypes';
import {
  formatValue,
  inReferenceScope,
  isSummary,
  missingLabel,
  sampleStatus,
  sourceCollection,
  VALUE_STATUS_LABEL,
} from './expressionSurvey';
import { useKeyedLoad } from './useSurveyLoad';

export function ProviderCredit({ source }: { source: ExpressionSource }) {
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

export function saveText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  downloadFile(filename, url);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SourceDetail({
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
                <p className="ex-empty">{missingLabel(result, source)}</p>
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
