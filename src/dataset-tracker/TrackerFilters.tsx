import { useId, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { SPECIES_GROUPS, MOD_GROUPS, MODEL_GROUPS, DEFAULT_TRACKER_FILTERS } from './trackerLogic';
import type { TrackerFilterState } from './trackerLogic';
import { VERIFICATION_CLAIMS, RESULT_AVAILABILITY } from '../data/authorVerification';
import { QUALITY_BADGES, QUALITY_STATUS } from '../data/datasetQualityR460';

type FilterKey = Exclude<keyof TrackerFilterState, 'q' | 'status'>;

interface FilterDef {
  key: FilterKey;
  label: string;
  options: Array<[value: string, label: string]>;
  /** Shown in the main bar; the rest sit behind "More filters". */
  primary?: boolean;
}

// "No filtering" for every select. It differs from DEFAULT_TRACKER_FILTERS only
// in n≥3, which is on by default and still counts as an active filter.
const NEUTRAL_TRACKER_FILTERS: TrackerFilterState = { ...DEFAULT_TRACKER_FILTERS, nok: 'all' };

const all = (label = 'all'): [string, string] => ['all', label];

// One declaration feeds the selects, the active-filter chips and the "More
// filters" count, so a new filter cannot appear in one place and not the others.
function trackerFilterDefs(tags: string[], f: TrackerFilterState): FilterDef[] {
  return [
    { key: 'sp', label: 'Species', primary: true, options: [all(), ...SPECIES_GROUPS.map((m): [string, string] => [m, m])] },
    { key: 'mod', label: 'Modality', primary: true, options: [all(), ...MOD_GROUPS.map((m): [string, string] => [m, m])] },
    {
      key: 'nok', label: 'Sample size', primary: true, options: [
        ['ok', 'n≥3'], all('All sample counts'), ['excluded', 'n<3 only'], ['unknown', 'Unknown'],
      ],
    },
    {
      key: 'feas', label: 'Feasibility', options: [
        all(), ['drop-in', 'Existing pipeline'], ['modified-pipeline', 'Pipeline changes'],
        ['heavy-lift', 'Major rework'], ['blocked', 'Blocked'], ['not-surveyed', 'Not surveyed'],
      ],
    },
    { key: 'model', label: 'Model', options: [all(), ...MODEL_GROUPS.map((m): [string, string] => [m, m])] },
    { key: 'tag', label: 'Search round', options: [all(), ...tags.map((t): [string, string] => [t, t])] },
    {
      key: 'integ', label: 'In explorer', options: [
        all(), ['yes', 'Integrated'], ['related', 'Same paper'], ['no', 'Not yet'],
      ],
    },
    ...QUALITY_BADGES.map(({ key, label }): FilterDef => ({
      key, label, options: [all(), ...Object.entries(QUALITY_STATUS).map(([s, meta]): [string, string] => [s, meta.label])],
    })),
    {
      key: 'validation', label: 'Detailed author review', options: [
        all(),
        ...(f.validation === 'partial' ? [['partial', 'Combined evidence group, saved filter'] as [string, string]] : []),
        ...Object.entries(VERIFICATION_CLAIMS).map(([claim, meta]): [string, string] => [claim, meta.label]),
        ['not_in_explorer', 'Not in explorer'],
      ],
    },
    {
      key: 'availability', label: 'Author results', options: [
        all('Any availability'), ...Object.entries(RESULT_AVAILABILITY).map(([k, meta]): [string, string] => [k, meta.label]),
      ],
    },
  ];
}

const isActive = (f: TrackerFilterState, key: FilterKey) =>
  (f[key] ?? 'all') !== NEUTRAL_TRACKER_FILTERS[key];

function FilterSelect({ def, f, setF }: { def: FilterDef; f: TrackerFilterState; setF: Dispatch<SetStateAction<TrackerFilterState>> }) {
  return (
    <label className={`filterpair${isActive(f, def.key) ? ' active' : ''}`}>
      <span className="lbl">{def.label}</span>
      <select value={f[def.key] ?? 'all'} onChange={(e) => setF((prev) => ({ ...prev, [def.key]: e.target.value }))}>
        {def.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
  );
}

interface TrackerFiltersProps {
  f: TrackerFilterState;
  setF: Dispatch<SetStateAction<TrackerFilterState>>;
  tags: string[];
  view: string;
  setView: Dispatch<SetStateAction<string>>;
  canEdit: boolean;
  save: string;
}

// The filter bar: search, the three most-used selects, a "More filters" panel
// for the rest, plus the table/board toggle and save state.
export function TrackerFilters({ f, setF, tags, view, setView, canEdit, save }: TrackerFiltersProps) {
  const defs = trackerFilterDefs(tags, f);
  const primary = defs.filter((d) => d.primary);
  const secondary = defs.filter((d) => !d.primary);
  const activeSecondary = secondary.filter((d) => isActive(f, d.key)).length;
  // Opens by itself when a hidden filter arrives already set (a saved filter).
  const [moreOpen, setMoreOpen] = useState(activeSecondary > 0);
  const panelId = useId();

  return (
    <div className="filterbar">
      <div className="filters">
        <input
          type="search"
          aria-label="Search candidates"
          placeholder="Search accession, title, species or phenotype…"
          value={f.q}
          onChange={(e) => setF((prev) => ({ ...prev, q: e.target.value }))}
        />
        {primary.map((def) => <FilterSelect key={def.key} def={def} f={f} setF={setF} />)}
        <button
          type="button"
          className={`morebtn${moreOpen ? ' on' : ''}`}
          aria-expanded={moreOpen}
          aria-controls={panelId}
          onClick={() => setMoreOpen((v) => !v)}
        >
          More filters{activeSecondary > 0 ? <span className="morecount">{activeSecondary}</span> : null}
          <span aria-hidden="true" className="chev">{moreOpen ? '▴' : '▾'}</span>
        </button>
        <span className="spacer" />
        {canEdit && (
          <span className={`savestate ${save}`}>
            {save === 'saving'
              ? 'Saving…'
              : save === 'saved'
                ? 'Saved'
                : save === 'error'
                  ? 'Could not save changes'
                  : ''}
          </span>
        )}
        <div className="viewtoggle">
          <button
            type="button"
            className={view === 'table' ? 'on' : ''}
            aria-pressed={view === 'table'}
            onClick={() => setView('table')}
          >
            Table
          </button>
          <button
            type="button"
            className={view === 'board' ? 'on' : ''}
            aria-pressed={view === 'board'}
            onClick={() => setView('board')}
          >
            Board
          </button>
        </div>
      </div>
      {moreOpen && (
        <div className="morefilters" id={panelId}>
          {secondary.map((def) => <FilterSelect key={def.key} def={def} f={f} setF={setF} />)}
        </div>
      )}
    </div>
  );
}

interface TrackerActiveFiltersProps {
  f: TrackerFilterState;
  setF: Dispatch<SetStateAction<TrackerFilterState>>;
  tags: string[];
  shown: number;
  total: number;
}

// One removable chip per active select, the result count, and "Clear all".
// Status and search have their own visible controls, so they get no chip, but
// "Clear all" resets them too.
export function TrackerActiveFilters({ f, setF, tags, shown, total }: TrackerActiveFiltersProps) {
  const active = trackerFilterDefs(tags, f).filter((d) => isActive(f, d.key));
  const anything = active.length > 0 || f.status !== 'all' || Boolean(f.q?.trim());
  return (
    <div className="activefilters">
      {active.map((def) => {
        const value = f[def.key] ?? 'all';
        const label = def.options.find(([v]) => v === value)?.[1] ?? value;
        const text = def.key === 'nok' ? label : `${def.label}: ${label}`;
        return (
          <button
            type="button"
            key={def.key}
            className="fchip"
            aria-label={`Remove filter ${def.label}: ${label}`}
            onClick={() => setF((prev) => ({ ...prev, [def.key]: NEUTRAL_TRACKER_FILTERS[def.key] }))}
          >
            {text}<span aria-hidden="true" className="fchip-x">×</span>
          </button>
        );
      })}
      <span className="shown" aria-live="polite">{shown === total ? `${total} shown` : `${shown} of ${total} shown`}</span>
      {anything && (
        <button type="button" className="clearall" onClick={() => setF(NEUTRAL_TRACKER_FILTERS)}>
          Clear all
        </button>
      )}
    </div>
  );
}
