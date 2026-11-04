import { describe, expect, it, vi } from 'vitest';
import {
  classifyAction, decide, DEFAULT_CLASS_B_MONTHLY_LIMIT, monthWindow, parseLimit, parseMode, totalOperations, type GuardInput,
} from '../../workers/spend-guard/src/decide';
import { runGuard } from '../../workers/spend-guard/src/guard';

const now = new Date('2026-10-15T12:34:56Z');
const input = (overrides: Partial<GuardInput>): GuardInput => ({
  mode: 'enforce', limit: 8_000_000, now, classB: 1_000, rule: { enabled: false, lastUpdated: '2026-10-01T00:00:00Z' }, ...overrides,
});

describe('configuration parsing', () => {
  it('treats anything but observe/off as enforce', () => {
    expect(parseMode('observe')).toBe('observe');
    expect(parseMode('off')).toBe('off');
    expect(parseMode(undefined)).toBe('enforce');
    expect(parseMode('Observe')).toBe('enforce');
  });

  it('never turns a bad limit into "no limit"', () => {
    expect(parseLimit('8000000')).toBe(8_000_000);
    expect(parseLimit('123')).toBe(123);
    for (const bad of [undefined, '', ' ', '0', '-5', '1.5', 'NaN', 'lots']) expect(parseLimit(bad)).toBe(DEFAULT_CLASS_B_MONTHLY_LIMIT);
  });
});

describe('monthWindow', () => {
  it('starts at 00:00 UTC on the first of the current UTC month', () => {
    expect(monthWindow(now)).toEqual({ start: '2026-10-01T00:00:00.000Z', end: '2026-10-15T12:34:56.000Z', month: '2026-10' });
  });

  it('rolls over exactly at the UTC month boundary', () => {
    expect(monthWindow(new Date('2026-10-31T23:59:59.999Z')).month).toBe('2026-10');
    expect(monthWindow(new Date('2026-11-01T00:00:00.000Z')).start).toBe('2026-11-01T00:00:00.000Z');
    expect(monthWindow(new Date('2026-12-31T23:50:00Z')).month).toBe('2026-12');
    expect(monthWindow(new Date('2027-01-01T00:00:00Z')).start).toBe('2027-01-01T00:00:00.000Z');
  });

  it('uses UTC, not local time, on the evening of the last day', () => {
    // 2026-02-28 20:00 in UTC-5 is already March in UTC.
    expect(monthWindow(new Date('2026-02-28T20:00:00-05:00')).month).toBe('2026-03');
  });
});

describe('operation classes', () => {
  it('follows the R2 pricing page', () => {
    expect(['GetObject', 'HeadObject', 'HeadBucket', 'UsageSummary'].map(classifyAction)).toEqual(['B', 'B', 'B', 'B']);
    expect(['PutObject', 'ListObjects', 'CopyObject', 'ListBuckets'].map(classifyAction)).toEqual(['A', 'A', 'A', 'A']);
    expect(classifyAction('DeleteObject')).toBe('free');
    expect(classifyAction('SomethingNew')).toBe('unknown');
  });

  it('totals the bucket for the decision and the account for context', () => {
    const totals = totalOperations([
      { sum: { requests: 700 }, dimensions: { actionType: 'GetObject', bucketName: 'hypoexplorer-datasets' } },
      { sum: { requests: 300 }, dimensions: { actionType: 'HeadObject', bucketName: 'hypoexplorer-datasets' } },
      { sum: { requests: 50 }, dimensions: { actionType: 'PutObject', bucketName: 'hypoexplorer-datasets' } },
      { sum: { requests: 9 }, dimensions: { actionType: 'Mystery', bucketName: 'hypoexplorer-datasets' } },
      { sum: { requests: 5_000 }, dimensions: { actionType: 'GetObject', bucketName: 'other' } },
    ], 'hypoexplorer-datasets');
    expect(totals.bucket).toEqual({ classA: 50, classB: 1_000, free: 0, unknown: 9 });
    expect(totals.account).toEqual({ classA: 50, classB: 6_000 });
    expect(totals.unknownActions).toEqual(['Mystery']);
  });
});

describe('decide', () => {
  it('closes the host at the threshold, not below it', () => {
    expect(decide(input({ classB: 7_999_999 }))).toEqual({ write: false, reason: 'unchanged', desired: false });
    expect(decide(input({ classB: 8_000_000 }))).toEqual({ write: true, desired: true, reason: 'over-limit' });
  });

  it('reopens when the count is under the threshold again (a new month)', () => {
    expect(decide(input({ classB: 12, rule: { enabled: true, lastUpdated: '2026-09-20T00:00:00Z' } })))
      .toEqual({ write: true, desired: false, reason: 'under-limit' });
  });

  it('writes nothing when the rule is already in the desired state', () => {
    expect(decide(input({ classB: 9_000_000, rule: { enabled: true } }))).toEqual({ write: false, reason: 'unchanged', desired: true });
  });

  it('observe mode reports the would-be change without writing', () => {
    expect(decide(input({ mode: 'observe', classB: 9_000_000 }))).toEqual({ write: false, reason: 'observe', desired: true });
  });

  it('off mode does nothing at all', () => {
    expect(decide(input({ mode: 'off', classB: 9_000_000 }))).toEqual({ write: false, reason: 'off' });
  });

  it('fails safe when analytics are unavailable: never closes', () => {
    expect(decide(input({ classB: null }))).toEqual({ write: false, reason: 'analytics-unavailable' });
    expect(decide(input({ classB: null, rule: { enabled: true, lastUpdated: '2026-10-02T00:00:00Z' } })))
      .toEqual({ write: false, reason: 'analytics-unavailable' });
  });

  it('without analytics, still reopens a host closed in an earlier month', () => {
    expect(decide(input({ classB: null, rule: { enabled: true, lastUpdated: '2026-09-28T10:00:00Z' } })))
      .toEqual({ write: true, desired: false, reason: 'new-month-without-analytics' });
    expect(decide(input({ classB: null, rule: { enabled: true } }))).toEqual({ write: false, reason: 'analytics-unavailable' });
  });

  it('does nothing when the shutoff rule does not exist', () => {
    expect(decide(input({ rule: null, classB: 9_000_000 }))).toEqual({ write: false, reason: 'rule-missing' });
  });
});

describe('runGuard', () => {
  const env = { GUARD_MODE: 'enforce', CLASS_B_MONTHLY_LIMIT: '1000', CF_GUARD_TOKEN: 'secret' };
  const shutoff = (enabled: boolean) => ({
    id: 'rule-1', ref: 'hypoexplorer_data_shutoff', version: '2', last_updated: '2026-10-01T00:00:00Z',
    description: 'shutoff', expression: '(http.host eq "data.hypoexplorer.com")', action: 'block', enabled,
  });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fakeFetch = (classB: number | 'error', enabled: boolean) => vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/graphql')) {
      if (classB === 'error') return json({ data: null, errors: [{ message: 'not authorized' }] });
      return json({ data: { viewer: { accounts: [{ r2OperationsAdaptiveGroups: [
        { sum: { requests: classB }, dimensions: { actionType: 'GetObject', bucketName: 'hypoexplorer-datasets' } },
      ] }] } }, errors: null });
    }
    if (url.endsWith('/rulesets/phases/http_request_firewall_custom/entrypoint')) {
      return json({ success: true, result: { id: 'rs-1', rules: [{ id: 'other', ref: 'x', enabled: true }, shutoff(enabled)] } });
    }
    if (init?.method === 'PATCH') return json({ success: true, result: {} });
    return json({ success: false, errors: [{ message: 'unexpected' }] }, 404);
  });
  const quiet = () => {};

  it('patches only the shutoff rule, with the full body and the new state', async () => {
    const fetchImpl = fakeFetch(5_000, false);
    const result = await runGuard(env, now, fetchImpl as unknown as typeof fetch, quiet);
    expect(result).toMatchObject({ wrote: true, decision: { desired: true, reason: 'over-limit' } });
    const patch = fetchImpl.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(patch[0]).toBe('https://api.cloudflare.com/client/v4/zones/2646afd72ee9db3111c4a475c4d43a58/rulesets/rs-1/rules/rule-1');
    expect(JSON.parse(String(patch[1]!.body))).toEqual({
      ref: 'hypoexplorer_data_shutoff', description: 'shutoff', expression: '(http.host eq "data.hypoexplorer.com")', action: 'block', enabled: true,
    });
  });

  it('queries the current UTC month', async () => {
    const fetchImpl = fakeFetch(5, false);
    await runGuard(env, now, fetchImpl as unknown as typeof fetch, quiet);
    const graphql = fetchImpl.mock.calls.find(([url]) => url.endsWith('/graphql'))!;
    expect(JSON.parse(String(graphql[1]!.body)).variables).toEqual({
      accountTag: '2991a2961440d6e0618f39bc2a0a423b', start: '2026-10-01T00:00:00.000Z', end: '2026-10-15T12:34:56.000Z',
    });
  });

  it('makes no write when nothing changes', async () => {
    const fetchImpl = fakeFetch(5, false);
    expect(await runGuard(env, now, fetchImpl as unknown as typeof fetch, quiet)).toMatchObject({ wrote: false, decision: { reason: 'unchanged' } });
    expect(fetchImpl.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('does not close the host when analytics fail, and logs an error', async () => {
    const fetchImpl = fakeFetch('error', false);
    const log = vi.fn();
    expect(await runGuard(env, now, fetchImpl as unknown as typeof fetch, log)).toMatchObject({ wrote: false, decision: { reason: 'analytics-unavailable' } });
    expect(fetchImpl.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    expect(log.mock.calls.some(([level, fields]) => level === 'error' && String(fields.error).includes('not authorized'))).toBe(true);
  });

  it('observe mode never writes', async () => {
    const fetchImpl = fakeFetch(5_000, false);
    expect(await runGuard({ ...env, GUARD_MODE: 'observe' }, now, fetchImpl as unknown as typeof fetch, quiet)).toMatchObject({ wrote: false });
    expect(fetchImpl.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('off mode makes no request at all', async () => {
    const fetchImpl = fakeFetch(5_000, false);
    await runGuard({ ...env, GUARD_MODE: 'off' }, now, fetchImpl as unknown as typeof fetch, quiet);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a missing secret is logged and changes nothing', async () => {
    const fetchImpl = fakeFetch(5_000, false);
    const log = vi.fn();
    await runGuard({ GUARD_MODE: 'enforce' }, now, fetchImpl as unknown as typeof fetch, log);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('error', expect.objectContaining({ error: expect.stringContaining('CF_GUARD_TOKEN') }));
  });
});
