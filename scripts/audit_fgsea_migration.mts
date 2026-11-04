/** Persist every pre-audit versus cache-isolated FGSEA difference. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDatasets } from '../src/data/datasets';
import {
  assertMechanicalAuditFresh, carriedForwardWarning, isMissingLocalInput, missingLocalInputs,
} from './lib/authorValidationAudit.mjs';
import { compareFgseaRows } from './lib/fgseaMigration.mjs';
import { assertGitPreservesFileBytes } from './lib/fgseaGitBytes.mjs';
import { readAdditiveIntake } from './lib/historicalEvidence.mjs';
import {
  FGSEA_DATABASES, parseFgseaTable, readVerifiedFgseaSet, resolveConfiguredFgseaSpecies,
} from './lib/fgseaProvenance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = resolve(ROOT, 'data', 'author-validation');
const OUTPUT = resolve(EVIDENCE, 'fgsea-migration.generated.json');
const TSV_OUTPUT = resolve(EVIDENCE, 'fgsea-migration.generated.tsv');
const REPORT_OUTPUT = resolve(EVIDENCE, 'FGSEA_MIGRATION_REPORT.generated.md');
const CHECK = process.argv.includes('--check');
const EXCLUDED = 'macaque_snrna';

interface MechanicalDataset {
  datasetId: string;
  accession: string;
  bundleIntegrity: string;
  contrasts: Array<{ contrastId: string; table: string; result: string }>;
}

assertMechanicalAuditFresh(ROOT);
const mechanical = JSON.parse(readFileSync(resolve(EVIDENCE, 'mechanical-audit.generated.json'), 'utf8')) as {
  schemaVersion: number;
  datasets: MechanicalDataset[];
};
if (mechanical.schemaVersion !== 2) throw new Error('FGSEA migration requires the explicit contrast-map audit schema');
const fullRegistry = listDatasets().filter((dataset) => dataset.id !== EXCLUDED);
if (mechanical.datasets.length !== fullRegistry.length || new Set(mechanical.datasets.map((record) => record.datasetId)).size !== fullRegistry.length
  || mechanical.datasets.some(record => !fullRegistry.some(dataset => dataset.id === record.datasetId && dataset.geo === record.accession))) {
  throw new Error('FGSEA migration audit does not cover the in-scope registry exactly');
}
// A newly admitted analysis has no pre-audit result. Its current schema-3
// provenance is checked by the dedicated source-bound intake audit and joined
// separately by build_author_validation; historical migration scope stays fixed.
const additiveIds = readAdditiveIntake(ROOT).datasetIds;
const registry = fullRegistry.filter(dataset => !additiveIds.has(dataset.id));
const prior = existsSync(OUTPUT)
  ? JSON.parse(readFileSync(OUTPUT, 'utf8')) as { baselineCommit: string; datasets?: Array<{ datasetId: string }> }
  : null;
const baselineCommit = prior?.baselineCommit ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
if (!/^[0-9a-f]{40}$/.test(baselineCommit)) throw new Error('FGSEA baseline is not a pinned Git commit');
const gitText = (path: string) => execFileSync('git', ['show', `${baselineCommit}:${path}`], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true,
});
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const textSha256 = (value: string) => sha256(value.replaceAll('\r\n', '\n').replace(/\n?$/, '\n'));
interface SnapshotRecord {
  datasetId: string;
  accession: string;
  capturedAt: string;
  note: string;
  files: Array<{ sourcePath: string; snapshotPath: string; bytes: number; sha256: string }>;
}
const snapshotManifestPath = resolve(EVIDENCE, 'fgsea-baselines', 'manifest.json');
const snapshotManifest = JSON.parse(readFileSync(snapshotManifestPath, 'utf8')) as {
  schemaVersion: number;
  records: SnapshotRecord[];
};
const snapshotByDataset = new Map(snapshotManifest.records.map((record) => [record.datasetId, record]));
if (snapshotManifest.schemaVersion !== 1 || snapshotByDataset.size !== snapshotManifest.records.length
    || [...snapshotByDataset.keys()].some((id) => !registry.some((dataset) => dataset.id === id))) {
  throw new Error('FGSEA local baseline manifest does not match the registry');
}
const snapshotText = new Map<string, string>();
for (const record of snapshotManifest.records) {
  for (const file of record.files) {
    if (!file.snapshotPath.startsWith('fgsea-baselines/') || file.snapshotPath.includes('..')
        || !file.sourcePath.startsWith('geo_replication/') || file.sourcePath.includes('..')
        || snapshotText.has(file.sourcePath)) throw new Error('FGSEA snapshot manifest contains unsafe or duplicate paths');
    const bytes = readFileSync(resolve(EVIDENCE, file.snapshotPath));
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`${file.snapshotPath}: baseline checksum mismatch`);
    snapshotText.set(file.sourcePath, bytes.toString('utf8'));
  }
}
const baselineText = (path: string) => snapshotText.get(path) ?? gitText(path);
const totalKeys = [
  'previousRows', 'currentRows', 'addedRows', 'removedRows', 'sharedRows',
  'nesDirectionChanges', 'fdrCallsBefore', 'fdrCallsAfter', 'fdrCallsGained', 'fdrCallsLost',
  'nonFiniteRowsBefore', 'nonFiniteRowsAfter',
] as const;
const sumMetrics = (comparisons: ReturnType<typeof compareFgseaRows>[]) => Object.fromEntries(
  totalKeys.map((key) => [key, comparisons.reduce((sum, row) => sum + row[key], 0)]),
) as Record<typeof totalKeys[number], number>;

function auditMigrationDataset(dataset: (typeof registry)[number], record: MechanicalDataset) {
  const registryContrasts = new Set(dataset.contrasts.map((contrast) => contrast.id));
  if (record.contrasts.length !== registryContrasts.size
      || new Set(record.contrasts.map((contrast) => contrast.contrastId)).size !== registryContrasts.size
      || record.contrasts.some((contrast) => !registryContrasts.has(contrast.contrastId) || contrast.result !== 'pass')) {
    throw new Error(`${dataset.id}: contrast identity or mechanical trace is stale`);
  }
  const snapshot = snapshotByDataset.get(dataset.id);
  if (snapshot) {
    const expected = new Set(record.contrasts.flatMap((contrast) => [
      contrast.table,
      ...FGSEA_DATABASES.map((database) => contrast.table.replace(/_DE\.tsv$/, `_FGSEA_${database}.tsv`)),
    ]));
    if (snapshot.accession !== record.accession || snapshot.files.length !== expected.size
        || snapshot.files.some((file) => !expected.has(file.sourcePath))) {
      throw new Error(`${dataset.id}: local snapshot does not cover the exact baseline inputs`);
    }
  }
  const provenanceFiles: string[] = [];
  const comparisons = record.contrasts.flatMap((contrast) => {
    const dePath = resolve(ROOT, contrast.table);
    if (!contrast.table.startsWith('geo_replication/') || contrast.table.includes('..') || !contrast.table.endsWith('_DE.tsv')) {
      throw new Error(`${dataset.id}: unsafe or unrecognized DE-table path`);
    }
    const verified = readVerifiedFgseaSet(dePath, { expectedSpecies: resolveConfiguredFgseaSpecies(dePath) });
    const previousDeSha256 = textSha256(baselineText(contrast.table));
    const currentDeSha256 = textSha256(readFileSync(dePath, 'utf8'));
    provenanceFiles.push(relative(ROOT, verified.provenancePath).replaceAll('\\', '/'));
    return FGSEA_DATABASES.map((database) => {
      const resultPath = resolve(dirname(dePath), `${verified.prefix}_FGSEA_${database}.tsv`);
      const relativePath = relative(ROOT, resultPath).replaceAll('\\', '/');
      const previousText = baselineText(relativePath);
      const previousRows = parseFgseaTable(previousText, `${baselineCommit}:${relativePath}`);
      return {
        contrastId: contrast.contrastId,
        deTableChanged: previousDeSha256 !== currentDeSha256,
        previousDeTextSha256: previousDeSha256,
        currentDeTextSha256: currentDeSha256,
        database,
        resultFile: relativePath,
        previousSha256: sha256(previousText),
        currentSha256: sha256(readFileSync(resultPath)),
        ...compareFgseaRows(previousRows, verified.rawRows[database]),
      };
    });
  });
  return {
    datasetId: dataset.id,
    accession: record.accession,
    baselineKind: snapshot ? 'local_snapshot' as const : 'git_commit' as const,
    baselineNote: snapshot?.note ?? `Committed pre-audit local outputs at ${baselineCommit}.`,
    contrastCount: record.contrasts.length,
    status: 'rebuilt_validated' as const,
    changedDeContrasts: [...new Set(comparisons.filter((row) => row.deTableChanged).map((row) => row.contrastId))],
    totals: sumMetrics(comparisons),
    provenanceFiles,
    comparisons,
  };
}
type MigrationDataset = ReturnType<typeof auditMigrationDataset>;

// Datasets whose local inputs are incomplete on this machine (see
// LOCAL_INPUT_DATASETS) keep their committed migration record, with a warning.
const carriedForward = new Set<string>();
const datasets = registry.map((dataset): MigrationDataset => {
  const record = mechanical.datasets.find((row) => row.datasetId === dataset.id);
  if (!record || record.bundleIntegrity !== 'pass') throw new Error(`${dataset.id}: no passing explicit DE trace`);
  const missing = missingLocalInputs(ROOT, dataset.id);
  if (!missing.length) return auditMigrationDataset(dataset, record);
  process.stderr.write(carriedForwardWarning(dataset.id, 'audit_fgsea_migration.mts', missing, relative(ROOT, OUTPUT).replaceAll('\\', '/')));
  const carried = prior?.datasets?.find((entry) => entry.datasetId === dataset.id);
  if (!carried) throw new Error(`${dataset.id}: local inputs are incomplete and there is no committed FGSEA migration record to carry forward`);
  carriedForward.add(dataset.id);
  return carried as MigrationDataset;
});

const comparisons = datasets.flatMap((dataset) => dataset.comparisons);
assertGitPreservesFileBytes(ROOT, [
  ...mechanical.datasets.flatMap((dataset) => dataset.contrasts.map((contrast) => contrast.table)),
  ...comparisons.map((row) => row.resultFile),
  ...datasets.flatMap((dataset) => dataset.provenanceFiles.flatMap((path) => [path, path.replace(/_FGSEA_provenance\.tsv$/, '_fgsea.tsv')])),
  relative(ROOT, snapshotManifestPath).replaceAll('\\', '/'),
  ...snapshotManifest.records.flatMap((record) => record.files.map((file) =>
    relative(ROOT, resolve(EVIDENCE, file.snapshotPath)).replaceAll('\\', '/'))),
  'scripts/run_mouse_fgsea.R',
  'geo_replication/datasets/GSE252779_mmus_hypo_celastrol/metadata/GSE252779_samplesheet.tsv',
  'geo_replication/datasets/GSE252779_mmus_hypo_celastrol/processed/GSE252779_preprocessing_qc.tsv',
].filter((path) => !isMissingLocalInput(ROOT, carriedForward, path)));
const numericalDiagnostics = {
  nonFiniteCollections: datasets.flatMap((dataset) => dataset.comparisons
    .filter((row) => row.nonFiniteRowsAfter > 0)
    .map((row) => ({ datasetId: dataset.datasetId, accession: dataset.accession,
      contrastId: row.contrastId, database: row.database, rows: row.nonFiniteRowsAfter,
      pathways: row.nonFinitePathwaysAfter }))),
  defaultProbabilityFloor: 1e-50,
  probabilityFloorResults: datasets.flatMap((dataset) => dataset.comparisons.flatMap((row) =>
    row.pvalueAtDefaultFloorPathwaysAfter.map((pathway) => ({ datasetId: dataset.datasetId,
      accession: dataset.accession, contrastId: row.contrastId, database: row.database, pathway })))),
  publicPolicy: 'Rows with missing or nonfinite pval, padj, or NES are omitted from public pathway tables; they are never converted to zero.',
  initialMigrationRuntimeWarnings: {
    reportedCount: 23,
    messagesRetained: false,
    limitation: 'The initial all-set migration reported 23 warnings, but their exact messages were not retained. The saved missing-value and probability-floor patterns are consistent with the installed fgsea imbalance and eps warnings, not proof of each original warning. Full collection TSVs omit log2err, so other non-focal precision warnings cannot be assessed retrospectively.',
  },
};
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baselineCommit,
  baselineDescription: 'Pre-audit local FGSEA results, normally from the pinned Git commit; Git-ignored GSE281503 uses an explicitly hash-pinned pre-migration local snapshot. These are not author-generated pathway results.',
  snapshotManifestSha256: sha256(readFileSync(snapshotManifestPath)),
  method: 'Recomputed from current processed DE.stat with HS MSigDB authority, cache-isolated per collection, fixed tie seed and per-collection FGSEA seed; schema-3 provenance verifies every output.',
  changedDeContrastCount: datasets.reduce((count, dataset) => count + dataset.changedDeContrasts.length, 0),
  scope: { datasetCount: datasets.length, contrastCount: datasets.reduce((n, dataset) => n + dataset.contrastCount, 0), collectionComparisons: comparisons.length, excludedDatasetId: EXCLUDED },
  totals: sumMetrics(comparisons),
  numericalDiagnostics,
  datasets,
};
const fields = [
  'dataset_id', 'accession', 'baseline_kind', 'contrast', 'de_table_changed', 'collection', 'previous_rows', 'current_rows',
  'added_rows', 'removed_rows', 'shared_rows', 'changed_shared_rows', 'pathway_sizes_changed',
  'leading_edges_changed', 'nes_direction_changes', 'max_abs_nes_delta', 'median_abs_nes_delta',
  'nonfinite_before', 'nonfinite_after', 'fdr_calls_before', 'fdr_calls_after', 'fdr_calls_shared',
  'fdr_calls_gained', 'fdr_calls_lost', 'fdr_call_jaccard', 'result_file', 'previous_sha256', 'current_sha256',
];
const tsv = [fields.join('\t'), ...datasets.flatMap((dataset) => dataset.comparisons.map((row) => [
  dataset.datasetId, dataset.accession, dataset.baselineKind, row.contrastId, row.deTableChanged, row.database, row.previousRows, row.currentRows,
  row.addedRows, row.removedRows, row.sharedRows, row.changedSharedRows, row.pathwaySizesChanged,
  row.leadingEdgesChanged, row.nesDirectionChanges, row.maxAbsNesDelta, row.medianAbsNesDelta,
  row.nonFiniteRowsBefore, row.nonFiniteRowsAfter, row.fdrCallsBefore, row.fdrCallsAfter, row.fdrCallsShared,
  row.fdrCallsGained, row.fdrCallsLost, row.fdrCallJaccard, row.resultFile, row.previousSha256, row.currentSha256,
].map((value) => value ?? '').join('\t'))), ''].join('\n');
const markdown = [
  '# FGSEA cache-isolation migration audit', '',
  `${report.scope.datasetCount} datasets, ${report.scope.contrastCount} registered contrasts, and ${report.scope.collectionComparisons} contrast/collection comparisons are rebuilt and schema-3 provenance checked. The macaque single-cell dataset is excluded.`, '',
  `Baseline: Git commit \`${baselineCommit}\` (pre-audit local FGSEA, **not** author pathway results).`, '',
  ...snapshotManifest.records.flatMap((record) => [`${record.accession}: ${record.note} Captured ${record.capturedAt}; file sizes and SHA-256 values are pinned in \`fgsea-baselines/manifest.json\`.`, '']),
  'The msigdbr target-species ortholog cache was reused across collections. Clearing it for every collection prevents later GO/KEGG/Reactome mappings from being restricted to earlier gene sets. All outputs now use explicit HS authority and reset the FGSEA seed before each collection. Therefore both corrected membership and deterministic seed policy can change results.', '',
  `${report.changedDeContrastCount} contrasts also have DE-table contents changed by this audit (compared after line-ending normalization); their pathway differences can additionally reflect the corrected inputs. The JSON/TSV marks these contrasts, so not every delta is attributed to the cache repair alone.`, '',
  `Across contrast/collection rows: ${report.totals.previousRows.toLocaleString()} → ${report.totals.currentRows.toLocaleString()} rows; ${report.totals.addedRows.toLocaleString()} added, ${report.totals.removedRows.toLocaleString()} removed; ${report.totals.nesDirectionChanges.toLocaleString()} shared-row NES direction changes. At FDR < 0.05: ${report.totals.fdrCallsGained.toLocaleString()} calls gained and ${report.totals.fdrCallsLost.toLocaleString()} lost. These are row counts across collections and contrasts, not unique biological pathways.`, '',
  `Numerical limitations: ${report.totals.nonFiniteRowsBefore} → ${report.totals.nonFiniteRowsAfter} rows lack a finite probability or NES. Current missing rows occur in ${numericalDiagnostics.nonFiniteCollections.length} contrast/collection files across ${new Set(numericalDiagnostics.nonFiniteCollections.map((row) => row.datasetId)).size} datasets. ${numericalDiagnostics.publicPolicy} The resulting public tables contain ${(report.totals.currentRows - report.totals.nonFiniteRowsAfter).toLocaleString()} finite rows.`, '',
  ...numericalDiagnostics.probabilityFloorResults.map((row) => `${row.accession} / ${row.contrastId} / ${row.database} / ${row.pathway}: p-value equals FGSEA's default 1e-50 numerical floor. This is a finite result, but the exact smaller probability is unresolved.`), '',
  numericalDiagnostics.initialMigrationRuntimeWarnings.limitation, '',
  '| Dataset | Contrasts | Before / after rows | Added / removed | NES direction changes | FDR calls gained / lost |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...datasets.map((dataset) => `| ${dataset.accession}${dataset.baselineKind === 'local_snapshot' ? ' (local snapshot)' : ''} | ${dataset.contrastCount} | ${dataset.totals.previousRows} / ${dataset.totals.currentRows} | ${dataset.totals.addedRows} / ${dataset.totals.removedRows} | ${dataset.totals.nesDirectionChanges} | ${dataset.totals.fdrCallsGained} / ${dataset.totals.fdrCallsLost} |`), '',
  '## Untestable current pathway rows', '',
  '| Dataset | Contrast | Collection | Missing rows |',
  '| --- | --- | --- | ---: |',
  ...numericalDiagnostics.nonFiniteCollections.map((row) => `| ${row.accession} | ${row.contrastId} | ${row.database} | ${row.rows} |`), '',
  'Per-collection metrics and hashes are in `fgsea-migration.generated.tsv`. The JSON includes exact added/removed pathway names, gained/lost FDR calls, and NES-direction reversals. Every result file is bound to its DE input, generator, authority, collection membership, and output hash in its adjacent `*_FGSEA_provenance.tsv`.', '',
].join('\n');
if (CHECK) {
  if (!existsSync(OUTPUT)) throw new Error('FGSEA migration evidence is missing');
  const actual = JSON.parse(readFileSync(OUTPUT, 'utf8'));
  if (JSON.stringify({ ...actual, generatedAt: '' }) !== JSON.stringify({ ...report, generatedAt: '' })
      || readFileSync(TSV_OUTPUT, 'utf8') !== tsv || readFileSync(REPORT_OUTPUT, 'utf8') !== markdown) {
    throw new Error('FGSEA migration evidence is stale');
  }
  console.log(`FGSEA migration evidence is current: ${report.scope.datasetCount} datasets, ${report.scope.contrastCount} contrasts, ${comparisons.length} collections`);
} else {
  writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(TSV_OUTPUT, tsv);
  writeFileSync(REPORT_OUTPUT, markdown);
  console.log(`Wrote FGSEA migration evidence: ${report.scope.datasetCount} datasets, ${report.scope.contrastCount} contrasts, ${comparisons.length} collections`);
}
