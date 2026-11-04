import { nState } from './trackerLogic';
import type { TrackerRow } from '../types';

// The single place the n≥3 tri-state (`nState`) becomes something on screen.
// Three views used to branch on it themselves, in three different wordings —
// which is how a fourth state (or a reworded one) would have reached only some
// of them. The branch lives here once; the WORDING is the variant:
//   compact — the table cell:   6✓ / 1✗ / ?
//   full    — the dossier row:  passes (min 6/group) / EXCLUDED — n<3 (min 1) / unknown
// The board's card meta is a bare suffix, not a cell, so it reads the same
// state through `nStateSuffix` instead of rendering an element.
export type NStateVariant = 'compact' | 'full';

export function NStateCell({ row, variant }: { row: TrackerRow; variant: NStateVariant }) {
  const ns = nState(row);
  if (ns.s === 'ok')
    return (
      <span className="nok">
        {variant === 'compact' ? `${ns.min}✓` : `Passes, minimum ${ns.min} per group`}
      </span>
    );
  if (ns.s === 'excluded')
    return (
      <span className="nbad">
        {variant === 'compact' ? `${ns.min}✗` : `Excluded, n<3. Minimum ${ns.min} per group`}
      </span>
    );
  return <span className="nunk">{variant === 'compact' ? '?' : 'unknown'}</span>;
}

export function nStateSuffix(row: TrackerRow): string {
  return nState(row).s === 'excluded' ? ' · n<3' : '';
}
