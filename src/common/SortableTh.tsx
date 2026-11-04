import type { CSSProperties, ReactNode } from 'react';

// The sort arrow, in one place: the three sortable tables each spelled this
// ternary out for themselves, to the character (' ↑' ascending, ' ↓'
// descending, nothing at all when the column is not the active one).
const arrowFor = (active: boolean, dir: number) => (active ? (dir === 1 ? ' ↑' : ' ↓') : '');

// The bare-button reset. The control inherits the header cell's own type,
// colour, alignment and wrapping, so it renders exactly like the bare text it
// replaced; the cell's padding is MOVED onto it (see below), which is why
// there is no padding of its own here.
const SORT_BUTTON: CSSProperties = {
  font: 'inherit', color: 'inherit', letterSpacing: 'inherit',
  textTransform: 'inherit', textAlign: 'inherit', whiteSpace: 'inherit',
  background: 'none', border: 'none', width: '100%',
  cursor: 'pointer', userSelect: 'none',
};

interface SortableThProps {
  /** True when this column is the one the table is currently sorted by. */
  active: boolean;
  /** Sort direction — 1 ascending, -1 descending. Read only when `active`. */
  dir: number;
  onSort: () => void;
  /** The header cell's own style: the plain <th> style this replaces. */
  style?: CSSProperties;
  title?: string;
  /** The cell's `scope`, for a table that declares one (QCTab's does). */
  scope?: 'col' | 'row';
  children?: ReactNode;
}

/**
 * A sortable column header: the <th> keeps the table semantics and carries the
 * sort STATE (`aria-sort`), while a <button> inside it carries the sort ACTION.
 *
 * The action has to sit on a real control. A bare `<th onClick>` with
 * `cursor: 'pointer'` is mouse-only — a <th> takes no focus and exposes no
 * role, so keyboard and screen-reader users cannot sort the table at all. It is
 * the same call App.tsx's exploratory-contrast badge makes in using a <button>
 * rather than a `<span title>`: an affordance only a mouse can reach is one
 * most assistive tech cannot report, let alone operate.
 *
 * `style` passes through unchanged except for `padding`, which moves onto the
 * button so the whole cell stays clickable and the rendering is identical to
 * the <th> this replaced. `title` rides the button for the same reason — a
 * tooltip anchored to the non-focusable cell is the same mouse-only trap.
 */
export function SortableTh({ active, dir, onSort, style, title, scope, children }: SortableThProps) {
  const { padding, ...cell } = style ?? {};
  return (
    <th scope={scope} aria-sort={active ? (dir === 1 ? 'ascending' : 'descending') : 'none'} style={cell}>
      <button type="button" onClick={onSort} title={title} style={{ ...SORT_BUTTON, padding }}>
        {children}
        {/* Decoration only: `aria-sort` above is what reports the state, so the
            arrow stays out of the button's accessible name. */}
        <span aria-hidden="true">{arrowFor(active, dir)}</span>
      </button>
    </th>
  );
}
