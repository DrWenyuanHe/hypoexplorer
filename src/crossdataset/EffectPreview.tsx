import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface EffectPreviewProps {
  label: string;
  previewLabel: string;
  closeLabel: string;
  heading: string;
  subheading: string;
  children: ReactNode;
  content: ReactNode;
  caption?: ReactNode;
  width?: number;
}

// Shared interaction and viewport placement for gene and pathway previews.
// The content only mounts after hover, keyboard focus or a tap requests it.
export function EffectPreview({ label, previewLabel, closeLabel, heading, subheading, children, content, caption, width = 360 }: EffectPreviewProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();
  const cancelTimer = useCallback(() => { clearTimeout(timer.current); }, []);
  const show = () => { cancelTimer(); setOpen(true); };
  const hideSoon = () => { cancelTimer(); timer.current = setTimeout(() => setOpen(false), 160); };

  useEffect(() => cancelTimer, [cancelTimer]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const panelWidth = panel.current?.offsetWidth || width;
      const height = panel.current?.offsetHeight || 340;
      const below = rect.bottom + 8;
      setPosition({
        left: Math.max(8, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 8)),
        top: Math.max(8, below + height <= window.innerHeight - 8 ? below : rect.top - height - 8),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    const dismiss = () => setOpen(false);
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { cancelTimer(); dismiss(); } };
    const onScroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) dismiss(); };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) dismiss();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onEscape);
    document.addEventListener('pointerdown', outside);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onEscape);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open, cancelTimer, width]);

  return <>
    <button ref={trigger} type="button" className="report-effect-trigger"
      aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined}
      onMouseEnter={() => { cancelTimer(); timer.current = setTimeout(() => setOpen(true), 180); }}
      onMouseLeave={hideSoon} onFocus={show}
      onBlur={(event) => { if (!panel.current?.contains(event.relatedTarget)) hideSoon(); }}
      onClick={show}>
      {children}
    </button>
    {open && createPortal(
      <section ref={panel} id={id} aria-label={previewLabel}
        className="report-effect-preview" style={{ ...position, width: `min(${width}px, calc(100vw - 16px))` }}
        onMouseEnter={cancelTimer} onMouseLeave={hideSoon}
        onFocus={cancelTimer} onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) hideSoon();
        }}>
        <div className="report-preview-heading">
          <div><strong>{heading}</strong><span>{subheading}</span></div>
          <button type="button" aria-label={closeLabel} onClick={() => { trigger.current?.focus(); setOpen(false); }}>×</button>
        </div>
        {content}
        {caption && <div className="report-preview-caption">{caption}</div>}
      </section>, document.body,
    )}
  </>;
}
