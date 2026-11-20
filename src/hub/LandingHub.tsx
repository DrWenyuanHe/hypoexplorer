import { useMemo } from 'react';
import { VersionBadge } from '../pwa/VersionBadge';
import { BetaNotice } from '../common/BetaNotice';
import { BRAND } from '../common/brand';
import { DataOriginStatus } from './DataOriginStatus';
import { HubSearch } from './HubSearch';
import { ICONS } from '../common/toolIcons';
import { datasetHref } from '../utils/appLinks';
import { COMPARE_TRACK } from '../explorer/explorerPosition';
import { CompareSetButton } from '../compareset/CompareSetButton';
import type { CompareSetItem } from '../compareset/compareSetStore';
import type { DatasetCategory } from '../data/datasets';
import type { Dataset } from '../types';

// The landing hub is search-first: the logo, one search box for genes and
// pathways, and three quiet cards: the library, the expression survey and the
// macaque single-nucleus atlas. Every other tool keeps a route in the top nav
// or the footer. The hub owns navigation only; App wires the destinations.

/**
 * The study the hub links to directly: the primate single-nucleus atlas, whose
 * cell-population comparison is its signature view. Only the id is written
 * down; the card's copy is read off the registry entry.
 */
export const HUB_ATLAS_ID = 'macaque_snrna';

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
  onOpenExpression?: () => void;
  onOpenTracker: () => void;
  onOpenLibrary: (categories?: readonly DatasetCategory[]) => void;
}

/**
 * Two main tools and one supporting tool, with their navigation callbacks.
 * Gene and pathway search is not listed: it is the hub's own search box.
 */
export function hubSections(
  { onOpenTracker, onOpenLibrary, onOpenExpression }: HubHandlers,
  { nDatasets }: { nDatasets: number },
): HubSection[] {
  return [
    {
      id: 'start', title: 'Start here',
      items: [
        { name: 'Expression survey', desc: 'Survey gene expression in defined hypothalamic populations, isolated neurons and bulk tissue.', icon: 'expression', status: 'live', go: () => { if (onOpenExpression) onOpenExpression(); else window.location.hash = '#/expression'; } },
        { name: 'Dataset library', desc: `Browse ${nDatasets} studies by brain region, experimental condition or assay. Each record includes the study design and replicate counts.`, icon: 'library', status: 'live', go: () => onOpenLibrary() },
      ],
    },
    {
      id: 'more', title: 'More tools',
      browse: [],
      items: [
        { name: 'Dataset tracker', desc: 'Review screened hypothalamus studies, including those outside the library. Check data availability, replicate counts and sources.', icon: 'tracker', status: 'live', go: () => onOpenTracker() },
      ],
    },
  ];
}

interface LandingHubProps {
  onHome?: () => void;
  onOpenExpression?: () => void;
  datasets?: Dataset[];
  onEnterTool: (tool: string) => void;
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
  onSearch,
  onOpenTracker,
  onOpenLibrary,
  onOpenStatistics,
  onOpenMethodology,
  onOpenVerification,
  onOpenNomenclature,
  onOpenExpression,
  onChangelog,
  onCompareSet,
}: LandingHubProps) {
  const [primary, secondary] = useMemo(
    () => hubSections(
      { onOpenTracker, onOpenLibrary, onOpenExpression },
      { nDatasets: datasets.length },
    ),
    [onOpenTracker, onOpenLibrary, onOpenExpression, datasets.length],
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

  // The atlas card: the whole card opens the study, and a second control below
  // the copy opens its population-vs-population Compare view. Two sibling
  // buttons rather than one nested in the other, so each has its own name and
  // focus stop. Absent from the registry → no card, rather than a dead link.
  const atlas = datasets.find((d) => d.id === HUB_ATLAS_ID);
  const atlasDetail = atlas
    ? [atlas.modality, atlas.groups.map((g) => g.label).join(' vs ')].filter(Boolean).join(' · ')
    : '';
  const atlasNoun = atlas?.trackNoun ?? 'population';

  return (
    <div className="hub">
      <div className="hub-ribbon" />
      <BetaNotice />

      <header className="hub-bar">
        <nav className="hub-nav" aria-label="Sections">
          <button type="button" onClick={() => onOpenLibrary()}>Library</button>
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
            {atlas && (
              <div className="hub-card hub-card--split">
                <button
                  type="button"
                  className="hub-card-main"
                  title={`${atlas.name} · ${atlas.citation}`}
                  onClick={() => { window.location.hash = datasetHref(atlas.id); }}
                >
                  <strong>
                    <span className="hub-card-icon">{ICONS.cells}</span>
                    Explore the macaque atlas
                  </strong>
                  <span>{atlasDetail}</span>
                </button>
                <button
                  type="button"
                  className="hub-card-sub"
                  onClick={() => { window.location.hash = datasetHref(atlas.id, COMPARE_TRACK); }}
                >
                  Compare cell {atlasNoun}s <span aria-hidden="true">→</span>
                </button>
              </div>
            )}
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
              {secondary.items.map((item) => (
                <button key={item.name} type="button" onClick={item.go}>{item.name}</button>
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
