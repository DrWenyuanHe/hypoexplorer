import { describe, expect, it, vi } from 'vitest';
import { assertGitPreservesFileBytes } from '../../scripts/lib/fgseaGitBytes.mjs';

const first = 'a'.repeat(40);
const second = 'b'.repeat(40);

describe('exact-byte analysis Git storage', () => {
  it('accepts unchanged Git clean-filter bytes and deduplicates file paths', () => {
    const hash = vi.fn(() => [first, second]);
    assertGitPreservesFileBytes('root', ['a.tsv', 'b.tsv', 'a.tsv'], hash);
    expect(hash).toHaveBeenNthCalledWith(1, 'root', ['a.tsv', 'b.tsv'], true);
    expect(hash).toHaveBeenNthCalledWith(2, 'root', ['a.tsv', 'b.tsv'], false);
  });

  it('fails closed when line-ending normalization would change a pinned file', () => {
    const hash = vi.fn((_root: string, _paths: string[], raw: boolean) => [raw ? first : second]);
    expect(() => assertGitPreservesFileBytes('root', ['processed/source_DE.tsv'], hash)).toThrow(/Git would alter 1.*source_DE/);
  });

  it('rejects unsafe paths and incomplete Git output before accepting evidence', () => {
    for (const path of ['../a.tsv', '/a.tsv', 'D:/a.tsv', 'a\\b.tsv', 'a\nb.tsv']) {
      expect(() => assertGitPreservesFileBytes('root', [path], () => [first])).toThrow(/safe relative/);
    }
    expect(() => assertGitPreservesFileBytes('root', ['a.tsv'], () => [])).toThrow(/one valid blob hash/);
    expect(() => assertGitPreservesFileBytes('root', ['a.tsv'], () => ['invalid'])).toThrow(/one valid blob hash/);
  });
});
