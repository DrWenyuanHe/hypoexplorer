// Zone edge rules for the data host, and the pure logic that reconciles them with
// a zone's existing Rulesets API entry points. No network access here: the
// caller (scripts/apply_edge_rules.mts) fetches and writes, this module decides.
// Unit-tested in src/__tests__/edgeRules.test.ts.
//
// The checked-in payloads under cloudflare/<phase>/<ref>.json are renderings of
// buildEdgeRules(); the unit test fails if the two drift apart. Edit the builder,
// then regenerate the JSON with `npm run edge:apply -- --write-payloads`.
//
// Free-plan facts these rules are written against (verified 2026-10-01):
//   cache rules, 10 per zone; "Ignore query string" cache key on all plans
//     https://developers.cloudflare.com/cache/how-to/cache-rules/
//     https://developers.cloudflare.com/cache/how-to/cache-keys/#availability
//   custom rules, 5 per zone, no regex (`matches` needs Business)
//     https://developers.cloudflare.com/waf/custom-rules/#availability
//     https://developers.cloudflare.com/ruleset-engine/rules-language/operators/
//   rate limiting, 1 rule, expression fields Path + Verified Bot only, counting
//     by IP (cf.colo.id is mandatory and implicit), period 10 s, timeout 10 s,
//     no cache exclusion (cached requests are counted too)
//     https://developers.cloudflare.com/waf/rate-limiting-rules/#availability
//     https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/

export const DATA_HOST = 'data.hypoexplorer.com';
export const ZONE_ID = '2646afd72ee9db3111c4a475c4d43a58';

export const CACHE_PHASE = 'http_request_cache_settings';
export const CUSTOM_PHASE = 'http_request_firewall_custom';
export const RATELIMIT_PHASE = 'http_ratelimit';
export type EdgePhase = typeof CACHE_PHASE | typeof CUSTOM_PHASE | typeof RATELIMIT_PHASE;
export const EDGE_PHASES: readonly EdgePhase[] = [CACHE_PHASE, CUSTOM_PHASE, RATELIMIT_PHASE];

/** Free-plan rule ceilings per phase entry point. */
export const FREE_PLAN_RULE_LIMITS: Record<EdgePhase, number> = {
  [CACHE_PHASE]: 10,
  [CUSTOM_PHASE]: 5,
  [RATELIMIT_PHASE]: 1,
};

export const REF_CACHE = 'hypoexplorer_data_cache';
// The two refs below match the payloads the retired data gate shipped
// (edge-method-rule.json / edge-rate-rule.json), so a copy published from those
// files is updated in place instead of being duplicated.
export const REF_METHODS = 'hypoexplorer_data_methods';
export const REF_BURST = 'hypoexplorer_data_burst';
export const REF_PATHS = 'hypoexplorer_data_paths';
/** The spend guard Worker toggles this rule's `enabled`; nothing else may. */
export const REF_SHUTOFF = 'hypoexplorer_data_shutoff';
/** Rules whose `enabled` state is owned at runtime, never by a payload. */
export const RUNTIME_OWNED_ENABLED = new Set([REF_SHUTOFF]);

/**
 * What the bucket can contain. Mirrors the retired gate's checkPath()
 * (workers/data-gate/src/rules.ts, measured over all 5,522 keys on 2026-09-04):
 * three top-level prefixes, two extensions, keys at most 256 characters, no
 * `..` or `//`. The gate's character-class check needed a regex, which Free
 * custom rules do not offer; R2 answers such keys with a 404 (one Class B read),
 * which the rate limit and the spend guard bound.
 */
export const ALLOWED_PREFIXES = ['/datasets/', '/query/', '/qc/'] as const;
export const ALLOWED_EXTENSIONS = ['.js', '.pdf'] as const;
export const MAX_PATH_LENGTH = 256;
export const ALLOWED_METHODS = ['GET', 'HEAD'] as const;

export const BURST_REQUESTS_PER_PERIOD = 400;
export const BURST_PERIOD_SECONDS = 10;
export const BURST_MITIGATION_SECONDS = 10;

export interface EdgeRule {
  ref: string;
  description: string;
  expression: string;
  action: string;
  enabled: boolean;
  action_parameters?: Record<string, unknown>;
  ratelimit?: Record<string, unknown>;
}

/** A rule as the Rulesets API returns it. */
export interface RemoteRule {
  id: string;
  ref?: string;
  description?: string;
  expression?: string;
  action?: string;
  enabled?: boolean;
  version?: string;
  last_updated?: string;
  [key: string]: unknown;
}

export interface RemoteRuleset {
  id: string;
  phase?: string;
  rules?: RemoteRule[];
}

const PATH = 'http.request.uri.path';
const q = (value: string) => JSON.stringify(value);
const any = (terms: string[]) => (terms.length === 1 ? terms[0] : `(${terms.join(' or ')})`);
const hostIs = (host: string) => `http.host eq ${q(host)}`;
const prefixTerms = () => ALLOWED_PREFIXES.map((prefix) => `starts_with(${PATH}, ${q(prefix)})`);

export function methodExpression(host = DATA_HOST): string {
  return `(${hostIs(host)} and not http.request.method in {${ALLOWED_METHODS.map(q).join(' ')}})`;
}

export function pathExpression(host = DATA_HOST): string {
  const outside = [
    `not ${any(prefixTerms())}`,
    `not ${any(ALLOWED_EXTENSIONS.map((ext) => `ends_with(${PATH}, ${q(ext)})`))}`,
    `${PATH} contains ${q('..')}`,
    `${PATH} contains ${q('//')}`,
    `len(${PATH}) gt ${MAX_PATH_LENGTH}`,
  ];
  return `(${hostIs(host)} and (${outside.join(' or ')}))`;
}

/** Free rate-limit expressions may use only the URI path, so the host cannot be named. */
export function burstExpression(): string {
  return any(prefixTerms());
}

/** The JavaScript twin of pathExpression(): true when the request is let through. */
export function pathAllowed(path: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))
    && ALLOWED_EXTENSIONS.some((ext) => path.endsWith(ext))
    && !path.includes('..') && !path.includes('//')
    && new TextEncoder().encode(path).length <= MAX_PATH_LENGTH;
}

export function buildEdgeRules(host = DATA_HOST): Record<EdgePhase, EdgeRule[]> {
  return {
    [CACHE_PHASE]: [{
      ref: REF_CACHE,
      description: 'Data host: cache everything, cache key ignores the query string, respect origin TTLs',
      expression: `(${hostIs(host)})`,
      action: 'set_cache_settings',
      action_parameters: {
        cache: true,
        cache_key: { custom_key: { query_string: { exclude: { all: true } } } },
        edge_ttl: { mode: 'respect_origin' },
        browser_ttl: { mode: 'respect_origin' },
      },
      enabled: true,
    }],
    [CUSTOM_PHASE]: [
      {
        ref: REF_METHODS,
        description: 'Data host: block methods other than GET and HEAD',
        expression: methodExpression(host),
        action: 'block',
        enabled: true,
      },
      {
        ref: REF_PATHS,
        description: 'Data host: block paths outside /datasets/, /query/, /qc/ with .js or .pdf',
        expression: pathExpression(host),
        action: 'block',
        enabled: true,
      },
      {
        ref: REF_SHUTOFF,
        description: 'Data host shutoff: blocks every request. Toggled by the spend guard Worker; created disabled',
        expression: `(${hostIs(host)})`,
        action: 'block',
        enabled: false,
      },
    ],
    [RATELIMIT_PHASE]: [{
      ref: REF_BURST,
      description: 'Data paths: 400 requests per 10 s per IP, block 10 s',
      expression: burstExpression(),
      action: 'block',
      ratelimit: {
        characteristics: ['cf.colo.id', 'ip.src'],
        period: BURST_PERIOD_SECONDS,
        requests_per_period: BURST_REQUESTS_PER_PERIOD,
        mitigation_timeout: BURST_MITIGATION_SECONDS,
      },
      enabled: true,
    }],
  };
}

/** Repository-relative payload path for a rule. */
export const payloadPath = (phase: EdgePhase, ref: string) => `cloudflare/${phase}/${ref}.json`;

const READ_ONLY_FIELDS = new Set(['id', 'version', 'last_updated']);

/**
 * Whether the live value states everything the desired value states. Objects
 * compare only the keys we set, recursively, because the API echoes defaults we
 * never wrote (for example `ratelimit.requests_to_origin: false`); arrays and
 * scalars compare exactly.
 */
export function coversDesired(desired: unknown, live: unknown): boolean {
  if (Array.isArray(desired)) {
    return Array.isArray(live) && live.length === desired.length && desired.every((value, index) => coversDesired(value, live[index]));
  }
  if (desired && typeof desired === 'object') {
    if (!live || typeof live !== 'object' || Array.isArray(live)) return false;
    return Object.entries(desired).every(([key, value]) => coversDesired(value, (live as Record<string, unknown>)[key]));
  }
  return desired === live;
}

export interface RuleUpdate {
  ref: string;
  ruleId: string;
  /** Desired fields that differ from the live rule. */
  changes: string[];
  /** The full rule body to PATCH: the live rule minus read-only fields, overlaid with ours. */
  body: Record<string, unknown>;
}

export interface PhasePlan {
  phase: EdgePhase;
  /** null when the zone has no entry point for the phase yet. */
  rulesetId: string | null;
  creates: EdgeRule[];
  updates: RuleUpdate[];
  unchanged: string[];
  /** Live rules this tool does not own; listed, never touched. */
  foreign: Array<{ id: string; ref?: string; description?: string }>;
  errors: string[];
}

/**
 * Upsert by `ref`: create missing rules, patch differing ones, leave every other
 * rule alone. A runtime-owned rule keeps its live `enabled` state. The plan fails
 * (errors non-empty) rather than exceed a Free-plan rule ceiling or take the
 * single rate-limit slot from a rule this tool does not own.
 */
export function planPhase(
  phase: EdgePhase,
  existing: RemoteRuleset | null,
  desired: readonly EdgeRule[],
  limit = FREE_PLAN_RULE_LIMITS[phase],
): PhasePlan {
  const plan: PhasePlan = {
    phase, rulesetId: existing?.id ?? null, creates: [], updates: [], unchanged: [], foreign: [], errors: [],
  };
  const live = existing?.rules ?? [];
  const byRef = new Map<string, RemoteRule>();
  for (const rule of live) {
    if (!rule.ref) continue;
    if (byRef.has(rule.ref)) plan.errors.push(`${phase}: ref "${rule.ref}" appears more than once; reconcile it in the dashboard first.`);
    byRef.set(rule.ref, rule);
  }
  const ours = new Set(desired.map((rule) => rule.ref));
  for (const rule of live) {
    if (!rule.ref || !ours.has(rule.ref)) plan.foreign.push({ id: rule.id, ref: rule.ref, description: rule.description });
  }
  for (const rule of desired) {
    const current = byRef.get(rule.ref);
    if (!current) { plan.creates.push(rule); continue; }
    const target: Record<string, unknown> = { ...rule };
    if (RUNTIME_OWNED_ENABLED.has(rule.ref) && typeof current.enabled === 'boolean') target.enabled = current.enabled;
    const changes = Object.keys(target).filter((key) => !coversDesired(target[key], current[key]));
    if (!changes.length) { plan.unchanged.push(rule.ref); continue; }
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(current)) if (!READ_ONLY_FIELDS.has(key)) body[key] = value;
    Object.assign(body, target);
    plan.updates.push({ ref: rule.ref, ruleId: current.id, changes, body });
  }
  if (phase === RATELIMIT_PHASE && plan.creates.length && plan.foreign.length) {
    const taken = plan.foreign.map((rule) => rule.ref ?? rule.description ?? rule.id).join(', ');
    plan.errors.push(`${phase}: the Free plan's rate-limiting slot is taken by a rule this tool does not own (${taken}). Stop: decide in the dashboard whether to delete it or keep it; this tool never replaces it.`);
  } else if (live.length + plan.creates.length > limit) {
    plan.errors.push(`${phase}: ${live.length} existing + ${plan.creates.length} new rules exceed the Free plan limit of ${limit}.`);
  }
  return plan;
}

/** Human-readable lines for the dry-run report. */
export function describePlan(plan: PhasePlan): string[] {
  const lines = [`${plan.phase} (${plan.rulesetId ? `ruleset ${plan.rulesetId}` : 'no entry point yet; it will be created'})`];
  for (const rule of plan.creates) lines.push(`  + create ${rule.ref}${rule.enabled ? '' : ' (disabled)'}`);
  for (const update of plan.updates) lines.push(`  ~ update ${update.ref}: ${update.changes.join(', ')}`);
  for (const ref of plan.unchanged) lines.push(`  = unchanged ${ref}`);
  for (const rule of plan.foreign) lines.push(`  · keep foreign rule ${rule.ref ?? rule.id}${rule.description ? ` (${rule.description})` : ''}`);
  for (const error of plan.errors) lines.push(`  ! ${error}`);
  return lines;
}

/** Validate a payload read from disk before it is sent anywhere. */
export function validateRule(phase: EdgePhase, value: unknown): EdgeRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${phase}: rule payload is not an object.`);
  const rule = value as Record<string, unknown>;
  for (const field of ['ref', 'description', 'expression', 'action'] as const) {
    if (typeof rule[field] !== 'string' || !(rule[field] as string).trim()) throw new Error(`${phase}: rule is missing "${field}".`);
  }
  if (typeof rule.enabled !== 'boolean') throw new Error(`${phase}: rule ${rule.ref} must state "enabled".`);
  if (phase === CACHE_PHASE && rule.action !== 'set_cache_settings') throw new Error(`${phase}: ${rule.ref} must use set_cache_settings.`);
  if (phase !== CACHE_PHASE && rule.action !== 'block') throw new Error(`${phase}: ${rule.ref} must use block.`);
  if (phase === RATELIMIT_PHASE && (!rule.ratelimit || typeof rule.ratelimit !== 'object')) throw new Error(`${phase}: ${rule.ref} needs ratelimit.`);
  if (phase !== RATELIMIT_PHASE && rule.ratelimit !== undefined) throw new Error(`${phase}: ${rule.ref} cannot carry ratelimit.`);
  return rule as unknown as EdgeRule;
}
