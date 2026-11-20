// Prose primitives for the app's long-form reference pages. The app has no
// markdown renderer, so Methods & statistics (MethodologyView) writes its
// documentation directly as JSX with these H2 / P / Mono / table cells.
//
// Variants only one page uses (`Li`, `H3`, `Callout`) stay local to that page:
// hoisting a single-caller style here would make this file look like a design
// system it is not.

import type { CSSProperties, ReactNode } from 'react';
import { FONT_HEADING, FONT_MONO, FONT_SANS } from '../styles/constants';

/** Section heading for a reference page. */
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
