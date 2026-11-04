// Pure decision logic for the spend guard. No Cloudflare imports: unit-tested
// under vitest (src/__tests__/spendGuard.test.ts).

export type GuardMode = 'enforce' | 'observe' | 'off';

export const DEFAULT_CLASS_B_MONTHLY_LIMIT = 8_000_000;

/**
 * R2 operation classes, from https://developers.cloudflare.com/r2/pricing/
 * (checked 2026-10-01). Class B reads are the only cost a public read-only
 * bucket can be made to run up; Class A is logged for context.
 */
const CLASS_A = new Set([
  'ListBuckets', 'PutBucket', 'ListObjects', 'PutObject', 'CopyObject', 'CompleteMultipartUpload',
  'CreateMultipartUpload', 'LifecycleStorageTierTransition', 'ListMultipartUploads', 'UploadPart',
  'UploadPartCopy', 'ListParts', 'PutBucketEncryption', 'PutBucketCors', 'PutBucketLifecycleConfiguration',
]);
const CLASS_B = new Set([
  'HeadBucket', 'HeadObject', 'GetObject', 'UsageSummary', 'GetBucketEncryption', 'GetBucketLocation',
  'GetBucketCors', 'GetBucketLifecycleConfiguration',
]);
const FREE = new Set(['DeleteObject', 'DeleteBucket', 'AbortMultipartUpload']);

export type OperationClass = 'A' | 'B' | 'free' | 'unknown';

export function classifyAction(actionType: string): OperationClass {
  if (CLASS_B.has(actionType)) return 'B';
  if (CLASS_A.has(actionType)) return 'A';
  if (FREE.has(actionType)) return 'free';
  return 'unknown';
}

/** Unknown or empty values fall back to enforce: a typo must not silently disable the guard. */
export function parseMode(raw: string | undefined): GuardMode {
  return raw === 'observe' || raw === 'off' ? raw : 'enforce';
}

/** A missing or unparseable limit is the default, never "no limit". */
export function parseLimit(raw: string | undefined): number {
  const value = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isSafeInteger(value) && value >= 1
    ? value : DEFAULT_CLASS_B_MONTHLY_LIMIT;
}

/** The UTC calendar month containing `now`: the window R2 bills and frees by. */
export function monthWindow(now: Date): { start: string; end: string; month: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start: start.toISOString(), end: now.toISOString(), month: start.toISOString().slice(0, 7) };
}

export interface OperationGroup {
  sum: { requests: number };
  dimensions: { actionType: string; bucketName: string };
}

export interface OperationTotals {
  bucket: { classA: number; classB: number; free: number; unknown: number };
  account: { classA: number; classB: number };
  unknownActions: string[];
}

export function totalOperations(groups: readonly OperationGroup[], bucket: string): OperationTotals {
  const totals: OperationTotals = {
    bucket: { classA: 0, classB: 0, free: 0, unknown: 0 }, account: { classA: 0, classB: 0 }, unknownActions: [],
  };
  const unknown = new Set<string>();
  for (const group of groups) {
    const requests = Number(group.sum?.requests);
    if (!Number.isFinite(requests) || requests < 0) throw new Error('Malformed analytics row.');
    const kind = classifyAction(group.dimensions.actionType);
    if (kind === 'A') totals.account.classA += requests;
    if (kind === 'B') totals.account.classB += requests;
    if (group.dimensions.bucketName !== bucket) continue;
    if (kind === 'A') totals.bucket.classA += requests;
    else if (kind === 'B') totals.bucket.classB += requests;
    else if (kind === 'free') totals.bucket.free += requests;
    else { totals.bucket.unknown += requests; unknown.add(group.dimensions.actionType); }
  }
  totals.unknownActions = [...unknown].sort();
  return totals;
}

export interface GuardInput {
  mode: GuardMode;
  limit: number;
  now: Date;
  /** Month-to-date Class B operations on the bucket; null when analytics could not be read. */
  classB: number | null;
  /** The shutoff rule as read from the zone; null when it does not exist. */
  rule: { enabled: boolean; lastUpdated?: string } | null;
}

export type GuardDecision =
  | { write: false; reason: 'off' | 'rule-missing' | 'unchanged' | 'analytics-unavailable' | 'observe'; desired?: boolean }
  | { write: true; desired: boolean; reason: 'over-limit' | 'under-limit' | 'new-month-without-analytics' };

/**
 * Whether to flip the shutoff rule, and to what.
 *
 * FAIL-SAFE: when analytics cannot be read the guard never CLOSES the data host.
 * An analytics outage (or an expired token) must not take the site down; the
 * cache rule and the edge rate limit keep protecting the bucket meanwhile, and
 * the guard catches up on the next successful read. The one write it still
 * makes is to REOPEN a host that was closed in an earlier UTC month, because
 * the monthly counter has reset whatever analytics says.
 */
export function decide(input: GuardInput): GuardDecision {
  if (input.mode === 'off') return { write: false, reason: 'off' };
  if (!input.rule) return { write: false, reason: 'rule-missing' };
  if (input.classB === null) {
    const closedEarlier = input.rule.enabled && input.rule.lastUpdated !== undefined
      && input.rule.lastUpdated.slice(0, 7) < monthWindow(input.now).month;
    if (!closedEarlier) return { write: false, reason: 'analytics-unavailable' };
    return input.mode === 'enforce'
      ? { write: true, desired: false, reason: 'new-month-without-analytics' }
      : { write: false, reason: 'observe', desired: false };
  }
  const desired = input.classB >= input.limit;
  if (desired === input.rule.enabled) return { write: false, reason: 'unchanged', desired };
  if (input.mode === 'observe') return { write: false, reason: 'observe', desired };
  return { write: true, desired, reason: desired ? 'over-limit' : 'under-limit' };
}
