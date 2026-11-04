import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

type MechanicalAuditRunner = (
  executable: string,
  args: string[],
  options: { cwd: string; stdio: 'inherit'; windowsHide: boolean },
) => unknown;

/** A saved passing audit is not authority after its inputs change. */
export function assertMechanicalAuditFresh(
  root: string,
  run: MechanicalAuditRunner = execFileSync,
): void {
  const directory = resolve(root);
  try {
    run(process.execPath, [
      resolve(directory, 'node_modules/tsx/dist/cli.mjs'),
      resolve(directory, 'scripts/audit_author_validation.mts'),
      '--check',
    ], { cwd: directory, stdio: 'inherit', windowsHide: true });
  } catch (error) {
    throw new Error(`current mechanical author-validation audit failed; refresh is blocked: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface AuditDeTableRef {
  path: string;
}

/**
 * Bind every registered contrast to exactly one committed DE table.
 *
 * A single-contrast dataset is structurally unambiguous only when it has one
 * table. Multi-contrast datasets must declare the filename for every contrast;
 * comparing bundle values to whichever table happens to look most similar is
 * not provenance.
 */
export function bindContrastDeTables<T extends AuditDeTableRef>(
  datasetId: string,
  contrastIds: readonly string[],
  candidates: readonly T[],
  explicitFilenames?: Readonly<Record<string, string>>,
): Map<string, T> {
  const uniqueContrasts = new Set(contrastIds);
  if (uniqueContrasts.size !== contrastIds.length) {
    throw new Error(`${datasetId}: registered contrast ids are not unique`);
  }

  const candidatesByName = new Map<string, T>();
  for (const candidate of candidates) {
    const filename = basename(candidate.path);
    if (candidatesByName.has(filename)) {
      throw new Error(`${datasetId}: duplicate DE-table filename ${filename}`);
    }
    candidatesByName.set(filename, candidate);
  }

  if (!explicitFilenames) {
    if (contrastIds.length !== 1 || candidates.length !== 1) {
      throw new Error(
        `${datasetId}: ${contrastIds.length} contrasts and ${candidates.length} DE tables require an explicit one-to-one mapping`,
      );
    }
    return new Map([[contrastIds[0], candidates[0]]]);
  }

  const declaredContrasts = Object.keys(explicitFilenames);
  const missingContrasts = contrastIds.filter((id) => !(id in explicitFilenames));
  const unknownContrasts = declaredContrasts.filter((id) => !uniqueContrasts.has(id));
  if (missingContrasts.length || unknownContrasts.length) {
    throw new Error(
      `${datasetId}: explicit DE-table mapping does not match registered contrasts`
      + ` (missing: ${missingContrasts.join(', ') || 'none'}; unknown: ${unknownContrasts.join(', ') || 'none'})`,
    );
  }

  const filenames = declaredContrasts.map((id) => explicitFilenames[id]);
  if (new Set(filenames).size !== filenames.length) {
    throw new Error(`${datasetId}: more than one contrast maps to the same DE table`);
  }

  const mapped = new Map<string, T>();
  for (const contrastId of contrastIds) {
    const filename = explicitFilenames[contrastId];
    const table = candidatesByName.get(filename);
    if (!table) {
      throw new Error(`${datasetId}/${contrastId}: mapped DE table ${filename} is missing`);
    }
    mapped.set(contrastId, table);
  }

  const mappedFilenames = new Set(filenames);
  const unclaimedTables = [...candidatesByName.keys()].filter((name) => !mappedFilenames.has(name));
  if (unclaimedTables.length) {
    throw new Error(`${datasetId}: unclaimed DE tables: ${unclaimedTables.join(', ')}`);
  }
  return mapped;
}

export interface NullableNumericComparison {
  delta: number | null;
  nullnessMismatch: boolean;
}

/** Compare nullable probabilities without allowing null-vs-number to pass. */
export function compareNullableNumber(
  actual: number | null | undefined,
  expected: number | null | undefined,
): NullableNumericComparison {
  const actualMissing = actual == null || !Number.isFinite(actual);
  const expectedMissing = expected == null || !Number.isFinite(expected);
  if (actualMissing || expectedMissing) {
    return {
      delta: actualMissing === expectedMissing ? 0 : null,
      nullnessMismatch: actualMissing !== expectedMissing,
    };
  }
  return { delta: Math.abs(actual - expected), nullnessMismatch: false };
}

export interface ExactContrastMetrics {
  bundleCoverage: number;
  directionMismatches: number;
  maxAbsLogFcDelta: number;
  maxAbsPValueDelta: number;
  maxAbsFdrDelta: number;
  fdrNullnessMismatches: number;
}

export function isExactContrastMatch(metrics: ExactContrastMetrics): boolean {
  return metrics.bundleCoverage === 1
    && metrics.directionMismatches === 0
    && metrics.maxAbsLogFcDelta === 0
    && metrics.maxAbsPValueDelta === 0
    && metrics.maxAbsFdrDelta === 0
    && metrics.fdrNullnessMismatches === 0;
}

/**
 * A dataset whose author-validation checks read local files that are not all
 * in Git. Every `--check` script recomputes such a dataset only when all of
 * its `requiredLocalFiles` are present; otherwise it carries the committed
 * record forward unchanged and prints {@link carriedForwardWarning}, so a
 * clean clone still builds without pretending the dataset was re-verified.
 */
export interface LocalInputDataset {
  datasetId: string;
  accession: string;
  /** Repo-relative POSIX path of the geo_replication dataset directory. */
  directory: string;
  /** Files under `directory` that every author-validation check reads. */
  requiredLocalFiles: readonly string[];
  /** Subset of `requiredLocalFiles` that is intentionally kept out of Git. */
  untrackedSourceFiles: readonly Record<'file' | 'reason', string>[];
}

const GSE281503_DIRECTORY = 'geo_replication/datasets/GSE281503_mmus_hypo_lps';

export const LOCAL_INPUT_DATASETS: readonly LocalInputDataset[] = [
  {
    datasetId: 'mouse_hypo_lps_gse281503',
    accession: 'GSE281503',
    directory: GSE281503_DIRECTORY,
    requiredLocalFiles: [
      'metadata/GSE281503_source_files.tsv',
      'metadata/GSE281503_family.soft.gz',
      'raw/GSE281503_Effects_of_daridorexant_on_LPS-induced_mice.xlsx',
      'processed/GSE281503_DE.tsv',
      'processed/GSE281503_preprocessing_qc.tsv',
      'processed/GSE281503_fgsea.tsv',
      'processed/GSE281503_FGSEA_provenance.tsv',
      'processed/GSE281503_FGSEA_GO_BP.tsv',
      'processed/GSE281503_FGSEA_HALLMARK.tsv',
      'processed/GSE281503_FGSEA_KEGG.tsv',
      'processed/GSE281503_FGSEA_REACTOME.tsv',
    ],
    untrackedSourceFiles: [
      {
        file: 'raw/GSE281503_Effects_of_daridorexant_on_LPS-induced_mice.xlsx',
        reason: '95 MB GEO supplement workbook, deliberately outside Git; re-download it from '
          + 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE281nnn/GSE281503/suppl/ '
          + '(size and SHA-256 are pinned in scripts/prep_GSE281503.py and metadata/GSE281503_source_files.tsv).',
      },
    ],
  },
];

export function localInputDataset(datasetId: string): LocalInputDataset | null {
  return LOCAL_INPUT_DATASETS.find((dataset) => dataset.datasetId === datasetId) ?? null;
}

/**
 * Repo-relative paths of the dataset's required local inputs that are absent.
 * Empty for datasets whose inputs are fully tracked, and for a registered
 * dataset whose working tree is complete.
 */
export function missingLocalInputs(
  root: string,
  datasetId: string,
  exists: (path: string) => boolean = existsSync,
): string[] {
  const dataset = localInputDataset(datasetId);
  if (!dataset) return [];
  return dataset.requiredLocalFiles
    .map((file) => `${dataset.directory}/${file}`)
    .filter((path) => !exists(resolve(root, path)));
}

/** True when `path` (repo-relative POSIX) is a missing input of a carried-forward dataset. */
export function isMissingLocalInput(root: string, datasetIds: Iterable<string>, path: string): boolean {
  for (const datasetId of datasetIds) {
    if (missingLocalInputs(root, datasetId).includes(path)) return true;
  }
  return false;
}

/**
 * The stderr banner every check prints when it carries a committed record
 * forward instead of recomputing it. Deliberately loud: a clean clone must
 * see that this dataset was not re-verified on this machine.
 */
export function carriedForwardWarning(
  datasetId: string,
  scriptName: string,
  missing: readonly string[],
  committedRecord: string,
): string {
  const dataset = localInputDataset(datasetId);
  if (!dataset) throw new Error(`${datasetId} is not registered as a local-input dataset`);
  const untracked = new Map(dataset.untrackedSourceFiles.map((entry) => [`${dataset.directory}/${entry.file}`, entry.reason]));
  const lines = [
    `!!! WARNING: ${dataset.datasetId} (${dataset.accession}) was NOT re-verified by ${scriptName}.`,
    `!!! ${missing.length} of ${dataset.requiredLocalFiles.length} required local input(s) are absent on this machine:`,
    ...missing.map((path) => `!!!   - ${path}${untracked.has(path) ? ` [${untracked.get(path)}]` : ''}`),
    `!!! The committed record in ${committedRecord} was carried forward unchanged.`,
    '!!! Restore the files above (see .gitignore and scripts/prep_GSE281503.py) to re-verify this dataset.',
  ];
  return `${lines.join('\n')}\n`;
}
