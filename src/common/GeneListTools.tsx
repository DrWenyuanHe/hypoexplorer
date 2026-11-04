// The gene-list buttons: bring a list in from a file, send the selection out
// as one.
//
// Two controls, kept beside the gene search box in every view that holds a
// selection — the shared GenePicker renders them for the Gene Explorer, the
// Compare tab and the compare set:
//   Load list…   opens a dialog that takes a file (drop or choose) or a pasted
//                block, reads it through the gene-list seam, resolves it against
//                THIS dataset, and reports what it found before anything is
//                selected — a list of 50 mouse symbols dropped on the macaque
//                atlas should say which 3 it could not place, not quietly
//                select 47.
//   Save list    a small menu over the three formats a list travels in.
//
// The save menu is exported on its own as well, because a list worth saving
// is not always the selection: the volcano's threshold-passing genes are one,
// and that view has no selection of its own to hand over.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, DragEvent } from 'react';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { ExportButton } from './ExportButton';
import { useAliasIndex } from '../data/useAliasIndex';
import type { NomenclatureAuthority } from '../data/nomenclature';
import { useExportAction } from '../utils/exportAction';
import {
  GENE_LIST_SAVE_FORMATS, describeGeneListSource, parseGeneListFile, parseGeneListText,
  resolveGeneList, saveGeneList,
  type GeneListRow, type GeneListSaveFormat, type ParsedGeneList,
} from '../utils/geneListFile';
import { FONT_MONO, FONT_SANS } from '../styles/constants';

/** The toolbar button these controls share with the search box's Aliases toggle. */
const TOOL_BTN: CSSProperties = {
  flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5,
  fontSize: 11, padding: '4px 9px', cursor: 'pointer',
  border: '1px solid var(--border-dark)', borderRadius: 4,
  fontFamily: FONT_SANS, fontWeight: 600,
  background: 'var(--bg-panel)', color: 'var(--text-muted)',
};

const ACCEPT = [
  '.txt', '.csv', '.tsv', '.tab', '.xlsx', '.xls', '.xlsm', '.ods', '.gmt', '.json',
  'text/plain', 'text/csv', 'text/tab-separated-values', 'application/json',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',');

const UploadIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 16V4" /><path d="m6 10 6-6 6 6" /><path d="M4 20h16" />
  </svg>
);
const DownloadIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4v12" /><path d="m6 10 6 6 6-6" /><path d="M4 20h16" />
  </svg>
);

// ── Save ────────────────────────────────────────────────────────────────────

interface SaveGeneListMenuProps {
  /** The rows to write; the symbol first, then whatever the view adds. */
  rows: readonly GeneListRow[];
  /** Filename stem parts, e.g. the track code and what the list is. */
  filenameParts: Array<string | undefined>;
  label?: string;
  title?: string;
  style?: CSSProperties;
}

/**
 * "Save list ▾" and its three formats. The button is disabled with nothing to
 * save rather than hidden, so the affordance is discoverable before there is a
 * selection.
 */
export function SaveGeneListMenu({
  rows, filenameParts, label = 'Save list', title, style,
}: SaveGeneListMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { busy, run } = useExportAction();
  const empty = rows.length === 0;

  // Close on a click anywhere outside, and on Escape — the menu is a
  // transient popover, not a dialog, so it must not trap anything.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (format: GeneListSaveFormat) => {
    setOpen(false);
    run(() => saveGeneList(filenameParts, rows, format));
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <ExportButton
        onClick={() => setOpen((v) => !v)}
        busy={busy} busyLabel="Saving…" spinnerSize={10}
        disabled={empty}
        title={title ?? (empty ? 'Nothing to save yet' : `Download these ${rows.length} genes as a file`)}
        style={{ ...TOOL_BTN, ...style, opacity: empty ? 0.55 : 1, cursor: empty ? 'not-allowed' : 'pointer' }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <DownloadIcon />{label} ▾
      </ExportButton>
      {open && (
        <div role="menu" aria-label="Save list as" style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 100, marginTop: 4, minWidth: 220,
          background: 'var(--bg-panel)', border: '1px solid var(--border-dark)', borderRadius: 4,
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)', padding: 4,
        }}>
          {GENE_LIST_SAVE_FORMATS.map((f) => (
            <button key={f.format} type="button" role="menuitem" className="hover-row"
              onClick={() => choose(f.format)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
                border: 'none', background: 'none', cursor: 'pointer', borderRadius: 3,
                fontFamily: FONT_SANS, fontSize: 12, color: 'var(--text-primary)',
              }}>
              <span style={{ fontWeight: 600 }}>{f.label}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> · {f.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Load ────────────────────────────────────────────────────────────────────

interface LoadGeneListButtonProps {
  selectedGenes: readonly string[];
  /** Merge the resolved genes into the selection. */
  onAddGenes: (genes: string[]) => void;
  /** Replace the selection with the resolved genes. Omit to offer add only. */
  onReplaceGenes?: (genes: string[]) => void;
  /** The symbols this dataset actually stores — what the list resolves against. */
  geneNames: readonly string[];
  nomenclatureAuthority?: NomenclatureAuthority | null;
  /** Names the view for the dialog's copy: "this dataset", "the selected populations". */
  scopeLabel?: string;
  style?: CSSProperties;
}

interface Loaded {
  parsed: ParsedGeneList;
  /** Where it came from, for the report line. */
  source: string;
}

/** A comma-joined name list that stays readable past a few dozen entries. */
function NameList({ names, color }: { names: readonly string[]; color?: string }) {
  return (
    <div style={{
      fontFamily: FONT_MONO, fontSize: 11, lineHeight: 1.6, color: color ?? 'var(--text-primary)',
      maxHeight: 96, overflowY: 'auto', wordBreak: 'break-word',
    }}>
      {names.join(', ')}
    </div>
  );
}

export function LoadGeneListButton({
  selectedGenes, onAddGenes, onReplaceGenes, geneNames, nomenclatureAuthority,
  scopeLabel = 'this dataset', style,
}: LoadGeneListButtonProps) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pasted, setPasted] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const aliasIndex = useAliasIndex();

  const close = useCallback(() => {
    setOpen(false);
    setLoaded(null);
    setError(null);
    setReading(false);
    setDragging(false);
    setPasted('');
  }, []);

  // Resolution is derived, not stored: the alias index can land AFTER the file
  // was read, and re-deriving is what turns a "not found" into a redirect
  // without asking for the file again.
  const resolution = useMemo(
    () => (loaded ? resolveGeneList(loaded.parsed.genes, geneNames, aliasIndex, nomenclatureAuthority) : null),
    [loaded, geneNames, aliasIndex, nomenclatureAuthority],
  );
  const alreadySelected = useMemo(() => {
    if (!resolution) return 0;
    const sel = new Set(selectedGenes);
    return resolution.found.filter((g) => sel.has(g)).length;
  }, [resolution, selectedGenes]);

  const readFile = useCallback(async (file: File) => {
    setError(null);
    setLoaded(null);
    setReading(true);
    try {
      const parsed = await parseGeneListFile(file);
      setLoaded({ parsed, source: file.name });
    } catch (err) {
      setError(`Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReading(false);
    }
  }, []);

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the input so choosing the same file again re-reads it.
    e.target.value = '';
    if (file) void readFile(file);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) void readFile(file);
  };

  const readPasted = () => {
    setError(null);
    const parsed = parseGeneListText(pasted);
    setLoaded({ parsed, source: 'pasted text' });
  };

  const apply = (mode: 'add' | 'replace') => {
    if (!resolution?.found.length) return;
    if (mode === 'replace' && onReplaceGenes) onReplaceGenes(resolution.found);
    else onAddGenes(resolution.found);
    close();
  };

  const n = resolution?.found.length ?? 0;
  const newCount = n - alreadySelected;
  const plural = (k: number, word: string) => `${k.toLocaleString()} ${word}${k === 1 ? '' : 's'}`;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={{ ...TOOL_BTN, ...style }}
        title="Load a gene list from a text, CSV, TSV, Excel, GMT or JSON file, or paste one">
        <UploadIcon />Load list…
      </button>
      {open && (
        <Modal title="Load a gene list" width="min(640px, 94vw)" height="auto" onClose={close}>
          <div style={{ padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 14, fontFamily: FONT_SANS }}>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: the drop zone is a target for a drag, not a control; the button inside it is the keyboard path */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              style={{
                border: `2px dashed ${dragging ? 'var(--color-selected)' : 'var(--border-dark)'}`,
                borderRadius: 6, padding: '18px 16px', textAlign: 'center',
                background: dragging ? 'var(--chip-bg)' : 'var(--bg-app)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              }}
            >
              <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                Drop a file here, or
                {' '}
                <button type="button" onClick={() => fileRef.current?.click()}
                  style={{
                    fontSize: 12, padding: '4px 12px', border: '1px solid var(--border-dark)', borderRadius: 4,
                    background: 'var(--bg-panel)', color: 'var(--text-primary)', cursor: 'pointer',
                    fontFamily: FONT_SANS, fontWeight: 600,
                  }}>
                  Choose a file
                </button>
                <input ref={fileRef} type="file" accept={ACCEPT} onChange={onFileChange}
                  aria-label="Gene list file" style={{ display: 'none' }} />
              </div>
              <div style={{ fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-muted)', maxWidth: '52ch' }}>
                Import text, CSV, TSV, Excel, GMT or JSON. The app detects the gene column from
                a header such as Gene, Symbol or gene_name, or from the cell values when no header
                is available. It matches names to the symbols stored in {scopeLabel}, using the
                same alias and previous-symbol records as gene search.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="gene-list-paste" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: 0.3 }}>
                Or paste symbols
              </label>
              <textarea id="gene-list-paste" value={pasted} onChange={(e) => setPasted(e.target.value)}
                placeholder={'POMC\nAGRP\nNPY\nOne symbol per line. Spaces and commas also work.'}
                rows={3} spellCheck={false}
                style={{
                  width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '6px 10px',
                  fontFamily: FONT_MONO, fontSize: 12, border: '1px solid var(--border-dark)', borderRadius: 4,
                  color: 'var(--text-primary)', background: 'var(--bg-panel)',
                }} />
              <div>
                <button type="button" onClick={readPasted} disabled={!pasted.trim()}
                  style={{
                    fontSize: 12, padding: '4px 12px', border: '1px solid var(--border-dark)', borderRadius: 4,
                    background: 'var(--bg-panel)', color: 'var(--text-primary)', cursor: pasted.trim() ? 'pointer' : 'not-allowed',
                    fontFamily: FONT_SANS, fontWeight: 600, opacity: pasted.trim() ? 1 : 0.55,
                  }}>
                  Read pasted list
                </button>
              </div>
            </div>

            {reading && <Spinner size={12} label="Reading the file…" />}
            {error && (
              <div role="alert" style={{ fontSize: 12, color: 'var(--accent-up)', lineHeight: 1.5 }}>{error}</div>
            )}

            {loaded && resolution && (
              <div style={{
                border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px',
                display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg-panel)',
              }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>
                  <strong>{plural(loaded.parsed.genes.length, 'name')}</strong> read from{' '}
                  <span style={{ fontFamily: FONT_MONO }}>{loaded.source}</span>
                  <span style={{ color: 'var(--text-muted)' }}> · {describeGeneListSource(loaded.parsed)}</span>
                </div>

                {loaded.parsed.genes.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    No gene symbols were detected. Use one symbol per line, or a table column
                    headed Gene or Symbol.
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12.5 }}>
                      <strong style={{ color: 'var(--text-primary)' }}>{plural(n, 'gene')}</strong>
                      <span style={{ color: 'var(--text-muted)' }}> found in {scopeLabel}</span>
                      {alreadySelected > 0 && (
                        <span style={{ color: 'var(--text-muted)' }}> · {alreadySelected.toLocaleString()} already selected</span>
                      )}
                      {resolution.duplicates > 0 && (
                        <span style={{ color: 'var(--text-muted)' }}> · {plural(resolution.duplicates, 'duplicate')} in the list</span>
                      )}
                    </div>
                    {resolution.redirected.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 2 }}>
                          {plural(resolution.redirected.length, 'name')} matched under another name
                          <span title="This name matches an alias, a previous symbol or a current symbol for a retired name. The dataset stores the symbol shown on the right."> ⓘ</span>
                        </div>
                        <NameList names={resolution.redirected.map((r) => `${r.from} → ${r.to}`)} />
                      </div>
                    )}
                    {resolution.ambiguous.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11.5, color: 'var(--accent-up)', marginBottom: 2 }}>
                          {plural(resolution.ambiguous.length, 'name')} left out: each is an alias of several genes here
                        </div>
                        <NameList names={resolution.ambiguous.map((a) => `${a.from} (${a.to.join(' / ')})`)} />
                      </div>
                    )}
                    {resolution.missing.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11.5, color: 'var(--accent-up)', marginBottom: 2 }}>
                          {plural(resolution.missing.length, 'name')} not in {scopeLabel}
                        </div>
                        <NameList names={resolution.missing} color="var(--text-muted)" />
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                      <button type="button" onClick={() => apply('add')} disabled={n === 0}
                        style={{
                          fontSize: 12.5, padding: '6px 14px', border: 'none', borderRadius: 5,
                          background: n === 0 ? 'var(--border-dark)' : 'var(--color-selected)', color: '#fff',
                          cursor: n === 0 ? 'not-allowed' : 'pointer', fontFamily: FONT_SANS, fontWeight: 700,
                        }}>
                        {selectedGenes.length > 0 && newCount !== n
                          ? `Add ${plural(Math.max(newCount, 0), 'new gene')} to the selection`
                          : `Add ${plural(n, 'gene')} to the selection`}
                      </button>
                      {onReplaceGenes && selectedGenes.length > 0 && n > 0 && (
                        <button type="button" onClick={() => apply('replace')}
                          title={`Clear the ${selectedGenes.length} selected gene${selectedGenes.length === 1 ? '' : 's'} first`}
                          style={{
                            fontSize: 12, padding: '5px 12px', border: '1px solid var(--border-dark)', borderRadius: 5,
                            background: 'var(--bg-panel)', color: 'var(--text-primary)', cursor: 'pointer',
                            fontFamily: FONT_SANS, fontWeight: 600,
                          }}>
                          Replace the selection
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
