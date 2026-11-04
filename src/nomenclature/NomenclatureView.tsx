// Gene nomenclature — a full-screen, dataset-agnostic reference page listing
// every gene symbol the corpus stores, checked against the authority that
// governs it.
//
// WHY THIS PAGE EXISTS
// --------------------
// The explorer shows whatever symbol its upstream analysis produced, and for
// 3,570 of them that is a name the authority has since replaced. Until now
// nothing on the site said so, which left a reader with no way to tell a gene
// the corpus does not measure from one it measures under an older name. This
// page is the answer to "is what I am looking at current?", written down where
// it can be checked, cited and downloaded rather than trusted.
//
// It is a page-level `view` like StatisticsView (whose shape it follows) rather
// than a track-scoped tab, because nothing here depends on a loaded track.
//
// THE TABLE IS SOURCE, NOT A RENDER
// ---------------------------------
// What this page shows is a projection of data/nomenclature/nomenclature.tsv,
// which is COMMITTED to the repository and is the artifact of record. The link
// to it on GitHub is not decoration: it is the difference between a claim and a
// checkable claim, and it is why the Excel export and the page agree by
// construction — both read the same generated table.
//
// RENDERING 120,000+ ROWS
// ---------------------
// It does not. A reference table is used by looking things up, so the view
// renders the first PAGE_ROWS matches and says how many it is not showing; the
// Excel export is what covers "give me all of it". A virtualizer would be the
// alternative and would buy a scrollbar nobody wants to drag through 120,000
// rows.

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { PageShell } from '../common/PageShell';
import { Spinner } from '../common/Spinner';
import { ExportButton } from '../common/ExportButton';
import { SortableTh } from '../common/SortableTh';
import { useSortedRows } from '../common/useSortedRows';
import { useExportAction, exportFilename } from '../utils/exportAction';
import { writeWorkbook } from '../utils/workbook';
import { COLOR_WARNING_BG, COLOR_WARNING_TEXT, FONT_HEADING, FONT_MONO, FONT_SANS } from '../styles/constants';
import {
  loadNomenclatureTable, NOMENCLATURE_AUTHORITIES, NOMENCLATURE_STATUS,
  type NomenclatureAuthority, type NomenclatureRow, type NomenclatureStatus, type NomenclatureTable,
} from '../data/nomenclature';
import { geneAuthorityUrl } from '../utils/geneLinks';

/** Where the committed source table lives, so a reader can check it directly. */
const SOURCE_TSV_URL =
  'https://github.com/DrWenyuanHe/hypoexplorer/blob/main/data/nomenclature/nomenclature.tsv';

/** How many matching rows the table renders. See the header note. */
const PAGE_ROWS = 300;

/**
 * Dark slate for the neutral status pills. Deliberately NOT the app's semantic
 * colors: blue/red are bound to down/up-regulation and orange to the active
 * selection, so painting hundreds of table rows with them would teach the
 * reader the wrong lesson (and white-on-fill failed WCAG AA at this size
 * anyway). Statuses instead follow the DbPill pattern — dark text on a light
 * tinted wash — with the amber warning pair reserved for the one status that
 * is actually a caution.
 */
const SLATE_TEXT = 'var(--text-mono)';

/** What each status means, in the reader's terms rather than the generator's. */
const STATUS_COPY: Record<NomenclatureStatus, { label: string; blurb: string; text: string; bg: string }> = {
  current: {
    label: 'Current',
    blurb: 'The stored symbol matches an unambiguously selected current symbol in the authority reference.',
    text: SLATE_TEXT,
    bg: 'rgba(114, 108, 99, 0.10)',
  },
  previous: {
    label: 'Outdated',
    blurb: 'The authority has replaced this symbol. The data retains the older spelling. Search either name to find it.',
    text: COLOR_WARNING_TEXT,
    bg: COLOR_WARNING_BG,
  },
  alias: {
    label: 'Alias',
    blurb: 'A recognized informal name for a gene rather than an approved symbol.',
    text: SLATE_TEXT,
    bg: 'rgba(114, 108, 99, 0.24)',
  },
  unrecognized: {
    label: 'Unrecognized',
    blurb: 'No matching symbol, alias or previous symbol in the reference table. Most are predicted-gene or clone identifiers with Gm…, …Rik or LOC… names.',
    text: SLATE_TEXT,
    bg: 'rgba(114, 108, 99, 0.05)',
  },
  ambiguous: {
    label: 'Ambiguous',
    blurb: 'The name or its replacement points to conflicting active authority records. Candidate IDs are retained; no authority record or alias redirect is selected.',
    text: COLOR_WARNING_TEXT,
    bg: COLOR_WARNING_BG,
  },
};

type SortKey = 'symbol' | 'authority' | 'status' | 'currentSymbol' | 'geneName' | 'locusType' | 'datasetCount';

const TH: CSSProperties = {
  padding: '7px 10px', fontSize: 11, fontWeight: 600, textAlign: 'left',
  color: 'var(--text-muted)', whiteSpace: 'nowrap', background: 'var(--bg-panel)',
  borderBottom: '1px solid var(--border-dark)', fontFamily: FONT_SANS,
  position: 'sticky', top: 0, zIndex: 1,
};
const TD: CSSProperties = {
  padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)',
  borderBottom: '1px solid var(--border)', fontFamily: FONT_SANS, verticalAlign: 'top',
};
const TD_MONO: CSSProperties = { ...TD, fontFamily: FONT_MONO, whiteSpace: 'nowrap' };

/**
 * Every other name a row answers to, as one list.
 *
 * Deduped: a name can be BOTH an alias and a previous symbol (MGI lists mouse
 * Agrt as a synonym of Agrp and as the symbol it replaced), and printing it
 * twice reads as a data error in a table whose entire job is being trustworthy.
 * The two facts stay separate in the columns and in the Excel export, where the
 * distinction is the point.
 */
function otherNames(row: { aliases: string[]; prevSymbols: string[] }): string[] {
  return [...new Set([...row.aliases, ...row.prevSymbols])];
}

/** A status pill — the same vocabulary the filter chips use. */
function StatusPill({ status }: { status: NomenclatureStatus }) {
  const { label, text, bg } = STATUS_COPY[status];
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 3,
      fontSize: 10.5, fontWeight: 600, fontFamily: FONT_SANS,
      color: text, background: bg, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

/**
 * The authority cell: the registry's name, linked to its own record for this gene.
 *
 * The id was already here as hover text and nothing else, which left the reader
 * to retype the symbol into a search engine and hope they landed in the right
 * species — the exact mistake this page exists to prevent, since three of the
 * corpus's organisms are stored under a projected namespace (macaque under human
 * HGNC, hamster and dormouse under mouse MGI). Linking BY THE ID makes that
 * impossible: it resolves to the record the generator actually matched.
 *
 * Falls back to plain text for the 26,658 rows no authority recognizes and for
 * any id that fails geneAuthorityUrl's checks, so an unlinkable row reads as
 * exactly what it is rather than offering a link to nothing.
 */
function AuthorityCell({ authority, authorityId }: {
  authority: NomenclatureAuthority;
  authorityId: string;
}) {
  const href = geneAuthorityUrl(authority, authorityId);
  // The title stays the bare qualified id, as it was before this cell linked
  // anywhere. It is the one thing the cell cannot otherwise show — the visible
  // text is already the authority's name — and it is what the decode tests probe
  // to prove the wire restored the right prefix. The ↗ carries "this is an
  // external link", matching the dataset chips in GeneReport.
  if (!href) return authorityId ? <span title={authorityId}>{authority}</span> : authority;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={authorityId}
      style={{ color: 'var(--accent)', textDecoration: 'none' }}>
      {authority} ↗
    </a>
  );
}

/**
 * A row decorated with everything the per-keystroke path needs precomputed.
 *
 * The table has more than 120,000 rows and filter+sort rerun on every query change, so
 * nothing per-row may allocate or run a regex inside that loop. The haystack
 * deliberately folds in the OTHER names too — aliases, previous symbols and the
 * gene's full name: someone arriving here has usually just failed to find a
 * gene by the name they know, so matching only the stored symbol would
 * reproduce the exact failure that sent them to this page. NUL-joined so a
 * query cannot straddle two adjacent names.
 */
interface IndexedRow {
  row: NomenclatureRow;
  /** All names the row answers to, uppercased once at load. */
  haystack: string;
  /** landingRank, computed once so the default-order comparator is field math. */
  rank: number;
}

interface NomenclatureViewProps {
  onHome: () => void;
  /** Open the cross-dataset gene report for a symbol — "where is this measured?" */
  onSearchGene?: (gene: string) => void;
}

export function NomenclatureView({ onHome, onSearchGene }: NomenclatureViewProps) {
  const [table, setTable] = useState<NomenclatureTable | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<NomenclatureStatus | null>(null);
  const [authorityFilter, setAuthorityFilter] = useState<NomenclatureAuthority | null>(null);
  const { busy: exporting, run: runExport } = useExportAction();

  useEffect(() => {
    let alive = true;
    loadNomenclatureTable().then((t) => {
      if (!alive) return;
      setTable(t);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  /**
   * How informative a row is as a LANDING row, lower first.
   *
   * The obvious default orderings are both bad here, and for the same reason —
   * they surface the corpus's least meaningful identifiers first. Alphabetical
   * opens on the counter artifacts and malformed symbols (`__no_feature`,
   * `__ambiguous`, the `-100` family); by dataset count, the ties at the top are
   * filled by RIKEN clone ids, which are in nearly every mouse study and tell a
   * reader nothing. Either way the page's first screen argues against its own
   * table.
   *
   * So the default order demotes symbols that are placeholders rather than
   * names: anything the authority does not recognize, plus the clone- and
   * predicted-gene id families that are recognized but are still just
   * identifiers. What is left on top is named genes, most widely measured first.
   */
  const landingRank = useCallback((r: NomenclatureRow): number => {
    if (r.status === 'unrecognized' || r.status === 'ambiguous') return 2;
    if (/Rik$/i.test(r.symbol) || /^(Gm|LOC)\d/i.test(r.symbol)) return 1;
    return 0;
  }, []);

  // Once per table load, not per keystroke: the haystack replaces ~300k
  // toUpperCase allocations per recompute, and the precomputed rank keeps the
  // regexes out of the O(n log n) comparator below.
  const indexed = useMemo<IndexedRow[]>(() => {
    if (!table) return [];
    return table.rows.map((row) => ({
      row,
      haystack: [row.symbol, row.currentSymbol, row.geneName, ...row.aliases, ...row.prevSymbols]
        .join('\x00').toUpperCase(),
      rank: landingRank(row),
    }));
  }, [table, landingRank]);

  // Deferred so a keystroke repaints the input immediately and the 120k-row
  // filter+sort runs at deferred priority (the same job GeneSearchBox's 80ms
  // debounce does, in React's own idiom).
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toUpperCase();
    const rows = indexed.filter((e) =>
      (!statusFilter || e.row.status === statusFilter) &&
      (!authorityFilter || e.row.authority === authorityFilter) &&
      (!q || e.haystack.includes(q)));
    // This IS the default order: useSortedRows hands back the array by reference
    // until a header is clicked, so ordering it here is what the reader sees on
    // arrival, and clicking any column still replaces it wholesale.
    rows.sort((a, b) =>
      a.rank - b.rank ||
      b.row.datasetCount - a.row.datasetCount ||
      a.row.symbol.localeCompare(b.row.symbol));
    return rows.map((e) => e.row);
  }, [indexed, deferredQuery, statusFilter, authorityFilter]);

  const sortValue = useCallback((row: NomenclatureRow, key: SortKey) => row[key], []);
  const { sortKey, sortDir, sorted, toggle } = useSortedRows<NomenclatureRow, SortKey>(
    filtered, sortValue, null);

  const shown = sorted.slice(0, PAGE_ROWS);

  // The export carries the FILTERED set, not the page — the row cap is a
  // rendering budget, and silently applying it to a download would hand back 300
  // rows to someone who asked for all 120,000+ of them.
  const exportExcel = useCallback(() => {
    runExport(() => writeWorkbook(
      exportFilename(['hypoexplorer', 'gene_nomenclature'], 'xlsx'),
      [{
        name: 'Nomenclature',
        rows: sorted.map((r) => ({
          Symbol: r.symbol,
          Authority: r.authority,
          Status: STATUS_COPY[r.status].label,
          CurrentSymbol: r.currentSymbol,
          GeneName: r.geneName,
          Aliases: r.aliases.join('|'),
          PreviousSymbols: r.prevSymbols.join('|'),
          AuthorityID: r.authorityId,
          LocusType: r.locusType,
          NDatasets: r.datasetCount,
        })),
      }],
    ));
  }, [sorted, runExport]);

  const chip = (active: boolean): CSSProperties => ({
    padding: '3px 10px', fontSize: 11.5, borderRadius: 12, cursor: 'pointer',
    fontFamily: FONT_SANS, fontWeight: 600,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border-dark)'}`,
    background: active ? 'var(--accent)' : 'var(--bg-panel)',
    color: active ? '#fff' : 'var(--text-muted)',
  });

  return (
    <PageShell
      onHome={onHome}
      breadcrumbs={[{ label: 'Gene nomenclature', current: true }]}
      fill
      mainStyle={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <div style={{ padding: '18px 24px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, fontFamily: FONT_HEADING, color: 'var(--text-primary)', margin: '0 0 6px' }}>
          Gene nomenclature
        </h1>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', fontFamily: FONT_SANS, maxWidth: '78ch', margin: '0 0 10px' }}>
          Check whether a gene symbol is current and find its aliases and previous names.
          HypoExplorer retains the symbols from each source analysis and compares them with
          the relevant nomenclature authority.
        </p>
        <p style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-muted)', fontFamily: FONT_SANS, maxWidth: '78ch', margin: '0 0 12px' }}>
          Mouse symbols are checked against <strong>MGI</strong>, rat symbols against{' '}
          <strong>RGD</strong>, and human symbols against <strong>HGNC</strong>. Native chicken,
          zebrafish, pig and cattle symbols are checked against separate species-specific{' '}
          <strong>NCBI Gene</strong> records, so a shared spelling is never treated as the same
          authority record across species. The macaque tables carry author-projected human
          ortholog symbols and therefore use HGNC. The accepted hamster and dormouse tables
          likewise carry explicit author-provided mouse feature projections and therefore use
          MGI; neither is being presented as a native mouse experiment.{' '}
          <a href={SOURCE_TSV_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
            Download the source table as TSV
          </a>. This page and the Excel export use the same table.
        </p>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search nomenclature"
            placeholder="Search symbol, alias, previous symbol or gene name…"
            style={{
              flex: '0 1 340px', padding: '6px 10px', fontSize: 13, fontFamily: FONT_MONO,
              border: '1px solid var(--border-dark)', borderRadius: 4, color: 'var(--text-primary)',
            }}
          />
          {NOMENCLATURE_AUTHORITIES.map((a) => (
            <button key={a} type="button" style={chip(authorityFilter === a)}
              onClick={() => setAuthorityFilter((f) => (f === a ? null : a))}>
              {a}
            </button>
          ))}
          <span style={{ width: 1, height: 18, background: 'var(--border)' }} />
          {NOMENCLATURE_STATUS.map((s) => (
            <button key={s} type="button" style={chip(statusFilter === s)}
              title={STATUS_COPY[s].blurb}
              onClick={() => setStatusFilter((f) => (f === s ? null : s))}>
              {STATUS_COPY[s].label}
              {table && <span style={{ opacity: 0.75 }}> · {table.tally[s].toLocaleString()}</span>}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <ExportButton
            onClick={exportExcel} busy={exporting} busyLabel="Exporting…" spinnerSize={11}
            disabled={!sorted.length}
            title={`Download all ${sorted.length.toLocaleString()} matching rows as .xlsx`}
            style={{
              fontSize: 12, padding: '5px 12px', border: '1px solid var(--border-dark)',
              borderRadius: 4, background: 'var(--bg-panel)', cursor: 'pointer',
              fontFamily: FONT_SANS, fontWeight: 600, color: 'var(--text-primary)',
            }}
          >
            ↓ Download Excel
          </ExportButton>
        </div>

        {statusFilter && (
          <p style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--text-muted)', fontFamily: FONT_SANS, margin: '10px 0 0', maxWidth: '78ch' }}>
            <strong style={{ color: STATUS_COPY[statusFilter].text }}>{STATUS_COPY[statusFilter].label}:</strong>{' '}
            {STATUS_COPY[statusFilter].blurb}
          </p>
        )}
      </div>

      {/* Results */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60, color: 'var(--text-muted)', fontSize: 13, fontFamily: FONT_SANS }}>
            <Spinner size={14} /> Loading the nomenclature table…
          </div>
        ) : !table ? (
          // The optional table may be absent from a deployment.
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, fontFamily: FONT_SANS }}>
            The nomenclature table is unavailable in this version of HypoExplorer.
          </div>
        ) : (
          <>
            <div style={{ padding: '8px 24px', fontSize: 12, color: 'var(--text-muted)', fontFamily: FONT_SANS }}>
              {sorted.length.toLocaleString()} of {table.rows.length.toLocaleString()} symbols
              {sorted.length > PAGE_ROWS && (
                <> · showing the first {PAGE_ROWS}. Narrow the search or download all matching rows as Excel.</>
              )}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {([
                    ['symbol', 'Symbol in the data'],
                    ['authority', 'Authority'],
                    ['status', 'Status'],
                    ['currentSymbol', 'Current symbol'],
                    ['geneName', 'Gene name'],
                    ['locusType', 'Locus type'],
                    ['datasetCount', 'Datasets'],
                  ] as Array<[SortKey, string]>).map(([key, label]) => (
                    <SortableTh key={key} active={sortKey === key} dir={sortDir}
                      onSort={() => toggle(key)} style={TH} scope="col">
                      {label}
                    </SortableTh>
                  ))}
                  <th scope="col" style={TH}>Also known as</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={`${r.authority}\x00${r.symbol}`} className="hover-row">
                    <td style={{ ...TD_MONO, fontWeight: 600 }}>
                      {onSearchGene ? (
                        <button type="button" onClick={() => onSearchGene(r.symbol)}
                          title={`View ${r.symbol} results across datasets`}
                          style={{ font: 'inherit', color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                          {r.symbol}
                        </button>
                      ) : r.symbol}
                    </td>
                    <td style={TD_MONO}>
                      <AuthorityCell authority={r.authority} authorityId={r.authorityId} />
                    </td>
                    <td style={TD}><StatusPill status={r.status} /></td>
                    <td style={TD_MONO}>{r.currentSymbol || '—'}</td>
                    <td style={{ ...TD, minWidth: 220 }}>{r.geneName || '—'}</td>
                    <td style={{ ...TD, color: 'var(--text-muted)', fontSize: 11.5 }}>{r.locusType || '—'}</td>
                    <td style={{ ...TD_MONO, textAlign: 'right' }}>{r.datasetCount}</td>
                    <td style={{ ...TD, color: 'var(--text-muted)', fontSize: 11.5, minWidth: 200 }}>
                      {otherNames(r).join(', ') || '—'}
                    </td>
                  </tr>
                ))}
                {!shown.length && (
                  <tr>
                    <td colSpan={8} style={{ ...TD, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                      No symbol, alias, previous symbol or gene name matches &quot;{query}&quot; with these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </PageShell>
  );
}
