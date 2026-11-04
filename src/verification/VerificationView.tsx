import type { ReactNode } from 'react';
import { PageShell } from '../common/PageShell';
import { AuthorValidationBadge } from '../common/AuthorValidation';
import { P, tdStyle as numericCellStyle, thStyle } from '../common/prose';
import { AUTHOR_VALIDATION_REPORT } from '../data/authorValidation';
import { RESULT_AVAILABILITY, VERIFICATION_CLAIMS, getVerificationClaim } from '../data/authorVerification';
import { AUTHOR_CONCORDANCE_POLICY as POLICY } from '../data/authorConcordance';
import { datasetQuality, QUALITY_STATUS } from '../data/datasetQualityR460';
import { FONT_MONO, FONT_SANS } from '../styles/constants';
import { libraryHref } from '../utils/appLinks';

const RECORDS = AUTHOR_VALIDATION_REPORT.records;
const TABLE = { width: '100%', borderCollapse: 'collapse' as const, margin: '12px 0 20px' };
const CELL = { ...numericCellStyle, fontFamily: FONT_SANS, fontSize: 13, lineHeight: 1.55, overflowWrap: 'anywhere' as const };
const NUMBER = { ...CELL, fontFamily: FONT_MONO, textAlign: 'right' as const };
function H2({ children }: { children: ReactNode }) {
  return <h2 style={{ fontSize: 16, fontWeight: 600, margin: '28px 0 10px' }}>{children}</h2>;
}

export function VerificationView({ onHome }: { onHome: () => void }) {
  const assessed = RECORDS.map((record) => datasetQuality(record));
  const unresolved = RECORDS.filter((record) => record.verification.state === 'unresolved');
  const pending = RECORDS.filter((record) => record.verification.state === 'in_progress');
  return <PageShell onHome={onHome} breadcrumbs={[{ label: 'Data verification', current: true }]}
    mainStyle={{ width: '100%', maxWidth: 880, margin: '0 auto', padding: '28px 24px 56px', boxSizing: 'border-box' }}>
    <article style={{ fontFamily: FONT_SANS, color: 'var(--text-primary)' }}>
      <h1 style={{ margin: '0 0 8px', fontSize: 24 }}>How data verification works</h1>
      <P>Three badges describe processing quality, the source experiment's design evidence and agreement with published biological effects.
        Hover, focus or tap a badge to see every check, its outcome and the evidence behind it.
        The library, tracker and Explorer use the same assessments.</P>
      <P><strong>A green check means that the stated check passed.</strong> Missing evidence is marked not assessed;
        failed checks and results needing review stay visible. Pipeline QC can pass while experimental-design limitations remain or an author result table is unavailable.</P>
      <p style={{ fontSize: 12 }}><a href="#/library">Browse dataset evidence</a>{' · '}<a href="#/tracker">Open the dataset tracker</a></p>
      <H2>Pipeline QC, experimental design and author concordance</H2>
      <table style={TABLE} aria-label="Current quality-control coverage">
        <thead><tr><th scope="col" style={thStyle}>Status</th><th scope="col" style={thStyle}>Pipeline QC</th><th scope="col" style={thStyle}>Experimental design</th><th scope="col" style={thStyle}>Author concordance</th></tr></thead>
        <tbody>{Object.entries(QUALITY_STATUS).map(([key, status]) => <tr key={key}>
          <th scope="row" style={{ ...CELL, textAlign: 'left' }}>{status.label}</th>
          <td style={NUMBER}>{assessed.filter((q) => q.pipelineQc.status === key).length}</td>
          <td style={NUMBER}>{assessed.filter((q) => q.experimentalDesign.status === key).length}</td>
          <td style={NUMBER}>{assessed.filter((q) => q.authorConcordance.status === key).length}</td>
        </tr>)}</tbody>
      </table>
      <P>These are dataset-level counts. A dataset-wide pass requires coverage of its registered comparisons.
        The Explorer badge follows the selected comparison. Evidence from a selected list of author genes applies only to that list.
        It does not certify every gene or pathway.</P>
      <H2>What pipeline QC checks</H2>
      <P>The audit checks the current analysis files for source integrity, sample assignments, valid matrix values,
        preprocessing and normalization evidence, model evidence, and output integrity. Each checklist states what the available evidence supports.
        Stale reports and missing evidence cannot provide a passing check. A successful script exit or matching file alone does not establish model validity.</P>
      <P>All required checks must pass. Checks that do not apply to the assay are marked not applicable.
        This workflow begins with deposited processed data. Raw-read alignment, raw sequencing quality and laboratory measurements are outside its scope.</P>
      <H2>What experimental design checks</H2>
      <P>This assessment records evidence about independent biological replication and retained sample support.
        Missing animal-to-litter, cage or pair assignments remain visible here. They cannot be recovered from expression values alone.
        A pass applies to these recorded checks; it does not certify every aspect of the original experiment.</P>
      <P>Species-mapping errors, normalization discrepancies and known model problems, including unmodeled pairing, still block pipeline QC.
        Use the design notes when interpreting results even when processing checks pass.</P>
      <H2>What author concordance checks</H2>
      <P>Author concordance asks whether our registered processing preserves the biological effects in a comparable author result.
        Strong correlation or agreement in matched-gene direction can satisfy its numerical criterion.
        It allows justified differences in statistical methods. Matching author magnitudes, P values, FDR and significant-gene counts is not required.
        Sample, comparison, identifier and effect-definition problems still need review.
        Different estimators can be compatible when their biological direction and effect units are documented;
        identical model coefficients are not required.</P>
      <table style={TABLE} aria-label="Author concordance acceptance criteria">
        <thead><tr><th scope="col" style={thStyle}>Check</th><th scope="col" style={thStyle}>Project acceptance criterion</th></tr></thead>
        <tbody>{[
          ['Comparable evidence', 'Direct author effects compared with the registered output for the stated comparison. Reconstructed effects and separate refits do not transfer a pass.'],
          ['Gene coverage', `At least ${POLICY.minimumSharedGenes} matched genes and ${POLICY.minimumCoverage * 100}% coverage of local genes for a full table, or of author genes for a selected list. Both universe sizes remain visible.`],
          ['Correlation route', `Both Pearson and Spearman correlations of paired gene effects are at least ${POLICY.minimumCorrelation}. Passing this route or the direction route is sufficient.`],
          ['Direction route', `At least ${POLICY.minimumDirectionAgreement * 100}% of the same genes change in the same direction. At least ${POLICY.minimumDirectionalGenes} genes and ${POLICY.minimumDirectionalCoverage * 100}% of pairs must have nonzero effects in both analyses.`],
          ['Effect magnitude (context)', `Median absolute log2-fold-change difference is compared with ${POLICY.maximumMedianLogFCDelta}; the local-to-author RMS effect ratio is compared with two-thirds to ${POLICY.maximumEffectScale}. These values provide context and do not determine whether concordance passes.`],
        ].map(([label, description]) => <tr key={label}><th scope="row" style={{ ...CELL, textAlign: 'left' }}>{label}</th><td style={CELL}>{description}</td></tr>)}</tbody>
      </table>
      <P>These are versioned project acceptance defaults, not universal scientific cutoffs. Compatible samples, contrasts, identifiers,
        effect definitions and sufficient coverage are required whichever numerical route passes. The checklist names the passing route and retains other metric outcomes.
        Similar overall percentages of upregulated genes do not establish agreement of the same genes.
        Zero effects do not establish a direction, and unavailable author statistics are not counted as negative calls.</P>
      <H2>Unavailable evidence is not a failed comparison</H2>
      <P>Missing reference data is an evidence gap, not evidence of a mismatch. A deposited expression matrix does not necessarily contain author results.
        &quot;Not located&quot; means no reference was found in the sources reviewed. &quot;Access blocked&quot; means it could not be retrieved.
        Detailed reviews retain evidence links, limitations and next steps.</P>
      <table style={TABLE} aria-label="Author reference availability">
        <thead><tr><th scope="col" style={thStyle}>Author reference</th><th scope="col" style={thStyle}>Datasets</th></tr></thead>
        <tbody>{Object.entries(RESULT_AVAILABILITY).map(([key, value]) => <tr key={key}>
          <th scope="row" style={{ ...CELL, textAlign: 'left' }}>{value.label}</th><td style={NUMBER}>{RECORDS.filter((r) => r.verification.resultAvailability === key).length}</td>
        </tr>)}</tbody>
      </table>
      <H2>Detailed author-reproduction review</H2>
      <P>The earlier review asks whether effects, inference and full result coverage have all been reconciled with the authors.
        Its notes and classifications are retained for scientific context. They do not determine the three badges.
        A method or FDR difference can remain in that review while biological-effect concordance passes.</P>
      <details><summary style={{ cursor: 'pointer' }}>Detailed review classifications and coverage</summary>
        <table style={TABLE} aria-label="Detailed author-review coverage"><tbody>{Object.entries(VERIFICATION_CLAIMS).map(([key, claim]) => <tr key={key}>
          <th scope="row" style={{ ...CELL, textAlign: 'left' }}>{claim.label}</th><td style={CELL}>{claim.description}</td>
          <td style={NUMBER}>{RECORDS.filter((r) => getVerificationClaim(r.verification) === key).length}</td>
        </tr>)}</tbody></table>
      </details>
      <H2>Unresolved author-review findings</H2>
      <ul style={{ paddingLeft: 20, fontSize: 13, lineHeight: 1.6 }}>{unresolved.map((record) => <li key={record.datasetId} style={{ marginBottom: 16 }}>
        <a href={libraryHref(record.datasetId)} style={{ marginRight: 8 }}>{record.accession}</a><AuthorValidationBadge record={record} compact />
        <div>{record.verification.reason}</div><div style={{ color: 'var(--text-muted)' }}>Next: {record.verification.nextStep}</div>
      </li>)}</ul>
      <details><summary style={{ cursor: 'pointer' }}>Reviews still underway ({pending.length})</summary>
        <P>These detailed reviews are unfinished. The three badges separately show which checks have evidence.</P>
        <ul>{pending.map((record) => <li key={record.datasetId}><a href={libraryHref(record.datasetId)}>{record.accession}</a><div>{record.verification.nextStep}</div></li>)}</ul>
      </details>
    </article>
  </PageShell>;
}
