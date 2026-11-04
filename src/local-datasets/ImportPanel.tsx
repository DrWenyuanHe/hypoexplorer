// biome-ignore-all lint/suspicious/noArrayIndexKey: source preview cells and column positions have immutable positional identities
import { useMemo, useRef, useState } from 'react';
import {
  getSheetHeaders,
  normalizeSheet,
  parseLocalFile,
  suggestMapping,
  validateMapping,
} from './importData';
import type { ColumnField, ImportKind, ImportSheet, LocalDataset, NormalizedImport } from './types';

interface Draft {
  sheet: ImportSheet;
  enabled: boolean;
  confirmed: boolean;
  target: string;
  name: string;
  organism: string;
}
const fields: Record<ImportKind, [ColumnField, string][]> = {
  de: [
    ['gene', 'Gene symbol or ID *'],
    ['geneId', 'Additional gene ID'],
    ['logFC', 'Log2 fold change *'],
    ['padj', 'Adjusted p-value / FDR'],
    ['pvalue', 'Raw p-value'],
  ],
  pathway: [
    ['pathway', 'Pathway ID or name *'],
    ['pathwayName', 'Pathway description'],
    ['nes', 'Normalized enrichment score'],
    ['padj', 'Adjusted p-value / FDR'],
    ['pvalue', 'Raw p-value'],
    ['leadingEdge', 'Leading-edge / member genes'],
    ['size', 'Gene set size'],
    ['database', 'Database'],
  ],
};

function newDraft(sheet: ImportSheet): Draft {
  return {
    sheet,
    enabled: true,
    confirmed: false,
    target: '',
    name: sheet.name === 'Sheet1' ? sheet.fileName.replace(/\.[^.]+$/, '') : sheet.name,
    organism: '',
  };
}

/** Reject conflicting rows instead of quietly mixing two experimental contrasts. */
export function mergeLocalImport(
  dataset: LocalDataset,
  normalized: NormalizedImport,
): LocalDataset {
  const genes = new Map(dataset.genes.map((row) => [row.gene.toUpperCase(), row]));
  for (const row of normalized.genes) {
    const previous = genes.get(row.gene.toUpperCase());
    if (
      previous &&
      (previous.logFC !== row.logFC || previous.padj !== row.padj || previous.pvalue !== row.pvalue)
    ) {
      throw new Error(
        `Conflicting results for ${row.gene} in ${dataset.name}. Assign separate comparisons to separate datasets.`,
      );
    }
    if (!previous) genes.set(row.gene.toUpperCase(), row);
  }
  const pathways = new Map(
    dataset.pathways.map((row) => [`${row.database}:${row.pathway}`.toUpperCase(), row]),
  );
  for (const row of normalized.pathways) {
    const key = `${row.database}:${row.pathway}`.toUpperCase();
    const previous = pathways.get(key);
    if (
      previous &&
      JSON.stringify({ ...previous, source: '' }) !== JSON.stringify({ ...row, source: '' })
    ) {
      throw new Error(
        `Conflicting pathway results in ${dataset.name}. Assign separate comparisons to separate datasets.`,
      );
    }
    if (!previous) pathways.set(key, row);
  }
  return {
    ...dataset,
    genes: [...genes.values()],
    pathways: [...pathways.values()],
    sources: [...dataset.sources, normalized.source],
    updatedAt: new Date().toISOString(),
  };
}

export function ImportPanel({
  datasets,
  onImport,
  onCancel,
}: {
  datasets: LocalDataset[];
  onImport: (datasets: LocalDataset[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pasted, setPasted] = useState('');
  const lock = useRef(false);
  const draft = drafts[active];
  const sheet = draft?.sheet;
  const headers = useMemo(() => (sheet ? getSheetHeaders(sheet) : []), [sheet]);
  const preview = useMemo(() => {
    if (!sheet) return { value: null, errors: [] as string[] };
    const errors = validateMapping(sheet.kind, sheet.mapping);
    if (errors.length) return { value: null, errors };
    try {
      return { value: normalizeSheet(sheet), errors: [] as string[] };
    } catch (e) {
      return {
        value: null,
        errors: [e instanceof Error ? e.message : 'Could not read the selected columns.'],
      };
    }
  }, [sheet]);
  function update(patch: Partial<Draft>) {
    setDrafts((current) =>
      current.map((item, index) =>
        index === active ? { ...item, ...patch, confirmed: false } : item,
      ),
    );
  }
  async function readFiles(files: File[]) {
    if (!files.length || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const additions: Draft[] = [];
    const errors: string[] = [];
    try {
      for (const file of files) {
        try {
          additions.push(...(await parseLocalFile(file)).map(newDraft));
        } catch (e) {
          errors.push(
            `${file.name}: ${e instanceof Error ? e.message : 'Could not read this file.'}`,
          );
        }
      }
      setDrafts((current) => [...current, ...additions]);
      if (additions.length) setActive(drafts.length);
      setError(errors.join(' '));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function commit() {
    if (lock.current) return;
    const selected = drafts.filter((item) => item.enabled);
    if (!selected.length || selected.some((item) => !item.confirmed)) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const pending = new Map<string, LocalDataset>();
      for (const item of selected) {
        const existing = datasets.find((dataset) => dataset.id === item.target);
        const key = existing?.id ?? `new:${item.name.trim()}:${item.organism.trim().toLowerCase()}`;
        const now = new Date().toISOString();
        const dataset = pending.get(key) ??
          existing ?? {
            id: crypto.randomUUID(),
            name: item.name.trim(),
            organism: item.organism.trim(),
            createdAt: now,
            updatedAt: now,
            genes: [],
            pathways: [],
            sources: [],
          };
        if (!dataset.name || !dataset.organism)
          throw new Error('Give every new dataset a name and organism before importing.');
        pending.set(key, mergeLocalImport(dataset, normalizeSheet(item.sheet)));
      }
      await onImport([...pending.values()]);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Import failed. Your existing datasets have not changed.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const selected = drafts.filter((item) => item.enabled);
  const canConfirm = Boolean(
    preview.value &&
      preview.value.genes.length + preview.value.pathways.length &&
      (draft?.target || (draft?.name.trim() && draft?.organism.trim())),
  );
  return (
    <section className="local-import" aria-label="Import local datasets">
      <div className="local-section-heading">
        <div>
          <h2>Import results</h2>
          <p>1. Choose files &nbsp; 2. Review each sheet &nbsp; 3. Confirm and save locally</p>
        </div>
        <button type="button" onClick={onCancel} disabled={busy}>
          Close import
        </button>
      </div>
      <section
        className="local-file-drop"
        aria-label="Local file drop area"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void readFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <label className="local-file-label">
          Choose local files
          <input
            aria-label="Choose local result files"
            type="file"
            multiple
            accept=".csv,.tsv,.txt,.tab,.xlsx,.xls,.xlsm,.xlsb,.ods"
            disabled={busy}
            onChange={(event) => {
              void readFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
        </label>
        <p>
          Drop CSV, TSV, TXT, Excel or ODS files here. All workbook sheets are available for review.
        </p>
        <span>File contents are read in your browser. Nothing is uploaded.</span>
      </section>
      <details className="local-paste">
        <summary>Or paste a table</summary>
        <label>
          Tab- or comma-separated results
          <textarea
            aria-label="Paste results table"
            rows={5}
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={!pasted.trim() || busy}
          onClick={() =>
            void readFiles([new File([pasted], 'Pasted results.txt', { type: 'text/plain' })])
          }
        >
          Read pasted table
        </button>
      </details>
      {busy && <p role="status">Reading or saving in this browser...</p>}
      {error && (
        <p className="local-error" role="alert">
          {error}
        </p>
      )}
      {draft && (
        <div className="local-review-layout">
          <nav className="local-sheet-list" aria-label="Workbook sheets">
            <h3>Sheets to review</h3>
            {drafts.map((item, index) => (
              <button
                type="button"
                key={item.sheet.id}
                className={index === active ? 'is-active' : ''}
                aria-current={index === active ? 'step' : undefined}
                disabled={busy}
                onClick={() => setActive(index)}
              >
                <strong>{item.sheet.name}</strong>
                <span>{item.sheet.fileName}</span>
                <small>
                  {!item.enabled ? 'Excluded' : item.confirmed ? 'Confirmed' : 'Needs review'}
                </small>
              </button>
            ))}
          </nav>
          <div className="local-sheet-review">
            <div className="local-section-heading">
              <h3>{draft.sheet.name}</h3>
              <label className="local-check">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  disabled={busy}
                  onChange={(event) => update({ enabled: event.target.checked })}
                />
                Include this sheet
              </label>
            </div>
            <fieldset disabled={busy || !draft.enabled}>
              <div className="local-form-grid">
                <label>
                  Result type
                  <select
                    value={draft.sheet.kind}
                    onChange={(event) => {
                      const kind = event.target.value as ImportKind;
                      update({
                        sheet: { ...draft.sheet, kind, mapping: suggestMapping(headers, kind) },
                      });
                    }}
                  >
                    <option value="de">Differential expression</option>
                    <option value="pathway">FGSEA / pathway enrichment</option>
                  </select>
                </label>
                <label>
                  Header row
                  <input
                    type="number"
                    min={1}
                    max={draft.sheet.rows.length}
                    value={draft.sheet.headerRow + 1}
                    onChange={(event) => {
                      const headerRow = Math.max(
                        0,
                        Math.min(draft.sheet.rows.length - 1, Number(event.target.value) - 1),
                      );
                      const sheet = { ...draft.sheet, headerRow };
                      update({
                        sheet: {
                          ...sheet,
                          mapping: suggestMapping(getSheetHeaders(sheet), sheet.kind),
                        },
                      });
                    }}
                  />
                </label>
                <label>
                  Add to dataset
                  <select
                    value={draft.target}
                    onChange={(event) => update({ target: event.target.value })}
                  >
                    <option value="">New dataset</option>
                    {datasets.map((dataset) => (
                      <option key={dataset.id} value={dataset.id}>
                        {dataset.name}
                      </option>
                    ))}
                  </select>
                </label>
                {!draft.target && (
                  <>
                    <label>
                      Dataset / comparison name
                      <input
                        value={draft.name}
                        list="local-new-dataset-names"
                        onChange={(event) => update({ name: event.target.value })}
                      />
                      <datalist id="local-new-dataset-names">
                        {[...new Set(drafts.map((item) => item.name))].map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    </label>
                    <label>
                      Organism
                      <input
                        value={draft.organism}
                        list="local-organisms"
                        placeholder="e.g. Homo sapiens"
                        onChange={(event) => update({ organism: event.target.value })}
                      />
                      <datalist id="local-organisms">
                        {[
                          'Homo sapiens',
                          'Mus musculus',
                          'Rattus norvegicus',
                          'Macaca mulatta',
                          'Other / unknown',
                        ].map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    </label>
                  </>
                )}
              </div>
              <p className="local-help">
                Use the same dataset name and organism to pair DE and FGSEA from one comparison.
                Give different comparisons different names. Each sheet must contain one comparison;
                split tables with multiple comparisons first.
              </p>
              <h4>Confirm column matching</h4>
              <p className="local-help">
                Check and correct the suggested columns. Fold changes must use a log2 scale.
                Raw p-values are not treated as FDR.
              </p>
              <div className="local-mapping-grid">
                {fields[draft.sheet.kind].map(([field, label]) => (
                  <label key={field}>
                    {label}
                    <select
                      aria-label={label}
                      value={draft.sheet.mapping[field] ?? ''}
                      onChange={(event) =>
                        update({
                          sheet: {
                            ...draft.sheet,
                            mapping: {
                              ...draft.sheet.mapping,
                              [field]:
                                event.target.value === '' ? null : Number(event.target.value),
                            },
                          },
                        })
                      }
                    >
                      <option value="">Not provided</option>
                      {headers.map((header, index) => (
                        <option key={`${index}-${header}`} value={index}>
                          {index + 1}. {header}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <h4>Source preview</h4>
              <div className="local-preview-scroll">
                <table>
                  <thead>
                    <tr>
                      {headers.map((header, index) => (
                        <th key={`${index}-${header}`}>{header || `Column ${index + 1}`}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {draft.sheet.rows
                      .slice(draft.sheet.headerRow + 1, draft.sheet.headerRow + 6)
                      .map((row, index) => (
                        <tr key={`preview-${index}`}>
                          {headers.map((_, column) => (
                            <td key={`cell-${column}`}>{row[column]}</td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {preview.errors.map((message) => (
                <p key={message} className="local-error">
                  {message}
                </p>
              ))}
              {preview.value && (
                <div className="local-validation">
                  <strong>
                    {(preview.value.genes.length + preview.value.pathways.length).toLocaleString()}{' '}
                    usable rows
                  </strong>
                  <span>{preview.value.skippedRows.toLocaleString()} skipped rows</span>
                  {preview.value.issues.length > 0 && (
                    <details>
                      <summary>Review {preview.value.issues.length} data notes</summary>
                      <ul>
                        {preview.value.issues.slice(0, 20).map((message, index) => (
                          <li key={`issue-${index}`}>{message}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
              <label className="local-confirm">
                <input
                  type="checkbox"
                  disabled={!canConfirm}
                  checked={draft.confirmed}
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((item, index) =>
                        index === active ? { ...item, confirmed: event.target.checked } : item,
                      ),
                    )
                  }
                />
                I checked the columns, dataset assignment, organism, and data notes for this sheet.
              </label>
            </fieldset>
          </div>
        </div>
      )}
      {drafts.length > 0 && (
        <div className="local-import-footer">
          <span>
            {selected.filter((item) => item.confirmed).length} of {selected.length} included sheets
            confirmed
          </span>
          <button
            type="button"
            className="local-primary"
            disabled={busy || !selected.length || selected.some((item) => !item.confirmed)}
            onClick={() => void commit()}
          >
            Save confirmed datasets locally
          </button>
        </div>
      )}
    </section>
  );
}
