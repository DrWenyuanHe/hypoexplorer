// The export-action seam — what an export CLICK does, beside the workbook seam
// (utils/workbook.ts) which owns what an export WRITES.
//
// Every export button in the app repeats the same three mechanics, and each was
// spelled out by hand at every site:
//
//  1. Busy state: flip a flag, hand the promise off, clear the flag a moment
//     after the file lands. Five copies, and one of them (SummaryTable) started
//     its reset timer synchronously instead of chaining the promise — so its
//     "Downloading…" label was a fixed 1 s animation that described nothing.
//  2. The filename: the same forbidden-character class, spelled five times.
//  3. The transport: create an <a>, set href + download, click it. Twice.
//
// The delay is per-site (1000 ms everywhere except the leading-edge view's
// 500 ms), so it is an argument, not a constant.
import { useCallback, useEffect, useRef, useState } from 'react';

interface ExportAction {
  /** True while an export is in flight, and for `settleMs` after it lands. */
  busy: boolean;
  /**
   * Start one export. Fire-and-forget: `busy` clears once the returned promise
   * settles (writeWorkbook never rejects) plus the settle delay. A click while
   * an export is already running is ignored, so the state cannot be started
   * twice by a button that renders no disabled state.
   */
  run: (start: () => void | Promise<void>) => void;
}

/**
 * Busy state for one export button.
 *
 * `settleMs` holds the busy label up briefly AFTER the promise resolves: the
 * browser's own save step follows the resolve, and a label that vanished on the
 * same frame read as if nothing had happened.
 */
export function useExportAction(settleMs = 1000): ExportAction {
  const [busy, setBusy] = useState(false);
  // Mirrors `busy` for the re-entrancy check, which has to read the CURRENT
  // value from inside a stable callback rather than a closed-over render.
  const busyRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  // A settle must not outlive the component that owns it — neither a timer that
  // is already pending, nor one an export still in flight would schedule after
  // the view closed (closing the modal mid-export is the ordinary case).
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const run = useCallback((start: () => void | Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const settle = () => {
      if (!mounted.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        busyRef.current = false;
        setBusy(false);
      }, settleMs);
    };
    // `start()` runs synchronously (the export body is built from render state
    // and must not observe a later frame); only the settle waits on it. Both
    // outcomes settle — a stuck busy button is worse than a silent failure, and
    // reporting failures is lazyExport's job.
    try {
      Promise.resolve(start()).then(settle, settle);
    } catch (err) {
      settle();
      throw err;
    }
  }, [settleMs]);

  return { busy, run };
}

// The characters Windows and macOS reject in a filename. Pathway and gene names
// carry all of them ("Signaling by NOTCH1 t(7;9)", "HLA-DRB1*04").
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|]/g;

/**
 * One export filename: the parts joined with `_`, each stripped of the
 * characters a filesystem would reject, plus the extension.
 *
 * A nullish part stringifies to "undefined" exactly as the template literals
 * this replaces did — the filenames are user-visible artifacts, so this is a
 * byte-for-byte move, not a cleanup.
 */
export function exportFilename(parts: Array<string | undefined>, extension: string): string {
  return `${parts.map((p) => `${p}`.replace(UNSAFE_FILENAME_CHARS, '_')).join('_')}.${extension}`;
}

/**
 * Hand a file to the browser: the anchor dance every non-xlsx export repeats.
 * `href` is a data:/blob: URL the caller has already built — this owns only the
 * delivery, never the content.
 */
export function downloadFile(filename: string, href: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
}
