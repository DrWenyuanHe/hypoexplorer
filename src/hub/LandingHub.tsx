import { useMemo } from 'react';
import { VersionBadge } from '../pwa/VersionBadge';
import { BetaNotice } from '../common/BetaNotice';
import { BRAND } from '../common/brand';
import { DataOriginStatus } from './DataOriginStatus';
import { HubSearch } from './HubSearch';
import { ICONS } from '../common/toolIcons';
import { CompareSetButton } from '../compareset/CompareSetButton';
import type { SearchMode } from '../crossdataset/ExplorerSearchDialog';
import type { CompareSetItem } from '../compareset/compareSetStore';
import type { DatasetCategory } from '../data/datasets';
import type { Dataset } from '../types';

// The landing hub is search-first: the logo, one search box for genes and
// pathways, and two quiet cards for the library and the expression survey.
// Every other tool keeps a route in the top nav or the footer. The hub owns
// navigation only; App wires the destinations.

/** The one hub entrance to gene and pathway search. */
const SEARCH_TOOL = 'Gene & Pathway Explorer';

type HubStatus = 'live' | 'beta';

interface HubItem {
  name: string;
  desc: string;
  icon: string;
  status: HubStatus;
  go: () => void;
}

interface HubSection {
  id: string;
  title: string;
  items: HubItem[];
  /**
   * The slice of the corpus this section is about, as a library scope.
   *
   * Present means the heading is a link into the library; `[]` means the whole
   * library. Absent means it is not — 'Start here' indexes TOOLS rather than
   * studies, so a dataset filter for it would be a link that promises a
   * selection it cannot make.
   */
  browse?: readonly DatasetCategory[];
}

interface HubHandlers {
  onOpenLocalDatasets?: () => void;
  onOpenExpression?: () => void;
  /** Open the shared gene and pathway search dialog. */
  onOpenSearch: () => void;
  onOpenTracker: () => void;
  onOpenLibrary: (categories?: readonly DatasetCategory[]) => void;
}

/** Three main tools and two supporting tools, with their navigation callbacks. */
export function hubSections(
  { onOpenSearch, onOpenTracker, onOpenLibrary, onOpenLocalDatasets, onOpenExpression }: HubHandlers,
  { nDatasets }: { nDatasets: number },
): HubSection[] {
  return [
    {
      id: 'start', title: 'Start here',
      items: [
        { name: 'Expression survey', desc: 'Survey gene expression in defined hypothalamic populations, isolated neurons and bulk tissue.', icon: 'expression', status: 'live', go: () => { if (onOpenExpression) onOpenExpression(); else window.location.hash = '#/expression'; } },
        { name: 'Dataset library', desc: `Browse ${nDatasets} studies by brain region, experimental condition or assay. Each record includes the study design and replicate counts.`, icon: 'library', status: 'live', go: () => onOpenLibrary() },
        { name: SEARCH_TOOL, desc: `Look up a gene or a pathway across ${nDatasets} studies. Compare fold changes, FGSEA scores and leading-edge genes.`, icon: 'gene', status: 'live', go: () => onOpenSearch() },
      ],
    },
    {
      id: 'more', title: 'More tools',
      browse: [],
      items: [
        { name: 'Explore Local Datasets', desc: 'Import your DE and FGSEA tables, confirm columns, and explore genes and pathways. Your files stay in this browser.', icon: 'library', status: 'live', go: () => { if (onOpenLocalDatasets) onOpenLocalDatasets(); else window.location.hash = '#/local-datasets'; } },
        { name: 'Dataset tracker', desc: 'Review screened hypothalamus studies, including those outside the library. Check data availability, replicate counts and sources.', icon: 'tracker', status: 'live', go: () => onOpenTracker() },
      ],
    },
  ];
}

interface LandingHubProps {
  onHome?: () => void;
  onOpenLocalDatasets?: () => void;
  onOpenExpression?: () => void;
  datasets?: Dataset[];
  onEnterTool: (tool: string) => void;
  /**
   * Open the shared gene and pathway search dialog, on the given side or on
   * the side used last.
   */
  onOpenSearch: (mode?: SearchMode) => void;
  /**
   * Submit the hub's search box to the unified results page: typed text as
   * typed, or the gene symbol / pathway id of a picked suggestion.
   */
  onSearch: (query: string) => void;
  onOpenTracker: () => void;
  onOpenLibrary: (categories?: readonly DatasetCategory[]) => void;
  onOpenStatistics: () => void;
  onOpenMethodology: () => void;
  onOpenVerification?: () => void;
  onOpenNomenclature: () => void;
  onChangelog: () => void;
  /** Open the compare-set view on the set's columns (the header indicator). */
  onCompareSet: (items: readonly CompareSetItem[]) => void;
}

export function LandingHub({
  datasets = [],
  onEnterTool,
  onOpenSearch,
  onSearch,
  onOpenTracker,
  onOpenLibrary,
  onOpenStatistics,
  onOpenMethodology,
  onOpenVerification,
  onOpenNomenclature,
  onOpenLocalDatasets,
  onOpenExpression,
  onChangelog,
  onCompareSet,
}: LandingHubProps) {
  const [primary, secondary] = useMemo(
    () => hubSections(
      { onOpenSearch: () => onOpenSearch(), onOpenTracker, onOpenLibrary, onOpenLocalDatasets, onOpenExpression },
      { nDatasets: datasets.length },
    ),
    [onOpenSearch, onOpenTracker, onOpenLibrary, onOpenLocalDatasets, onOpenExpression, datasets.length],
  );
  const tool = (name: string) => [...primary.items, ...secondary.items].find((item) => item.name === name);

  // Counted off the registry rather than written down, so a dataset added
  // tomorrow moves the copy instead of dating it.
  const nStudies = datasets.length;
  const nSpecies = new Set(datasets.map((d) => d.organism)).size;
  const corpus = `${nStudies} ${nStudies === 1 ? 'study' : 'studies'} · ${nSpecies} species`;

  const CARDS = [
    { item: tool('Dataset library'), title: 'Browse the dataset library', detail: corpus },
    { item: tool('Expression survey'), title: 'Survey baseline expression', detail: 'By population, study condition and tissue' },
  ];

  return (
    <div className="hub">
      <div className="hub-ribbon" />
      <BetaNotice />

      <header className="hub-bar">
        <nav className="hub-nav" aria-label="Sections">
          <button type="button" onClick={() => onOpenLibrary()}>Library</button>
          <button type="button" aria-haspopup="dialog" onClick={() => onOpenSearch('gene')}>Genes</button>
          <button type="button" aria-haspopup="dialog" onClick={() => onOpenSearch('pathway')}>Pathways</button>
          <button type="button" onClick={tool('Expression survey')?.go}>Survey</button>
          <button type="button" onClick={onOpenMethodology}>Methods</button>
        </nav>
        <div className="hub-bar-end">
          <CompareSetButton onCompare={onCompareSet} onOpenLibrary={() => onOpenLibrary()} />
        </div>
      </header>

      <main className="hub-main">
        <div className="hub-hero">
          <h1 className="hub-mark">
            <img src={BRAND.logo} width={320} height={72} alt="HypoExplorer" />
          </h1>
          <p className="hub-tagline">Where a gene is expressed in the hypothalamus, and how it changes across {nStudies} public studies</p>
          <HubSearch onSearch={onSearch} />
          <div className="hub-cards">
            {CARDS.map(({ item, title, detail }) => item && (
              <button key={item.name} type="button" className="hub-card" onClick={item.go}>
                <strong>
                  <span className="hub-card-icon">{ICONS[item.icon]}</span>
                  {title}
                </strong>
                <span>{detail}</span>
              </button>
            ))}
          </div>
        </div>
      </main>

      <footer className="hub-foot">
        <div className="hub-foot-meta">
          <span className="hub-foot-corpus">{corpus}</span>
          {/* Both answer "is what I am looking at current and working?": the
              light for the data origin, the badge for the app shell. */}
          <DataOriginStatus />
          <VersionBadge />
          <button type="button" className="hub-foot-link" onClick={onChangelog}>Changelog</button>
        </div>
        <nav className="hub-util" aria-label="Reference">
          <div className="hub-util-row">
            <span className="hub-util-label">Explore</span>
            <div className="hub-util-links">
              <button type="button" onClick={() => onOpenLibrary()}>Dataset library</button>
              <a className="site-reference-link" href="/studies/">Study pages</a>
              <a className="site-reference-link" href="/topics/">Research topics</a>
              {secondary.items.map((item) => (
                <button key={item.name} type="button" onClick={item.go}>
                  {item.name === 'Explore Local Datasets' ? 'Local datasets' : item.name}
                </button>
              ))}
            </div>
          </div>
          <div className="hub-util-row">
            <span className="hub-util-label">Analysis</span>
            <div className="hub-util-links">
              <button type="button" onClick={() => onEnterTool('qc')}>Quality control</button>
              <button type="button" onClick={onOpenStatistics}>Statistics</button>
              <button type="button" onClick={onOpenVerification ?? (() => { window.location.hash = '#/verification'; })}>Data verification</button>
              <button type="button" onClick={onOpenNomenclature}>Gene nomenclature</button>
              <button type="button" onClick={onOpenMethodology}>Methodology</button>
            </div>
          </div>
          <div className="hub-util-row">
            <span className="hub-util-label">Reference</span>
            <div className="hub-util-links">
              <a className="site-reference-link" href="/methods/">Methods guide</a>
              <button type="button" onClick={() => onEnterTool('datasources')}>Sources &amp; acknowledgements</button>
              <a className="site-reference-link" href="/how-to-cite/">How to cite</a>
              <a className="site-reference-link" href="/about/">About</a>
            </div>
          </div>
        </nav>
      </footer>
    </div>
  );
}
