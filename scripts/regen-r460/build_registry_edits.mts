/**
 * Record the registry edits made with the R 4.6.0 regeneration.
 *
 *   npx tsx scripts/regen-r460/build_registry_edits.mts --write   (review what it prints)
 *   npx tsx scripts/regen-r460/build_registry_edits.mts --check
 *
 * Evaluates src/data/datasets.ts at the pre-swap commit of the supersession
 * manifest (src/data and src/types are copied from git objects into a temporary
 * folder, so the checkout is never touched) and in this checkout, and records
 * every field that differs. Each difference must match a reviewed reason below;
 * any other difference, or a removed pre-swap dataset, is refused. --write writes
 * data/quality/regeneration-r460-2026-09-25/registry-edits.json and pins its
 * SHA-256 in scripts/lib/registryEdits.mts; --check re-derives both.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { supersession } from '../lib/historicalEvidence.mjs';
import { REGISTRY_EDITS, REGISTRY_MODULE, canonicalJson, diffRegistry, registrySha256, type RegistryEdit, type RegistryEdits } from '../lib/registryEdits.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LIBRARY = 'scripts/lib/registryEdits.mts';
const args = process.argv.slice(2);
const write = args.includes('--write');
assert.ok(write !== args.includes('--check') && args.length === 1, 'Pass exactly one of --write or --check');

/** Reviewed reasons. A difference is recorded only when exactly one reason matches it. */
const GSE87544 = 'mouse_hypo_fasting_gse87544';
const GSE87544_REASON = 'Under edgeR 4.10.1 the GSE87544 fit (~ batch + group on seven processed units, one residual degree of freedom) '
  + 'keeps its effect sizes but not its gene-level significance (224 to 1 gene at FDR < 0.05), so the contrast is shown as exploratory. '
  + 'The design analysis also corrected the unit count in the citation: seven author-defined processed units, 4 fed vs 3 food deprived, '
  + 'not eight mouse pseudobulks with n=5 vs 3. See data/quality/regeneration-r460-2026-09-25/README.md (GSE87544) and notes/GSE87544_design.md.';
const REASONS: { field: string; datasetId?: string; old?: unknown; new?: unknown; reason: string }[] = [
  { field: 'expressionUnit', old: 'CPM', new: 'CPM (TMM-normalized)',
    reason: 'Rule C2: the browser shows CPM computed with the TMM factors of the DE fit itself (<stem>_CPM_TMM.tsv.gz; the macaque atlas normcpm.csv), so the displayed unit is CPM (TMM-normalized). See data/quality/regeneration-r460-2026-09-25/README.md (Rules applied to every producer).' },
  { field: 'expressionUnit', datasetId: 'mouse_scn_hfd_gse157077', old: 'log2-normalized', new: 'log2(FPKM + 1)',
    reason: 'Unit relabel (2026-10-21), values unchanged: the deposited matrix is FPKM and de_gse157077_r460.R displays log2(FPKM + 1) of it after summing duplicate symbols on the linear scale. The label log2-normalized, whose tooltip said the values were deposited unchanged and not gene-length normalized, was wrong for FPKM. Bundles keep their bytes; the registry unit is authoritative for display (buildPopData, loadTimeSeries).' },
  { field: 'expressionUnit', datasetId: 'mouse_pomc_maternal_hfd_gse135639', old: 'log2-normalized', new: 'log2(normalized CPM + 1)',
    reason: 'Unit relabel (2026-10-21), values unchanged: GEO deposits edgeR-normalized CPM and de_gse135639_r460.R displays log2(value + 1) of it after summing duplicate symbols on the linear scale, as GSE243287 is labelled. The label log2-normalized implied the deposited values were shown unchanged. Bundles keep their bytes; the registry unit is authoritative for display (buildPopData).' },
  { field: 'contrasts', datasetId: GSE87544, reason: GSE87544_REASON },
  { field: 'citation', datasetId: GSE87544, reason: GSE87544_REASON },
];

function git(argv: string[], input?: string): Buffer {
  const result = spawnSync('git', ['-C', ROOT, ...argv], { input, maxBuffer: 2 ** 31 - 1, env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } });
  assert.equal(result.status, 0, `git ${argv.join(' ')} failed: ${result.stderr?.toString()}`);
  return result.stdout;
}

/** Copy the registry module's folders at `commit` from git objects into `folder`. */
function extract(commit: string, folder: string): void {
  const names = git(['ls-tree', '-r', '--name-only', '-z', commit, '--', 'src/data', 'src/types']).toString('utf8').split('\0').filter(Boolean);
  assert.ok(names.includes(REGISTRY_MODULE), `${REGISTRY_MODULE} is missing at ${commit}`);
  const out = git(['cat-file', '--batch'], names.map((name) => `${commit}:${name}\n`).join(''));
  let offset = 0;
  for (const name of names) {
    const newline = out.indexOf(10, offset);
    const [, kind, size] = out.subarray(offset, newline).toString('utf8').split(' ');
    assert.equal(kind, 'blob', `${commit}:${name} is not a blob`);
    const start = newline + 1, end = start + Number(size);
    mkdirSync(dirname(resolve(folder, name)), { recursive: true });
    writeFileSync(resolve(folder, name), out.subarray(start, end));
    offset = end + 1;
  }
}

const commit = supersession(ROOT).commit;
const folder = mkdtempSync(resolve(tmpdir(), 'registry-pre-swap-'));
let before: any[], after: any[];
try {
  extract(commit, folder);
  before = JSON.parse(canonicalJson((await import(pathToFileURL(resolve(folder, REGISTRY_MODULE)).href)).DATASETS));
  after = JSON.parse(canonicalJson((await import(pathToFileURL(resolve(ROOT, REGISTRY_MODULE)).href)).DATASETS));
} finally {
  rmSync(folder, { recursive: true, force: true });
}
const edits: RegistryEdit[] = diffRegistry(before, after).map((edit) => {
  const reasons = REASONS.filter((rule) => rule.field === edit.field && (rule.datasetId === undefined || rule.datasetId === edit.datasetId)
    && (!('old' in rule) || canonicalJson(rule.old) === canonicalJson(edit.old)) && (!('new' in rule) || canonicalJson(rule.new) === canonicalJson(edit.new)));
  assert.equal(reasons.length, 1, `No single reviewed reason covers the registry change ${edit.datasetId}/${edit.field}: ${canonicalJson(edit.old).slice(0, 120)} -> ${canonicalJson(edit.new).slice(0, 120)}`);
  return { ...edit, reason: reasons[0].reason };
});
const document: RegistryEdits = {
  schemaVersion: 1,
  record: 'Registry fields changed with the R 4.6.0 regeneration, from the registry evaluated at the pre-swap commit to the current one. '
    + 'Sealed producers run through scripts/run_sealed_ts_check.mts import the registry with exactly these edits reverted, '
    + 'only after the reverted pre-swap records hash to preSwapRegistrySha256 (scripts/lib/registryEdits.mts). '
    + 'Written by scripts/regen-r460/build_registry_edits.mts.',
  preSwapCommit: commit, module: REGISTRY_MODULE, export: 'DATASETS',
  preSwapDatasetIds: before.map((row) => row.id), preSwapRegistrySha256: registrySha256(before), edits,
};
const body = `${JSON.stringify(document, null, 2)}\n`;
const sha = createHash('sha256').update(body).digest('hex');
const constant = /^export const REGISTRY_EDITS_SHA256: string \| null = .*;$/m;
const byField: Record<string, number> = {};
for (const edit of edits) byField[edit.field] = (byField[edit.field] ?? 0) + 1;
if (write) {
  writeFileSync(resolve(ROOT, REGISTRY_EDITS), body);
  const library = readFileSync(resolve(ROOT, LIBRARY), 'utf8');
  assert.ok(constant.test(library), `${LIBRARY} has no REGISTRY_EDITS_SHA256 constant`);
  writeFileSync(resolve(ROOT, LIBRARY), library.replace(constant, `export const REGISTRY_EDITS_SHA256: string | null = '${sha}';`));
  console.log(`Wrote ${REGISTRY_EDITS} (${sha}): ${edits.length} edits ${JSON.stringify(byField)}; pinned in ${LIBRARY}.`);
} else {
  assert.equal(readFileSync(resolve(ROOT, REGISTRY_EDITS), 'utf8'), body, 'Registry edit record is stale; review the registry change and rerun --write.');
  assert.ok(readFileSync(resolve(ROOT, LIBRARY), 'utf8').includes(`export const REGISTRY_EDITS_SHA256: string | null = '${sha}';`), `${LIBRARY} does not pin the record`);
  console.log(`Registry edit record is current: ${edits.length} edits ${JSON.stringify(byField)}.`);
}
