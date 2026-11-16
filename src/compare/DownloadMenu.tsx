// A download button that opens a short menu of what can be saved, each choice
// with a one-line description of the file it writes.
//
// The compare views offer several downloads (summary data as Excel or CSV,
// figures as PNG or SVG) and a row of separate buttons for them either crowds
// the toolbar or, as the old 11px "Export Excel" in the table header did, hides
// all but one. The pattern is SaveGeneListMenu's (src/common/GeneListTools):
// an ExportButton trigger carrying the export-action busy state, a transient
// popover closed by an outside click or Escape. It is not a dialog, so it traps
// nothing; arrow keys move between items as in any menu.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { ExportButton } from '../common/ExportButton';
import { FONT_SANS } from '../styles/constants';

export interface DownloadMenuItem {
  key: string;
  label: string;
  /** What the file contains, in one line. */
  description: string;
  onSelect: () => void;
  disabled?: boolean;
}

export interface DownloadMenuSection {
  heading: string;
  items: readonly DownloadMenuItem[];
}

interface DownloadMenuProps {
  sections: readonly DownloadMenuSection[];
  /** The idle trigger content (icon + label). */
  children: ReactNode;
  /** Accessible name of the popup menu. */
  menuLabel: string;
  /** The export-action seam's busy flag, owned by the caller. */
  busy: boolean;
  busyLabel: string;
  title?: string;
  /** A line at the top of the open menu — why its items are disabled. */
  notice?: string;
  /** Which edge of the trigger the menu lines up with. */
  align?: 'left' | 'right';
  triggerStyle?: CSSProperties;
  disabled?: boolean;
}

export const DownloadIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4v12" /><path d="m6 10 6 6 6-6" /><path d="M4 20h16" />
  </svg>
);

export function DownloadMenu({
  sections, children, menuLabel, busy, busyLabel, title, notice, align = 'right', triggerStyle, disabled = false,
}: DownloadMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Focus the first available choice, so a keyboard user lands in the menu.
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next].focus();
  };

  const choose = (item: DownloadMenuItem) => {
    setOpen(false);
    item.onSelect();
  };

  return (
    // data-export-ignore (EXPORT_IGNORE_ATTR): a menu button is not part of
    // the figure, so snapshots leave it out.
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }} data-export-ignore="">
      <ExportButton onClick={() => setOpen((v) => !v)} busy={busy} busyLabel={busyLabel} spinnerSize={10}
        disabled={disabled} title={title} style={triggerStyle} aria-haspopup="menu" aria-expanded={open}>
        {children}
      </ExportButton>
      {open && (
        <div ref={menuRef} role="menu" aria-label={menuLabel} onKeyDown={onMenuKey} style={{
          position: 'absolute', top: '100%', ...(align === 'right' ? { right: 0 } : { left: 0 }), zIndex: 100, marginTop: 4,
          width: 'max-content', minWidth: 240, maxWidth: 'min(360px, calc(100vw - 24px))',
          background: 'var(--bg-panel)', border: '1px solid var(--border-dark)', borderRadius: 6,
          boxShadow: '0 4px 14px rgba(0,0,0,0.14)', padding: 4, textAlign: 'left',
        }}>
          {notice && (
            <div role="note" style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_SANS, lineHeight: 1.4 }}>
              {notice}
            </div>
          )}
          {sections.filter((s) => s.items.length > 0).map((section) => (
            // biome-ignore lint/a11y/useSemanticElements: an ARIA group of menuitems inside role="menu"; a <fieldset> is a form-control grouping and is not valid menu content.
            <div key={section.heading} role="group" aria-label={section.heading}>
              <div style={{
                padding: '6px 10px 2px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: FONT_SANS,
              }}>{section.heading}</div>
              {section.items.map((item) => (
                <button key={item.key} type="button" role="menuitem" className="hover-row"
                  disabled={item.disabled} aria-disabled={item.disabled || undefined}
                  onClick={() => choose(item)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
                    border: 'none', background: 'none', borderRadius: 4,
                    cursor: item.disabled ? 'not-allowed' : 'pointer', opacity: item.disabled ? 0.5 : 1,
                    fontFamily: FONT_SANS, fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.35,
                  }}>
                  <span style={{ display: 'block', fontWeight: 600 }}>{item.label}</span>
                  <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11 }}>{item.description}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
