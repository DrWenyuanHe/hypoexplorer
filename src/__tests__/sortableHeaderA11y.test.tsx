import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { SummaryTable } from '../gene-explorer/SummaryTable';
import { ContrastMatrix } from '../gene-explorer/ContrastMatrix';
import { LeadingEdgeGenesView } from '../pathway-explorer/LeadingEdgeGenesView';
import { PathwayExplorerTab } from '../pathway-explorer/PathwayExplorerTab';
import { CircadianTab } from '../circadian/CircadianTab';
import { QCTab } from '../qc/QCTab';
import { buildPopData } from '../data/buildPopData';
import { defineDataset } from '../data/datasets';
import { _resetBundleCache, _setBundleTransport, type BundleOutcome } from '../data/bundleSource';
import { makePopData, MACAQUE_DATASET, MACAQUE_CONTRAST, POP_E9_FIXTURE } from './fixtures';
import { usePathwayView } from '../explorer/explorerSession';
import type {
  DatasetMeta, GeneDERecord, PathwayRecordWithDb, ResolvedContrast, TimeSeriesBundle,
} from '../types';

// The sortable tables used to hang their sort on a bare `<th onClick>` with
// `cursor: 'pointer'`. That is a mouse-only affordance: a <th> takes no focus
// and exposes no role, so a keyboard user could not reach the sort at all and a
// screen reader had nothing to announce — neither the control nor which column
// the table was ordered by.
//
// What these pin is the pair that fixes it, in every table that sorts: the
// ACTION on a real <button> (focusable, and natively activated by Enter and
// Space), and the STATE in `aria-sort` on the cell. The arrow stays out of the
// button's accessible name — it is the visual echo of `aria-sort`, not a second
// source of truth.
//
// Six tables, and they do not all sort alike — which is the point of driving
// them from one table of cases. Three open already sorted and one opens
// unsorted; the Pathway Explorer SELECTS a sort rather than toggling one, so a
// second click on the active header does not flip it; two mix sortable columns
// with plain ones, and a plain header must stay a plain header — no button
// promising a sort that does not exist, no `aria-sort` claiming one.
//
// Each table's own sorting semantics live in its own file (contrastMatrix,
// sortableRows, pathwayExplorer); they are re-rendered here because the
// guarantee is that all six agree on the header contract.

const noop = () => {};

/** The <th> whose label (arrow stripped) is `label`. */
const headerCell = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('th')].find(
    (th) => (th.textContent ?? '').replace(/[↑↓\s]+$/, '') === label,
  ) as HTMLTableCellElement;

/** The one table in a multi-table view carrying `header`. */
const tableWith = (root: HTMLElement, header: string) =>
  [...root.querySelectorAll('table')].find(
    (t) => headerCell(t, header) !== undefined,
  ) as HTMLTableElement;

/** Row identity in rendered order, read from each body row's `cell`. */
const rowOrder = (root: HTMLElement, cell = 'td:first-child') =>
  [...root.querySelectorAll(`tbody tr ${cell}`)].map((td) => (td.textContent ?? '').trim());

// ── Fixtures ────────────────────────────────────────────────────────────────

const SUMMARY_DE: GeneDERecord[] = [
  // logFC deliberately disagrees with gene-name order, so a sort that ran and a
  // sort that never ran are distinguishable.
  { gene: 'POMC', logFC: -0.8, PValue: 0.001, FDR: 0.01 },
  { gene: 'AGRP', logFC: 1.5, PValue: 0.04, FDR: 0.2 },
];

const LE_POP = buildPopData(POP_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST)!;
const LE_PATHWAY: PathwayRecordWithDb = {
  db: 'GO_BP',
  pathway: 'GOBP_HEADER_FIXTURE',
  pval: 0.01, padj: 0.05, NES: 1.8, size: 20,
  leadingEdge: ['POMC', 'IP6K1', 'TBX3'],
};

const C_ADJ: ResolvedContrast = {
  id: 'hfd_vs_chow_p0',
  baseline: { key: 'chow_p0', label: 'Chow · P0', color: '#37b' },
  caseGroup: { key: 'hfd_p0', label: 'HFD · P0', color: '#b43' },
  supportsPathways: true,
  label: 'Maternal HFD vs chow at P0',
};
const C_P21: ResolvedContrast = {
  id: 'hfd_vs_chow_p21',
  baseline: { key: 'chow_p21', label: 'Chow P21', color: '#255' },
  caseGroup: { key: 'hfd_p21', label: 'HFD P21', color: '#8a2' },
  supportsPathways: true,
  label: 'Maternal HFD vs chow at P21',
};
const MATRIX_SLICES = [
  {
    contrast: C_ADJ,
    popData: makePopData({
      de: [
        { gene: 'Timp1', logFC: 0.12, PValue: 0.5, FDR: 0.9 },
        { gene: 'Sirt2', logFC: -0.1, PValue: 0.6, FDR: 0.95 },
      ],
      contrast: C_ADJ,
    }),
  },
  {
    contrast: C_P21,
    popData: makePopData({
      de: [
        { gene: 'Timp1', logFC: 1.41, PValue: 0.0002, FDR: 0.01 },
        { gene: 'Sirt2', logFC: -0.83, PValue: 0.0008, FDR: 0.02 },
      ],
      contrast: C_P21,
    }),
  },
];

// QCTab's Sizes table. Every population carries a `minCells`, so the descending
// pass is a clean reverse of the ascending one — the null-last rule the numeric
// comparator also has is sortableRows.test.tsx's subject, not this file's.
const QC_META = {
  populations: ['e9', 'i23', 'e33'],
  labels: { e9: 'Beta', i23: 'alpha', e33: 'Gamma' },
  qcFlags: {
    e9: { is3v3: true, nNormal: 3, nObese: 3, minCells: 5 },
    i23: { is3v3: true, nNormal: 3, nObese: 3, minCells: 9 },
    e33: { is3v3: true, nNormal: 3, nObese: 3, minCells: 1 },
  },
  qaReportFilenames: {},
} as unknown as DatasetMeta;
const EMPTY_QC = { runStatus: [], deSummary: [], fgseaSummary: [], composition: {} };

// CircadianTab's results table. One arm at six distinct timepoints clears the
// rhythm tests' minimums (4 observations over 3 timepoints), and the gene names
// are deliberately not in insertion order so an alphabetical sort is visible.
const CIRCADIAN_BUNDLE: TimeSeriesBundle = {
  meta: {
    trackId: 'scn',
    label: 'Header fixture track',
    cycleHours: 24,
    timeUnit: 'CT',
    expressionUnit: 'CPM',
    arms: [{ key: 'control', label: 'Control', color: '#3775BA' }],
    samples: [0, 4, 8, 12, 16, 20].map((time) => ({
      id: `control_${time}`, arm: 'control', time, replicate: 1,
    })),
    timepoints: [0, 4, 8, 12, 16, 20],
    nGenes: 3,
  },
  values: {
    Zeta: [1, 5, 9, 9, 5, 1],
    Alpha: [4, 3, 5, 2, 6, 1],
    Mu: [2, 4, 6, 8, 10, 12],
  },
};

const CIRCADIAN_DATASET = defineDataset({
  id: 'header_ts',
  // Pinned, like every other dataset fixture: the default reads
  // VITE_BUNDLE_BASE_URL, which would couple this file to ambient build config.
  bundleBaseUrl: '',
  category: 'Circadian',
  name: 'Header fixture dataset',
  organism: 'Mus musculus',
  modality: 'bulk RNA-seq',
  region: 'Suprachiasmatic nucleus',
  perturbation: 'Diet & obesity',
  preparation: 'Bulk tissue',
  featureType: 'gene',
  featureLabel: 'Gene',
  supportsPathways: false,
  citation: 'test',
  isDefault: false,
  defaultTrack: 'scn',
  trackCategoryOrder: ['Tissue'],
  groups: [
    { key: 'control', label: 'Control', color: '#3775BA' },
    { key: 'case', label: 'Treated', color: '#B64342' },
  ],
  contrasts: [{ id: 'c', baseline: 'control', case: 'case', isDefault: true }],
  timeSeries: { tracks: ['scn'], cycleHours: 24, timeUnit: 'CT', design: 'test design' },
});

// PathwayExplorerTab is controlled (search/DB/FDR/sort live in App), so the
// harness holds the state the tab reads back.
function PathwayHarness() {
  const pathway = usePathwayView<PathwayRecordWithDb>();
  return <PathwayExplorerTab pathway={pathway} popData={LE_POP} />;
}

/**
 * Per-test budget for a case whose table only exists after real async work.
 *
 * Mirrors LIBRARY_SWITCH_TIMEOUT_MS in app.dataset.test.tsx / app.contrast.test.tsx,
 * and for the same reason: a waitFor timeout is a HANG DETECTOR, not a
 * performance budget. The Circadian case loads a bundle and runs a
 * whole-transcriptome rhythm scan before there is a single row, which is
 * genuinely seconds of work — and vitest runs four files at once, so the wall
 * clock for it is set by whatever else is running. An 8 s ceiling was not
 * enough: this file passed alone in 3.2 s and failed here in a 92 s full-suite
 * run, on identical code, with 0 rows rendered.
 *
 * Costs nothing when the machine is quiet — waitFor resolves the moment the
 * rows appear — and only the cases that declare it pay the longer ceiling, so a
 * real hang in any other table still fails at the global 15 s testTimeout.
 */
const SCAN_TIMEOUT_MS = 30000;

interface TableCase {
  name: string;
  ui: () => ReactElement;
  /** Run before each render, and undone after — for a case that stubs a loader. */
  setup?: () => void;
  teardown?: () => void;
  /** Longer per-test ceiling for a case doing real async work. */
  timeoutMs?: number;
  /** Wait for a table that populates asynchronously. */
  settle?: (container: HTMLElement) => Promise<void>;
  /** Narrow a multi-table view to the one table under test. */
  scope?: (container: HTMLElement) => HTMLElement;
  /** The body cell identifying a row, when it is not the first one. */
  rowCell?: string;
  /** Column the table is sorted by before anything is touched — null when it opens unsorted. */
  sortedColumn: string | null;
  /** Direction of that opening sort. */
  sortedDir?: 'ascending' | 'descending';
  /**
   * Row order under that default sort. Omitted by a table whose opening order is
   * computed rather than declared (the Circadian scan's p-values), where pinning
   * it here would be testing the analysis, not the header.
   */
  sortedOrder?: string[];
  /** A second sortable column, and where it puts the rows once activated. */
  column: string;
  columnOrder: string[];
  /** Direction that second column takes on its FIRST activation. */
  firstDir: 'ascending' | 'descending';
  /** Every sortable column of the table. */
  columns: string[];
  /** Headers that do not sort: a plain <th>, no button, no aria-sort. */
  plainColumns?: string[];
  /**
   * False for a table that SELECTS a sort rather than toggling one: the Pathway
   * Explorer's headers pick one of four fixed comparators (the same pick its
   * "By Magnitude" / "Alphabetical" buttons make), so clicking the active header
   * re-selects it rather than reversing it.
   */
  flips?: boolean;
}

const CASES: TableCase[] = [
  {
    name: 'SummaryTable',
    ui: () => (
      <SummaryTable selectedGenes={['POMC', 'AGRP']} onRemove={noop}
        popData={makePopData({ de: SUMMARY_DE })} />
    ),
    sortedColumn: 'Gene', sortedOrder: ['AGRP', 'POMC'],
    column: 'logFC', columnOrder: ['POMC', 'AGRP'], firstDir: 'ascending',
    columns: ['Gene', 'logFC', 'P value', 'FDR'],
  },
  {
    name: 'LeadingEdgeGenesView',
    ui: () => <LeadingEdgeGenesView pathway={LE_PATHWAY} popData={LE_POP} />,
    sortedColumn: 'P-value', sortedOrder: ['POMC', 'TBX3', 'IP6K1'],
    column: 'logFC', columnOrder: ['TBX3', 'IP6K1', 'POMC'], firstDir: 'ascending',
    columns: ['Gene', 'logFC', 'P-value', 'FDR', 'Sig'],
  },
  {
    name: 'ContrastMatrix',
    ui: () => (
      <ContrastMatrix selectedGenes={['Timp1', 'Sirt2']} slices={MATRIX_SLICES} onRemove={noop} />
    ),
    sortedColumn: 'Gene', sortedOrder: ['Sirt2', 'Timp1'],
    // A contrast column opens DESCENDING — largest effect first is the question
    // that column exists to answer.
    column: 'Maternal HFD vs chow at P21', columnOrder: ['Timp1', 'Sirt2'], firstDir: 'descending',
    columns: ['Gene', 'Maternal HFD vs chow at P0', 'Maternal HFD vs chow at P21'],
  },
  {
    name: 'QCTab (SortableTable)',
    ui: () => <QCTab onSelectTrack={noop} qcData={EMPTY_QC} meta={QC_META} />,
    // QC renders a table per section; the Sizes one is the subject.
    scope: (container) => tableWith(container, 'Min cells'),
    // It opens on no sort at all — source order, and NO column claiming one.
    sortedColumn: null, sortedOrder: ['e9', 'i23', 'e33'],
    column: 'Min cells', columnOrder: ['e33', 'e9', 'i23'], firstDir: 'ascending',
    columns: ['Population', 'Label', 'n Baseline', 'n Case', 'Design', 'Min cells'],
    plainColumns: ['Replicate samples'],
  },
  {
    name: 'CircadianTab',
    ui: () => <CircadianTab dataset={CIRCADIAN_DATASET} trackId="scn" />,
    setup: () => _setBundleTransport(
      () => Promise.resolve<BundleOutcome>({ status: 'ok', value: CIRCADIAN_BUNDLE }),
    ),
    teardown: () => { _setBundleTransport(null); _resetBundleCache(); },
    // The bundle loads and the whole-transcriptome scan runs before there is a
    // table at all — two awaited hops and a chunk yield. waitFor's 1 s default
    // is not a budget for real async work on a machine running four test files
    // at once. Kept just under SCAN_TIMEOUT_MS so waitFor's own message ("0 rows,
    // not 3") wins over a bare test timeout, which says nothing about what stalled.
    timeoutMs: SCAN_TIMEOUT_MS,
    settle: (container) => waitFor(
      () => { expect(container.querySelectorAll('tbody tr')).toHaveLength(3); },
      { timeout: SCAN_TIMEOUT_MS - 5000 },
    ),
    sortedColumn: 'p',
    column: 'Gene', columnOrder: ['Alpha', 'Mu', 'Zeta'], firstDir: 'ascending',
    columns: ['Gene', 'p', 'q', 'peak (CT)', 'amplitude', 'mesor', '|τ|', 'n'],
  },
  {
    name: 'PathwayExplorerTab',
    ui: () => <PathwayHarness />,
    // The first cell is the DB pill; the pathway name identifies the row.
    rowCell: 'td:nth-child(2)',
    sortedColumn: 'NES', sortedDir: 'descending',
    sortedOrder: [
      'GOBP_NEURON_DIFFERENTIATION', 'HALLMARK_INFLAMMATORY_RESPONSE',
      'KEGG_INSULIN_SIGNALING', 'REACTOME_NEURON_DEVELOPMENT',
      'HALLMARK_APOPTOSIS', 'KEGG_MAPK_SIGNALING',
      'GOBP_APOPTOSIS', 'REACTOME_CELL_CYCLE',
    ],
    column: 'Pathway',
    columnOrder: [
      'GOBP_APOPTOSIS', 'GOBP_NEURON_DIFFERENTIATION',
      'HALLMARK_APOPTOSIS', 'HALLMARK_INFLAMMATORY_RESPONSE',
      'KEGG_INSULIN_SIGNALING', 'KEGG_MAPK_SIGNALING',
      'REACTOME_CELL_CYCLE', 'REACTOME_NEURON_DEVELOPMENT',
    ],
    firstDir: 'ascending', flips: false,
    columns: ['Pathway', 'NES', 'FDR', 'p'],
    plainColumns: ['DB', 'Size'],
  },
];

const mount = async (c: TableCase) => {
  const { container } = render(c.ui());
  if (c.settle) await c.settle(container);
  return c.scope ? c.scope(container) : container;
};

describe.each(CASES)('$name — sortable column headers', (c) => {
  beforeEach(() => c.setup?.());
  afterEach(() => c.teardown?.());

  it('puts the sort on a focusable button, named without the arrow', async () => {
    const root = await mount(c);
    for (const label of c.columns) {
      const control = within(headerCell(root, label)).getByRole('button', { name: label });
      expect(control.tagName).toBe('BUTTON');
      // type="button" — inside a <form> a bare button would submit it.
      expect(control.getAttribute('type')).toBe('button');
      // Reachable: a <th> could never hold focus, which is the whole bug.
      (control as HTMLButtonElement).focus();
      expect(document.activeElement).toBe(control);
    }
  }, c.timeoutMs);

  // A column that does not sort must not LOOK like one that does: no control to
  // tab to, and nothing for a screen reader to report as sortable.
  const itPlain = c.plainColumns?.length ? it : it.skip;
  itPlain('leaves a non-sortable header a plain cell', async () => {
    const root = await mount(c);
    for (const label of c.plainColumns ?? []) {
      const cell = headerCell(root, label);
      expect(within(cell).queryByRole('button')).toBeNull();
      expect(cell.hasAttribute('aria-sort')).toBe(false);
    }
  }, c.timeoutMs);

  it('reports the current sort through aria-sort, not only through the arrow', async () => {
    const root = await mount(c);
    if (c.sortedColumn) {
      expect(headerCell(root, c.sortedColumn).getAttribute('aria-sort'))
        .toBe(c.sortedDir ?? 'ascending');
    }
    for (const label of c.columns.filter((l) => l !== c.sortedColumn)) {
      expect(headerCell(root, label).getAttribute('aria-sort')).toBe('none');
    }
  }, c.timeoutMs);

  it('sorts when the focused control is activated, and moves aria-sort with it', async () => {
    const root = await mount(c);
    if (c.sortedOrder) expect(rowOrder(root, c.rowCell)).toEqual(c.sortedOrder);

    // Focus, then activate. jsdom does not synthesise a click from Enter/Space
    // the way a browser does for a <button>; what makes that work is the
    // element BEING a native button, which the first test pins. This drives the
    // same activation the browser would, from the focused element.
    const control = within(headerCell(root, c.column)).getByRole('button', { name: c.column });
    (control as HTMLButtonElement).focus();
    fireEvent.click(document.activeElement as HTMLElement);

    expect(rowOrder(root, c.rowCell)).toEqual(c.columnOrder);
    // Focus SURVIVES the sort. It is the same DOM node afterwards, so the next
    // Enter lands on the same column — a header rebuilt on every render would
    // hand a keyboard user exactly one sort and then drop them back to the top
    // of the document.
    expect(document.activeElement).toBe(control);
    expect(headerCell(root, c.column).getAttribute('aria-sort')).toBe(c.firstDir);
    // The column it came from no longer claims a sort.
    if (c.sortedColumn) {
      expect(headerCell(root, c.sortedColumn).getAttribute('aria-sort')).toBe('none');
    }
    // The arrow shows in the cell but never in the accessible name.
    expect(headerCell(root, c.column).textContent).toMatch(/[↑↓]$/);
    expect(within(headerCell(root, c.column)).getByRole('button', { name: c.column })).toBeTruthy();

    fireEvent.click(control);
    if (c.flips === false) {
      // A selecting table re-selects: same comparator, same order, same arrow.
      expect(headerCell(root, c.column).getAttribute('aria-sort')).toBe(c.firstDir);
      expect(rowOrder(root, c.rowCell)).toEqual(c.columnOrder);
    } else {
      // A toggling table flips the direction rather than re-selecting.
      expect(headerCell(root, c.column).getAttribute('aria-sort'))
        .toBe(c.firstDir === 'ascending' ? 'descending' : 'ascending');
      expect(rowOrder(root, c.rowCell)).toEqual([...c.columnOrder].reverse());
    }
  }, c.timeoutMs);
});
