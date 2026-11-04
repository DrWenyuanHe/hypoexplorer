import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { PlannedBundleFile } from './bundleWriter.mjs';

export interface PathwayRefreshResult {
  files: number;
  changed: string[];
}

/**
 * Publish only an already validated pathway plan. All inputs are preflighted
 * before any write; exact original bytes are backed up for rollback. Protected
 * bundle paths are never write targets and must remain byte-identical.
 */
export function applyPathwayBundlePlans(
  plans: readonly PlannedBundleFile[],
  options: { check?: boolean; dry?: boolean; protectedFiles?: readonly string[] } = {},
  copyFile: typeof copyFileSync = copyFileSync,
): PathwayRefreshResult {
  const comparable = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
  const protectedPaths = new Set((options.protectedFiles ?? []).map(comparable));
  const targets = new Set<string>();
  for (const plan of plans) {
    const path = comparable(plan.file);
    if (targets.has(path) || protectedPaths.has(path)) throw new Error(`${plan.file}: duplicate or protected refresh target`);
    if (!/(?:\.pathways|pathways_index)\.js$/.test(plan.file)) throw new Error(`${plan.file}: not a pathway-only target`);
    targets.add(path);
  }
  const hashFile = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const protectedHashes = new Map((options.protectedFiles ?? []).map((path) => [path, hashFile(path)]));
  const changed = plans.filter((plan) => !existsSync(plan.file) || readFileSync(plan.file, 'utf8') !== plan.body);
  if (options.check) {
    if (changed.length) throw new Error(`pathway bundles are stale (${changed.length} files): ${changed.slice(0, 8).map((plan) => plan.file).join(', ')}`);
    return { files: plans.length, changed: [] };
  }
  if (options.dry || !changed.length) return { files: plans.length, changed: changed.map((plan) => plan.file) };

  const temporaryRoot = resolve(tmpdir());
  const stagePrefix = 'fgsea-pathway-refresh-';
  const stage = resolve(mkdtempSync(join(temporaryRoot, stagePrefix)));
  const assertStageBoundary = () => {
    const child = relative(temporaryRoot, stage);
    if (!child || child.startsWith('..') || isAbsolute(child) || dirname(stage) !== temporaryRoot
      || !basename(stage).startsWith(stagePrefix)) {
      throw new Error(`refusing cleanup outside the dedicated pathway-refresh temporary directory: ${stage}`);
    }
  };
  assertStageBoundary();
  const existed = changed.map((plan) => existsSync(plan.file));
  let published = 0;
  let retainStage = false;
  try {
    writeFileSync(join(stage, 'recovery-manifest.json'), `${JSON.stringify(changed.map((plan, index) => ({
      target: plan.file,
      backup: existed[index] ? `${index}.old` : null,
      replacement: `${index}.new`,
    })), null, 2)}\n`);
    changed.forEach((plan, index) => {
      writeFileSync(join(stage, `${index}.new`), plan.body);
      if (existed[index]) copyFile(plan.file, join(stage, `${index}.old`));
    });
    try {
      changed.forEach((plan, index) => {
        mkdirSync(dirname(plan.file), { recursive: true });
        // Count the target before copying so a partial copy is rolled back too.
        published = index + 1;
        copyFile(join(stage, `${index}.new`), plan.file);
        if (readFileSync(plan.file, 'utf8') !== plan.body) throw new Error(`${plan.file}: publication verification failed`);
      });
      for (const [path, before] of protectedHashes) {
        if (hashFile(path) !== before) throw new Error(`${path}: protected bundle changed during pathway refresh`);
      }
    } catch (error) {
      const restorationFailures: string[] = [];
      for (let index = 0; index < published; index += 1) {
        try {
          if (existed[index]) {
            const backup = join(stage, `${index}.old`);
            copyFile(backup, changed[index].file);
            if (hashFile(backup) !== hashFile(changed[index].file)) throw new Error('restored bytes do not match backup');
          } else {
            rmSync(changed[index].file, { force: true });
            if (existsSync(changed[index].file)) throw new Error('new output could not be removed');
          }
        } catch (restoreError) {
          restorationFailures.push(`${changed[index].file}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
        }
      }
      if (restorationFailures.length) {
        retainStage = true;
        throw new Error(
          `pathway publication failed and ${restorationFailures.length} restoration(s) failed. `
          + `Original failure: ${error instanceof Error ? error.message : String(error)}\n`
          + `Recovery backups retained at: ${stage}\n${restorationFailures.join('\n')}`,
        );
      }
      throw error;
    }
  } finally {
    if (!retainStage) {
      assertStageBoundary();
      rmSync(stage, { recursive: true, force: true });
    }
  }
  return { files: plans.length, changed: changed.map((plan) => plan.file) };
}
