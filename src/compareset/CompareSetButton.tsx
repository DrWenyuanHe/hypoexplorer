// The header indicator: how many columns are in the compare set, and the way
// into the drawer that edits it. Mounted in every header the app has — the
// hub's, the full-page shell's, the explorer topbar's — so the set is
// reachable from wherever a study was just added.
//
// Text carries the count (DESIGN.md: state in words, never colour alone), the
// count itself in mono. Shares the header-control treatment with the other
// header utilities (src/common/headerControl.css).

import { useState } from 'react';
import '../common/headerControl.css';
import { CompareSetDrawer } from './CompareSetDrawer';
import { useCompareSet, type CompareSetItem } from './compareSetStore';

interface CompareSetButtonProps {
  /** The drawer's "Compare N →": open the compare-set view on these columns. */
  onCompare: (items: readonly CompareSetItem[]) => void;
  /** Where the empty drawer sends someone. Omit inside the library itself. */
  onOpenLibrary?: () => void;
}

export function CompareSetButton({ onCompare, onOpenLibrary }: CompareSetButtonProps) {
  // The one subscription per header; the drawer renders these as a prop.
  const items = useCompareSet();
  const [open, setOpen] = useState(false);
  const n = items.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Compare set, ${n} ${n === 1 ? 'study' : 'studies'}`}
        title="Studies picked for side-by-side comparison"
        className={n ? 'header-control header-control--on' : 'header-control'}
      >
        Compare set
        <span className="header-control-figure">· {n}</span>
      </button>
      {open && (
        <CompareSetDrawer
          items={items}
          onClose={() => setOpen(false)}
          onCompare={(its) => { setOpen(false); onCompare(its); }}
          onOpenLibrary={onOpenLibrary && (() => { setOpen(false); onOpenLibrary(); })}
        />
      )}
    </>
  );
}
