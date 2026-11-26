// A small (?) button that keeps an explanation out of the reading flow.
//
// Hover or focus shows the panel; a click pins it open (so touch screens can
// read it), and Escape or a click elsewhere closes it. The panel stays open
// while the pointer moves onto it, so its text can be selected. It is drawn in
// a portal with fixed positioning, clamped to the viewport, so a scrolling or
// clipping parent never cuts it off.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './helpTip.css';

const GAP = 6;
const MARGIN = 8;
const CLOSE_DELAY_MS = 120;

interface HelpTipProps {
  /** The button's accessible name, e.g. "About FDR and p < 0.05". */
  label: string;
  /** Preferred panel width in px; narrowed to fit the viewport. */
  width?: number;
  children: ReactNode;
}

export function HelpTip({ label, width = 340, children }: HelpTipProps) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const show = () => { cancelClose(); setOpen(true); };
  const hideSoon = () => {
    if (pinned) return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  const close = useCallback(() => { window.clearTimeout(closeTimer.current); setPinned(false); setOpen(false); }, []);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const place = useCallback(() => {
    const anchor = button.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 2 * MARGIN);
    // Right edge on the button's right edge, pulled back inside the viewport.
    const left = Math.max(MARGIN, Math.min(rect.right - w, window.innerWidth - w - MARGIN));
    const height = panel.current?.offsetHeight ?? 0;
    const below = rect.bottom + GAP;
    const top = below + height > window.innerHeight - MARGIN && rect.top - GAP - height >= MARGIN
      ? rect.top - GAP - height
      : below;
    setPos({ top, left, width: w });
  }, [width]);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    place();
    // Once more after the panel has a measured height, to flip above if needed.
    const frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (button.current?.contains(target) || panel.current?.contains(target)) return;
      close();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, place, close]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="help-tip"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-describedby={open ? id : undefined}
        data-pinned={pinned || undefined}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onFocus={show}
        onBlur={() => { if (!pinned) setOpen(false); }}
        onClick={() => {
          if (pinned) { close(); return; }
          setPinned(true);
          show();
        }}
      >
        <span aria-hidden="true">?</span>
      </button>
      {open && createPortal(
        <div
          ref={panel}
          id={id}
          role="tooltip"
          className="help-tip-panel"
          onMouseEnter={show}
          onMouseLeave={hideSoon}
          style={pos
            ? { top: pos.top, left: pos.left, width: pos.width }
            : { top: 0, left: 0, width, visibility: 'hidden' }}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
