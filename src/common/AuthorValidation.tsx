import type { CSSProperties } from 'react';
import { DatasetQualityBadges } from './QualityBadges';
import {
  AUTHOR_VALIDATION_STATUS,
  comparisonLevelLabel,
  paperAccessLabel,
  sourceComparisonLabel,
  type AuthorValidationRecord,
  type AuthorValidationEvidenceLink,
} from '../data/authorValidation';
import { FONT_MONO } from '../styles/constants';
import { COMPARISON_OUTCOMES, EVIDENCE_LEVELS, RESULT_AVAILABILITY, VERIFICATION_CLAIMS, getVerificationClaim, type VerificationClaim, type VerificationState } from '../data/authorVerification';
import { COMPARABILITY_ASSESSMENTS, COMPARABILITY_DIMENSIONS, COMPARABILITY_STATUS, COMPARISON_TARGETS, COMPARISON_SCOPES, type ComparisonReview } from '../data/authorComparability';

/** Shape and text carry the status independently of color. */
export function VerificationIcon({ state, claim }: { state: VerificationState; claim?: VerificationClaim }) {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      {state === 'full' ? <><path d="M10 2 17 5v5c0 4-7 8-7 8s-7-4-7-8V5z" /><path d="m6 10 3 3 5-6" /></>
        : state === 'unresolved' ? <><path d="m10 1 9 9-9 9-9-9z" /><path d="M10 6v5m0 3v.2" /></>
          : state === 'partial' ? claim === 'author_results'
            ? <path d="M2 3h5v14H2zM13 3h5v14h-5zM7 10h6m-2-2 2 2-2 2" />
            : claim === 'reconstructed'
              ? <path d="M3 4h5v5H3zM12 11h5v5h-5zM8 6h6v5m-2-2 2 2 2-2" />
              : <path d="M4 2h8l4 4v12H4zM12 2v4h4M7 10h6M7 13h6" />
            : state === 'in_progress' ? <><circle cx="10" cy="10" r="8" strokeDasharray="3 3" /><path d="M10 5v5l3 2" /></>
              : <><circle cx="10" cy="10" r="8" /><path d="m4.5 15.5 11-11" /></>}
    </svg>
  );
}

export function AuthorReviewBadge({
  record,
  compact = false,
}: {
  record: AuthorValidationRecord;
  compact?: boolean;
}) {
  const claim = getVerificationClaim(record.verification);
  const meta = VERIFICATION_CLAIMS[claim];
  return (
    <span
      title={`${meta.label} · ${EVIDENCE_LEVELS[record.verification.evidenceLevel].label}. ${record.verification.reason}`}
      data-validation-status={record.status}
      data-verification-state={record.verification.state}
      data-verification-claim={claim}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        alignSelf: 'flex-start',
        padding: compact ? '2px 6px' : '3px 8px', borderRadius: 999,
        border: `1px solid color-mix(in srgb, ${meta.tone} 36%, var(--border))`,
        background: `color-mix(in srgb, ${meta.tone} 9%, var(--bg-panel))`,
        color: `color-mix(in srgb, ${meta.tone} 70%, var(--text-primary))`, fontFamily: FONT_MONO, fontWeight: 600,
        fontSize: compact ? 9.5 : 10.5, lineHeight: 1.35, maxWidth: '100%', boxSizing: 'border-box', whiteSpace: 'normal',
      }}
    >
      <VerificationIcon state={record.verification.state} claim={claim} />
      {compact ? meta.shortLabel : meta.label}
    </span>
  );
}

/** Shared primary badges across library, tracker and Explorer. */
export const AuthorValidationBadge = DatasetQualityBadges;

export function AuthorEvidenceLabel({ record }: { record: AuthorValidationRecord }) {
  return <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4, marginTop: 3 }}>
    {EVIDENCE_LEVELS[record.verification.evidenceLevel].label}
    {record.verification.resultAvailability === 'not_located' ? ' · reference not found'
      : record.verification.resultAvailability === 'access_blocked' ? ' · access limited'
        : record.verification.resultAvailability === 'partial'
          ? record.verification.comparisonOutcome === 'not_comparable' ? ' · different contrast' : ' · limited reference scope'
        : record.verification.resultAvailability === 'not_assessed' ? ' · review pending' : ''}
    {record.verification.resultAvailability === 'located' ? ' · retrieval pending' : ''}
  </span>;
}

export function AuthorValidationNotInExplorerBadge({ label = 'Not in explorer' }: { label?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 6px', borderRadius: 999,
      border: '1px solid var(--border)', background: 'var(--bg-app)',
      color: 'var(--text-muted)', fontFamily: FONT_MONO, fontSize: 9.5,
      fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

const labelStyle: CSSProperties = {
  width: 150, padding: '4px 12px 4px 0', verticalAlign: 'top',
  color: 'var(--text-muted)', fontSize: 11, fontWeight: 600,
};

const valueStyle: CSSProperties = {
  padding: '4px 0', verticalAlign: 'top', color: 'var(--text-primary)',
  fontSize: 12, lineHeight: 1.5, overflowWrap: 'anywhere',
};

const percent = (value: number | null | undefined) => (
  value == null ? null : `${(value * 100).toFixed(1)}%`
);

const decimal = (value: number | null | undefined) => (
  value == null ? null : value.toFixed(4)
);

function ComparabilityPanel({ review, summary, references }: { review: ComparisonReview; summary: string; references: AuthorValidationEvidenceLink[] }) {
  return <section aria-label="Comparability to the author analysis" style={{ margin: '14px 0 18px' }}>
    <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>What was compared with the authors?</h3>
    {review.conclusion !== summary && <p style={{ fontSize: 12, lineHeight: 1.55, margin: '0 0 8px' }}>{review.conclusion}</p>}
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <tbody>
        <tr><th scope="row" style={labelStyle}>Our result being checked</th><td style={valueStyle}><strong>{COMPARISON_TARGETS[review.target]}.</strong> {review.basis}</td></tr>
        <tr><th scope="row" style={labelStyle}>Author reference</th><td style={valueStyle}>{review.reference}
          {references.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 4 }}>
            {references.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--accent)' }}>{link.label}</a>)}
          </div>}
        </td></tr>
        <tr><th scope="row" style={labelStyle}>Result coverage</th><td style={valueStyle}>{COMPARISON_SCOPES[review.resultScope]}</td></tr>
        {review.registeredContrastIds.length > 0 && <tr><th scope="row" style={labelStyle}>Registered comparisons addressed</th>
          <td style={valueStyle}>{review.registeredContrastIds.join(', ')}. Listed as reviewed, not as verified.</td></tr>}
        <tr><th scope="row" style={labelStyle}>Comparability</th><td style={valueStyle}>{COMPARABILITY_ASSESSMENTS[review.assessment]}</td></tr>
        {Object.entries(COMPARABILITY_DIMENSIONS).map(([key, label]) => {
          const dimension = review.dimensions[key as keyof typeof COMPARABILITY_DIMENSIONS];
          return <tr key={key}>
            <th scope="row" style={labelStyle}>{label}</th>
            <td style={valueStyle}><strong>{COMPARABILITY_STATUS[dimension.status]}.</strong> {dimension.note}</td>
          </tr>;
        })}
        <tr><th scope="row" style={labelStyle}>Agreement criteria and limits</th><td style={valueStyle}>{review.criteria}</td></tr>
      </tbody>
    </table>
    <p style={{ margin: '8px 0 0', fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-muted)' }}>
      This detailed author-reproduction review is retained alongside the pipeline, experimental-design and author-concordance badges.
      Author concordance assesses matched-gene effects and direction; matching author P values or FDR is not required.
      Cohort, comparison, identifier and effect limitations still need review.
    </p>
  </section>;
}

/**
 * The verification facts that must never sit behind a click.
 *
 * The library record used to render the whole reproduction dossier inline, which
 * pushed the study's own design 2,900px down a 548px scroller. Collapsing the
 * dossier fixes that, but a corpus whose records carry "Unresolved, review
 * required" cannot answer the honesty question with a disclosure triangle: a
 * reader who never opens it must still leave with the limitations.
 *
 * So this is the contract, and `authorValidationSummary.test.tsx` holds it:
 *
 *   1. all three badges (pipeline QC, experimental design and author concordance)
 *   2. the one-line record summary
 *   3. the explicit author-review CLAIM — green badges are not a claim of
 *      full author reproduction, and only this badge says which claim is made
 *   4. the comparability assessment, in words, so the claim carries its scope
 *   5. the limitations, as visible TEXT — never only inside a badge tooltip
 *
 * (5) is the one with a hole in the old markup: the limitations callout rendered
 * only `reviewFlags`, so an unresolved record that happened to carry none
 * displayed nothing at all and read as clean. `limitationText` closes that.
 */
export function AuthorValidationSummary({ record, contrastId, onOpenReport }: {
  record: AuthorValidationRecord; contrastId?: string; onOpenReport?: () => void;
}) {
  const { verification } = record;
  const unresolved = verification.state === 'unresolved';
  // Never empty when the state is unresolved: a record can be flagged for review
  // without carrying itemised flags, and silence there would read as "no known
  // limitations" — the opposite of what the state means.
  const limitationText = record.reviewFlags.length > 0
    ? record.reviewFlags.join(' ')
    : unresolved
      ? 'This record is flagged for review. Open the verification report for the recorded checks and their limits.'
      : null;
  return (
    <section aria-label="Verification summary" data-validation-summary={record.datasetId} style={{
      border: `1px solid ${unresolved ? 'var(--danger-border)' : 'var(--border)'}`,
      borderRadius: 8, padding: '10px 12px', background: 'var(--bg-app)',
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7 }}>
        <AuthorValidationBadge record={record} contrastId={contrastId} />
        <AuthorReviewBadge record={record} />
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 12, fontWeight: 600, lineHeight: 1.45, color: 'var(--text-primary)' }}>
        {record.summary}
      </p>
      {verification.state !== 'excluded' && (
        <p data-validation-scope style={{ margin: '4px 0 0', fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-muted)' }}>
          {COMPARABILITY_ASSESSMENTS[verification.comparability.assessment]}
        </p>
      )}
      {limitationText && (
        <p data-validation-limitation style={{
          margin: '8px 0 0', padding: '7px 9px', borderRadius: 5, fontSize: 11.5, lineHeight: 1.5,
          border: `1px solid ${unresolved ? 'var(--danger-border)' : 'var(--border)'}`,
          background: unresolved ? 'var(--danger-bg)' : 'var(--bg-panel)',
          color: unresolved ? 'var(--danger-text)' : 'var(--text-primary)',
        }}>
          <strong>{unresolved ? 'Unresolved, review required:' : 'Evidence limitations:'}</strong> {limitationText}
        </p>
      )}
      {onOpenReport && (
        <button type="button" onClick={onOpenReport} style={{
          marginTop: 9, padding: 0, border: 'none', background: 'none', cursor: 'pointer',
          color: 'var(--accent)', fontSize: 12, fontFamily: 'inherit', textAlign: 'left',
        }}>
          Full verification report ↓
        </button>
      )}
    </section>
  );
}

export function AuthorValidationPanel({ record, contrastId, summaryShownAbove = false }: {
  record: AuthorValidationRecord;
  contrastId?: string;
  /**
   * Drop the badges/claim/summary header, because an <AuthorValidationSummary>
   * already stands above this panel and would otherwise say it all twice. Only
   * the library record passes this; the tracker and the explorer render the
   * panel on its own and need it to introduce itself.
   */
  summaryShownAbove?: boolean;
}) {
  const verification = record.verification;
  const metrics = record.directComparison?.metrics;
  const pathway = record.pathwayValidation;
  const metricFacts = metrics ? [
    ['Shared genes', metrics.sharedGenes?.toLocaleString() ?? null],
    ['Pearson logFC', decimal(metrics.pearsonLogFC)],
    ['Spearman logFC', decimal(metrics.spearmanLogFC)],
    ['Same-gene direction agreement', percent(metrics.signConcordance)],
    ['Genes with nonzero effects in both analyses', metrics.signComparableGenes?.toLocaleString() ?? null],
    ['Median absolute logFC difference', decimal(metrics.medianAbsLogFCDelta)],
    ['Paired local / author effect scale', decimal(metrics.effectScaleRatio)],
    ['Strong-effect direction agreement', percent(metrics.strongEffectSignConcordance)],
    ['Author-significant direction agreement', percent(metrics.authorSignificantSignConcordance)],
    ['Reported-call Jaccard (see scope)', decimal(metrics.significantSetJaccard)],
    ['Paper-rule author / local calls', metrics.paperFilteredAuthorGenes != null && metrics.paperFilteredLocalGenes != null
      ? `${metrics.paperFilteredAuthorGenes.toLocaleString()} / ${metrics.paperFilteredLocalGenes.toLocaleString()}` : null],
    ['Paper-rule shared calls', metrics.paperFilteredInBoth?.toLocaleString() ?? null],
    ['Paper-rule call-list Jaccard', decimal(metrics.paperFilteredSetJaccard)],
    ['Paper-rule shared-call direction agreement', percent(metrics.paperFilteredDirectionConcordance)],
    ['Expressed-gene subset', metrics.expressedGeneCount?.toLocaleString() ?? null],
    ['Expressed-gene Pearson logFC', decimal(metrics.expressedPearsonLogFC)],
    ['Expressed-gene median |logFC delta|', decimal(metrics.expressedMedianAbsLogFCDelta)],
    ['Expressed-gene direction agreement', percent(metrics.expressedSignConcordance)],
  ].filter((fact): fact is [string, string] => fact[1] != null) : [];

  return (
    <section aria-label="Author validation" data-validation-detail={record.datasetId}>
      {!summaryShownAbove && <>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <AuthorValidationBadge record={record} contrastId={contrastId} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{record.summary}</span>
        </div>
        <p style={{ margin: '0 0 10px', fontSize: 12, lineHeight: 1.55 }}>Hover, focus or tap a badge to inspect each check.
          Pipeline QC, experimental design and author concordance are assessed separately. The detailed author-reproduction review follows below.</p>
        <AuthorReviewBadge record={record} />
      </>}
      <p style={{ margin: '0 0 8px', fontSize: 12, lineHeight: 1.55, color: 'var(--text-primary)' }}>
        {verification.reason}
      </p>
      {verification.state !== 'excluded' && <ComparabilityPanel review={verification.comparability} summary={verification.reason}
        references={record.evidenceLinks.filter((link) => link.kind === 'author_result')} />}
      <details style={{ margin: '0 0 12px', fontSize: 12, lineHeight: 1.55 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Detailed review note and numerical findings</summary>
        <p style={{ margin: '7px 0', color: 'var(--text-primary)' }}>{record.note}</p>
      </details>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <tr>
            <th scope="row" style={labelStyle}>Evidence level</th>
            <td style={valueStyle}>{EVIDENCE_LEVELS[verification.evidenceLevel].label}</td>
          </tr>
          <tr>
            <th scope="row" style={labelStyle}>Author-result availability</th>
            <td style={valueStyle}>{RESULT_AVAILABILITY[verification.resultAvailability].label}</td>
          </tr>
          <tr>
            <th scope="row" style={labelStyle}>Comparison outcome</th>
            <td style={valueStyle}>{COMPARISON_OUTCOMES[verification.comparisonOutcome].label}</td>
          </tr>
          <tr>
            <th scope="row" style={labelStyle}>Exact author-reproduction sign-off</th>
            <td style={valueStyle}>{verification.state === 'excluded' ? 'Outside scope'
              : `${verification.fullyVerifiedContrasts.length} of ${record.contrastCount} registered contrasts`}
              {verification.fullyVerifiedContrasts.length > 0 && `: ${verification.fullyVerifiedContrasts.join(', ')}`}
            </td>
          </tr>
          <tr>
            <th scope="row" style={labelStyle}>Internal audit classification</th>
            <td style={valueStyle}>{AUTHOR_VALIDATION_STATUS[record.status].label}</td>
          </tr>
          <tr>
            <th scope="row" style={labelStyle}>Review date / coverage</th>
            <td style={valueStyle}>{record.validatedAt} · {record.auditState === 'complete'
              ? 'Recorded audit checks complete; not a full-verification claim'
              : record.auditState === 'excluded' ? 'Excluded' : 'Audit checks in progress'}</td>
          </tr>
          <tr>
            <th style={labelStyle}>Comparison level</th>
            <td style={valueStyle}>{comparisonLevelLabel(record.comparisonLevel)}</td>
          </tr>
          <tr>
            <th style={labelStyle}>Processed source</th>
            <td style={valueStyle}>{sourceComparisonLabel(record.sourceComparison)}</td>
          </tr>
          <tr>
            <th style={labelStyle}>Pipeline output trace</th>
            <td style={valueStyle}>
              {record.pipelineTrace === 'exact'
                ? `Exact for ${record.contrastCount} registered contrast${record.contrastCount === 1 ? '' : 's'}`
                : record.pipelineTrace === 'mismatch' ? 'Mismatch' : 'Not applicable'}
              {record.pipelineTrace === 'exact' && <div>Displayed values match our local analysis output. This does not establish that the analysis agrees with the authors.</div>}
            </td>
          </tr>
          <tr>
            <th scope="row" style={labelStyle}>Pathway validation</th>
            <td style={valueStyle}>
              {pathway?.state === 'current_provenance_checked' ? (
                <>
                  <div>
                    Current schema-{pathway.provenanceSchemaVersion} pathway provenance and checksums verified
                    {' '}for <span style={{ fontFamily: FONT_MONO }}>{pathway.contrastCount}</span>
                    {' '}registered contrast{pathway.contrastCount === 1 ? '' : 's'}.
                  </div>
                  <div>Newly admitted analysis; no pre-migration baseline or migration comparison.</div>
                  <div style={{ color: 'var(--text-muted)' }}>
                    <span style={{ fontFamily: FONT_MONO }}>{pathway.currentRows.toLocaleString()}</span>
                    {' '}raw pathway rows across registered contrasts and collections. Source-bound output trace does not establish author pathway-result agreement.
                  </div>
                  {pathway.nonFiniteRows > 0 && (
                    <div style={{ color: 'var(--text-muted)' }}>
                      Untestable pathway rows:
                      {' '}<span style={{ fontFamily: FONT_MONO }}>{pathway.nonFiniteRows.toLocaleString()}</span>
                      {' '}omitted from displayed tables because statistics are missing; missing values are not zeros.
                    </div>
                  )}
                </>
              ) : pathway ? (
                <>
                  <div>
                    Cache-isolated rebuild; schema-{pathway.provenanceSchemaVersion} provenance and checksums verified
                    {' '}for <span style={{ fontFamily: FONT_MONO }}>{pathway.contrastCount}</span>
                    {' '}registered contrast{pathway.contrastCount === 1 ? '' : 's'}.
                  </div>
                  <div>
                    Versus pre-audit local outputs:
                    {' '}<span style={{ fontFamily: FONT_MONO }}>{pathway.totals.addedRows.toLocaleString()}</span> pathway result rows added;
                    {' '}<span style={{ fontFamily: FONT_MONO }}>{pathway.totals.removedRows.toLocaleString()}</span> removed.
                    {' '}FDR {'<'} 0.05 calls:
                    {' '}<span style={{ fontFamily: FONT_MONO }}>{pathway.totals.fdrCallsGained.toLocaleString()}</span> gained;
                    {' '}<span style={{ fontFamily: FONT_MONO }}>{pathway.totals.fdrCallsLost.toLocaleString()}</span> lost.
                  </div>
                  <div style={{ color: 'var(--text-muted)' }}>
                    Across registered contrasts and collections; not an author pathway-result match.
                  </div>
                  {pathway.totals.nonFiniteRowsAfter > 0 && (
                    <div style={{ color: 'var(--text-muted)' }}>
                      Untestable pathway rows:
                      {' '}<span style={{ fontFamily: FONT_MONO }}>{pathway.totals.nonFiniteRowsAfter.toLocaleString()}</span>
                      {' '}omitted from displayed tables because statistics are missing; missing values are not zeros.
                    </div>
                  )}
                  {pathway.baselineKind === 'local_snapshot' && (
                    <div title={pathway.baselineNote} style={{ color: 'var(--text-muted)' }}>
                      Baseline exception: hash-pinned pre-migration local snapshot; no committed baseline.
                    </div>
                  )}
                </>
              ) : record.status === 'not_applicable' ? 'Not in validation scope' : 'No pathway validation evidence recorded'}
            </td>
          </tr>
          <tr>
            <th style={labelStyle}>Paper access</th>
            <td style={valueStyle}>{paperAccessLabel(record.paperAccess)}</td>
          </tr>
          {record.processedDataAccession && record.processedDataAccession !== record.accession && (
            <tr>
              <th style={labelStyle}>Processed-data series</th>
              <td style={{ ...valueStyle, fontFamily: FONT_MONO }}>{record.processedDataAccession}</td>
            </tr>
          )}
          {record.directComparison && (
            <tr>
              <th style={labelStyle}>Compared contrast</th>
              <td style={valueStyle}>{record.directComparison.contrast}</td>
            </tr>
          )}
          {record.directComparison?.orientation && <tr>
            <th scope="row" style={labelStyle}>Comparison direction</th>
            <td style={valueStyle}>{record.directComparison.orientation}</td>
          </tr>}
          {record.directComparison?.localMethod && <tr>
            <th scope="row" style={labelStyle}>Compared methods</th>
            <td style={valueStyle}>Registered: {record.directComparison.localMethod}. Author: {record.directComparison.authorMethod}.</td>
          </tr>}
          {record.directComparison?.paperFilterDefinition && <tr>
            <th scope="row" style={labelStyle}>Author selection rule</th>
            <td style={valueStyle}>{record.directComparison.paperFilterDefinition}</td>
          </tr>}
          {record.directComparison && <tr>
            <th scope="row" style={labelStyle}>How to read call overlap</th>
            <td style={valueStyle}>Reported-call metrics use the comparison&apos;s stated universe and threshold (usually adjusted P {'<'}0.05).
              Paper-rule metrics additionally use the explicitly documented author selection rule. These scores are not interchangeable;
              missing author tests and selected-only reference lists cannot establish full-universe agreement.</td>
          </tr>}
          {record.directComparison?.note && <tr>
            <th scope="row" style={labelStyle}>Numerical comparison scope</th>
            <td style={valueStyle}>{record.directComparison.note}</td>
          </tr>}
          {metricFacts.map(([label, value]) => (
            <tr key={label}>
              <th scope="row" style={labelStyle}>{label}</th>
              <td style={{ ...valueStyle, fontFamily: FONT_MONO }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {record.reviewFlags.length > 0 && (
        <div style={{
          marginTop: 9, padding: '8px 10px', borderRadius: 5,
          border: verification.state === 'unresolved' ? '1px solid var(--danger-border)' : '1px solid var(--border)',
          background: verification.state === 'unresolved' ? 'var(--danger-bg)' : 'var(--bg-app)',
          color: verification.state === 'unresolved' ? 'var(--danger-text)' : 'var(--text-primary)', fontSize: 11.5, lineHeight: 1.5,
        }}>
          <strong>{verification.state === 'unresolved' ? 'Unresolved, review required:' : 'Evidence limitations:'}</strong> {record.reviewFlags.join(' ')}
        </div>
      )}
      <p style={{ margin: '10px 0', fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-primary)' }}>
        <strong>{verification.state === 'full' ? 'Maintenance:' : 'Detailed author-review next step:'}</strong> {verification.nextStep}
      </p>
      <a href="#/verification" style={{ fontSize: 12, color: 'var(--accent)' }}>How data verification works</a>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
        {record.evidenceLinks.map((link) => (
          <a
            key={`${link.kind}-${link.url}`}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border-dark)',
              background: 'var(--bg-app)', color: 'var(--accent)', fontSize: 11,
              fontWeight: 600, textDecoration: 'none',
            }}
          >
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}
