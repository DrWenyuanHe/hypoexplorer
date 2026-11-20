// Lazy loaders for the heavyweight, export-only code: two libraries and,
// further down, the internal QC ledger that export provenance records.
//
// Why this file exists: `xlsx` (276 KB) and `html2canvas` (198 KB) are reached
// ONLY from export click handlers — "Export Excel", "Save PNG". Imported
// statically they were pulled into the eager bundle graph and `modulepreload`ed
// on every visit, so 474 KB of parser-and-compile work was charged to everyone,
// including the majority who never export anything and the visitors who never
// leave the landing hub.
//
// Routed through a dynamic import() they become their own chunks, fetched the
// first time someone actually clicks Export. The extra latency lands on a click
// that already writes a file to disk, where a few hundred ms is invisible; the
// browser also caches the chunk, so only the first export in a session pays.
//
// Keep call sites going through THESE helpers rather than writing a bare
// import('xlsx') inline: a single import specifier per package is what lets
// Rollup emit one shared chunk instead of one per call site (every XLSX write
// flows through withXLSX: writeWorkbook in utils/workbook.ts for row-object
// sheets, and circadianExport.ts directly for its dense whole-transcriptome
// workbook).
//
// The matching half of this contract lives in vite.config.ts: manualChunks must
// give these packages their own chunk names. A catch-all `node_modules ->
// 'vendor'` rule silently defeats the split by forcing them back into the eager
// chunk, and nothing would fail — the app would just quietly get slow again.

import type { QualityAssessment } from '../data/qualityChecks';

/** The `xlsx` module namespace (`XLSX.utils`, `XLSX.writeFile`, …). */
export function loadXLSX() {
  return import('xlsx');
}

/** The `html2canvas` default export — call as `html2canvas(el, opts)`. */
export function loadHtml2Canvas() {
  return import('html2canvas').then((m) => m.default);
}

// A dynamic import CAN fail where a static one could not: the user may be
// offline, or the deploy may have rotated the hashed chunk filename out from
// under a long-open tab. Static imports made that impossible, so none of the
// export handlers had any error handling — and an async click handler that
// rejects surfaces as an unhandled promise rejection (a console error, nothing
// the user sees, and in some hosts a crash report).
//
// Route every export through this so the failure is contained and visible.
function reportExportFailure(err: unknown): void {
  console.error('[export] failed to load the export library', err);
  if (typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert('The export tools could not be loaded. Check your connection and try again — reloading the page will also fix it if the app was just updated.');
  }
}

/**
 * Run an export with the `xlsx` module, loading it on first use.
 *
 * Takes the body as a callback rather than returning the module so that the
 * caller stays a plain (non-async) click handler: the returned promise NEVER
 * rejects, so there is no unhandled rejection to leak whether the chunk fails
 * to load or the export body itself throws.
 */
export async function withXLSX(
  run: (XLSX: typeof import('xlsx')) => void | Promise<void>,
): Promise<void> {
  try {
    await run(await loadXLSX());
  } catch (err) {
    reportExportFailure(err);
  }
}

/** The html2canvas analog of withXLSX. */
export async function withHtml2Canvas(
  run: (html2canvas: Awaited<ReturnType<typeof loadHtml2Canvas>>) => void | Promise<void>,
): Promise<void> {
  try {
    await run(await loadHtml2Canvas());
  } catch (err) {
    reportExportFailure(err);
  }
}

// ── The internal QC ledger, for export provenance ───────────────────────────
//
// Every exported file records the retained processing and replication evidence
// of its dataset and contrast (utils/exportProvenance.ts, `evidence`). That
// evidence lives in the internal QC ledger, a ~3.9 MB chunk. Imported
// statically by exportProvenance.ts it was downloaded and evaluated by every
// explorer tab, although a tab only needs it at the moment a file is saved.
// It now loads on the first export, like xlsx.
//
// The accessor below fails closed: building a provenance snapshot before the
// ledger has loaded throws instead of writing a file whose evidence is silently
// missing. Every export therefore runs inside withExportEvidence (or awaits
// loadExportEvidence() first). The quality views (badges, library, QC tab,
// verification) still import the ledger statically, because they render it.

type EvidenceLookup = (datasetId: string, contrastId?: string) => QualityAssessment | undefined;

let evidenceLookup: EvidenceLookup | null = null;
let evidencePending: Promise<void> | null = null;

/** Load the internal QC ledger once. A failed download is retried by the next call. */
export function loadExportEvidence(): Promise<void> {
  if (evidenceLookup) return Promise.resolve();
  if (!evidencePending) {
    evidencePending = import('../data/internalQc').then(
      (module) => { evidenceLookup = module.getInternalQc; },
      (err: unknown) => { evidencePending = null; throw err; },
    );
  }
  return evidencePending;
}

/**
 * The internal QC assessment of one dataset contrast, for an export snapshot.
 * Throws when the ledger has not been loaded: run the export through
 * withExportEvidence.
 */
export function exportEvidence(datasetId: string, contrastId: string): QualityAssessment | undefined {
  if (!evidenceLookup) {
    throw new Error('Export evidence is not loaded. Run the export through withExportEvidence() so the file records its QC evidence.');
  }
  return evidenceLookup(datasetId, contrastId);
}

/**
 * Run an export once the internal QC ledger is loaded. Like withXLSX, the
 * returned promise never rejects: a failed download or a throwing body is
 * reported to the user and logged. The body receives nothing; it builds its
 * provenance with exportProvenance() as usual.
 *
 * Once the ledger is loaded the body runs synchronously, inside the click, as
 * every export body did before the ledger became lazy (see useExportAction:
 * the body is built from render state). Only a session's first export waits
 * for the download.
 */
export function withExportEvidence(run: () => void | Promise<void>): Promise<void> {
  const contained = (body: () => void | Promise<void>): Promise<void> => {
    try {
      return Promise.resolve(body()).catch(reportExportFailure);
    } catch (err) {
      reportExportFailure(err);
      return Promise.resolve();
    }
  };
  if (evidenceLookup) return contained(run);
  return loadExportEvidence().then(() => contained(run), reportExportFailure);
}
