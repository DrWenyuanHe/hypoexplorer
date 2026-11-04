import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { FIXED_EOL_PATHSPECS, findEolDrift, parseEolDrift, restoreEolDrift, sameExceptLineEndings } from './bundleEol.mjs';

test('drift records parse even when the attributes contain spaces', () => {
  const output = [
    'i/lf    w/crlf  attr/-text            \tpublic/datasets/a/track_x.js',
    'i/lf    w/lf    attr/-text            \tpublic/datasets/a/track_y.js',
    'i/lf    w/crlf  attr/text eol=lf      \tpublic/datasets/.htaccess',
    '',
  ].join('\0');
  assert.deepEqual(parseEolDrift(output), [
    { path: 'public/datasets/a/track_x.js', index: 'lf', worktree: 'crlf' },
    { path: 'public/datasets/.htaccess', index: 'lf', worktree: 'crlf' },
  ]);
});

test('only CRLF versus LF counts as a line-ending difference', () => {
  const lf = Buffer.from('var t = {"x":1};\n');
  assert.ok(sameExceptLineEndings(Buffer.from('var t = {"x":1};\r\n'), lf));
  assert.ok(sameExceptLineEndings(lf, lf));
  assert.ok(!sameExceptLineEndings(Buffer.from('var t = {"x":2};\r\n'), lf));
  assert.ok(!sameExceptLineEndings(Buffer.from('var t = {"x":1};\r'), lf), 'a lone CR is content');
});

/**
 * Replays how the stale copies arose: files checked out under core.autocrlf,
 * then the `text eol=lf` rules (53c03248), then the `-text` rules. Git
 * rewrites none of the copies along the way. Isolated from the caller's hooks
 * and signing configuration.
 */
function staleCheckout(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-eol-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  };
  git('init', '-q');
  for (const [key, value] of [['core.autocrlf', 'true'], ['user.name', 'fixture'], ['user.email', 'fixture@example.invalid'],
    ['commit.gpgsign', 'false'], ['core.hooksPath', join(dir, '.no-hooks')]]) git('config', key, value);
  // A retained source (-text like the bundles), a DE table (eol=lf) and a note
  // Git may convert at will.
  const files = ['public/datasets/a/track.js', 'public/datasets/a/edited.js', 'public/datasets/a/gone.js',
    'data/sources/article.xml', 'data/results/de.csv', 'notes.txt'];
  write('.gitattributes', '* text=auto\n');
  for (const file of files) write(file, 'var t = {"x":1};\n');
  write('data/pointer.bin', 'version https://git-lfs.github.com/spec/v1\n');
  git('add', '-A'); git('commit', '-q', '-m', 'files');
  for (const file of files) rmSync(join(dir, file));
  git('checkout', '--', '.'); // autocrlf writes CRLF copies
  const past = new Date(Date.now() - 3 * 3600 * 1000);
  for (const file of files) utimesSync(join(dir, file), past, past);
  git('update-index', '-q', '--refresh');
  write('.gitattributes', '* text=auto\n*.js text eol=lf\n*.csv text eol=lf\n');
  git('add', '.gitattributes'); git('commit', '-q', '-m', 'eol=lf');
  // A filtered file, like Git LFS: its blob is a pointer, never the working bytes.
  write('.gitattributes', '* text=auto\n*.js text eol=lf\n*.csv text eol=lf\npublic/datasets/**/*.js -text !eol\n'
    + 'data/sources/*.xml -text !eol\ndata/pointer.bin filter=fixture -text\n');
  git('add', '.gitattributes'); git('commit', '-q', '-m', '-text');
  write('public/datasets/a/edited.js', 'var t = {"x":2};\r\n'); // a real edit, also CRLF
  rmSync(join(dir, 'public/datasets/a/gone.js')); // a deletion is not drift
  write('data/pointer.bin', 'the large\0binary object the pointer names\n');
  return dir;
}

test('a stale checkout is found and restored, and a real edit is kept', () => {
  const dir = staleCheckout();
  try {
    const drift = findEolDrift(FIXED_EOL_PATHSPECS, dir);
    assert.deepEqual(drift?.map((entry) => entry.path).sort(),
      ['data/results/de.csv', 'data/sources/article.xml', 'public/datasets/a/edited.js', 'public/datasets/a/track.js']);
    const { restored, kept } = restoreEolDrift(drift!, dir);
    assert.deepEqual(restored.sort(), ['data/results/de.csv', 'data/sources/article.xml', 'public/datasets/a/track.js']);
    assert.deepEqual(kept, ['public/datasets/a/edited.js']);
    for (const file of restored) {
      const committed = execFileSync('git', ['cat-file', 'blob', `:${file}`], { cwd: dir });
      assert.ok(readFileSync(join(dir, file)).equals(committed), `${file}: restored bytes are the committed bytes`);
    }
    assert.deepEqual(findEolDrift(FIXED_EOL_PATHSPECS, dir)?.map((entry) => entry.path), ['public/datasets/a/edited.js']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('covers -text and eol=lf files only: autocrlf text and filtered pointers are left alone', () => {
  const dir = staleCheckout();
  try {
    const flagged = findEolDrift(FIXED_EOL_PATHSPECS, dir)?.map((entry) => entry.path) ?? [];
    // notes.txt is CRLF in the working tree too, but autocrlf is allowed to do that.
    assert.ok(readFileSync(join(dir, 'notes.txt')).includes('\r\n'));
    assert.ok(!flagged.includes('notes.txt'));
    assert.ok(!flagged.includes('data/pointer.bin'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('re-checks thousands of literal paths without exceeding the command-line limit', () => {
  // restore:bundle-eol re-checks everything it restored by literal path; the main
  // checkout once needed 1,122 at a time, past the Windows 32,767-character limit.
  const dir = staleCheckout();
  try {
    const untracked = Array.from({ length: 3000 }, (_, i) => `:(literal)data/untracked/${'x'.repeat(48)}-${i}.csv`);
    const drift = findEolDrift([...untracked, ':(literal)public/datasets/a/track.js'], dir);
    assert.deepEqual(drift?.map((entry) => entry.path), ['public/datasets/a/track.js']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('outside a Git work tree there is nothing to compare', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-eol-plain-'));
  const ceiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = dirname(dir); // never search an enclosing repository
  try {
    assert.equal(findEolDrift(FIXED_EOL_PATHSPECS, dir), null);
  } finally {
    if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = ceiling;
    rmSync(dir, { recursive: true, force: true });
  }
});
