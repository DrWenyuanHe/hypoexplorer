// Prose primitives for the app's long-form reference pages. The app has no
// markdown renderer, so Methodology, Data Sources and Statistics write their
// documentation directly as JSX and each declared its own inline-styled H2 / P /
// Mono / table cells.
//
// Scope is deliberately honest — this is NOT one prose system for all three:
//   - `Mono` was byte-identical in all three, so all three import it.
//   - `H2` / `P` / `thStyle` / `tdStyle` were identical between MethodologyView
//     and DataSourcesTab; those two adopt them. StatisticsView runs a
//     DELIBERATELY larger scale (H2 at 15/600 with wider margins, P capped at
//     70ch) because it is a full-page reference rather than a tab, so it keeps
//     its own and takes only `Mono` from here.
//   - Variants only one page uses (`Li`, `H3`, `Callout`, the sans reference
//     cell) stay local to that page — hoisting a single-caller style here would
//     make this file look like a design system it is not.

import type { CSSProperties, ReactNode } from 'react';
import { FONT_HEADING, FONT_MONO, FONT_SANS } from '../styles/constants';

/** Section heading for a reference page (Methodology / Data Sources scale). */
export function H2({ children }: { children: ReactNode }) {
  return (
    <h2 style={{
      fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
      fontFamily: FONT_HEADING, margin: '28px 0 10px',
    }}>
      {children}
    </h2>
  );
}

/** Body paragraph. */
export function P({ children }: { children: ReactNode }) {
  return (
    <p style={{
      fontSize: 13, lineHeight: 1.65, color: 'var(--text-primary)',
      fontFamily: FONT_SANS, margin: '0 0 12px',
    }}>
      {children}
    </p>
  );
}

/** Inline monospace span for identifiers, filenames and parameter names. */
export function Mono({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: 'var(--text-mono)' }}>
      {children}
    </span>
  );
}

/** Table header cell. */
export const thStyle: CSSProperties = {
  padding: '6px 10px', fontSize: 11, fontWeight: 600, textAlign: 'left',
  color: 'var(--text-muted)', whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border)', fontFamily: FONT_SANS,
};

/** Table data cell (monospace — these tables hold values, not prose). */
export const tdStyle: CSSProperties = {
  padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)',
  borderBottom: '1px solid var(--border)', fontFamily: FONT_MONO,
};
