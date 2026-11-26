// The explorer screen: the topbar, the load-error banner, the study line, the
// track sidebar, the hero with its contrast selector, the tabs and Compare, the
// loading overlay and the dataset-info panel.
//
// It draws from the explorer's `screen` (useExplorer.ts) and moves the explorer
// only through `onNavigate`, which App has already paired with the router's
// `supersede`: every control here is a user's own move, so it retires any link
// still landing first. The screen never sees the raw `navigate`.
//
// App mounts this only while the explorer is on screen, so its own state (the
// dataset-info panel) starts closed on each visit. The changelog and the
// "Study details & verification" disclosure are App's: the hub opens the
// changelog before entering, and the disclosure stays open as a reviewer steps
// from study to study through the library.

import { useCallback, useMemo, useState } from 'react';
import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import { trackColor } from '../data/datasetMeta';
import { COLOR_WARNING_BG, COLOR_WARNING_TEXT, FONT_MONO, FONT_SANS } from '../styles/constants';
import { popDataFor } from '../data/trackData';
import { useOriginDiagnosis } from '../data/useOriginDiagnosis';
import { CLOUDFLARE_STATUS_URL, explainOrigin, shouldLinkStatusPage } from '../data/originHealth';
import { listDatasets } from '../data/datasets';
import { nomenclatureAuthorityForStoredDatasetSymbols } from '../data/nomenclature';
import { contrastArmCounts } from '../data/contrasts';
import { getCellSubname } from '../utils/format';
import { ErrorBoundary } from '../ErrorBoundary';
import { PopWarningBadge } from '../common/PopWarningBadge';
import { VersionBadge } from '../pwa/VersionBadge';
import { LoadingOverlay } from '../common/LoadingOverlay';
import { Spinner } from '../common/Spinner';
import { Skeleton } from '../common/Skeleton';
import { BrandLink } from '../common/BrandLink';
import { CellNavigator } from './CellNavigator';
import { EXPLORER_TABS, explorerTabAvailable } from './explorerTabs';
import type { NavigationIntent } from './explorerPosition';
import type { ExplorerScreen } from './useExplorer';
import { comparePair } from '../compare/compareView';
import { ArmPills, ArmVariesBadge, factsFromMeta } from '../common/StudyMetadata';
import { datasetExternalLinks } from '../utils/datasetLinks';
import { ShareAnalysisButton } from '../common/ShareAnalysisButton';
import { CompareSetButton } from '../compareset/CompareSetButton';
import { CompareSetToggle } from '../compareset/CompareSetToggle';
import { toggleItem, useCompareSet, type CompareSetItem } from '../compareset/compareSetStore';
import type { CompareSetRouteItem } from '../utils/appLinks';
import type { PopData } from '../types';
import {
  ChangelogTab, CircadianTab, CompareTab, DatasetInfoPanel, DatasetVerificationContext, GeneExplorerTab,
  PathwayExplorerTab, QCTab,
} from '../appViews';
import '../common/headerControl.css';

// The hero's provenance controls (the paper link and Dataset info): one
// neutral bordered treatment, so neither reads as the view's one accent.
const HERO_LINK_STYLE: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, boxSizing: 'border-box', height: 22, padding: '0 8px',
  borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: FONT_SANS, lineHeight: 1,
  textDecoration: 'none', whiteSpace: 'nowrap', cursor: 'pointer',
  border: '1px solid var(--border-dark)', background: 'var(--bg-panel)', color: 'var(--text-mono)',
};

export interface ExplorerShellProps {
  screen: ExplorerScreen;
  /** A user's own move: App retires any link still landing, then navigates. */
  onNavigate: (intent: NavigationIntent) => void;
  onHome: () => void;
  onOpenLibrary: (entry?: { datasetId?: string | null }) => void;
  onOpenCompareSet: (items: readonly CompareSetRouteItem[]) => void;
  onOpenMethodology: () => void;
  onOpenTracker: (acc?: string | null) => void;
  changelogOpen: boolean;
  setChangelogOpen: Dispatch<SetStateAction<boolean>>;
  studyDetailsOpen: boolean;
  setStudyDetailsOpen: Dispatch<SetStateAction<boolean>>;
}

export function ExplorerShell({
  screen, onNavigate: navigateByUser, onHome: goHome, onOpenLibrary: openLibrary, onOpenCompareSet: openCompareSet,
  onOpenMethodology: openMethodology, onOpenTracker: openTracker,
  changelogOpen: showChangelog, setChangelogOpen: setShowChangelog,
  studyDetailsOpen: showStudyDetails, setStudyDetailsOpen: setShowStudyDetails,
}: ExplorerShellProps) {
  const {
    dataset, contrast, contrasts: datasetContrasts, trackId: activeTrackId, tab: activeTab, isCompare,
    store, session, compare: compareView,
  } = screen;
  const {
    meta: datasetMeta, qc: datasetQC, getTrack, loadingTrack, loadingProgress, loadError, retry: retryLoad,
  } = store;
  const { genes: geneSelection, volcano, pathway, cellSearch, setCellSearch } = session;
  const isQC = !isCompare && activeTab === 'qc';
  const compareViewHere = compareView.link;
  const openLibraryPlain = useCallback(() => openLibrary(), [openLibrary]);

  // The dataset-metadata panel (the hero's ⓘ button) — dataset-level provenance.
  const [showDatasetInfo, setShowDatasetInfo] = useState(false);

  // Selector rows bucketed by their authored `group` (adjacent runs preserve
  // manifest order; `null` = ungrouped, rendered as flat options).
  const contrastOptGroups = useMemo(() => {
    const out: Array<{ group: string | null; contrasts: typeof datasetContrasts }> = [];
    for (const c of datasetContrasts) {
      const g = c.group ?? null;
      const last = out[out.length - 1];
      if (last && last.group === g) last.contrasts.push(c);
      else out.push({ group: g, contrasts: [c] });
    }
    return out;
  }, [datasetContrasts]);

  // Data bundles come from a SEPARATE origin (the R2 custom domain). When that
  // origin is unreachable the app renders perfectly while every dataset fails,
  // which reads as "this site is broken" unless we say otherwise. Probe only
  // while an error is actually on screen.
  const originDiagnosis = useOriginDiagnosis(Boolean(loadError));
  const originExplanation = explainOrigin(originDiagnosis);

  // Build popData for the current track. Pass dataset + contrast so buildPopData
  // can expose resolved groups / groupSamples / sampleOrder. `getTrack`'s
  // identity changes with the cache, so this re-reads when a pathway sibling
  // hydrates after first paint.
  const popData = useMemo(
    () => popDataFor(getTrack(activeTrackId), dataset, contrast),
    [getTrack, activeTrackId, dataset, contrast],
  );

  // One popData slice per declared contrast (multi-contrast datasets only) —
  // the Gene Explorer's "Across comparisons" matrix reads a selected gene from
  // every angle of a factorial design at once. Cheap: the raw track is already
  // loaded, popCache memoizes per (raw, contrast), and the [] for
  // single-contrast datasets skips the transform entirely.
  const contrastSlices = useMemo(() => {
    if (datasetContrasts.length < 2) return [];
    const raw = getTrack(activeTrackId);
    if (!raw) return [];
    const out = [];
    for (const c of datasetContrasts) {
      const pd = popDataFor(raw, dataset, c);
      if (pd) out.push({ contrast: c, popData: pd });
    }
    return out;
  }, [datasetContrasts, getTrack, activeTrackId, dataset]);

  const selectTrack = useCallback((trackId: string) => navigateByUser({ type: 'track', trackId }), [navigateByUser]);
  const selectTab = useCallback((tab: string) => navigateByUser({ type: 'tab', tab }), [navigateByUser]);

  // Cross-tab action: merge a list of genes into the Gene Explorer selection
  // and switch to the Gene Explorer tab. Used by Pathway Explorer's
  // "Send leading-edge genes →" button.
  const { addMany: addGenes } = geneSelection;
  const sendGenesToGeneExplorer = useCallback((genes: string[]) => {
    if (!genes?.length) return;
    addGenes(genes);
    navigateByUser({ type: 'tab', tab: 'gene' });
  }, [addGenes, navigateByUser]);

  // The compare set, for the topbar's toggle — subscribed here so the toggle
  // follows a change made from any other surface. The toggle names the ACTIVE
  // track, which is how a single macaque population gets into the set.
  const compareSet = useCompareSet();
  const topbarItem = useMemo<CompareSetItem>(
    () => ({ datasetId: dataset.id, trackId: activeTrackId }),
    [dataset.id, activeTrackId],
  );
  const topbarInSet = compareSet.some((it) => it.datasetId === topbarItem.datasetId && it.trackId === topbarItem.trackId);

  const currentMeta = isCompare ? null : popData?.meta;
  const currentQC   = isCompare ? null : popData?.qc;

  const populations = datasetMeta?.populations || [];
  // The pair Compare opens on, from this dataset's own populations.
  const comparePops = useMemo(
    () => comparePair(dataset, datasetMeta?.populations ?? []),
    [dataset, datasetMeta],
  );
  // Guard: getActiveContrast returns null for a (hypothetical) dataset authored
  // with no contrasts. Every registered dataset has one, so this never fires
  // today — but degrade gracefully (skip the hero chips) instead of crashing.
  const baselineGroup = contrast?.baseline;
  const caseGroup = contrast?.caseGroup;

  // Hero replicate counts follow the ACTIVE contrast's arms. The loaded track's
  // groupSamples (∩ samplesKept) is authoritative for factorial cells, with
  // groupN and the loaded/meta pooled counts as fallbacks. Compare explicitly
  // suppresses loaded membership/QC here as a policy guard.
  const { nBaseline, nCase, baselineTitle, caseTitle } = contrastArmCounts(
    contrast, isCompare ? null : popData, datasetMeta, activeTrackId,
  );

  const activeTrackColor = trackColor(datasetMeta, activeTrackId);

  // Dataset-level facts for the study bar, derived from the meta this shell has
  // already loaded. The library reads the same facts from the precomputed
  // catalog instead; factsFromMeta exists so both report identical numbers.
  const datasetFacts = useMemo(() => factsFromMeta(dataset, datasetMeta), [dataset, datasetMeta]);

  // Dataset-level external links (GEO/ArrayExpress · DOI · PubMed). The hero shows
  // the primary one inline; the full set lives in the DatasetInfoPanel.
  const datasetLinks = useMemo(() => datasetExternalLinks(dataset), [dataset]);
  const primaryLink = datasetLinks.find((l) => l.kind === 'repository') ?? datasetLinks[0] ?? null;

  return (
    <div className="explorer-shell" style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-app)', overflow: 'hidden' }}>
      {/* Slim topbar: logo and utilities on one row. The dataset, population
          and tab are named once each below it (study line, hero, active tab),
          so the topbar repeats none of them. */}
      <header className="site-header">
        <div className="site-header-row" style={{
          flexShrink: 0, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
          padding: '8px var(--site-header-padding)', display: 'flex', alignItems: 'center', minHeight: 44, gap: '8px 16px',
        }}>
          <BrandLink onHome={goHome} />
          <div className="site-header-controls" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Puts the ACTIVE track into the compare set — the way a single
                population joins a set of whole studies. The Compare pseudo-track
                is not a track, so it has no toggle. */}
            {!isCompare && (
              <CompareSetToggle
                size="header"
                inSet={topbarInSet}
                name={activeTrackId === dataset.defaultTrack ? dataset.name : `${dataset.name} ${activeTrackId}`}
                onToggle={() => toggleItem(topbarItem)}
              />
            )}
            <CompareSetButton onCompare={openCompareSet} onOpenLibrary={openLibraryPlain} />
            <ShareAnalysisButton />
            <VersionBadge />
            <a href="#/methodology" className="header-control">
              Methods
            </a>
            <button type="button" onClick={() => setShowChangelog((c) => !c)}
              className={showChangelog ? 'header-control header-control--on header-control--strong' : 'header-control'}>
              Changelog
            </button>
          </div>
        </div>
      </header>

      {/* Load error (pinned above body-row so it appears even on initial load failure) */}
      {loadError && (
        <div role="alert" style={{ padding: '8px 16px', background: 'var(--danger-bg)', borderBottom: '1px solid var(--danger-border)', fontSize: 12, display: 'flex', gap: 8, alignItems: 'flex-start', flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ color: 'var(--danger-text)' }}>{loadError}</span>
            {/* Why it failed, once the probe has an answer. Kept on its own line
                and in the muted tone: it is context for the error above, not a
                second error. */}
            {originExplanation && (
              <div style={{ color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5, maxWidth: '78ch' }}>
                {originExplanation}
                {shouldLinkStatusPage(originDiagnosis) && (
                  <>
                    {' '}
                    <a href={CLOUDFLARE_STATUS_URL} target="_blank" rel="noreferrer noopener"
                      style={{ color: 'var(--text-link, var(--danger-text))' }}>
                      Check Cloudflare status
                    </a>
                    .
                  </>
                )}
              </div>
            )}
          </div>
          <button type="button" onClick={retryLoad}
            style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer', flexShrink: 0 }}>
            Retry
          </button>
        </div>
      )}

      {/* Study line — the dataset's identity, on screen at every tab and in
          Compare mode, in ONE line: name, organism, modality and the design's
          arms. Region, preparation and the dataset's verification record sit
          behind the "Study details & verification" disclosure, so they stay one
          click away without stacking above the data on every view.
          Full width rather than inside the main column, because it describes the
          dataset and the sidebar beside it describes tracks within that dataset. */}
      <div className="explorer-study" style={{ flexShrink: 0, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}>
      <div className="explorer-study-bar" style={{
        padding: '5px 24px', display: 'flex', alignItems: 'center', gap: '4px 10px', flexWrap: 'wrap',
        fontSize: 11.5, color: 'var(--text-muted)',
      }}>
        {/* The dataset name. With more than one dataset registered it is the
            way back into the library — the surface that can show a study's
            design and replicate counts before you commit to it. A
            single-dataset build has nothing to browse, so it stays text. */}
        {listDatasets().length > 1 ? (
          <button
            type="button"
            className="explorer-study-dataset"
            aria-label={`Active dataset: ${dataset.name}. Browse all datasets`}
            title="Browse all datasets"
            onClick={() => openLibrary({ datasetId: dataset.id })}
          >
            <span className="explorer-study-dataset-name">{dataset.name}</span>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              style={{ flexShrink: 0 }}>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        ) : (
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{dataset.name}</span>
        )}
        <span aria-hidden="true" style={{ width: 1, height: 14, background: 'var(--border)' }} />
        <span style={{ fontStyle: 'italic' }}>{dataset.organism}</span>
        <span>{dataset.modality}</span>
        {/* Outside Compare this shows the DESIGN only: the hero below already
            carries N for the selected track, and a second dataset-level N beside
            it would read as a contradiction on any dataset whose tracks disagree
            — the macaque atlas is 3v3 on 55 populations and drops to an arm of 2
            on five.
            Compare mode has no hero pills, so there the count has nowhere else
            to live and this shows it. */}
        {baselineGroup && caseGroup && (
          <>
            <span aria-hidden="true" style={{ width: 1, height: 14, background: 'var(--border)' }} />
            <ArmPills
              size="sm"
              variant={isCompare ? 'counts' : 'design'}
              baseline={baselineGroup} caseGroup={caseGroup}
              nBaseline={datasetFacts.nBaseline} nCase={datasetFacts.nCase}
              nVaries={isCompare && datasetFacts.nVaries}
              trackNoun={dataset.trackNoun || 'track'}
            />
            {/* A contrast authored `exploratory` is one the source paper never
                ran — a re-analysis whose meaning does not follow from its arm
                names. That warning belongs beside the volcano the user is
                reading, not only inside the Dataset info modal, so it rides
                here, outside the disclosure: a scientific caveat is never
                folded away. Gated on the flag, NOT on description presence: a
                description can also annotate a faithful re-fit of the paper's
                own axis (e.g. the GSE135639 maturation contrasts), which must
                not be branded exploratory. */}
            {contrast?.description && contrast.exploratory && (
              // A <button>, not a <span title>: a title attribute on a
              // non-focusable element is unreachable by keyboard and by touch,
              // which would leave the actual explanation available only to a
              // mouse user hovering. This opens the full dataset record, where
              // the contrast row carries the same text as readable content.
              <button
                type="button"
                onClick={() => setShowDatasetInfo(true)}
                title={contrast.description}
                aria-label={`Exploratory contrast. ${contrast.description} Open the full dataset record.`}
                style={{
                  fontSize: 10, fontFamily: FONT_MONO, fontWeight: 600, cursor: 'pointer',
                  padding: '2px 7px', borderRadius: 999, color: COLOR_WARNING_TEXT,
                  background: COLOR_WARNING_BG, border: '1px solid rgba(217, 119, 6, 0.34)',
                }}
              >
                exploratory contrast
              </button>
            )}
            {!isCompare && datasetFacts.nVaries && (
              <ArmVariesBadge
                trackNoun={dataset.trackNoun || 'track'}
                fontSize={10}
                title={`Replicate counts differ across this dataset's ${dataset.trackNoun || 'track'}s — the hero shows the selected one's.`}
              />
            )}
          </>
        )}
        <span className="explorer-study-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="explorer-study-toggle"
            aria-expanded={showStudyDetails} aria-controls="explorer-study-details"
            onClick={() => setShowStudyDetails((open) => !open)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 11.5, fontWeight: 600, color: 'var(--text-mono)', background: 'none',
              border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
            }}>
            Study details &amp; verification
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              style={{ flexShrink: 0, transform: showStudyDetails ? 'rotate(180deg)' : undefined }}>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </span>
      </div>

      {/* Mounted only while open, so the collapsed line costs no layout. The
          verification record is the same component the explorer always showed. */}
      {showStudyDetails && (
        <div id="explorer-study-details" className="explorer-study-details" style={{ borderTop: '1px solid var(--border)' }}>
          <dl className="explorer-study-facts" style={{
            margin: 0, padding: '7px 24px', display: 'flex', flexWrap: 'wrap', gap: '4px 18px',
            fontSize: 11.5, color: 'var(--text-primary)',
          }}>
            {([
              ['Organism', dataset.organism],
              ['Modality', dataset.modality],
              ['Region', dataset.region],
              ['Preparation', dataset.preparation],
            ] as const).filter(([, value]) => Boolean(value)).map(([term, value]) => (
              <div key={term} style={{ display: 'flex', gap: 5 }}>
                <dt style={{ color: 'var(--text-muted)' }}>{term}</dt>
                <dd style={{ margin: 0, fontStyle: term === 'Organism' ? 'italic' : undefined }}>{value}</dd>
              </div>
            ))}
          </dl>
          <DatasetVerificationContext key={dataset.id} datasetId={dataset.id} contrastId={contrast?.id} />
        </div>
      )}
      </div>

      {/* Body row — sidebar + main */}
      <div className="explorer-body" style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
        {/* Sidebar — cell navigator */}
        <CellNavigator
          dataset={dataset}
          meta={datasetMeta}
          populations={populations}
          activeTrackId={activeTrackId}
          isCompare={isCompare}
          search={cellSearch}
          onSearchChange={setCellSearch}
          onSelectTrack={selectTrack}
          onLeaveCompare={() => navigateByUser({ type: 'leaveCompare' })}
        />

        {/* Main column */}
        <div className="explorer-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          {/* Accent strip: the active track's colour. Compare has no single
              track, so it has no strip. */}
          {!isCompare && (
            <div aria-hidden="true" style={{ height: 4, flexShrink: 0, background: activeTrackColor }} />
          )}

          {/* Hero. Single-track mode carries the track, its arms, the contrast
              selector and the detected-gene count; Compare mode is one slim
              line, because the populations it compares are chosen right below. */}
          <div className={isCompare ? 'explorer-hero explorer-hero--compare' : 'explorer-hero'} style={{
            flexShrink: 0, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
            padding: isCompare ? '5px 20px' : '8px 20px', display: 'flex', alignItems: 'center',
            gap: isCompare ? 12 : '8px 18px', flexWrap: 'wrap',
          }}>
            {isCompare ? (
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: 'var(--text-mono)',
              }}>
                Compare populations
              </span>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span aria-hidden="true" style={{
                  width: 11, height: 11, borderRadius: '50%',
                  background: activeTrackColor,
                  boxShadow: `0 0 0 3px ${activeTrackColor}20`,
                  flexShrink: 0,
                }} />
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0 10px', flexWrap: 'wrap', minWidth: 0 }}>
                  <div style={{
                    fontFamily: FONT_MONO, fontSize: 20, fontWeight: 700,
                    lineHeight: 1.15, color: 'var(--text-primary)', letterSpacing: '-0.02em',
                  }}>
                    {activeTrackId}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {`${getCellSubname(activeTrackId, datasetMeta?.labels)}${datasetMeta?.types?.[activeTrackId] ? ` · ${datasetMeta?.types?.[activeTrackId]}` : ''}`}
                  </div>
                </div>
              </div>
            )}

            {!isCompare && baselineGroup && caseGroup && (
              <>
                {/* Low-power warning judged on the ACTIVE contrast's arm
                    counts (a factorial cell contrast can be 3v4 while the
                    pooled track is 8v9, and vice versa). The badge itself
                    stays silent when both arms have ≥3 replicates. */}
                <ArmPills
                  size="lg"
                  baseline={baselineGroup} caseGroup={caseGroup}
                  nBaseline={nBaseline} nCase={nCase}
                  baselineTitle={baselineTitle} caseTitle={caseTitle}
                  after={currentQC && (
                    <PopWarningBadge
                      nNormal={nBaseline ?? undefined}
                      nObese={nCase ?? undefined}
                      samplesKept={currentQC.samplesKept}
                    />
                  )}
                />
                {/* Contrast selector — only when the dataset declares >1 contrast.
                    Single-contrast datasets render nothing here (unchanged UX).
                    Contrasts sharing an authored `group` (the axes of a
                    factorial design — diet effect vs maturation) render under
                    one <optgroup>, so the 2×2's structure is visible in the
                    selector itself; ungrouped contrasts stay flat. */}
                {datasetContrasts.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                      textTransform: 'uppercase', color: 'var(--text-muted)',
                    }}>
                      Contrast
                    </span>
                    <select
                      aria-label="Active contrast"
                      value={contrast?.id ?? ''}
                      onChange={(e) => navigateByUser({ type: 'contrast', contrastId: e.target.value })}
                      style={{
                        fontSize: 12, fontFamily: FONT_MONO,
                        color: 'var(--text-primary)', background: 'var(--bg-panel)',
                        border: '1px solid var(--border-dark)', borderRadius: 6,
                        padding: '3px 8px', cursor: 'pointer',
                      }}>
                      {contrastOptGroups.map((og) => og.group === null
                        ? og.contrasts.map((c) => (
                          <option key={c.id} value={c.id} title={c.description}>{c.label}</option>
                        ))
                        : (
                          <optgroup key={og.group} label={og.group}>
                            {og.contrasts.map((c) => (
                              <option key={c.id} value={c.id} title={c.description}>{c.label}</option>
                            ))}
                          </optgroup>
                        ))}
                    </select>
                  </div>
                )}
                {/* The count is a figure (ink, mono); the words around it are
                    prose (muted, sans). Not Signal Orange: that marks the one
                    active element, and this is a readout. */}
                <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  <strong style={{ fontFamily: FONT_MONO, color: 'var(--text-primary)', fontWeight: 600, fontSize: 13 }}>
                    {(currentMeta?.nGenes || datasetMeta?.nGenes?.[activeTrackId] || 0).toLocaleString()}
                  </strong>
                  {' '}{dataset.featureLabel?.toLowerCase() || 'gene'}s detected
                </div>
              </>
            )}

            {/* Dataset provenance, in both modes as compact controls: the
                primary external link inline, and the ⓘ button for the full
                DatasetInfoPanel. Organism and modality live in the study line
                above, which is on screen at every tab. */}
            <div className="explorer-hero-links" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {primaryLink && (
                <a href={primaryLink.href} target="_blank" rel="noopener noreferrer" title={primaryLink.title}
                  className="explorer-hero-link" style={HERO_LINK_STYLE}>
                  {primaryLink.label}
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>
                </a>
              )}
              <button type="button" onClick={() => setShowDatasetInfo(true)}
                className="explorer-hero-link" style={HERO_LINK_STYLE}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="7.5" r="0.6" fill="currentColor" /></svg>
                Dataset info
              </button>
            </div>
          </div>

          {/* Content */}
          {showChangelog ? (
            <ErrorBoundary><ChangelogTab onClose={() => setShowChangelog(false)} /></ErrorBoundary>
          ) : isCompare ? (
            <div className="explorer-compare" style={{ flex: 1, overflow: 'hidden' }}>
              <ErrorBoundary key={`compare-${dataset.id}`}>
                {/* Compare loads its populations itself, as track columns (see
                    ../data/trackColumns): each has its own loading / failed /
                    Retry state, and none drives the global overlay.
                    It waits for THIS dataset's meta: a `/compare` link lands in
                    the same render as the dataset switch, when the store's meta
                    is still null, and CompareTab takes its starting selection
                    once — mounting early chose populations the dataset lacks. */}
                {datasetMeta ? (
                  <CompareTab key={compareView.epoch} meta={datasetMeta} dataset={dataset} contrast={contrast}
                    defaultPops={comparePops}
                    initialView={compareViewHere} onViewChange={compareView.report} />
                ) : (
                  <div role="status" style={{ padding: 24 }}><Spinner size={14} label="Loading populations…" /></div>
                )}
              </ErrorBoundary>
            </div>
          ) : (popData || isQC) ? (
            <>
              <div className="explorer-tabs" style={{
                flexShrink: 0, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
                display: 'flex', padding: '0 16px',
              }}>
                {/* Which tabs this dataset/track can answer is now one rule in
                    explorerTabs — shared with the router, so a `.../<tab>` deep
                    link can never open a tab this bar would not have rendered
                    (a Pathway Explorer with no enrichment behind it, a Circadian
                    tab for a track with no time course). */}
                {EXPLORER_TABS
                  .filter(([id]) => explorerTabAvailable(dataset, activeTrackId, id))
                  .map(([id, label]) => (
                    <button type="button" key={id} onClick={() => selectTab(id)}
                      className={activeTab === id ? 'tab-btn tab-btn--active' : 'tab-btn'}>{label}</button>
                  ))}
              </div>

              <div className="fade-in explorer-tab-content" key={activeTab} style={{ flex: 1, overflow: 'hidden' }}>
                {activeTab === 'qc' ? (
                  <ErrorBoundary key={`qc-${dataset.id}`}>
                    <QCTab onSelectTrack={selectTrack} qcData={datasetQC} meta={datasetMeta} dataset={dataset} contrast={contrast} getTrack={getTrack} />
                  </ErrorBoundary>
                ) : activeTab === 'gene' ? (
                  <ErrorBoundary key={`gene-${dataset.id}-${activeTrackId}`}>
                    <GeneExplorerTab
                      geneSelection={geneSelection}
                      volcano={volcano}
                      popData={popData as PopData}
                      contrastSlices={contrastSlices}
                      nomenclatureAuthority={nomenclatureAuthorityForStoredDatasetSymbols(dataset)}
                    />
                  </ErrorBoundary>
                ) : activeTab === 'circadian' ? (
                  <ErrorBoundary key={`circadian-${dataset.id}-${activeTrackId}`}>
                    <CircadianTab
                      dataset={dataset}
                      trackId={activeTrackId}
                      initialGene={geneSelection.genes[0]}
                    />
                  </ErrorBoundary>
                ) : (
                  <ErrorBoundary key={`pathway-${activeTrackId}`}>
                    <PathwayExplorerTab
                      pathway={pathway}
                      popData={popData as PopData}
                      contrastSlices={contrastSlices}
                      onSendGenesToGeneExplorer={sendGenesToGeneExplorer}
                    />
                  </ErrorBoundary>
                )}
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', padding: 'var(--sp-4)', position: 'relative', minHeight: 0 }}>
              <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <Skeleton width={300} height={32} radius="var(--r-md)" />
                <Skeleton width={90} height={24} radius="var(--r-md)" />
              </div>
              <Skeleton height="auto" style={{ flex: 1, minHeight: 120 }} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <Spinner size={22} label="Loading population data…" />
              </div>
            </div>
          )}
        </div>

        {/* Loading overlay (covers the whole body-row) */}
        {loadingTrack && (
          <LoadingOverlay
            message={`Loading ${datasetMeta?.labels?.[loadingTrack] || loadingTrack}…`}
            progress={loadingProgress}
          />
        )}
      </div>

      {showDatasetInfo && (
        <DatasetInfoPanel
          dataset={dataset}
          meta={datasetMeta}
          contrasts={datasetContrasts}
          activeContrast={contrast}
          onClose={() => setShowDatasetInfo(false)}
          onOpenMethods={() => { setShowDatasetInfo(false); openMethodology(); }}
          onOpenTracker={(acc) => { setShowDatasetInfo(false); openTracker(acc ?? null); }}
        />
      )}
    </div>
  );
}
