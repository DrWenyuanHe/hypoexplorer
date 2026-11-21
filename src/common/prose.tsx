// Prose primitives and reading chrome for the app's long-form reference pages,
// Methods & statistics (MethodologyView) and Data verification
// (VerificationView). The app has no markdown renderer, so those pages write
// their documentation directly as JSX with these pieces: one page layout with
// its "On this page" contents, one title, one section heading, one paragraph
// measure and the shared table cells.
//
// Variants only one page uses (`Li`, `H3`, `Callout`) stay local to that page:
// hoisting a single-caller style here would make this file look like a design
// system it is not.

import type { CSSProperties, ReactNode } from 'react';
import { FONT_HEADING, FONT_MONO, FONT_SANS } from '../styles/constants';
import './prose.css';

/** Line length for running text, inside the 65–75ch range. Tables may be wider. */
export const PROSE_MEASURE = '72ch';

export interface ProseSectionEntry {
  id: string;
  title: string;
}

/** Page title. Matches the other full-page views' titles exactly. */
function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h1 style={{
      fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.25,
      color: 'var(--text-primary)', fontFamily: FONT_HEADING, margin: '0 0 12px',
    }}>
      {children}
    </h1>
  );
}

/** Section heading for a reference page. */
export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} style={{
      fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.3,
      color: 'var(--text-primary)', fontFamily: FONT_HEADING, margin: '32px 0 10px',
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
      fontFamily: FONT_SANS, margin: '0 0 12px', maxWidth: PROSE_MEASURE, overflowWrap: 'break-word',
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

/**
 * A titled section the contents list can jump to. The heading is the region's
 * accessible name.
 */
export function ProseSection({ section, children }: { section: ProseSectionEntry; children: ReactNode }) {
  return (
    <section id={section.id} className="prose-section" aria-labelledby={`${section.id}-h`} tabIndex={-1}>
      <H2 id={`${section.id}-h`}>{section.title}</H2>
      {children}
    </section>
  );
}

// The app routes on the URL hash, so in-page links scroll with scrollIntoView
// instead of writing #id into the location. The sticky site header would cover
// the heading, so the target's scroll margin clears its current height.
function jumpToSection(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  const header = document.querySelector('.site-header');
  const covered = header && getComputedStyle(header).position === 'sticky' ? header.getBoundingClientRect().height : 0;
  target.style.scrollMarginTop = `${Math.round(covered) + 16}px`;
  target.scrollIntoView?.({ block: 'start' });
  target.focus({ preventScroll: true });
}

function ProseContents({ sections }: { sections: readonly ProseSectionEntry[] }) {
  return (
    <nav aria-label="On this page" className="prose-contents">
      <div className="prose-contents__label" aria-hidden="true">On this page</div>
      <ol>
        {sections.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => jumpToSection(s.id)}>{s.title}</button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The reference-page layout: title and introduction, the contents list built
 * from the page's sections, then the sections themselves (`ProseSection`).
 */
export function ProsePage({ title, intro, sections, children }: {
  title: ReactNode;
  intro: ReactNode;
  sections: readonly ProseSectionEntry[];
  children: ReactNode;
}) {
  return (
    <article className="prose-page">
      <div className="prose-page__head">
        <PageTitle>{title}</PageTitle>
        {intro}
      </div>
      <ProseContents sections={sections} />
      <div className="prose-page__body">{children}</div>
    </article>
  );
}
