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
        onClick={() => setF({ ...f, status: 'all' })}
      >
        <span className="dot all" />
        <span className="num">{counts.all}</span>
        <span className="lab">All</span>
      </button>
      {STATUSES.map((s) => (
        <button
          type="button"
          key={s.key}
          className={`scard${f.status === s.key ? ' on' : ''}`}
          onClick={() => setF({ ...f, status: f.status === s.key ? 'all' : s.key })}
        >
          <span className={`dot ${s.cls}`} />
          <span className="num">{counts[s.key]}</span>
          <span className="lab">{s.label}</span>
        </button>
      ))}
      <button
        type="button"
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
      >
        {explorerTotal} explorer datasets {explorerRefOpen ? '▲' : '▼'}
      </button>
    </div>
  );
}
