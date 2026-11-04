import type { CSSProperties } from 'react';
import { LP_DB_COLOR } from '../styles/constants';

interface DbPillProps {
  /** Pathway database name — GO_BP, HALLMARK, KEGG, REACTOME. */
  db: string;
  fontSize?: number;
  padding?: CSSProperties['padding'];
  borderRadius?: number;
  /** Site-specific extras (display, fontFamily). Never the colors. */
  style?: CSSProperties;
}

/**
 * The pathway-database badge: the db name in its LP_DB_COLOR on a 13%-alpha wash
 * of the same hue. This owns the unknown-DB fallback that four of the five
 * hand-rolled spellings it replaces were missing — an unrecognised db rendered
 * `background: "undefined22"` and `color: undefined`, i.e. an invisible pill.
 *
 * Size and padding stay per-site props rather than being unified, because the
 * sites genuinely differ: the Compare table's 9px / 2px-radius pill is
 * deliberately denser than the explorers'.
 */
export function DbPill({ db, fontSize = 10, padding = '1px 6px', borderRadius = 3, style }: DbPillProps) {
  // 6-digit, NOT the '#888' shorthand: the wash below concatenates a 2-digit
  // alpha, and '#888' + '22' is a 5-digit hex the browser drops outright —
  // which left the fallback pill with no background at all.
  const color = LP_DB_COLOR[db] ?? '#888888';
  return (
    <span style={{
      fontSize, padding, borderRadius, fontWeight: 600,
      background: `${color}22`, color, ...style,
    }}>{db}</span>
  );
}
