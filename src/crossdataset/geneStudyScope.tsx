import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { DatasetCategory } from '../data/datasetCategories';
import { loadDatasetCatalog, registryCards, type DatasetCard } from '../data/datasetCatalog';
import type { CategoryScope } from './forestReport';
import { datasetQuality, QUALITY_BADGES } from '../data/datasetQualityR460';
import { ICONS } from '../common/toolIcons';

export interface GeneStudyFilters {
  minSamples: number;
  requiredChecks: Array<(typeof QUALITY_BADGES)[number]['key']>;
}

export const DEFAULT_GENE_STUDY_FILTERS: GeneStudyFilters = { minSamples: 0, requiredChecks: [] };

/** Dataset-level evidence and measured default-track counts, as in the library. */
function filterGeneStudies(cards: readonly DatasetCard[], filters: GeneStudyFilters): DatasetCard[] {
  return cards.filter((card) => {
    if (filters.minSamples > 0 && (card.nBaseline == null || card.nCase == null
      || Math.min(card.nBaseline, card.nCase) < filters.minSamples)) return false;
    if (filters.requiredChecks.length > 0) {
      const quality = datasetQuality(card.validation);
      if (!filters.requiredChecks.every((key) => quality[key].status === 'pass')) return false;
    }
    return true;
  });
}

type StudySelectionOptions = {
  kind: 'gene' | 'pathway' | 'bars';
  term: string;
  categories: Pick<CategoryScope<DatasetCategory>, 'activeCats' | 'setActiveCats'>;
  datasetScope?: readonly string[] | null;
  studyFilters?: GeneStudyFilters;
  onStudyFiltersChange?: (filters: GeneStudyFilters) => void;
  onDatasetScopeChange?: (ids: string[] | null) => void;
};

/**
 * Study selection owns catalog readiness and the corpus named by a query.
 * Route state stays with the caller; report loading/cancellation stays with
 * useReportQuery. Bars load the resolved cohort and filter categories locally.
 */
export function useStudySelection({
  kind, term, categories: { activeCats, setActiveCats }, datasetScope = null,
  studyFilters, onStudyFiltersChange, onDatasetScopeChange,
}: StudySelectionOptions) {
  const [catalogCards, setCatalogCards] = useState(registryCards);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [localFilters, setLocalFilters] = useState(DEFAULT_GENE_STUDY_FILTERS);
  const filters = studyFilters ?? localFilters;
  const changeFilters = onStudyFiltersChange ?? setLocalFilters;

  useEffect(() => {
    let cancelled = false;
    // The catalog always settles, including registry-only fallback. Unknown
    // counts then fail a sample minimum; they must not leave a query waiting.
    loadDatasetCatalog().then((catalog) => {
      if (!cancelled) { setCatalogCards(catalog.cards); setCatalogLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  const cards = useMemo(() => kind === 'pathway'
    ? catalogCards.filter((card) => card.dataset.supportsPathways)
    : catalogCards, [catalogCards, kind]);
  const eligibleCards = useMemo(() => filterGeneStudies(cards, filters), [cards, filters]);
  const availableDatasets = useMemo(() => eligibleCards
    .filter((card) => kind === 'bars' || !activeCats || activeCats.has(card.dataset.category))
    .map((card) => card.dataset), [eligibleCards, activeCats, kind]);
  // null means all available studies; [] is an intentional empty selection.
  const selectedDatasets = useMemo(() => availableDatasets
    .filter((dataset) => datasetScope === null || datasetScope.includes(dataset.id)), [availableDatasets, datasetScope]);
  const awaitingCounts = filters.minSamples > 0 && catalogLoading;
  const queryTerm = kind === 'bars' ? term.toUpperCase() : term;
  const queryKey = queryTerm && !awaitingCounts
    ? JSON.stringify([queryTerm, selectedDatasets.map((dataset) => dataset.id)]) : '';

  const reset = useCallback(() => {
    setActiveCats(null);
    if (kind !== 'bars') {
      changeFilters(DEFAULT_GENE_STUDY_FILTERS);
      onDatasetScopeChange?.(null);
    }
  }, [setActiveCats, kind, changeFilters, onDatasetScopeChange]);

  return { cards, eligibleCards, availableDatasets, selectedDatasets, awaitingCounts,
    queryKey, filters, changeFilters, reset };
}

/** Every category appears once; selecting a card never supplies a gene. */
export const GENE_STUDY_CATEGORIES: ReadonlyArray<{
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

export function GeneStudySuggestions({ cards, eligibleCards, categories, filters, hasIndividualSelection, onCategory, onFilters, onReset }: {
  cards: readonly DatasetCard[];
  eligibleCards: readonly DatasetCard[];
  categories: ReadonlySet<DatasetCategory> | null;
  filters: GeneStudyFilters;
  hasIndividualSelection: boolean;
  onCategory: (category: DatasetCategory) => void;
  onFilters: (filters: GeneStudyFilters) => void;
  onReset: () => void;
}) {
  return (
    <fieldset className="qsearch-presets">
      <legend className="lbl">Suggested searches</legend>
      <div className="qsearch-preset-grid">
        <ScopeCard name="All datasets" detail={`${cards.length} studies`} icon="library"
          active={categories === null && !filters.minSamples && filters.requiredChecks.length === 0 && !hasIndividualSelection}
          onClick={onReset} />
        {GENE_STUDY_CATEGORIES.map(({ category, icon, tone }) => (
          <ScopeCard key={category} name={category}
            detail={studyCount(eligibleCards.filter((card) => card.dataset.category === category).length)}
            icon={icon} tone={tone} active={!!categories?.has(category)}
            onClick={() => onCategory(category)} />
        ))}
      </div>
      <div className="qsearch-quality-grid">
        <ScopeCard name="Larger groups" detail="At least 5 samples per group" icon="cells"
          title="Measured sample counts for the default population and comparison; counts can differ in other populations."
          active={filters.minSamples > 0}
          onClick={() => onFilters({ ...filters, minSamples: filters.minSamples ? 0 : 5 })} />
        {QUALITY_BADGES.map(({ key, label, description }) => (
          <ScopeCard key={key} name={label} detail="Passed" icon="tracker"
            title={description} active={filters.requiredChecks.includes(key)}
            onClick={() => onFilters({
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

function studyCount(count: number): string {
  return `${count} ${count === 1 ? 'study' : 'studies'}`;
}
