/**
 * Registry edits made with the R 4.6.0 regeneration.
 *
 * src/data/datasets.ts changed with the regeneration: the displayed unit of
 * count studies became TMM-normalized CPM (rule C2), and GSE87544's contrast was
 * marked exploratory with a corrected citation. Sealed producers that import the
 * registry compare it with snapshots taken before the swap. For them,
 * scripts/run_sealed_ts_check.mts loads the registry with exactly the recorded
 * edits reverted:
 *
 * - every recorded edit's `new` value must be the current value of that field;
 * - after reverting, the records of the pre-swap datasets, in their pre-swap
 *   order, must hash to `preSwapRegistrySha256`, the canonical JSON of the
 *   registry evaluated at the pre-swap commit. Any other difference, including
 *   a removed or reordered dataset, fails closed. Datasets added after the swap
 *   are served as they are, except the bounded additive intake's datasets
 *   (scripts/lib/historicalEvidence.mts): the hooks serve every superseded ledger
 *   from its pre-swap archive, which cannot list them, so a sealed producer sees
 *   the registry those ledgers describe.
 *
 * data/quality/regeneration-r460-2026-09-25/registry-edits.json is written, and
 * re-derived from git, by scripts/regen-r460/build_registry_edits.mts. Its
 * SHA-256 is pinned here.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const REGISTRY_MODULE = 'src/data/datasets.ts';
export const REGISTRY_EDITS = 'data/quality/regeneration-r460-2026-09-25/registry-edits.json';
// Written by `npx tsx scripts/regen-r460/build_registry_edits.mts --write`; null: nothing is reverted.
export const REGISTRY_EDITS_SHA256: string | null = 'c43eb3a46fb1e65b0894f6d9a1cb3f4bd3c43e89204b256acc7f6cbdc9fe924b';

export interface RegistryEdit { datasetId: string; field: string; old: unknown; new: unknown; reason: string }
export interface RegistryEdits {
  schemaVersion: 1; record: string; preSwapCommit: string; module: string; export: 'DATASETS';
  preSwapDatasetIds: string[]; preSwapRegistrySha256: string; edits: RegistryEdit[];
}
type Dataset = { id: string } & Record<string, unknown>;

const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const sortKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(sortKeys)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((name) => [name, sortKeys((value as any)[name])])) : value;
/** JSON with sorted keys; the registry is plain data, so this is its complete content. */
export const canonicalJson = (value: unknown): string => JSON.stringify(sortKeys(value));
export const registrySha256 = (datasets: readonly unknown[]): string => hash(canonicalJson(datasets));

/** Every field that differs between two registries, in registry and field order. */
export function diffRegistry(before: readonly Dataset[], after: readonly Dataset[]): Omit<RegistryEdit, 'reason'>[] {
  const current = new Map(after.map((row) => [row.id, row]));
  assert.equal(current.size, after.length, 'Duplicate registry id');
  const edits: Omit<RegistryEdit, 'reason'>[] = [];
  for (const row of before) {
    const now = current.get(row.id);
    assert.ok(now, `A pre-swap dataset was removed: ${row.id}`);
    for (const field of [...new Set([...Object.keys(row), ...Object.keys(now)])]) {
      if (canonicalJson(row[field]) === canonicalJson(now[field])) continue;
      assert.ok(row[field] !== undefined && now[field] !== undefined, `A registry field was added or removed: ${row.id}/${field}`);
      edits.push({ datasetId: row.id, field, old: JSON.parse(canonicalJson(row[field])), new: JSON.parse(canonicalJson(now[field])) });
    }
  }
  return edits;
}

export function loadRegistryEdits(root: string, sha: string | null = REGISTRY_EDITS_SHA256, read: (path: string) => Buffer = readFileSync): RegistryEdits {
  assert.ok(sha, 'The registry edits of the R 4.6.0 regeneration are not recorded; REGISTRY_EDITS_SHA256 is unset');
  const body = read(resolve(root, REGISTRY_EDITS));
  assert.equal(hash(body), sha, `Registry edit record changed: ${REGISTRY_EDITS}`);
  const document = JSON.parse(body.toString('utf8')) as RegistryEdits;
  assert.ok(document.schemaVersion === 1 && document.module === REGISTRY_MODULE && document.export === 'DATASETS'
    && Array.isArray(document.edits) && Array.isArray(document.preSwapDatasetIds)
    && /^[0-9a-f]{64}$/.test(document.preSwapRegistrySha256), 'Invalid registry edit record');
  const seen = new Set<string>();
  for (const edit of document.edits) {
    assert.ok(typeof edit.datasetId === 'string' && typeof edit.field === 'string' && typeof edit.reason === 'string' && edit.reason.trim()
      && 'old' in edit && 'new' in edit && edit.field !== 'id', `Invalid registry edit: ${edit.datasetId}/${edit.field}`);
    assert.ok(!seen.has(`${edit.datasetId}\0${edit.field}`), `Duplicate registry edit: ${edit.datasetId}/${edit.field}`);
    seen.add(`${edit.datasetId}\0${edit.field}`);
  }
  return document;
}

/**
 * Revert the recorded edits in place, after checking each one is the current
 * value, then prove the pre-swap records equal the recorded pre-swap registry.
 */
export function revertRegistryEdits(datasets: Dataset[], document: RegistryEdits): void {
  const byId = new Map(datasets.map((row) => [row.id, row]));
  assert.equal(byId.size, datasets.length, 'Duplicate registry id');
  for (const edit of document.edits) {
    const row = byId.get(edit.datasetId);
    assert.ok(row, `Registry edit names a dataset outside the registry: ${edit.datasetId}`);
    assert.equal(canonicalJson(row[edit.field]), canonicalJson(edit.new), `Registry differs from the recorded regeneration edit: ${edit.datasetId}/${edit.field}`);
  }
  for (const edit of document.edits) byId.get(edit.datasetId)![edit.field] = structuredClone(edit.old);
  const ids = new Set(document.preSwapDatasetIds);
  const preSwap = datasets.filter((row) => ids.has(row.id));
  assert.deepEqual(preSwap.map((row) => row.id), document.preSwapDatasetIds, 'Pre-swap registry datasets were removed or reordered');
  assert.equal(registrySha256(preSwap), document.preSwapRegistrySha256, 'Registry differs from the pre-swap registry beyond the recorded regeneration edits');
}

/** Remove, in place, the additive intake's datasets that postdate the swap; a pre-swap dataset is never removed. */
export function withoutAdditiveIntake(datasets: Dataset[], document: RegistryEdits, additiveIds: ReadonlySet<string>): void {
  const preSwap = new Set(document.preSwapDatasetIds);
  assert.ok([...additiveIds].every((id) => !preSwap.has(id)), 'An additive intake dataset is a pre-swap dataset');
  for (let index = datasets.length - 1; index >= 0; index--) if (additiveIds.has(datasets[index].id)) datasets.splice(index, 1);
}

/** Called by the module that scripts/lib/sealedModuleHooks.mts serves for src/data/datasets.ts. */
export function projectRegistryModule(datasets: Dataset[], root: string, sha: string | null, additiveIds: readonly string[] = []): void {
  const document = loadRegistryEdits(root, sha);
  revertRegistryEdits(datasets, document);
  withoutAdditiveIntake(datasets, document, new Set(additiveIds));
}
