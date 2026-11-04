// One guard pass: read month-to-date R2 operations, read the shutoff rule, and
// flip the rule only when the decision says so. Separate from index.ts so the
// whole pass can be unit-tested with a fake fetch (src/__tests__/spendGuard.test.ts).
import type { GuardEnv } from './env';
import { decide, monthWindow, parseLimit, parseMode, totalOperations, type GuardDecision, type OperationGroup, type OperationTotals } from './decide';

const API = 'https://api.cloudflare.com/client/v4';
const CUSTOM_PHASE = 'http_request_firewall_custom';
const DEFAULTS = {
  ACCOUNT_ID: '2991a2961440d6e0618f39bc2a0a423b',
  ZONE_ID: '2646afd72ee9db3111c4a475c4d43a58',
  R2_BUCKET: 'hypoexplorer-datasets',
  SHUTOFF_RULE_REF: 'hypoexplorer_data_shutoff',
};

// Grouped by bucket and action, so one query yields both the bucket's Class B
// count (the decision) and account totals (the free tier is account-wide).
// https://developers.cloudflare.com/r2/platform/metrics-analytics/
const OPERATIONS_QUERY = `query R2Operations($accountTag: string!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $end }) {
        sum { requests }
        dimensions { actionType bucketName }
      }
    }
  }
}`;

interface RulesetRule {
  id: string;
  ref?: string;
  enabled?: boolean;
  last_updated?: string;
  [key: string]: unknown;
}

export interface GuardResult {
  decision: GuardDecision;
  totals: OperationTotals | null;
  wrote: boolean;
}

type Log = (level: 'info' | 'warn' | 'error', fields: Record<string, unknown>) => void;
const defaultLog: Log = (level, fields) => console[level === 'info' ? 'log' : level]({ event: 'spend-guard', ...fields });

async function api<T>(fetchImpl: typeof fetch, token: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetchImpl(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await response.json().catch(() => null) as { success?: boolean; result?: T; errors?: Array<{ message?: string }> } | null;
  if (!response.ok || !parsed || parsed.success !== true) {
    throw new Error(`${method} ${path} -> HTTP ${response.status}${parsed?.errors?.length ? `: ${parsed.errors.map((e) => e.message).join('; ')}` : ''}`);
  }
  return parsed.result as T;
}

async function readOperations(fetchImpl: typeof fetch, token: string, account: string, now: Date): Promise<OperationGroup[]> {
  const { start, end } = monthWindow(now);
  const response = await fetchImpl(`${API}/graphql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: OPERATIONS_QUERY, variables: { accountTag: account, start, end } }),
  });
  const parsed = await response.json().catch(() => null) as {
    data?: { viewer?: { accounts?: Array<{ r2OperationsAdaptiveGroups?: OperationGroup[] }> } };
    errors?: Array<{ message?: string }> | null;
  } | null;
  if (!response.ok || !parsed) throw new Error(`GraphQL HTTP ${response.status}`);
  if (parsed.errors?.length) throw new Error(`GraphQL: ${parsed.errors.map((e) => e.message).join('; ')}`);
  const groups = parsed.data?.viewer?.accounts?.[0]?.r2OperationsAdaptiveGroups;
  if (!Array.isArray(groups)) throw new Error('GraphQL: no r2OperationsAdaptiveGroups for this account (token scope?)');
  // 10,000 groups is the query limit; bucket x action type is a few dozen at most.
  if (groups.length >= 10_000) throw new Error('GraphQL: result truncated');
  return groups;
}

export async function runGuard(env: GuardEnv, now: Date, fetchImpl: typeof fetch = fetch, log: Log = defaultLog): Promise<GuardResult> {
  const mode = parseMode(env.GUARD_MODE);
  const limit = parseLimit(env.CLASS_B_MONTHLY_LIMIT);
  const account = env.ACCOUNT_ID || DEFAULTS.ACCOUNT_ID;
  const zone = env.ZONE_ID || DEFAULTS.ZONE_ID;
  const bucket = env.R2_BUCKET || DEFAULTS.R2_BUCKET;
  const ref = env.SHUTOFF_RULE_REF || DEFAULTS.SHUTOFF_RULE_REF;
  const month = monthWindow(now).month;
  if (mode === 'off') {
    log('info', { mode, decision: 'off' });
    return { decision: { write: false, reason: 'off' }, totals: null, wrote: false };
  }
  const token = env.CF_GUARD_TOKEN;
  if (!token) {
    log('error', { mode, error: 'CF_GUARD_TOKEN secret is not set; nothing can be read or changed' });
    return { decision: { write: false, reason: 'analytics-unavailable' }, totals: null, wrote: false };
  }

  let totals: OperationTotals | null = null;
  try {
    totals = totalOperations(await readOperations(fetchImpl, token, account, now), bucket);
  } catch (error) {
    // Loud, and deliberately NOT a block: see decide().
    log('error', { mode, month, error: `analytics unavailable: ${error instanceof Error ? error.message : String(error)}`, failSafe: 'host stays as it is' });
  }

  let ruleset: { id: string; rules?: RulesetRule[] };
  try {
    ruleset = await api(fetchImpl, token, 'GET', `/zones/${zone}/rulesets/phases/${CUSTOM_PHASE}/entrypoint`);
  } catch (error) {
    log('error', { mode, month, error: `cannot read ${CUSTOM_PHASE}: ${error instanceof Error ? error.message : String(error)}` });
    return { decision: { write: false, reason: 'rule-missing' }, totals, wrote: false };
  }
  const rule = ruleset.rules?.find((candidate) => candidate.ref === ref) ?? null;
  const decision = decide({
    mode, limit, now,
    classB: totals ? totals.bucket.classB : null,
    rule: rule ? { enabled: rule.enabled === true, lastUpdated: rule.last_updated } : null,
  });
  const summary = {
    mode, month, bucket, limit,
    classB: totals?.bucket.classB ?? null, classA: totals?.bucket.classA ?? null,
    accountClassB: totals?.account.classB ?? null, accountClassA: totals?.account.classA ?? null,
    unknownActions: totals?.unknownActions.length ? totals.unknownActions : undefined,
    shutoffEnabled: rule ? rule.enabled === true : null,
    decision: decision.reason, desired: decision.desired,
  };
  if (!rule) {
    log('error', { ...summary, error: `rule "${ref}" not found in ${CUSTOM_PHASE}; run npm run edge:apply -- --apply` });
    return { decision, totals, wrote: false };
  }
  if (!decision.write) {
    log(decision.reason === 'observe' ? 'warn' : 'info', summary);
    return { decision, totals, wrote: false };
  }

  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rule)) if (key !== 'id' && key !== 'version' && key !== 'last_updated') body[key] = value;
  body.enabled = decision.desired;
  try {
    await api(fetchImpl, token, 'PATCH', `/zones/${zone}/rulesets/${ruleset.id}/rules/${rule.id}`, body);
  } catch (error) {
    log('error', { ...summary, error: `failed to set shutoff enabled=${decision.desired}: ${error instanceof Error ? error.message : String(error)}` });
    return { decision, totals, wrote: false };
  }
  log('warn', { ...summary, action: decision.desired ? 'data host CLOSED' : 'data host REOPENED' });
  return { decision, totals, wrote: true };
}
