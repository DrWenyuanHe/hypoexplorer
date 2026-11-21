import type { ReactNode } from 'react';
import { PageShell } from '../common/PageShell';
import { AuthorValidationBadge } from '../common/AuthorValidation';
import { P, PROSE_MEASURE, ProsePage, ProseSection, tdStyle as numericCellStyle, thStyle } from '../common/prose';
import { AUTHOR_VALIDATION_REPORT } from '../data/authorValidation';
import { RESULT_AVAILABILITY, VERIFICATION_CLAIMS, getVerificationClaim } from '../data/authorVerification';
import { AUTHOR_CONCORDANCE_POLICY as POLICY } from '../data/authorConcordance';
import { datasetQuality, QUALITY_STATUS } from '../data/datasetQualityR460';
import { FONT_MONO, FONT_SANS } from '../styles/constants';
import { libraryHref } from '../utils/appLinks';

const RECORDS = AUTHOR_VALIDATION_REPORT.records;
const TABLE = { width: '100%', borderCollapse: 'collapse' as const, margin: '12px 0 20px' };
// Count tables take only the width their columns need.
const COUNT_TABLE = { ...TABLE, width: 'auto' };
// Horizontal cell padding reads --cell-x, which the count table narrows on a 320px screen (prose.css).
const CELL_PADDING = '6px var(--cell-x, 10px)';
const CELL = { ...numericCellStyle, padding: CELL_PADDING, fontFamily: FONT_SANS, fontSize: 13, lineHeight: 1.55, overflowWrap: 'anywhere' as const };
const NUMBER = { ...CELL, fontFamily: FONT_MONO, textAlign: 'right' as const };
// Row labels wrap between words only; 'anywhere' let the column shrink below a
// word's width and split "Passed" into "Pass" + "ed" on a phone.
const ROW_HEAD = { ...CELL, textAlign: 'left' as const, overflowWrap: 'break-word' as const };
// The four-column count table's headers wrap between words so it fits a phone.
const COUNT_HEAD = { ...thStyle, padding: CELL_PADDING, whiteSpace: 'normal' as const, verticalAlign: 'bottom' as const };
// Headers over figures align with them.
const COUNT_HEAD_NUMBER = { ...COUNT_HEAD, textAlign: 'right' as const };
const TH_NUMBER = { ...thStyle, textAlign: 'right' as const };
const SUMMARY = { cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)', margin: '4px 0 8px' };
const LIST = { paddingLeft: 20, fontSize: 13, lineHeight: 1.6, overflowWrap: 'anywhere' as const, maxWidth: PROSE_MEASURE };
const ACCESSION = { fontFamily: FONT_MONO, fontSize: 12 };

const SECTIONS = [
  { id: 'verification-coverage', title: 'Pipeline QC, experimental design and author concordance' },
  { id: 'verification-pipeline', title: 'What pipeline QC checks' },
  { id: 'verification-design', title: 'What experimental design checks' },
  { id: 'verification-concordance', title: 'What author concordance checks' },
  { id: 'verification-unavailable', title: 'Unavailable evidence is not a failed comparison' },
  { id: 'verification-review', title: 'Detailed author-reproduction review' },
  { id: 'verification-unresolved', title: 'Unresolved author-review findings' },
] as const;

function Section({ id, children }: { id: typeof SECTIONS[number]['id']; children: ReactNode }) {
  return <ProseSection section={SECTIONS.find((s) => s.id === id)!}>{children}</ProseSection>;
}

export function VerificationView({ onHome }: { onHome: () => void }) {
  const assessed = RECORDS.map((record) => datasetQuality(record));
  const unresolved = RECORDS.filter((record) => record.verification.state === 'unresolved');
  const pending = RECORDS.filter((record) => record.verification.state === 'in_progress');
  return <PageShell onHome={onHome} breadcrumbs={[{ label: 'Data verification', current: true }]}>
    <ProsePage title="How data verification works" sections={SECTIONS} intro={<>
      <P>Three badges describe processing quality, the source experiment's design evidence and agreement with published biological effects.
        Hover, focus or tap a badge to see every check, its outcome and the evidence behind it.
        The library, tracker and Explorer use the same assessments.</P>
      <P><strong>A green check means that the stated check passed.</strong> Missing evidence is marked not assessed;
        failed checks and results needing review stay visible. Pipeline QC can pass while experimental-design limitations remain or an author result table is unavailable.</P>
      <p style={{ fontSize: 12, margin: '0 0 12px' }}><a href="#/library">Browse dataset evidence</a>{' · '}<a href="#/tracker">Open the dataset tracker</a></p>
    </>}>
      <Section id="verification-coverage">
        <table className="verification-count-table" style={COUNT_TABLE} aria-label="Current quality-control coverage">
          <thead><tr><th scope="col" style={COUNT_HEAD}>Status</th><th scope="col" style={COUNT_HEAD_NUMBER}>Pipeline QC</th><th scope="col" style={COUNT_HEAD_NUMBER}>Experimental design</th><th scope="col" style={COUNT_HEAD_NUMBER}>Author concordance</th></tr></thead>
          <tbody>{Object.entries(QUALITY_STATUS).map(([key, status]) => <tr key={key}>
            <th scope="row" style={ROW_HEAD}>{status.label}</th>
            <td style={NUMBER}>{assessed.filter((q) => q.pipelineQc.status === key).length}</td>
            <td style={NUMBER}>{assessed.filter((q) => q.experimentalDesign.status === key).length}</td>
            <td style={NUMBER}>{assessed.filter((q) => q.authorConcordance.status === key).length}</td>
          </tr>)}</tbody>
        </table>
        <P>These are dataset-level counts. A dataset-wide pass requires coverage of its registered comparisons.
          The Explorer badge follows the selected comparison. Evidence from a selected list of author genes applies only to that list.
          It does not certify every gene or pathway.</P>
      </Section>
      <Section id="verification-pipeline">
        <P>The audit checks the current analysis files for source integrity, sample assignments, valid matrix values,
          preprocessing and normalization evidence, model evidence, and output integrity. Each checklist states what the available evidence supports.
          Stale reports and missing evidence cannot provide a passing check. A successful script exit or matching file alone does not establish model validity.</P>
        <P>All required checks must pass. Checks that do not apply to the assay are marked not applicable.
          This workflow begins with deposited processed data. Raw-read alignment, raw sequencing quality and laboratory measurements are outside its scope.</P>
      </Section>
      <Section id="verification-design">
        <P>This assessment records evidence about independent biological replication and retained sample support.
          Missing animal-to-litter, cage or pair assignments remain visible here. They cannot be recovered from expression values alone.
          A pass applies to these recorded checks; it does not certify every aspect of the original experiment.</P>
        <P>Species-mapping errors, normalization discrepancies and known model problems, including unmodeled pairing, still block pipeline QC.
          Use the design notes when interpreting results even when processing checks pass.</P>
      </Section>
      <Section id="verification-concordance">
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
          ].map(([label, description]) => <tr key={label}><th scope="row" style={ROW_HEAD}>{label}</th><td style={CELL}>{description}</td></tr>)}</tbody>
        </table>
        <P>These are versioned project acceptance defaults, not universal scientific cutoffs. Compatible samples, contrasts, identifiers,
          effect definitions and sufficient coverage are required whichever numerical route passes. The checklist names the passing route and retains other metric outcomes.
          Similar overall percentages of upregulated genes do not establish agreement of the same genes.
          Zero effects do not establish a direction, and unavailable author statistics are not counted as negative calls.</P>
      </Section>
      <Section id="verification-unavailable">
        <P>Missing reference data is an evidence gap, not evidence of a mismatch. A deposited expression matrix does not necessarily contain author results.
          &quot;Not located&quot; means no reference was found in the sources reviewed. &quot;Access blocked&quot; means it could not be retrieved.
          Detailed reviews retain evidence links, limitations and next steps.</P>
        <table style={COUNT_TABLE} aria-label="Author reference availability">
          <thead><tr><th scope="col" style={thStyle}>Author reference</th><th scope="col" style={TH_NUMBER}>Datasets</th></tr></thead>
          <tbody>{Object.entries(RESULT_AVAILABILITY).map(([key, value]) => <tr key={key}>
            <th scope="row" style={ROW_HEAD}>{value.label}</th><td style={NUMBER}>{RECORDS.filter((r) => r.verification.resultAvailability === key).length}</td>
          </tr>)}</tbody>
        </table>
      </Section>
      <Section id="verification-review">
        <P>The earlier review asks whether effects, inference and full result coverage have all been reconciled with the authors.
          Its notes and classifications are retained for scientific context. They do not determine the three badges.
          A method or FDR difference can remain in that review while biological-effect concordance passes.</P>
        <details><summary style={SUMMARY}>Detailed review classifications and coverage</summary>
          <table style={TABLE} aria-label="Detailed author-review coverage"><tbody>{Object.entries(VERIFICATION_CLAIMS).map(([key, claim]) => <tr key={key}>
            <th scope="row" style={ROW_HEAD}>{claim.label}</th><td style={CELL}>{claim.description}</td>
            <td style={NUMBER}>{RECORDS.filter((r) => getVerificationClaim(r.verification) === key).length}</td>
          </tr>)}</tbody></table>
        </details>
      </Section>
      <Section id="verification-unresolved">
        {/* Review notes quote checksums and file names, which must wrap on a phone. */}
        <ul style={{ ...LIST, margin: '0 0 16px' }}>{unresolved.map((record) => <li key={record.datasetId} style={{ marginBottom: 16 }}>
          <a href={libraryHref(record.datasetId)} style={{ ...ACCESSION, marginRight: 8 }}>{record.accession}</a><AuthorValidationBadge record={record} compact />
          <div>{record.verification.reason}</div><div style={{ color: 'var(--text-muted)' }}>Next: {record.verification.nextStep}</div>
        </li>)}</ul>
        <details><summary style={SUMMARY}>Reviews still underway ({pending.length})</summary>
          <P>These detailed reviews are unfinished. The three badges separately show which checks have evidence.</P>
          <ul style={{ ...LIST, margin: '0 0 12px' }}>{pending.map((record) => <li key={record.datasetId} style={{ marginBottom: 8 }}><a href={libraryHref(record.datasetId)} style={ACCESSION}>{record.accession}</a><div>{record.verification.nextStep}</div></li>)}</ul>
        </details>
      </Section>
    </ProsePage>
  </PageShell>;
}
