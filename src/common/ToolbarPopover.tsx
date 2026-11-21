// A toolbar button that opens a small menu or popover under it.
//
// The pattern is SaveGeneListMenu's and DownloadMenu's (a transient popover
// closed by an outside click or Escape, arrow keys between menu items), made
// generic so the volcano toolbar's Gene list, thresholds and passing-gene
// controls share one implementation. Two things it adds over those: Escape
// hands focus back to the trigger, and the popup is nudged back on screen when
// the trigger sits near a viewport edge (a phone, a narrow panel).
//
// `kind: 'menu'` renders role="menu" and focuses the first enabled item on
// open; `kind: 'dialog'` renders a non-modal role="dialog" (the thresholds
// inputs are not menu items) and focuses its first control. Neither traps
// focus: Tab moves on, and focus leaving the popup closes it.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Spinner } from './Spinner';
import '../gene-explorer/volcanoToolbar.css';

const EDGE = 8;

interface ToolbarPopoverProps {
  kind: 'menu' | 'dialog';
  /** The trigger's visible content. A caret is appended. */
  label: ReactNode;
  /** The trigger's accessible name, when it must say more than the label. */
  ariaLabel?: string;
  title?: string;
  /** Accessible name of the popup. */
  popupLabel: string;
  disabled?: boolean;
  /** An export running from one of the items: the trigger shows a spinner and waits. */
  busy?: boolean;
  busyLabel?: string;
  /** Which edge of the trigger the popup lines up with before edge correction. */
  align?: 'left' | 'right';
  /** The popup body. Receives `close`, which also returns focus to the trigger. */
  children: (close: () => void) => ReactNode;
}

const FOCUSABLE_MENU = '[role^="menuitem"]:not(:disabled)';
const FOCUSABLE_DIALOG = 'input:not(:disabled), button:not(:disabled), select:not(:disabled)';

export function ToolbarPopover({
  kind, label, ariaLabel, title, popupLabel, disabled = false, busy = false, busyLabel,
  align = 'left', children,
}: ToolbarPopoverProps) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // A trigger that becomes disabled (nothing passes any more) takes its popup with it.
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape inside the popup closes it and returns focus; it must not also
      // reach a dialog this toolbar sits in.
      e.stopPropagation();
      close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    popupRef.current?.querySelector<HTMLElement>(kind === 'menu' ? FOCUSABLE_MENU : FOCUSABLE_DIALOG)?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, kind, close]);

  // Keep the popup on screen: measure it where CSS put it and slide it back
  // inside the viewport by the overshoot. Runs before paint, so it never flashes.
  useLayoutEffect(() => {
    if (!open) { setShift(0); return; }
    const el = popupRef.current;
    if (!el || typeof window === 'undefined') return;
    el.style.transform = '';
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    let dx = 0;
    if (r.right > vw - EDGE) dx = vw - EDGE - r.right;
    if (r.left + dx < EDGE) dx = EDGE - r.left;
    setShift(dx);
  }, [open]);

  const popupProps = {
    className: `gx-popup gx-popup--${align}`,
    style: shift ? { transform: `translateX(${shift}px)` } : undefined,
  };

  // Arrow keys (and Home / End) move between a menu's enabled items, wrapping.
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const items = [...(popupRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_MENU) ?? [])];
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
        : e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next].focus();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focus leaving the popup closes it; the wrapper only observes focusout
    <div ref={wrapRef} className="gx-pop" data-export-ignore=""
      onBlur={(e) => {
        if (open && wrapRef.current && e.relatedTarget && !wrapRef.current.contains(e.relatedTarget as Node)) setOpen(false);
      }}>
      <button ref={triggerRef} type="button" className="gx-btn"
        onClick={() => setOpen((v) => !v)} disabled={disabled || busy} title={title}
        aria-label={busy ? undefined : ariaLabel}
        aria-haspopup={kind} aria-expanded={open} data-active={open}>
        {busy
          ? <><Spinner size={10} />{busyLabel}</>
          : <>{label}<span className="gx-caret" aria-hidden="true">▾</span></>}
      </button>
      {open && (kind === 'menu' ? (
        <div ref={popupRef} role="menu" aria-label={popupLabel} onKeyDown={onMenuKey} {...popupProps}>
          {children(close)}
        </div>
      ) : (
        <div ref={popupRef} role="dialog" aria-label={popupLabel} {...popupProps}>
          {children(close)}
        </div>
      ))}
    </div>
  );
}

/** A heading inside a menu, naming the group of items under it. */
export function MenuGroup({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: an ARIA group of menuitems inside role="menu"; a <fieldset> is not valid menu content.
    <div role="group" aria-label={heading}>
      <div className="gx-menu-heading" aria-hidden="true">{heading}</div>
      {children}
    </div>
  );
}

interface MenuItemProps {
  onSelect: () => void;
  children: ReactNode;
  /** A muted second part on the same line: a format's hint. */
  hint?: string;
  disabled?: boolean;
  title?: string;
  /** Makes this a checkable item (role="menuitemcheckbox"). */
  checked?: boolean;
}

export function MenuItem({ onSelect, children, hint, disabled, title, checked }: MenuItemProps) {
  const body = (
    <>
      <span className="gx-menu-label">{children}</span>
      {hint && <span className="gx-menu-hint"> · {hint}</span>}
    </>
  );
  if (checked !== undefined) {
    return (
      <button type="button" role="menuitemcheckbox" aria-checked={checked}
        className="gx-menu-item" disabled={disabled} title={title} onClick={onSelect}>
        <span className="gx-menu-check" aria-hidden="true">{checked ? '✓' : ''}</span>
        {body}
      </button>
    );
  }
  return (
    <button type="button" role="menuitem" className="gx-menu-item" disabled={disabled} title={title} onClick={onSelect}>
      {body}
    </button>
  );
}
