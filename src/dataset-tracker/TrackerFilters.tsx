import type { Dispatch, SetStateAction } from 'react';
import { SPECIES_GROUPS, MOD_GROUPS, MODEL_GROUPS } from './trackerLogic';
import type { TrackerFilterState } from './trackerLogic';
import { VERIFICATION_CLAIMS, RESULT_AVAILABILITY } from '../data/authorVerification';
import { QUALITY_BADGES, QUALITY_STATUS } from '../data/datasetQualityR460';

interface TrackerFiltersProps {
  f: TrackerFilterState;
  setF: Dispatch<SetStateAction<TrackerFilterState>>;
  tags: string[];
  view: string;
  setView: Dispatch<SetStateAction<string>>;
  canEdit: boolean;
  save: string;
}

// The filter bar: free-text search + feasibility / n≥3 / modality / species /
// search-pass / in-explorer selects, plus the table/board toggle and save state.
export function TrackerFilters({ f, setF, tags, view, setView, canEdit, save }: TrackerFiltersProps) {
  return (
    <div className="filters">
      <input
        type="search"
        placeholder="Search accession, title, species or phenotype…"
        value={f.q}
        onChange={(e) => setF({ ...f, q: e.target.value })}
      />
      <label className="filterpair">
        <span className="lbl">Feasibility</span>
        <select value={f.feas} onChange={(e) => setF({ ...f, feas: e.target.value })}>
          <option value="all">all</option>
          <option value="drop-in">Existing pipeline</option>
          <option value="modified-pipeline">Pipeline changes</option>
          <option value="heavy-lift">Major rework</option>
          <option value="blocked">Blocked</option>
          <option value="not-surveyed">Not surveyed</option>
        </select>
      </label>
      <label className="filterpair">
        <span className="lbl">n≥3</span>
        <select value={f.nok} onChange={(e) => setF({ ...f, nok: e.target.value })}>
          <option value="ok">n≥3</option>
          <option value="all">All sample counts</option>
          <option value="excluded">n&lt;3 only</option>
          <option value="unknown">Unknown</option>
        </select>
      </label>
      <label className="filterpair">
        <span className="lbl">Modality</span>
        <select value={f.mod} onChange={(e) => setF({ ...f, mod: e.target.value })}>
          <option value="all">all</option>
          {MOD_GROUPS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <label className="filterpair">
        <span className="lbl">Species</span>
        <select value={f.sp} onChange={(e) => setF({ ...f, sp: e.target.value })}>
          <option value="all">all</option>
          {SPECIES_GROUPS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <label className="filterpair">
        <span className="lbl">Model</span>
        <select value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })}>
          <option value="all">all</option>
          {MODEL_GROUPS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <label className="filterpair">
        <span className="lbl">Search round</span>
        <select value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })}>
          <option value="all">all</option>
          {tags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label className="filterpair">
        <span className="lbl">In explorer</span>
        <select value={f.integ} onChange={(e) => setF({ ...f, integ: e.target.value })}>
          <option value="all">all</option>
          <option value="yes">Integrated</option>
          <option value="related">Same paper</option>
          <option value="no">Not yet</option>
        </select>
      </label>
      {QUALITY_BADGES.map(({ key, label }) => <label className="filterpair" key={key}>
        <span className="lbl">{label}</span>
        <select value={f[key] ?? 'all'} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
          <option value="all">all</option>
          {Object.entries(QUALITY_STATUS).map(([status, meta]) => <option key={status} value={status}>{meta.label}</option>)}
        </select>
      </label>)}
      <label className="filterpair">
        <span className="lbl">Detailed author review</span>
        <select value={f.validation} onChange={(e) => setF({ ...f, validation: e.target.value })}>
          <option value="all">all</option>
          {f.validation === 'partial' && <option value="partial">Combined evidence group, saved filter</option>}
          {Object.entries(VERIFICATION_CLAIMS).map(([claim, meta]) => (
            <option key={claim} value={claim}>{meta.label}</option>
          ))}
          <option value="not_in_explorer">Not in explorer</option>
        </select>
      </label>
      <label className="filterpair">
        <span className="lbl">Author results</span>
        <select value={f.availability ?? 'all'} onChange={(e) => setF({ ...f, availability: e.target.value })}>
          <option value="all">Any availability</option>
          {Object.entries(RESULT_AVAILABILITY).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
        </select>
      </label>
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
          onClick={() => setView('table')}
        >
          Table
        </button>
        <button
          type="button"
          className={view === 'board' ? 'on' : ''}
          onClick={() => setView('board')}
        >
          Board
        </button>
      </div>
    </div>
  );
}
