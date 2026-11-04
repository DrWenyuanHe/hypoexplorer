import { beforeEach, describe, expect, it, vi } from 'vitest';

// Keep this Node-only entrypoint out of the application's ES2020 typecheck graph.
const builderModule = '../../scripts/build_author_validation.mjs';

const fixture = vi.hoisted(() => ({
  datasetId: 'source_gate_fixture',
  sourceIntegrity: 'mismatch',
  sourceFileResult: 'mismatch',
  overlay: 'direct',
  profilePresent: true,
  write: vi.fn(),
}));

vi.mock('../data/datasets', () => ({
  DATASETS: [
    { id: fixture.datasetId, geo: 'GSE_FIXTURE', contrasts: [{ id: 'treated_vs_control' }] },
  ],
}));

vi.mock('../../scripts/lib/authorPathwayValidation.mjs', () => ({
  pathwayValidationByDataset: () => new Map(),
}));
vi.mock('../../scripts/lib/currentIntakePathwayEvidence.mjs', () => ({
  readCurrentIntakePathwayRecords: () => [],
}));

// Scoped result evidence has its own integrity tests; this fixture exercises
// the source gate before any optional per-comparison evidence is attached.
vi.mock('../../scripts/lib/scopedAuthorEvidence.mjs', () => ({
  readScopedAuthorEvidence: () => new Map(),
}));

// Exercise the production builder without reading or writing any real ledgers.
vi.mock('node:fs', () => {
  const mockedFs = {
    existsSync: () => true,
    mkdirSync: vi.fn(),
    readdirSync: () => [],
    writeFileSync: fixture.write,
    readFileSync: (path: string) => {
      const filename = String(path).replace(/\\/g, '/').split('/').pop();
      const manualMatch = {
        status: 'author_result_match',
        comparisonLevel: 'direct',
        sourceComparison: 'checksum_match',
        auditState: 'complete',
        reviewFlags: [],
        summary: 'Historical author-result match',
      };
      const inputs: Record<string, unknown> = {
        'mechanical-audit.generated.json': {
          datasets: [
            {
              datasetId: fixture.datasetId,
              sourceIntegrity: fixture.sourceIntegrity,
              sourceFiles: [{ result: fixture.sourceFileResult }],
              directory: null,
              bundleIntegrity: 'pass',
              contrasts: [{ contrastId: 'treated_vs_control', result: 'pass' }],
            },
          ],
        },
        'source-inventory.generated.json': {
          datasets: [
            {
              datasetId: fixture.datasetId,
              database: 'GEO',
              depositedFiles: [],
              databaseRecordUrl: 'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE_FIXTURE',
              processedInventoryUrl: 'https://www.ncbi.nlm.nih.gov/geo/',
              paperAccess: 'pubmed_record_only',
            },
          ],
        },
        'direct-comparisons.generated.json': {
          comparisons:
            fixture.overlay === 'manual'
              ? []
              : [
                  {
                    datasetId: fixture.datasetId,
                    contrast: 'treated_vs_control',
                    comparisonType: 'direct_author_result',
                    interpretation: 'effect_and_direction_match',
                    note: 'Previously matching results.',
                    metrics: {},
                    references: [],
                  },
                ],
        },
        'fgsea-migration.generated.json': {},
        'comparability-review.json': {
          schemaVersion: 1,
          records: fixture.profilePresent ? {
            [fixture.datasetId]: {
              target: 'registered_output', resultScope: 'full_results', registeredContrastIds: ['treated_vs_control'],
              basis: 'Registered fixture output.', reference: 'Full author fixture result.', assessment: 'comparable',
              dimensions: Object.fromEntries(['cohort', 'contrast', 'features', 'effects', 'inference', 'coverage']
                .map((key) => [key, { status: 'matched', note: 'Matched against author fixture.' }])),
              criteria: 'All fixture effect and inferential quantities agree at export precision.',
              conclusion: 'Registered fixture result agrees.',
            },
          } : {},
        },
        'manual-review.json': {
          schemaVersion: 1,
          records:
            fixture.overlay === 'direct'
              ? {}
              : {
                  [fixture.datasetId]: manualMatch,
                },
        },
        'verification-review.json': {
          schemaVersion: 1,
          records:
            fixture.overlay === 'full'
              ? {
                  [fixture.datasetId]: {
                    resultAvailability: 'available',
                    comparisonOutcome: 'concordant',
                    reason: 'All registered contrasts signed off before the source changed.',
                    nextStep: 'None.',
                    fullyVerifiedContrasts: ['treated_vs_control'],
                  },
                }
              : {},
        },
      };
      if (!(filename! in inputs)) throw new Error(`Unexpected fixture file read: ${filename}`);
      return JSON.stringify(inputs[filename!]);
    },
  };
  return { ...mockedFs, default: mockedFs };
});

beforeEach(() => {
  vi.resetModules();
  fixture.sourceIntegrity = 'mismatch';
  fixture.sourceFileResult = 'mismatch';
  fixture.overlay = 'direct';
  fixture.profilePresent = true;
  fixture.write.mockClear();
});

describe('author-validation builder source-integrity gate', () => {
  it.each([
    'direct',
    'manual',
    'full',
  ])('blocks a fresh checksum mismatch despite a %s match overlay', async (overlay) => {
    fixture.overlay = overlay;
    await expect(import(builderModule)).rejects.toThrow(
      /source_gate_fixture: pinned source checksum mismatch/,
    );
    expect(fixture.write).not.toHaveBeenCalled();
  });

  it('also blocks an individual source mismatch when the aggregate claims a pass', async () => {
    fixture.sourceIntegrity = 'pass';
    fixture.overlay = 'full';
    await expect(import(builderModule)).rejects.toThrow(
      /source_gate_fixture: pinned source checksum mismatch/,
    );
    expect(fixture.write).not.toHaveBeenCalled();
  });

  it('permits an otherwise eligible full sign-off when both source checks pass', async () => {
    fixture.sourceIntegrity = 'pass';
    fixture.sourceFileResult = 'match';
    fixture.overlay = 'full';
    await import(builderModule);
    const output = fixture.write.mock.calls.find(([path]) =>
      String(path).endsWith('validation-records.generated.json'),
    );
    expect(output).toBeDefined();
    expect(JSON.parse(output![1]).records[0].verification.state).toBe('full');
  });
  it('blocks regeneration if a numerical comparison loses its explicit scope review', async () => {
    fixture.sourceIntegrity = 'pass';
    fixture.sourceFileResult = 'match';
    fixture.profilePresent = false;
    await expect(import(builderModule)).rejects.toThrow(/missing explicit author-result comparability review/);
    expect(fixture.write).not.toHaveBeenCalled();
  });
});
