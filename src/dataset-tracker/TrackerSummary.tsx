import type { Dispatch, SetStateAction } from 'react';
import { STATUSES } from './trackerLogic';
import type { TrackerFilterState } from './trackerLogic';

interface TrackerSummaryProps {
  counts: Record<string, number>;
  f: TrackerFilterState;
  setF: Dispatch<SetStateAction<TrackerFilterState>>;
  explorerTotal: number;
  explorerRefOpen: boolean;
  setExplorerRefOpen: Dispatch<SetStateAction<boolean>>;
}

// Status-count chips + the "In explorer" chip + the reference-panel toggle.
// Clicking a chip filters the table to that status (toggle). Chips are buttons so
// they are keyboard-operable.
export function TrackerSummary({
  counts,
  f,
  setF,
  explorerTotal,
  explorerRefOpen,
  setExplorerRefOpen,
}: TrackerSummaryProps) {
  return (
    <div className="summary">
      <button
        type="button"
        className={`scard${f.status === 'all' ? ' on' : ''}`}
        aria-pressed={f.status === 'all'}
        onClick={() => setF({ ...f, status: 'all' })}
      >
        <span className="dot all" />
        <span className="num">{counts.all}</span>
        <span className="lab">All</span>
      </button>
      {/* A status nobody holds is hidden unless it is the active filter. */}
      {STATUSES.filter((s) => counts[s.key] > 0 || f.status === s.key).map((s) => (
        <button
          type="button"
          key={s.key}
          className={`scard${f.status === s.key ? ' on' : ''}`}
          aria-pressed={f.status === s.key}
          onClick={() => setF({ ...f, status: f.status === s.key ? 'all' : s.key })}
        >
          <span className={`dot ${s.cls}`} />
          <span className="num">{counts[s.key]}</span>
          <span className="lab">{s.label}</span>
        </button>
      ))}
      <span className="spacer" />
      <button
        type="button"
        aria-pressed={f.integ === 'yes'}
        className={`scard integ-card${f.integ === 'yes' ? ' on' : ''}`}
        title="Show candidates already in HypoExplorer"
        onClick={() => setF({ ...f, integ: f.integ === 'yes' ? 'all' : 'yes' })}
      >
        <span className="dot integ" />
        <span className="num">{counts.inExplorer}</span>
        <span className="lab">In explorer</span>
      </button>
      <button
        type="button"
        className="explorer-toggle"
        onClick={() => setExplorerRefOpen((v) => !v)}
        title="Show the datasets currently live in HypoExplorer"
        aria-expanded={explorerRefOpen}
      >
        {explorerTotal} explorer datasets {explorerRefOpen ? '▲' : '▼'}
      </button>
    </div>
  );
}
