import { AuthorEvidenceLabel, AuthorValidationBadge, AuthorValidationPanel } from './AuthorValidation';
import { getAuthorValidation } from '../data/authorValidation';
import { EVIDENCE_LEVELS, RESULT_AVAILABILITY } from '../data/authorVerification';
import { libraryHref } from '../utils/appLinks';
import { FONT_SANS } from '../styles/constants';

/** The same evidence record follows a dataset into every exploration surface. */
export function DatasetVerificationLink({ datasetId }: { datasetId: string }) {
  const record = getAuthorValidation(datasetId);
  if (!record) return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Verification not assessed</span>;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', letterSpacing: 0, textTransform: 'none' }}>
      <AuthorValidationBadge record={record} compact />
      <AuthorEvidenceLabel record={record} />
      <a href={libraryHref(datasetId)} aria-label={`Verification evidence for ${record.accession}: ${record.verification.reason}`}
        style={{ color: 'var(--accent)', fontSize: 11 }}>Evidence &amp; limitations</a>
    </span>
  );
}

/** A keyboard-accessible disclosure, visible before plots even while a bundle loads. */
export function DatasetVerificationContext({ datasetId, contrastId }: { datasetId: string; contrastId?: string }) {
  const record = getAuthorValidation(datasetId);
  if (!record) return (
    <div style={{ padding: '7px 24px', fontSize: 12, flexShrink: 0 }}>
      Verification not assessed. <a href="#/verification">How verification works</a>
    </div>
  );
  const { verification } = record;
  return (
    <div data-explorer-verification={datasetId} style={{
      flexShrink: 0, fontFamily: FONT_SANS, fontSize: 11.5,
      borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)',
    }}>
      <div style={{ padding: '7px 24px', color: 'var(--text-primary)', lineHeight: 1.7 }}>
        <span style={{ marginRight: 9, fontWeight: 600 }}>Dataset verification</span>
        <AuthorValidationBadge record={record} compact contrastId={contrastId} />
        <span style={{ marginLeft: 9, color: 'var(--text-muted)' }}>
          {EVIDENCE_LEVELS[verification.evidenceLevel].label} · {RESULT_AVAILABILITY[verification.resultAvailability].label}
        </span>
      </div>
      <details><summary style={{ padding: '0 24px 7px', cursor: 'pointer', color: 'var(--accent)' }}>Evidence &amp; limitations</summary>
      <div style={{ maxHeight: '36vh', overflowY: 'auto', padding: '0 24px 12px' }}>
        {contrastId && verification.state !== 'excluded' && !verification.fullyVerifiedContrasts.includes(contrastId) && (
          <p style={{ margin: '0 0 10px', color: 'var(--text-primary)', lineHeight: 1.5 }}>
            Each badge applies to the selected comparison and its recorded checks. It does not independently
            certify every displayed gene or pathway. Exact author-reproduction sign-off is recorded separately below.
          </p>
        )}
        <AuthorValidationPanel record={record} contrastId={contrastId} />
      </div>
      </details>
    </div>
  );
}
