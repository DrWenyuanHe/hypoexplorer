import type { CSSProperties } from 'react';

// The app's monospace stack — declared once; page-level views import it instead
// of re-declaring a local FONT_MONO. `ui-monospace` sits between the webfonts and
// the generic keyword so a client that never loads Geist Mono or IBM Plex Mono
// falls back to the platform's own UI monospace (SF Mono, Cascadia) rather than a
// generic default; the ~40 inline literals this replaced all omitted it, against
// DESIGN.md. It stays a literal list, not var(--font-mono), because SVG text in
// exported figures cannot resolve CSS variables.
export const FONT_MONO = 'Geist Mono, IBM Plex Mono, ui-monospace, monospace';

// CSS stacks live in public/fonts/typography.css so React and public documents
// use the same faces (Hanken Grotesk for text and headings, Source Sans 3 as the
// fallback for Greek, Cyrillic and missing symbols). Data labels keep the
// independent monospace stack.
export const FONT_SANS = 'var(--font-sans)';
export const FONT_HEADING = 'var(--font-heading)';

// Semantic DE-direction colors for the cross-dataset report pages (CSS-variable
// form, theme-aware). Distinct from the hex UP_COLOR/DOWN_COLOR below, which
// unrelated charts pin to exact hex values.
export const DIRECTION_UP_COLOR = 'var(--color-obese)';
export const DIRECTION_DOWN_COLOR = 'var(--color-normal)';

// The 4px page-accent strip every full-page view renders under its header.
export const PAGE_ACCENT_GRADIENT =
  'linear-gradient(90deg, #4C78A8, #59A14F 25%, #E45756 50%, #B07AA1 75%, #9C755F)';

export const btnStyle: CSSProperties = {
  padding: '3px 10px', fontSize: 11, border: '1px solid var(--border-dark)',
  borderRadius: 4, cursor: 'pointer', background: 'white', color: 'var(--text-primary)',
};

export const LP_DB_COLOR: Record<string, string> = {
  GO_BP: '#4C78A8',
  HALLMARK: '#B07AA1',
  KEGG: '#59A14F',
  REACTOME: '#E45756',
};

// Differential-expression chart fills: up-regulated (positive logFC/NES) is
// red, down-regulated is blue. (These happen to equal the macaque e33 / e9
// palette colours and LP_DB_COLOR.REACTOME / .GO_BP; the names here pin the
// DE-direction meaning so the value lives in one place.)
export const UP_COLOR = '#E45756';
export const DOWN_COLOR = '#4C78A8';

// Normal-sized result text needs stronger contrast than the chart palette.
// These retain the same red/blue meaning and exceed 4.5:1 on the panel, page,
// hover and selected-row backgrounds. Keep UP_COLOR/DOWN_COLOR for plot fills.
export const UP_TEXT_COLOR = '#AD3433';
export const DOWN_TEXT_COLOR = '#315F8D';
export const NEUTRAL_TEXT_COLOR = '#5A5650';

// Amber warning semantic slot for PopWarningBadge (WCAG AA on #FEF3C7 bg).
export const COLOR_WARNING_FG = '#D97706';
export const COLOR_WARNING_BG = '#FEF3C7';
export const COLOR_WARNING_TEXT = '#B45309';

export const LP_TH: CSSProperties = {
  padding: '2px 6px', textAlign: 'right', fontWeight: 600,
  color: 'var(--text-muted)', whiteSpace: 'nowrap',
};

export const LP_TD: CSSProperties = {
  padding: '2px 6px', textAlign: 'right',
  fontFamily: FONT_MONO,
};

// The column-header cell style shared by the Circadian and Pathway Explorer
// tables. Deliberately WITHOUT `cursor`: the Pathway Explorer mixes sortable
// headers with two that do not sort (DB and Size), and a hardcoded
// `cursor: 'pointer'` here promised those a click they never had. A sortable
// column takes its pointer from SortableTh's button instead — the element that
// actually receives the click.
export const thStyle = (align: CSSProperties['textAlign'] = 'left'): CSSProperties => ({
  padding: '5px 8px', fontSize: 11, fontWeight: 600,
  color: 'var(--text-muted)', textAlign: align, whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border)', userSelect: 'none',
  background: 'var(--bg-app)',
});
