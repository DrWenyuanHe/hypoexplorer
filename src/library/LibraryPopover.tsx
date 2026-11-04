// A small anchored popover for the library's view and filter menus.
//
// Positioned `fixed` from the anchor's rect rather than absolutely inside the
// toolbar: the filter bar scrolls sideways on a phone, and an absolutely placed
// child of a scroller is clipped by it. Closing on scroll and resize keeps the
// fixed box from drifting away from its chip, which is cheaper than tracking it.
//
// Escape and an outside press close it and hand focus back to the chip that
// opened it, so a keyboard user lands where they were.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

interface LibraryPopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  width?: number;
  children: ReactNode;
}

const GUTTER = 12;

export function LibraryPopover({ anchorRef, onClose, label, width = 280, children }: LibraryPopoverProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: GUTTER, top: 0 });

  useLayoutEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const maxLeft = window.innerWidth - Math.min(width, window.innerWidth - GUTTER * 2) - GUTTER;
    setPos({ left: Math.max(GUTTER, Math.min(rect.left, maxLeft)), top: rect.bottom + 6 });
  }, [anchorRef, width]);

  useEffect(() => {
    const anchor = anchorRef.current;
    // Focus the first control inside, or the box itself when it has none.
    const first = boxRef.current?.querySelector<HTMLElement>('input, button, [tabindex="0"]');
    (first ?? boxRef.current)?.focus();

    const close = (restore: boolean) => {
      onClose();
      if (restore) anchor?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || anchor?.contains(t)) return;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Marked handled so the study record's own Escape listener, if one is
      // ever open underneath, does not also fire.
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    // A scroll INSIDE the popover is its own list scrolling, not the page.
    const onScroll = (e: Event) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [anchorRef, onClose]);

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className="library-popover"
      style={{
        position: 'fixed', left: pos.left, top: pos.top, zIndex: 70,
        width: `min(${width}px, calc(100vw - ${GUTTER * 2}px))`,
        maxHeight: `min(420px, calc(100dvh - ${pos.top + GUTTER}px))`,
        overflowY: 'auto', outline: 'none',
        background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8,
        boxShadow: '0 12px 32px rgba(15, 22, 28, 0.14), 0 2px 6px rgba(15, 22, 28, 0.06)',
        padding: 4,
      }}
    >
      {children}
    </div>
  );
}
