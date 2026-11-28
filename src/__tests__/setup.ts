import { afterEach } from 'vitest';
import {
  POP_META_FIXTURE, QC_GLOBAL_FIXTURE, HX_MACAQUE_SNRNA_E9_FIXTURE,
} from './fixtures';
import { installRetainedCacheGate } from './retainedAuditCache';
import { _resetListingModeStore } from '../statistics/listingModeStore';

// Logic and data tests run in the Node environment (see vite.config.ts), where
// there is no document to query and nothing to render. Only a jsdom file pays
// for the DOM matchers and Testing Library, which pull in react-dom.
const hasDom = typeof document !== 'undefined';
if (hasDom) await import('@testing-library/jest-dom/vitest');
const testingLibrary = hasDom ? await import('@testing-library/react') : null;

// How long `findBy*` and a bare `waitFor` may wait before calling it a failure.
//
// This is the same argument vite.config.ts makes for raising testTimeout to 15 s,
// applied one layer down. That raise covered the whole-test ceiling but left the
// per-ASSERTION ceiling at testing-library's 1 s default, which nothing here had
// ever set — so a mount that legitimately takes two seconds failed on the
// assertion long before the test ran out of time, and the message named a
// missing button rather than a slow one.
//
// One second stopped being a plausible ceiling when the corpus reached 56
// datasets: the library grid renders every card (no windowing — see TODOS), so
// an App mount costs seconds in jsdom, and vitest runs four files at once, which
// means the wall clock for any one of them is set by whatever else is running.
// Three unrelated tests failed this way in three consecutive full-suite runs on
// identical code, each passing alone: geneModal's lazy recharts chunk,
// sortableHeaderA11y's Circadian scan, appDeepLinks' dataset mount.
//
// It costs nothing when the machine is quiet — every one of these resolves the
// moment the DOM settles — and it is not cover for a hang: testTimeout (15 s)
// still ends a genuinely stuck test, 10 s later.
testingLibrary?.configure({ asyncUtilTimeout: 5000 });

// The URL is application state, and every test file in a worker shares one jsdom
// window — so it has to be reset like any other global.
//
// The router writes the current view into `location.hash` and reads it back on
// mount. Without this, a test that navigated to a dataset would leave that hash
// behind, and the NEXT test's `render(<App initialView="explorer" />)` would boot
// from the previous test's URL: right shell, wrong dataset, and a failure whose
// message ("expected 'GABAergic' to be ''") names nothing to do with the cause.
//
// replaceState rather than `location.hash = ''`: assigning the hash fires a
// `hashchange` on the NEXT tick, which lands in whichever test is running by
// then. This fires nothing.
//
// Unmounted first: unmounting runs the effects React still had pending, and the
// router's URL write is one. Testing Library's own cleanup runs after this hook
// (afterEach hooks run last-registered first), so the write would land after the
// reset and the next test would boot from it.
afterEach(() => {
  testingLibrary?.cleanup();
  if (hasDom) window.history.replaceState(null, '', '/');
  // The listing-mode pick is module state persisted to localStorage; reset it
  // so a test that switched to FDR-only cannot change what the next one lists.
  _resetListingModeStore();
});

// CI declares the gitignored retained audit cache absent; this skips, by name, only
// the tests that read it and only when their inputs are missing (retainedAuditCache.ts).
installRetainedCacheGate();

// Stub the globals that index.html <script> tags normally set in the real app.
// Must run BEFORE any test imports a component that reads these at module scope.
//
// The app is multi-dataset: bundles set dataset-namespaced globals
// (HX_MACAQUE_SNRNA_META, HX_MACAQUE_SNRNA_E9, HX_MACAQUE_SNRNA_QC). index.html no
// longer eager-loads any of them; we seed them here so loaders resolve
// synchronously in tests. These namespaced globals are the bundle-source seam's
// transport — components themselves take metadata as props, never from globals.

// Test-only global seeding goes through a permissive view of globalThis — these
// are runtime stubs for jsdom, not part of the typed app surface.
const g = globalThis as any;

g.window = g.window || g;

// Dataset-namespaced eager globals for the macaque default dataset.
g.HX_MACAQUE_SNRNA_META = POP_META_FIXTURE;
g.HX_MACAQUE_SNRNA_E9 = HX_MACAQUE_SNRNA_E9_FIXTURE;
g.HX_MACAQUE_SNRNA_QC = QC_GLOBAL_FIXTURE;
g.window.HX_MACAQUE_SNRNA_META = POP_META_FIXTURE;
g.window.HX_MACAQUE_SNRNA_E9 = HX_MACAQUE_SNRNA_E9_FIXTURE;
g.window.HX_MACAQUE_SNRNA_QC = QC_GLOBAL_FIXTURE;

g.window.__showApp = () => {};

// Dataset Tracker catalog — the real app lazy-injects /tracker/catalog.js to set
// this global; seed a small fixture so the tracker view renders synchronously in
// tests (no script injection / no dev API needed). Covers: an n>=3 row, an n<3 row
// (hidden by the default filter), and a "same paper" (related) row.
g.window.HX_TRACKER_CATALOG = {
  count: 3,
  integratedCount: 0,
  relatedCount: 1,
  generatedFrom: 'fixture',
  explorer: [
    { id: 'macaque_snrna', name: 'Macaque hypothalamus (snRNA-seq)', organism: 'Macaca fascicularis', modality: 'snRNA-seq', geo: '', doi: '10.1016/j.cmet.2024.01.003', accessions: ['CNP0003785'] },
    { id: 'mouse_hypo_hfd_gse220533', name: 'Mouse whole hypothalamus (bulk RNA-seq)', organism: 'Mus musculus', modality: 'bulk RNA-seq', geo: 'GSE220533', doi: '', accessions: ['GSE220533', 'PRJNA910145'] },
    { id: 'mouse_arc_hfd_gse225038', name: 'Mouse arcuate nucleus (bulk RNA-seq)', organism: 'Mus musculus', modality: 'bulk RNA-seq', geo: 'GSE225038', doi: '', accessions: ['GSE225038', 'PRJNA933607'] },
  ],
  rows: [
    { acc: 'GSE900001', title: 'Mouse hypothalamus HFD bulk', species: 'Mus musculus', region: 'Whole hypothalamus', modality: 'bulk RNA-seq', platform: '', phenotype: 'HFD vs chow', design: 'chow vs HFD', n: '12', pass: 1, searchTag: 'pass1', method: '', repoUrl: 'https://example.org/GSE900001', evidenceUrl: '', links: { doi: '10.1/x' }, alsoAs: '', correctionNotes: '', score: { fit: 80, rec: 'strong', tier: 1 }, feas: { tier: 'drop-in', pipeline: 'bulk edgeR', access: 'open', raw_present: 'yes', processed_matrix: 'yes', fastq_sra: 'yes', file_formats: '', blockers: '' }, nadeq: { min: 6, perGroup: '6 vs 6', contrast: 'HFD vs chow' }, match: null, integrated: false, related: false },
    { acc: 'GSE900002', title: 'Atlas n<3', species: 'Mus musculus', region: 'Arcuate', modality: 'snRNA-seq', platform: '', phenotype: 'reference', design: 'atlas', n: '2', pass: 1, searchTag: 'pass1', method: '', repoUrl: '', evidenceUrl: '', links: {}, alsoAs: '', correctionNotes: '', score: null, feas: { tier: 'blocked', pipeline: '', access: 'open', raw_present: 'no', processed_matrix: 'no', fastq_sra: 'no', file_formats: '', blockers: 'atlas' }, nadeq: { min: 1, perGroup: 'n=1', contrast: 'none' }, match: null, integrated: false, related: false },
    { acc: 'GSE224716', title: 'Klf4 knockdown GT1-7', species: 'Mus musculus', region: 'GT1-7 cell line', modality: 'bulk RNA-seq', platform: '', phenotype: 'Klf4 KD', design: 'siRNA vs scramble', n: '12', pass: 1, searchTag: 'reproduction', method: '', repoUrl: 'https://example.org/GSE224716', evidenceUrl: '', links: { pmid: '38145289' }, alsoAs: '', correctionNotes: '', score: null, feas: { tier: 'modified-pipeline', pipeline: 'bulk edgeR', access: 'open', raw_present: 'yes', processed_matrix: 'no', fastq_sra: 'yes', file_formats: '', blockers: '' }, nadeq: { min: 4, perGroup: '4 vs 4', contrast: 'KD vs scramble' }, match: { tier: 'publication', id: 'mouse_arc_hfd_gse225038', name: 'Mouse arcuate nucleus (bulk RNA-seq)', via: 'PMID 38145289' }, integrated: false, related: true },
  ],
};

// jsdom serves nothing: it loads no subresources, and no test here stands up an
// HTTP server. The bundle-source seam's production transport tries fetch() first
// (that is how it counts bytes for the loading bar) and falls back to a <script>
// tag when the fetch does not land — so leaving the real fetch in place would
// have every loader test open a socket to a port nobody is listening on, and
// make the fallback's timing depend on how fast that refusal comes back.
// Rejecting immediately gives the same fallback, hermetically. A test that wants
// the STREAMING path mocks fetch itself (see bundleSource.test.ts).
if (!(g.fetch as any)?.__stubbed) {
  const stub: any = () => Promise.reject(new TypeError('fetch is stubbed out in tests'));
  stub.__stubbed = true;
  g.fetch = stub;
  if (g.window) g.window.fetch = stub;
}

// jsdom doesn't ship ResizeObserver; VolcanoPlot uses one.
if (!g.ResizeObserver) {
  g.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom has HTMLDialogElement but none of its behaviour: no showModal(), no
// close(), no `open` property and no close request on Escape. Modal and
// ConfirmDialog are native modal dialogs, so this stands in for the parts of
// the browser they rely on, close enough to test their wiring:
// - showModal() marks the dialog open and remembers what had focus;
// - close() clears it, focuses that element again if it is still in the
//   document, and fires `close` (synchronously; browsers queue it);
// - an Escape keydown no listener cancelled, seen at window in the bubble
//   phase (after every document listener), is a close request to the topmost
//   modal: `cancel` first, and close() unless that was cancelled.
// It leaves `closedBy` undefined, as Safari does, so Modal's backdrop fallback
// is the path these tests exercise. Inertness, the top layer and the focus trap
// are the browser's and are not modelled.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  const modals: HTMLDialogElement[] = [];
  const opener = new WeakMap<HTMLDialogElement, Element | null>();
  const proto = HTMLDialogElement.prototype as any;
  Object.defineProperty(proto, 'open', {
    configurable: true,
    get(this: HTMLDialogElement) { return this.hasAttribute('open'); },
    set(this: HTMLDialogElement, value: boolean) { this.toggleAttribute('open', Boolean(value)); },
  });
  proto.show = function show(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.showModal = function showModal(this: HTMLDialogElement) {
    if (this.open) throw new DOMException('The dialog is already open.', 'InvalidStateError');
    if (!this.isConnected) throw new DOMException('The dialog is not connected.', 'InvalidStateError');
    opener.set(this, document.activeElement);
    this.setAttribute('open', '');
    modals.push(this);
  };
  proto.close = function close(this: HTMLDialogElement) {
    if (!this.open) return;
    this.removeAttribute('open');
    const at = modals.indexOf(this);
    if (at >= 0) modals.splice(at, 1);
    const previous = opener.get(this);
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    this.dispatchEvent(new Event('close'));
  };
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const open = modals.filter((d) => d.isConnected);
    const top = open[open.length - 1];
    if (top?.dispatchEvent(new Event('cancel', { cancelable: true }))) top.close();
  });
}

// jsdom doesn't implement HTMLCanvasElement.getContext('2d').
// VolcanoPlot now renders its point cloud on canvas; no-op stub is fine for tests
// since we verify point counts via gene-count text, not by inspecting pixels.
if (typeof HTMLCanvasElement !== 'undefined' && !(HTMLCanvasElement.prototype.getContext as any).__stubbed) {
  const stub: any = () => null;
  stub.__stubbed = true;
  HTMLCanvasElement.prototype.getContext = stub;
}

// Silence html2canvas / XLSX file-download paths in tests.
if (!globalThis.URL.createObjectURL) {
  globalThis.URL.createObjectURL = () => 'blob:test';
}
if (!globalThis.URL.revokeObjectURL) {
  globalThis.URL.revokeObjectURL = () => {};
}

// jsdom prints "Error: Not implemented: navigation" whenever an <a> element
// with href + download is clicked (which is how CSV/XLSX export paths trigger
// downloads). Skip the navigation attempt for download anchors — the test
// only needs to verify the click handler doesn't throw.
if (
  typeof HTMLAnchorElement !== 'undefined' &&
  !(HTMLAnchorElement.prototype.click as any).__stubbed
) {
  const origClick = HTMLAnchorElement.prototype.click;
  const stub: any = function (this: HTMLAnchorElement) {
    if (this.hasAttribute('download')) return;
    return origClick.call(this);
  };
  stub.__stubbed = true;
  HTMLAnchorElement.prototype.click = stub;
}
