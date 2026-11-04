import { useEffect, useMemo, useState } from 'react';
import './tracker.css';
import { useTrackerData } from './useTrackerData';
import { STATUS_KEYS, filterAndSort, statusOf as statusOfReviews } from './trackerLogic';
import type { TrackerFilterState, TrackerSort } from './trackerLogic';
import { TrackerSummary } from './TrackerSummary';
import { TrackerFilters } from './TrackerFilters';
import { TrackerTable } from './TrackerTable';
import { TrackerBoard } from './TrackerBoard';
import { TrackerDetail } from './TrackerDetail';
import { AuthorValidationBadge } from '../common/AuthorValidation';
import { requireAuthorValidation } from '../data/authorValidation';
import { BetaNotice } from '../common/BetaNotice';
import { BrandLink } from '../common/BrandLink';

const DEFAULT_FILTERS: TrackerFilterState = {
  status: 'all',
  feas: 'all',
  nok: 'ok',
  mod: 'all',
  sp: 'all',
  model: 'all',
  tag: 'all',
  integ: 'all',
  validation: 'all',
  pipelineQc: 'all',
  experimentalDesign: 'all',
  authorConcordance: 'all',
  availability: 'all',
  q: '',
};
const FILTER_KEYS = Object.keys(DEFAULT_FILTERS) as Array<keyof TrackerFilterState>;

interface DatasetTrackerViewProps {
  onHome: () => void;
  onOpenInExplorer: (id: string) => void;
  initialSelectedAcc?: string | null;
}

// Full-screen, cross-dataset Dataset Tracker view (a sibling of the explorer and
// the gene report). Read-only on the published site; review state is editable only
// under the dev server (canEdit).
export function DatasetTrackerView({ onHome, onOpenInExplorer, initialSelectedAcc = null }: DatasetTrackerViewProps) {
  const { catalog, reviews, loading, error, save, canEdit, setStatus, setNote } = useTrackerData();
  const [f, setF] = useState<TrackerFilterState>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<TrackerSort>({ key: 'feas', dir: 1 });
  const [view, setView] = useState<string>('table');
  const [selectedAcc, setSelectedAcc] = useState<string | null>(initialSelectedAcc);
  const [explorerRefOpen, setExplorerRefOpen] = useState(false);

  useEffect(() => {
    setSelectedAcc(initialSelectedAcc);
  }, [initialSelectedAcc]);

  const rows = catalog?.rows || [];
  const explorer = catalog?.explorer || [];
  const sOf = (acc: string) => statusOfReviews(reviews, acc);

  const tags = useMemo(
    () => Array.from(new Set(rows.map((r) => r.searchTag || `pass${r.pass}`))).sort(),
    [rows],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, inExplorer: 0, related: 0 };
    for (const k of STATUS_KEYS) c[k] = 0;
    for (const r of rows) {
      c.all++;
      c[statusOfReviews(reviews, r.acc)]++;
      if (r.integrated) c.inExplorer++;
      if (r.related) c.related++;
    }
    return c;
  }, [rows, reviews]);

  const drift = useMemo(
    () =>
      rows
        .filter((r) => statusOfReviews(reviews, r.acc) === 'added' && !r.integrated)
        .map((r) => r.acc),
    [rows, reviews],
  );

  const filtered = useMemo(() => filterAndSort(rows, reviews, f, sort), [rows, reviews, f, sort]);

  // Derived from DEFAULT_FILTERS, not hand-compared field by field: a new filter
  // key is then filtered-aware the moment it gets a default, instead of silently
  // leaving the "(filtered)" note behind.
  const isFiltered = FILTER_KEYS.some((k) => f[k] !== DEFAULT_FILTERS[k]);
  const selectedRow = selectedAcc ? rows.find((r) => r.acc === selectedAcc) : null;

  return (
    <div className="tracker-root">
      <header className="site-header">
        <div className="tk-top site-header-row">
          <BrandLink onHome={onHome} />
          <div className="tk-crumb">
            <span>/</span>
            <b>Dataset tracker</b>
            <span>/</span>
            <span>{catalog ? `${catalog.count} candidates` : '…'}</span>
          </div>
          <span className={`tk-mode ${canEdit ? 'edit' : 'ro'}`}>
            {canEdit ? 'dev · editable' : 'read-only'}
          </span>
        </div>
        <BetaNotice />
      </header>

      <div className="tk-body">
        <div className="tk-wrap">
          {error ? (
            <div className="loading">The dataset catalog could not be loaded. Reload the page to try again. {error}</div>
          ) : loading ? (
            <div className="loading">Loading dataset catalog…</div>
          ) : (
            <>
              <TrackerSummary
                counts={counts}
                f={f}
                setF={setF}
                explorerTotal={explorer.length}
                explorerRefOpen={explorerRefOpen}
                setExplorerRefOpen={setExplorerRefOpen}
              />
              <p className="sub2" style={{ margin: '8px 0 12px', lineHeight: 1.5 }}>
                Tracker status records integration progress. Verification badges show the evidence for each dataset.
                Source checks alone do not verify author results.
                {' '}<a href="#/verification">Read the verification process and badge definitions</a>.
              </p>

              {explorerRefOpen && (
                <div className="explorer-ref">
                  <div className="erhead">
                    Datasets in HypoExplorer
                  </div>
                  <div className="ergrid">
                    {explorer.map((d) => (
                      <div className="ercard" key={d.id}>
                        <div className="erid">
                          {d.id}
                          {d.geo ? <span className="eracc">{d.geo}</span> : null}
                        </div>
                        <div className="ername">{d.name}</div>
                        <div className="ermeta">
                          {d.organism} · {d.modality}
                        </div>
                        <div className="erkeys">
                          {(d.accessions?.length ? d.accessions : [d.doi].filter(Boolean)).join(
                            ' · ',
                          ) || '—'}
                        </div>
                        <AuthorValidationBadge record={requireAuthorValidation(d.id)} compact />
                        <button
                          type="button"
                          className="er-open"
                          onClick={() => onOpenInExplorer(d.id)}
                        >
                          Open in explorer →
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="sub2" style={{ marginTop: 8 }}>
                    {counts.inExplorer === 0
                      ? `None of the ${rows.length} candidates below matches an explorer dataset by accession or BioProject.`
                      : `${counts.inExplorer} candidates below are already in the explorer. Use the "In explorer" filter to see them.`}
                    {counts.related > 0
                      ? ` ${counts.related} share a publication with an explorer dataset. The "same paper" label marks these as likely different series.`
                      : ''}
                  </div>
                </div>
              )}

              <TrackerFilters
                f={f}
                setF={setF}
                tags={tags}
                view={view}
                setView={setView}
                canEdit={canEdit}
                save={save}
              />

              {canEdit && drift.length > 0 && (
                <button
                  type="button"
                  className="driftbar"
                  onClick={() => setF({ ...f, status: 'added', integ: 'no' })}
                  title="Show datasets marked Added that are missing from the explorer"
                >
                  {drift.length} datasets marked &quot;Added&quot; are missing from HypoExplorer.
                  Finish integrating them or update their status.
                </button>
              )}

              <div className="shown">
                {filtered.length} shown{isFiltered ? ' (filtered)' : ''}
              </div>

              {view === 'table' ? (
                <TrackerTable
                  rows={filtered}
                  statusOf={sOf}
                  sort={sort}
                  setSort={setSort}
                  selectedAcc={selectedAcc}
                  onSelect={setSelectedAcc}
                  canEdit={canEdit}
                  onSetStatus={setStatus}
                />
              ) : (
                <TrackerBoard
                  rows={filtered}
                  statusOf={sOf}
                  onSelect={setSelectedAcc}
                  canEdit={canEdit}
                  onSetStatus={setStatus}
                />
              )}
            </>
          )}
        </div>
      </div>

      {selectedRow && (
        <TrackerDetail
          row={selectedRow}
          entry={reviews[selectedRow.acc] || {}}
          status={sOf(selectedRow.acc)}
          canEdit={canEdit}
          onSetStatus={setStatus}
          onSetNote={setNote}
          onOpenInExplorer={onOpenInExplorer}
          onClose={() => setSelectedAcc(null)}
        />
      )}
    </div>
  );
}
