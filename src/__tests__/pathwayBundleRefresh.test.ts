import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyPathwayBundlePlans } from '../../scripts/lib/pathwayBundleRefresh.mjs';

const temporaryDirectories: string[] = [];
afterEach(() => {
  const root = resolve(tmpdir());
  for (const path of temporaryDirectories.splice(0)) {
    const directory = resolve(path);
    if (dirname(directory) !== root || !['pathway-refresh-test-', 'fgsea-pathway-refresh-']
      .some((prefix) => basename(directory).startsWith(prefix))) throw new Error(`unsafe test cleanup: ${directory}`);
    rmSync(directory, { recursive: true, force: true });
  }
});

function plans() {
  const directory = mkdtempSync(join(tmpdir(), 'pathway-refresh-test-'));
  temporaryDirectories.push(directory);
  return Array.from({ length: 3 }, (_, index) => {
    const file = join(directory, `${index}.pathways.js`);
    writeFileSync(file, `original ${index}`);
    return { file, key: `PATH_${index}`, body: `replacement ${index}` };
  });
}

describe('pathway refresh recovery', () => {
  it('attempts every restoration and retains all backups when one restoration fails', () => {
    const batch = plans();
    const restored: string[] = [];
    const failingCopy: typeof copyFileSync = (source, destination, mode) => {
      const name = basename(String(source));
      if (name === '2.new') throw new Error('simulated publication failure');
      if (name.endsWith('.old')) {
        restored.push(name);
        if (name === '0.old') throw new Error('simulated restoration failure');
      }
      copyFileSync(source, destination, mode);
    };
    let failure: unknown;
    try { applyPathwayBundlePlans(batch, {}, failingCopy); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain('1 restoration(s) failed');
    expect(restored).toEqual(['0.old', '1.old', '2.old']);
    const recoveryDirectory = message.split('Recovery backups retained at: ')[1]?.split('\n')[0];
    expect(recoveryDirectory).toBeTruthy();
    if (!recoveryDirectory) throw new Error('missing recovery directory in failure');
    temporaryDirectories.push(recoveryDirectory);
    expect(existsSync(recoveryDirectory)).toBe(true);
    expect(readFileSync(join(recoveryDirectory, '0.old'), 'utf8')).toBe('original 0');
    expect(JSON.parse(readFileSync(join(recoveryDirectory, 'recovery-manifest.json'), 'utf8')))
      .toHaveLength(3);
    expect(readFileSync(batch[0].file, 'utf8')).toBe('replacement 0');
    expect(readFileSync(batch[1].file, 'utf8')).toBe('original 1');
    expect(readFileSync(batch[2].file, 'utf8')).toBe('original 2');
  });

  it('removes temporary backups only after every restoration succeeds', () => {
    const batch = plans();
    let stage = '';
    const failingCopy: typeof copyFileSync = (source, destination, mode) => {
      if (basename(String(source)) === '2.new') {
        stage = dirname(String(source));
        throw new Error('simulated publication failure');
      }
      copyFileSync(source, destination, mode);
    };
    expect(() => applyPathwayBundlePlans(batch, {}, failingCopy)).toThrow(/simulated publication failure/);
    batch.forEach((plan, index) => { expect(readFileSync(plan.file, 'utf8')).toBe(`original ${index}`); });
    expect(stage).not.toBe('');
    expect(existsSync(stage)).toBe(false);
  });
});
