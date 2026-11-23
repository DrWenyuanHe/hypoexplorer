// The study filters both cross-dataset reports show: the category and quality
// cards, the individual-study picker and the count line, inside the collapsed
// "Study filters" disclosure. It renders a StudySelectionState (studySelection.ts)
// and holds no state of its own; only the count wording differs by report kind.

import type { CSSProperties } from 'react';
import type { DatasetCategory } from '../data/datasetCategories';
import { QUALITY_BADGES } from '../data/datasetQualityR460';
import { ICONS } from '../common/toolIcons';
import { DatasetScopePanel, ScopeSummary } from './searchLanding';
import type { StudySelectionState } from './studySelection';

/** Every category appears once; selecting a card never supplies a term. */
export const STUDY_CATEGORY_CARDS: ReadonlyArray<{
  category: DatasetCategory; icon: string; tone: string;
}> = [
  { category: 'Primate atlas', icon: 'cells', tone: '#4C78A8' },
  { category: 'Diet-induced obesity', icon: 'contrast', tone: 'var(--color-obese)' },
  { category: 'Feeding & fasting', icon: 'cells', tone: '#9C755F' },
  { category: 'Leptin, insulin & energy signaling', icon: 'insulin', tone: '#D69E2E' },
  { category: 'Incretin & pharmacology', icon: 'leptin', tone: '#3182CE' },
  { category: 'Microbiome & gut–brain axis', icon: 'coexpression', tone: '#418577' },
  { category: 'Reproduction & development', icon: 'cells', tone: '#B76B8B' },
  { category: 'Developmental programming', icon: 'ko', tone: '#8B7355' },
  { category: 'Aging', icon: 'aging', tone: '#7B61A8' },
  { category: 'Circadian', icon: 'circadian', tone: '#558AA0' },
  { category: 'Stress, immune & disease', icon: 'inflammatory', tone: 'var(--color-obese)' },
];

function ScopeCard({ name, detail, icon, tone = 'var(--accent)', active, onClick, title }: {
  name: string; detail: string; icon: string; tone?: string; active: boolean;
  onClick: () => void; title?: string;
}) {
  return (
    <button type="button" className="qsearch-preset-tile" aria-pressed={active}
      style={{ '--tone': tone } as CSSProperties} title={title} onClick={onClick}>
      <span className="ico">{ICONS[icon]}</span>
      <span className="nm">{name}</span>
      <span className="term">{detail}</span>
    </button>
  );
}

function studyCount(count: number): string {
  return `${count} ${count === 1 ? 'study' : 'studies'}`;
}

function SuggestedStudies({ selection }: { selection: StudySelectionState }) {
  const { cards, eligibleCards, activeCategories, value: { filters, datasetIds }, toggleCategory, setFilters, reset } = selection;
  return (
    <fieldset className="qsearch-presets">
      <legend className="lbl">Suggested searches</legend>
      <div className="qsearch-preset-grid">
        <ScopeCard name="All datasets" detail={`${cards.length} studies`} icon="library"
          active={activeCategories === null && !filters.minSamples && filters.requiredChecks.length === 0 && datasetIds === null}
          onClick={reset} />
        {STUDY_CATEGORY_CARDS.map(({ category, icon, tone }) => (
          <ScopeCard key={category} name={category}
            detail={studyCount(eligibleCards.filter((card) => card.dataset.category === category).length)}
            icon={icon} tone={tone} active={!!activeCategories?.has(category)}
            onClick={() => toggleCategory(category)} />
        ))}
      </div>
      <div className="qsearch-quality-grid">
        <ScopeCard name="Larger groups" detail="At least 5 samples per group" icon="cells"
          title="Measured sample counts for the default population and comparison; counts can differ in other populations."
          active={filters.minSamples > 0}
          onClick={() => setFilters({ ...filters, minSamples: filters.minSamples ? 0 : 5 })} />
        {QUALITY_BADGES.map(({ key, label, description }) => (
          <ScopeCard key={key} name={label} detail="Passed" icon="tracker"
            title={description} active={filters.requiredChecks.includes(key)}
            onClick={() => setFilters({
              ...filters,
              requiredChecks: filters.requiredChecks.includes(key)
                ? filters.requiredChecks.filter((check) => check !== key)
                : [...filters.requiredChecks, key],
            })} />
        ))}
      </div>
    </fieldset>
  );
}

/** The collapsed "Study filters" disclosure a report places beside the results it narrows. */
export function StudySelectionPanel({ selection }: { selection: StudySelectionState }) {
  const { kind, cards, availableDatasets, selectedDatasets, awaitingCounts, value: { filters, datasetIds }, setDatasetIds } = selection;
  const population = kind === 'pathway' ? 'pathway-capable datasets' : 'datasets';
  return (
    <details className="report-filters">
      <summary>Study filters <span>{selectedDatasets.length} datasets selected</span></summary>
      <div>
        <SuggestedStudies selection={selection} />
        <DatasetScopePanel datasets={availableDatasets} selected={datasetIds} onChange={setDatasetIds} allowEmpty />
        <ScopeSummary>
          <span role="status">{awaitingCounts ? 'Loading sample counts…' : `${selectedDatasets.length} of ${cards.length} ${population} selected`}</span>
          {filters.minSamples > 0 && <span className="qsearch-filter-note">Sample counts apply to the default population and comparison; other populations may differ. Unknown counts are excluded.</span>}
          {filters.requiredChecks.length > 0 && <span className="qsearch-filter-note">Only datasets passing each selected quality check are included.</span>}
          {!awaitingCounts && selectedDatasets.length === 0 && <span className="qsearch-filter-note">No datasets match. Change the filters or choose All datasets.</span>}
        </ScopeSummary>
      </div>
    </details>
  );
}
