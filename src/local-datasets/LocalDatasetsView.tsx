import { useEffect, useRef, useState } from 'react';
import { PageShell } from '../common/PageShell';
import { writeWorkbook } from '../utils/workbook';
import { localExportName, localExportProvenance, metadataSheet } from '../utils/exportProvenance';
import { ImportPanel } from './ImportPanel';
import { LocalExplorer } from './LocalExplorer';
import { PublicReferencePicker } from './PublicReferencePicker';
import {
  deleteLocalDataset,
  listLocalDatasets,
  localStorageError,
  saveLocalDatasets,
} from './storage';
import type { LocalDataset } from './types';
import './localDatasets.css';

export default function LocalDatasetsView({ onHome }: { onHome: () => void }) {
  const [datasets, setDatasets] = useState<LocalDataset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState<LocalDataset | null>(null);
  const mutationLock = useRef(false);
  const active = datasets.find((dataset) => dataset.id === activeId);
  useEffect(() => {
    let cancelled = false;
    listLocalDatasets()
      .then((rows) => {
        if (cancelled) return;
        setDatasets(rows);
        setActiveId(rows[0]?.id ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(localStorageError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function save(rows: LocalDataset[], closeImport = true) {
    await saveLocalDatasets(rows);
    setDatasets((current) => {
      const updated = new Map(current.map((row) => [row.id, row]));
      for (const row of rows) updated.set(row.id, row);
      return [...updated.values()];
    });
    setActiveId(rows[0]?.id ?? null);
    if (closeImport) setImporting(false);
    setError('');
    setNotice(
      `Saved ${rows.length === 1 ? rows[0].name : `${rows.length} datasets`} in this browser.`,
    );
  }
  async function remove(dataset: LocalDataset) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setError('');
    try {
      await deleteLocalDataset(dataset.id);
      setDeleted(dataset);
      setDatasets((current) => current.filter((row) => row.id !== dataset.id));
      if (activeId === dataset.id)
        setActiveId(datasets.find((row) => row.id !== dataset.id)?.id ?? null);
      setRemoving(null);
      setNotice(
        `Removed ${dataset.name} from this browser. Undo is available until you leave this workspace.`,
      );
    } catch (e) {
      setError(localStorageError(e));
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }
  async function exportActive() {
    if (!active || mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    try {
      // Named and recorded by the export-provenance module, which marks the
      // file as local and records no release or evidence it does not have.
      await writeWorkbook(localExportName(active, ['results'], 'xlsx'), [
        {
          name: 'Differential expression',
          rows: active.genes.map((row) => ({
            gene: row.gene,
            gene_id: row.geneId ?? '',
            log2FoldChange: row.logFC,
            padj: row.padj,
            pvalue: row.pvalue,
          })),
        },
        {
          name: 'Pathway enrichment',
          rows: active.pathways.map((row) => ({
            pathway: row.pathway,
            Description: row.name,
            NES: row.nes,
            padj: row.padj,
            pvalue: row.pvalue,
            size: row.size,
            leadingEdge: row.genes.join(';'),
            database: row.database,
          })),
        },
        {
          name: 'Dataset details',
          rows: [
            {
              name: active.name,
              organism: active.organism,
              savedAt: active.updatedAt,
              sources: active.sources
                .map((source) => `${source.fileName} / ${source.sheetName}`)
                .join('; '),
            },
          ],
        },
        metadataSheet(localExportProvenance(active)),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export this dataset. Try again.');
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }
  return (
    <PageShell
      onHome={onHome}
      breadcrumbs={[{ label: 'Local datasets', current: true }]}
      headerRight={<span className="local-storage-badge">Stored in this browser</span>}
    >
      <div className="local-workspace">
        <div className="local-heading">
          <div>
            <p className="local-eyebrow">YOUR RESULTS</p>
            <h1>Local datasets</h1>
            <p>
              Explore your genes and pathways. Compare results across your own datasets and
              downloaded public studies.
            </p>
          </div>
          <button
            type="button"
            className="local-primary"
            disabled={loading || importing || busy}
            onClick={() => {
              setImporting(true);
              setNotice('');
            }}
          >
            Import results
          </button>
        </div>
        <div className="local-privacy">
          <strong>Your files stay in this browser.</strong>
          <span>
            The app imports, searches and saves your results locally. Keep your original
            files. Clearing site data or using private browsing can remove saved datasets.
          </span>
        </div>
        {error && (
          <p role="alert" className="local-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="local-notice">
            {notice}{' '}
            {deleted && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await save([deleted]);
                    setDeleted(null);
                  } catch (e) {
                    setError(localStorageError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Undo removal
              </button>
            )}
          </p>
        )}
        {loading ? (
          <p role="status">Loading saved datasets from this browser...</p>
        ) : importing ? (
          <ImportPanel datasets={datasets} onImport={save} onCancel={() => setImporting(false)} />
        ) : (
          <>
            {datasets.length === 0 ? (
              <section className="local-empty">
                <div className="local-empty-symbol" aria-hidden="true">
                  ↗
                </div>
                <h2>Import a comparison</h2>
                <p>
                  Start with differential expression results, FGSEA, or pathway enrichment. Pair
                  their tables under one dataset, then select a gene to inspect its pathways and
                  compare it across studies.
                </p>
                <button type="button" className="local-primary" onClick={() => setImporting(true)}>
                  Choose your first files
                </button>
                <p className="local-help">
                  CSV · TSV · TXT · Excel · ODS &nbsp;|&nbsp; Multiple files and workbook sheets
                </p>
              </section>
            ) : (
              <>
                <div className="local-library-bar">
                  <span>
                    <strong>{datasets.length}</strong> saved{' '}
                    {datasets.length === 1 ? 'dataset' : 'datasets'}
                  </span>
                  <div>
                    <button
                      type="button"
                      disabled={!active || busy}
                      onClick={() => void exportActive()}
                    >
                      Export selected dataset
                    </button>
                    <button
                      type="button"
                      disabled={!active || busy}
                      onClick={() => setRemoving(activeId)}
                    >
                      Remove selected dataset
                    </button>
                  </div>
                </div>
                {removing && (
                  <div className="local-remove" role="alert">
                    <span>
                      Remove {datasets.find((row) => row.id === removing)?.name} from this browser?
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const row = datasets.find((dataset) => dataset.id === removing);
                        if (row) void remove(row);
                      }}
                    >
                      Remove local copy
                    </button>
                    <button type="button" disabled={busy} onClick={() => setRemoving(null)}>
                      Keep dataset
                    </button>
                  </div>
                )}
                <LocalExplorer
                  datasets={datasets}
                  activeId={activeId}
                  onSelectDataset={setActiveId}
                />
                {active && (
                  <details className="local-source-details">
                    <summary>Imported sources and column assignments</summary>
                    <p>
                      {active.organism} · Last saved {new Date(active.updatedAt).toLocaleString()}
                    </p>
                    {active.sources.map((source) => (
                      <p key={`${source.fileName}-${source.sheetName}-${source.importedAt}`}>
                        <strong>{source.fileName}</strong> / {source.sheetName} ·{' '}
                        {source.rowCount.toLocaleString()} rows · Header row {source.headerRow + 1}
                        <br />
                        {Object.entries(source.mapping)
                          .filter(([, column]) => column != null)
                          .map(([field, column]) => `${field}: column ${Number(column) + 1}`)
                          .join(' · ')}
                      </p>
                    ))}
                  </details>
                )}
              </>
            )}
            <PublicReferencePicker
              onAdd={async (dataset) => save([dataset], false)}
              disabled={busy}
            />
          </>
        )}
      </div>
    </PageShell>
  );
}
