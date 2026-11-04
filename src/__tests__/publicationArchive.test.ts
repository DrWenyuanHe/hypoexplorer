import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPublicationArchive } from '../../scripts/lib/publicationArchive.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hypo archive with spaces '));
  roots.push(root);
  const base = join(root, 'source tree');
  const output = join(root, 'archive output');
  const extracted = join(root, 'extracted tree');
  for (const directory of [base, output, extracted]) mkdirSync(directory);
  mkdirSync(join(base, 'nested folder'));
  writeFileSync(join(base, 'nested folder/source file.txt'), 'exact source\n');
  writeFileSync(join(base, 'binary.dat'), Buffer.from([0, 255, 128, 65]));
  writeFileSync(join(base, 'excluded.env'), 'must not be archived');
  writeFileSync(join(output, 'release-source.json'), '{"release":"fixture"}\n');
  return { base, output, extracted, files: ['nested folder/source file.txt', 'binary.dat'] };
}

describe('publication tar portability', () => {
  it.each([true, false])('round-trips selected files using actual tar, with separate metadata=%s', async (includeMetadata) => {
    const f = fixture();
    await createPublicationArchive(f.output, 'source', f.base, f.files,
      includeMetadata ? { directory: f.output, files: ['release-source.json'] } : undefined);
    const archive = join(f.output, 'source.tar.gz');
    // Relative archive paths: GNU tar reads `C:\...` as a remote host:path.
    const listing = execFileSync('tar', ['-tzf', 'source.tar.gz'], { cwd: f.output, encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/);
    expect(listing.sort()).toEqual([...f.files, ...(includeMetadata ? ['release-source.json'] : [])].sort());
    execFileSync('tar', ['-xzf', relative(f.extracted, archive).split(sep).join('/')], { cwd: f.extracted, windowsHide: true });
    expect(readFileSync(join(f.extracted, f.files[0]), 'utf8')).toBe('exact source\n');
    expect(readFileSync(join(f.extracted, 'binary.dat'))).toEqual(Buffer.from([0, 255, 128, 65]));
    expect(existsSync(join(f.extracted, 'excluded.env'))).toBe(false);
    expect(existsSync(join(f.output, 'source.tar'))).toBe(false);
    if (includeMetadata) expect(readFileSync(join(f.extracted, 'release-source.json'), 'utf8')).toBe('{"release":"fixture"}\n');
  });
});
