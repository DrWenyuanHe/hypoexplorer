// The hub's one search entrance for the cross-dataset explorers.
//
// Gene and pathway search share a dialog; a tab switch inside it picks which
// one is on screen. The route stays authoritative (`#/gene` or `#/pathway`), so
// deep links still open the matching side and the tab only asks App to switch.
//
// A side is mounted the first time it is shown and then kept, hidden, until the
// dialog closes. Switching back therefore keeps the typed term and the category
// picks, and a visitor who never opens the pathway side never loads its index.

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Modal } from '../common/Modal';

export type SearchMode = 'gene' | 'pathway';

const MODES: ReadonlyArray<{ id: SearchMode; label: string }> = [
  { id: 'gene', label: 'Genes' },
  { id: 'pathway', label: 'Pathways' },
];

export const SEARCH_DIALOG_TITLE = 'Gene & Pathway Explorer';

export function ExplorerSearchDialog({ mode, onModeChange, onClose, gene, pathway }: {
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
  onClose: () => void;
  /** The gene search landing; rendered once that side has been shown. */
  gene: () => ReactNode;
  /** The pathway search landing; rendered once that side has been shown. */
  pathway: () => ReactNode;
}) {
  const [visited, setVisited] = useState<ReadonlySet<SearchMode>>(() => new Set([mode]));
  useEffect(() => {
    setVisited((prev) => (prev.has(mode) ? prev : new Set([...prev, mode])));
  }, [mode]);
  const tabRefs = useRef<Partial<Record<SearchMode, HTMLButtonElement | null>>>({});

  // Arrow keys move between the two tabs and select as they go (the
  // automatic-activation tabs pattern), with Home and End for the ends.
  const onTabKey = (event: KeyboardEvent, current: SearchMode) => {
    const i = MODES.findIndex((m) => m.id === current);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (i + 1) % MODES.length;
    else if (event.key === 'ArrowLeft') next = (i - 1 + MODES.length) % MODES.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = MODES.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = MODES[next].id;
    tabRefs.current[target]?.focus();
    if (target !== mode) onModeChange(target);
  };

  const panels: Record<SearchMode, () => ReactNode> = { gene, pathway };

  return (
    <Modal title={SEARCH_DIALOG_TITLE} onClose={onClose} width="1120px" height="86dvh" initialFocusSelector="input">
      <div className="xsearch-tabs" role="tablist" aria-label="Search type">
        {MODES.map((m) => (
          <button
            key={m.id}
            ref={(el) => { tabRefs.current[m.id] = el; }}
            type="button"
            role="tab"
            id={`xsearch-tab-${m.id}`}
            aria-selected={mode === m.id}
            aria-controls={`xsearch-panel-${m.id}`}
            tabIndex={mode === m.id ? 0 : -1}
            onKeyDown={(event) => onTabKey(event, m.id)}
            // Focus the tab explicitly: Safari does not focus a clicked button,
            // and focus left in the panel being hidden would drop to <body>.
            onClick={(event) => {
              event.currentTarget.focus();
              if (m.id !== mode) onModeChange(m.id);
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      {MODES.filter((m) => visited.has(m.id) || m.id === mode).map((m) => (
        <div
          key={m.id}
          role="tabpanel"
          id={`xsearch-panel-${m.id}`}
          aria-labelledby={`xsearch-tab-${m.id}`}
          hidden={m.id !== mode}
        >
          {panels[m.id]()}
        </div>
      ))}
    </Modal>
  );
}
