import type { CSSProperties, ReactNode } from 'react';
import { Spinner } from './Spinner';

// The button half of the export-action seam (utils/exportAction.ts owns the busy
// STATE; this owns what the busy state looks like). Nine export buttons each
// hand-wired the same three things — disable while busy, swap the label, and (in
// five of them) put a Spinner in front of it — and the wiring drifted: three
// vocabularies for the busy text and two spinner sizes.
//
// The structure is shared; the WORDS are not. `busyLabel` and the idle children
// are per-site props because the labels are user-visible and this is a
// consolidation of mechanics, not a rewording. Same for `style`: the sites sit
// in a compact toolbar, a modal header and a 10px table strip, so their padding
// and type sizes genuinely differ — the component takes the style rather than
// imposing one. The only layout it does own is the inline-flex row a Spinner
// needs beside its label, applied when (and only when) there IS a spinner, and
// still overridable by `style`.
const SPINNER_ROW: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6 };

interface ExportButtonProps {
  /** Start the export — normally the `run` half of `useExportAction`. */
  onClick: () => void;
  /** The seam's `busy`: disables the button and swaps in `busyLabel`. */
  busy: boolean;
  /** Visible text while busy, verbatim per site. */
  busyLabel: string;
  /** Spinner ring size, in px. Omit for a text-only busy label. */
  spinnerSize?: number;
  /** The idle label. */
  children: ReactNode;
  /** An additional reason to disable, beyond `busy` (nothing to export yet). */
  disabled?: boolean;
  style?: CSSProperties;
  title?: string;
  /** Set when the button opens a format menu rather than exporting outright. */
  'aria-haspopup'?: 'menu';
  'aria-expanded'?: boolean;
}

export function ExportButton({
  onClick, busy, busyLabel, spinnerSize, children, disabled = false, style, title,
  'aria-haspopup': ariaHasPopup, 'aria-expanded': ariaExpanded,
}: ExportButtonProps) {
  return (
    <button type="button" onClick={onClick} disabled={busy || disabled} title={title}
      aria-haspopup={ariaHasPopup} aria-expanded={ariaExpanded}
      style={spinnerSize == null ? style : { ...SPINNER_ROW, ...style }}>
      {busy ? <>{spinnerSize != null && <Spinner size={spinnerSize} />}{busyLabel}</> : children}
    </button>
  );
}
