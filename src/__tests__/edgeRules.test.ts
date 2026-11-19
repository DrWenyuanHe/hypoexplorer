import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildEdgeRules, burstExpression, CACHE_PHASE, coversDesired, CUSTOM_PHASE, describePlan, EDGE_PHASES, methodExpression,
  pathAllowed, pathExpression, payloadPath, planPhase, RATELIMIT_PHASE, REF_BURST, REF_METHODS, REF_PATHS,
  REF_SHUTOFF, validateRule, type EdgeRule, type RemoteRuleset,
} from '../../scripts/lib/edgeRules.mjs';
import { HYPOMAP_FIXED_FILES, HYPOMAP_PATH_PREFIX, HYPOMAP_TAG, hypomapFileAllowed } from '../../scripts/lib/hypomapAtlas.mjs';

const rules = buildEdgeRules();
const live = (rule: EdgeRule, extra: Record<string, unknown> = {}) => ({
  id: `id-${rule.ref}`, version: '3', last_updated: '2026-09-30T00:00:00Z', ...structuredClone(rule), ...extra,
});

describe('checked-in payloads', () => {
  it('are exactly the builder output, one file per ref', () => {
    for (const phase of EDGE_PHASES) {
      const directory = path.resolve('cloudflare', phase);
      const files = readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
      expect(files).toEqual(rules[phase].map((rule) => `${rule.ref}.json`).sort());
      for (const rule of rules[phase]) {
        const onDisk = JSON.parse(readFileSync(path.resolve(payloadPath(phase, rule.ref)), 'utf8'));
        expect(validateRule(phase, onDisk)).toEqual(rule);
      }
    }
  });

  it('creates the shutoff rule disabled and every other rule enabled', () => {
    const custom = rules[CUSTOM_PHASE];
    expect(custom.find((rule) => rule.ref === REF_SHUTOFF)?.enabled).toBe(false);
    expect([...custom, ...rules[CACHE_PHASE], ...rules[RATELIMIT_PHASE]].filter((rule) => rule.ref !== REF_SHUTOFF).every((rule) => rule.enabled)).toBe(true);
  });

  it('caches the data host with the query string excluded and origin TTLs respected', () => {
    const [cache] = rules[CACHE_PHASE];
    expect(cache.expression).toBe('(http.host eq "data.hypoexplorer.com")');
    expect(cache.action_parameters).toEqual({
      cache: true,
      cache_key: { custom_key: { query_string: { exclude: { all: true } } } },
      edge_ttl: { mode: 'respect_origin' },
      browser_ttl: { mode: 'respect_origin' },
    });
  });

  it('keeps the rate limit inside Free-plan bounds', () => {
    const [burst] = rules[RATELIMIT_PHASE];
    expect(burst.ref).toBe(REF_BURST);
    expect(burst.ratelimit).toEqual({ characteristics: ['cf.colo.id', 'ip.src'], period: 10, requests_per_period: 400, mitigation_timeout: 10 });
    // Free rate-limit expressions may only use the URI path.
    expect(burst.expression.replace(/"[^"]*"/g, '')).not.toMatch(/http\.(host|request\.method|request\.uri\.query)|ip\.src/);
  });

  it('uses no regex operator anywhere (unavailable on Free)', () => {
    for (const phase of EDGE_PHASES) for (const rule of rules[phase]) expect(rule.expression).not.toMatch(/\bmatches\b|\s~\s/);
  });

  it('stays within the 4,096-character expression limit', () => {
    for (const phase of EDGE_PHASES) for (const rule of rules[phase]) expect(rule.expression.length).toBeLessThanOrEqual(4096);
  });
});

describe('expressions', () => {
  it('scope the method and path rules to the data host', () => {
    expect(methodExpression()).toBe('(http.host eq "data.hypoexplorer.com" and not http.request.method in {"GET" "HEAD"})');
    expect(pathExpression()).toMatch(/^\(http\.host eq "data\.hypoexplorer\.com" and \(/);
    expect(burstExpression()).toContain('starts_with(http.request.uri.path, "/qc/")');
    expect(burstExpression()).toContain(`starts_with(http.request.uri.path, "${HYPOMAP_PATH_PREFIX}")`);
  });

  it('let through only the pinned HypoMap atlas files', () => {
    for (const file of [...HYPOMAP_FIXED_FILES, 'genes-0000.json.gz', 'genes-0123.json.gz', 'genes-9999.json.gz']) {
      expect(hypomapFileAllowed(file), file).toBe(true);
      expect(pathAllowed(`${HYPOMAP_PATH_PREFIX}${file}`), file).toBe(true);
    }
    for (const bad of [
      '/hypomap/', HYPOMAP_PATH_PREFIX, `${HYPOMAP_PATH_PREFIX}manifest.js`, `${HYPOMAP_PATH_PREFIX}metadata.json`,
      `${HYPOMAP_PATH_PREFIX}genes-000.json.gz`, `${HYPOMAP_PATH_PREFIX}genes-00000.json.gz`, `${HYPOMAP_PATH_PREFIX}genes-0000.json`,
      `${HYPOMAP_PATH_PREFIX}other-0000.json.gz`, `${HYPOMAP_PATH_PREFIX}x/manifest.json`, `${HYPOMAP_PATH_PREFIX}genes-0//.json.gz`,
      '/hypomap/hypomap-atlas-2000-01-01/manifest.json', `/hypomap/${HYPOMAP_TAG}.old/manifest.json`, '/hypomap/manifest.json',
      `/datasets/${HYPOMAP_TAG}/genes-0000.json.gz`, `${HYPOMAP_PATH_PREFIX}genes-..00.json.gz`,
    ]) expect(pathAllowed(bad), bad).toBe(false);
    // The edge rule cannot test for digits (no regex on Free); R2 answers such a key
    // with a 404, and the uploader's stricter check never stages one.
    expect(pathAllowed(`${HYPOMAP_PATH_PREFIX}genes-abcd.json.gz`)).toBe(true);
    expect(hypomapFileAllowed('genes-abcd.json.gz')).toBe(false);
  });

  it('render the atlas branch with exact fixed paths and the shard path length', () => {
    const expression = pathExpression();
    for (const file of HYPOMAP_FIXED_FILES) expect(expression).toContain(`"${HYPOMAP_PATH_PREFIX}${file}"`);
    expect(expression).toContain(`starts_with(http.request.uri.path, "${HYPOMAP_PATH_PREFIX}genes-")`);
    expect(expression).toContain(`len(http.request.uri.path) eq ${`${HYPOMAP_PATH_PREFIX}genes-0000.json.gz`.length}`);
  });

  it('let every legitimate request shape through', () => {
    for (const ok of [
      '/datasets/cattle_arc_nutrition_gse153498/meta.js',
      '/datasets/cattle_arc_nutrition_gse153498/track_arcuate.pathways.js',
      '/query/tracks.js',
      '/query/expression-manifest.js',
      '/query/1es70pa3wryw0/genes/a1.js',
      '/query/expression/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/s0001.js',
      '/qc/Ast1__Astrocyte_1.pdf',
    ]) expect(pathAllowed(ok), ok).toBe(true);
  });

  it('block everything the retired gate refused by shape', () => {
    for (const bad of [
      '/', '/robots.txt', '/favicon.ico', '/_gate/status', '/datasets/', '/datasets/x/meta.json',
      '/other/x.js', '/datasets/../x.js', '/datasets//x.js', `/datasets/${'a'.repeat(250)}.js`,
      '/hypomap/x.js', '/datasets/x/manifest.json', '/query/x.json.gz',
    ])expect(pathAllowed(bad), bad).toBe(false);
  });
});

describe('planPhase', () => {
  const custom = rules[CUSTOM_PHASE];
  const foreign = { id: 'f1', ref: 'someone_else', description: 'Block a country', expression: 'ip.src.country eq "XX"', action: 'block', enabled: true };

  it('creates everything when the zone has no entry point', () => {
    const plan = planPhase(CUSTOM_PHASE, null, custom);
    expect(plan.rulesetId).toBeNull();
    expect(plan.creates.map((rule) => rule.ref)).toEqual([REF_METHODS, REF_PATHS, REF_SHUTOFF]);
    expect(plan.errors).toEqual([]);
  });

  it('appends missing rules and never touches foreign ones', () => {
    const existing: RemoteRuleset = { id: 'rs', rules: [foreign, live(custom[0])] };
    const plan = planPhase(CUSTOM_PHASE, existing, custom);
    expect(plan.creates.map((rule) => rule.ref)).toEqual([REF_PATHS, REF_SHUTOFF]);
    expect(plan.unchanged).toEqual([REF_METHODS]);
    expect(plan.updates).toEqual([]);
    expect(plan.foreign).toEqual([{ id: 'f1', ref: 'someone_else', description: 'Block a country' }]);
  });

  it('patches a drifted rule with the full live body minus read-only fields', () => {
    const drifted = live(custom[1], { expression: '(http.host eq "data.hypoexplorer.com")', logging: { enabled: true } });
    const plan = planPhase(CUSTOM_PHASE, { id: 'rs', rules: [drifted] }, [custom[1]]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].changes).toEqual(['expression']);
    expect(plan.updates[0].ruleId).toBe(`id-${REF_PATHS}`);
    expect(plan.updates[0].body).toEqual({ ...custom[1], logging: { enabled: true } });
  });

  it('never flips the live shutoff state', () => {
    const shutoff = custom.find((rule) => rule.ref === REF_SHUTOFF)!;
    const closed = live(shutoff, { enabled: true });
    expect(planPhase(CUSTOM_PHASE, { id: 'rs', rules: [closed] }, [shutoff]).unchanged).toEqual([REF_SHUTOFF]);
    const plan = planPhase(CUSTOM_PHASE, { id: 'rs', rules: [live(shutoff, { enabled: true, description: 'old' })] }, [shutoff]);
    expect(plan.updates[0].changes).toEqual(['description']);
    expect(plan.updates[0].body.enabled).toBe(true);
  });

  it('ignores fields the API adds that the payload does not state', () => {
    const [burst] = rules[RATELIMIT_PHASE];
    const remote = live(burst, { ratelimit: { ...burst.ratelimit, requests_to_origin: false }, logging: { enabled: true } });
    expect(planPhase(RATELIMIT_PHASE, { id: 'rl', rules: [remote] }, [burst]).unchanged).toEqual([REF_BURST]);
    // A stated value that differs, even nested, is drift; arrays compare exactly.
    const tighter = live(burst, { ratelimit: { ...burst.ratelimit, requests_per_period: 100 } });
    expect(planPhase(RATELIMIT_PHASE, { id: 'rl', rules: [tighter] }, [burst]).updates[0].changes).toEqual(['ratelimit']);
    const ipOnly = live(burst, { ratelimit: { ...burst.ratelimit, characteristics: ['ip.src'] } });
    expect(planPhase(RATELIMIT_PHASE, { id: 'rl', rules: [ipOnly] }, [burst]).updates[0].changes).toEqual(['ratelimit']);
  });

  it('coversDesired compares only what the payload states', () => {
    expect(coversDesired({ a: { b: 1 } }, { a: { b: 1, c: 2 }, d: 3 })).toBe(true);
    expect(coversDesired({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    expect(coversDesired({ a: [1, 2] }, { a: [1, 2, 3] })).toBe(false);
    expect(coversDesired(true, undefined)).toBe(false);
  });

  it('refuses to take the Free rate-limit slot from a foreign rule', () => {
    const plan = planPhase(RATELIMIT_PHASE, { id: 'rl', rules: [{ ...foreign, ref: 'old_limit' }] }, rules[RATELIMIT_PHASE]);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toMatch(/slot is taken.*old_limit/);
  });

  it('updates our own rate-limit rule in place (same ref as the retired gate payload)', () => {
    const [burst] = rules[RATELIMIT_PHASE];
    const old = live(burst, { expression: `${burst.expression} or starts_with(http.request.uri.path, "/_gate/")` });
    const plan = planPhase(RATELIMIT_PHASE, { id: 'rl', rules: [old] }, [burst]);
    expect(plan.errors).toEqual([]);
    expect(plan.updates[0].changes).toEqual(['expression']);
  });

  it('refuses to exceed the Free custom-rule limit', () => {
    const others = Array.from({ length: 3 }, (_, index) => ({ ...foreign, id: `f${index}`, ref: `other_${index}` }));
    const plan = planPhase(CUSTOM_PHASE, { id: 'rs', rules: others }, custom);
    expect(plan.errors[0]).toMatch(/3 existing \+ 3 new rules exceed the Free plan limit of 5/);
  });

  it('refuses duplicated refs', () => {
    const plan = planPhase(CUSTOM_PHASE, { id: 'rs', rules: [live(custom[0]), { ...live(custom[0]), id: 'dup' }] }, custom);
    expect(plan.errors.some((error) => error.includes('more than once'))).toBe(true);
  });

  it('describes the plan for the dry run', () => {
    const lines = describePlan(planPhase(CUSTOM_PHASE, { id: 'rs', rules: [foreign] }, custom));
    expect(lines[0]).toBe('http_request_firewall_custom (ruleset rs)');
    expect(lines).toContain(`  + create ${REF_SHUTOFF} (disabled)`);
    expect(lines).toContain('  · keep foreign rule someone_else (Block a country)');
  });
});

describe('validateRule', () => {
  it('rejects payloads that would land in the wrong phase', () => {
    expect(() => validateRule(CACHE_PHASE, rules[CUSTOM_PHASE][0])).toThrow(/set_cache_settings/);
    expect(() => validateRule(CUSTOM_PHASE, rules[RATELIMIT_PHASE][0])).toThrow(/cannot carry ratelimit/);
    expect(() => validateRule(RATELIMIT_PHASE, rules[CUSTOM_PHASE][0])).toThrow(/needs ratelimit/);
    expect(() => validateRule(CUSTOM_PHASE, { ...rules[CUSTOM_PHASE][0], enabled: undefined })).toThrow(/enabled/);
  });
});
