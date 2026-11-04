// A study's record, as a page rather than a popup — after Attio's record view:
// identity and actions in a header, the key facts as a strip of chips, tabbed
// content on the left and the record's details in a panel on the right.
//
// It replaced a centred modal. A modal said "an aside, dismiss to get back to
// the real thing", but the record IS the thing a reader clicked through to, and
// at 560px it had to ration the design table, the results and the verification
// dossier into one scroller. As a page the design sits beside the results, and
// the dossier gets a tab of its own instead of a disclosure at the bottom.
//
// SELECTION IS STILL NOT COMMITMENT. Nothing here loads a bundle; only "Open in
// explorer" navigates, for the reasons in DatasetLibrary's header comment.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AuthorValidationPanel, AuthorValidationSummary } from '../common/AuthorValidation';
import { StudyFactTable } from '../common/StudyMetadata';
import { ResultSummaryRows } from './ResultBars';
import { StudyVolcano } from './StudyVolcano';
import { listContrasts } from '../data/contrasts';
import type { DatasetCard } from '../data/datasetCatalog';
import { TRACKER_REVERSE_INDEX } from '../data/tracker/reverseIndex.generated.js';
import { DEFAULT_FDR_CUTOFF } from '../statistics/policy';
import { COLOR_WARNING_TEXT, FONT_HEADING, FONT_MONO } from '../styles/constants';
import { CompareSetToggle } from '../compareset/CompareSetToggle';
import type { CompareSetAddResult } from '../compareset/compareSetStore';
import { categoryColor, Icon, type IconName } from './LibraryToolbar';

type TabId = 'overview' | 'verification';

interface StudyRecordProps {
  card: DatasetCard;
  /** Where this record sits in the list behind it, for the step arrows. */
  position: { index: number; total: number } | null;
  onStep: (delta: -1 | 1) => void;
  onBack: () => void;
  onOpen: () => void;
  onOpenTracker?: (acc: string) => void;
  inSet: boolean;
  onToggleCompare: () => CompareSetAddResult;
  /** Volcanos are drawn only once the reader asks; the library remembers it. */
  volcanoWanted: boolean;
  onWantVolcano: () => void;
}

/** "Mus musculus" → "Mm": the species, which is what tells two otherwise
 *  similar hypothalamus studies apart at a glance. */
function speciesInitials(organism: string): string {
  const [genus = '', species = ''] = organism.split(/\s+/);
  return `${genus.charAt(0).toUpperCase()}${species.charAt(0).toLowerCase()}` || '?';
}

const actionBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px',
  borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-panel)',
  color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
};

function Fact({ icon, children, title }: { icon: IconName; children: ReactNode; title?: string }) {
  return (
    <span className="study-record-fact" title={title}>
      <Icon name={icon} size={12} color="var(--text-muted)" />
      {children}
    </span>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="study-record-section">{children}</h3>;
}

export function StudyRecord({
  card, position, onStep, onBack, onOpen, onOpenTracker, inSet, onToggleCompare, volcanoWanted, onWantVolcano,
}: StudyRecordProps) {
  const d = card.dataset;
  const trackerAcc = (TRACKER_REVERSE_INDEX as Record<string, string>)[d.id];
  const contrasts = listContrasts(d);
  const [tab, setTab] = useState<TabId>('overview');
  const titleRef = useRef<HTMLHeadingElement>(null);
  const tabRefs = { overview: useRef<HTMLButtonElement>(null), verification: useRef<HTMLButtonElement>(null) };
  const titleId = `study-record-${d.id}`;

  // A new study starts on its overview, with focus on its name, so a screen
  // reader announces which record it is now looking at.
  // biome-ignore lint/correctness/useExhaustiveDependencies: d.id is the trigger — a new study resets the tab and moves focus
  useEffect(() => {
    setTab('overview');
    titleRef.current?.focus();
  }, [d.id]);

  // The summary strip's link into the dossier: switch to its tab and put focus
  // on the tab, which is the control that now says "selected".
  const openReport = useCallback(() => {
    setTab('verification');
    requestAnimationFrame(() => tabRefs.verification.current?.focus());
  }, [tabRefs.verification]);

  // Escape leaves the record, as it left the modal. A quality checklist marks its
  // own Escape handled, so the first press closes that and a second one this.
  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.stopPropagation();
    onBack();
  }, [onBack]);

  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next: TabId = tab === 'overview' ? 'verification' : 'overview';
    setTab(next);
    tabRefs[next].current?.focus();
  };

  const n = card.nBaseline != null && card.nCase != null && card.baselineGroup && card.caseGroup
    ? { text: `${card.nBaseline} v ${card.nCase}`, title: `${card.nBaseline} ${card.baselineGroup.label} vs ${card.nCase} ${card.caseGroup.label}` }
    : null;
  const disc = card.discoveries;

  return (
    // Escape anywhere inside the record returns to the list, as the modal's did.
    <article className="study-record" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="study-record-header">
        <div className="study-record-identity">
          <span aria-hidden="true" className="study-record-tile"
            style={{ background: `color-mix(in srgb, ${categoryColor(d.category)} 16%, var(--bg-panel))`, color: categoryColor(d.category) }}>
            {speciesInitials(d.organism)}
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 id={titleId} ref={titleRef} tabIndex={-1} className="study-record-title" style={{ fontFamily: FONT_HEADING }}>
              {d.name}
            </h2>
            <div className="study-record-subtitle">
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: categoryColor(d.category), flexShrink: 0 }} />
              {d.category}
            </div>
          </div>
        </div>

        <div className="study-record-actions">
          {position && position.total > 1 && (
            <span className="study-record-stepper">
              <button type="button" aria-label="Previous study" onClick={() => onStep(-1)} disabled={position.index === 0}>
                <Icon name="back" size={14} />
              </button>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {position.index + 1} / {position.total}
              </span>
              <button type="button" aria-label="Next study" onClick={() => onStep(1)} disabled={position.index === position.total - 1}>
                <span style={{ display: 'flex', transform: 'scaleX(-1)' }}><Icon name="back" size={14} /></span>
              </button>
            </span>
          )}
          {onOpenTracker && trackerAcc && (
            <button type="button" onClick={() => onOpenTracker(trackerAcc)} style={actionBtn}>
              <Icon name="layers" color="var(--text-muted)" />
              Tracker
            </button>
          )}
          <CompareSetToggle size="md" inSet={inSet} name={d.name} onToggle={onToggleCompare} />
          <button type="button" onClick={onOpen}
            style={{ ...actionBtn, border: 'none', background: 'var(--color-selected)', color: '#fff', fontWeight: 600 }}>
            Open in explorer →
          </button>
        </div>
      </div>

      {/* ── Fact strip ──────────────────────────────────────────────── */}
      <div className="study-record-strip">
        {d.geo && <Fact icon="link"><span style={{ fontFamily: FONT_MONO }}>{d.geo}</span></Fact>}
        <Fact icon="category"><span style={{ fontStyle: 'italic' }}>{d.organism}</span></Fact>
        <Fact icon="region">{d.region}</Fact>
        {n && (
          <Fact icon="power" title={n.title}>
            <span style={{ fontFamily: FONT_MONO }}>{n.text}</span>
            {card.nVaries && <span style={{ color: COLOR_WARNING_TEXT }} title={`Counts vary across this study's ${d.trackNoun || 'track'}s`}>*</span>}
          </Fact>
        )}
        {disc && (
          <Fact icon="hash" title={`At FDR ${DEFAULT_FDR_CUTOFF}`}>
            <span style={{ fontFamily: FONT_MONO }}>{disc.genes.toLocaleString()}</span> genes
            <span style={{ color: 'var(--border-dark)' }}>·</span>
            <span style={{ fontFamily: FONT_MONO }}>{disc.paths == null ? '—' : disc.paths.toLocaleString()}</span> pathways
          </Fact>
        )}
      </div>

      {/* ── Body: tabs | details ────────────────────────────────────── */}
      <div className="study-record-body">
        <div className="study-record-main">
          <div role="tablist" aria-label="Study record sections" className="study-record-tabs" onKeyDown={onTabKey}>
            {(['overview', 'verification'] as const).map((id) => (
              <button key={id} ref={tabRefs[id]} type="button" role="tab" id={`${titleId}-tab-${id}`}
                aria-selected={tab === id} aria-controls={`${titleId}-panel-${id}`} tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}>
                <Icon name={id === 'overview' ? 'table' : 'shield'} size={13} />
                {id === 'overview' ? 'Overview' : 'Verification'}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`${titleId}-panel-${tab}`} aria-labelledby={`${titleId}-tab-${tab}`}
            className="study-record-panel">
            {tab === 'overview' ? (
              <>
                {/* Verification first, and never behind a click: what a reader
                    must not miss is stated here as text, and the tab holds the
                    dossier behind it. */}
                <AuthorValidationSummary record={card.validation} onOpenReport={openReport} />

                {/* The result itself, drawn: the volcano replaces the card's
                    result bars, which were a stand-in for it. The exact counts
                    stay below, since the bars' tooltips carried them. */}
                <SectionHeading>Result</SectionHeading>
                <StudyVolcano key={d.id} card={card} onOpen={onOpen} wanted={volcanoWanted} onWant={onWantVolcano} />
                {disc && <>
                  <SectionHeading>Significant at FDR {DEFAULT_FDR_CUTOFF}</SectionHeading>
                  <ResultSummaryRows discoveries={disc} />
                </>}
              </>
            ) : (
              <AuthorValidationPanel record={card.validation} />
            )}
          </div>
        </div>

        <aside className="study-record-details" aria-label="Study details">
          <div className="study-record-details-head">
            <Icon name="view" size={13} color="var(--text-muted)" />
            Details
          </div>
          {/* Contrasts are passed even though Replicates already names the arms:
              on a multi-contrast dataset the arms show only the DEFAULT pair, and
              a record that omitted the others would understate the study. */}
          <StudyFactTable
            dataset={d}
            facts={card}
            baselineGroup={card.baselineGroup}
            caseGroup={card.caseGroup}
            contrasts={contrasts}
            showLinks
          />
        </aside>
      </div>
    </article>
  );
}
