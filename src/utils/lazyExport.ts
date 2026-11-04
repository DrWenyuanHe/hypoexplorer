// Lazy loaders for the two heavyweight, export-only libraries.
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
// now flows through writeWorkbook in utils/workbook.ts, the one withXLSX
// consumer).
//
// The matching half of this contract lives in vite.config.ts: manualChunks must
// give these packages their own chunk names. A catch-all `node_modules ->
// 'vendor'` rule silently defeats the split by forcing them back into the eager
// chunk, and nothing would fail — the app would just quietly get slow again.

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
