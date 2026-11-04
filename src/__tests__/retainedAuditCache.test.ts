import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CACHE_DEPENDENT_TESTS, RETAINED_CACHE_ENV, retainedCacheDeclaredAbsent, retainedCacheSkip } from './retainedAuditCache';

const entry = CACHE_DEPENDENT_TESTS[0];

describe('retained audit cache gate', () => {
  it('is off unless the cache is declared absent, and refuses any other value', () => {
    expect(retainedCacheDeclaredAbsent({})).toBe(false);
    expect(retainedCacheDeclaredAbsent({ [RETAINED_CACHE_ENV]: '' })).toBe(false);
    expect(retainedCacheDeclaredAbsent({ [RETAINED_CACHE_ENV]: 'absent' })).toBe(true);
    for (const value of ['1', 'true', 'Absent', 'missing']) {
      expect(() => retainedCacheDeclaredAbsent({ [RETAINED_CACHE_ENV]: value })).toThrow(RETAINED_CACHE_ENV);
    }
  });

  it('skips only when every declared input is missing', () => {
    const many = { ...entry, inputs: ['a.gz', 'b.tar'] };
    expect(retainedCacheSkip(many, () => false)).toBe('retained audit cache absent: a.gz and 1 more');
    expect(retainedCacheSkip(entry, () => false)).toBe(`retained audit cache absent: ${entry.inputs[0]}`);
    // A partial cache runs the test, so a missing or altered remainder still fails.
    expect(retainedCacheSkip(many, path => path === 'b.tar')).toBeNull();
    expect(retainedCacheSkip(many, () => true)).toBeNull();
  });

  it('declares each test once, in an existing test file, with at least one input', () => {
    const keys = CACHE_DEPENDENT_TESTS.map(row => `${row.file} :: ${row.test}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const row of CACHE_DEPENDENT_TESTS) {
      expect(existsSync(row.file), row.file).toBe(true);
      expect(row.inputs.length, row.test).toBeGreaterThan(0);
    }
  });

  it('declares only gitignored, untracked inputs, so a missing tracked file can never be skipped', () => {
    const inputs = [...new Set(CACHE_DEPENDENT_TESTS.flatMap(row => row.inputs))].sort();
    // check-ignore reports a tracked path as not ignored even when a pattern matches it.
    const ignored = execFileSync('git', ['check-ignore', ...inputs], { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
    expect(ignored).toEqual(inputs);
    expect(execFileSync('git', ['ls-files', '--', ...inputs], { encoding: 'utf8' })).toBe('');
  });
});
