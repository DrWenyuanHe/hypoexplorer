import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {isAbsolute, relative, resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {atlasFingerprint} from './macaqueQc.mjs';

export const QC_INPUT_BASELINE = 'data/intake/oxt-avp-2026-10-19/qc-input-baseline.json.gz';
export const QC_INPUT_BASELINE_SHA256 = '2de856378a45fb833e19437673448f2b3c9f552fe4b0a3aaa725bae56d13cb84';
export const QC_INPUT_BASELINE_BYTES = 5525396;
export const QC_INPUT_AVAILABILITY = 'data/internal-qc/input-availability.generated.json';
export const QC_INPUT_BASELINE_COMMIT = '1879fe04b7ec0d951a2ec93660389485c50e132e';
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const need = (ok: unknown, message: string) => assert.ok(ok, `QC retained identities: ${message}`);
export interface RetainedIdentity {path: string; sha256: string; availability: 'available_identity_checked' | 'unavailable_not_verified'}
export function fingerprintQcIdentity(path: string, bytes: Buffer): string {
  if (/\.(?:ts|tsx|mts|js|json|csv|tsv|txt|xml|md|r|py|soft)$/i.test(path)) {
    try { return atlasFingerprint(bytes); } catch { /* Non-UTF8 sources keep exact byte hashes. */ }
  }
  return hash(bytes);
}

export function readQcInputBaseline(root: string, read: (path: string) => Buffer = readFileSync): Record<string, string> {
  const bytes = gunzipSync(read(resolve(root, QC_INPUT_BASELINE)));
  need(bytes.length === QC_INPUT_BASELINE_BYTES && hash(bytes) === QC_INPUT_BASELINE_SHA256, 'pre-intake artifact identity differs');
  const document = JSON.parse(bytes.toString('utf8'));
  need(document.schemaVersion === 1 && document.records.length === 161 && document.inputs && Object.keys(document.inputs).length === 3932,
    'pre-intake artifact scope differs');
  return document.inputs;
}

/** Preserve expected identities, never a claim that an absent file was read. */
export function retainQcInputIdentities(root: string, current: Map<string, string>, baseline: Record<string, string>,
  fingerprint: (absolute: string) => string, exists = existsSync): RetainedIdentity[] {
  const retained: RetainedIdentity[] = [];
  for (const [path, expected] of Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b))) {
    need(typeof path === 'string' && !isAbsolute(path) && !path.includes('\\') && /^[a-f0-9]{64}$/.test(expected), 'invalid retained identity');
    const absolute = resolve(root, path), rel = relative(root, absolute);
    need(rel && !rel.startsWith('..') && !isAbsolute(rel), 'retained identity leaves workspace');
    if (current.has(path)) continue; // Current readers already measured this dependency.
    const available = exists(absolute);
    if (available) need(fingerprint(absolute) === expected, `available retained dependency changed: ${path}`);
    current.set(path, expected);
    retained.push({path, sha256: expected, availability: available ? 'available_identity_checked' : 'unavailable_not_verified'});
  }
  return retained;
}

export function qcInputAvailabilityDocument(observedInputCount: number, identities: RetainedIdentity[]) {
  return {
    schemaVersion: 1,
    policy: 'Expected identities retained from a fixed pre-intake QC artifact. Available retained dependencies are fingerprint-checked for identity only. Unavailable dependencies are not read or newly verified. This metadata never grants a passing QC check or changes a dataset status. Historical reads of absent source files still fail.',
    baseline: {archivePath: QC_INPUT_BASELINE, sourceCommit: QC_INPUT_BASELINE_COMMIT,
      sourcePath: 'data/internal-qc/assessments.generated.json', sourceSha256: QC_INPUT_BASELINE_SHA256, sourceBytes: QC_INPUT_BASELINE_BYTES},
    observedInputCount,
    retainedIdentityCount: identities.length,
    availableIdentityCount: identities.filter(row => row.availability === 'available_identity_checked').length,
    unavailableIdentityCount: identities.filter(row => row.availability === 'unavailable_not_verified').length,
    identities,
  };
}

export const QC_ACCEPT_DOWNGRADE = '--accept-downgrade';
interface LedgerStatuses {records?: Array<{datasetId: string; assessment?: {status?: string}}>}

/**
 * Reasons a rebuild would weaken the committed ledger. A checkout without the
 * retained audit cache (any computer but the original one) cannot read evidence
 * the committed ledger was built from; its rebuild loses passes and reports
 * inputs as unavailable. Builders refuse such a write unless QC_ACCEPT_DOWNGRADE
 * names a reviewed scientific change.
 */
export function qcLedgerDowngrades(previous: LedgerStatuses | null, next: LedgerStatuses,
  previousUnavailable: number, nextUnavailable: number): string[] {
  const reasons: string[] = [];
  if (nextUnavailable > previousUnavailable) {
    reasons.push(`${nextUnavailable - previousUnavailable} more retained inputs are unavailable on this computer (${previousUnavailable} -> ${nextUnavailable}).`);
  }
  const now = new Map((next.records ?? []).map(record => [record.datasetId, record.assessment?.status]));
  const lost = (previous?.records ?? []).filter(record => record.assessment?.status === 'pass' && now.get(record.datasetId) !== 'pass')
    .map(record => `${record.datasetId} (pass -> ${now.get(record.datasetId) ?? 'absent'})`);
  if (lost.length) reasons.push(`${lost.length} datasets would lose a pass: ${lost.slice(0, 10).join(', ')}${lost.length > 10 ? ', ...' : ''}.`);
  return reasons;
}

/** Only an already sealed retirement may stay absent during declaration refresh. */
export function retainedRetirementAvailability(path: string, expected: string, previouslyRetired: ReadonlySet<string>, available: boolean, actualSha256?: string) {
  need(/^[a-f0-9]{64}$/.test(expected), `invalid retirement identity: ${path}`);
  if (available) {
    need(actualSha256 === expected, `available retired dependency changed: ${path}`);
    return null;
  }
  need(previouslyRetired.has(path), `newly retired evidence is missing: ${path}`);
  return {path, sha256: expected, availability: 'previously_retired_unavailable_not_reverified' as const};
}

/** A previously added identity may stay absent only under the fixed QC baseline. */
export function retainedAdditionAvailability(path: string, expected: string, previouslyAdded: ReadonlySet<string>, baseline: Record<string, string>, available: boolean) {
  if (available) return null;
  need(previouslyAdded.has(path), `new successor evidence is missing: ${path}`);
  need(baseline[path] === expected && /^[a-f0-9]{64}$/.test(expected), `unavailable successor identity changed: ${path}`);
  return {path, sha256: expected, availability: 'previously_added_unavailable_not_verified' as const};
}
