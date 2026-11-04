// Reconcile the data host's zone edge rules (cloudflare/<phase>/<ref>.json) with
// the zone's Rulesets API entry points. DRY RUN BY DEFAULT: it reads the three
// entry points and prints what it would create or update. Nothing is written
// without --apply. docs/EDGE_PROTECTION.md is the operator runbook.
//
//   npm run edge:apply                       # read-only plan
//   npm run edge:apply -- --apply            # write the plan, then purge the data host if the cache rule changed
//   npm run edge:apply -- --purge-host       # only purge data.hypoexplorer.com from the edge cache
//   npm run edge:apply -- --write-payloads   # re-render cloudflare/*.json from scripts/lib/edgeRules.mts (local files only)
//   ... -- --env-file <file>                 # read CLOUDFLARE_EDGE_TOKEN / CLOUDFLARE_ZONE_ID from <file> (else env, else .env.local)
//
// Rules are matched by `ref` and upserted one at a time (POST a new rule, PATCH an
// existing one). Rules without one of our refs are never modified, reordered or
// deleted. The shutoff rule keeps whatever `enabled` state it has live: the spend
// guard Worker owns that bit. The token needs Zone > Cache Rules > Edit, Zone >
// Zone WAF > Edit and Zone > Cache Purge > Purge on the hypoexplorer.com zone.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CloudflareApiError, createCloudflareClient, resolveEdgeCredentials, type CloudflareClient } from './lib/cloudflareApi.mjs';
import {
  buildEdgeRules, CACHE_PHASE, CUSTOM_PHASE, DATA_HOST, describePlan, EDGE_PHASES, payloadPath, planPhase,
  RATELIMIT_PHASE, validateRule, type EdgePhase, type EdgeRule, type PhasePlan, type RemoteRuleset,
} from './lib/edgeRules.mjs';
import { manualPurgeInstructions, purgeEdgeCache } from './lib/edgePurge.mjs';

const argv = process.argv.slice(2);
const known = new Set(['--apply', '--purge-host', '--write-payloads', '--env-file']);
for (let index = 0; index < argv.length; index++) {
  if (!known.has(argv[index])) throw new Error(`Unknown argument: ${argv[index]}`);
  if (argv[index] === '--env-file') index++;
}
const apply = argv.includes('--apply');
const purgeHostOnly = argv.includes('--purge-host');
const envFileIndex = argv.indexOf('--env-file');
const envFile = envFileIndex >= 0 ? argv[envFileIndex + 1] : undefined;
if (envFileIndex >= 0 && (!envFile || envFile.startsWith('--'))) throw new Error('--env-file requires a filename.');

if (argv.includes('--write-payloads')) {
  for (const [phase, rules] of Object.entries(buildEdgeRules()) as Array<[EdgePhase, EdgeRule[]]>) {
    await mkdir(path.resolve('cloudflare', phase), { recursive: true });
    for (const rule of rules) await writeFile(path.resolve(payloadPath(phase, rule.ref)), `${JSON.stringify(rule, null, 2)}\n`);
  }
  console.log('Rendered cloudflare/<phase>/<ref>.json from scripts/lib/edgeRules.mts. No remote request was made.');
  process.exit(0);
}

async function loadPayloads(): Promise<Record<EdgePhase, EdgeRule[]>> {
  const result = {} as Record<EdgePhase, EdgeRule[]>;
  for (const phase of EDGE_PHASES) {
    const directory = path.resolve('cloudflare', phase);
    const files = existsSync(directory) ? (await readdir(directory)).filter((name) => name.endsWith('.json')).sort() : [];
    result[phase] = [];
    for (const file of files) {
      const rule = validateRule(phase, JSON.parse(await readFile(path.join(directory, file), 'utf8')));
      if (`${rule.ref}.json` !== file) throw new Error(`${phase}/${file}: file name must equal its ref (${rule.ref}).`);
      result[phase].push(rule);
    }
    if (!result[phase].length) throw new Error(`No rule payloads under cloudflare/${phase}/.`);
  }
  return result;
}

const { token, zoneId } = resolveEdgeCredentials({ envFile });
if (!token) {
  console.error([
    'CLOUDFLARE_EDGE_TOKEN is not set (environment, --env-file or .env.local).',
    'Create a custom API token for the hypoexplorer.com zone with: Zone > Cache Rules > Edit,',
    'Zone > Zone WAF > Edit, Zone > Cache Purge > Purge. See docs/EDGE_PROTECTION.md.',
  ].join('\n'));
  process.exit(2);
}
const client = createCloudflareClient(token);

async function purgeHost(): Promise<boolean> {
  try {
    await purgeEdgeCache(client, zoneId, { hosts: [DATA_HOST] });
    console.log(`Purged ${DATA_HOST} from the edge cache.`);
    return true;
  } catch (error) {
    console.error(`\nERROR: edge purge failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(manualPurgeInstructions(zoneId));
    return false;
  }
}

if (purgeHostOnly) process.exit((await purgeHost()) ? 0 : 1);

async function readEntryPoint(api: CloudflareClient, phase: EdgePhase): Promise<RemoteRuleset | null> {
  try {
    return await api.request<RemoteRuleset>('GET', `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`);
  } catch (error) {
    if (error instanceof CloudflareApiError && error.status === 404) return null;
    throw error;
  }
}

const payloads = await loadPayloads();
const plans: PhasePlan[] = [];
for (const phase of EDGE_PHASES) plans.push(planPhase(phase, await readEntryPoint(client, phase), payloads[phase]));
console.log(`Zone ${zoneId}, data host ${DATA_HOST}\n`);
for (const plan of plans) {
  for (const line of describePlan(plan)) console.log(line);
  for (const update of plan.updates) {
    for (const key of update.changes) console.log(`      ${key}: ${JSON.stringify(update.body[key])}`);
  }
}
const errors = plans.flatMap((plan) => plan.errors);
if (errors.length) {
  console.error(`\nRefusing to continue: ${errors.length} problem(s) above. Nothing was written.`);
  process.exit(1);
}
const pending = plans.reduce((sum, plan) => sum + plan.creates.length + plan.updates.length, 0);
if (!pending) {
  console.log('\nEvery rule already matches. Nothing to do.');
  process.exit(0);
}
if (!apply) {
  console.log(`\nDry run: ${pending} change(s) planned, nothing written. Re-run with --apply to write them.`);
  process.exit(0);
}

// Firewall and rate-limit rules first; the cache rule last, immediately followed
// by the purge its new cache key requires.
const order: EdgePhase[] = [CUSTOM_PHASE, RATELIMIT_PHASE, CACHE_PHASE];
for (const phase of order) {
  const plan = plans.find((candidate) => candidate.phase === phase)!;
  if (!plan.creates.length && !plan.updates.length) continue;
  if (!plan.rulesetId) {
    // No entry point exists, so there are no other rules to preserve.
    await client.request('PUT', `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`, { rules: plan.creates });
    console.log(`${phase}: created entry point with ${plan.creates.map((rule) => rule.ref).join(', ')}`);
    continue;
  }
  for (const rule of plan.creates) {
    await client.request('POST', `/zones/${zoneId}/rulesets/${plan.rulesetId}/rules`, rule);
    console.log(`${phase}: created ${rule.ref}`);
  }
  for (const update of plan.updates) {
    await client.request('PATCH', `/zones/${zoneId}/rulesets/${plan.rulesetId}/rules/${update.ruleId}`, update.body);
    console.log(`${phase}: updated ${update.ref}`);
  }
}

// Re-read and confirm, so a success message always reflects the live state.
let drift = 0;
for (const phase of EDGE_PHASES) {
  const recheck = planPhase(phase, await readEntryPoint(client, phase), payloads[phase]);
  drift += recheck.creates.length + recheck.updates.length + recheck.errors.length;
  if (recheck.creates.length || recheck.updates.length || recheck.errors.length) for (const line of describePlan(recheck)) console.error(line);
}
if (drift) {
  console.error('\nERROR: the live rules do not match the payloads after writing. Inspect the zone in the dashboard.');
  process.exitCode = 1;
}

// The cache key just changed (or the rule was just created): entries cached
// under the old key, including pre-gate entries keyed without a query string,
// must not survive it.
const cachePlan = plans.find((plan) => plan.phase === CACHE_PHASE)!;
if (cachePlan.creates.length || cachePlan.updates.length) {
  if (!(await purgeHost())) process.exitCode = 1;
}
if (!process.exitCode) console.log('\nApplied. Next: npm run verify:edge');
