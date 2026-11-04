// The study record, as presentation only.
//
// Three surfaces now show the same facts about a dataset — the library's detail
// drawer, the explorer's persistent study bar, and the DatasetInfoPanel modal —
// and they must not disagree. Before this module they would have: each one
// reached for `meta.qcFlags[track].nNormal` itself and rendered its own idea of
// what an arm pill looks like, so a fix to the "n varies across tracks" caveat
// had to be made in three places or it was made in one.
//
// That was only ever half true. The modal shared the ARM PILLS but hand-rolled
// its own fact table, down to byte-identical private ExtLink/LinkChip/Row
// helpers — so the banded record, the `<th scope="row">` labels and the
// proportional label column all landed in the drawer and not in the modal. Both
// render StudyFactTable now. If you are about to copy a row out of here into a
// caller, that is the drift this module exists to prevent: add the fact as an
// optional prop and let both surfaces have it.
//
// Deliberately NOT a data module. It takes facts and renders them; it does not
// know whether they came from a loaded `meta.js` (the explorer, which has one)
// or from the precomputed catalog (the library, which must not load 42). The two
// adapters at the bottom are the whole seam between those callers.

import type { ReactNode } from 'react';
import { COLOR_WARNING_BG, COLOR_WARNING_TEXT, FONT_MONO } from '../styles/constants';
import { citationWithoutPmid, datasetExternalLinks, repositoryName } from '../utils/datasetLinks';
import { unitProvenance } from '../utils/sampleValues';
import { isLowPower } from '../utils/qcFlags';
import { contrastArmCounts, defaultArmCounts, getActiveContrast } from '../data/contrasts';
import { studyPageHref } from '../data/siteInfo';
import { upstreamDisplay, upstreamProcessingFor, upstreamSource, upstreamSummary } from '../data/upstreamProcessing';
import type { Dataset, DatasetMeta, Group, ResolvedContrast } from '../types';

/**
 * The measured half of a study record — everything that comes from the bundles
 * rather than the registry. Every field is nullable and null means UNKNOWN, not
 * zero: a dash here has to be readable as "not loaded", because rendering a
 * confident `0 genes` or `1 track` for an unmeasured dataset is a false claim.
 *
 * Structurally a subset of DatasetCard, so the library passes its card straight in.
 */
export interface StudyFacts {
  trackCount: number | null;
  trackLabel: string | null;
  nGenes: number | null;
  nBaseline: number | null;
  nCase: number | null;
  /** Whether other tracks in the dataset disagree with nBaseline/nCase. */
  nVaries: boolean;
  lowPowerTracks: number;
}

/** Replicates per group, for the groups the two-arm StudyFacts cannot describe. */
export interface GroupCounts {
  /** Group key → replicates. A group ABSENT from the map has an unknown count;
   *  it does not have a count of zero. */
  byGroup: Record<string, number>;
  /** The track a legacy fallback count was read from, or null when none was. */
  track: string | null;
}

const EMPTY_FACTS: StudyFacts = {
  trackCount: null, trackLabel: null, nGenes: null,
  nBaseline: null, nCase: null, nVaries: false, lowPowerTracks: 0,
};

/** `#RRGGBB` → `rgba(…)`. Anything else degrades to neutral grey rather than
 *  emitting an invalid colour. */
function withAlpha(hex: string | undefined, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec((hex || '').trim());
  const rgb = Number.parseInt(match ? match[1] : '888888', 16);
  return `rgba(${(rgb >> 16) & 255}, ${(rgb >> 8) & 255}, ${rgb & 255}, ${alpha})`;
}

interface ArmPillsProps {
  baseline: Group | null;
  caseGroup: Group | null;
  nBaseline: number | null;
  nCase: number | null;
  /** Renders the "varies across tracks" caveat. */
  nVaries?: boolean;
  /** Noun for the caveat's subject ("population", "track"). */
  trackNoun?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'counts' | 'design';
  baselineTitle?: string;
  caseTitle?: string;
  after?: ReactNode;
}

export function ArmVariesBadge({
  trackNoun = 'track', title, fontSize = 10.5,
}: { trackNoun?: string; title?: string; fontSize?: number }) {
  return (
    <span
      title={title ?? `Replicate counts vary by ${trackNoun}. These counts describe the default ${trackNoun}.`}
      style={{
        fontSize, fontFamily: FONT_MONO, fontWeight: 600,
        padding: '2px 7px', borderRadius: 999, cursor: 'help',
        color: COLOR_WARNING_TEXT, background: COLOR_WARNING_BG,
        border: '1px solid rgba(217, 119, 6, 0.34)',
      }}
    >
      n varies by {trackNoun}
    </span>
  );
}

/**
 * "3 Normal vs 3 Obese" — the canonical replicate display.
 *
 * Arms are named from the dataset's OWN groups, never from the `nNormal` /
 * `nObese` keys the bundles store them under: on a mouse study those keys mean
 * baseline and case, and rendering them literally would label a chow arm
 * "Normal".
 *
 * A missing count renders '–' rather than a plausible default. The wash is
 * derived from each group's own colour so the pill never disagrees in hue with
 * the dot inside it. Its 0.09 fill and 0.22 border alphas exactly preserve the
 * hero's pre-migration literals; only the hue follows the group now.
 */
export function ArmPills({
  baseline, caseGroup, nBaseline, nCase, nVaries, trackNoun = 'track', size = 'md',
  variant = 'counts', baselineTitle, caseTitle, after,
}: ArmPillsProps) {
  if (!baseline || !caseGroup) return null;
  if (variant === 'design') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FONT_MONO }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: baseline.color }} />
        {baseline.label}
        <span style={{ color: 'var(--text-muted)' }}>→</span>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: caseGroup.color }} />
        {caseGroup.label}
      </span>
    );
  }
  const fs = size === 'sm' ? 10.5 : 12;
  const gap = size === 'lg' ? 6 : 5;
  const pill = (group: Group, n: number | null, title: string | undefined) => (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap,
      padding: size === 'sm' ? '2px 8px' : '3px 10px',
      background: withAlpha(group.color, 0.09),
      border: `1px solid ${withAlpha(group.color, 0.22)}`,
      borderRadius: 12, fontSize: fs, fontFamily: FONT_MONO,
      color: 'var(--text-mono)',
      ...(size === 'lg' ? {} : { whiteSpace: 'nowrap' as const }),
      cursor: title ? 'help' : undefined,
    }}>
      <span style={{
        width: size === 'lg' ? 8 : 7, height: size === 'lg' ? 8 : 7,
        borderRadius: '50%', background: group.color,
        ...(size === 'lg' ? {} : { flexShrink: 0 }),
      }} />
      {/* One text node, not `{n} {label}` — React would otherwise split "3 Normal"
          into two nodes, which a screen reader reads as two separate strings. */}
      {`${n ?? '–'} ${group.label}`}
    </span>
  );
  const contents = (
    <>
      {pill(baseline, nBaseline, baselineTitle)}
      <span style={{ color: 'var(--text-muted)', fontSize: fs }}>vs</span>
      {pill(caseGroup, nCase, caseTitle)}
      {nVaries && (
        <ArmVariesBadge
          trackNoun={trackNoun}
          fontSize={size === 'sm' ? 9.5 : 10.5}
        />
      )}
      {after}
    </>
  );
  if (size === 'lg') {
    return <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{contents}</div>;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      {contents}
    </span>
  );
}

/**
 * The design's groups as name chips, each carrying its replicate count where one
 * is known.
 *
 * A group with no count renders bare rather than borrowing a neighbour's — the
 * same "null means unknown" rule the rest of the record follows. The count and
 * the label are ONE text node for the reason spelled out in ArmPills: split in
 * two, a screen reader reads "8" and "Maternal chow" as unrelated strings.
 */
function GroupList({ groups, counts }: { groups: Group[]; counts?: Record<string, number> }) {
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
      {groups.map((g) => {
        const n = counts?.[g.key];
        return (
          <span key={g.key} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999,
            fontSize: 11, fontFamily: FONT_MONO, color: 'var(--text-mono)',
            border: '1px solid var(--border)', background: 'var(--bg-app)',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: g.color }} />
            {n != null ? `${n} ${g.label}` : g.label}
          </span>
        );
      })}
    </span>
  );
}

/**
 * One fact.
 *
 * The label is a `<th scope="row">`, not a styled `<td>`: it names the cell
 * beside it, and a screen reader reading the value row by row needs that
 * relationship stated rather than inferred from column position.
 *
 * The label column used to be a hard 150px with `nowrap`, which on a narrow
 * viewport left the value column too thin to hold an arm pill or a citation. It
 * now wraps and the width comes from the <colgroup>, which clamps rather than
 * fixes.
 */
function Row({ field, children }: { field: string; children: ReactNode }) {
  return (
    <tr>
      <th scope="row" style={{
        padding: '6px 12px 6px 0', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
        verticalAlign: 'top', textAlign: 'left', overflowWrap: 'anywhere',
        borderBottom: '1px solid var(--border)',
      }}>
        {field}
      </th>
      <td style={{
        padding: '6px 0', fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.5,
        verticalAlign: 'top', overflowWrap: 'anywhere', borderBottom: '1px solid var(--border)',
      }}>
        {children}
      </td>
    </tr>
  );
}

/**
 * A band heading inside the fact table.
 *
 * Thirteen sibling label/value pairs made everything look equally important,
 * which was the "not fully clear what is what" complaint. Each band is its own
 * `<tbody>` — valid HTML, and the grouping is real structure rather than a
 * styled spacer row.
 */
function Band({ title, children }: { title: string; children: ReactNode }) {
  return (
    <tbody>
      <tr>
        <th scope="rowgroup" colSpan={2} style={{
          padding: '14px 0 5px', textAlign: 'left', fontSize: 9.5, fontWeight: 700,
          letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text-muted)',
        }}>
          {title}
        </th>
      </tr>
      {children}
    </tbody>
  );
}

function ExtLink({ href, title, children }: { href: string; title?: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={title}
      style={{ color: 'var(--color-selected)', textDecoration: 'none', fontWeight: 600 }}>
      {children}
    </a>
  );
}

/** A linked pill for one external identifier (accession / DOI / PubMed). */
export function LinkChip({ href, title, children }: { href: string; title?: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999,
        fontSize: 11.5, fontWeight: 600, fontFamily: FONT_MONO, textDecoration: 'none',
        color: 'var(--color-selected)', background: 'color-mix(in srgb, var(--color-selected) 10%, transparent)',
        border: '1px solid color-mix(in srgb, var(--color-selected) 28%, transparent)',
      }}>
      {children}
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 17 17 7M9 7h8v8" />
      </svg>
    </a>
  );
}

/** The public study page and the original source identifiers. */
function StudyLinks({ dataset }: { dataset: Dataset }) {
  const links = datasetExternalLinks(dataset);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
      <a href={studyPageHref(dataset.id)} style={{
        display: 'inline-flex', alignItems: 'center', padding: '3px 8px',
        fontSize: 12, color: 'var(--color-selected)', textUnderlineOffset: 3,
      }}>
        Study overview &amp; citation
      </a>
      {links.map((l) => <LinkChip key={l.kind + l.href} href={l.href} title={l.title}>{l.label}</LinkChip>)}
    </div>
  );
}

interface StudyFactTableProps {
  dataset: Dataset;
  facts?: StudyFacts;
  baselineGroup?: Group | null;
  caseGroup?: Group | null;
  /** All declared contrasts, for the Contrast(s) row. */
  contrasts?: ResolvedContrast[];
  /**
   * Every group's replicate count, for the Groups row — the design cells a
   * two-arm Replicates row cannot show. Omit it (the library does: the catalog
   * carries the default arms, not all six of a factorial study's groups) and the
   * row still names the groups, just without their N.
   */
  groupCounts?: GroupCounts | null;
  /**
   * Render the external-identifier chips inside the Source band rather than
   * leaving them to the caller. Owning both means the table can tell whether a
   * repository chip actually rendered, which is what decides the Accession row.
   */
  showLinks?: boolean;
}

/**
 * The full study record as a two-column table.
 *
 * ORDER IS THE ARGUMENT. A reader opens this to answer one question — is this
 * study worth opening? — and that question is settled by the arms, their N and
 * the contrast, not by the organism. Those now lead; the registry descriptors
 * that used to sit on top follow underneath, banded so it is clear which kind of
 * fact each one is.
 */
export function StudyFactTable({
  dataset, facts = EMPTY_FACTS, baselineGroup = null, caseGroup = null, contrasts = [],
  groupCounts = null, showLinks = false,
}: StudyFactTableProps) {
  const links = datasetExternalLinks(dataset);
  const repoLink = links.find((l) => l.kind === 'repository');
  const trackNoun = dataset.trackNoun || 'track';
  const nounPlural = `${trackNoun.charAt(0).toUpperCase()}${trackNoun.slice(1)}s`;
  // The chip row already carries the accession as a link, so repeating it as a
  // text row says the same identifier twice. Only when a chip was ACTUALLY
  // rendered, though: a repository we cannot build a URL for produces no chip,
  // and dropping the row there would lose the accession altogether.
  const accessionInChips = showLinks && repoLink != null;
  // The Groups row exists for the groups Replicates CANNOT show: a factorial
  // study declares its pooled arms plus every design cell, and Replicates names
  // exactly two of them. With nothing left over the row would only say the same
  // thing again, and with no arms at all Replicates is already the full list.
  const extraGroups = baselineGroup != null && caseGroup != null
    && dataset.groups.some((g) => g.key !== baselineGroup.key && g.key !== caseGroup.key);
  // Which comparison the arms above belong to, matched on the arms themselves so
  // it is right for the library (whose card carries the DEFAULT contrast's) and
  // for the explorer modal (which passes the one the user has selected) without
  // either having to say which it passed.
  const armsContrast = baselineGroup && caseGroup
    ? contrasts.find((c) => c.baseline?.key === baselineGroup.key && c.caseGroup?.key === caseGroup.key)
    : undefined;
  // The depositor's aligner, genome and annotation. HypoExplorer starts from the
  // deposited matrix, so these are the source's choices, not a local realignment.
  const upstreamRecord = upstreamProcessingFor(dataset);
  const upstream = upstreamDisplay(upstreamRecord);

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
      {/* A proportion, not the old hard 150px: the label column has to give way
          on a narrow viewport or the value column cannot hold an arm pill. At a
          325px record body this is ~92px against ~150px before.

          It MUST stay a bare percentage. Measured in Chrome, a percentage inside
          any CSS math function on a <col> — clamp(), min(), max() alike — is
          dropped by the fixed-layout column algorithm, which then falls back to
          dividing the table in half: `clamp(92px, 34%, 150px)` renders 145px of
          289px and 262px of 524px, i.e. exactly 50% at both. So a clamp here
          silently does the opposite of what it reads as. */}
      <colgroup>
        <col style={{ width: '32%' }} />
        <col />
      </colgroup>

      <Band title="Comparison">
        <Row field="Replicates">
          {baselineGroup && caseGroup ? (
            <ArmPills
              baseline={baselineGroup} caseGroup={caseGroup}
              // `facts` is the primary source and `groupCounts` only fills a
              // gap in it — never overrides. The two resolve an arm through the
              // same tiers, so where both answer they answer the same; where
              // `facts` cannot (a meta whose `populations` is empty makes
              // factsFromMeta return EMPTY_FACTS wholesale) a count we plainly
              // hold would otherwise render as a dash.
              nBaseline={facts.nBaseline ?? groupCounts?.byGroup[baselineGroup.key] ?? null}
              nCase={facts.nCase ?? groupCounts?.byGroup[caseGroup.key] ?? null}
              nVaries={facts.nVaries} trackNoun={trackNoun}
            />
          ) : (
            <GroupList groups={dataset.groups} counts={groupCounts?.byGroup} />
          )}
        </Row>
        {extraGroups && (
          <Row field="Groups">
            <GroupList groups={dataset.groups} counts={groupCounts?.byGroup} />
            {groupCounts?.track && (
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{' '}(n for {groupCounts.track})</span>
            )}
          </Row>
        )}
        {contrasts.length > 0 && (
          <Row field={contrasts.length > 1 ? 'Contrasts' : 'Contrast'}>
            {contrasts.map((c, i) => (
              <span key={c.id} title={c.description}>
                {i > 0 ? ', ' : ''}
                <span style={{ fontFamily: FONT_MONO, ...(c.description ? { borderBottom: '1px dotted var(--border-dark)', cursor: 'help' } : {}) }}>{c.label}</span>
              </span>
            ))}
            {/* The arms above belong to exactly ONE of these comparisons.
                Listing the others directly beneath them would otherwise read as a
                claim that the same replicate counts hold for every one. */}
            {contrasts.length > 1 && (
              <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--text-muted)' }}>
                {armsContrast
                  ? `Replicates above are for ${armsContrast.label}.`
                  : "Replicates above are the default comparison's."}
              </span>
            )}
          </Row>
        )}
        <Row field="Perturbation">{dataset.perturbation}</Row>
      </Band>

      <Band title="Sample">
        <Row field="Organism"><span style={{ fontStyle: 'italic' }}>{dataset.organism}</span></Row>
        <Row field="Region">
          {dataset.region}
          {facts.trackLabel && facts.trackLabel !== dataset.region && (
            <span style={{ color: 'var(--text-muted)' }}> · {facts.trackLabel}</span>
          )}
        </Row>
        <Row field="Modality">{dataset.modality}</Row>
        <Row field="Preparation">{dataset.preparation}</Row>
      </Band>

      <Band title="Measurement">
        <Row field={nounPlural}>
          {facts.trackCount != null
            ? `${facts.trackCount} ${trackNoun}${facts.trackCount === 1 ? '' : 's'}`
            : <span style={{ color: 'var(--text-muted)' }}>—</span>}
          {facts.nGenes ? <span style={{ color: 'var(--text-muted)' }}> · {facts.nGenes.toLocaleString()} {(dataset.featureLabel || 'gene').toLowerCase()}s detected</span> : null}
          {facts.lowPowerTracks > 0 && (
            <span style={{ color: 'var(--text-muted)' }}> · {facts.lowPowerTracks} below n=3</span>
          )}
        </Row>
        <Row field="Feature type">{dataset.featureLabel || dataset.featureType}</Row>
        {dataset.expressionUnit && (
          <Row field="Expression unit">
            <span title={unitProvenance(dataset)}
              style={{ fontFamily: FONT_MONO, cursor: 'help', borderBottom: '1px dotted currentColor' }}>
              {dataset.expressionUnit}
            </span>
          </Row>
        )}
        <Row field="Pathway enrichment">
          {dataset.supportsPathways ? 'GO · Hallmark · KEGG · Reactome' : 'Not available for this dataset'}
        </Row>
      </Band>

      <Band title="Source">
        {dataset.geo && !accessionInChips && (
          <Row field="Accession">
            {repoLink
              ? <ExtLink href={repoLink.href} title={`${repositoryName(dataset.geo)} record`}><span style={{ fontFamily: FONT_MONO }}>{dataset.geo}</span></ExtLink>
              : <span style={{ fontFamily: FONT_MONO }}>{dataset.geo}</span>}
            {repositoryName(dataset.geo) && <span style={{ color: 'var(--text-muted)' }}> · {repositoryName(dataset.geo)}</span>}
          </Row>
        )}
        {upstream && (
          <Row field="Upstream processing">
            <span title={upstreamSource(upstreamRecord)} style={{
              cursor: 'help', borderBottom: '1px dotted currentColor',
              ...(upstreamSummary(upstreamRecord) ? {} : { color: 'var(--text-muted)' }),
            }}>
              {upstream}
            </span>
          </Row>
        )}
        {/* Stripped: the PMID already renders as a chip. */}
        <Row field="Citation">{citationWithoutPmid(dataset.citation)}</Row>
        {showLinks && <Row field="Links"><StudyLinks dataset={dataset} /></Row>}
      </Band>
    </table>
  );
}

/**
 * WHICH track's QC a dataset-level fact should be read from.
 *
 * `dataset.defaultTrack` is the answer whenever the loaded meta actually lists
 * it; a meta that does not is stale against the registry, and `populations[0]`
 * is then the only track the reader can be shown. Both adapters below MUST ask
 * this rather than reaching for `defaultTrack` directly: they render into
 * adjacent rows of one table, and a meta whose `qcFlags` carries both tracks
 * would otherwise have Replicates and Groups print different N for the very
 * same two groups.
 */
function resolveTrack(dataset: Dataset, meta: DatasetMeta | null | undefined): string | undefined {
  const populations = meta?.populations ?? [];
  return populations.includes(dataset.defaultTrack) ? dataset.defaultTrack : populations[0];
}

/**
 * Adapter for callers that already hold a loaded `meta.js` — the explorer and
 * the DatasetInfoPanel. Reads the same fields the catalog generator reads, so
 * the loaded and the precomputed paths report identical numbers.
 *
 * `contrast` names the comparison the arm counts describe. Omit it and they are
 * the dataset's DEFAULT contrast's, derived through the one function the
 * query-index generator also calls. Pass one — the DatasetInfoPanel passes
 * whichever contrast the user currently has selected — and the counts follow it
 * instead, which is what stops the modal labelling the selected arms with the
 * default's numbers. The two paths agree by construction when the contrast
 * passed IS the default: each resolves an arm as `meta.groupN[key]` falling
 * back to the track's legacy pooled pair.
 */
export function factsFromMeta(
  dataset: Dataset,
  meta: DatasetMeta | null | undefined,
  contrast?: ResolvedContrast | null,
): StudyFacts {
  if (!meta) return EMPTY_FACTS;
  const populations = meta.populations ?? [];
  const track = resolveTrack(dataset, meta);
  if (!track) return EMPTY_FACTS;
  const def = meta.qcFlags?.[track] ?? {};
  // The arms of `contrast`, or of the DEFAULT contrast when the caller named
  // none. That default path stays routed through defaultArmCounts — shared with
  // the query-index generator through one function rather than re-spelled here,
  // because the two making different claims about the same dataset is exactly
  // the failure this had.
  const { nBaseline, nCase } = contrast
    ? contrastArmCounts(contrast, null, meta, track)
    : defaultArmCounts(dataset, meta, def);
  // nVaries asks whether the TRACKS differ in size, which only the pooled pair
  // measures per track — see the matching note in build_query_index.mts.
  const pooledBaseline = def.nNormal ?? null;
  const pooledCase = def.nObese ?? null;
  return {
    trackCount: populations.length,
    trackLabel: meta.labels?.[track] ?? track,
    nGenes: meta.nGenes?.[track] ?? null,
    nBaseline,
    nCase,
    // Must stay byte-identical in meaning to the same computation in
    // scripts/build_query_index.mts, or the explorer and the library will make
    // different claims about the same dataset. Unknown counts are not evidence
    // of a difference.
    nVaries: populations.some((p) => {
      const q = meta.qcFlags?.[p] ?? {};
      if (q.nNormal == null || q.nObese == null) return false;
      return q.nNormal !== pooledBaseline || q.nObese !== pooledCase;
    }),
    lowPowerTracks: populations.filter((p) => isLowPower(meta.qcFlags?.[p])).length,
  };
}

/**
 * The measured size of EVERY declared group, for the Groups row.
 *
 * The other half of what a loaded `meta.js` knows and the catalog does not.
 * `meta.groupN` is the real source — the bundle builders write it for exactly
 * this — and the legacy `qcFlags` pair is the fallback for bundles predating it.
 * That pair only ever holds the study's POOLED control/case, so it can only be
 * spent on the arms of `contrast`; every other group stays absent from the map
 * and renders bare, rather than being labelled with a count belonging to a group
 * that merely contains it. Four of GSE135639's six chips turn on that.
 *
 * `track` names the track whose QC pair backs this map, so the row can say so:
 * on a multi-track dataset the tracks disagree, and an unqualified N would read
 * as a claim about all of them. Note it is set whenever that track CARRIES a
 * legacy pair — not only when one was actually spent — so a bundle holding both
 * `groupN` and `qcFlags` still qualifies the row. That is deliberate: the
 * qualifier describes which track the counts are true of, and on a multi-track
 * bundle that caveat holds whichever field answered. It comes from
 * resolveTrack, the same rule factsFromMeta uses, so the Replicates and Groups
 * rows cannot end up quoting two different tracks at each other. The
 * `defaultTrack` fallback covers only the case resolveTrack cannot answer at
 * all — a meta with no `populations` — where the registry's own default is
 * still a better guess than dropping counts we hold.
 */
export function groupCountsFromMeta(
  dataset: Dataset,
  meta: DatasetMeta | null | undefined,
  contrast?: ResolvedContrast | null,
): GroupCounts {
  const track = resolveTrack(dataset, meta) ?? dataset.defaultTrack;
  const legacy = meta?.qcFlags?.[track];
  const arms = contrast ?? getActiveContrast(dataset);
  const byGroup: Record<string, number> = {};
  for (const g of dataset.groups) {
    const n = meta?.groupN?.[g.key]
      ?? (g.key === arms?.baseline?.key ? legacy?.nNormal
        : g.key === arms?.caseGroup?.key ? legacy?.nObese
          : undefined);
    if (n != null) byGroup[g.key] = n;
  }
  return { byGroup, track: legacy ? track : null };
}
