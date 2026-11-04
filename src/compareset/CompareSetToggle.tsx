// The one control that puts a study — or a population — into the compare
// set, wherever it appears: a library card's corner, a table cell, the record
// modal's footer, the explorer topbar.
//
// A toggle, not an "add" button: the same control shows the column is in the
// set and takes it out again. Its accessible name says both what it does and
// to which study, and never STARTS with the study's name — the cards, rows and
// records already carry buttons named exactly that, and a second control whose
// name begins the same way would make by-name queries ambiguous.
//
// Not Signal Orange when pressed. The card's selected border and the record's
// primary button already own the one accent a view gets (DESIGN.md); a
// pressed toggle reads as selected through the same fill the rail's ticked
// rows use, plus its text.

import { useEffect, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { COLOR_WARNING_TEXT, FONT_SANS } from '../styles/constants';
import { COMPARE_SET_MAX, type CompareSetAddResult } from './compareSetStore';

interface CompareSetToggleProps {
  inSet: boolean;
  /** The study (and, off its default track, the track) the name refers to. */
  name: string;
  onToggle: () => CompareSetAddResult | undefined;
  /** sm: a card corner or table cell; md: a modal footer or topbar. */
  size?: 'sm' | 'md';
}

const NOTICE_MS = 3000;

export function CompareSetToggle({ inSet, name, onToggle, size = 'sm' }: CompareSetToggleProps) {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const label = inSet ? `Remove ${name} from compare set` : `Add ${name} to compare set`;

  const onClick = (e: MouseEvent) => {
    // The library's table row opens the record on click; this control sits in
    // that row and must not.
    e.stopPropagation();
    const result = onToggle();
    if (result && !result.ok) {
      setNotice(result.reason === 'full'
        ? `Compare set is full (${COMPARE_SET_MAX})`
        : 'This study cannot be added');
    } else {
      setNotice(null);
    }
  };

  const style: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
    fontSize: size === 'sm' ? 11 : 12, padding: size === 'sm' ? '2px 8px' : '6px 11px',
    fontFamily: FONT_SANS, fontWeight: inSet ? 600 : 500, cursor: 'pointer',
    border: `1px solid ${inSet ? 'var(--border-dark)' : 'var(--border-dark)'}`, borderRadius: 'var(--r-md)',
    background: inSet ? 'var(--row-selected)' : 'var(--bg-panel)',
    color: inSet ? 'var(--accent)' : 'var(--text-primary)',
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button type="button" aria-pressed={inSet} aria-label={label} title={label} onClick={onClick} style={style}>
        {inSet ? '✓ In set' : '＋ Compare'}
      </button>
      {notice && (
        <span role="status" aria-live="polite" style={{ fontSize: 10.5, color: COLOR_WARNING_TEXT, fontFamily: FONT_SANS }}>
          {notice}
        </span>
      )}
    </span>
  );
}
