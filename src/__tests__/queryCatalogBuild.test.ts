import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { readQueryCatalogBuild } from '../../scripts/lib/queryCatalogBuild.mjs';
import { queryCatalogContent } from '../data/queryCatalogIdentity';
import type { QueryManifest } from '../data/queryIndex';

describe('build-time catalog binding', () => {
  it('binds every current raw manifest field using the same reviewed display transform', () => {
    const path = 'public/query/tracks.js';
    const source = readFileSync(path, 'utf8');
    const raw = JSON.parse(source.slice(source.indexOf('=') + 1).trim().replace(/;$/, '')) as QueryManifest;
    const built = readQueryCatalogBuild(path);
    expect(built.buildId).toBe(raw.buildId);
    expect(built.content).toBe(queryCatalogContent(raw));
    const row = JSON.parse(built.content).datasets.find((d: { ds: string }) => d.ds === 'mouse_pvn_crh_ela_gse174085');
    expect([row.nBaseline, row.nCase, row.trackLabel]).toEqual([14, 10, 'PVN CRH neurons (litter pseudobulk)']);
  });

  it.each([
    'var WRONG = {"buildId":"b","tracks":[{}],"datasets":[{}]};',
    'var HX_QUERY_TRACKS = {"buildId":" ","tracks":[{}],"datasets":[{}]};',
    'var HX_QUERY_TRACKS = {"buildId":"b","tracks":[],"datasets":[{}]};',
    'var HX_QUERY_TRACKS = {"buildId":"b","tracks":[{}],"datasets":[]};',
    'var HX_QUERY_TRACKS = {"buildId":"b","tracks":[{}],"datasets":[{}]}; alert(1);',
  ])('rejects a malformed local catalog: %s', source => {
    const folder = mkdtempSync(join(tmpdir(), 'catalog-build-test-'));
    try {
      const path = join(folder, 'tracks.js'); writeFileSync(path, source);
      expect(() => readQueryCatalogBuild(path)).toThrow();
    } finally {
      const target = resolve(folder), within = relative(resolve(tmpdir()), target);
      expect(within && !within.startsWith('..') && !isAbsolute(within) && basename(target).startsWith('catalog-build-test-')).toBeTruthy();
      rmSync(target, {recursive: true, force: true});
    }
  });
});
