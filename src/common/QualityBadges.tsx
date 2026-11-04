import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AuthorValidationRecord } from '../data/authorValidation';
import type { QualityAssessment } from '../data/qualityChecks';
import { datasetQuality, QUALITY_BADGES, QUALITY_STATUS } from '../data/datasetQualityR460';
import { FONT_SANS } from '../styles/constants';
import './QualityBadges.css';

export function QualityChecklist({ assessment }: { assessment: QualityAssessment }) {
  return <>
    <p className="quality-scope">{assessment.scope}</p>
    <ul className="quality-checklist">
      {assessment.checks.map((check) => <li key={check.id} data-quality-check={check.id} data-check-status={check.status}>
        <span aria-hidden="true" className="quality-check-symbol" style={{ color: QUALITY_STATUS[check.status].color }}>{QUALITY_STATUS[check.status].symbol}</span>
        <span><strong>{check.label}</strong><span className="quality-check-status">{QUALITY_STATUS[check.status].label}</span>
          <span className="quality-check-note">{check.note}</span></span>
      </li>)}
    </ul>
    <p className="quality-policy">Policy: {assessment.policyVersion}. A green check applies only to the stated check and scope.</p>
  </>;
}

/** Portal avoids clipping in scrolling tables, cards and comparison columns. */
export function QualityBadge({ label, assessment, compact = false, description }: {
  label: string; assessment: QualityAssessment; compact?: boolean; description?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const suppressFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 400 });
  const meta = QUALITY_STATUS[assessment.status];
  const cancelClose = useCallback(() => clearTimeout(closeTimer.current), []);
  const show = () => { cancelClose(); document.dispatchEvent(new CustomEvent('quality-popover-open', { detail: id })); setOpen(true); };
  const close = useCallback((returningFocus = false) => { cancelClose(); suppressFocus.current = returningFocus; setOpen(false); setPinned(false); }, [cancelClose]);
  const scheduleClose = () => {
    cancelClose();
    if (!pinned) closeTimer.current = setTimeout(() => setOpen(false), 180);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    const otherOpened = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) close(); };
    document.addEventListener('quality-popover-open', otherOpened);
    return () => document.removeEventListener('quality-popover-open', otherOpened);
  }, [id, close]);
  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(420, window.innerWidth - 24);
      const height = Math.min(panel.current?.scrollHeight ?? 400, window.innerHeight - 24, 520);
      const below = window.innerHeight - rect.bottom - 12;
      const top = below >= Math.min(height, 240) ? rect.bottom + 5 : Math.max(12, rect.top - height - 5);
      setPosition({ top, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), maxHeight: Math.max(120, window.innerHeight - top - 12) });
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) close();
    };
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(true); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    // Handle the topmost checklist before an enclosing dialog's React handler.
    document.addEventListener('keydown', onEscape, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', onEscape, true);
    };
  }, [open, close]);
  return <>
    <button ref={trigger} type="button" className={`quality-badge${compact ? ' quality-badge-compact' : ''}`}
      aria-expanded={open} aria-controls={open ? id : undefined} aria-describedby={open ? id : undefined}
      data-quality-badge={label.toLowerCase().replace(/ /g, '-')} data-quality-status={assessment.status}
      style={{ '--quality-color': meta.color } as React.CSSProperties}
      onMouseEnter={() => { suppressFocus.current = false; show(); }} onMouseLeave={scheduleClose}
      onFocus={() => { if (!suppressFocus.current) show(); }}
      onBlur={(event) => { suppressFocus.current = false; if (!panel.current?.contains(event.relatedTarget as Node)) { cancelClose(); closeTimer.current = setTimeout(close, 180); } }}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); cancelClose(); if (pinned) close(); else { setPinned(true); show(); } }}>
      <span aria-hidden="true">{meta.symbol}</span>{label} {meta.suffix}
    </button>
    {open && createPortal(<section ref={panel} id={id} aria-label={`${label} checks`}
      className="quality-popover" style={{ ...position, fontFamily: FONT_SANS }}
      onMouseEnter={show} onMouseLeave={scheduleClose}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}
      onFocus={show} onBlur={(event) => { if (!panel.current?.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.current) close(); }}>
      <div className="quality-popover-heading"><strong>{label} {meta.suffix}</strong>
        <button type="button" aria-label={`Close ${label} checks`} onClick={() => { close(true); trigger.current?.focus(); }}>×</button></div>
      {description && <p className="quality-scope">{description}</p>}
      <QualityChecklist assessment={assessment} />
    </section>, document.body)}
  </>;
}

export function DatasetQualityBadges({ record, compact, contrastId }: {
  record: AuthorValidationRecord; compact?: boolean; contrastId?: string;
}) {
  const quality = datasetQuality(record, contrastId);
  return <span className="dataset-quality-badges">
    {QUALITY_BADGES.map(({ key, label, description }) => <QualityBadge key={key} label={label} description={description} assessment={quality[key]} compact={compact} />)}
  </span>;
}
