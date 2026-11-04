/** Final source-unit review of the original corpus, against closed round-five history. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { gunzipSync } from 'node:zlib';
import type { QualityAssessment } from '../src/data/qualityChecks';

const folder = 'data/quality/remaining-2026-09-05';
const replicationFolder = 'data/internal-qc/replication-2026-09-05';
const archivePath = `${folder}/closed-inputs.json.gz`;
const archive = existsSync(archivePath) ? JSON.parse(gunzipSync(readFileSync(archivePath)).toString('utf8')) : null;
if (archive) {
  assert.equal(archive.schemaVersion, 1, 'Unknown remaining-review archive schema');
  assert.equal(archive.encoding, 'base64', 'Unknown remaining-review archive encoding');
}
const dependencies = new Map<string, string>();
const input = (path: string) => {
  if (archive) assert.equal(typeof archive.files[path], 'string', `Missing closed remaining-review input: ${path}`);
  const bytes = archive ? Buffer.from(archive.files[path], 'base64') : readFileSync(path);
  dependencies.set(path, createHash('sha256').update(bytes).digest('hex'));
  return bytes;
};
const read = (path: string) => JSON.parse(input(path).toString('utf8'));
const closed = JSON.parse(gunzipSync(input('data/quality/round5-2026-09-05/closed-inputs.json.gz')).toString('utf8'));
assert.equal(closed.schemaVersion, 1, 'Unknown closed-history schema');
assert.equal(closed.encoding, 'base64', 'Unknown closed-history encoding');
const historical = (path: string) => {
  assert.equal(typeof closed.files[path], 'string', `Missing closed-history input: ${path}`);
  return JSON.parse(Buffer.from(closed.files[path], 'base64').toString('utf8'));
};
const baseline = read(`${folder}/baseline.json`);
const quality = read('data/quality/assessments.generated.json');
const internalQc = read('data/internal-qc/assessments.generated.json');
const validation = read('data/author-validation/validation-records.generated.json');
const replication = read(`${replicationFolder}/replication-evidence.json`);
const priorReplication = historical(`${replicationFolder}/replication-evidence.json`);
for (const [key, path] of Object.entries({ quality: 'data/quality/assessments.generated.json',
  internalQc: 'data/internal-qc/assessments.generated.json', validation: 'data/author-validation/validation-records.generated.json' })) {
  assert.deepEqual(baseline[key], historical(path), `Baseline ${key} differs from closed round five`);
}
const originalIds = new Set<string>(baseline.originalDatasetIds);
assert.equal(originalIds.size, 145, 'Original scope must contain 145 datasets');
assert.deepEqual(baseline.originalDatasetIds, historical('data/quality/round5-2026-09-05/baseline.json').originalDatasetIds,
  'Original scope differs from closed history');
const unique = (rows: { datasetId: string }[], name: string) => {
  const ids = rows.map(row => row.datasetId);
  assert.ok(ids.every(Boolean) && new Set(ids).size === ids.length, `Missing or duplicate ${name} identity`);
  return new Set(ids);
};
const allIds = unique(baseline.quality.records, 'baseline quality');
assert.equal(allIds.size, 159, 'Current scope must preserve original145 and intake14');
assert.ok([...originalIds].every(id => allIds.has(id)), 'Original dataset omitted from baseline');
for (const [name, ledger] of Object.entries({ quality, internalQc, validation,
  baselineInternalQc: baseline.internalQc, baselineValidation: baseline.validation })) {
  assert.deepEqual(unique((ledger as any).records, name), allIds, `${name} scope differs from baseline`);
}
assert.deepEqual(quality.authorConcordancePolicy, baseline.quality.authorConcordancePolicy, 'Author policy changed');

const beforeSpecs = read(`${folder}/replication-specifications.before.json`);
assert.equal(dependencies.get(`${folder}/replication-specifications.before.json`), priorReplication.specificationsSha256,
  'Prior specifications differ from the closed prior producer digest');
const currentSpecs = read(`${replicationFolder}/reviewed-specifications.json`);
const integration = read(`${folder}/replication-integration.json`);
const fragments = ['remaining-a', 'remaining-b'].map(batch => read(`${replicationFolder}/${batch}/specifications.json`));
assert.equal(beforeSpecs.records.length, 126, 'Wrong prior replication scope');
assert.deepEqual(currentSpecs, { ...beforeSpecs, records: [...beforeSpecs.records, ...fragments.flatMap(fragment => fragment.records)] },
  'Earlier specifications changed or reviewed additions differ');
assert.equal(currentSpecs.records.length, 142, 'Wrong final replication scope');
assert.deepEqual(unique(replication.records, 'replication evidence'), unique(currentSpecs.records, 'replication specifications'),
  'Evidence scope differs from reviewed specifications');
assert.ok(replication.records.every((row: any) => originalIds.has(row.datasetId)), 'Replication credits intake');
assert.equal(integration.currentSha256, dependencies.get(`${replicationFolder}/reviewed-specifications.json`), 'Stale integration manifest');
const priorById = new Map<string, any>(priorReplication.records.map((row: any) => [row.datasetId, row]));
assert.equal(priorById.size, 126, 'Closed prior evidence is incomplete');
for (const row of replication.records) {
  const spec = currentSpecs.records.find((value: any) => value.datasetId === row.datasetId);
  for (const field of ['accession', 'configId', 'config', 'proposedStatus', 'unitType', 'mappingMethod', 'note', 'sources']) {
    assert.deepEqual(row[field], spec[field], `Evidence ${field} differs from reviewed specification: ${row.datasetId}`);
  }
  assert.equal(row.sheet, spec.sheet.path, `Evidence sample sheet differs: ${row.datasetId}`);
  assert.equal(createHash('sha256').update(JSON.stringify(row.mappings)).digest('hex'), spec.mappingSha256,
    `Evidence mapping differs from reviewed digest: ${row.datasetId}`);
  assert.deepEqual(Object.keys(row.contrasts).sort(), [...spec.contrasts].sort(), `Evidence contrast scope differs: ${row.datasetId}`);
  const previous = priorById.get(row.datasetId);
  if (previous) {
    assert.deepEqual(row.mappings, previous.mappings, `Prior source mappings changed: ${row.datasetId}`);
    assert.deepEqual(row.contrasts, previous.contrasts, `Prior replication decisions changed: ${row.datasetId}`);
  }
}

const unmapped = [
  { datasetId: 'macaque_snrna', nextStep: 'Recover the original Seurat RNA counts or raw pseudobulk/TMM inputs and the animal-to-source-object crosswalk. All 60 displayed populations were audited; five tracks retain only two samples in an arm.', evidence: 'data/internal-qc/advancement-2026-09-05/macaque/README.md' },
  { datasetId: 'mouse_hypo_maternal_care_gse305688', nextStep: 'Recover the original count-column-to-GSM crosswalk and the sample-to-litter/container allocation. The authenticated count columns 1–7 cannot be assigned to GSMs by order.', evidence: 'data/quality/round4-2026-09-05/REPLICATION_D.md' },
  { datasetId: 'mouse_hypo_maternal_hcd_gse242187', nextStep: 'Recover the Mona13/14/15 and Mona25/26/27 count-column-to-GSM crosswalk and offspring-to-dam/litter mapping. Verified numerical source identity does not establish those relationships.', evidence: 'data/quality/round4-2026-09-05/REPLICATION_D.md' },
];
for (const row of unmapped) input(row.evidence);
const mappedIds = unique(replication.records, 'replication evidence');
assert.deepEqual([...originalIds].filter(id => !mappedIds.has(id)).sort(), unmapped.map(row => row.datasetId).sort(), 'Unmapped original scope changed');
assert.deepEqual(integration.remainingUnmapped, unmapped.map(row => row.datasetId).sort(), 'Unmapped integration scope differs');

type Row = { datasetId: string; accession: string; internalQc: QualityAssessment; authorConcordance: QualityAssessment };
const kinds = ['internalQc', 'authorConcordance'] as const;
const statuses = ['pass', 'review', 'fail', 'not_assessed', 'not_applicable'];
for (const row of quality.records) {
  for (const kind of kinds) {
    assert.ok(statuses.includes(row[kind].status), `Unknown ${kind} status: ${row.datasetId}`);
    assert.ok(row[kind].checks.every((check: any) => statuses.includes(check.status)), `Unknown ${kind} check status: ${row.datasetId}`);
  }
  assert.deepEqual(row.internalQc, internalQc.records.find((value: any) => value.datasetId === row.datasetId).assessment,
    `QC ledgers disagree: ${row.datasetId}`);
}
for (const row of internalQc.records) {
  for (const assessment of Object.values(row.contrasts) as QualityAssessment[]) {
    assert.ok(statuses.includes(assessment.status), `Unknown contrast status: ${row.datasetId}`);
    assert.ok(assessment.checks.every(check => statuses.includes(check.status)), `Unknown contrast check status: ${row.datasetId}`);
  }
}
for (const row of replication.records) {
  const qc = internalQc.records.find((value: any) => value.datasetId === row.datasetId);
  for (const [contrastId, contrast] of Object.entries(row.contrasts) as [string, any][]) {
    assert.ok(statuses.includes(contrast.check.status), `Unknown replication contrast status: ${row.datasetId}/${contrastId}`);
    assert.equal(contrast.check.status, qc.contrasts[contrastId]?.checks.find((check: any) => check.id === 'independent_replication')?.status,
      `Replication and QC contrast statuses disagree: ${row.datasetId}/${contrastId}`);
  }
}
const count = (rows: Row[], kind: typeof kinds[number], scope = originalIds) => Object.fromEntries(statuses.map(status =>
  [status, rows.filter(row => scope.has(row.datasetId) && row[kind].status === status).length]));
const records = baseline.quality.records.filter((row: Row) => originalIds.has(row.datasetId)).map((before: Row) => {
  const after: Row = quality.records.find((row: Row) => row.datasetId === before.datasetId);
  const author = validation.records.find((row: Row) => row.datasetId === before.datasetId);
  const oldAuthor = baseline.validation.records.find((row: Row) => row.datasetId === before.datasetId);
  assert.deepEqual(author.directComparison, oldAuthor.directComparison, `Author measurements changed: ${before.datasetId}`);
  assert.deepEqual(after.authorConcordance, before.authorConcordance, `Author assessment changed: ${before.datasetId}`);
  return { datasetId: before.datasetId, accession: before.accession,
    before: Object.fromEntries(kinds.map(kind => [kind, before[kind].status])),
    after: Object.fromEntries(kinds.map(kind => [kind, after[kind].status])),
    changes: Object.fromEntries(kinds.map(kind => [kind, [
      ...after[kind].checks.flatMap(check => {
        const old = before[kind].checks.find(row => row.id === check.id);
        return isDeepStrictEqual(old, check) ? [] : [{ id: check.id, before: old?.status ?? 'not_assessed', after: check.status, required: check.required !== false, note: check.note }];
      }),
      ...before[kind].checks.filter(check => !after[kind].checks.some(row => row.id === check.id))
        .map(check => ({ id: check.id, before: check.status, after: 'removed', required: check.required !== false, note: check.note })),
    ]])),
    blockers: Object.fromEntries(kinds.map(kind => [kind, after[kind].checks.filter(check => check.required !== false && !['pass', 'not_applicable'].includes(check.status))])),
    contrastAssessments: internalQc.records.find((row: Row) => row.datasetId === before.datasetId).contrasts,
    authorNextStep: author.verification.nextStep };
});
const preservation = read(`${folder}/scientific-files.after.json`);
const preservationBefore = read(`${folder}/scientific-files.before.json`);
assert.equal(preservation.files.length, preservationBefore.files.length, 'Incomplete scientific file detail');
for (const [index, file] of preservation.files.entries()) {
  const old = preservationBefore.files[index];
  assert.equal(file.path, old.path, 'Scientific file scope/order changed');
  assert.equal(file.sha256, old.sha256, `Scientific baseline digest changed: ${file.path}`);
  assert.equal(file.currentSha256, old.sha256, `Scientific digest changed: ${file.path}`);
  assert.equal(file.currentBytes, old.bytes, `Scientific size changed: ${file.path}`);
  assert.equal(file.unchanged, true, `Scientific file not preserved: ${file.path}`);
}
// The full 2.279GB byte replay is the separate preservation --check gate. Bind its
// complete manifest and dependencies here rather than trusting headline counts.
for (const pin of preservation.dependencies) {
  input(pin.path);
  assert.equal(dependencies.get(pin.path), pin.sha256, `Stale preservation dependency: ${pin.path}`);
}
assert.equal(preservation.filesChecked, 1324, 'Incomplete scientific preservation report');
assert.equal(preservation.originalConfigurationsChecked, 142, 'Incomplete configuration preservation report');
assert.deepEqual(preservation.unexpectedScientificChanges, [], 'Scientific data changed');
assert.deepEqual(preservation.originalConfigurationChanges, [], 'Original configuration changed');
const addedIds = new Set(fragments.flatMap(fragment => fragment.records.map((row: any) => row.datasetId)));
assert.equal(addedIds.size, 16, 'Added scope must contain 16 datasets');
const additions = replication.records.filter((row: any) => addedIds.has(row.datasetId));
const summary = {
  datasets: 145, policyUnchanged: true, authorMeasurementsUnchanged: true,
  before: Object.fromEntries(kinds.map(kind => [kind, count(baseline.quality.records, kind)])),
  after: Object.fromEntries(kinds.map(kind => [kind, count(quality.records, kind)])),
  newInternalQcPasses: records.filter((row: any) => row.before.internalQc !== 'pass' && row.after.internalQc === 'pass').map((row: any) => row.datasetId),
  priorInternalQcPassesRequiringReview: records.filter((row: any) => row.before.internalQc === 'pass' && row.after.internalQc !== 'pass').map((row: any) => row.datasetId),
  comparisons: validation.records.filter((row: any) => originalIds.has(row.datasetId) && row.directComparison).length,
  replication: { before: 126, added: 16, after: 142,
    mappings: replication.records.reduce((sum: number, row: any) => sum + row.mappings.length, 0),
    addedMappings: additions.reduce((sum: number, row: any) => sum + row.mappings.length, 0),
    addedProposals: Object.fromEntries(statuses.map(status => [status, additions.filter((row: any) => row.proposedStatus === status).length])),
    contrastStatuses: Object.fromEntries(statuses.map(status => [status, replication.records.flatMap((row: any) => Object.values(row.contrasts)).filter((row: any) => row.check.status === status).length])),
    priorSpecificationsAndMappingsUnchanged: true, unmapped },
  scientificPreservation: { files: preservation.filesChecked, bytes: preservation.bytesChecked, originalConfigurations: preservation.originalConfigurationsChecked, changes: 0 },
  currentLedgerCoverage: { quality: quality.records.length, internalQc: internalQc.records.length, author: validation.records.length,
    statuses: Object.fromEntries(kinds.map(kind => [kind, count(quality.records, kind, allIds)])) },
  datasetsOutsideAudit: quality.records.filter((row: Row) => !originalIds.has(row.datasetId)).map((row: Row) => row.datasetId),
};
const clean = (text: string) => text.replace(/[|\r\n\t]/g, ' ');
const markdown = ['# Existing dataset verification: completed source-unit review', '',
  'The original 145 datasets have been reviewed. This continuation adds reviewed source-library evidence for 16 datasets, covering 229 selected profiles. Eight of those reviews retain unresolved biological units. Three datasets still lack complete source-identity mappings or upstream inputs. The 14 concurrent intake datasets are excluded from progress totals.', '',
  '| Assessment | Before this continuation | Current |', '|---|---:|---:|',
  `| Complete internal QC | ${summary.before.internalQc.pass} | ${summary.after.internalQc.pass} |`,
  `| Internal QC requiring review | ${summary.before.internalQc.review} | ${summary.after.internalQc.review} |`,
  `| Internal QC not assessed | ${summary.before.internalQc.not_assessed} | ${summary.after.internalQc.not_assessed} |`,
  `| Author concordance | ${summary.before.authorConcordance.pass} | ${summary.after.authorConcordance.pass} |`, '',
  `${summary.newInternalQcPasses.length} new complete-QC badges were earned in this continuation. ${summary.priorInternalQcPassesRequiringReview.length} earlier complete passes now require review. Their source methods expose unresolved litter, photoperiod-exposure or treatment-pen structure. The eight replication pass decisions confirm earlier passes with primary evidence; they are not eight new dataset badges. All ${summary.comparisons} numerical author comparisons and the acceptance policy remain unchanged.`, '',
  `Replication evidence now covers ${summary.replication.after} datasets, ${summary.replication.mappings} selected source-library mappings and ${Object.values(summary.replication.contrastStatuses).reduce((a, b) => a + b, 0)} contrasts. The prior 126 specifications, source mappings and contrast decisions are unchanged. Complete source-input reconstructions from round five remain evidence from that earlier round and receive no new credit here.`, '',
  `Fresh preservation checks compared ${preservation.filesChecked} original scientific files containing ${preservation.bytesChecked.toLocaleString('en-US')} bytes and every field of ${preservation.originalConfigurationsChecked} original configuration rows. No scientific input, sample assignment, model, DE result, normalization result or pathway output changed.`, '',
  'The GSE189945 citation now identifies five independent four-mouse pools per age. The GSE174085 display label identifies litter pseudobulk. A separate UI fix checks the entire expected catalog content as well as its build ID, so stale remote counts cannot accompany current verification badges. These are evidence and display corrections.', '',
  '- [Batch A: source identities, original SRA/ArrayExpress bridges and maternal reviews](../../internal-qc/replication-2026-09-05/remaining-a/README.md)',
  '- [Batch B: animal evidence, treatment pens and remaining allocation records](../../internal-qc/replication-2026-09-05/remaining-b/README.md)',
  '- [Independent review](./REVIEW.md)', '- [Executed validation and browser checks](./VALIDATION.md)',
  '- [Every changed check, contrast and unresolved blocker](./remaining-report.json)',
  '- [Scientific preservation audit](./scientific-files.after.json)',
  '- [Closed round-five history](../round5-2026-09-05/CLOSED_HISTORY.md)', '',
  '## Remaining source identities', '',
  ...unmapped.map(row => `- ${row.datasetId}: ${row.nextStep}`), '',
  '## All original dataset outcomes', '',
  '| Dataset | Internal QC | Author concordance | Next author evidence task |', '|---|---|---|---|',
  ...records.map((row: any) => `| ${clean(row.accession || row.datasetId)} | ${row.before.internalQc} → ${row.after.internalQc} | ${row.before.authorConcordance} → ${row.after.authorConcordance} | ${clean(row.authorNextStep)} |`), '',
].join('\n');
for (const [name, body] of Object.entries({ 'remaining-report.json': `${JSON.stringify({ schemaVersion: 1, summary, dependencies: [...dependencies].map(([path, sha256]) => ({ path, sha256 })), records }, null, 2)}\n`, 'ADVANCEMENT_REPORT.md': markdown })) {
  const path = `${folder}/${name}`;
  if (process.argv.includes('--check')) assert.equal(readFileSync(path, 'utf8'), body, `Stale remaining-source report: ${path}`);
  else writeFileSync(path, body);
}
console.log(JSON.stringify(summary));
