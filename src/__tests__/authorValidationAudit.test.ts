import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  LOCAL_INPUT_DATASETS,
  assertMechanicalAuditFresh,
  bindContrastDeTables,
  carriedForwardWarning,
  compareNullableNumber,
  isExactContrastMatch,
  isMissingLocalInput,
  missingLocalInputs,
} from '../../scripts/lib/authorValidationAudit.mjs';

const table = (path: string) => ({ path });

describe('assertMechanicalAuditFresh', () => {
  it('runs the current mechanical audit check directly before trusting its saved evidence', () => {
    const root = resolve(process.cwd(), 'fixture-root');
    const run = vi.fn();
    assertMechanicalAuditFresh(root, run);
    expect(run).toHaveBeenCalledWith(process.execPath, [
      resolve(root, 'node_modules/tsx/dist/cli.mjs'),
      resolve(root, 'scripts/audit_author_validation.mts'),
      '--check',
    ], { cwd: root, stdio: 'inherit', windowsHide: true });
  });

  it('blocks the caller when the current audit fails or its saved report is stale', () => {
    const run = vi.fn(() => { throw new Error('mechanical report is stale'); });
    expect(() => assertMechanicalAuditFresh(process.cwd(), run)).toThrow(/refresh is blocked: mechanical report is stale/);
  });
});

describe('bindContrastDeTables', () => {
  it('binds the sole contrast only when exactly one DE table exists', () => {
    const only = table('/dataset/processed/GSE1_DE.tsv');
    expect(bindContrastDeTables('study', ['treated_vs_control'], [only]).get('treated_vs_control'))
      .toBe(only);
    expect(() => bindContrastDeTables('study', ['a', 'b'], [only])).toThrow(/explicit one-to-one mapping/);
    expect(() => bindContrastDeTables('study', ['a'], [only, table('/dataset/processed/other_DE.tsv')]))
      .toThrow(/explicit one-to-one mapping/);
  });

  it('uses declared filenames for a multi-contrast dataset, independent of row similarity', () => {
    const p0 = table('/dataset/processed/dietP0_DE.tsv');
    const p21 = table('/dataset/processed/dietP21_DE.tsv');
    const bound = bindContrastDeTables(
      'study',
      ['hfd_p21', 'hfd_p0'],
      [p0, p21],
      { hfd_p21: 'dietP21_DE.tsv', hfd_p0: 'dietP0_DE.tsv' },
    );
    expect(bound.get('hfd_p21')).toBe(p21);
    expect(bound.get('hfd_p0')).toBe(p0);
  });

  it('rejects incomplete, duplicate, missing, and unclaimed explicit mappings', () => {
    const a = table('/dataset/processed/a_DE.tsv');
    const b = table('/dataset/processed/b_DE.tsv');
    expect(() => bindContrastDeTables('study', ['a', 'b'], [a, b], { a: 'a_DE.tsv' }))
      .toThrow(/missing: b/);
    expect(() => bindContrastDeTables('study', ['a', 'b'], [a, b], { a: 'a_DE.tsv', b: 'a_DE.tsv' }))
      .toThrow(/same DE table/);
    expect(() => bindContrastDeTables('study', ['a'], [a], { a: 'missing_DE.tsv' }))
      .toThrow(/is missing/);
    expect(() => bindContrastDeTables('study', ['a'], [a, b], { a: 'a_DE.tsv' }))
      .toThrow(/unclaimed DE tables: b_DE\.tsv/);
  });
});

describe('compareNullableNumber', () => {
  it('compares two numeric values and treats two missing values as equal', () => {
    expect(compareNullableNumber(0.2, 0.1)).toEqual({ delta: 0.1, nullnessMismatch: false });
    expect(compareNullableNumber(null, null)).toEqual({ delta: 0, nullnessMismatch: false });
    expect(compareNullableNumber(Number.NaN, undefined)).toEqual({ delta: 0, nullnessMismatch: false });
  });

  it('flags missing-vs-numeric values in both directions', () => {
    expect(compareNullableNumber(null, 0.05)).toEqual({ delta: null, nullnessMismatch: true });
    expect(compareNullableNumber(0.05, null)).toEqual({ delta: null, nullnessMismatch: true });
  });

  it('makes an otherwise exact contrast fail when FDR nullness differs', () => {
    const exact = {
      bundleCoverage: 1,
      directionMismatches: 0,
      maxAbsLogFcDelta: 0,
      maxAbsPValueDelta: 0,
      maxAbsFdrDelta: 0,
      fdrNullnessMismatches: 0,
    };
    expect(isExactContrastMatch(exact)).toBe(true);
    expect(isExactContrastMatch({ ...exact, fdrNullnessMismatches: 1 })).toBe(false);
  });
});

describe('generated mechanical audit evidence', () => {
  it('pins the explicit mapping and FDR-nullness schema', () => {
    const report = JSON.parse(readFileSync(
      resolve(process.cwd(), 'data', 'author-validation', 'mechanical-audit.generated.json'),
      'utf8',
    )) as {
      schemaVersion: number;
      datasets: Array<{
        datasetId: string;
        deTableMapping: string;
        contrasts: Array<{ fdrNullnessMismatches: number }>;
      }>;
    };
    expect(report.schemaVersion).toBe(2);
    expect(report.datasets.filter((dataset) => dataset.deTableMapping === 'explicit').map((dataset) => dataset.datasetId))
      .toEqual([
      'mouse_pomc_maternal_hfd_gse135639',
      'gse317867',
      'gse278158',
      'gse309435',
      'gse148252',
      'emtab15488',
      'emtab15489',
      'gse337822',
      'gse262407',
      'gse314184',
      'gse113576',
      'gse135007',
      'gse224274',
      'gse308884',
      'gse281701',
      'mouse_cvh_hfd_gse104709',
      'rat_hypo_maternal_hfd_gse107324',
      'rat_son_salt_gse65663',
    ]);
    expect(report.datasets.flatMap((dataset) => dataset.contrasts)
      .every((contrast) => contrast.fdrNullnessMismatches === 0)).toBe(true);
  });
});

describe('local-input datasets', () => {
  const gse281503 = LOCAL_INPUT_DATASETS.find((dataset) => dataset.datasetId === 'mouse_hypo_lps_gse281503')!;
  const workbook = `${gse281503.directory}/raw/GSE281503_Effects_of_daridorexant_on_LPS-induced_mice.xlsx`;

  it('registers only GSE281503, whose untracked source is a subset of its required inputs', () => {
    expect(LOCAL_INPUT_DATASETS.map((dataset) => dataset.accession)).toEqual(['GSE281503']);
    for (const entry of gse281503.untrackedSourceFiles) {
      expect(gse281503.requiredLocalFiles).toContain(entry.file);
    }
    expect(gse281503.requiredLocalFiles).toContain('processed/GSE281503_DE.tsv');
  });

  it('reports nothing missing for datasets whose inputs are fully tracked', () => {
    const exists = vi.fn(() => false);
    expect(missingLocalInputs('/repo', 'mouse_gt17_mkrn3_gse160467', exists)).toEqual([]);
    expect(exists).not.toHaveBeenCalled();
  });

  it('lists exactly the absent required inputs as repo-relative POSIX paths', () => {
    const present = new Set([resolve('/repo', `${gse281503.directory}/processed/GSE281503_DE.tsv`)]);
    const missing = missingLocalInputs('/repo', gse281503.datasetId, (path) => present.has(path));
    expect(missing).toHaveLength(gse281503.requiredLocalFiles.length - 1);
    expect(missing).toContain(workbook);
    expect(missing).not.toContain(`${gse281503.directory}/processed/GSE281503_DE.tsv`);
    expect(missingLocalInputs('/repo', gse281503.datasetId, () => true)).toEqual([]);
  });

  it('recognizes a missing input only for the carried-forward datasets it is asked about', () => {
    expect(isMissingLocalInput(resolve('/nowhere'), [gse281503.datasetId], workbook)).toBe(true);
    expect(isMissingLocalInput(resolve('/nowhere'), [], workbook)).toBe(false);
    expect(isMissingLocalInput(resolve('/nowhere'), [gse281503.datasetId], 'scripts/run_mouse_fgsea.R')).toBe(false);
  });

  it('prints a loud banner naming the script, the absent files, and the carried-forward record', () => {
    const banner = carriedForwardWarning(
      gse281503.datasetId,
      'audit_author_validation.mts',
      [workbook, `${gse281503.directory}/processed/GSE281503_fgsea.tsv`],
      'data/author-validation/mechanical-audit.generated.json',
    );
    expect(banner).toMatch(/^!!! WARNING: mouse_hypo_lps_gse281503 \(GSE281503\) was NOT re-verified by audit_author_validation\.mts\./);
    expect(banner).toContain(`2 of ${gse281503.requiredLocalFiles.length} required local input(s)`);
    expect(banner).toContain(`${workbook} [95 MB GEO supplement workbook`);
    expect(banner).toContain(`${gse281503.directory}/processed/GSE281503_fgsea.tsv\n`);
    expect(banner).toContain('data/author-validation/mechanical-audit.generated.json was carried forward unchanged');
    expect(banner.endsWith('\n')).toBe(true);
    expect(() => carriedForwardWarning('mouse_gt17_mkrn3_gse160467', 'x.mts', [], 'y')).toThrow(/not registered/);
  });
});
