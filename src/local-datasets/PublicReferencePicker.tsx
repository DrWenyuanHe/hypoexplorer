import { useEffect, useState } from 'react';
import { getActiveContrast } from '../data/contrasts';
import { listDatasets } from '../data/datasets';
import { loadDatasetMeta } from '../data/loadDatasetMeta';
import { loadTrackData, popDataFor } from '../data/trackData';
import { PUBLIC_COPY_SOURCE_PREFIX } from '../utils/exportProvenance';
import type { Dataset, DatasetMeta, PopData, ResolvedContrast } from '../types';
import type { LocalDataset, LocalSource } from './types';

const PUBLIC_DATASETS = listDatasets().filter((dataset) => dataset.featureType === 'gene');
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const probability = (value: unknown): number | null => {
  const number = finite(value);
  return number !== null && number >= 0 && number <= 1 ? number : null;
};

/** Convert the complete chosen public comparison. No local identifier is used
 * to choose a download, query shard, URL, or request body. */
export function publicReferenceDataset(
  dataset: Dataset,
  trackId: string,
  trackLabel: string,
  contrast: ResolvedContrast | null,
  data: PopData,
  now = new Date().toISOString(),
): LocalDataset {
  const source = `${PUBLIC_COPY_SOURCE_PREFIX}${dataset.id} / ${trackId} / ${contrast?.id ?? 'default'}`;
  const genes = data.de.filter((row) => row.gene && Number.isFinite(row.logFC)).map((row) => ({
    gene: row.gene, logFC: row.logFC, pvalue: probability(row.PValue), padj: probability(row.FDR), source,
  }));
  const pathways = data.allPathways.filter((row) => row.pathway).map((row) => ({
    pathway: row.pathway, name: row.pathway, nes: finite(row.NES),
    pvalue: probability(row.pval), padj: probability(row.padj), size: finite(row.size),
    genes: Array.isArray(row.leadingEdge) ? [...new Set(row.leadingEdge.filter((gene) => typeof gene === 'string' && gene.length > 0))] : [],
    database: row.db, source,
  }));
  const sourceRecord = (kind: LocalSource['kind'], rowCount: number): LocalSource => ({
    fileName: source, sheetName: kind === 'de' ? 'Differential expression' : 'Pathway enrichment',
    kind, rowCount, importedAt: now, headerRow: 0, mapping: {},
  });
  return {
    id: `public:${dataset.id}:${trackId}:${contrast?.id ?? 'default'}`,
    name: `Public · ${dataset.name} · ${trackLabel}${contrast ? ` · ${contrast.label}` : ''}`,
    organism: dataset.organism, createdAt: now, updatedAt: now, genes, pathways,
    sources: [sourceRecord('de', genes.length), ...(pathways.length ? [sourceRecord('pathway', pathways.length)] : [])],
  };
}

interface PublicReferencePickerProps {
  onAdd: (dataset: LocalDataset) => Promise<void>;
  disabled?: boolean;
}

export function PublicReferencePicker({ onAdd, disabled = false }: PublicReferencePickerProps) {
  const [datasetId, setDatasetId] = useState('');
  const [trackId, setTrackId] = useState('');
  const [contrastId, setContrastId] = useState('');
  const [meta, setMeta] = useState<DatasetMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const dataset = PUBLIC_DATASETS.find((item) => item.id === datasetId);
  const contrast = getActiveContrast(dataset, contrastId);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry intentionally repeats the metadata download for the same study.
  useEffect(() => {
    let current = true;
    setMeta(null);
    setTrackId('');
    setContrastId(getActiveContrast(dataset)?.id ?? '');
    setNotice('');
    setError('');
    if (!dataset) { setLoadingMeta(false); return; }
    setLoadingMeta(true);
    loadDatasetMeta(dataset).then((loaded) => {
      if (!current) return;
      if (!loaded.populations?.length) throw new Error('This public study has no available tracks.');
      setMeta(loaded);
      setTrackId(loaded.populations.includes(dataset.defaultTrack) ? dataset.defaultTrack : loaded.populations[0]);
    }).catch(() => {
      if (current) setError('Could not download this public study’s track list. Check your connection and retry.');
    }).finally(() => { if (current) setLoadingMeta(false); });
    return () => { current = false; };
  }, [dataset, retry]);

  const addReference = async () => {
    if (!dataset || !meta || !trackId || downloading) return;
    setDownloading(true);
    setError('');
    setNotice('');
    try {
      const loaded = await loadTrackData(dataset, trackId, { pathways: 'include' });
      await loaded.pathwaysReady;
      const data = popDataFor(loaded.raw, dataset, contrast);
      if (!data || (!data.de.length && !data.allPathways.length)) {
        throw new Error('This track has no available results for the selected comparison. Choose another comparison.');
      }
      const reference = publicReferenceDataset(dataset, trackId, meta.labels[trackId] || trackId, contrast, data);
      if (!reference.genes.length && !reference.pathways.length) {
        throw new Error('This comparison has no valid gene or pathway results to save.');
      }
      await onAdd(reference);
      const missingPathways = !reference.pathways.length
        ? dataset.supportsPathways
          ? ' Pathway results were unavailable for this comparison; this local copy contains gene results only. Retry the download later to check for pathway results.'
          : ' This study provides no pathway enrichment results.'
        : '';
      setNotice(`Saved ${reference.genes.length.toLocaleString()} gene results and ${reference.pathways.length.toLocaleString()} pathway results in this browser.${missingPathways}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not download and save this public comparison. Try again.');
    } finally {
      setDownloading(false);
    }
  };

  const busy = disabled || downloading;
  return (
    <details className="local-public-reference" style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add a public study for local comparison</summary>
      <p style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Download a public study's track and comparison to this browser. Comparisons use the saved copy. Your imported files and selections stay in this browser.
      </p>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
        <label style={{ display: 'grid', gap: 5 }}>Public study
          <select aria-label="Public reference study" value={datasetId} disabled={busy} onChange={(event) => setDatasetId(event.target.value)} style={{ minWidth: 0, width: '100%' }}>
            <option value="">Choose a public study…</option>
            {PUBLIC_DATASETS.map((item) => <option key={item.id} value={item.id}>{item.name}, {item.organism}</option>)}
          </select>
        </label>
        {dataset && <>
          <label style={{ display: 'grid', gap: 5 }}>Track / population
            <select aria-label="Public reference track" value={trackId} disabled={busy || !meta} onChange={(event) => setTrackId(event.target.value)} style={{ minWidth: 0, width: '100%' }}>
              {!meta && <option value="">{loadingMeta ? 'Loading tracks…' : 'No tracks loaded'}</option>}
              {meta?.populations.map((id) => <option key={id} value={id}>{meta.labels[id] || id}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 5 }}>Comparison
            <select aria-label="Public reference comparison" value={contrastId} disabled={busy} onChange={(event) => setContrastId(event.target.value)} style={{ minWidth: 0, width: '100%' }}>
              {!dataset.contrasts.length && <option value="">Default comparison</option>}
              {dataset.contrasts.map((item) => <option key={item.id} value={item.id}>{getActiveContrast(dataset, item.id)?.label || item.id}</option>)}
            </select>
          </label>
        </>}
      </div>
      {dataset && <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>{dataset.organism} · {dataset.geo || dataset.citation}{contrast?.exploratory ? ' · Exploratory re-analysis comparison' : ''}</p>}
      {dataset && <button type="button" disabled={busy || loadingMeta || !meta || !trackId} onClick={() => void addReference()} style={{ marginTop: 12 }}>
        {downloading ? 'Downloading and saving…' : 'Download comparison to this browser'}
      </button>}
      {error && <div role="alert" style={{ marginTop: 12, color: 'var(--danger, #b91c1c)' }}>{error}
        {!meta && dataset && <button type="button" disabled={busy || loadingMeta} onClick={() => setRetry((value) => value + 1)} style={{ marginLeft: 8 }}>Retry</button>}
      </div>}
      {notice && <p role="status" style={{ marginBottom: 0 }}>{notice}</p>}
    </details>
  );
}
